// Genome — the complete parameter set for one animation. Everything mutable
// lives here; render.js is a pure function of (genome, text, time).

export const GENOME_VERSION = 1;

export const SPLIT_MODES   = ['none', 'bands-h', 'bands-v', 'diagonal', 'glyph-bands', 'glyph-bands-v', 'glyph', 'word', 'line', 'contour'];
export const MOTION_PRESETS = ['slide', 'rise', 'shutter', 'scale', 'blurIn', 'typewriter', 'flip', 'explode', 'drawOn', 'powerOn'];
export const STAGGER_ORDERS = ['ltr', 'rtl', 'center', 'edges', 'random', 'ttb', 'btt'];
export const DIRECTION_MODES = ['alternate', 'uniform', 'random', 'outward', 'converge'];
export const EASINGS = ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'expoOut', 'circOut'];
export const CASES = ['upper', 'lower', 'title', 'none'];
export const ALIGNS = ['left', 'center', 'right'];
export const BG_TYPES = ['solid', 'linear', 'radial'];
export const SPLIT_BLENDS = ['screen', 'multiply', 'difference', 'lighten', 'normal'];
export const LOOP_MODES = ['loop', 'once', 'pingpong'];
export const EFFECT_TYPES = ['glow', 'shadow', 'outline', 'trails', 'grain', 'scanlines', 'warp', 'wipe'];

export const ASPECTS = {
    '16:9': { w: 1280, h: 720 },
    '1:1':  { w: 1080, h: 1080 },
    '4:5':  { w: 1080, h: 1350 },
    '9:16': { w: 720,  h: 1280 },
};

// ─── RNG helpers ──────────────────────────────────────────────────────────

export function rand(min, max) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function chance(p) { return Math.random() < p; }

export function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Deterministic per-element jitter, so a given seed always produces the same
// offsets across re-renders and frame exports.
export function seededRand(seed) {
    let t = (seed + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// ─── Colour ───────────────────────────────────────────────────────────────

export function randomColor() {
    return { h: rand(0, 360), s: rand(20, 95), l: rand(15, 85) };
}

export function colorString(c, alpha = 1) {
    if (!c) return 'none';
    return alpha >= 1
        ? `hsl(${c.h.toFixed(1)},${c.s.toFixed(1)}%,${c.l.toFixed(1)}%)`
        : `hsla(${c.h.toFixed(1)},${c.s.toFixed(1)}%,${c.l.toFixed(1)}%,${alpha.toFixed(3)})`;
}

export function paletteColor(palette, idx, alpha = 1) {
    return colorString(palette[((idx % palette.length) + palette.length) % palette.length], alpha);
}

// Perceived lightness of the background, used to decide whether chromatic
// ghosts should use additive (screen) or subtractive (multiply) blending.
export function bgLightness(genome) {
    const p = genome.palette;
    const a = p[genome.background.paletteIdx % p.length];
    if (genome.background.type === 'solid') return a.l;
    const b = p[genome.background.paletteIdx2 % p.length];
    return (a.l + b.l) / 2;
}

// ─── Defaults ─────────────────────────────────────────────────────────────

export function defaultGenome() {
    return {
        v: GENOME_VERSION,
        name: 'Untitled',
        aspect: '16:9',
        palette: [
            { h: 0,   s: 0,  l: 6  },
            { h: 0,   s: 0,  l: 96 },
            { h: 350, s: 85, l: 55 },
            { h: 190, s: 80, l: 55 },
        ],
        background: {
            type: 'solid', paletteIdx: 0, paletteIdx2: 2, angle: 90,
            grain: 0.06, vignette: 0.25,
            pulse: { enabled: false, amount: 0.05, duration: 4 },
        },
        type: {
            fontId: 'archivo-black',
            size: 0.22,            // fraction of canvas height
            letterSpacing: -0.01,  // em
            lineHeight: 1.05,
            case: 'upper',
            align: 'center',
            x: 0.5, y: 0.5,
            rotate: 0,
            margin: 0.09,
            wrap: true,
            fit: 'box',
            weightBoost: 0,        // synthetic thickening, em units
            paletteIdx: 1,
        },
        // clipMode 'travel' reassembles the word from its slices (the A24 look);
        // 'fixed' slides the text behind stationary slats instead.
        split: { mode: 'bands-h', count: 5, angle: 0, jitter: 0.25, seed: 1234, gap: 0, clipMode: 'travel' },
        motion: {
            preset: 'slide',
            distance: 0.35,        // fraction of canvas width
            duration: 0.85,        // seconds, per element
            easing: 'expoOut',
            overshoot: 0,
            directionMode: 'alternate',
            baseAngle: 180,        // degrees; 180 = from the left
            rotateFrom: 0,
            scaleFrom: 1,
            blurFrom: 0,
            opacityFrom: 0,
            durationJitter: 0.15,  // per-element speed variance
            // Flicker is a free-standing modifier, not just part of powerOn —
            // evolution can drop a blink onto any entrance.
            flicker: 0,
        },
        stagger: { amount: 0.055, order: 'ltr', jitter: 0 },
        rgbSplit: {
            enabled: true,
            mode: 'ghost',         // 'ghost' = tinted copies of a coloured base; 'rgb' = pure channels
            amount: 0.016,         // fraction of canvas width at full separation
            angle: 0,
            blend: 'screen',
            converge: true,
            settleAt: 0.75,        // fraction of element duration where channels meet
            wobble: 0,
            hueA: 350, hueB: 190,  // ghost tints
        },
        // A second text block, laid out together with the main one as a unit:
        // the pair is stacked with a gap and the whole group is centred on the
        // type anchor, so neither block drifts off-frame as the other resizes.
        secondary: {
            enabled: false,
            size: 0.055,          // fraction of canvas height
            gap: 0.045,           // space between blocks, fraction of H
            position: 'below',    // 'below' | 'above'
            align: 'center',
            fontId: null,         // null inherits the main block's face
            paletteIdx: 1,
            letterSpacing: 0.16,
            case: 'upper',
            opacity: 0.85,
            delayOffset: 0.3,     // seconds after the main block begins
            splitMode: 'glyph',   // its own split; usually finer than the title
            motionPreset: null,   // null inherits the main block's motion
        },
        effects: [],
        // Cycle length is derived from stagger + duration + hold, so mutating
        // any of those can never desync the loop. `speed` scales the whole thing.
        timing: { speed: 1, hold: 0.9, loop: 'loop', exit: { enabled: false, preset: 'slide' } },
        decor: { rules: 0, ruleWeight: 0.002, ticks: false, frame: false, kicker: '', kickerSize: 0.35 },
    };
}

// ─── Effects ──────────────────────────────────────────────────────────────

export function randomEffect(type = null) {
    const t = type || pick(EFFECT_TYPES);
    switch (t) {
        case 'glow':      return { type: t, radius: rand(2, 22), strength: rand(0.3, 1.4), paletteIdx: randInt(1, 3) };
        case 'shadow':    return { type: t, dx: rand(-14, 14), dy: rand(2, 18), blur: rand(0, 14), alpha: rand(0.2, 0.75), paletteIdx: 0 };
        case 'outline':   return { type: t, width: rand(0.8, 6), paletteIdx: randInt(1, 3), fillAlpha: chance(0.5) ? 0 : rand(0.1, 1) };
        case 'trails':    return { type: t, count: randInt(2, 5), spacing: rand(0.01, 0.05), falloff: rand(0.3, 0.75) };
        case 'grain':     return { type: t, amount: rand(0.04, 0.3), scale: rand(0.5, 1.6) };
        case 'scanlines': return { type: t, spacing: rand(3, 12), alpha: rand(0.08, 0.35), animate: chance(0.5) };
        case 'warp':      return { type: t, freq: rand(0.004, 0.03), scale: rand(3, 26), octaves: randInt(1, 3), animate: chance(0.5) };
        case 'wipe':      return { type: t, direction: pick(['left', 'right', 'up', 'down']), softness: rand(0, 0.3) };
        default:          return { type: t };
    }
}

// ─── Random genome ────────────────────────────────────────────────────────

export function randomGenome(fontIds) {
    const g = defaultGenome();
    const dark = chance(0.75);
    const base = dark ? { h: rand(0, 360), s: rand(0, 40), l: rand(4, 16) }
                      : { h: rand(0, 360), s: rand(0, 25), l: rand(84, 97) };
    const ink  = dark ? { h: rand(0, 360), s: rand(0, 25), l: rand(88, 99) }
                      : { h: rand(0, 360), s: rand(0, 30), l: rand(5, 18) };
    g.palette = [base, ink, randomColor(), randomColor()];
    g.background.type = pick(BG_TYPES);
    g.background.angle = rand(0, 360);
    g.background.grain = rand(0, 0.16);
    g.background.vignette = rand(0, 0.5);

    g.type.fontId = pick(fontIds);
    g.type.size = rand(0.12, 0.3);
    g.type.letterSpacing = rand(-0.04, 0.2);
    g.type.case = pick(CASES);
    g.type.align = pick(ALIGNS);

    g.split.mode = pick(SPLIT_MODES);
    g.split.count = randInt(2, 9);
    g.split.angle = rand(0, 180);
    g.split.jitter = rand(0, 0.7);
    g.split.seed = randInt(0, 99999);
    g.split.clipMode = chance(0.75) ? 'travel' : 'fixed';

    g.motion.preset = pick(MOTION_PRESETS);
    g.motion.distance = rand(0.08, 0.7);
    g.motion.duration = rand(0.4, 1.5);
    g.motion.easing = pick(EASINGS);
    g.motion.directionMode = pick(DIRECTION_MODES);
    g.motion.baseAngle = rand(0, 360);
    g.motion.durationJitter = rand(0, 0.5);
    g.motion.flicker = chance(0.3) ? rand(0.1, 1) : 0;

    g.stagger.amount = rand(0, 0.14);
    g.stagger.order = pick(STAGGER_ORDERS);

    g.rgbSplit.enabled = chance(0.7);
    g.rgbSplit.mode = chance(0.6) ? 'ghost' : 'rgb';
    g.rgbSplit.amount = rand(0.004, 0.045);
    g.rgbSplit.angle = rand(0, 360);
    g.rgbSplit.converge = chance(0.7);
    g.rgbSplit.hueA = rand(0, 360);
    g.rgbSplit.hueB = (g.rgbSplit.hueA + rand(120, 240)) % 360;

    g.secondary.enabled = chance(0.5);
    g.secondary.size = rand(0.03, 0.09);
    g.secondary.gap = rand(0.01, 0.1);
    g.secondary.position = chance(0.75) ? 'below' : 'above';
    g.secondary.letterSpacing = rand(0, 0.35);
    g.secondary.case = pick(CASES);
    g.secondary.delayOffset = rand(0, 0.7);
    g.secondary.splitMode = pick(SPLIT_MODES);
    g.secondary.fontId = chance(0.5) ? null : pick(fontIds);
    g.secondary.opacity = rand(0.5, 1);

    const nEffects = randInt(0, 2);
    g.effects = Array.from({ length: nEffects }, () => randomEffect());

    g.timing.speed = rand(0.7, 1.5);
    g.timing.hold = rand(0.4, 1.6);
    return g;
}

// Fills in anything a preset or an older saved genome left out, so the app
// never has to null-check a parameter it expects to exist.
export function normalizeGenome(g) {
    const d = defaultGenome();
    const merge = (base, over) => {
        if (over === undefined || over === null) return base;
        if (Array.isArray(base) || typeof base !== 'object') return over;
        const out = { ...base };
        for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
        return out;
    };
    const out = merge(d, g);
    out.v = GENOME_VERSION;
    if (!Array.isArray(out.palette) || out.palette.length < 2) out.palette = d.palette;
    if (!Array.isArray(out.effects)) out.effects = [];
    if (!ASPECTS[out.aspect]) out.aspect = '16:9';
    return out;
}
