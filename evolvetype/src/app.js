// App — the evolution loop, grid, transport and export wiring.

import { loadAllFaces, listFonts, fontIds } from './fonts.js';
import { defaultGenome, normalizeGenome, randomGenome, deepClone, ASPECTS } from './genome.js';
import { evolveGeneration, rerollPalette } from './mutate.js';
import { genomeToSVG, genomeCycle, extractState } from './render.js';
import {
    exportSVG, exportPoster, exportFrameSequence, downloadBlob, safeName, rasterize,
} from './export.js';

const $ = id => document.getElementById(id);

const TEXT_KEY = 'evolvetype.text';

// Pixels of two-finger scroll that traverse one full loop. Tight enough that a
// single comfortable swipe covers the whole animation.
const WHEEL_PX_PER_LOOP = 420;

const state = {
    text: 'EVOLVE',
    text2: '',
    genomes: new Array(9).fill(null),
    selected: 4,
    history: [],
    future: [],
    presets: [],
    activePreset: null,
    playing: true,
    time: 0,          // absolute seconds on the master timeline
    aspect: '16:9',
    bookmarks: [],
};

let cells = [];
let rafId = null;
let clockStart = performance.now();
let wheelLockUntil = 0;

// ─── Boot ─────────────────────────────────────────────────────────────────

(async function boot() {
    try {
        await loadAllFaces();
    } catch (err) {
        $('loading').textContent = `Font load failed: ${err.message}`;
        return;
    }
    restoreText();
    await loadPresets();
    buildFontSelect();
    buildGrid();
    restoreBookmarks();
    wireUI();

    const first = state.presets[0];
    loadPreset(first ? first.id : null);
    $('loading').classList.add('done');
    startClock();
})();

// Keep the typed text across refreshes — retyping it every reload is friction
// with no upside.
function restoreText() {
    try {
        const saved = JSON.parse(localStorage.getItem(TEXT_KEY) || 'null');
        if (saved && typeof saved.main === 'string') {
            state.text = saved.main;
            state.text2 = typeof saved.second === 'string' ? saved.second : '';
        }
    } catch { /* fall back to defaults */ }
    $('text-input').value = state.text;
    $('text2-input').value = state.text2;
}

function persistText() {
    try { localStorage.setItem(TEXT_KEY, JSON.stringify({ main: state.text, second: state.text2 })); }
    catch { /* storage unavailable; not worth surfacing */ }
}

async function loadPresets() {
    try {
        const res = await fetch('presets/presets.json');
        const data = await res.json();
        state.presets = data.presets || [];
    } catch {
        state.presets = [];
    }
    const box = $('presets');
    box.innerHTML = '';
    for (const p of state.presets) {
        const b = document.createElement('button');
        b.className = 'preset';
        b.dataset.id = p.id;
        b.innerHTML = `<div class="n"></div><div class="b"></div>`;
        b.querySelector('.n').textContent = p.name;
        b.querySelector('.b').textContent = p.blurb;
        b.addEventListener('click', () => loadPreset(p.id));
        box.appendChild(b);
    }
}

function loadPreset(id) {
    const p = state.presets.find(x => x.id === id);
    const g = p ? normalizeGenome({ ...p.genome, name: p.name, aspect: state.aspect })
                : normalizeGenome({ ...defaultGenome(), aspect: state.aspect });
    state.activePreset = p ? p.id : null;
    document.querySelectorAll('.preset').forEach(el =>
        el.classList.toggle('active', el.dataset.id === state.activePreset));
    setGeneration(evolveGeneration(g, fontIds(), getOpts()), 4, false);
    syncTypeControls();
}

function buildFontSelect() {
    const sel = $('font-sel');
    sel.innerHTML = '';
    const sel2 = $('sec-font');
    sel2.innerHTML = '<option value="">Same as main</option>';
    for (const f of listFonts()) {
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = f.label;
        sel.appendChild(o);
        sel2.appendChild(o.cloneNode(true));
    }
}

// Secondary settings edit the parent, then re-evolve — same contract as the
// typography controls.
function applySecondary(key, value) {
    const parent = state.genomes[4];
    if (!parent) return;
    const g = deepClone(parent);
    g.secondary = { ...g.secondary, [key]: value };
    setGeneration(evolveGeneration(g, fontIds(), getOpts()), 4);
}

function syncSecondaryControls() {
    const g = state.genomes[4] || state.genomes[state.selected];
    if (!g || !g.secondary) return;
    const sc = g.secondary;
    $('sec-on').checked = !!sc.enabled;
    $('sec-pos').value = sc.position;
    $('sec-font').value = sc.fontId || '';
    $('sec-size').value = String(sc.size);
    $('sec-gap').value = String(sc.gap);
    $('sec-track').value = String(sc.letterSpacing);
    $('sec-delay').value = String(sc.delayOffset);
    $('sec-controls').classList.toggle('off', !sc.enabled);
    syncSliderLabels();
}

// ─── Grid ─────────────────────────────────────────────────────────────────

function buildGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    cells = [];
    for (let i = 0; i < 9; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.i = String(i);

        const tag = document.createElement('span');
        tag.className = 'tag';
        cell.appendChild(tag);

        const acts = document.createElement('div');
        acts.className = 'acts';
        // No emoji anywhere on this site — these reference the icon sprite
        // defined in index.html.
        const icon = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
        acts.innerHTML =
            `<button data-act="expand" title="Expand" aria-label="Expand">${icon('expand')}</button>` +
            `<button data-act="colors" title="Reroll colours" aria-label="Reroll colours">${icon('palette')}</button>` +
            `<button data-act="save" title="Save" aria-label="Save">${icon('star')}</button>`;
        cell.appendChild(acts);

        cell.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (act) {
                e.stopPropagation();
                cellAction(i, act.dataset.act);
                return;
            }
            selectCell(i);
        });
        cell.addEventListener('dblclick', e => { e.preventDefault(); evolve(); });

        grid.appendChild(cell);
        cells.push(cell);
    }
    applyAspectToCells();
}

function applyAspectToCells() {
    const { w, h } = ASPECTS[state.aspect];
    cells.forEach(c => { c.style.aspectRatio = `${w} / ${h}`; });
    // Narrow frames need a tighter grid so nine cells still fit on screen.
    const tall = h > w;
    $('grid').style.maxWidth = tall ? '900px' : '1500px';
}

function setGeneration(genomes, selected = 4, pushHistory = true) {
    if (pushHistory) {
        state.history.push({ genomes: state.genomes.map(g => g && deepClone(g)), selected: state.selected });
        if (state.history.length > 60) state.history.shift();
        state.future.length = 0;
    }
    state.genomes = genomes;
    state.selected = selected;
    // A new generation is a fresh set of animations, so rewind the shared clock:
    // every caller here evolves nine new variations, and they should all be
    // judged from their entrance rather than from wherever the last loop was.
    // Play/pause is left alone; renderAll re-bakes the cells and re-syncs the
    // clock origin behind this.
    state.time = 0;
    updateTransportUI();
    renderAll();
    updateHistoryButtons();
}

function renderAll() {
    for (let i = 0; i < 9; i++) renderCell(i);
    updateSelection();
    syncClock();
}

function renderCell(i) {
    const g = state.genomes[i];
    const cell = cells[i];
    if (!g) return;

    const cycle = genomeCycle(g, state.text, state.text2);
    cell.dataset.cycle = String(cycle);

    // Playing renders the self-animating SVG and lets the compositor drive it.
    // Paused renders a baked frame at the scrub position — the same code path
    // the PNG exporter uses, so what you scrub to is exactly what you export.
    const svg = state.playing
        ? genomeToSVG(g, state.text, { mode: 'animated', uid: `c${i}`, secondaryText: state.text2 })
        : genomeToSVG(g, state.text, { mode: 'frame', t: state.time, uid: `c${i}`, secondaryText: state.text2 });

    // :scope > svg, not svg — the hover action buttons hold icon <svg>s of their
    // own, and on a cell's first render there is no artwork yet, so a descendant
    // search would find the first icon and delete it instead.
    const old = cell.querySelector(':scope > svg');
    if (old) old.remove();
    cell.insertAdjacentHTML('afterbegin', svg);

    // Fresh animations begin at t=0; a negative delay shifts them onto the
    // master clock. CSS wraps a delay longer than one iteration by itself, so
    // absolute seconds work directly whatever this cell's loop length is —
    // which is what keeps playback and scrubbing showing the same thing.
    cell.style.setProperty('--seek', `${(-state.time).toFixed(3)}s`);

    cell.querySelector('.tag').textContent = i === 4 ? 'Parent' : `Variant ${i < 4 ? i + 1 : i}`;
}

function updateSelection() {
    cells.forEach((c, i) => {
        c.classList.toggle('parent', i === 4);
        c.classList.toggle('selected', i === state.selected);
    });
}

function selectCell(i) {
    state.selected = i;
    updateSelection();
}

function cellAction(i, act) {
    if (act === 'expand') openOverlay(i);
    else if (act === 'colors') {
        state.genomes[i] = rerollPalette(state.genomes[i]);
        renderCell(i);
    } else if (act === 'save') addBookmark(i);
}

function evolve() {
    const parent = state.genomes[state.selected];
    if (!parent) return;
    setGeneration(evolveGeneration(parent, fontIds(), getOpts()), 4);
    toast('Evolved from selection');
}

function getOpts() {
    return {
        paramRange: +$('paramRange').value,
        structureRate: +$('structureRate').value,
        effectRate: +$('effectRate').value,
        colorRange: +$('colorRange').value,
    };
}

// ─── Transport ────────────────────────────────────────────────────────────

// While playing, CSS drives the animation and this loop only advances the
// readout. The scrub position is normalized, so at 0.5 every variation sits
// halfway through its own loop no matter how long that loop is.
function startClock() {
    const tick = () => {
        if (state.playing) {
            const master = activeCycle();
            const elapsed = (performance.now() - clockStart) / 1000;
            state.time = master > 0 ? elapsed % master : 0;
            updateTransportUI();
        }
        rafId = requestAnimationFrame(tick);
    };
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
}

function maxCycle() {
    let m = 0;
    for (let i = 0; i < 9; i++) {
        const c = parseFloat(cells[i]?.dataset.cycle || '0');
        if (c > m) m = c;
    }
    return m || 1;
}

// Scrubbing re-bakes the cells rather than nudging animation-delay: repositioning
// a running CSS animation by changing its delay behaves inconsistently across
// browsers, and baking reuses the exact path the exporter takes.
let seekPending = false;
function applySeek() {
    if (seekPending) return;
    seekPending = true;
    requestAnimationFrame(() => {
        seekPending = false;
        // A seek queued just before playback resumed is stale — re-rendering
        // here would restart every animation a frame after they began.
        if (state.playing) return;
        if (overlayIdx >= 0) { renderOverlay(); return; }
        for (let i = 0; i < 9; i++) renderCell(i);
        updateSelection();
    });
}

// One place that ties wall-clock time to the playhead. Every path that starts
// or re-renders playback must go through it, or the readout drifts away from
// what is actually on screen.
function syncClock() {
    if (state.playing) clockStart = performance.now() - state.time * 1000;
}

// Restart every cell from t=0 together. Re-inserting the SVGs is what actually
// resets the CSS animations — nudging animation-delay on a running animation
// does not reliably rewind it — and doing all nine in one pass keeps them in
// lockstep, which is the point when comparing entrances.
function restartAll() {
    state.time = 0;
    state.playing = true;
    updateTransportUI();
    renderActive();
}

// The grid and the expanded overlay each have a transport; they are two views
// of one clock, so both are written from the same state.
function updateTransportUI() {
    // Swap the sprite reference rather than the text content, so the button
    // never falls back to a character glyph.
    const icon = state.playing ? '#i-pause' : '#i-play';
    for (const id of ['playpause', 'ov-playpause']) {
        $(id).querySelector('use').setAttribute('href', icon);
    }
    const master = activeCycle();
    const v = String(Math.round((master > 0 ? state.time / master : 0) * 1000));
    $('scrub').value = v;
    $('ov-scrub').value = v;
    const label = `${state.time.toFixed(2)} / ${master.toFixed(2)}s`;
    $('time-label').textContent = label;
    $('ov-time').textContent = label;
}

// While expanded, only the expanded genome matters — the grid is not visible.
function activeCycle() {
    if (overlayIdx >= 0 && state.genomes[overlayIdx]) {
        return genomeCycle(state.genomes[overlayIdx], state.text, state.text2);
    }
    return maxCycle();
}

// Renders whichever view is on screen. With the overlay open the nine grid
// SVGs are gone from the DOM, so re-rendering them would be wasted work.
function renderActive() {
    if (overlayIdx >= 0) renderOverlay();
    else renderAll();
}

// Single entry point for every way of moving the playhead: the two scrub bars
// and the trackpad. Scrubbing always drops out of playback, since fighting a
// running animation for control of the timeline is never what you want.
// Single entry point for every way of moving the playhead. Takes absolute
// seconds, because the animations themselves run on absolute seconds — a
// normalized position cannot describe nine loops of differing length.
function scrubTo(seconds) {
    state.playing = false;   // applySeek re-bakes in frame mode
    state.time = Math.max(0, Math.min(activeCycle(), seconds));
    updateTransportUI();
    applySeek();
}

function setPlaying(on) {
    state.playing = on;
    wheelLockUntil = performance.now() + 350;  // ride out trackpad momentum
    updateTransportUI();
    renderActive();
}

// ─── Overlay ──────────────────────────────────────────────────────────────

let overlayIdx = -1;

function openOverlay(i) {
    overlayIdx = i;
    const g = state.genomes[i];
    $('ov-name').textContent = `${g.name || 'Untitled'} · ${g.split.mode} · ${g.motion.preset} · ${genomeCycle(g, state.text, state.text2).toFixed(2)}s`;
    $('overlay').classList.add('on');

    // Tear the grid's SVGs out of the DOM while expanded. They are completely
    // hidden behind the overlay, and nine animating SVGs left running cost real
    // frames — the expanded view is exactly where smoothness matters most.
    for (const c of cells) {
        const svg = c.querySelector(':scope > svg');   // artwork only, not the action icons
        if (svg) svg.remove();
    }

    renderOverlay();
    updateTransportUI();
}

function renderOverlay() {
    if (overlayIdx < 0) return;
    const g = state.genomes[overlayIdx];
    if (!g) return;
    const svg = state.playing
        ? genomeToSVG(g, state.text, { mode: 'animated', uid: 'ov', secondaryText: state.text2 })
        : genomeToSVG(g, state.text, { mode: 'frame', t: state.time, uid: 'ov', secondaryText: state.text2 });
    $('overlay-stage').innerHTML = svg;
    $('overlay-stage').style.setProperty('--seek', `${(-state.time).toFixed(3)}s`);
    // The overlay is a render path too — without this the clock keeps running
    // against a stale origin and the readout jumps away from the animation.
    syncClock();
}

function closeOverlay() {
    if (overlayIdx < 0) return;
    $('overlay').classList.remove('on');
    $('overlay-stage').innerHTML = '';
    overlayIdx = -1;
    renderAll();          // bring the grid back
    updateTransportUI();
}

// ─── Bookmarks ────────────────────────────────────────────────────────────

const BM_KEY = 'evolvetype.bookmarks';

function restoreBookmarks() {
    try {
        state.bookmarks = JSON.parse(localStorage.getItem(BM_KEY) || '[]');
    } catch { state.bookmarks = []; }
    renderBookmarks();
}

function persistBookmarks() {
    try { localStorage.setItem(BM_KEY, JSON.stringify(state.bookmarks)); }
    catch { toast('Storage full — bookmark not saved'); }
}

function addBookmark(i) {
    const g = state.genomes[i];
    if (!g) return;
    state.bookmarks.unshift({
        id: Date.now() + ':' + Math.random().toString(36).slice(2, 7),
        text: state.text,
        text2: state.text2,
        name: g.name || 'Untitled',
        genome: deepClone(g),
    });
    state.bookmarks = state.bookmarks.slice(0, 40);
    persistBookmarks();
    renderBookmarks();
    toast('Saved');
}

function renderBookmarks() {
    const box = $('bookmarks');
    box.innerHTML = '';
    if (!state.bookmarks.length) {
        box.innerHTML = `<p class="hint">Nothing saved yet. Use the star button on a variation.</p>`;
        return;
    }
    for (const bm of state.bookmarks) {
        const row = document.createElement('div');
        row.className = 'bm';
        const sw = document.createElement('canvas');
        sw.className = 'sw'; sw.width = 68; sw.height = 40;
        const label = document.createElement('span');
        label.className = 't';
        label.textContent = `${bm.text} · ${bm.name}`;
        const del = document.createElement('button');
        del.textContent = '×'; del.title = 'Remove';
        row.append(sw, label, del);
        box.appendChild(row);

        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
            state.text = bm.text;
            state.text2 = bm.text2 || '';
            $('text-input').value = state.text;
            $('text2-input').value = state.text2;
            persistText();
            state.aspect = bm.genome.aspect || '16:9';
            syncAspectButtons();
            applyAspectToCells();
            setGeneration(evolveGeneration(normalizeGenome(bm.genome), fontIds(), getOpts()), 4);
            syncTypeControls();
        });
        del.addEventListener('click', () => {
            state.bookmarks = state.bookmarks.filter(b => b.id !== bm.id);
            persistBookmarks(); renderBookmarks();
        });

        // Thumbnail is a baked frame partway through the entrance, where the
        // animation is most recognisable.
        const cyc = genomeCycle(bm.genome, bm.text, bm.text2 || '');
        const svg = genomeToSVG(bm.genome, bm.text, { mode: 'frame', t: cyc * 0.55, uid: 'bm', secondaryText: bm.text2 || '' });
        rasterize(svg, 68, 40).then(c => sw.getContext('2d').drawImage(c, 0, 0))
            .catch(() => {});
    }
}

// ─── Import ───────────────────────────────────────────────────────────────

function handleSVGText(svgText) {
    const st = extractState(svgText);
    if (!st || !st.genome) { toast('No evolveType genome in that SVG'); return; }
    state.text = st.text || state.text;
    state.text2 = st.secondaryText || '';
    $('text-input').value = state.text;
    $('text2-input').value = state.text2;
    persistText();
    const g = normalizeGenome(st.genome);
    state.aspect = g.aspect;
    syncAspectButtons();
    applyAspectToCells();
    setGeneration(evolveGeneration(g, fontIds(), getOpts()), 4);
    syncTypeControls();
    toast('Genome restored');
}

// ─── Typography controls (applied to the parent) ──────────────────────────

function syncTypeControls() {
    const g = state.genomes[4] || state.genomes[state.selected];
    if (!g) return;
    $('font-sel').value = g.type.fontId;
    $('case-sel').value = g.type.case;
    $('size').value = String(g.type.size);
    $('tracking').value = String(g.type.letterSpacing);
    syncSecondaryControls();
    syncSliderLabels();
}

function applyTypeChange(key, value) {
    const parent = state.genomes[4];
    if (!parent) return;
    const g = deepClone(parent);
    g.type[key] = value;
    setGeneration(evolveGeneration(g, fontIds(), getOpts()), 4);
}

// ─── UI wiring ────────────────────────────────────────────────────────────

function wireUI() {
    let textTimer = null;
    const onTextInput = () => {
        state.text = $('text-input').value;
        state.text2 = $('text2-input').value;
        persistText();
        clearTimeout(textTimer);
        textTimer = setTimeout(() => { renderAll(); }, 180);
    };
    $('text-input').addEventListener('input', onTextInput);
    $('text2-input').addEventListener('input', () => {
        // Typing into the empty secondary field should just work, rather than
        // silently doing nothing until the checkbox is found.
        if ($('text2-input').value.trim() && !$('sec-on').checked) {
            $('sec-on').checked = true;
            applySecondary('enabled', true);
        }
        onTextInput();
    });

    $('sec-on').addEventListener('change', e => {
        applySecondary('enabled', e.target.checked);
        syncSecondaryControls();
    });
    $('sec-pos').addEventListener('change', e => applySecondary('position', e.target.value));
    $('sec-font').addEventListener('change', e => applySecondary('fontId', e.target.value || null));
    $('sec-size').addEventListener('change', e => applySecondary('size', +e.target.value));
    $('sec-gap').addEventListener('change', e => applySecondary('gap', +e.target.value));
    $('sec-track').addEventListener('change', e => applySecondary('letterSpacing', +e.target.value));
    $('sec-delay').addEventListener('change', e => applySecondary('delayOffset', +e.target.value));
    for (const id of ['sec-size', 'sec-gap', 'sec-track', 'sec-delay']) {
        $(id).addEventListener('input', syncSliderLabels);
    }

    $('aspect-seg').addEventListener('click', e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        state.aspect = b.dataset.a;
        syncAspectButtons();
        applyAspectToCells();
        state.genomes = state.genomes.map(g => g ? { ...g, aspect: state.aspect } : g);
        renderAll();
    });

    $('evolve').addEventListener('click', evolve);
    $('randomize').addEventListener('click', () => {
        state.activePreset = null;
        document.querySelectorAll('.preset').forEach(el => el.classList.remove('active'));
        setGeneration(evolveGeneration(randomGenome(fontIds()), fontIds(), getOpts()), 4);
        syncTypeControls();
        toast('Randomized');
    });
    $('reroll').addEventListener('click', () => {
        for (let i = 0; i < 9; i++) if (state.genomes[i]) state.genomes[i] = rerollPalette(state.genomes[i]);
        renderAll();
        toast('New colours');
    });

    $('undo').addEventListener('click', undo);
    $('redo').addEventListener('click', redo);

    for (const id of ['paramRange', 'structureRate', 'effectRate', 'colorRange']) {
        $(id).addEventListener('input', syncSliderLabels);
    }

    $('font-sel').addEventListener('change', e => applyTypeChange('fontId', e.target.value));
    $('case-sel').addEventListener('change', e => applyTypeChange('case', e.target.value));
    $('size').addEventListener('change', e => applyTypeChange('size', +e.target.value));
    $('tracking').addEventListener('change', e => applyTypeChange('letterSpacing', +e.target.value));
    $('size').addEventListener('input', syncSliderLabels);
    $('tracking').addEventListener('input', syncSliderLabels);

    $('playpause').addEventListener('click', () => setPlaying(!state.playing));
    $('restart').addEventListener('click', restartAll);
    $('ov-playpause').addEventListener('click', () => setPlaying(!state.playing));
    $('ov-restart').addEventListener('click', restartAll);
    $('ov-scrub').addEventListener('input', e => scrubTo(+e.target.value / 1000 * activeCycle()));

    // Two-finger trackpad scroll drives the timeline directly: one gesture maps
    // straight onto loop position with no smoothing or momentum of our own, so
    // the frame under the cursor tracks the fingers.
    const onWheel = e => {
        if (e.ctrlKey) return;                 // pinch-zoom, not a scroll
        e.preventDefault();
        // Trackpad momentum keeps firing for a while after the fingers lift;
        // without this, pressing play mid-glide is immediately undone by the
        // tail of the gesture yanking the playhead back.
        if (performance.now() < wheelLockUntil) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        scrubTo(state.time - (d / WHEEL_PX_PER_LOOP) * activeCycle());
    };
    $('grid-wrap').addEventListener('wheel', onWheel, { passive: false });
    $('overlay').addEventListener('wheel', onWheel, { passive: false });
    $('scrub').addEventListener('input', e => scrubTo(+e.target.value / 1000 * activeCycle()));

    $('ex-svg').addEventListener('click', doExportSVG);
    $('ex-png').addEventListener('click', doExportPNG);
    $('ex-seq').addEventListener('click', doExportSequence);

    $('save-bm').addEventListener('click', () => addBookmark(state.selected));
    $('load-svg').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (f) handleSVGText(await f.text());
        e.target.value = '';
    });

    $('ov-close').addEventListener('click', closeOverlay);
    $('ov-select').addEventListener('click', () => {
        if (overlayIdx >= 0) { selectCell(overlayIdx); closeOverlay(); }
    });

    document.addEventListener('keydown', e => {
        // Selects are excluded too — Space opens their dropdown natively, and
        // swallowing that to restart would be worse than losing the shortcut
        // while one happens to be focused.
        if (e.target.matches('input[type=text], textarea, select')) return;
        if (e.key === 'Escape') closeOverlay();
        // preventDefault also stops Space from re-triggering a focused button,
        // so clicking a transport button then pressing Space won't fire twice.
        else if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
        else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restartAll(); }
        else if (e.key === 'Enter') evolve();
        else if (e.key >= '1' && e.key <= '9') selectCell(+e.key - 1);
        else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    });

    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f && /svg/.test(f.type + f.name)) handleSVGText(await f.text());
    });

    syncSliderLabels();
    syncAspectButtons();
}

function syncAspectButtons() {
    document.querySelectorAll('#aspect-seg [data-a]').forEach(b =>
        b.classList.toggle('on', b.dataset.a === state.aspect));
}

function syncSliderLabels() {
    $('paramRange-v').textContent = (+$('paramRange').value).toFixed(2);
    $('structureRate-v').textContent = (+$('structureRate').value).toFixed(2);
    $('effectRate-v').textContent = (+$('effectRate').value).toFixed(2);
    $('colorRange-v').textContent = (+$('colorRange').value).toFixed(2);
    $('size-v').textContent = (+$('size').value).toFixed(3);
    $('tracking-v').textContent = (+$('tracking').value).toFixed(3) + ' em';
    $('sec-size-v').textContent = (+$('sec-size').value).toFixed(3);
    $('sec-gap-v').textContent = (+$('sec-gap').value).toFixed(3);
    $('sec-track-v').textContent = (+$('sec-track').value).toFixed(3) + ' em';
    $('sec-delay-v').textContent = (+$('sec-delay').value).toFixed(2) + ' s';
}

function undo() {
    if (!state.history.length) return;
    state.future.push({ genomes: state.genomes.map(g => g && deepClone(g)), selected: state.selected });
    const prev = state.history.pop();
    state.genomes = prev.genomes;
    state.selected = prev.selected;
    renderAll();
    updateHistoryButtons();
}

function redo() {
    if (!state.future.length) return;
    state.history.push({ genomes: state.genomes.map(g => g && deepClone(g)), selected: state.selected });
    const next = state.future.pop();
    state.genomes = next.genomes;
    state.selected = next.selected;
    renderAll();
    updateHistoryButtons();
}

function updateHistoryButtons() {
    $('undo').disabled = !state.history.length;
    $('redo').disabled = !state.future.length;
}

// ─── Export handlers ──────────────────────────────────────────────────────

function currentGenome() { return state.genomes[state.selected] || state.genomes[4]; }

function doExportSVG() {
    const g = currentGenome();
    if (!g) return;
    const scale = +$('scale-sel').value;
    downloadBlob(exportSVG(g, state.text, scale, state.text2), `${safeName(state.text)}-${safeName(g.name)}.svg`);
    toast('Animated SVG exported');
}

async function doExportPNG() {
    const g = currentGenome();
    if (!g) return;
    const scale = +$('scale-sel').value;
    const cyc = genomeCycle(g, state.text, state.text2);
    // Paused, export exactly the frame on screen; playing, take the settled pose.
    const t = state.playing ? cyc * 0.9 : state.time;
    try {
        const png = await exportPoster(g, state.text, t, scale, state.text2);
        downloadBlob(png, `${safeName(state.text)}-poster.png`);
        toast('Poster exported');
    } catch (err) { toast(`PNG export failed: ${err.message}`); }
}

async function doExportSequence() {
    const g = currentGenome();
    if (!g) return;
    const btn = $('ex-seq');
    // Preserve the markup, not just the text — the label carries an icon, and
    // writing textContent would strip it permanently.
    const label = btn.innerHTML;
    const scale = +$('scale-sel').value;
    const fps = +$('fps-sel').value;
    btn.disabled = true;
    try {
        const zip = await exportFrameSequence(g, state.text, {
            fps, scale, secondaryText: state.text2,
            onProgress: (d, t) => { btn.textContent = `Rendering ${d}/${t}…`; },
        });
        downloadBlob(zip, `${safeName(state.text)}-${fps}fps-frames.zip`);
        toast('Frame sequence exported');
    } catch (err) {
        toast(`Sequence export failed: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = label;
    }
}

// ─── Toast ────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
}
