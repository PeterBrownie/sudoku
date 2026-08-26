// Typesetting — we own layout because the text becomes outlines, so there is no
// <text> element doing kerning, line-breaking or alignment for us.
//
// Produces a layout in canvas user units (the 1280-wide space), with one path
// per glyph plus the bookkeeping the splitter and stagger orderer need.

import { getFace } from './fonts.js';

export function applyCase(text, mode) {
    switch (mode) {
        case 'upper': return text.toUpperCase();
        case 'lower': return text.toLowerCase();
        case 'title': return text.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
        default:      return text;
    }
}

// Greedy wrap on spaces. Only runs when type.wrap is on and a line overflows.
function wrapLines(rawLines, measure, maxWidth) {
    const out = [];
    for (const line of rawLines) {
        if (measure(line) <= maxWidth) { out.push(line); continue; }
        const words = line.split(/(\s+)/).filter(s => s.length);
        let cur = '';
        for (const w of words) {
            const next = cur + w;
            if (cur && measure(next.trimEnd()) > maxWidth) {
                out.push(cur.trimEnd());
                cur = w.trimStart();
            } else {
                cur = next;
            }
        }
        if (cur.trim()) out.push(cur.trimEnd());
    }
    return out.length ? out : [''];
}

// Advance width of a string in font units, including kerning and tracking.
function measureUnits(font, str, trackingUnits) {
    let w = 0;
    const glyphs = font.stringToGlyphs(str);
    for (let i = 0; i < glyphs.length; i++) {
        w += glyphs[i].advanceWidth || 0;
        if (i < glyphs.length - 1) w += font.getKerningValue(glyphs[i], glyphs[i + 1]);
        w += trackingUnits;
    }
    return w;
}

// Extracting glyph outlines is by far the costliest step, and scrubbing the
// timeline re-renders every cell while text and typography stay fixed — only t
// changes. Memoizing on the inputs that actually affect layout turns a scrub
// frame from tens of milliseconds into string building.
//
// Returned layouts are treated as immutable by every consumer: splitLayout
// reads them and builds new element objects, and buildBlocks stores its state
// on the block, not the layout.
const layoutCache = new Map();
const LAYOUT_CACHE_MAX = 240;

export function typeset(text, type, W, H) {
    const key = `${W}|${H}|${type.fontId}|${type.size}|${type.letterSpacing}|${type.lineHeight}|` +
                `${type.case}|${type.align}|${type.x}|${type.y}|${type.margin}|${type.wrap}|${type.fit}|${text}`;
    const hit = layoutCache.get(key);
    if (hit) return hit;

    const out = typesetUncached(text, type, W, H);
    if (layoutCache.size >= LAYOUT_CACHE_MAX) {
        // Insertion-ordered, so the oldest key is first — good enough as an LRU
        // approximation for a cache this small.
        layoutCache.delete(layoutCache.keys().next().value);
    }
    layoutCache.set(key, out);
    return out;
}

/**
 * @returns {{
 *   glyphs: Array<{char,d,x,y,advance,bbox,lineIndex,wordIndex,index}>,
 *   lines: Array<{glyphs:number[], width, baselineY, x0}>,
 *   bbox: {x,y,w,h}, fontSize: number, ok: boolean
 * }}
 */
function typesetUncached(text, type, W, H) {
    const font = getFace(type.fontId);
    const empty = { glyphs: [], lines: [], bbox: { x: W / 2, y: H / 2, w: 0, h: 0 }, fontSize: 0, ok: false };
    if (!font) return empty;

    const upm = font.unitsPerEm;
    const cased = applyCase(text, type.case);
    let rawLines = cased.split('\n');

    // Target size, expressed as a fraction of canvas height.
    let fontSize = Math.max(4, type.size * H);
    const trackingUnitsFor = fs => type.letterSpacing * upm; // letterSpacing is in em

    const measureAt = fs => str => (measureUnits(font, str, trackingUnitsFor(fs)) * fs) / upm;

    const margin = type.margin ?? 0.08;
    const maxWidth = W * (1 - margin * 2);
    const maxHeight = H * (1 - margin * 2);

    // Shrink to fit: long strings would otherwise blow past the frame and make
    // every variation in the generation look broken.
    //
    // Wrapping and scaling are interdependent — wrapping at the requested size
    // and then shrinking yields far more lines than necessary, and text much
    // smaller than it needs to be. Iterate until the two agree.
    if (type.fit !== 'none') {
        for (let pass = 0; pass < 4; pass++) {
            const lines = type.wrap
                ? wrapLines(cased.split('\n'), measureAt(fontSize), maxWidth)
                : cased.split('\n');

            let widest = 0;
            for (const l of lines) widest = Math.max(widest, measureAt(fontSize)(l));
            const blockH = lines.length * fontSize * type.lineHeight;

            const sw = widest > maxWidth && widest > 0 ? maxWidth / widest : 1;
            const sh = blockH > maxHeight && blockH > 0 ? maxHeight / blockH : 1;
            const s = Math.min(sw, sh);

            rawLines = lines;
            if (s > 0.999) break;      // fits
            fontSize *= s;
        }
    } else if (type.wrap) {
        rawLines = wrapLines(cased.split('\n'), measureAt(fontSize), maxWidth);
    }

    const scale = fontSize / upm;
    const tracking = trackingUnitsFor(fontSize) * scale;

    // Vertical metrics. Baselines are laid out from the block's visual centre so
    // rotation and the anchor point behave predictably.
    const lineStep = fontSize * type.lineHeight;
    const ascent = (font.ascender / upm) * fontSize;
    const descent = (font.descender / upm) * fontSize; // negative
    const blockH = (rawLines.length - 1) * lineStep + (ascent - descent);
    const anchorX = type.x * W;
    const anchorY = type.y * H;
    const firstBaseline = anchorY - blockH / 2 + ascent;

    const glyphs = [];
    const lines = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // Measure pass — line widths must all be known before alignment, so that
    // left/right ragged edges align against the block box rather than each other.
    const measured = rawLines.map(line => {
        const otGlyphs = font.stringToGlyphs(line);
        let w = 0;
        for (let i = 0; i < otGlyphs.length; i++) {
            w += (otGlyphs[i].advanceWidth || 0) * scale;
            if (i < otGlyphs.length - 1) w += font.getKerningValue(otGlyphs[i], otGlyphs[i + 1]) * scale;
            w += tracking;
        }
        if (otGlyphs.length) w -= tracking; // no tracking after the last glyph
        return { otGlyphs, width: w };
    });
    const blockW = Math.max(0, ...measured.map(m => m.width));
    const blockLeft = anchorX - blockW / 2;

    rawLines.forEach((line, li) => {
        const { otGlyphs, width: lineW } = measured[li];

        let x0;
        if (type.align === 'left')       x0 = blockLeft;
        else if (type.align === 'right') x0 = blockLeft + blockW - lineW;
        else                             x0 = blockLeft + (blockW - lineW) / 2;

        const baselineY = firstBaseline + li * lineStep;
        const lineGlyphIdx = [];
        let pen = x0;
        let wordIndex = 0;

        for (let i = 0; i < otGlyphs.length; i++) {
            const g = otGlyphs[i];
            const char = line[i] ?? '';
            const isSpace = /\s/.test(char);

            if (!isSpace) {
                const path = g.getPath(pen, baselineY, fontSize);
                const d = path.toPathData(2);
                if (d) {
                    const bb = path.getBoundingBox();
                    const bbox = { x: bb.x1, y: bb.y1, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1 };
                    glyphs.push({
                        char, d, x: pen, y: baselineY,
                        advance: (g.advanceWidth || 0) * scale,
                        bbox, lineIndex: li, wordIndex, index: glyphs.length
                    });
                    lineGlyphIdx.push(glyphs.length - 1);
                    minX = Math.min(minX, bbox.x); minY = Math.min(minY, bbox.y);
                    maxX = Math.max(maxX, bbox.x + bbox.w); maxY = Math.max(maxY, bbox.y + bbox.h);
                }
            } else {
                wordIndex++;
            }

            pen += (g.advanceWidth || 0) * scale;
            if (i < otGlyphs.length - 1) pen += font.getKerningValue(g, otGlyphs[i + 1]) * scale;
            pen += tracking;
        }

        lines.push({ glyphs: lineGlyphIdx, width: lineW, baselineY, x0 });
    });

    if (!glyphs.length) return { ...empty, fontSize };

    return {
        glyphs, lines,
        bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        fontSize,
        ok: true
    };
}

/**
 * Splits a glyph into its disjoint SOLID PARTS, keeping counters attached to
 * the contour they punch through.
 *
 * A counter is only a hole because it shares a path with its outer contour —
 * the nonzero fill rule relies on the two having opposite winding. Emitting
 * contours as separate <path> elements turns each counter into its own filled
 * shape drawn on top of the letter, so O, B, 8, e, a and friends come out
 * solid. Grouping by containment keeps the holes and still yields genuinely
 * separate pieces: 'i' gives dot + stem, '%' gives three parts, 'O' gives one.
 */
export function splitGlyphParts(d) {
    const contours = splitContours(d);
    if (contours.length <= 1) return contours;

    const boxes = contours.map(pathBBox);
    const area = b => Math.max(1e-6, b.w * b.h);
    const contains = (a, b) => {
        const t = 0.5; // tolerance in user units, for touching extrema
        return a.x - t <= b.x && a.y - t <= b.y &&
               a.x + a.w + t >= b.x + b.w && a.y + a.h + t >= b.y + b.h;
    };

    // Parent = smallest box that strictly contains this one.
    const parent = contours.map((_, i) => {
        let best = -1;
        for (let j = 0; j < contours.length; j++) {
            if (i === j || !contains(boxes[j], boxes[i]) || area(boxes[j]) <= area(boxes[i])) continue;
            if (best === -1 || area(boxes[j]) < area(boxes[best])) best = j;
        }
        return best;
    });

    const rootOf = i => { let r = i, guard = 0; while (parent[r] !== -1 && guard++ < 16) r = parent[r]; return r; };

    const groups = new Map();
    contours.forEach((c, i) => {
        const r = rootOf(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(c);
    });

    // Root contour first so the outer shape leads each combined path.
    return [...groups.entries()].map(([r, list]) => {
        const rest = list.filter(c => c !== contours[r]);
        return [contours[r], ...rest].join(' ');
    });
}

// Splits SVG path data into its raw subpaths (one per contour).
export function splitContours(d) {
    const parts = [];
    const re = /M[^M]*/gi;
    let m;
    while ((m = re.exec(d)) !== null) parts.push(m[0].trim());
    return parts.length ? parts : [d];
}

// Rough area of a path's bounding box, for ordering contours largest-first.
export function pathBBox(d) {
    const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
    if (!nums) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Path data here is emitted by opentype as M/L/C/Q/Z with x,y pairs only.
    const cmds = d.match(/[MLCQZ][^MLCQZ]*/gi) || [];
    for (const c of cmds) {
        const vals = (c.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
        for (let i = 0; i + 1 < vals.length; i += 2) {
            minX = Math.min(minX, vals[i]);   maxX = Math.max(maxX, vals[i]);
            minY = Math.min(minY, vals[i+1]); maxY = Math.max(maxY, vals[i+1]);
        }
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
