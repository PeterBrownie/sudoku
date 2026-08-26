// Effects — filter chains, overlays and masks.
//
// Filter regions always use filterUnits="userSpaceOnUse" with generous padding,
// per evolvesvg/svg-rendering-guide.md §3.2: objectBoundingBox on large shapes
// makes Chrome allocate enormous buffers and silently produce blank output.

import { paletteColor } from './genome.js';

export function filterRegion(W, H) {
    return `filterUnits="userSpaceOnUse" x="${(-W * 0.3).toFixed(1)}" y="${(-H * 0.3).toFixed(1)}" width="${(W * 1.6).toFixed(1)}" height="${(H * 1.6).toFixed(1)}"`;
}

/**
 * Builds the filter applied to the whole text group (glow / shadow / warp).
 * Returns { defs: string[], attr: string } where attr is '' or ' filter="url(#id)"'.
 */
export function buildTextFilter(genome, W, H, uid) {
    const effects = genome.effects || [];
    const relevant = effects.filter(e => ['glow', 'shadow', 'warp'].includes(e.type));
    if (!relevant.length) return { defs: [], attr: '' };

    const id = `${uid}tf`;
    const steps = [];
    let src = 'SourceGraphic';

    for (const e of relevant) {
        if (e.type === 'warp') {
            const seedAttr = `seed="${(genome.split.seed % 1000)}"`;
            const anim = e.animate
                ? `<animate attributeName="baseFrequency" dur="${(8).toFixed(1)}s" values="${e.freq.toFixed(4)};${(e.freq * 1.6).toFixed(4)};${e.freq.toFixed(4)}" repeatCount="indefinite"/>`
                : '';
            steps.push(
                `<feTurbulence type="fractalNoise" baseFrequency="${e.freq.toFixed(4)}" numOctaves="${e.octaves}" ${seedAttr} result="${id}n">${anim}</feTurbulence>` +
                `<feDisplacementMap in="${src}" in2="${id}n" scale="${e.scale.toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="${id}w"/>`
            );
            src = `${id}w`;
        } else if (e.type === 'glow') {
            const col = paletteColor(genome.palette, e.paletteIdx);
            steps.push(
                `<feGaussianBlur in="${src}" stdDeviation="${e.radius.toFixed(1)}" result="${id}gb"/>` +
                `<feFlood flood-color="${col}" flood-opacity="${Math.min(1, e.strength).toFixed(2)}" result="${id}gc"/>` +
                `<feComposite in="${id}gc" in2="${id}gb" operator="in" result="${id}g"/>` +
                `<feMerge result="${id}gm"><feMergeNode in="${id}g"/><feMergeNode in="${id}g"/><feMergeNode in="${src}"/></feMerge>`
            );
            src = `${id}gm`;
        } else if (e.type === 'shadow') {
            const col = paletteColor(genome.palette, e.paletteIdx);
            steps.push(
                `<feDropShadow in="${src}" dx="${e.dx.toFixed(1)}" dy="${e.dy.toFixed(1)}" stdDeviation="${e.blur.toFixed(1)}" flood-color="${col}" flood-opacity="${e.alpha.toFixed(2)}" result="${id}s"/>`
            );
            src = `${id}s`;
        }
    }

    const def = `<filter id="${id}" ${filterRegion(W, H)} color-interpolation-filters="sRGB">${steps.join('')}</filter>`;
    return { defs: [def], attr: ` filter="url(#${id})"` };
}

// ─── Background ───────────────────────────────────────────────────────────

export function buildBackground(genome, W, H, uid, defs) {
    const bg = genome.background;
    const parts = [];
    let fill;

    if (bg.type === 'solid') {
        fill = paletteColor(genome.palette, bg.paletteIdx);
    } else {
        const gid = `${uid}bg`;
        const c1 = paletteColor(genome.palette, bg.paletteIdx);
        const c2 = paletteColor(genome.palette, bg.paletteIdx2);
        if (bg.type === 'linear') {
            const rad = bg.angle * Math.PI / 180;
            const x1 = (0.5 - Math.cos(rad) / 2).toFixed(4), y1 = (0.5 - Math.sin(rad) / 2).toFixed(4);
            const x2 = (0.5 + Math.cos(rad) / 2).toFixed(4), y2 = (0.5 + Math.sin(rad) / 2).toFixed(4);
            defs.push(`<linearGradient id="${gid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`);
        } else {
            defs.push(`<radialGradient id="${gid}" cx="0.5" cy="0.5" r="0.75"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></radialGradient>`);
        }
        fill = `url(#${gid})`;
    }

    parts.push(`<rect width="${W}" height="${H}" fill="${fill}"/>`);

    if (bg.vignette > 0.01) {
        const vid = `${uid}vg`;
        defs.push(`<radialGradient id="${vid}" cx="0.5" cy="0.5" r="0.72"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${bg.vignette.toFixed(3)}"/></radialGradient>`);
        parts.push(`<rect width="${W}" height="${H}" fill="url(#${vid})"/>`);
    }

    return parts.join('');
}

// Film grain over the whole frame. feTurbulence is cheap here because the
// region is exactly the canvas, not an oversized tiling rect.
export function buildGrainOverlay(genome, W, H, uid, defs, amount, scale = 1) {
    if (amount <= 0.005) return '';
    const fid = `${uid}gr`;
    defs.push(
        `<filter id="${fid}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="${(0.9 / scale).toFixed(3)}" numOctaves="2" stitchTiles="stitch" result="n"/>` +
        `<feColorMatrix in="n" type="saturate" values="0"/>` +
        `</filter>`
    );
    return `<rect width="${W}" height="${H}" filter="url(#${fid})" opacity="${amount.toFixed(3)}" style="mix-blend-mode:overlay" pointer-events="none"/>`;
}

export function buildScanlines(genome, W, H, uid, defs, e) {
    const pid = `${uid}sl`;
    const sp = Math.max(2, e.spacing);
    defs.push(
        `<pattern id="${pid}" width="${sp.toFixed(2)}" height="${sp.toFixed(2)}" patternUnits="userSpaceOnUse">` +
        `<rect width="${sp.toFixed(2)}" height="${(sp / 2).toFixed(2)}" fill="#000"/></pattern>`
    );
    const anim = e.animate
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${sp.toFixed(2)}" dur="1.2s" repeatCount="indefinite"/>`
        : '';
    return `<g opacity="${e.alpha.toFixed(3)}" style="mix-blend-mode:multiply" pointer-events="none">${anim}<rect x="0" y="${-sp}" width="${W}" height="${H + sp * 2}" fill="url(#${pid})"/></g>`;
}

// ─── Wipe mask ────────────────────────────────────────────────────────────

// Animated gradient mask that sweeps the text into view. Returns a mask attr
// for the text group, or '' when no wipe effect is present.
export function buildWipe(genome, W, H, uid, defs, cycle) {
    const e = (genome.effects || []).find(x => x.type === 'wipe');
    if (!e) return '';
    const mid = `${uid}wp`;
    const gid = `${uid}wpg`;
    const horiz = e.direction === 'left' || e.direction === 'right';
    const rev = e.direction === 'right' || e.direction === 'down';
    const soft = Math.max(0.001, e.softness);

    const coords = horiz
        ? `x1="${rev ? 1 : 0}" y1="0" x2="${rev ? 0 : 1}" y2="0"`
        : `x1="0" y1="${rev ? 1 : 0}" x2="0" y2="${rev ? 0 : 1}"`;

    // The gradient's stop offsets sweep from -soft..0 through to 1..1+soft.
    defs.push(
        `<linearGradient id="${gid}" ${coords}>` +
        `<stop offset="0" stop-color="#fff"><animate attributeName="offset" values="${(-soft).toFixed(3)};1" dur="${cycle.toFixed(3)}s" repeatCount="indefinite"/></stop>` +
        `<stop offset="${soft.toFixed(3)}" stop-color="#000"><animate attributeName="offset" values="0;${(1 + soft).toFixed(3)}" dur="${cycle.toFixed(3)}s" repeatCount="indefinite"/></stop>` +
        `</linearGradient>`
    );
    defs.push(`<mask id="${mid}"><rect width="${W}" height="${H}" fill="url(#${gid})"/></mask>`);
    return ` mask="url(#${mid})"`;
}

// Static wipe mask for a baked frame at progress p.
export function buildWipeFrame(genome, W, H, uid, defs, p) {
    const e = (genome.effects || []).find(x => x.type === 'wipe');
    if (!e) return '';
    const mid = `${uid}wp`, gid = `${uid}wpg`;
    const horiz = e.direction === 'left' || e.direction === 'right';
    const rev = e.direction === 'right' || e.direction === 'down';
    const soft = Math.max(0.001, e.softness);
    const coords = horiz
        ? `x1="${rev ? 1 : 0}" y1="0" x2="${rev ? 0 : 1}" y2="0"`
        : `x1="0" y1="${rev ? 1 : 0}" x2="0" y2="${rev ? 0 : 1}"`;
    const a = -soft + (1 + soft) * p;
    const b = a + soft;
    defs.push(
        `<linearGradient id="${gid}" ${coords}>` +
        `<stop offset="${Math.max(0, Math.min(1, a)).toFixed(4)}" stop-color="#fff"/>` +
        `<stop offset="${Math.max(0, Math.min(1, b)).toFixed(4)}" stop-color="#000"/></linearGradient>`
    );
    defs.push(`<mask id="${mid}"><rect width="${W}" height="${H}" fill="url(#${gid})"/></mask>`);
    return ` mask="url(#${mid})"`;
}

// ─── Decoration ───────────────────────────────────────────────────────────

// Margin shared by the frame and corner ticks. Exported so the typesetter can
// keep text inside it — decoration and type must agree on where the edge is.
export const DECOR_MARGIN = 0.045;

/**
 * Decoration is aligned to the type, not to arbitrary fractions of the canvas:
 * rules span the text block's own measure and the frame shares one margin with
 * the ticks. Otherwise a rule under a short word runs the full width and reads
 * as unrelated furniture rather than part of the composition.
 *
 * @param {{x,y,w,h}} unionBBox bounding box of every text block, so a rule
 *        under a title still clears the secondary line beneath it.
 */
export function buildDecor(genome, layout, W, H, uid, unionBBox = null) {
    const d = genome.decor;
    if (!d) return '';
    const parts = [];
    const ink = paletteColor(genome.palette, genome.type.paletteIdx);
    const bb = unionBBox || layout.bbox;
    const lw = Math.max(0.5, (d.ruleWeight || 0.002) * W);
    const m = W * DECOR_MARGIN;

    if (d.rules > 0 && layout.ok && bb.w > 0) {
        const pad = H * 0.04;
        // Match the text's measure, but never overrun the frame.
        const x0 = Math.max(m, bb.x);
        const x1 = Math.min(W - m, bb.x + bb.w);
        for (let i = 0; i < d.rules; i++) {
            const y = i === 0 ? bb.y - pad : bb.y + bb.h + pad;
            parts.push(`<rect class="decor" x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${lw.toFixed(2)}" fill="${ink}"/>`);
        }
    }
    if (d.frame) {
        parts.push(`<rect class="decor" x="${m.toFixed(1)}" y="${m.toFixed(1)}" width="${(W - m * 2).toFixed(1)}" height="${(H - m * 2).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="${lw.toFixed(2)}"/>`);
    }
    if (d.ticks) {
        const t = W * 0.022;
        // Ticks sit on the shared margin, which would place them exactly on top
        // of the frame and make them invisible. Inset them when both are drawn.
        const tm = d.frame ? m + W * 0.022 : m;
        const corners = [[tm, tm, 1, 1], [W - tm, tm, -1, 1], [tm, H - tm, 1, -1], [W - tm, H - tm, -1, -1]];
        for (const [x, y, sx, sy] of corners) {
            parts.push(`<path class="decor" d="M${(x + sx * t).toFixed(1)} ${y.toFixed(1)} H${x.toFixed(1)} V${(y + sy * t).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="${lw.toFixed(2)}"/>`);
        }
    }
    return parts.length ? `<g class="decor-g">${parts.join('')}</g>` : '';
}
