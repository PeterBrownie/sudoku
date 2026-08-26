// Animation core — timeline maths shared by both render modes.
//
// The whole tool rests on one contract: every animated quantity is a pure
// function of (element, genome, t). CSS mode emits keyframes from the endpoint
// states; frame mode evaluates the same curves in JS at a given t. Both must
// agree, or exported PNG sequences won't match the live preview.

import { seededRand } from './genome.js';
import { elementDirection } from './split.js';

export const EASING_SPLINES = {
    linear:    null,
    ease:      [0.25, 0.1, 0.25, 1],
    easeIn:    [0.42, 0, 1, 1],
    easeOut:   [0, 0, 0.58, 1],
    easeInOut: [0.42, 0, 0.58, 1],
    backOut:   [0.34, 1.56, 0.64, 1],
    expoOut:   [0.16, 1, 0.3, 1],
    circOut:   [0, 0.55, 0.45, 1],
};

export function easingCSS(name) {
    const s = EASING_SPLINES[name];
    return s ? `cubic-bezier(${s.join(',')})` : 'linear';
}

// Evaluate cubic-bezier(x1,y1,x2,y2) at t. Newton's method on x, then read y —
// matches how browsers compute CSS easing, so JS-baked frames line up with the
// CSS-animated preview.
export function easeAt(name, t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const s = EASING_SPLINES[name];
    if (!s) return t;
    const [x1, y1, x2, y2] = s;
    let u = t;
    for (let i = 0; i < 8; i++) {
        const xu = ((1 - 3 * x2 + 3 * x1) * u * u + (3 * x2 - 6 * x1) * u + 3 * x1) * u - t;
        const dxu = (3 * (1 - 3 * x2 + 3 * x1) * u + 2 * (3 * x2 - 6 * x1)) * u + 3 * x1;
        if (Math.abs(dxu) < 1e-6) break;
        u = Math.max(0, Math.min(1, u - xu / dxu));
    }
    return ((1 - 3 * y2 + 3 * y1) * u * u + (3 * y2 - 6 * y1) * u + 3 * y1) * u;
}

// ─── Per-element timing ───────────────────────────────────────────────────

export function staggerSpan(genome, count) {
    return genome.stagger.amount * Math.max(0, count - 1);
}

// `offset` shifts a whole block later on the shared timeline — that is how the
// secondary block trails the title.
export function elementTiming(el, genome, count, offset = 0) {
    const span = staggerSpan(genome, count);
    const delay = offset + el.order * span;
    // Per-element duration jitter is what makes different parts of the word
    // arrive at visibly different speeds rather than in lockstep.
    const jit = genome.motion.durationJitter || 0;
    const f = 1 + (seededRand(genome.split.seed + el.index * 41) - 0.5) * 2 * jit;
    const duration = Math.max(0.02, genome.motion.duration * f);
    return { delay, duration, span };
}

/**
 * Total loop length, derived rather than authored so mutating duration or
 * stagger can never desync the loop.
 * @param {Array<{count:number, offset:number}>} blocks every text block on the timeline
 */
export function cycleDuration(genome, blocks) {
    const list = Array.isArray(blocks) ? blocks : [{ count: blocks, offset: 0 }];
    const jit = genome.motion.durationJitter || 0;
    const longest = genome.motion.duration * (1 + jit);
    const exit = genome.timing.exit?.enabled ? genome.motion.duration * 0.8 : 0;
    // The loop must outlast the block that finishes last.
    let end = 0;
    for (const b of list) end = Math.max(end, b.offset + staggerSpan(genome, b.count) + longest);
    const raw = end + genome.timing.hold + exit;
    return Math.max(0.4, raw / (genome.timing.speed || 1));
}

// ─── Motion presets ───────────────────────────────────────────────────────

// The "from" state an element animates out of. Identity is the resting state.
export function fromState(el, genome, bb, W) {
    const m = genome.motion;
    const dir = elementDirection(el, m, bb, genome.split.seed);
    const dist = m.distance * W;

    const s = {
        tx: 0, ty: 0, sx: 1, sy: 1, rot: 0,
        opacity: m.opacityFrom, blur: m.blurFrom, dash: 0,
        originX: el.centroid.x, originY: el.centroid.y,
    };

    switch (m.preset) {
        case 'slide':
            s.tx = dir.x * dist; s.ty = dir.y * dist;
            break;
        case 'rise':
            s.ty = dist * 0.6 * (m.directionMode === 'alternate' && el.index % 2 ? -1 : 1);
            break;
        case 'shutter':
            // Band collapses to a line then opens — the classic slat reveal.
            s.sy = 0.02; s.ty = dir.y * dist * 0.25;
            break;
        case 'scale':
            s.sx = m.scaleFrom; s.sy = m.scaleFrom;
            s.rot = m.rotateFrom;
            break;
        case 'blurIn':
            s.blur = Math.max(m.blurFrom, 14);
            s.sx = s.sy = 1 + 0.06 * (m.scaleFrom >= 1 ? 1 : -1);
            break;
        case 'typewriter':
            s.opacity = 0; // stagger carries the whole effect
            break;
        case 'flip':
            // No 3D in SVG — a vertical squash reads convincingly as a card flip.
            s.sy = -1; s.ty = dir.y * dist * 0.1;
            break;
        case 'explode':
            s.tx = dir.x * dist; s.ty = dir.y * dist;
            s.rot = (seededRand(genome.split.seed + el.index * 23) - 0.5) * 120;
            s.sx = s.sy = 0.4;
            break;
        case 'drawOn':
            s.dash = 1; s.opacity = 1;
            break;
        case 'powerOn':
            // No travel — the entrance is carried entirely by the flicker
            // envelope, like a tube striking rather than an object arriving.
            s.opacity = 0;
            break;
    }

    if (m.overshoot) {
        s.tx *= 1 + m.overshoot * 0.2;
        s.ty *= 1 + m.overshoot * 0.2;
    }
    return s;
}

export const REST_STATE = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, opacity: 1, blur: 0, dash: 0 };

// ─── Flicker envelope ─────────────────────────────────────────────────────

// How much flicker an element actually gets. 'powerOn' guarantees some, but
// flicker is a free-standing modifier so evolution can also drop it onto a
// sliding or scaling entrance.
export function effectiveFlicker(genome) {
    const f = genome.motion.flicker || 0;
    return genome.motion.preset === 'powerOn' ? Math.max(f, 0.4) : f;
}

/**
 * Opacity envelope for a striking light: a dim catch, a few uneven blinks,
 * then a settle to full. Returns [[p, opacity], ...] with p in 0..1 across the
 * element's own entrance window, or null when flicker is off.
 *
 * Seeded per element, so each letter catches at its own moment — that
 * unevenness is what makes it read as a real sign warming up rather than a
 * synchronized fade.
 */
export function opacityEnvelope(el, genome) {
    const f = effectiveFlicker(genome);
    if (f <= 0.01) return null;

    const seed = genome.split.seed + el.index * 61;
    const blinks = 1 + Math.round(f * 4);
    const stops = [[0, 0]];
    let p = 0;

    // Dim pre-glow before the first real strike.
    const pre = 0.05 + seededRand(seed) * 0.07;
    stops.push([pre * 0.6, 0.14 * f]);
    p = pre;

    for (let i = 0; i < blinks && p < 0.82; i++) {
        const on = 0.04 + seededRand(seed + i * 3) * 0.09;
        const off = 0.03 + seededRand(seed + i * 3 + 1) * 0.08;
        const peak = 0.78 + seededRand(seed + i * 3 + 2) * 0.22;
        const dip = (0.04 + seededRand(seed + i * 3 + 7) * 0.3) * f;
        p = Math.min(p + on, 0.9);
        stops.push([p, peak]);
        p = Math.min(p + off, 0.93);
        stops.push([p, dip]);
    }

    stops.push([Math.min(0.97, p + 0.05), 1]);
    stops.push([1, 1]);

    // Guarantee strictly increasing p so CSS keyframe percentages stay ordered.
    for (let i = 1; i < stops.length; i++) {
        if (stops[i][0] <= stops[i - 1][0]) stops[i][0] = Math.min(1, stops[i - 1][0] + 0.005);
    }
    stops[stops.length - 1][0] = 1;
    return stops;
}

// Piecewise-linear sample of an envelope. CSS interpolates linearly between
// keyframe stops, so frame mode must do the same for the two to agree.
export function sampleEnvelope(stops, p) {
    if (!stops || !stops.length) return 1;
    if (p <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
        if (p <= stops[i][0]) {
            const [p0, v0] = stops[i - 1], [p1, v1] = stops[i];
            const span = p1 - p0;
            return span <= 0 ? v1 : v0 + (v1 - v0) * ((p - p0) / span);
        }
    }
    return stops[stops.length - 1][1];
}

// Interpolate between the from-state and rest at eased progress p.
export function stateAt(from, p) {
    const lerp = (a, b) => a + (b - a) * p;
    return {
        tx: lerp(from.tx, 0),
        ty: lerp(from.ty, 0),
        sx: lerp(from.sx, 1),
        sy: lerp(from.sy, 1),
        rot: lerp(from.rot, 0),
        opacity: lerp(from.opacity, 1),
        blur: lerp(from.blur, 0),
        dash: lerp(from.dash, 0),
        originX: from.originX,
        originY: from.originY,
    };
}

// Element progress at absolute time t within one cycle, honouring speed.
export function progressAt(el, genome, count, t, offset = 0) {
    const { delay, duration } = elementTiming(el, genome, count, offset);
    const speed = genome.timing.speed || 1;
    const local = t * speed - delay;
    if (local <= 0) return 0;
    if (local >= duration) return 1;
    return easeAt(genome.motion.easing, local / duration);
}

// CSS transform value for a state.
//
// This is NOT interchangeable with transformString below. SVG attribute syntax
// ("translate(10 20)", unitless, space-separated) is invalid as a CSS property
// value: CSS needs units on non-zero lengths, deg on angles, and commas. An
// invalid value makes the browser drop the whole declaration, which silently
// removes the motion while leaving opacity animating — letters fade in on the
// spot instead of travelling.
export function transformCSS(s) {
    const parts = [];
    const ox = s.originX || 0, oy = s.originY || 0;
    if (s.tx || s.ty) parts.push(`translate(${s.tx.toFixed(2)}px, ${s.ty.toFixed(2)}px)`);
    if (s.rot || s.sx !== 1 || s.sy !== 1) {
        parts.push(`translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`);
        if (s.rot) parts.push(`rotate(${s.rot.toFixed(2)}deg)`);
        if (s.sx !== 1 || s.sy !== 1) parts.push(`scale(${s.sx.toFixed(4)}, ${s.sy.toFixed(4)})`);
        parts.push(`translate(${(-ox).toFixed(2)}px, ${(-oy).toFixed(2)}px)`);
    }
    return parts.length ? parts.join(' ') : 'none';
}

// SVG transform ATTRIBUTE string for a state, rotated/scaled about the
// element's centroid. Used only in baked frames, never in CSS.
export function transformString(s) {
    const parts = [];
    if (s.tx || s.ty) parts.push(`translate(${s.tx.toFixed(2)} ${s.ty.toFixed(2)})`);
    if (s.rot || s.sx !== 1 || s.sy !== 1) {
        const ox = (s.originX || 0).toFixed(2), oy = (s.originY || 0).toFixed(2);
        parts.push(`translate(${ox} ${oy})`);
        if (s.rot) parts.push(`rotate(${s.rot.toFixed(2)})`);
        if (s.sx !== 1 || s.sy !== 1) parts.push(`scale(${s.sx.toFixed(4)} ${s.sy.toFixed(4)})`);
        parts.push(`translate(${-ox} ${-oy})`);
    }
    return parts.join(' ');
}

// ─── Chromatic split ──────────────────────────────────────────────────────

// Per-channel offset at progress p. Channels start apart and, if converge is
// on, meet at settleAt — the RGB-split-resolving-into-clean-text effect.
export function channelOffset(genome, chIdx, p, W) {
    const rs = genome.rgbSplit;
    const sep = rs.amount * W;
    const factor = chIdx === 0 ? -1 : chIdx === 2 ? 1 : 0;
    const rad = rs.angle * Math.PI / 180;

    let mag = sep * factor;
    if (rs.converge) {
        const settle = Math.max(0.01, rs.settleAt);
        mag *= p >= settle ? 0 : 1 - p / settle;
    }
    if (rs.wobble) {
        mag *= 1 + Math.sin(p * Math.PI * 6) * rs.wobble;
    }
    return { x: Math.cos(rad) * mag, y: Math.sin(rad) * mag };
}

// Colours for the chromatic copies. 'rgb' gives literal channels that screen
// back to white; 'ghost' tints two copies around a coloured base.
export function channelColors(genome) {
    const rs = genome.rgbSplit;
    if (rs.mode === 'rgb') {
        return ['#ff0000', '#00ff00', '#0000ff'];
    }
    return [
        `hsl(${rs.hueA.toFixed(1)},95%,55%)`,
        null, // base copy uses the type colour
        `hsl(${rs.hueB.toFixed(1)},95%,55%)`,
    ];
}
