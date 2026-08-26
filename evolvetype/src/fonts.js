// Font registry — loads the manifest, parses faces with opentype.js, caches them.
// opentype.js is vendored as a global (window.opentype) by index.html.

const FONT_DIR = 'fonts/';

let manifest = null;          // [{id, family, label, file, weight, category}]
const faces = new Map();      // id -> opentype.Font
const inflight = new Map();   // id -> Promise

export async function loadManifest() {
    if (manifest) return manifest;
    const res = await fetch(`${FONT_DIR}manifest.json`);
    if (!res.ok) throw new Error(`font manifest: ${res.status}`);
    const data = await res.json();
    manifest = data.fonts;
    return manifest;
}

export function listFonts() {
    return manifest || [];
}

export function fontMeta(id) {
    return (manifest || []).find(f => f.id === id) || null;
}

export function fontIds() {
    return (manifest || []).map(f => f.id);
}

// Parse one face. Concurrent calls for the same id share a single fetch.
export function loadFace(id) {
    if (faces.has(id)) return Promise.resolve(faces.get(id));
    if (inflight.has(id)) return inflight.get(id);

    const meta = fontMeta(id);
    if (!meta) return Promise.reject(new Error(`unknown font: ${id}`));

    const p = fetch(`${FONT_DIR}${meta.file}`)
        .then(r => {
            if (!r.ok) throw new Error(`${meta.file}: ${r.status}`);
            return r.arrayBuffer();
        })
        .then(buf => {
            const font = window.opentype.parse(buf);
            font.__meta = meta;
            faces.set(id, font);
            inflight.delete(id);
            return font;
        })
        .catch(err => {
            inflight.delete(id);
            throw err;
        });

    inflight.set(id, p);
    return p;
}

// Faces must be resident before any synchronous render. The grid preloads every
// font a generation references, so genomeToSVG can stay synchronous.
export async function preloadFaces(ids) {
    await Promise.all([...new Set(ids)].map(id => loadFace(id).catch(() => null)));
}

export function getFace(id) {
    return faces.get(id) || null;
}

export function isLoaded(id) {
    return faces.has(id);
}

// Loads every face in the manifest. Called once at startup — the whole set is
// ~280KB subset to Latin, so this is cheaper than lazy-loading mid-evolution.
export async function loadAllFaces() {
    await loadManifest();
    await preloadFaces(fontIds());
    return faces;
}
