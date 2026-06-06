// js/render.js — requires: js/storage.js
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeAttribute(value) {
  return escapeHtml(value);
}

// --- Add: Simple Markdown to HTML converter ---
function renderMarkdown(md) {
    if (!md) return '';
    // Escape HTML
    md = md.replace(/[&<>]/g, function(tag) {
        const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
        return chars[tag] || tag;
    });
    // Code blocks (```)
    md = md.replace(/```([^`]+)```/g, function(_, code) {
        return `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    });
    // Inline code (`code`)
    md = md.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold (**text** or __text__)
    md = md.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    md = md.replace(/__(.*?)__/g, '<strong>$1</strong>');
    // Italic (*text* or _text_)
    md = md.replace(/\*(.*?)\*/g, '<em>$1</em>');
    md = md.replace(/_(.*?)_/g, '<em>$1</em>');
    // Links [text](url)
    md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Unordered lists
    md = md.replace(/(^|\n)[ \t]*[-*+] (.*?)(?=\n|$)/g, '$1<li>$2</li>');
    md = md.replace(/(<li>.*<\/li>)/gs, function(list) {
        return `<ul>${list.replace(/\n+/g, '')}</ul>`;
    });
    // Ordered lists
    md = md.replace(/(^|\n)[ \t]*\d+\.\s+(.*?)(?=\n|$)/g, '$1<ol><li>$2</li></ol>');
    // Line breaks (double newline = paragraph)
    md = md.replace(/\n{2,}/g, '</p><p>');
    // Single newline = <br>
    md = md.replace(/\n/g, '<br>');
    // Wrap in <p>
    return `<p>${md}</p>`;
}

// --- Tooltip helpers: show/hide floating tooltip (only visible when mouse is on target) ---
let tooltipHoverState = { overTarget: false, hideTimeout: null };

function showWorldKnowledgeModal() {
    // Build modal on demand — no persistent DOM element needed
    var existing = document.getElementById('worldKnowledgeModal');
    if (existing) existing.remove();

    // --- Gather data ---
    var worldName = '';
    var otherChars = [];
    var worldNpcs = [];    // world-level NPC records
    var worldLocations = []; // world-level location records
    if (typeof currentWorldId !== 'undefined' && currentWorldId && typeof getWorld === 'function') {
        var world = getWorld(currentWorldId);
        if (world) {
            worldName = world.name || '';
            var charId = typeof currentCharacterId !== 'undefined' ? currentCharacterId : null;
            otherChars = (Array.isArray(world.characters) ? world.characters : []).filter(function(c) {
                return c.id !== charId && c.character && c.character.name;
            });
            worldNpcs = Array.isArray(world.npcs) ? world.npcs : [];
            worldLocations = Array.isArray(world.locations) ? world.locations : [];
        }
    }

    // Current-session badges: nearby vs departed
    var nearbyNames = new Set(
        (typeof environmentData !== 'undefined' && Array.isArray(environmentData && environmentData.people)
            ? environmentData.people : []).map(function(p) { return String(p.name).toLowerCase().trim(); })
    );
    var departedNames = new Set(
        (typeof removedNearbyCharacters !== 'undefined' && Array.isArray(removedNearbyCharacters)
            ? removedNearbyCharacters : []).map(function(p) { return String(p.name).toLowerCase().trim(); })
    );

    // Live opinion lookup (current session data) by name
    var liveNpcMap = {};
    (typeof environmentData !== 'undefined' && Array.isArray(environmentData && environmentData.people)
        ? environmentData.people : []).forEach(function(p) {
        liveNpcMap[String(p.name).toLowerCase().trim()] = p;
    });
    (typeof removedNearbyCharacters !== 'undefined' && Array.isArray(removedNearbyCharacters)
        ? removedNearbyCharacters : []).forEach(function(p) {
        var k = String(p.name).toLowerCase().trim();
        if (!liveNpcMap[k]) liveNpcMap[k] = p;
    });

    var currentLocation = (typeof environmentData !== 'undefined' && environmentData) ? {
        location: environmentData.location || '',
        time_of_day: environmentData.time_of_day || '',
        temperature: environmentData.temperature || '',
        vibe: environmentData.vibe || '',
        sounds: environmentData.sounds || ''
    } : null;

    // --- Build HTML ---
    function opinionColor(val) {
        if (val === null || val === undefined || val === '') return '#aaa';
        var n = parseFloat(val);
        if (isNaN(n)) return '#aaa';
        if (n >= 0.6) return '#81c995';
        if (n >= 0.2) return '#a8c7fa';
        if (n >= -0.2) return '#c5c8ce';
        if (n >= -0.6) return '#ffb74d';
        return '#e57373';
    }

    function worldNpcHtml(wn) {
        var key = String(wn.name).toLowerCase().trim();
        var live = liveNpcMap[key];
        var op = live ? ((live.opinions && typeof live.opinions.overall === 'number') ? live.opinions.overall : live.opinion) : undefined;
        var opStr = (op !== undefined && op !== null && !isNaN(parseFloat(op))) ? parseFloat(op).toFixed(2) : '';
        var opColor = opinionColor(op);
        var badge = nearbyNames.has(key) ? 'nearby' : (departedNames.has(key) ? 'departed' : '');
        var desc = (live && live.short_description) ? live.short_description : wn.description;
        var meta = [];
        if (wn.gender) meta.push(wn.gender);
        if (wn.last_location) meta.push('Last seen: ' + wn.last_location);
        if (Array.isArray(wn.known_by) && wn.known_by.length) meta.push('Known by: ' + wn.known_by.join(', '));
        var memoriesHtml = '';
        if (Array.isArray(wn.memories) && wn.memories.length > 0) {
            memoriesHtml = `<div class="wk-person-memories">
                <div class="wk-person-memories-label">Memories</div>
                ${wn.memories.map(function(m) { return `<div class="wk-person-memory-entry">${escapeHtml(m)}</div>`; }).join('')}
            </div>`;
        }
        return `<div class="wk-person">
            <div class="wk-person-top">
                <span class="wk-person-name">${escapeHtml(wn.name || '')}</span>
                ${opStr ? `<span class="wk-person-opinion" style="color:${opColor}">${opStr}</span>` : ''}
                ${badge ? `<span class="wk-person-badge">${badge}</span>` : ''}
            </div>
            ${desc ? `<div class="wk-person-desc">${escapeHtml(desc)}</div>` : ''}
            ${meta.length ? `<div class="wk-person-meta">${escapeHtml(meta.join(' · '))}</div>` : ''}
            ${memoriesHtml}
        </div>`;
    }

    var otherCharsHtml = otherChars.length
        ? otherChars.map(function(c) {
            var ch = c.character;
            var sub = [ch.position, ch.age ? 'Age ' + ch.age : '', ch.gender].filter(Boolean).join(' · ');
            return `<div class="wk-char-card">
                <div class="wk-char-name">${escapeHtml(ch.name || '')}</div>
                ${sub ? `<div class="wk-char-sub">${escapeHtml(sub)}</div>` : ''}
                ${ch.description ? `<div class="wk-char-desc">${escapeHtml(ch.description)}</div>` : ''}
            </div>`;
        }).join('')
        : '<div class="wk-empty">No other characters in this world yet.</div>';

    var allPeopleHtml = worldNpcs.length
        ? worldNpcs.map(worldNpcHtml).join('')
        : '<div class="wk-empty">No NPCs encountered yet.</div>';

    // Locations: show world-level list with current location highlighted
    var currentLocName = currentLocation && currentLocation.location ? currentLocation.location.toLowerCase().trim() : '';
    var locRowsHtml = '';
    if (worldLocations.length) {
        locRowsHtml = worldLocations.map(function(l) {
            var isCurrent = currentLocName && String(l.name).toLowerCase().trim() === currentLocName;
            return `<div class="wk-location-row${isCurrent ? ' wk-location-current' : ''}">
                <span class="wk-location-label">${escapeHtml(l.name)}</span>
                <span class="wk-location-val">${isCurrent ? '<span class="wk-location-badge">here now</span>' : ''}${l.last_visited_by ? escapeHtml('Visited by ' + l.last_visited_by) : ''}</span>
            </div>`;
        }).join('');
    }
    // Always show current environment details at top of location tab
    var currentEnvHtml = currentLocation && currentLocation.location ? `
        <div class="wk-location-env-block">
            ${currentLocation.time_of_day ? `<div class="wk-location-env-row"><span class="wk-location-env-label">Time</span><span>${escapeHtml(currentLocation.time_of_day)}</span></div>` : ''}
            ${currentLocation.temperature ? `<div class="wk-location-env-row"><span class="wk-location-env-label">Temp</span><span>${escapeHtml(currentLocation.temperature)}</span></div>` : ''}
            ${currentLocation.vibe ? `<div class="wk-location-env-row"><span class="wk-location-env-label">Vibe</span><span>${escapeHtml(currentLocation.vibe)}</span></div>` : ''}
            ${currentLocation.sounds ? `<div class="wk-location-env-row"><span class="wk-location-env-label">Sounds</span><span>${escapeHtml(currentLocation.sounds)}</span></div>` : ''}
        </div>` : '';
    var locationHtml = (locRowsHtml || currentEnvHtml)
        ? (locRowsHtml ? `<div class="wk-location-list-header">Visited Locations</div>${locRowsHtml}` : '') + currentEnvHtml
        : '<div class="wk-empty">No location data available.</div>';

    // --- Assemble modal ---
    var modal = document.createElement('div');
    modal.id = 'worldKnowledgeModal';
    modal.className = 'wk-modal';
    modal.innerHTML = `
        <div class="wk-box">
            <div class="wk-header">
                <span class="wk-title">${worldName ? escapeHtml(worldName) : 'World Knowledge'}</span>
                <button class="wk-close" aria-label="Close">&#x2715;</button>
            </div>
            <div class="wk-tabs">
                <button class="wk-tab active" data-tab="people">People</button>
                <button class="wk-tab" data-tab="characters">Characters</button>
                <button class="wk-tab" data-tab="location">Location</button>
            </div>
            <div class="wk-body">
                <div class="wk-panel active" data-panel="people">${allPeopleHtml}</div>
                <div class="wk-panel" data-panel="characters">${otherCharsHtml}</div>
                <div class="wk-panel" data-panel="location">${locationHtml}</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    // Tab switching
    modal.querySelectorAll('.wk-tab').forEach(function(tab) {
        tab.onclick = function() {
            modal.querySelectorAll('.wk-tab').forEach(function(t) { t.classList.remove('active'); });
            modal.querySelectorAll('.wk-panel').forEach(function(p) { p.classList.remove('active'); });
            tab.classList.add('active');
            var panel = modal.querySelector('.wk-panel[data-panel="' + tab.getAttribute('data-tab') + '"]');
            if (panel) panel.classList.add('active');
        };
    });

    function close() {
        modal.remove();
        document.removeEventListener('keydown', onKey);
    }
    modal.querySelector('.wk-close').onclick = close;
    modal.onclick = function(e) { if (e.target === modal) close(); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    // Animate in
    requestAnimationFrame(function() { modal.classList.add('open'); });
}

function showStoryLogModal(fullLog, onSave) {
    var modal = document.getElementById('storyLogModal');
    var body = document.getElementById('storyLogModalBody');
    var closeBtn = document.getElementById('storyLogModalClose');
    var header = document.getElementById('storyLogModalHeader');
    if (!modal || !body || !header) return;

    var isEditing = false;

    function renderViewMode() {
        isEditing = false;
        body.innerHTML = '';
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = fullLog || '(No story log yet.)';
        setTimeout(function() { body.scrollTop = body.scrollHeight; }, 0);

        // Header: title + edit btn + close
        header.innerHTML = '';
        var title = document.createElement('span');
        title.id = 'storyLogModalTitle';
        title.textContent = 'Story Log';
        header.appendChild(title);
        var rightBtns = document.createElement('div');
        rightBtns.style.cssText = 'display:flex;gap:0.5em;align-items:center;';
        if (typeof onSave === 'function') {
            var editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.style.cssText = 'background:none;border:1px solid hsl(var(--accent-h),40%,38%);color:hsl(var(--accent-h),70%,72%);border-radius:6px;padding:0.2em 0.7em;font-size:0.9em;cursor:pointer;';
            editBtn.onclick = function() { renderEditMode(); };
            rightBtns.appendChild(editBtn);
        }
        var closeBtnNew = document.createElement('button');
        closeBtnNew.id = 'storyLogModalClose';
        closeBtnNew.setAttribute('aria-label', 'Close story log');
        closeBtnNew.textContent = '✕';
        closeBtnNew.style.cssText = 'background:none;border:none;color:#888;font-size:1.3em;cursor:pointer;line-height:1;padding:0 0.2em;';
        closeBtnNew.onmouseenter = function() { closeBtnNew.style.color = '#ccc'; };
        closeBtnNew.onmouseleave = function() { closeBtnNew.style.color = '#888'; };
        closeBtnNew.onclick = close;
        rightBtns.appendChild(closeBtnNew);
        header.appendChild(rightBtns);
    }

    function renderEditMode() {
        isEditing = true;
        body.innerHTML = '';
        body.style.whiteSpace = '';

        var textarea = document.createElement('textarea');
        textarea.value = fullLog || '';
        textarea.style.cssText = 'width:100%;height:100%;min-height:12em;resize:none;background:#181b1e;color:#c5c8ce;border:1px solid hsl(var(--accent-h),30%,30%);border-radius:8px;padding:0.7em;font-size:0.97em;line-height:1.65;box-sizing:border-box;font-family:inherit;';
        body.appendChild(textarea);
        setTimeout(function() { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); }, 0);

        // Header: title + save + cancel + close
        header.innerHTML = '';
        var title = document.createElement('span');
        title.id = 'storyLogModalTitle';
        title.textContent = 'Story Log';
        header.appendChild(title);
        var rightBtns = document.createElement('div');
        rightBtns.style.cssText = 'display:flex;gap:0.5em;align-items:center;';

        var saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'background:hsl(var(--accent-h),55%,42%);border:none;color:#fff;border-radius:6px;padding:0.2em 0.8em;font-size:0.9em;cursor:pointer;';
        saveBtn.onclick = function() {
            fullLog = textarea.value;
            if (typeof onSave === 'function') onSave(fullLog);
            renderViewMode();
        };

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'background:none;border:1px solid #555;color:#aaa;border-radius:6px;padding:0.2em 0.7em;font-size:0.9em;cursor:pointer;';
        cancelBtn.onclick = function() { renderViewMode(); };

        var closeBtnNew = document.createElement('button');
        closeBtnNew.setAttribute('aria-label', 'Close story log');
        closeBtnNew.textContent = '✕';
        closeBtnNew.style.cssText = 'background:none;border:none;color:#888;font-size:1.3em;cursor:pointer;line-height:1;padding:0 0.2em;';
        closeBtnNew.onclick = close;

        rightBtns.appendChild(saveBtn);
        rightBtns.appendChild(cancelBtn);
        rightBtns.appendChild(closeBtnNew);
        header.appendChild(rightBtns);
    }

    modal.classList.add('open');
    renderViewMode();

    function close() {
        modal.classList.remove('open');
        modal.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKey);
    }
    function onOverlayClick(e) { if (e.target === modal) close(); }
    function onKey(e) {
        if (e.key === 'Escape') {
            if (isEditing) { renderViewMode(); } else { close(); }
        }
    }
    modal.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
}

function showGlobalTooltip(html, anchorElem) {
    let tooltip = document.getElementById('global-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'global-tooltip';
        tooltip.style.position = 'fixed';
        tooltip.style.zIndex = 999999;
        tooltip.style.pointerEvents = 'none';
        tooltip.style.background = '#23272a';
        tooltip.style.color = '#e4e6eb';
        tooltip.style.border = '1px solid #444';
        tooltip.style.borderRadius = '7px';
        tooltip.style.padding = '0.6em 0.8em';
        tooltip.style.fontSize = '0.98em';
        tooltip.style.minWidth = '180px';
        tooltip.style.maxWidth = '320px';
        tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.28)';
        tooltip.style.whiteSpace = 'normal';
        tooltip.style.opacity = '0';
        tooltip.style.transition = 'opacity 0.18s cubic-bezier(.4,0,.2,1), transform 0.18s cubic-bezier(.4,0,.2,1)';
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = html;

    // --- FIX: Do not show tooltip until after positioning ---
    tooltip.style.display = 'block';
    tooltip.style.opacity = '0';
    tooltip.style.left = '-9999px';
    tooltip.style.top = '-9999px';
    tooltip.style.transform = 'none';

    // Position tooltip centered to anchorElem, above or below, and keep on screen
    const rect = anchorElem.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    setTimeout(() => {
        // Only position if still visible (user may have moved off)
        if (tooltip.style.display !== 'block') return;
        const tipRect = tooltip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2 + scrollX;
        let top = rect.bottom + 8 + scrollY; // Default: below

        // If not enough space below, show above
        if (top + tipRect.height > window.innerHeight + scrollY) {
            top = rect.top - tipRect.height - 8 + scrollY;
        }
        // Clamp left/right to viewport
        if (left < 8 + scrollX) left = 8 + scrollX;
        if (left + tipRect.width > window.innerWidth + scrollX - 8) {
            left = window.innerWidth + scrollX - tipRect.width - 8;
        }
        // Clamp top to viewport
        if (top < 8 + scrollY) top = 8 + scrollY;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.transform = 'none';
        // Only now fade in
        tooltip.style.opacity = '1';
    }, 0);
}

function hideGlobalTooltip(immediate = false) {
    const tooltip = document.getElementById('global-tooltip');
    if (tooltip) {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.style.display = 'none';
        }, immediate ? 0 : 120);
    }
}

function scheduleTooltipHide() {
    clearTimeout(tooltipHoverState.hideTimeout);
    tooltipHoverState.hideTimeout = setTimeout(() => {
        if (!tooltipHoverState.overTarget) {
            hideGlobalTooltip();
        }
    }, 80);
}

function clampOpinionValue(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(-0.99, Math.min(0.99, Number(fallback) || 0));
    return Math.max(-0.99, Math.min(0.99, n));
}

function normalizeNpcOpinions(person) {
    const profile = {
        overall: 0,
        familiarity: 0,
        trust: 0,
        loyalty: 0,
        touch_comfort: 0
    };
    if (!person || typeof person !== 'object') return profile;

    if (typeof person.opinion === 'number') {
        profile.overall = clampOpinionValue(person.opinion, profile.overall);
    }

    const src = person.opinions && typeof person.opinions === 'object'
        ? person.opinions
        : person;
    const pick = (keys, fallback) => {
        for (const key of keys) {
            if (src && Object.prototype.hasOwnProperty.call(src, key)) {
                return clampOpinionValue(src[key], fallback);
            }
        }
        return clampOpinionValue(fallback, 0);
    };

    profile.overall = pick(['overall', 'overall_opinion', 'opinion'], profile.overall);
    profile.familiarity = pick(['familiarity', 'acquaintance', 'acquaintance_like', 'acquaintance_opinion'], profile.familiarity);
    profile.trust = pick(['trust', 'trust_opinion'], profile.trust);
    profile.loyalty = pick(['loyalty', 'loyalty_opinion'], profile.loyalty);
    profile.touch_comfort = pick(
        ['touch_comfort', 'physical_boundary', 'physical_boundaries', 'physical_boundary_level', 'physical_touch_comfort'],
        profile.touch_comfort
    );
    return profile;
}

function getOpinionBandLabel(value) {
    if (value >= 0.7) return 'Very Friendly';
    if (value >= 0.2) return 'Friendly';
    if (value > -0.2) return 'Neutral';
    if (value > -0.7) return 'Unfriendly';
    return 'Hostile';
}

function getMetricPostureLabel(metric, value) {
    if (metric === 'familiarity') {
        if (value >= 0.7) return 'Very Familiar';
        if (value >= 0.2) return 'Acquainted';
        if (value > -0.2) return 'Recognizes You';
        if (value > -0.7) return 'Distant';
        return 'Stranger';
    }
    if (metric === 'trust') {
        if (value >= 0.7) return 'Deep Trust';
        if (value >= 0.2) return 'Trusting';
        if (value > -0.2) return 'Unsure';
        if (value > -0.7) return 'Skeptical';
        return 'Distrustful';
    }
    if (metric === 'loyalty') {
        if (value >= 0.7) return 'Devoted';
        if (value >= 0.2) return 'Supportive';
        if (value > -0.2) return 'Independent';
        if (value > -0.7) return 'Detached';
        return 'Opposed';
    }
    if (metric === 'touch_comfort') {
        if (value >= 0.7) return 'Highly Comfortable';
        if (value >= 0.2) return 'Comfortable';
        if (value > -0.2) return 'Neutral Boundaries';
        if (value > -0.7) return 'Guarded';
        return 'No Touch';
    }
    return getOpinionBandLabel(value);
}

function buildNpcOpinionTooltipHtml(person) {
    const profile = normalizeNpcOpinions(person);
    const esc = (value) => {
        if (typeof escapeHtml === 'function') return escapeHtml(String(value || ''));
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
    const name = esc(person && person.name ? String(person.name) : 'Unknown');
    const desc = esc(person && person.short_description ? String(person.short_description) : '');
    const gender = esc(person && person.gender ? String(person.gender) : 'unknown');
    const overallColor = opinionToColor(profile.overall);
    const metricRow = (label, metricKey, value) => {
        const color = opinionToColor(value);
        const posture = getMetricPostureLabel(metricKey, value);
        return `<div><strong>${label}:</strong> <span style="color:${color};font-weight:600;">${value.toFixed(2)}</span> <span style="color:#9aa0a6;">${posture}</span></div>`;
    };

    let html = `<div><strong>${name}</strong></div>`;
    if (desc) html += `<div style="color:#b0b3b8;margin-top:0.2em;">${desc}</div>`;
    html += `<div style="margin-top:0.35em;color:#b0b3b8;">${gender}</div>`;
    html += `<div style="margin-top:0.35em;"><strong>Overall:</strong> <span style="color:${overallColor};font-weight:700;">${profile.overall.toFixed(2)}</span> <span style="color:#9aa0a6;">${getOpinionBandLabel(profile.overall)}</span></div>`;
    html += `<div style="height:1px;background:#3a4149;margin:0.4em 0;"></div>`;
    html += metricRow('Familiarity', 'familiarity', profile.familiarity);
    html += metricRow('Trust', 'trust', profile.trust);
    html += metricRow('Loyalty', 'loyalty', profile.loyalty);
    html += metricRow('Touch Comfort', 'touch_comfort', profile.touch_comfort);
    return html;
}

// --- Helper: Render in-game sidebar ---
function renderGameSidebar() {
    if (!generatedCharacter || !environmentData) return;
    const removedNearbyHtml = Array.isArray(removedNearbyCharacters) && removedNearbyCharacters.length > 0
        ? (function() {
            function makeBtn(p) {
                const name = p && p.name ? String(p.name) : '';
                const escapedName = name.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const tooltipHtml = buildNpcOpinionTooltipHtml(p);
                return `<button class="game-sidebar-return-btn" type="button" data-person-name="${escapedName}" data-tooltip-html="${encodeURIComponent(tooltipHtml)}">Return ${escapedName}</button>`;
            }
            const count = removedNearbyCharacters.length;
            const allBtns = removedNearbyCharacters.map(p => makeBtn(p)).join('');
            return `<div style="margin-top:0.45em;">
                <button id="removedNearbyToggleBtn" type="button" style="background:transparent;border:none;color:#ffcc80;font-size:0.85em;opacity:0.9;cursor:pointer;padding:0;text-align:left;">Recently removed (${count}) ▸</button>
                <div id="removedNearbyList" class="removed-nearby-list" style="display:none;margin-top:0.4em;">${allBtns}</div>
            </div>`;
        })()
        : '';
    // --- Condensed environment section ---
    gameSidebar.innerHTML = `
        <div class="game-sidebar-brand">
            <span class="game-sidebar-brand-title dm-serif-text-regular">StoryboundAI</span><a href="about.html" target="_blank" title="About" style="display:inline-flex;align-items:center;justify-content:center;margin-left:0.5em;color:#FFFFFF;opacity:0.6;text-decoration:none;vertical-align:middle;" aria-label="About"><svg xmlns="http://www.w3.org/2000/svg" width="15px" height="15px" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16A8 8 0 0 0 10 2Zm0 1a7 7 0 1 1 0 14A7 7 0 0 1 10 3Zm0 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm0 4a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 10 10Z"/></svg></a>
            <button class="game-sidebar-settings-btn" id="settingsGearBtnSidebar" title="Settings" aria-label="Settings">
                <svg xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 20 20" fill="#FFFFFF" stroke="none" stroke-width="0" stroke-linecap="round" stroke-linejoin="round"><path d="M1.91 7.38A8.5 8.5 0 0 1 3.7 4.3a.5.5 0 0 1 .54-.13l1.92.68a1 1 0 0 0 1.32-.76l.36-2a.5.5 0 0 1 .4-.4 8.53 8.53 0 0 1 3.55 0c.2.04.35.2.38.4l.37 2a1 1 0 0 0 1.32.76l1.92-.68a.5.5 0 0 1 .54.13 8.5 8.5 0 0 1 1.78 3.08c.06.2 0 .4-.15.54l-1.56 1.32a1 1 0 0 0 0 1.52l1.56 1.32a.5.5 0 0 1 .15.54 8.5 8.5 0 0 1-1.78 3.08.5.5 0 0 1-.54.13l-1.92-.68a1 1 0 0 0-1.32.76l-.37 2a.5.5 0 0 1-.38.4 8.53 8.53 0 0 1-3.56 0 .5.5 0 0 1-.39-.4l-.36-2a1 1 0 0 0-1.32-.76l-1.92.68a.5.5 0 0 1-.54-.13 8.5 8.5 0 0 1-1.78-3.08.5.5 0 0 1 .15-.54l1.56-1.32a1 1 0 0 0 0-1.52L2.06 7.92a.5.5 0 0 1-.15-.54Zm1.06 0 1.3 1.1a2 2 0 0 1 0 3.04l-1.3 1.1c.3.79.72 1.51 1.25 2.16l1.6-.58a2 2 0 0 1 2.63 1.53l.3 1.67a7.56 7.56 0 0 0 2.5 0l.3-1.67a2 2 0 0 1 2.64-1.53l1.6.58a7.5 7.5 0 0 0 1.24-2.16l-1.3-1.1a2 2 0 0 1 0-3.04l1.3-1.1a7.5 7.5 0 0 0-1.25-2.16l-1.6.58a2 2 0 0 1-2.63-1.53l-.3-1.67a7.55 7.55 0 0 0-2.5 0l-.3 1.67A2 2 0 0 1 5.81 5.8l-1.6-.58a7.5 7.5 0 0 0-1.24 2.16ZM7.5 10a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Zm1 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z"/>
                </svg>
            </button>
        </div>
        <div class="game-sidebar-section">
            <div class="game-sidebar-title">Environment</div>
            <div class="game-sidebar-env"><strong>${environmentData.location || ''}</strong></div>
            <div style="display:flex;gap:1.2em;margin:0.3em 0 0.3em 0;">
                <span style="color:#b0b3b8;font-size:0.98em;">
                    <span style="opacity:0.7;">Time:</span><br>${environmentData.time_of_day || ''}
                </span>
                <span style="color:#b0b3b8;font-size:0.98em;">
                    <span style="opacity:0.7;">Temp:</span><br>${environmentData.temperature || ''}
                </span>
            </div>
            <div class="game-sidebar-env" style="font-size:0.98em;"><span style="opacity:0.7;">Vibe:</span> ${environmentData.vibe || ''}</div>
            <div class="game-sidebar-env" style="font-size:0.98em;"><span style="opacity:0.7;">Sounds:</span> ${environmentData.sounds || ''}</div>
            <div class="game-sidebar-env"><strong>People/Creatures Nearby:</strong>
                <ul style="margin:0.3em 0 0 0.3em; padding-left:0.3em; list-style:none;">
                    ${
                        Array.isArray(environmentData.people) && environmentData.people.length > 0
                            ? (
                                environmentData.people.length > 4
                                    ? environmentData.people.map(p => {
                                        const opinions = normalizeNpcOpinions(p);
                                        const opinionVal = opinions.overall;
                                        const color = opinionToColor(opinionVal);
                                        const opinionDisplay = `<span class="game-sidebar-opinion-hover" tabindex="0" data-tooltip-html="${encodeURIComponent(buildNpcOpinionTooltipHtml(p))}" style="color:${color};font-weight:200;font-size:0.8em;cursor:help;">${opinionVal.toFixed(2)}</span>`;
                                        const genderStr = p.gender ? p.gender : '';
                                        return `<li class="game-sidebar-person-item"><strong>${p.name}</strong> <span style="color:#b0b3b8;font-weight:300;font-size:0.9em;">(${genderStr})</span> ${opinionDisplay}</li>`;
                                    }).join('')
                                    : environmentData.people.map(p => {
                                        // original detailed per-character markup
                                        const opinions = normalizeNpcOpinions(p);
                                        let opinionVal = opinions.overall;
                                        let color = opinionToColor(opinionVal);
                                        let opinionDisplay = `<span class="game-sidebar-opinion-hover" tabindex="0" data-tooltip-html="${encodeURIComponent(buildNpcOpinionTooltipHtml(p))}" style="color:${color};font-weight:200;font-size:0.8em;cursor:help;">${opinionVal.toFixed(2)}</span>`;
                                        let label = opinionVal >= 0.7 ? "Very Friendly"
                                            : opinionVal >= 0.2 ? "Friendly"
                                            : opinionVal > -0.2 ? "Neutral"
                                            : opinionVal > -0.7 ? "Unfriendly"
                                            : "Hostile";
                                        let genderStr = p.gender ? ` (${p.gender})` : '';
                                        return `
                                            <strong>${p.name || ''}</strong>
                                            <span style="color:#b0b3b8; font-weight:300; font-size:0.9em;"> -${genderStr} ${p.short_description || ''}</span>
                                            (${opinionDisplay} <span style="color:#888;font-size:0.8em;">${label}</span>)
                                        `;
                                    }).join('<br>')
                            )
                            : `<li style="color:#888;font-style:italic;">Nobody, you are alone</li>`
                    }
                </ul>
                ${removedNearbyHtml}
            </div>
        </div>
        <div class="game-sidebar-section">
            <div class="game-sidebar-title">Inventory</div>
            <ul class="game-sidebar-inventory-list">
                ${(generatedCharacter.inventory || []).length > 0
                    ? generatedCharacter.inventory.map(item => {
                        const quantityAttr = (item && typeof item === 'object' && item.quantity > 1) ? `data-quantity="${item.quantity}"` : '';
                        if (typeof item === 'string') {
                            return `<li class="game-sidebar-inventory-item" ${quantityAttr}>${item}</li>`;
                        }
                        let tooltipRows = '';
                        if (item.description) {
                            tooltipRows += `<div><strong>Description:</strong> ${item.description}</div>`;
                        }
                        if (item.quantity !== undefined) {
                            tooltipRows += `<div><strong>Quantity:</strong> ${item.quantity}</div>`;
                        }
                        if (item.weight !== undefined) {
                            tooltipRows += `<div><strong>Weight:</strong> ${item.weight}</div>`;
                        }
                        return `<li class="game-sidebar-inventory-item" ${quantityAttr} tabindex="0" data-tooltip-html="${encodeURIComponent(
                            `<div><strong>${item.name || 'Item'}</strong></div>${tooltipRows}`)}">${item.name || 'Item'}</li>`;
                    }).join('')
                    : `<li class="game-sidebar-inventory-item">Empty</li>`
                }
            </ul>
        </div>
        <div class="game-sidebar-character-summary" id="sidebarCharSummary">
            <div class="schar-summary-info">
                <div class="schar-summary-name">${generatedCharacter.name || ''}</div>
                <div class="schar-summary-sub">${[generatedCharacter.position, generatedCharacter.age ? 'Age ' + generatedCharacter.age : '', generatedCharacter.gender].filter(Boolean).join(' · ')}</div>
            </div>
            <svg class="schar-summary-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M7 10l5 5 5-5z"/>
            </svg>
        </div>
        <div class="game-sidebar-character-details" id="sidebarCharDetails"></div>
    `;
    // Wire sidebar settings button
    var sidebarGearBtn = document.getElementById('settingsGearBtnSidebar');
    if (sidebarGearBtn) sidebarGearBtn.addEventListener('click', function() {
        if (typeof window.openSettings === 'function') window.openSettings();
    });
    // Attach inventory tooltips
    setTimeout(() => {
        gameSidebar.querySelectorAll('.game-sidebar-inventory-item[data-tooltip-html]').forEach(elem => {
            elem.onmouseenter = function(e) {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                const html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                showGlobalTooltip(html, this);
            };
            elem.onmouseleave = function(e) {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
            elem.onfocus = function(e) {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                const html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                showGlobalTooltip(html, this);
            };
            elem.onblur = function(e) {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
        });
    }, 0);
    // Attach opinion tooltips for nearby people
    setTimeout(() => {
        gameSidebar.querySelectorAll('.game-sidebar-opinion-hover[data-tooltip-html]').forEach(elem => {
            elem.onmouseenter = function() {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                const html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                showGlobalTooltip(html, this);
            };
            elem.onmouseleave = function() {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
            elem.onfocus = function() {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                const html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                showGlobalTooltip(html, this);
            };
            elem.onblur = function() {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
        });

        gameSidebar.querySelectorAll('.game-sidebar-return-btn[data-person-name]').forEach(btn => {
            const bindReturnTooltip = function() {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                const html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                if (!html) return;
                showGlobalTooltip(html, this);
            };
            btn.onclick = async function() {
                const name = this.getAttribute('data-person-name') || '';
                if (!name || typeof returnRemovedCharacterByName !== "function") return;
                this.disabled = true;
                try {
                    await returnRemovedCharacterByName(name);
                } finally {
                    this.disabled = false;
                }
            };
            btn.onmouseenter = bindReturnTooltip;
            btn.onmouseleave = function() {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
            btn.onfocus = bindReturnTooltip;
            btn.onblur = function() {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
        });
        // Wire toggle for recently removed list
        const removedToggleBtn = gameSidebar.querySelector('#removedNearbyToggleBtn');
        const removedList = gameSidebar.querySelector('#removedNearbyList');
        if (removedToggleBtn && removedList) {
            removedToggleBtn.onclick = function() {
                const expanded = removedList.style.display !== 'none';
                removedList.style.display = expanded ? 'none' : '';
                removedToggleBtn.textContent = removedToggleBtn.textContent.replace(expanded ? '▾' : '▸', expanded ? '▸' : '▾');
            };
        }
    }, 0);
    // Expand/collapse character details
    const summary = document.getElementById('sidebarCharSummary');
    const details = document.getElementById('sidebarCharDetails');
    if (summary && details) {
        details.innerHTML = renderSidebarCharDetailsHTML(generatedCharacter);
        var wkBtn = details.querySelector('#worldKnowledgeBtn');
        if (wkBtn) wkBtn.onclick = function(e) { e.stopPropagation(); showWorldKnowledgeModal(); };
        summary.onclick = function(e) {
            e.stopPropagation();
            const isOpen = details.classList.toggle('open');
            summary.classList.toggle('open', isOpen);
        };
        // Close when clicking outside
        if (renderGameSidebar._outsideClickHandler) {
            document.removeEventListener('click', renderGameSidebar._outsideClickHandler);
        }
        renderGameSidebar._outsideClickHandler = function(e) {
            if (details.classList.contains('open') &&
                !details.contains(e.target) &&
                !summary.contains(e.target)) {
                details.classList.remove('open');
                summary.classList.remove('open');
            }
        };
        document.addEventListener('click', renderGameSidebar._outsideClickHandler);
    }
}

function renderSidebarCharDetailsHTML(char) {
    const statsHtml = [
        char.height  ? `<div class="schar-stat"><span class="schar-stat-label">Height</span><span class="schar-stat-value">${char.height}</span></div>` : '',
        char.agility ? `<div class="schar-stat"><span class="schar-stat-label">Agility</span><span class="schar-stat-value">${char.agility}</span></div>` : '',
    ].filter(Boolean).join('');

    const limitationsHtml = Array.isArray(char.limitations) && char.limitations.length > 0
        ? `<div class="schar-tags">${char.limitations.map(l => `<span class="schar-tag">${l}</span>`).join('')}</div>`
        : '<span class="schar-none">None</span>';

    let abilitiesHtml = '';
    if (Array.isArray(char.abilities) && char.abilities.length > 0) {
        abilitiesHtml = `<div class="schar-section">
            <div class="schar-section-label">Abilities</div>
            ${char.abilities.map(item =>
                typeof item === 'string'
                    ? `<div class="schar-ability"><span class="schar-ability-name">${item}</span></div>`
                    : `<div class="schar-ability"><span class="schar-ability-name">${item.name || ''}</span>${item.description ? `<p class="schar-ability-desc">${item.description}</p>` : ''}</div>`
            ).join('')}
        </div>`;
    }

    return `
        ${statsHtml ? `<div class="schar-stats-grid">${statsHtml}</div>` : ''}
        ${char.description ? `<div class="schar-section"><div class="schar-section-label">Description</div><div class="schar-section-body">${char.description}</div></div>` : ''}
        ${char.flaws      ? `<div class="schar-section"><div class="schar-section-label">Flaws</div><div class="schar-section-body">${char.flaws}</div></div>` : ''}
        <div class="schar-section"><div class="schar-section-label">Limitations</div>${limitationsHtml}</div>
        ${abilitiesHtml}
        <button class="world-knowledge-btn" id="worldKnowledgeBtn" type="button">World Knowledge</button>
    `;
}
// --- Render action buttons ---
function renderActionButtons(actions) {
    actionButtonsArea.innerHTML = '';
    if (typeof syncNextTurnButton === "function") {
        syncNextTurnButton();
    }
    if (typeof setRegenerateActionsVisibility === "function") {
        setRegenerateActionsVisibility(actions);
    }
    if (actions === null || actions === undefined) {
        actionButtonsArea.innerHTML = '<div class="char-empty">Generating actions...</div>';
        return;
    }
    if (actions.length === 0) {
        actionButtonsArea.innerHTML = '<div class="char-empty">No actions available.</div>';
        return;
    }
    actions.forEach((a, i) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '0.7em';
        row.style.marginBottom = '0.3em';

        // Subtle text label for the action
        const label = document.createElement('span');
        if (typeof formatPlainTextWithCharacterHighlights === 'function') {
            label.innerHTML = formatPlainTextWithCharacterHighlights(a);
        } else {
            label.textContent = a;
        }
        label.style.fontSize = '1.07em';
        label.style.color = '#b0b3b8';
        label.style.background = 'none';
        label.style.padding = '0.18em 0.4em';
        label.style.borderRadius = '5px';
        label.style.flex = '1 1 auto';
        label.style.cursor = 'default';
        row.appendChild(label);

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.type = 'button';
        editBtn.style.fontSize = '0.97em';
        editBtn.style.padding = '0.18em 0.9em';
        editBtn.style.margin = '0';
        editBtn.style.background = '#23272a';
        editBtn.style.color = 'hsl(var(--accent-h),90%,77%)';
        editBtn.style.border = '1px solid hsl(var(--accent-h),37%,24%)';
        editBtn.style.borderRadius = '6px';
        editBtn.style.cursor = 'pointer';
        editBtn.style.opacity = '0.82';
        editBtn.style.transition = 'background 0.15s, color 0.15s, opacity 0.15s';
        editBtn.onmouseover = function() {
            editBtn.style.background = 'hsl(var(--accent-h),37%,24%)';
            editBtn.style.color = 'hsl(var(--accent-h),80%,83%)';
            editBtn.style.opacity = '1';
        };
        editBtn.onmouseout = function() {
            editBtn.style.background = '#23272a';
            editBtn.style.color = 'hsl(var(--accent-h),90%,77%)';
            editBtn.style.opacity = '0.82';
        };
        editBtn.onclick = function() {
            if (customActionInput) {
                customActionInput.value = a;
                customActionInput.dispatchEvent(new Event('input'));
                customActionInput.focus();
            }
        };
        row.appendChild(editBtn);

        // Send button
        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send';
        sendBtn.type = 'button';
        sendBtn.style.fontSize = '0.97em';
        sendBtn.style.padding = '0.18em 0.9em';
        sendBtn.style.margin = '0';
        sendBtn.style.background = 'hsl(var(--accent-h),74%,46%)';
        sendBtn.style.color = '#fff';
        sendBtn.style.border = 'none';
        sendBtn.style.borderRadius = '6px';
        sendBtn.style.cursor = 'pointer';
        sendBtn.style.opacity = '0.92';
        sendBtn.style.transition = 'background 0.15s, opacity 0.15s';
        sendBtn.onmouseover = function() {
            sendBtn.style.background = 'hsl(var(--accent-h),70%,41%)';
            sendBtn.style.opacity = '1';
        };
        sendBtn.onmouseout = function() {
            sendBtn.style.background = 'hsl(var(--accent-h),74%,46%)';
            sendBtn.style.opacity = '0.92';
        };
        sendBtn.onclick = () => handleActionLoop(a);
        row.appendChild(sendBtn);

        actionButtonsArea.appendChild(row);
    });
}

// --- Helper: Map opinion float to color (red→yellow→green) ---
function opinionToColor(opinion) {
    // Clamp between -1 and 1
    let v = Math.max(-1, Math.min(1, Number(opinion)));
    // -1 = red (#ff4d4d), 0 = yellow (#ffe082), 1 = green (#4caf50)
    // Interpolate between red→yellow→green
    if (v <= 0) {
        // Red to yellow
        // v: -1 to 0 → t: 0 to 1
        let t = v + 1;
        // Red: #ff4d4d (255,77,77), Yellow: #ffe082 (255,224,130)
        let r = 255;
        let g = Math.round(77 + (224-77)*t);
        let b = Math.round(77 + (130-77)*t);
        return `rgb(${r},${g},${b})`;
    } else {
        // Yellow to green
        // v: 0 to 1 → t: 0 to 1
        let t = v;
        // Yellow: #ffe082 (255,224,130), Green: #4caf50 (76,175,80)
        let r = Math.round(255 + (76-255)*t);
        let g = Math.round(224 + (175-224)*t);
        let b = Math.round(130 + (80-130)*t);
        return `rgb(${r},${g},${b})`;
    }
}

function getCharacterHighlightTerms() {
    if (!generatedCharacter || typeof generatedCharacter !== 'object') return [];
    var terms = [];
    var seen = {};
    function addTerm(value) {
        var term = String(value || '').trim();
        if (!term) return;
        var key = term.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        terms.push(term);
    }
    var inventory = Array.isArray(generatedCharacter.inventory) ? generatedCharacter.inventory : [];
    inventory.forEach(function(item) {
        if (typeof item === 'string') { addTerm(item); return; }
        if (item && typeof item === 'object' && item.name) addTerm(item.name);
    });
    var abilities = Array.isArray(generatedCharacter.abilities) ? generatedCharacter.abilities : [];
    abilities.forEach(function(ability) {
        if (typeof ability === 'string') { addTerm(ability); return; }
        if (ability && typeof ability === 'object' && ability.name) addTerm(ability.name);
    });
    return terms.sort(function(a, b) { return b.length - a.length; });
}

function buildCharacterHighlightRegex(terms) {
    if (!Array.isArray(terms) || terms.length === 0) return null;
    var pattern = terms
        .map(escapeRegex)
        .filter(Boolean)
        .map(function(term) { return '(?<![A-Za-z0-9])' + term + '(?![A-Za-z0-9])'; })
        .join('|');
    if (!pattern) return null;
    return new RegExp(pattern, 'gi');
}

function buildHighlightedTextFragment(text, regex) {
    if (!text || !regex) return null;
    var localRegex = new RegExp(regex.source, regex.flags);
    var match;
    var cursor = 0;
    var hasMatch = false;
    var fragment = document.createDocumentFragment();
    while ((match = localRegex.exec(text)) !== null) {
        hasMatch = true;
        if (match.index > cursor) {
            fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        }
        var highlighted = document.createElement('span');
        highlighted.className = 'item-ability-highlight';
        highlighted.textContent = match[0];
        fragment.appendChild(highlighted);
        cursor = match.index + match[0].length;
        if (localRegex.lastIndex === match.index) localRegex.lastIndex += 1;
    }
    if (!hasMatch) return null;
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    return fragment;
}

function highlightCharacterTermsInHtml(html) {
    var input = typeof html === 'string' ? html : '';
    if (!input) return input;
    var regex = buildCharacterHighlightRegex(getCharacterHighlightTerms());
    if (!regex) return input;
    var template = document.createElement('template');
    template.innerHTML = input;
    var walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        var parent = node.parentElement;
        if (parent && ['CODE', 'PRE', 'SCRIPT', 'STYLE'].indexOf(parent.tagName) !== -1) continue;
        nodes.push(node);
    }
    nodes.forEach(function(textNode) {
        var replacement = buildHighlightedTextFragment(textNode.nodeValue, regex);
        if (replacement && textNode.parentNode) textNode.parentNode.replaceChild(replacement, textNode);
    });
    return template.innerHTML;
}

function formatPlainTextWithCharacterHighlights(text) {
    return highlightCharacterTermsInHtml(escapeHtml(text));
}
