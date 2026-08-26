// Splitting — turns a typeset layout into the list of independently animated
// elements. This is the heart of the A24 look: the glyphs are cut into bands
// that each arrive separately.
//
// Band modes clip a shared copy of the full text; structural modes (glyph,
// word, line, contour) carve the geometry itself.

import { seededRand } from './genome.js';
import { splitGlyphParts, pathBBox } from './typeset.js';

/**
 * @returns Array<{
 *   id: string,
 *   paths: string[],            // path data for this element
 *   clip: null | {type:'rect', x,y,w,h, angle, cx, cy},
 *   centroid: {x, y},
 *   order: number,              // 0..1, drives stagger delay
 *   index: number
 * }>
 */
// Above this, nine live previews start dropping frames. Fine-grained modes
// degrade to a coarser one rather than rendering thousands of animated groups.
const MAX_ELEMENTS = 140;

// Splitting is deterministic given a layout and the split/stagger parameters,
// so it is cached alongside the memoized layouts for the same reason: scrubbing
// re-derives it every frame while nothing it depends on has changed. Keyed off
// the layout object itself, so cache entries die with their layout.
const splitCache = new WeakMap();

export function splitLayout(layout, split, stagger, maxElements = MAX_ELEMENTS) {
    if (!layout.ok || !layout.glyphs.length) return [];

    const key = `${split.mode}|${split.count}|${split.angle}|${split.jitter}|${split.seed}|${split.gap}|` +
                `${stagger.order}|${stagger.jitter}|${maxElements}`;
    let perLayout = splitCache.get(layout);
    if (perLayout) {
        const hit = perLayout.get(key);
        if (hit) return hit;
    } else {
        perLayout = new Map();
        splitCache.set(layout, perLayout);
    }
    const out = splitUncached(layout, split, stagger, maxElements);
    perLayout.set(key, out);
    return out;
}

function splitUncached(layout, split, stagger, maxElements) {
    const bb = layout.bbox;
    const all = layout.glyphs.map(g => g.d);
    const seed = split.seed | 0;

    let mode = split.mode;
    const n = layout.glyphs.length;
    if (mode === 'contour' && n > maxElements / 2) mode = 'glyph';
    if ((mode === 'glyph-bands' || mode === 'glyph-bands-v') && n > maxElements) mode = 'glyph';
    if (mode === 'glyph' && n > maxElements) mode = 'word';

    let elements;
    switch (mode) {
        case 'bands-h':  elements = bandElements(all, bb, split, false); break;
        case 'bands-v':  elements = bandElements(all, bb, split, true);  break;
        case 'diagonal': elements = bandElements(all, bb, split, false, split.angle); break;
        case 'glyph-bands':  elements = glyphBandElements(layout, split, false, maxElements); break;
        case 'glyph-bands-v': elements = glyphBandElements(layout, split, true, maxElements); break;
        case 'glyph':    elements = glyphElements(layout); break;
        case 'word':     elements = groupElements(layout, g => `${g.lineIndex}:${g.wordIndex}`); break;
        case 'line':     elements = groupElements(layout, g => `${g.lineIndex}`); break;
        case 'contour':  elements = contourElements(layout).slice(0, maxElements); break;
        case 'none':
        default:
            elements = [{ paths: all, clip: null, centroid: { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } }];
    }

    elements.forEach((el, i) => {
        el.index = i;
        el.id = `e${i}`;
    });

    assignOrder(elements, bb, stagger, seed);
    return elements;
}

// ─── Band modes ───────────────────────────────────────────────────────────

// Cuts one bounding box into n clip bands. Used both for the whole word and,
// via glyphBandElements, for each glyph on its own.
function bandElements(allPaths, bb, split, vertical, angle = 0, n = null, seedBase = null) {
    n = Math.max(1, Math.round(n ?? split.count));
    const seed = seedBase ?? split.seed;
    const els = [];
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;

    // Bands are cut across the bbox's diagonal extent so a rotated band set
    // still covers every corner of the text.
    const diag = Math.hypot(bb.w, bb.h) * 1.2;
    const spanStart = (vertical ? cx : cy) - diag / 2;
    const step = diag / n;
    const gap = (split.gap || 0) * step;

    for (let i = 0; i < n; i++) {
        // Jitter perturbs band boundaries so the cuts don't read as a regular grid.
        const j0 = (seededRand(seed + i * 7) - 0.5) * split.jitter * step;
        const j1 = (seededRand(seed + i * 7 + 3) - 0.5) * split.jitter * step;
        let a = spanStart + i * step + (i === 0 ? 0 : j0);
        let b = spanStart + (i + 1) * step + (i === n - 1 ? 0 : j1);
        if (b - a < 1) b = a + 1;
        a += gap / 2; b -= gap / 2;

        const clip = vertical
            ? { type: 'rect', x: a, y: cy - diag, w: b - a, h: diag * 2, angle, cx, cy }
            : { type: 'rect', x: cx - diag, y: a, w: diag * 2, h: b - a, angle, cx, cy };

        const mid = (a + b) / 2;
        els.push({
            paths: allPaths,
            clip,
            centroid: vertical ? { x: mid, y: cy } : { x: cx, y: mid },
        });
    }
    return els;
}

// Bands each glyph independently rather than banding the whole word. This is
// what lets parts of a single letterform arrive separately — a horizontal cut
// at crossbar height on a 't' carries the crossbar in on its own.
//
// Outline fonts can't give true stroke separation (the stem and crossbar of a
// 't' are one closed contour), so this slices geometrically instead. Bands are
// cut across each glyph's own bounding box, so the cut heights follow the
// letterform rather than the line.
function glyphBandElements(layout, split, vertical, maxElements = MAX_ELEMENTS) {
    const perGlyph = Math.max(1, Math.round(split.count));
    // Keep the total animated group count bounded on long strings.
    const budget = Math.max(1, Math.floor(maxElements / layout.glyphs.length));
    const n = Math.min(perGlyph, budget);

    const els = [];
    layout.glyphs.forEach((g, gi) => {
        // Seed per glyph so neighbouring letters don't cut at identical heights.
        const bands = bandElements([g.d], g.bbox, split, vertical, split.angle || 0, n, split.seed + gi * 977);
        for (const b of bands) els.push(b);
    });
    return els;
}

// ─── Structural modes ─────────────────────────────────────────────────────

function glyphElements(layout) {
    return layout.glyphs.map(g => ({
        paths: [g.d],
        clip: null,
        centroid: { x: g.bbox.x + g.bbox.w / 2, y: g.bbox.y + g.bbox.h / 2 },
    }));
}

function groupElements(layout, keyFn) {
    const groups = new Map();
    for (const g of layout.glyphs) {
        const k = keyFn(g);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(g);
    }
    return [...groups.values()].map(gs => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const g of gs) {
            minX = Math.min(minX, g.bbox.x); maxX = Math.max(maxX, g.bbox.x + g.bbox.w);
            minY = Math.min(minY, g.bbox.y); maxY = Math.max(maxY, g.bbox.y + g.bbox.h);
        }
        return {
            paths: gs.map(g => g.d),
            clip: null,
            centroid: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        };
    });
}

function contourElements(layout) {
    const els = [];
    for (const g of layout.glyphs) {
        // Solid parts, not raw contours — see splitGlyphParts: emitting counters
        // as their own paths fills in the holes of O, B, 8, e and a.
        for (const d of splitGlyphParts(g.d)) {
            const bb = pathBBox(d);
            els.push({
                paths: [d],
                clip: null,
                centroid: { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 },
            });
        }
    }
    return els;
}

// ─── Stagger ordering ─────────────────────────────────────────────────────

// Assigns each element a 0..1 position that the renderer turns into a delay.
function assignOrder(els, bb, stagger, seed) {
    if (!els.length) return;
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    const norm = (v, lo, hi) => (hi - lo < 1e-6 ? 0 : (v - lo) / (hi - lo));

    const raw = els.map((el, i) => {
        switch (stagger.order) {
            case 'ltr':    return norm(el.centroid.x, bb.x, bb.x + bb.w);
            case 'rtl':    return 1 - norm(el.centroid.x, bb.x, bb.x + bb.w);
            case 'ttb':    return norm(el.centroid.y, bb.y, bb.y + bb.h);
            case 'btt':    return 1 - norm(el.centroid.y, bb.y, bb.y + bb.h);
            case 'center': return Math.hypot(el.centroid.x - cx, el.centroid.y - cy) / (Math.hypot(bb.w, bb.h) / 2 || 1);
            case 'edges':  return 1 - Math.hypot(el.centroid.x - cx, el.centroid.y - cy) / (Math.hypot(bb.w, bb.h) / 2 || 1);
            case 'random': return seededRand(seed + i * 31);
            default:       return i / Math.max(1, els.length - 1);
        }
    });

    const lo = Math.min(...raw), hi = Math.max(...raw);
    els.forEach((el, i) => {
        let o = hi - lo < 1e-6 ? 0 : (raw[i] - lo) / (hi - lo);
        if (stagger.jitter) o += (seededRand(seed + i * 17 + 5) - 0.5) * stagger.jitter;
        el.order = Math.max(0, Math.min(1, o));
    });
}

// ─── Per-element entrance direction ───────────────────────────────────────

// Returns the unit vector an element travels in from, in canvas space.
export function elementDirection(el, motion, bb, seed) {
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    let deg;
    switch (motion.directionMode) {
        case 'uniform':   deg = motion.baseAngle; break;
        case 'alternate': deg = motion.baseAngle + (el.index % 2 ? 180 : 0); break;
        case 'random':    deg = seededRand(seed + el.index * 13) * 360; break;
        case 'outward':   deg = Math.atan2(el.centroid.y - cy, el.centroid.x - cx) * 180 / Math.PI; break;
        case 'converge':  deg = Math.atan2(el.centroid.y - cy, el.centroid.x - cx) * 180 / Math.PI + 180; break;
        default:          deg = motion.baseAngle;
    }
    const r = deg * Math.PI / 180;
    return { x: Math.cos(r), y: Math.sin(r) };
}
