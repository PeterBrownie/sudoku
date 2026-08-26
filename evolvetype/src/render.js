// Renderer — the one builder, in two modes.
//
//   mode 'animated': emits CSS @keyframes; the SVG animates itself.
//   mode 'frame':    evaluates every curve in JS at time t and bakes static
//                     attributes, so frames can be rasterized for PNG export.
//
// Both modes read the same timeline functions in anim.js. If they ever diverge,
// exported sequences stop matching the preview.

import { ASPECTS, paletteColor, deepClone, GENOME_VERSION } from './genome.js';
import { typeset } from './typeset.js';
import { splitLayout } from './split.js';
import {
    fromState, stateAt, transformString, transformCSS, elementTiming, cycleDuration,
    progressAt, easingCSS, channelOffset, channelColors, easeAt,
    opacityEnvelope, sampleEnvelope,
} from './anim.js';
import {
    buildTextFilter, buildBackground, buildGrainOverlay, buildScanlines,
    buildWipe, buildWipeFrame, buildDecor, DECOR_MARGIN,
} from './effects.js';

export function canvasSize(genome) {
    return ASPECTS[genome.aspect] || ASPECTS['16:9'];
}

/**
 * Builds the text blocks and stacks them as a unit.
 *
 * Each block is typeset independently around the same anchor, then the pair is
 * offset vertically so they sit with a gap and the combined group stays centred
 * on the anchor. Offsetting afterwards (rather than re-typesetting at computed
 * baselines) keeps every glyph path, clip rect and motion origin in one
 * coordinate space — the block's own — so a single translate on the wrapper
 * moves the geometry, its clips and its animation origins together.
 */
export function buildBlocks(genome, text, secondaryText, W, H) {
    const blocks = [];

    // When a frame or corner ticks are drawn, the type respects the same margin
    // (plus breathing room) so it never collides with or crowds the border.
    const d = genome.decor || {};
    const needed = (d.frame || d.ticks) ? DECOR_MARGIN + 0.035 : 0;
    const baseType = needed > (genome.type.margin || 0)
        ? { ...genome.type, margin: needed }
        : genome.type;

    const mainLayout = typeset(text, baseType, W, H);
    blocks.push({
        key: 'm',
        layout: mainLayout,
        split: genome.split,
        offset: 0,
        paletteIdx: genome.type.paletteIdx,
        opacity: 1,
        dy: 0,
    });

    const sec = genome.secondary || {};
    const hasSecondary = sec.enabled && secondaryText && secondaryText.trim();
    if (hasSecondary) {
        // Inherit the main block's typography, then override.
        const secType = {
            ...baseType,
            fontId: sec.fontId || genome.type.fontId,
            size: sec.size,
            letterSpacing: sec.letterSpacing,
            case: sec.case,
            align: sec.align,
            paletteIdx: sec.paletteIdx,
        };
        const secLayout = typeset(secondaryText, secType, W, H);
        blocks.push({
            key: 's',
            layout: secLayout,
            split: { ...genome.split, mode: sec.splitMode || genome.split.mode, seed: genome.split.seed + 5171 },
            offset: sec.delayOffset || 0,
            paletteIdx: sec.paletteIdx,
            opacity: sec.opacity ?? 1,
            dy: 0,
        });

        if (mainLayout.ok && secLayout.ok) {
            const gap = (sec.gap || 0) * H;
            const h1 = mainLayout.bbox.h, h2 = secLayout.bbox.h;
            const total = h1 + gap + h2;
            const anchorY = genome.type.y * H;
            const above = sec.position === 'above';

            const topH = above ? h2 : h1;
            const botH = above ? h1 : h2;
            const topCentre = anchorY - total / 2 + topH / 2;
            const botCentre = anchorY + total / 2 - botH / 2;

            const mainCy = mainLayout.bbox.y + h1 / 2;
            const secCy = secLayout.bbox.y + h2 / 2;
            blocks[0].dy = (above ? botCentre : topCentre) - mainCy;
            blocks[1].dy = (above ? topCentre : botCentre) - secCy;
        }
    }

    for (const b of blocks) {
        // The secondary line is small type; subdividing it as finely as the
        // title costs a lot of animated groups for detail nobody can see.
        b.elements = splitLayout(b.layout, b.split, genome.stagger, b.key === 's' ? 48 : 140);
        b.count = b.elements.length;
    }
    return blocks;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {object} genome
 * @param {string} text
 * @param {{mode?:'animated'|'frame', t?:number, uid?:string, outW?:number, outH?:number, embedMeta?:boolean}} opts
 * @returns {string} SVG source
 */
export function genomeToSVG(genome, text, opts = {}) {
    const mode = opts.mode || 'animated';
    const uid = opts.uid || 'v';
    const { w: W, h: H } = canvasSize(genome);
    const outW = opts.outW || W;
    const outH = opts.outH || H;

    const defs = [];
    const body = [];

    body.push(buildBackground(genome, W, H, uid, defs));

    const blocks = buildBlocks(genome, text, opts.secondaryText || '', W, H);
    const layout = blocks[0].layout;
    const cycle = cycleDuration(genome, blocks.map(b => ({ count: b.count, offset: b.offset })));
    const t = opts.t ?? 0;

    const live = blocks.filter(b => b.layout.ok && b.count);
    if (live.length) {
        const { defs: fDefs, attr: fAttr } = buildTextFilter(genome, W, H, uid);
        defs.push(...fDefs);

        const wipeAttr = mode === 'animated'
            ? buildWipe(genome, W, H, uid, defs, cycle)
            : buildWipeFrame(genome, W, H, uid, defs, wipeProgress(genome, t, cycle));

        const css = [];
        const ctx = { uid, defs, symbols: new Map(), dashDef: '' };
        const blockGroups = [];

        for (const b of live) {
            const bUid = `${uid}${b.key}`;
            const groups = b.elements.map(el =>
                renderElement(el, genome, b, W, H, bUid, mode, t, cycle, defs, css, ctx));
            const shift = Math.abs(b.dy) > 0.01 ? ` transform="translate(0 ${b.dy.toFixed(2)})"` : '';
            const op = b.opacity < 0.999 ? ` opacity="${b.opacity.toFixed(3)}"` : '';
            blockGroups.push(`<g class="block-${b.key}"${shift}${op}>${groups.join('')}</g>`);
        }

        const rot = genome.type.rotate
            ? ` transform="rotate(${genome.type.rotate.toFixed(2)} ${(W / 2).toFixed(1)} ${(H / 2).toFixed(1)})"`
            : '';

        if (mode === 'animated' && css.length) {
            defs.push(`<style>${baseCSS(uid, cycle, genome)}${css.join('')}</style>`);
        }

        body.push(
            `<g class="type-g"${rot}${fAttr}${wipeAttr} style="isolation:isolate">${blockGroups.join('')}</g>`
        );
    }

    let union = null;
    for (const b of blocks) {
        if (!b.layout.ok) continue;
        const x0 = b.layout.bbox.x, y0 = b.layout.bbox.y + b.dy;
        const x1 = x0 + b.layout.bbox.w, y1 = y0 + b.layout.bbox.h;
        union = union
            ? { x: Math.min(union.x, x0), y: Math.min(union.y, y0),
                w: Math.max(union.x + union.w, x1) - Math.min(union.x, x0),
                h: Math.max(union.y + union.h, y1) - Math.min(union.y, y0) }
            : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    body.push(buildDecor(genome, layout, W, H, uid, union));

    // Full-frame overlays sit above everything.
    const grainEffect = (genome.effects || []).find(e => e.type === 'grain');
    const totalGrain = (genome.background.grain || 0) + (grainEffect ? grainEffect.amount : 0);
    body.push(buildGrainOverlay(genome, W, H, uid, defs, totalGrain, grainEffect ? grainEffect.scale : 1));

    const scan = (genome.effects || []).find(e => e.type === 'scanlines');
    if (scan) body.push(buildScanlines(genome, W, H, uid, defs, scan));

    const meta = opts.embedMeta ? metaBlock(genome, text, opts.secondaryText || '') : '';
    const defsBlock = defs.length ? `<defs>${defs.join('')}</defs>` : '';
    const ns = opts.embedMeta ? ' xmlns:evolvetype="https://peterbrown.space/evolvetype"' : '';

    return `<svg xmlns="http://www.w3.org/2000/svg"${ns} viewBox="0 0 ${W} ${H}" width="${outW}" height="${outH}" preserveAspectRatio="xMidYMid slice">` +
        `<title>${esc(opts.secondaryText ? `${text} — ${opts.secondaryText}` : text)}</title><desc>${esc(genome.name || 'evolveType animation')}</desc>` +
        meta + defsBlock + body.join('') + `</svg>`;
}

// ─── Elements ─────────────────────────────────────────────────────────────

function renderElement(el, genome, block, W, H, uid, mode, t, cycle, defs, css, ctx) {
    const clipId = el.clip ? `${uid}c${el.index}` : null;
    if (clipId) {
        const c = el.clip;
        const rot = c.angle ? ` transform="rotate(${c.angle.toFixed(2)} ${c.cx.toFixed(2)} ${c.cy.toFixed(2)})"` : '';
        defs.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}"${rot}/></clipPath>`);
    }

    const trails = (genome.effects || []).find(e => e.type === 'trails');
    const copies = [];

    // Trail copies are the same element replayed at a lag, drawn underneath.
    if (trails) {
        for (let k = trails.count; k >= 1; k--) {
            const lag = k * trails.spacing * cycle;
            const alpha = Math.pow(trails.falloff, k);
            copies.push(elementBody(el, genome, block, W, H, uid, mode, t, cycle, clipId, css, lag, alpha, `t${k}`, ctx));
        }
    }
    copies.push(elementBody(el, genome, block, W, H, uid, mode, t, cycle, clipId, css, 0, 1, '', ctx));

    return copies.join('');
}

function elementBody(el, genome, block, W, H, uid, mode, t, cycle, clipId, css, lag, alpha, suffix, ctx) {
    const { layout, count, offset } = block;
    const bb = layout.bbox;
    const from = fromState(el, genome, bb, W);
    const { delay, duration } = elementTiming(el, genome, count, offset);
    const gid = `${uid}e${el.index}${suffix}`;
    const travel = (genome.split.clipMode || 'travel') === 'travel';

    const chColors = channelColors(genome);
    const useSplit = genome.rgbSplit.enabled;
    const chIdxs = useSplit ? [0, 1, 2] : [1];

    // Where the clip sits relative to the motion transform decides the effect:
    //   travel — clip is a descendant of the transform, so the band carries its
    //            slice of the glyph with it and the word reassembles (A24 look).
    //   fixed  — clip is an ancestor, so the text slides through a stationary
    //            slat window and is revealed rather than assembled.
    const clipInside = travel && clipId;
    const clipOutside = !travel && clipId;

    const channels = chIdxs.map(ci => {
        const color = chColors[ci] || paletteColor(genome.palette, block.paletteIdx);
        const blend = useSplit && genome.rgbSplit.blend !== 'normal'
            ? `mix-blend-mode:${genome.rgbSplit.blend};` : '';
        const inner = pathsMarkup(el, genome, block, color, mode, t, cycle, lag, W, ctx);
        const content = clipInside ? `<g clip-path="url(#${clipId})">${inner}</g>` : inner;

        if (mode === 'frame') {
            const p = progressAt(el, genome, count, cycleTime(t - lag, cycle, genome), offset);
            const off = useSplit ? channelOffset(genome, ci, p, W) : { x: 0, y: 0 };
            const tr = (off.x || off.y) ? ` transform="translate(${off.x.toFixed(2)} ${off.y.toFixed(2)})"` : '';
            return `<g style="${blend}"${tr}>${content}</g>`;
        }

        const chClass = `${gid}h${ci}`;
        if (useSplit) emitChannelKeyframes(css, chClass, genome, ci, delay, duration, cycle, W);
        return `<g class="${useSplit ? chClass : ''}" style="${blend}">${content}</g>`;
    }).join('');

    const envelope = opacityEnvelope(el, genome);

    let motionGroup;
    if (mode === 'frame') {
        const p = progressAt(el, genome, count, cycleTime(t - lag, cycle, genome), offset);
        const st = stateAt(from, p);
        const tr = transformString(st);
        const blurAttr = st.blur > 0.05 ? `filter:blur(${st.blur.toFixed(2)}px);` : '';
        // The envelope replaces the linear opacity ramp when flicker is active.
        const baseOp = envelope ? sampleEnvelope(envelope, rawProgress(el, genome, count, cycleTime(t - lag, cycle, genome), offset)) : st.opacity;
        const op = (baseOp * alpha).toFixed(3);
        motionGroup = `<g${tr ? ` transform="${tr}"` : ''} opacity="${op}"${blurAttr ? ` style="${blurAttr}"` : ''}>${channels}</g>`;
    } else {
        emitElementKeyframes(css, gid, genome, from, delay, duration, cycle, alpha, envelope);
        motionGroup = `<g id="${gid}" class="el">${channels}</g>`;
    }

    return clipOutside ? `<g clip-path="url(#${clipId})">${motionGroup}</g>` : motionGroup;
}

// Band modes clip a shared copy of the whole word, so the same path data would
// otherwise be repeated per band x per channel x per trail copy — that reached
// 1.1MB on dense mutants. Each distinct path set is emitted once into <defs>
// and referenced by <use>, which also lets the browser share the rendered
// geometry. Fill and stroke are set on the <use> so they inherit inward.
function symbolFor(el, ctx) {
    const key = el.paths.join('|');
    let id = ctx.symbols.get(key);
    if (!id) {
        id = `${ctx.uid}s${ctx.symbols.size}`;
        ctx.symbols.set(key, id);
        const inner = el.paths.map(d => `<path d="${d}"${ctx.dashDef}/>`).join('');
        ctx.defs.push(`<g id="${id}">${inner}</g>`);
    }
    return id;
}

function pathsMarkup(el, genome, block, color, mode, t, cycle, lag, W, ctx) {
    const { layout, count, offset } = block;
    const ty = genome.type;
    const outline = (genome.effects || []).find(e => e.type === 'outline');
    const drawOn = genome.motion.preset === 'drawOn';

    let fill = color;
    let stroke = 'none';
    let strokeW = 0;
    let fillOpacity = '';

    if (ty.weightBoost > 0) { stroke = color; strokeW = ty.weightBoost * layout.fontSize; }
    if (outline) {
        stroke = paletteColor(genome.palette, outline.paletteIdx);
        strokeW = outline.width;
        if (outline.fillAlpha < 1) fillOpacity = ` fill-opacity="${outline.fillAlpha.toFixed(3)}"`;
    }
    if (drawOn) {
        stroke = color; fill = 'none';
        strokeW = strokeW || Math.max(1, layout.fontSize * 0.03);
    }

    const strokeAttr = strokeW > 0
        ? ` stroke="${stroke}" stroke-width="${strokeW.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"`
        : '';

    // pathLength/dasharray belong on the <path> itself; stroke-dashoffset is an
    // inherited property, so it can ride on the <use> and animate per element.
    ctx.dashDef = drawOn ? ' pathLength="1" stroke-dasharray="1 1"' : '';
    let dashAttr = '';
    if (drawOn && mode === 'frame') {
        const p = progressAt(el, genome, count, cycleTime(t - lag, cycle, genome), offset);
        dashAttr = ` stroke-dashoffset="${(1 - p).toFixed(4)}"`;
    }

    const id = symbolFor(el, ctx);
    return `<use href="#${id}" fill="${fill}"${fillOpacity}${strokeAttr}${dashAttr}/>`;
}

// Wrap a time into the cycle, honouring the loop mode.
function cycleTime(t, cycle, genome) {
    const loop = genome.timing.loop;
    if (loop === 'once') return Math.max(0, Math.min(cycle, t));
    let x = ((t % cycle) + cycle) % cycle;
    if (loop === 'pingpong') {
        const period = cycle * 2;
        let y = ((t % period) + period) % period;
        x = y > cycle ? period - y : y;
    }
    return x;
}

// ─── CSS emission ─────────────────────────────────────────────────────────

function baseCSS(uid, cycle, genome) {
    const iter = genome.timing.loop === 'once' ? '1' : 'infinite';
    const dir = genome.timing.loop === 'pingpong' ? 'alternate' : 'normal';
    // --seek and --play are set from outside the SVG by the grid, which is how
    // all nine previews stay on one scrubbable clock. A negative animation-delay
    // seeks into the timeline; each cell gets its own value because cycle
    // lengths differ between variations.
    return `.el{transform-box:view-box;transform-origin:0 0;` +
        `animation-duration:${cycle.toFixed(3)}s;animation-iteration-count:${iter};` +
        `animation-direction:${dir};animation-fill-mode:both;animation-timing-function:linear;` +
        `animation-delay:var(--seek,0s);animation-play-state:var(--play,running);}`;
}

// Every element shares the cycle as its animation-duration; the delay and the
// element's own duration are baked into keyframe percentages. That keeps all
// elements on one clock, so the loop can never tear.
function emitElementKeyframes(css, gid, genome, from, delay, duration, cycle, alpha, envelope) {
    const speed = genome.timing.speed || 1;
    const s = clampPct((delay / speed) / cycle * 100);
    const e = clampPct(((delay + duration) / speed) / cycle * 100);
    const name = `${gid}k`;

    const fromT = transformCSS(from);
    const fromBlur = from.blur > 0.05 ? `filter:blur(${from.blur.toFixed(2)}px);` : 'filter:none;';
    const restBlur = 'filter:none;';
    const ease = easingCSS(genome.motion.easing);
    const a = alpha.toFixed(3);
    const fromOp = (from.opacity * alpha).toFixed(3);

    // stroke-dashoffset is an inherited property, so animating it on the group
    // cascades to the <use> children and draws the outlines on.
    const dashFrom = genome.motion.preset === 'drawOn' ? 'stroke-dashoffset:1;' : '';
    const dashTo = genome.motion.preset === 'drawOn' ? 'stroke-dashoffset:0;' : '';

    const restBlock = `transform:none;opacity:${a};${restBlur}${dashTo}`;

    if (envelope) {
        // Flicker needs many stops, and CSS interpolates linearly between them.
        // Frame mode samples the same envelope linearly, so the two agree.
        //
        // When the entrance has no transform to interpolate (powerOn, where the
        // light itself is the whole effect), the envelope's own control points
        // are sufficient and each stop is a bare opacity — emitting a full
        // transform block per stop per element ran to megabytes.
        const still = !from.tx && !from.ty && from.sx === 1 && from.sy === 1
            && !from.rot && from.blur <= 0.05 && genome.motion.preset !== 'drawOn';

        const marks = new Set(envelope.map(([p]) => p));
        if (!still) for (let i = 0; i <= 8; i++) marks.add(i / 8);
        const ps = [...marks].sort((x, y) => x - y).filter(p => p > 0);

        const first = still ? `opacity:${(sampleEnvelope(envelope, 0) * alpha).toFixed(3)};` : blockAt(0);
        const stops = [`0%{${first}animation-timing-function:linear;}`];
        if (s > 0.01) stops.push(`${s.toFixed(3)}%{${first}animation-timing-function:linear;}`);
        for (const p of ps) {
            const pct = clampPct(s + (e - s) * p);
            const block = still ? `opacity:${(sampleEnvelope(envelope, p) * alpha).toFixed(3)};` : blockAt(p);
            stops.push(`${pct.toFixed(3)}%{${block}animation-timing-function:linear;}`);
        }
        if (e < 99.99) stops.push(`100%{${still ? `opacity:${a};` : restBlock}}`);

        css.push(`@keyframes ${name}{${stops.join('')}}`);
        css.push(`#${gid}{animation-name:${name};}`);
        return;
    }

    const startBlock = `transform:${fromT};opacity:${fromOp};${fromBlur}${dashFrom}animation-timing-function:${ease};`;
    const stops = [`0%{${startBlock}}`];
    if (s > 0.01) stops.push(`${s.toFixed(3)}%{${startBlock}}`);
    stops.push(`${e.toFixed(3)}%{${restBlock}}`);
    if (e < 99.99) stops.push(`100%{${restBlock}}`);

    css.push(`@keyframes ${name}{${stops.join('')}}`);
    css.push(`#${gid}{animation-name:${name};}`);

    function blockAt(p) {
        const st = stateAt(from, easeAt(genome.motion.easing, p));
        const op = sampleEnvelope(envelope, p) * alpha;
        const blur = st.blur > 0.05 ? `filter:blur(${st.blur.toFixed(2)}px);` : 'filter:none;';
        const dash = genome.motion.preset === 'drawOn' ? `stroke-dashoffset:${(1 - p).toFixed(4)};` : '';
        return `transform:${transformCSS(st)};opacity:${op.toFixed(3)};${blur}${dash}`;
    }
}

// Un-eased 0..1 position of an element within its own entrance window. The
// flicker envelope is authored against raw time, not eased progress, so its
// blink rhythm stays intact whatever easing the motion uses.
function rawProgress(el, genome, count, t, offset = 0) {
    const { delay, duration } = elementTiming(el, genome, count, offset);
    const speed = genome.timing.speed || 1;
    const local = t * speed - delay;
    if (local <= 0) return 0;
    if (local >= duration) return 1;
    return local / duration;
}

function emitChannelKeyframes(css, cls, genome, ci, delay, duration, cycle, W) {
    const rs = genome.rgbSplit;
    const speed = genome.timing.speed || 1;
    const s = clampPct((delay / speed) / cycle * 100);
    const settleT = delay + duration * Math.max(0.01, rs.settleAt);
    const e = clampPct((settleT / speed) / cycle * 100);

    const o0 = channelOffset(genome, ci, 0, W);
    const start = `transform:translate(${o0.x.toFixed(2)}px,${o0.y.toFixed(2)}px);`;
    const rest = rs.converge ? 'transform:translate(0,0);' : start;
    const ease = easingCSS(genome.motion.easing);
    const name = `${cls}k`;

    const stops = [`0%{${start}animation-timing-function:${ease};}`];
    if (s > 0.01) stops.push(`${s.toFixed(3)}%{${start}animation-timing-function:${ease};}`);
    stops.push(`${e.toFixed(3)}%{${rest}}`);
    if (e < 99.99) stops.push(`100%{${rest}}`);

    const iter = genome.timing.loop === 'once' ? '1' : 'infinite';
    const dir = genome.timing.loop === 'pingpong' ? 'alternate' : 'normal';
    css.push(`@keyframes ${name}{${stops.join('')}}`);
    css.push(`.${cls}{transform-box:view-box;transform-origin:0 0;animation:${name} ${cycle.toFixed(3)}s linear ${iter};animation-direction:${dir};animation-fill-mode:both;animation-delay:var(--seek,0s);animation-play-state:var(--play,running);}`);
}

function clampPct(v) { return Math.max(0, Math.min(100, v)); }

function wipeProgress(genome, t, cycle) {
    return cycle > 0 ? ((t % cycle) + cycle) % cycle / cycle : 0;
}

// ─── Metadata round-trip ──────────────────────────────────────────────────

function metaBlock(genome, text, secondaryText) {
    const payload = JSON.stringify({ v: GENOME_VERSION, text, secondaryText, genome });
    const encoded = payload
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<metadata><evolvetype:state>${encoded}</evolvetype:state></metadata>`;
}

export function extractState(svgText) {
    const m = svgText.match(/<evolvetype:state[^>]*>([\s\S]*?)<\/evolvetype:state>/);
    if (!m) return null;
    try {
        const raw = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const parsed = JSON.parse(raw);
        return { text: parsed.text ?? '', secondaryText: parsed.secondaryText ?? '', genome: parsed.genome ?? null };
    } catch { return null; }
}

// Convenience for callers that need the loop length without rendering.
export function genomeCycle(genome, text, secondaryText = '') {
    const { w: W, h: H } = canvasSize(genome);
    const blocks = buildBlocks(genome, text, secondaryText, W, H);
    return cycleDuration(genome, blocks.map(b => ({ count: b.count || 1, offset: b.offset })));
}

export { deepClone };
