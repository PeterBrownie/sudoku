// Mutation — mirrors evolveSVG's split between smooth parameter drift and
// discrete structural jumps, driven by the same four sliders.
//
//   paramRange    how far continuous values drift
//   structureRate how often categorical choices flip (font, split mode, preset)
//   effectRate    how often effects are added or removed
//   colorRange    how far the palette drifts

import {
    rand, randInt, pick, clamp, chance, gauss, deepClone, randomColor, randomEffect,
    SPLIT_MODES, MOTION_PRESETS, STAGGER_ORDERS, DIRECTION_MODES, EASINGS,
    CASES, ALIGNS, BG_TYPES, SPLIT_BLENDS, EFFECT_TYPES,
} from './genome.js';

const nudge = (v, range, lo, hi, scale = 1) =>
    clamp(v + gauss() * range * scale, lo, hi);

// Pulls a value onto a canonical target when it lands close to one, so
// positions settle on a grid instead of hovering slightly off it.
const snap = (v, targets, tol) => {
    let best = v, bestD = tol;
    for (const t of targets) {
        const d = Math.abs(v - t);
        if (d < bestD) { bestD = d; best = t; }
    }
    return best;
};

function mutateColor(c, range) {
    return {
        h: (c.h + gauss() * range * 45 + 360) % 360,
        s: clamp(c.s + gauss() * range * 22, 0, 100),
        l: clamp(c.l + gauss() * range * 18, 0, 100),
    };
}

export function defaultOpts() {
    return { paramRange: 0.45, structureRate: 0.3, effectRate: 0.25, colorRange: 0.4 };
}

export function mutateGenome(genome, fontIds, opts = {}) {
    const P = opts.paramRange ?? 0.45;
    const S = opts.structureRate ?? 0.3;
    const E = opts.effectRate ?? 0.25;
    const C = opts.colorRange ?? 0.4;

    const g = deepClone(genome);

    // ── Palette ──
    g.palette = g.palette.map(c => mutateColor(c, C));
    if (chance(S * 0.12) && g.palette.length < 6) g.palette.push(randomColor());
    if (chance(S * 0.1) && g.palette.length > 2) g.palette.splice(randInt(2, g.palette.length - 1), 1);

    // ── Background ──
    const bg = g.background;
    bg.angle = (bg.angle + gauss() * P * 60 + 360) % 360;
    bg.grain = clamp(nudge(bg.grain, P, 0, 0.4, 0.09), 0, 0.4);
    bg.vignette = clamp(nudge(bg.vignette, P, 0, 0.7, 0.16), 0, 0.7);
    if (chance(S * 0.25)) bg.type = pick(BG_TYPES);
    if (chance(S * 0.2)) bg.paletteIdx = randInt(0, g.palette.length - 1);
    if (chance(S * 0.2)) bg.paletteIdx2 = randInt(0, g.palette.length - 1);

    // ── Typography ──
    const ty = g.type;
    ty.size = clamp(nudge(ty.size, P, 0.05, 0.42, 0.05), 0.05, 0.42);
    ty.letterSpacing = clamp(nudge(ty.letterSpacing, P, -0.06, 0.4, 0.05), -0.06, 0.4);
    ty.lineHeight = clamp(nudge(ty.lineHeight, P, 0.75, 2.0, 0.12), 0.75, 2.0);
    // Position drifts, but with gravity toward canonical placements so blocks
    // land on a grid rather than a fraction of a percent off centre.
    ty.x = snap(clamp(nudge(ty.x, P, 0.2, 0.8, 0.05), 0.2, 0.8), [0.5, 0.25, 0.75, 1 / 3, 2 / 3], 0.045);
    ty.y = snap(clamp(nudge(ty.y, P, 0.2, 0.8, 0.05), 0.2, 0.8), [0.5, 0.35, 0.65, 1 / 3, 2 / 3], 0.045);
    ty.weightBoost = clamp(nudge(ty.weightBoost, P, 0, 0.06, 0.012), 0, 0.06);

    // Rotation reads as a mistake unless it is deliberate, and an arbitrary
    // 1.4deg always reads as a mistake. So tilt never drifts continuously: it
    // is either level or one of a few designed angles, with a strong pull back
    // to level so a tilt does not persist down a lineage.
    if (chance(S * 0.3)) ty.rotate = 0;
    else if (chance(S * 0.05)) ty.rotate = pick([0, 0, 0, 0, 0, -6, -3, 3, 6]);
    if (Math.abs(ty.rotate) < 0.6) ty.rotate = 0;
    if (chance(S * 0.35) && fontIds.length) ty.fontId = pick(fontIds);
    if (chance(S * 0.2)) ty.case = pick(CASES);
    if (chance(S * 0.15)) ty.align = pick(ALIGNS);
    if (chance(S * 0.15)) ty.paletteIdx = randInt(1, g.palette.length - 1);

    // ── Split ──
    const sp = g.split;
    sp.count = Math.round(clamp(nudge(sp.count, P, 1, 14, 2), 1, 14));
    sp.jitter = clamp(nudge(sp.jitter, P, 0, 1, 0.2), 0, 1);
    sp.gap = clamp(nudge(sp.gap, P, 0, 0.35, 0.06), 0, 0.35);
    sp.angle = (sp.angle + gauss() * P * 40 + 360) % 360;
    if (chance(S * 0.4)) sp.mode = pick(SPLIT_MODES);
    if (chance(S * 0.25)) sp.clipMode = chance(0.7) ? 'travel' : 'fixed';
    if (chance(S * 0.3)) sp.seed = randInt(0, 99999);

    // ── Motion ──
    const mo = g.motion;
    mo.distance = clamp(nudge(mo.distance, P, 0.02, 1.1, 0.14), 0.02, 1.1);
    mo.duration = clamp(nudge(mo.duration, P, 0.15, 2.4, 0.22), 0.15, 2.4);
    mo.durationJitter = clamp(nudge(mo.durationJitter, P, 0, 0.8, 0.12), 0, 0.8);
    mo.flicker = clamp(nudge(mo.flicker || 0, P, 0, 1, 0.15), 0, 1);
    // Occasionally switch flicker on or off outright, so it can appear on a
    // lineage that had none rather than only drifting up from zero.
    if (chance(S * 0.2)) mo.flicker = mo.flicker > 0.05 ? 0 : rand(0.3, 1);
    mo.baseAngle = (mo.baseAngle + gauss() * P * 55 + 360) % 360;
    mo.overshoot = clamp(nudge(mo.overshoot, P, 0, 1, 0.18), 0, 1);
    mo.scaleFrom = clamp(nudge(mo.scaleFrom, P, 0.1, 2.4, 0.22), 0.1, 2.4);
    mo.opacityFrom = clamp(nudge(mo.opacityFrom, P, 0, 1, 0.18), 0, 1);
    if (chance(S * 0.35)) mo.preset = pick(MOTION_PRESETS);
    if (chance(S * 0.3)) mo.easing = pick(EASINGS);
    if (chance(S * 0.3)) mo.directionMode = pick(DIRECTION_MODES);

    // ── Stagger ──
    const st = g.stagger;
    st.amount = clamp(nudge(st.amount, P, 0, 0.35, 0.035), 0, 0.35);
    st.jitter = clamp(nudge(st.jitter, P, 0, 0.8, 0.12), 0, 0.8);
    if (chance(S * 0.35)) st.order = pick(STAGGER_ORDERS);

    // ── Chromatic split ──
    const rs = g.rgbSplit;
    rs.amount = clamp(nudge(rs.amount, P, 0, 0.09, 0.011), 0, 0.09);
    rs.angle = (rs.angle + gauss() * P * 70 + 360) % 360;
    rs.settleAt = clamp(nudge(rs.settleAt, P, 0.1, 1, 0.14), 0.1, 1);
    rs.wobble = clamp(nudge(rs.wobble, P, 0, 0.8, 0.12), 0, 0.8);
    rs.hueA = (rs.hueA + gauss() * C * 50 + 360) % 360;
    rs.hueB = (rs.hueB + gauss() * C * 50 + 360) % 360;
    if (chance(S * 0.18)) rs.enabled = !rs.enabled;
    if (chance(S * 0.2)) rs.mode = chance(0.5) ? 'ghost' : 'rgb';
    if (chance(S * 0.2)) rs.converge = !rs.converge;
    if (chance(S * 0.2)) rs.blend = pick(SPLIT_BLENDS);

    // ── Secondary block ──
    const sc = g.secondary;
    if (sc) {
        sc.size = clamp(nudge(sc.size, P, 0.02, 0.14, 0.014), 0.02, 0.14);
        sc.gap = clamp(nudge(sc.gap, P, 0, 0.18, 0.018), 0, 0.18);
        sc.letterSpacing = clamp(nudge(sc.letterSpacing, P, -0.04, 0.45, 0.05), -0.04, 0.45);
        sc.delayOffset = clamp(nudge(sc.delayOffset, P, 0, 1.4, 0.14), 0, 1.4);
        sc.opacity = clamp(nudge(sc.opacity, P, 0.3, 1, 0.1), 0.3, 1);
        if (chance(S * 0.15)) sc.enabled = !sc.enabled;
        if (chance(S * 0.2)) sc.position = chance(0.7) ? 'below' : 'above';
        if (chance(S * 0.25)) sc.splitMode = pick(SPLIT_MODES);
        if (chance(S * 0.2)) sc.case = pick(CASES);
        if (chance(S * 0.2)) sc.align = pick(ALIGNS);
        if (chance(S * 0.2)) sc.paletteIdx = randInt(1, g.palette.length - 1);
        if (chance(S * 0.25)) sc.fontId = chance(0.4) ? null : pick(fontIds);
    }

    // ── Effects ──
    g.effects = (g.effects || []).map(e => mutateEffect(e, P)).filter(Boolean);
    if (chance(E * 0.7) && g.effects.length < 4) {
        const missing = EFFECT_TYPES.filter(t => !g.effects.some(e => e.type === t));
        if (missing.length) g.effects.push(randomEffect(pick(missing)));
    }
    if (chance(E * 0.45) && g.effects.length > 0) {
        g.effects.splice(randInt(0, g.effects.length - 1), 1);
    }

    // ── Timing ──
    g.timing.speed = clamp(nudge(g.timing.speed, P, 0.35, 2.5, 0.2), 0.35, 2.5);
    g.timing.hold = clamp(nudge(g.timing.hold, P, 0.1, 3, 0.3), 0.1, 3);
    if (chance(S * 0.12)) g.timing.loop = pick(['loop', 'loop', 'pingpong']);

    // ── Decoration ──
    const dc = g.decor;
    if (chance(S * 0.2)) dc.rules = randInt(0, 2);
    if (chance(S * 0.15)) dc.frame = !dc.frame;
    if (chance(S * 0.15)) dc.ticks = !dc.ticks;
    dc.ruleWeight = clamp(nudge(dc.ruleWeight, P, 0.0005, 0.01, 0.0018), 0.0005, 0.01);

    return g;
}

function mutateEffect(e, P) {
    const o = { ...e };
    switch (e.type) {
        case 'glow':
            o.radius = clamp(nudge(e.radius, P, 1, 40, 5), 1, 40);
            o.strength = clamp(nudge(e.strength, P, 0.05, 2, 0.25), 0.05, 2);
            break;
        case 'shadow':
            o.dx = clamp(nudge(e.dx, P, -30, 30, 5), -30, 30);
            o.dy = clamp(nudge(e.dy, P, -30, 30, 5), -30, 30);
            o.blur = clamp(nudge(e.blur, P, 0, 30, 4), 0, 30);
            o.alpha = clamp(nudge(e.alpha, P, 0.05, 1, 0.14), 0.05, 1);
            break;
        case 'outline':
            o.width = clamp(nudge(e.width, P, 0.3, 14, 1.4), 0.3, 14);
            o.fillAlpha = clamp(nudge(e.fillAlpha, P, 0, 1, 0.2), 0, 1);
            break;
        case 'trails':
            o.count = Math.round(clamp(nudge(e.count, P, 1, 6, 1), 1, 6));
            o.spacing = clamp(nudge(e.spacing, P, 0.004, 0.09, 0.012), 0.004, 0.09);
            o.falloff = clamp(nudge(e.falloff, P, 0.15, 0.9, 0.12), 0.15, 0.9);
            break;
        case 'grain':
            o.amount = clamp(nudge(e.amount, P, 0.01, 0.5, 0.07), 0.01, 0.5);
            o.scale = clamp(nudge(e.scale, P, 0.3, 2.5, 0.25), 0.3, 2.5);
            break;
        case 'scanlines':
            o.spacing = clamp(nudge(e.spacing, P, 2, 24, 2.5), 2, 24);
            o.alpha = clamp(nudge(e.alpha, P, 0.02, 0.6, 0.08), 0.02, 0.6);
            break;
        case 'warp':
            o.freq = clamp(nudge(e.freq, P, 0.001, 0.06, 0.006), 0.001, 0.06);
            o.scale = clamp(nudge(e.scale, P, 1, 60, 6), 1, 60);
            break;
        case 'wipe':
            o.softness = clamp(nudge(e.softness, P, 0, 0.5, 0.07), 0, 0.5);
            if (chance(P * 0.2)) o.direction = pick(['left', 'right', 'up', 'down']);
            break;
    }
    return o;
}

// Produces the 8 mutants around a preserved parent. Index 4 stays the parent so
// you can always see what you're evolving away from.
export function evolveGeneration(parent, fontIds, opts) {
    const out = new Array(9);
    out[4] = deepClone(parent);
    for (let i = 0; i < 9; i++) {
        if (i === 4) continue;
        out[i] = mutateGenome(parent, fontIds, opts);
    }
    return out;
}

// Re-rolls only the palette, keeping every structural choice. Handy when the
// motion is right but the colours aren't.
export function rerollPalette(genome) {
    const g = deepClone(genome);
    const dark = g.palette[g.background.paletteIdx % g.palette.length].l < 50;
    g.palette = g.palette.map((c, i) => {
        if (i === 0) return dark ? { h: rand(0, 360), s: rand(0, 40), l: rand(4, 16) }
                                 : { h: rand(0, 360), s: rand(0, 25), l: rand(84, 97) };
        if (i === 1) return dark ? { h: rand(0, 360), s: rand(0, 25), l: rand(88, 99) }
                                 : { h: rand(0, 360), s: rand(0, 30), l: rand(5, 18) };
        return randomColor();
    });
    g.rgbSplit.hueA = rand(0, 360);
    g.rgbSplit.hueB = (g.rgbSplit.hueA + rand(110, 250)) % 360;
    return g;
}
