// Export — animated SVG and PNG frame sequences.
//
// Frames are produced by re-rendering the genome in 'frame' mode at each t and
// rasterizing through an off-DOM Image, per evolvesvg/svg-rendering-guide.md §4:
// an in-DOM or CSS-constrained <img> makes Chrome rasterize filters at the
// display size instead of the SVG's intrinsic size.

import { genomeToSVG, canvasSize } from './render.js';
import { genomeCycle } from './render.js';

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeName(s) {
    return (s || 'evolvetype').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 48) || 'evolvetype';
}

// ─── SVG ──────────────────────────────────────────────────────────────────

export function exportSVG(genome, text, scale = 1, secondaryText = '') {
    const { w, h } = canvasSize(genome);
    const svg = genomeToSVG(genome, text, {
        mode: 'animated',
        uid: 'et',
        outW: Math.round(w * scale),
        outH: Math.round(h * scale),
        embedMeta: true,
        secondaryText,
    });
    return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

// ─── Rasterization ────────────────────────────────────────────────────────

export function rasterize(svgString, w, h) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image(); // off-DOM: no CSS context can constrain it
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(canvas);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterization failed')); };
        img.src = url;
    });
}

export function canvasToPNG(canvas) {
    return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
}

export async function exportPoster(genome, text, t, scale = 1, secondaryText = '') {
    const { w, h } = canvasSize(genome);
    const svg = genomeToSVG(genome, text, { mode: 'frame', t, uid: 'p', secondaryText });
    const canvas = await rasterize(svg, Math.round(w * scale), Math.round(h * scale));
    return canvasToPNG(canvas);
}

/**
 * Renders one loop as a numbered PNG sequence and packs it into a ZIP.
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {Promise<Blob>}
 */
export async function exportFrameSequence(genome, text, { fps = 30, scale = 1, onProgress, secondaryText = '' } = {}) {
    const { w, h } = canvasSize(genome);
    const cycle = genomeCycle(genome, text, secondaryText);
    const total = Math.max(1, Math.round(cycle * fps));
    const outW = Math.round(w * scale), outH = Math.round(h * scale);
    const files = [];

    for (let i = 0; i < total; i++) {
        const t = (i / total) * cycle;
        const svg = genomeToSVG(genome, text, { mode: 'frame', t, uid: 'f', secondaryText });
        const canvas = await rasterize(svg, outW, outH);
        const png = await canvasToPNG(canvas);
        const buf = new Uint8Array(await png.arrayBuffer());
        files.push({ name: `frame_${String(i).padStart(4, '0')}.png`, data: buf });
        if (onProgress) onProgress(i + 1, total);
        // Yield so the progress UI can paint between frames.
        if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    files.push({
        name: 'sequence.txt',
        data: new TextEncoder().encode(
            `evolveType frame sequence\n` +
            `text: ${text}\n` + (secondaryText ? `secondary: ${secondaryText}\n` : '') +
            `style: ${genome.name || 'Untitled'}\n` +
            `frames: ${total}\nfps: ${fps}\nduration: ${cycle.toFixed(3)}s\n` +
            `size: ${outW}x${outH}\n\n` +
            `Import as an image sequence at ${fps} fps.\n`
        ),
    });

    return makeZip(files);
}

// ─── ZIP (stored, no compression) ─────────────────────────────────────────
// PNGs are already deflated, so storing them costs nothing and keeps this
// dependency-free.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
}

export function makeZip(files) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime();
    const entries = files.map(f => {
        const name = enc.encode(f.name);
        return { name, data: f.data, crc: crc32(f.data) };
    });

    let localSize = 0, centralSize = 0;
    for (const e of entries) {
        localSize += 30 + e.name.length + e.data.length;
        centralSize += 46 + e.name.length;
    }

    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let off = 0;
    const offsets = [];

    for (const e of entries) {
        offsets.push(off);
        view.setUint32(off, 0x04034b50, true);       // local header signature
        view.setUint16(off + 4, 20, true);           // version needed
        view.setUint16(off + 6, 0, true);            // flags
        view.setUint16(off + 8, 0, true);            // method: stored
        view.setUint16(off + 10, time, true);
        view.setUint16(off + 12, date, true);
        view.setUint32(off + 14, e.crc, true);
        view.setUint32(off + 18, e.data.length, true);
        view.setUint32(off + 22, e.data.length, true);
        view.setUint16(off + 26, e.name.length, true);
        view.setUint16(off + 28, 0, true);           // extra length
        off += 30;
        out.set(e.name, off); off += e.name.length;
        out.set(e.data, off); off += e.data.length;
    }

    const centralStart = off;
    entries.forEach((e, i) => {
        view.setUint32(off, 0x02014b50, true);       // central directory signature
        view.setUint16(off + 4, 20, true);           // version made by
        view.setUint16(off + 6, 20, true);           // version needed
        view.setUint16(off + 8, 0, true);
        view.setUint16(off + 10, 0, true);
        view.setUint16(off + 12, time, true);
        view.setUint16(off + 14, date, true);
        view.setUint32(off + 16, e.crc, true);
        view.setUint32(off + 20, e.data.length, true);
        view.setUint32(off + 24, e.data.length, true);
        view.setUint16(off + 28, e.name.length, true);
        view.setUint16(off + 30, 0, true);           // extra
        view.setUint16(off + 32, 0, true);           // comment
        view.setUint16(off + 34, 0, true);           // disk number
        view.setUint16(off + 36, 0, true);           // internal attrs
        view.setUint32(off + 38, 0, true);           // external attrs
        view.setUint32(off + 42, offsets[i], true);  // local header offset
        off += 46;
        out.set(e.name, off); off += e.name.length;
    });

    view.setUint32(off, 0x06054b50, true);           // end of central directory
    view.setUint16(off + 4, 0, true);
    view.setUint16(off + 6, 0, true);
    view.setUint16(off + 8, entries.length, true);
    view.setUint16(off + 10, entries.length, true);
    view.setUint32(off + 12, off - centralStart, true);
    view.setUint32(off + 16, centralStart, true);
    view.setUint16(off + 20, 0, true);

    return new Blob([out], { type: 'application/zip' });
}
