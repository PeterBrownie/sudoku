// js/game.js — requires: js/storage.js, js/api-functions.js, js/render.js, js/character.js, js/objectives.js, js/scene.js

var environmentData = null;
var actionHistory = [];
var removedNearbyCharacters = [];
var displayedInventories = [];
var currentStoryLog = '';
var currentObjectives = [];
var isPendingAction = false;
var regenerateActionsBtn = document.getElementById('regenerateActionsBtn');
var actionButtonsArea = document.getElementById('actionButtonsArea');
var actionResponseArea = document.getElementById('actionResponseArea');

// ---------------------------------------------------------------------------
// Internal module state
// ---------------------------------------------------------------------------

var actionHistoryPanel = document.getElementById('actionHistoryPanel');
var actionHistoryList = document.getElementById('actionHistoryList');
var actionHistoryToggleBtn = document.getElementById('actionHistoryToggleBtn');
var actionControls = document.getElementById('actionControls');
var isActionHistoryExpanded = false;
var sceneTurnCounter = 0;
var MAX_HISTORY_MESSAGES = 20;
var HISTORY_PRUNE_BATCH_SIZE = 6;
var traitUndoRegistry = {};
var traitUndoCounter = 0;

// ---------------------------------------------------------------------------
// Trait undo helpers
// ---------------------------------------------------------------------------

function cloneTraitEntry(entry) {
    if (entry && typeof entry === 'object') {
        try { return JSON.parse(JSON.stringify(entry)); } catch (_) { return Object.assign({}, entry); }
    }
    return String(entry || '');
}
function cloneTraitList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(cloneTraitEntry);
}
function normalizeAbilityEntry(entry) {
    if (typeof entry === 'string') {
        var text = entry.trim();
        var key = text.toLowerCase();
        return { key: key, text: text, signature: 'string:' + key };
    }
    if (entry && typeof entry === 'object') {
        var name = String(entry.name || '').trim();
        var description = String(entry.description || '').trim();
        var keyBase = name || description;
        var key2 = keyBase.toLowerCase();
        return { key: key2, name: name, description: description, signature: JSON.stringify({ name: name, description: description }), text: name || description };
    }
    return { key: '', text: '', signature: '' };
}
function normalizeLimitationEntry(entry) {
    var text = String(entry || '').trim();
    return { text: text, key: text.toLowerCase() };
}
function formatTraitEntryLabel(entry, traitType) {
    if (traitType === 'ability') {
        var n = normalizeAbilityEntry(entry);
        if (!n.text) return 'Unnamed ability';
        if (typeof entry === 'string') return n.text;
        if (n.name && n.description) return n.name + ': ' + n.description;
        return n.text;
    }
    var lim = normalizeLimitationEntry(entry);
    return lim.text || 'Unnamed limitation';
}
function formatTraitEntryTitle(entry, traitType) {
    if (traitType === 'ability') {
        var n = normalizeAbilityEntry(entry);
        return n.name || n.text || 'Unnamed ability';
    }
    return normalizeLimitationEntry(entry).text || 'Unnamed limitation';
}
function buildTraitUndoTooltipHtml(action) {
    var traitLabel = action.traitType === 'ability' ? 'Ability' : 'Limitation';
    var oldLabel = action.oldEntry ? formatTraitEntryLabel(action.oldEntry, action.traitType) : '';
    var newLabel = action.newEntry ? formatTraitEntryLabel(action.newEntry, action.traitType) : '';
    var currentTitle = action.newEntry
        ? formatTraitEntryTitle(action.newEntry, action.traitType)
        : formatTraitEntryTitle(action.oldEntry, action.traitType);
    if (action.changeType === 'added') {
        return '<strong>' + escapeHtml(currentTitle) + '</strong><br><span style="color:#b0b3b8;">' + traitLabel + ' was added by AI.</span><br><span style="color:#8ea4ba;">Current:</span> ' + escapeHtml(newLabel);
    }
    if (action.changeType === 'removed') {
        return '<strong>' + escapeHtml(currentTitle) + '</strong><br><span style="color:#b0b3b8;">' + traitLabel + ' was removed by AI.</span><br><span style="color:#8ea4ba;">Removed:</span> ' + escapeHtml(oldLabel);
    }
    return '<span style="color:#b0b3b8;">' + traitLabel + ' was modified by AI.</span><br><span style="color:#8ea4ba;">From:</span> ' + escapeHtml(oldLabel) + '<br><span style="color:#8ea4ba;">To:</span> ' + escapeHtml(newLabel);
}
function buildTraitUndoButtonText(action) {
    if (!action || typeof action !== 'object') return 'Undo change';
    var traitLabel = action.traitType === 'ability' ? 'ability' : 'limitation';
    var changeNoun = action.changeType === 'added' ? 'added' : action.changeType === 'removed' ? 'removed' : 'modified';
    return 'Undo ' + traitLabel + ' ' + changeNoun;
}
function registerTraitUndoAction(action) {
    traitUndoCounter += 1;
    var id = 'traitUndo_' + Date.now() + '_' + traitUndoCounter;
    traitUndoRegistry[id] = action;
    return id;
}
function buildAbilityUndoActions(previousAbilities, nextAbilities) {
    var oldList = cloneTraitList(previousAbilities);
    var newList = cloneTraitList(nextAbilities);
    var oldMap = {}, newMap = {};
    oldList.forEach(function(entry) {
        var n = normalizeAbilityEntry(entry);
        if (!n.key || oldMap[n.key]) return;
        oldMap[n.key] = cloneTraitEntry(entry);
    });
    newList.forEach(function(entry) {
        var n = normalizeAbilityEntry(entry);
        if (!n.key || newMap[n.key]) return;
        newMap[n.key] = cloneTraitEntry(entry);
    });
    var actions = [];
    Object.keys(newMap).forEach(function(key) {
        if (!oldMap[key]) {
            actions.push({ traitType: 'ability', changeType: 'added', key: key, newEntry: cloneTraitEntry(newMap[key]) });
            return;
        }
        var oldSig = normalizeAbilityEntry(oldMap[key]).signature;
        var newSig = normalizeAbilityEntry(newMap[key]).signature;
        if (oldSig !== newSig) {
            actions.push({ traitType: 'ability', changeType: 'modified', key: key, oldEntry: cloneTraitEntry(oldMap[key]), newEntry: cloneTraitEntry(newMap[key]) });
        }
    });
    Object.keys(oldMap).forEach(function(key) {
        if (!newMap[key]) {
            actions.push({ traitType: 'ability', changeType: 'removed', key: key, oldEntry: cloneTraitEntry(oldMap[key]) });
        }
    });
    return actions;
}
function buildLimitationUndoActions(previousLimitations, nextLimitations) {
    var oldList = cloneTraitList(previousLimitations).map(normalizeLimitationEntry);
    var newList = cloneTraitList(nextLimitations).map(normalizeLimitationEntry);
    var actions = [];
    var matchedOld = {}, matchedNew = {};
    var maxShared = Math.min(oldList.length, newList.length);
    for (var i = 0; i < maxShared; i++) {
        var oldItem = oldList[i], newItem = newList[i];
        if (!oldItem.key || !newItem.key || oldItem.key === newItem.key) continue;
        actions.push({ traitType: 'limitation', changeType: 'modified', oldEntry: oldItem.text, newEntry: newItem.text });
        matchedOld[i] = true;
        matchedNew[i] = true;
    }
    for (var oi = 0; oi < oldList.length; oi++) {
        if (matchedOld[oi]) continue;
        if (!oldList[oi].key) { matchedOld[oi] = true; continue; }
        for (var ni = 0; ni < newList.length; ni++) {
            if (matchedNew[ni]) continue;
            if (oldList[oi].key === newList[ni].key) { matchedOld[oi] = true; matchedNew[ni] = true; break; }
        }
    }
    for (var ni2 = 0; ni2 < newList.length; ni2++) {
        if (!matchedNew[ni2] && newList[ni2].key) {
            actions.push({ traitType: 'limitation', changeType: 'added', newEntry: newList[ni2].text });
        }
    }
    for (var oi2 = 0; oi2 < oldList.length; oi2++) {
        if (!matchedOld[oi2] && oldList[oi2].key) {
            actions.push({ traitType: 'limitation', changeType: 'removed', oldEntry: oldList[oi2].text });
        }
    }
    return actions;
}
function buildTraitUndoButtonsHtml(previousCharacter, nextCharacterPatch) {
    if (!previousCharacter || !nextCharacterPatch || typeof nextCharacterPatch !== 'object') return '';
    var rows = [];
    if (Array.isArray(previousCharacter.abilities) && Array.isArray(nextCharacterPatch.abilities)) {
        buildAbilityUndoActions(previousCharacter.abilities, nextCharacterPatch.abilities).forEach(function(action) {
            var id = registerTraitUndoAction(action);
            rows.push('<button type="button" class="trait-undo-btn" data-trait-undo-id="' + escapeAttribute(id) + '" data-tooltip-html="' + escapeAttribute(encodeURIComponent(buildTraitUndoTooltipHtml(action))) + '" title="Undo this AI trait change">' + escapeHtml(buildTraitUndoButtonText(action)) + '</button>');
        });
    }
    if (Array.isArray(previousCharacter.limitations) && Array.isArray(nextCharacterPatch.limitations)) {
        buildLimitationUndoActions(previousCharacter.limitations, nextCharacterPatch.limitations).forEach(function(action) {
            var id = registerTraitUndoAction(action);
            rows.push('<button type="button" class="trait-undo-btn" data-trait-undo-id="' + escapeAttribute(id) + '" data-tooltip-html="' + escapeAttribute(encodeURIComponent(buildTraitUndoTooltipHtml(action))) + '" title="Undo this AI trait change">' + escapeHtml(buildTraitUndoButtonText(action)) + '</button>');
        });
    }
    if (rows.length === 0) return '';
    return '<div class="trait-undo-wrap">' + rows.join('') + '</div>';
}
function bindTraitUndoButtons(container) {
    (container || document).querySelectorAll('.trait-undo-btn').forEach(function(btn) {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.onmouseenter = btn.onfocus = function() {
            var encoded = this.getAttribute('data-tooltip-html') || '';
            if (!encoded) return;
            if (typeof showGlobalTooltip === 'function') showGlobalTooltip(decodeURIComponent(encoded), this);
        };
        btn.onmouseleave = btn.onblur = function() {
            if (typeof scheduleTooltipHide === 'function') scheduleTooltipHide();
            else if (typeof hideGlobalTooltip === 'function') hideGlobalTooltip();
        };
        btn.addEventListener('click', async function() {
            var actionId = String(btn.getAttribute('data-trait-undo-id') || '').trim();
            if (!actionId) return;
            await applyTraitUndo(actionId, btn);
        });
    });
}

// ---------------------------------------------------------------------------
// renderOptionalNpcInv — shows "Generate X inventory" buttons after a turn
// ---------------------------------------------------------------------------

function appendInventoryToHistory(inventoryTitle, items) {
    for (var i = actionHistory.length - 1; i >= 0; i--) {
        if (actionHistory[i].role === 'assistant') {
            var names = (Array.isArray(items) ? items : [])
                .map(function(item) { return item && item.name ? String(item.name).trim() : ''; })
                .filter(Boolean);
            var summary = '[Generated inventory for: ' + inventoryTitle + '. Items: ' +
                (names.length ? names.join(', ') : 'none') + ']';
            actionHistory[i] = { role: 'assistant', content: actionHistory[i].content + '\n\n' + summary };
            break;
        }
    }
}

function renderDisplayedInventories(inventories) {
    if (!Array.isArray(inventories) || inventories.length === 0) return;
    if (!actionResponseArea) return;
    var html = inventories.map(function(inv) {
        if (!inv) return '';
        var title = escapeHtml(inv.inventoryTitle || 'Inventory');
        var items = Array.isArray(inv.items) ? inv.items : [];
        if (items.length === 0) {
            return '<div style="margin-top:0.5em;color:#88939f;font-size:0.86em;">' + title + ': no items.</div>';
        }
        var itemsHtml = items.map(function(item) {
            var itemName = escapeHtml(item && item.name ? item.name : 'Unnamed Item');
            var qty = Number.isFinite(Number(item && item.quantity)) ? Number(item.quantity) : null;
            var desc = escapeHtml(item && item.description ? item.description : '');
            return '<div style="margin-top:0.3em;">' +
                (qty ? '<span style="color:#b0b3b8;font-size:0.7em;">(x' + qty + ')</span> ' : '') +
                '<span style="color:hsl(var(--accent-h),100%,85%);font-size:0.82em;">' + itemName + '</span>' +
                (desc ? '<span style="color:#9aa4ae;font-size:0.72em;"> - ' + desc + '</span>' : '') +
                '</div>';
        }).join('');
        return '<div style="margin-top:0.7em;"><strong style="font-size:0.9em;color:#a9c2d9;">' + title + ':</strong>' + itemsHtml + '</div>';
    }).join('');
    if (!html) return;
    var container = document.createElement('div');
    container.style.marginTop = '0.6em';
    container.innerHTML = html;
    actionResponseArea.appendChild(container);
    inventories.forEach(function(inv) {
        if (inv) appendInventoryToHistory(inv.inventoryTitle || 'Inventory', inv.items);
    });
}

function renderOptionalNpcInv(names) {
    if (!Array.isArray(names) || names.length === 0) return;
    if (!actionResponseArea) return;

    var turnId = Date.now();
    var rows = names.map(function(name, idx) {
        var safeName = escapeHtml(String(name || '').trim());
        if (!safeName) return '';
        var blockId = 'optionalNpcInv_' + turnId + '_' + idx;
        return '<div style="margin-top:0.7em;">' +
            '<button type="button" class="optional-npc-inv-btn" data-name="' + safeName + '" data-target-id="' + blockId + '" style="background:transparent;border:1px solid #2f4258;color:#8ea4ba;font-size:0.78em;padding:0.4em 0.7em;border-radius:6px;cursor:pointer;opacity:0.72;">Generate ' + safeName + ' inventory</button>' +
            '<div id="' + blockId + '" style="margin-top:0.35em;"></div>' +
            '</div>';
    }).join('');

    if (!rows) return;

    var container = document.createElement('div');
    container.style.marginTop = '0.6em';
    container.innerHTML = '<div style="color:#7f8a96;font-size:0.86em;opacity:0.78;">Inventory not explicitly requested. Optional:</div>' + rows;
    actionResponseArea.appendChild(container);

    container.querySelectorAll('.optional-npc-inv-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
            var name = String(btn.getAttribute('data-name') || '').trim();
            var targetId = String(btn.getAttribute('data-target-id') || '').trim();
            var target = targetId ? document.getElementById(targetId) : null;
            if (!name || !target) return;

            btn.disabled = true;
            btn.textContent = 'Generating ' + name + '...';
            try {
                // Find NPC info from environment people list for richer context
                var npcInfo = { name: name };
                if (environmentData && Array.isArray(environmentData.people)) {
                    var found = environmentData.people.find(function(p) {
                        return p && String(p.name || '').trim().toLowerCase() === name.toLowerCase();
                    });
                    if (found) npcInfo = found;
                }
                var invData = await getEntityInv(npcInfo, environmentData, actionHistory);
                var items = Array.isArray(invData.items) ? invData.items : [];
                var title = escapeHtml(invData.inventoryTitle || name);
                if (items.length === 0) {
                    target.innerHTML = '<div style="color:#88939f;font-size:0.82em;opacity:0.78;">' + title + ' has no items.</div>';
                    btn.style.display = 'none';
                    return;
                }
                var itemsHtml = items.map(function(item) {
                    var itemName = escapeHtml(item && item.name ? item.name : 'Unnamed Item');
                    var qty = Number.isFinite(Number(item && item.quantity)) ? Number(item.quantity) : null;
                    var desc = escapeHtml(item && item.description ? item.description : '');
                    return '<div style="margin-top:0.3em;">' +
                        (qty ? '<span style="color:#b0b3b8;font-size:0.7em;">(x' + qty + ')</span> ' : '') +
                        '<span style="color:hsl(var(--accent-h),100%,85%);font-size:0.82em;">' + itemName + '</span>' +
                        (desc ? '<span style="color:#9aa4ae;font-size:0.72em;"> - ' + desc + '</span>' : '') +
                        '</div>';
                }).join('');
                target.innerHTML = '<div style="margin-top:0.2em;"><strong style="font-size:0.9em;color:#a9c2d9;">' + title + ':</strong>' + itemsHtml + '</div>';
                btn.style.display = 'none';
                appendInventoryToHistory(invData.inventoryTitle || name, items);
            } catch (err) {
                console.error('[optional_npc_inventory] Exception:', err);
                btn.disabled = false;
                btn.textContent = 'Generate ' + name + ' inventory';
                target.innerHTML = '<div style="color:#c98888;font-size:0.82em;">Failed to generate inventory.</div>';
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Removed character tracking
// ---------------------------------------------------------------------------

function clonePeopleList(people) {
    if (!Array.isArray(people)) return [];
    return people
        .filter(function(p) { return p && typeof p === 'object' && p.name; })
        .map(function(p) { return Object.assign({}, p); });
}

function persistRemovedNearbyCharactersToEnvironment() {
    if (!environmentData || typeof environmentData !== 'object') return;
    environmentData._removed_people = clonePeopleList(removedNearbyCharacters);
    environmentData._turn_counter = Number.isFinite(sceneTurnCounter) ? sceneTurnCounter : 0;
}

function purgeExpiredRemovedCharacters(currentTurn) {
    var turn = Number.isFinite(Number(currentTurn)) ? Number(currentTurn) : 0;
    removedNearbyCharacters = removedNearbyCharacters.filter(function(person) {
        var removedTurn = Number(person && person._removed_turn);
        if (!Number.isFinite(removedTurn)) return true;
        return (turn - removedTurn) < 2;
    });
    persistRemovedNearbyCharactersToEnvironment();
}

function hydrateRemovedNearbyCharactersFromEnvironment() {
    var savedRemoved = environmentData && Array.isArray(environmentData._removed_people)
        ? environmentData._removed_people
        : [];
    removedNearbyCharacters = clonePeopleList(savedRemoved);
    var savedTurnCounter = environmentData && Number.isFinite(Number(environmentData._turn_counter))
        ? Number(environmentData._turn_counter)
        : 0;
    sceneTurnCounter = savedTurnCounter;
    purgeExpiredRemovedCharacters(sceneTurnCounter);
}

function trackRemovedNearbyCharacters(previousEnvironment, nextEnvironment, removedTurn) {
    if (!previousEnvironment || !nextEnvironment) return;
    var previousPeople = clonePeopleList(previousEnvironment.people);
    var nextPeople = clonePeopleList(nextEnvironment.people);

    if (previousPeople.length === 0) return;

    var nextNames = {};
    nextPeople.forEach(function(p) {
        var key = String(p.name || '').trim().toLowerCase();
        if (key) nextNames[key] = true;
    });

    previousPeople.forEach(function(person) {
        var key = String(person.name || '').trim().toLowerCase();
        if (!key || nextNames[key]) return;
        var existingIndex = -1;
        for (var i = 0; i < removedNearbyCharacters.length; i++) {
            if (String(removedNearbyCharacters[i].name || '').trim().toLowerCase() === key) {
                existingIndex = i;
                break;
            }
        }
        var removedPerson = Object.assign({}, person, {
            _removed_turn: Number.isFinite(Number(removedTurn)) ? Number(removedTurn) : sceneTurnCounter
        });
        if (existingIndex >= 0) {
            removedNearbyCharacters[existingIndex] = removedPerson;
        } else {
            removedNearbyCharacters.unshift(removedPerson);
        }
    });
    persistRemovedNearbyCharactersToEnvironment();
}

async function returnRemovedCharacterByName(name) {
    var normalizedName = String(name || '').trim().toLowerCase();
    if (!normalizedName || !environmentData || typeof environmentData !== 'object') return;

    var removedIndex = -1;
    for (var i = 0; i < removedNearbyCharacters.length; i++) {
        if (String(removedNearbyCharacters[i].name || '').trim().toLowerCase() === normalizedName) {
            removedIndex = i;
            break;
        }
    }
    if (removedIndex < 0) return;

    var personToReturn = Object.assign({}, removedNearbyCharacters[removedIndex]);
    delete personToReturn._removed_turn;
    if (!Array.isArray(environmentData.people)) {
        environmentData.people = [];
    }

    var alreadyNearby = environmentData.people.some(function(p) {
        return String(p && p.name ? p.name : '').trim().toLowerCase() === normalizedName;
    });
    if (!alreadyNearby) {
        environmentData.people.push(personToReturn);
    }
    removedNearbyCharacters.splice(removedIndex, 1);
    persistRemovedNearbyCharactersToEnvironment();
    renderGameSidebar();

    try {
        await saveFullProgress(generatedCharacter, environmentData, actionHistory);
    } catch (e) {
        console.error('[return_removed_character] Failed to save:', e);
    }
}

// ---------------------------------------------------------------------------
// Action history panel
// ---------------------------------------------------------------------------

function setActionHistoryExpanded(expanded) {
    if (!actionHistoryPanel || !actionHistoryToggleBtn) return;
    isActionHistoryExpanded = !!expanded;
    actionHistoryPanel.style.display = isActionHistoryExpanded ? 'block' : 'none';
    actionHistoryPanel.setAttribute('aria-hidden', isActionHistoryExpanded ? 'false' : 'true');
    actionHistoryToggleBtn.setAttribute('aria-expanded', isActionHistoryExpanded ? 'true' : 'false');
    actionHistoryToggleBtn.title = isActionHistoryExpanded ? 'Hide action history' : 'Show action history';
    var arrow = actionHistoryToggleBtn.querySelector('.history-arrow');
    if (arrow) {
        arrow.textContent = isActionHistoryExpanded ? '▾' : '▴';
    }
}

function renderActionHistoryPanel() {
    if (!actionHistoryList) return;
    if (!Array.isArray(actionHistory) || actionHistory.length === 0) {
        actionHistoryList.innerHTML = '<div class="action-history-text" style="opacity:0.68;">No action history yet.</div>';
        return;
    }

    actionHistoryList.innerHTML = actionHistory.map(function(msg, idx) {
        var role = msg && msg.role === 'assistant' ? 'assistant' : 'user';
        var rawContent = msg && typeof msg.content === 'string' ? msg.content : '';
        var content = role === 'assistant'
            ? renderMarkdown(rawContent)
            : (typeof formatPlainTextWithCharacterHighlights === 'function'
                ? formatPlainTextWithCharacterHighlights(rawContent)
                : escapeHtml(rawContent));
        return '<div class="action-history-entry role-' + role + '">' +
            '<div class="action-history-role">' + (role === 'assistant' ? 'Narrator' : 'You') + '</div>' +
            '<div class="action-history-text">' + content + '</div>' +
            '</div>';
    }).join('');
}

function syncActionHistoryUI() {
    renderActionHistoryPanel();
    setActionHistoryExpanded(isActionHistoryExpanded);
}

// ---------------------------------------------------------------------------
// Next-turn button helpers
// ---------------------------------------------------------------------------

function buildNextTurnActionText() {
    var charName = String(generatedCharacter && generatedCharacter.name ? generatedCharacter.name : 'The player').trim();
    return 'time passes for a beat, allowing characters to take another action before ' + charName;
}

function ensureNextTurnButton() {
    if (!actionControls) return null;
    var btn = document.getElementById('nextTurnBtn');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'nextTurnBtn';
    btn.type = 'button';
    btn.className = 'next-turn-btn';
    btn.textContent = 'Next turn';
    btn.title = 'Let the scene progress without a specific action';
    btn.addEventListener('click', async function() {
        if (isPendingAction) return;
        var idleAction = buildNextTurnActionText();
        await handleActionLoop(idleAction);
    });
    actionControls.appendChild(btn);
    return btn;
}

function syncNextTurnButton() {
    var nextTurnBtn = ensureNextTurnButton();
    if (!nextTurnBtn) return;

    var canAdvance = !!generatedCharacter && !!environmentData && !isPendingAction;
    nextTurnBtn.disabled = !canAdvance;
    nextTurnBtn.textContent = isPendingAction ? 'Advancing...' : 'Next turn';
}

function setRegenerateActionsVisibility(actions) {
    if (!regenerateActionsBtn) return;
    var hasActions = Array.isArray(actions) && actions.length > 0;
    // Keep button visible; disable when no actions (loading state) so user can still see it
    regenerateActionsBtn.style.display = 'inline-flex';
    regenerateActionsBtn.disabled = !hasActions || isRegeneratingActions;
}

// ---------------------------------------------------------------------------
// Trait undo helpers
// ---------------------------------------------------------------------------

function applyTraitUndo(actionId, buttonEl) {
    if (!actionId || !generatedCharacter || typeof generatedCharacter !== 'object') return;
    var action = traitUndoRegistry[actionId];
    if (!action) return;

    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = 'Undoing...';
    }

    try {
        if (action.traitType === 'ability') {
            var currentAbilities = Array.isArray(generatedCharacter.abilities)
                ? generatedCharacter.abilities.slice()
                : [];

            if (action.changeType === 'added') {
                generatedCharacter.abilities = currentAbilities.filter(function(entry) {
                    var key = typeof entry === 'string' ? entry : (entry && entry.key ? entry.key : '');
                    var actionKey = typeof action.key === 'string' ? action.key : '';
                    return key.toLowerCase() !== actionKey.toLowerCase();
                });
            } else if (action.changeType === 'removed') {
                generatedCharacter.abilities = currentAbilities.concat([action.oldEntry]);
            } else if (action.changeType === 'modified') {
                var didReplace = false;
                generatedCharacter.abilities = currentAbilities.map(function(entry) {
                    var key = typeof entry === 'string' ? entry : (entry && entry.key ? entry.key : '');
                    var actionKey = typeof action.key === 'string' ? action.key : '';
                    if (key.toLowerCase() === actionKey.toLowerCase() && !didReplace) {
                        didReplace = true;
                        return action.oldEntry;
                    }
                    return entry;
                });
                if (!didReplace) {
                    generatedCharacter.abilities.push(action.oldEntry);
                }
            }
        } else if (action.traitType === 'limitation') {
            var currentLimitations = Array.isArray(generatedCharacter.limitations)
                ? generatedCharacter.limitations.map(function(v) { return String(v).trim(); }).filter(Boolean)
                : [];

            if (action.changeType === 'added') {
                var targetKey = String(action.newEntry || '').trim().toLowerCase();
                generatedCharacter.limitations = currentLimitations.filter(function(v) {
                    return String(v).trim().toLowerCase() !== targetKey;
                });
            } else if (action.changeType === 'removed') {
                generatedCharacter.limitations = currentLimitations.concat([String(action.oldEntry)]);
            } else if (action.changeType === 'modified') {
                var fromKey = String(action.newEntry || '').trim().toLowerCase();
                var toValue = String(action.oldEntry || '').trim();
                var didReplaceLim = false;
                generatedCharacter.limitations = currentLimitations.map(function(value) {
                    if (!didReplaceLim && String(value).trim().toLowerCase() === fromKey) {
                        didReplaceLim = true;
                        return toValue;
                    }
                    return value;
                });
                if (!didReplaceLim && toValue) {
                    generatedCharacter.limitations.push(toValue);
                }
            }
        }

        if (typeof renderCharacterDetails === 'function') {
            renderCharacterDetails();
        }
        renderGameSidebar();
        saveFullProgress(generatedCharacter, environmentData, actionHistory);
        delete traitUndoRegistry[actionId];
        if (buttonEl) {
            buttonEl.textContent = 'Undone';
        }
    } catch (e) {
        console.error('[trait_undo] Failed to apply trait undo:', e);
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Undo failed';
        }
    }
}

function trimActionHistory(history) {
    if (!Array.isArray(history)) return [];
    var cleaned = history.filter(function(msg) {
        return msg &&
            (msg.role === 'user' || msg.role === 'assistant') &&
            typeof msg.content === 'string' &&
            msg.content.trim().length > 0;
    });
    if (cleaned.length <= MAX_HISTORY_MESSAGES) {
        return cleaned;
    }

    // Prune in larger chunks so we don't change the prefix every turn.
    var pruned = cleaned;
    while (pruned.length > MAX_HISTORY_MESSAGES) {
        pruned = pruned.slice(HISTORY_PRUNE_BATCH_SIZE);
    }

    // Ensure history always starts with user and alternates user/assistant.
    while (pruned.length > 0 && pruned[0].role !== 'user') {
        pruned = pruned.slice(1);
    }

    var normalized = [];
    var expectedRole = 'user';
    for (var i = 0; i < pruned.length; i++) {
        var msg = pruned[i];
        if (msg.role !== expectedRole) continue;
        normalized.push(msg);
        expectedRole = expectedRole === 'user' ? 'assistant' : 'user';
    }

    return normalized;
}

// ---------------------------------------------------------------------------
// regeneratePossibleActions
// ---------------------------------------------------------------------------

var isRegeneratingActions = false;
var regenerateActionsFlashTimeoutId = null;
var REGENERATE_FLASH_HOLD_MS = 80;

function flashRegenerateActionsButton() {
  var btn = document.getElementById('regenerateActionsBtn');
  if (!btn || btn.style.display === 'none') return;
  if (regenerateActionsFlashTimeoutId) {
    clearTimeout(regenerateActionsFlashTimeoutId);
    regenerateActionsFlashTimeoutId = null;
  }
  btn.classList.remove('actions-refresh-flash');
  void btn.offsetWidth; // force reflow to restart animation
  btn.classList.add('actions-refresh-flash');
  regenerateActionsFlashTimeoutId = setTimeout(function() {
    btn.classList.remove('actions-refresh-flash');
    regenerateActionsFlashTimeoutId = null;
  }, REGENERATE_FLASH_HOLD_MS);
}

async function regeneratePossibleActions() {
  if (isPendingAction || isRegeneratingActions) return;
  isRegeneratingActions = true;
  var btn = document.getElementById('regenerateActionsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating actions...';
  }
  renderActionButtons(null);  // clear action buttons, show loading state
  try {
    var result = await getActions(generatedCharacter, environmentData, generatedCharacter.inventory || [], actionHistory, displayedInventories);
    var actions = result && result.actions ? result.actions : [];
    renderActionButtons(actions);
    if (actions.length > 0) flashRegenerateActionsButton();
  } catch (e) {
    console.error('[game] regeneratePossibleActions error:', e);
    renderActionButtons([]);
  } finally {
    isRegeneratingActions = false;
    var btn2 = document.getElementById('regenerateActionsBtn');
    if (btn2) {
      btn2.textContent = 'Regenerate actions';
      btn2.disabled = false;
    }
  }
}

// ---------------------------------------------------------------------------
// handleActionLoop
// ---------------------------------------------------------------------------

async function handleActionLoop(selectedAction) {
  if (isPendingAction) return;
  isPendingAction = true;

  // Collapse removed-nearby list if open
  var _removedList = document.getElementById('removedNearbyList');
  var _removedToggle = document.getElementById('removedNearbyToggleBtn');
  if (_removedList && _removedList.style.display !== 'none') {
    _removedList.style.display = 'none';
    if (_removedToggle) _removedToggle.textContent = _removedToggle.textContent.replace('▾', '▸');
  }

  // 1. Show loading — display user action in blue, then loading indicator
  renderActionButtons(null);
  var formattedSelectedAction = escapeHtml(selectedAction);
  actionResponseArea.innerHTML =
    '<div style="font-size:1.08em;color:hsl(var(--accent-h),90%,77%);margin-bottom:0.7em;">' +
      '<strong>You:</strong> ' + formattedSelectedAction +
    '</div>' +
    '<span class="loading-ellipsis" style="min-width:2em;display:inline-block;height:1.5em;">' +
      '<span></span><span></span><span></span>' +
    '</span>';

  // 2. Append user action to history
  actionHistory.push({ role: 'user', content: selectedAction });

  try {
    // 3. Get action response (narrative)
    var secretStoryDetail = typeof _getSecretStoryDetail === 'function' ? _getSecretStoryDetail(generatedCharacter.name) : '';
    var response = await getActionResponse(
      generatedCharacter, environmentData, generatedCharacter.inventory || [],
      selectedAction, actionHistory, displayedInventories,
      currentObjectives, currentStoryLog, removedNearbyCharacters, secretStoryDetail
    );

    // 4. Display response — keep user action header in blue above narrative
    actionResponseArea.innerHTML =
      '<div style="font-size:1.08em;color:hsl(var(--accent-h),90%,77%);margin-bottom:0.2em;">' +
        '<strong>You:</strong> ' + formattedSelectedAction +
      '</div>' +
      '<div>' + highlightCharacterTermsInHtml(renderMarkdown(response)) + '</div>';

    // 5. Append assistant response to history
    actionHistory.push({ role: 'assistant', content: response });

    // 6. applyActionChanges (state updates) — append animated dots + "Detecting changes..." label
    var stateLoadingEl = document.createElement('div');
    stateLoadingEl.className = 'loading-ellipsis waiting-state';
    stateLoadingEl.innerHTML = '<span></span><span></span><span></span>';
    var loadingText = document.createElement('div');
    loadingText.style.minWidth = '8em';
    loadingText.style.height = '2em';
    loadingText.textContent = 'Detecting changes...';
    loadingText.style.color = '#ffeb3b';
    loadingText.style.fontSize = '0.7em';
    loadingText.style.fontWeight = '250';
    stateLoadingEl.appendChild(loadingText);
    actionResponseArea.appendChild(stateLoadingEl);
    var changes = await applyActionChanges(
      generatedCharacter, environmentData, generatedCharacter.inventory || [],
      selectedAction, response, actionHistory, currentObjectives, currentStoryLog
    );
    stateLoadingEl.remove();

    // 7. Merge results back into globals
    // NOTE: save previousEnvironment/Character BEFORE overwriting
    var previousEnvironment = environmentData;
    var previousCharacter = Object.assign({}, generatedCharacter);
    generatedCharacter = Object.assign(generatedCharacter, changes.character);
    environmentData = changes.environment;
    generatedCharacter.inventory = changes.inventory;
    displayedInventories = changes.displayedInventories || [];

    // 8. Update story log
    if (changes.storyLogAddition) {
      currentStoryLog = currentStoryLog ? currentStoryLog + ' ' + changes.storyLogAddition : changes.storyLogAddition;
    }

    // 9. Apply objective updates
    // detectObjectiveStepCompletion returns the fully-updated objectives array directly
    if (Array.isArray(changes.objectiveUpdates)) {
      currentObjectives = changes.objectiveUpdates;
      if (generatedCharacter) generatedCharacter.objectives = currentObjectives;
    }

    // 10. Track removed characters (increment turn counter first so purge logic uses current turn)
    sceneTurnCounter += 1;
    trackRemovedNearbyCharacters(previousEnvironment, changes.environment, sceneTurnCounter);
    purgeExpiredRemovedCharacters(sceneTurnCounter);
    persistRemovedNearbyCharactersToEnvironment();

    // 11. Re-render sidebar + panels
    renderGameSidebar();
    syncObjectivesUI();
    renderActionHistoryPanel();

    // 12. Save progress (persist story log on character so it survives refresh)
    generatedCharacter.story_log = currentStoryLog;
    saveFullProgress(generatedCharacter, environmentData, actionHistory);

    // 13. Render state changes + narrative (final innerHTML write)
    var changesHtml = renderStateChanges(changes, previousEnvironment, previousCharacter);
    actionResponseArea.innerHTML =
      '<div style="font-size:1.08em;color:hsl(var(--accent-h),90%,77%);margin-bottom:0.2em;">' +
        '<strong>You:</strong> ' + formattedSelectedAction +
      '</div>' +
      '<div>' + highlightCharacterTermsInHtml(renderMarkdown(response)) + '</div>' +
      (changesHtml ? '<div>' + highlightCharacterTermsInHtml(changesHtml) + '</div>' : '');

    // 14. Wire trait undo buttons and story log button now that they're in the DOM
    bindTraitUndoButtons(actionResponseArea);
    var viewLogBtn = actionResponseArea.querySelector('[data-action="view-story-log"]');
    if (viewLogBtn) {
      viewLogBtn.addEventListener('click', function() {
        showStoryLogModal(currentStoryLog);
      });
    }

    // 15. Append optional objectives and NPC inventory buttons (must be after innerHTML is set)
    if (Array.isArray(changes.optionalObjectives) && changes.optionalObjectives.length > 0) {
      renderOptionalObjectives(changes.optionalObjectives);
      // Persist pending suggestions so they survive a refresh
      generatedCharacter._pendingObjectives = changes.optionalObjectives;
      saveFullProgress(generatedCharacter, environmentData, actionHistory);
    } else {
      // No new suggestions — clear any stale ones from the previous turn
      if (generatedCharacter._pendingObjectives) {
        delete generatedCharacter._pendingObjectives;
        saveFullProgress(generatedCharacter, environmentData, actionHistory);
      }
    }
    if (Array.isArray(changes.displayedInventories) && changes.displayedInventories.length > 0) {
      renderDisplayedInventories(changes.displayedInventories);
    }
    if (Array.isArray(changes.optionalNpcInv) && changes.optionalNpcInv.length > 0) {
      renderOptionalNpcInv(changes.optionalNpcInv);
    }

    // 16. Generate next actions — reset isPendingAction first so the guard inside doesn't block it
    isPendingAction = false;
    await regeneratePossibleActions();

  } catch (e) {
    console.error('[game] handleActionLoop error:', e);
    actionResponseArea.innerHTML = '<div class="error-text">Error: ' + escapeHtml(e.message || 'Unknown error') + '</div>';
  } finally {
    isPendingAction = false;
  }
}

// ---------------------------------------------------------------------------
// renderStateChanges — builds changesHtml string from applyActionChanges result
// ---------------------------------------------------------------------------

function renderStateChanges(changes, previousEnvironment, previousCharacter) {
    if (!changes) return '';
    var html = '';

    function fmtLabel(label, value, color) {
        return '<span style="color:' + color + ';font-weight:600;">' + label + ':</span> <span style="color:#b0b3b8;">' + value + '</span>';
    }
    function fmtRow(inner) {
        return '<div style="font-size:0.98em;margin:0.2em 0 0.2em 0.2em;opacity:0.7;">' + inner + '</div>';
    }
    function humanizeSounds(sounds) {
        var arr = Array.isArray(sounds) ? sounds.filter(Boolean)
            : typeof sounds === 'string' ? sounds.split(/[,;]+/).map(function(s){return s.trim();}).filter(Boolean)
            : [];
        if (!arr.length) return '';
        if (arr.length === 1) return 'You now hear: ' + arr[0] + '.';
        if (arr.length === 2) return 'You now hear: ' + arr[0] + ' and ' + arr[1] + '.';
        return 'You now hear: ' + arr.slice(0,-1).join(', ') + ', and ' + arr[arr.length-1] + '.';
    }
    function getOverallOpinion(person) {
        if (!person || typeof person !== 'object') return 0;
        var nested = person.opinions && typeof person.opinions === 'object' ? Number(person.opinions.overall) : NaN;
        var legacy = Number(person.opinion);
        var val = Number.isFinite(nested) ? nested : Number.isFinite(legacy) ? legacy : 0;
        return Math.max(-0.99, Math.min(0.99, val));
    }
    function opinionLabel(v) {
        return v >= 0.7 ? 'Very Friendly' : v >= 0.2 ? 'Friendly' : v > -0.2 ? 'Neutral' : v > -0.7 ? 'Unfriendly' : 'Hostile';
    }

    // Environment patch
    var envPatch = changes.environment && previousEnvironment ? (function() {
        var patch = {};
        var SKIP = { people: 1, removed_people: 1, _removed_people: 1, _turn_counter: 1, secret_npc_details: 1, arrival_backstory: 1, location: 1, time_of_day: 1, vibe: 1, sounds: 1, temperature: 1 };
        Object.keys(changes.environment).forEach(function(k) {
            if (SKIP[k]) return;
            var nv = changes.environment[k], ov = previousEnvironment[k];
            if (JSON.stringify(nv) !== JSON.stringify(ov)) patch[k] = { old: ov, new: nv };
        });
        return patch;
    })() : {};

    Object.keys(envPatch).forEach(function(k) {
        var entry = envPatch[k];
        var label = k === 'location' ? 'New location' : k === 'vibe' ? 'New vibe'
            : k.replace(/_/g,' ').replace(/\b\w/g,function(l){return l.toUpperCase();});
        if (k === 'sounds') {
            html += fmtRow(fmtLabel(label, humanizeSounds(entry.new), '#4fc3f7'));
        } else {
            html += fmtRow(fmtLabel(label, escapeHtml(String(entry.new)), '#4fc3f7'));
        }
    });

    // People changes
    var newPeople = changes.environment && Array.isArray(changes.environment.people) ? changes.environment.people : [];
    var oldPeople = previousEnvironment && Array.isArray(previousEnvironment.people) ? previousEnvironment.people : [];
    var oldPeopleMap = {};
    oldPeople.forEach(function(p) { if (p && p.name) oldPeopleMap[p.name] = p; });
    var changedPeople = newPeople.filter(function(p) {
        var prev = oldPeopleMap[p.name];
        if (!prev) return true;
        return p.short_description !== prev.short_description ||
            getOverallOpinion(p).toFixed(3) !== getOverallOpinion(prev).toFixed(3);
    });
    if (changedPeople.length > 0) {
        var peopleItems = changedPeople.map(function(p) {
            var prev = oldPeopleMap[p.name];
            var newOv = getOverallOpinion(p);
            var oldOv = prev ? getOverallOpinion(prev) : 0;
            var colorNew = typeof opinionToColor === 'function' ? opinionToColor(newOv) : '#b0b3b8';
            var colorOld = prev && typeof opinionToColor === 'function' ? opinionToColor(oldOv) : '#888';
            var opinionChanged = prev && newOv.toFixed(3) !== oldOv.toFixed(3);
            var descChanged = prev && p.short_description !== prev.short_description;
            return '<li><strong>' + escapeHtml(p.name || '') + '</strong>' +
                (descChanged ? ' <span style="color:hsl(var(--accent-h),100%,85%);">→</span> <span style="color:#b0b3b8;font-size:0.8em;">' + escapeHtml(p.short_description || '') + '</span>' : '') +
                (opinionChanged ? ' (<span style="color:' + colorOld + ';text-decoration:line-through;font-size:0.8em;">' + oldOv.toFixed(2) + '</span>' +
                    ' <span style="color:hsl(var(--accent-h),100%,85%);">→</span>' +
                    ' <span style="color:' + colorNew + ';font-weight:600;">' + newOv.toFixed(2) + '</span>' +
                    ' <span style="color:#888;font-size:0.8em;">' + opinionLabel(newOv) + '</span>)'
                    : Number.isFinite(newOv) ? ' (<span style="color:' + colorNew + ';font-size:0.8em;">' + newOv.toFixed(2) + ' ' + opinionLabel(newOv) + '</span>)' : '') +
                '</li>';
        }).join('');
        html += fmtRow(fmtLabel('People', '<ul style="margin:0.2em 0 0 1.2em;">' + peopleItems + '</ul>', 'hsl(var(--accent-h),100%,85%)'));
    }

    // Character patch
    var charPatch = changes.character && previousCharacter ? (function() {
        var SKIP = { name:1, nickname:1, age:1, height:1, gender:1, short_description:1, inventory:1, objectives:1, story_log:1 };
        // Normalize arrays semantically so reordering or whitespace alone don't count as changes
        function normalizeItem(item) {
            if (typeof item === 'string') return item.trim().toLowerCase();
            if (item && typeof item === 'object')
                return (String(item.name || '').trim() + '|' + String(item.description || '').trim()).toLowerCase();
            return String(item);
        }
        function arrayChanged(a, b) {
            if (!Array.isArray(a) || !Array.isArray(b)) return JSON.stringify(a) !== JSON.stringify(b);
            if (a.length !== b.length) return true;
            var as = a.map(normalizeItem).sort().join('\x00');
            var bs = b.map(normalizeItem).sort().join('\x00');
            return as !== bs;
        }
        var ARRAY_FIELDS = { limitations: 1, abilities: 1 };
        var patch = {};
        Object.keys(changes.character).forEach(function(k) {
            if (SKIP[k]) return;
            var nv = changes.character[k], ov = previousCharacter[k];
            var changed = ARRAY_FIELDS[k] ? arrayChanged(nv, ov) : JSON.stringify(nv) !== JSON.stringify(ov);
            if (changed) patch[k] = { old: ov, new: nv };
        });
        return patch;
    })() : {};

    Object.keys(charPatch).forEach(function(k) {
        var entry = charPatch[k];
        var label = k.replace(/_/g,' ').replace(/\b\w/g,function(l){return l.toUpperCase();});
        var newVal = Array.isArray(entry.new)
            ? '<ul style="margin:0.2em 0 0 1.2em;">' + entry.new.map(function(v) {
                if (typeof v === 'string') return '<li>' + escapeHtml(v) + '</li>';
                if (v && v.name) return '<li><strong>' + escapeHtml(v.name) + '</strong>' + (v.description ? ' - ' + escapeHtml(v.description) : '') + '</li>';
                return '';
              }).join('') + '</ul>'
            : escapeHtml(String(entry.new));
        html += fmtRow(fmtLabel(label, newVal, '#a5d6a7'));
    });

    // Inventory diff
    var newInv = Array.isArray(changes.inventory) ? changes.inventory : [];
    var oldInv = previousCharacter && Array.isArray(previousCharacter.inventory) ? previousCharacter.inventory : [];
    var oldInvMap = {}, newInvMap = {};
    oldInv.forEach(function(i) { if (i && i.name) oldInvMap[i.name] = i; });
    newInv.forEach(function(i) { if (i && i.name) newInvMap[i.name] = i; });
    var invLines = [];
    Object.keys(newInvMap).forEach(function(name) { if (!oldInvMap[name]) invLines.push('<span style="color:hsl(var(--accent-h),100%,85%);">+ ' + escapeHtml(name) + '</span>'); });
    Object.keys(oldInvMap).forEach(function(name) { if (!newInvMap[name]) invLines.push('<span style="color:#ffb3b3;">- ' + escapeHtml(name) + '</span>'); });
    Object.keys(newInvMap).forEach(function(name) {
        if (!oldInvMap[name]) return;
        var oldQty = oldInvMap[name].quantity;
        var newQty = newInvMap[name].quantity;
        var oldNum = oldQty != null ? Number(oldQty) : null;
        var newNum = newQty != null ? Number(newQty) : null;
        if (oldNum !== null && newNum !== null && oldNum !== newNum) {
            var dir = newNum > oldNum ? '+' : '-';
            var diff = Math.abs(newNum - oldNum);
            var color = newNum > oldNum ? 'hsl(var(--accent-h),100%,85%)' : '#ffb3b3';
            invLines.push('<span style="color:' + color + ';">' + dir + ' ' + escapeHtml(name) + ' (' + oldNum + ' → ' + newNum + ')</span>');
        }
    });
    if (invLines.length > 0) {
        html += fmtRow(fmtLabel('Inventory', '<ul style="margin:0.2em 0 0 1.2em;">' + invLines.map(function(l){return '<li>'+l+'</li>';}).join('') + '</ul>', '#ce93d8'));
    }

    // Story log addition
    if (changes.storyLogAddition && changes.storyLogAddition.trim()) {
        var escaped = escapeHtml(changes.storyLogAddition.trim());
        html += '<div style="margin-top:0.7em;font-size:0.95em;color:#b0b3b8;opacity:0.8;">' +
            '<span style="color:#9fb3c8;">Story log updated:</span>' +
            '<button class="story-log-view-btn" data-action="view-story-log">View full log</button>' +
            '<div style="margin-top:0.2em;max-height:7.2em;overflow:auto;white-space:pre-wrap;line-height:1.35;">' + escaped + '</div>' +
            '</div>';
    }

    // Trait undo buttons
    var traitUndoHtml = buildTraitUndoButtonsHtml(previousCharacter, changes.character);
    if (traitUndoHtml) {
        html += '<div style="margin-top:0.55em;">' + traitUndoHtml + '</div>';
    }

    if (!html) {
        html = '<div style="margin-top:1em;color:#888;font-size:0.98em;opacity:0.6;">No changes detected.</div>';
    }
    return html;
}

// ---------------------------------------------------------------------------
// applyObjectiveUpdates
// ---------------------------------------------------------------------------

function applyObjectiveUpdates(objectiveUpdates) {
    if (!Array.isArray(objectiveUpdates) || objectiveUpdates.length === 0) return;
    if (!Array.isArray(currentObjectives)) return;

    objectiveUpdates.forEach(function(update) {
        if (!update || typeof update !== 'object') return;
        var targetTitle = String(update.title || '').trim().toLowerCase();
        if (!targetTitle) return;

        var objective = null;
        for (var i = 0; i < currentObjectives.length; i++) {
            if (String(currentObjectives[i] && currentObjectives[i].title || '').trim().toLowerCase() === targetTitle) {
                objective = currentObjectives[i];
                break;
            }
        }
        if (!objective) return;

        var completedSteps = Array.isArray(update.completed_steps) ? update.completed_steps : [];
        var passedSteps = Array.isArray(update.passed_steps) ? update.passed_steps : [];

        if (Array.isArray(objective.steps)) {
            objective.steps.forEach(function(step, idx) {
                var stepNum = idx + 1;
                if (completedSteps.indexOf(stepNum) >= 0) {
                    step.status = 'completed';
                    step.is_completed = true;
                } else if (passedSteps.indexOf(stepNum) >= 0) {
                    step.status = step.step_type === 'optional' ? 'passed' : 'completed';
                    step.is_completed = step.status === 'completed';
                }
            });
        }

        if (update.objective_completed) {
            objective.is_completed = true;
            if (Array.isArray(objective.steps)) {
                objective.steps.forEach(function(step) {
                    step.status = 'completed';
                    step.is_completed = true;
                });
            }
        }
    });

    // Also sync back to generatedCharacter.objectives if they match
    if (generatedCharacter && Array.isArray(generatedCharacter.objectives)) {
        generatedCharacter.objectives = currentObjectives;
    }

    syncObjectivesUI();
}

// ---------------------------------------------------------------------------
// renderOptionalObjectives
// ---------------------------------------------------------------------------

function renderOptionalObjectives(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return;
    if (!actionResponseArea) return;

    var turnId = Date.now();
    var rows = candidates.map(function(obj, idx) {
        if (!obj || typeof obj !== 'object') return '';
        var title = escapeHtml(String(obj.title || '').trim() || 'New objective');
        var descRaw = String(obj.description || '').trim();
        var difficulty = typeof normalizeObjectiveDifficulty === 'function'
            ? normalizeObjectiveDifficulty(obj.difficulty)
            : null;
        var encodedObj = encodeURIComponent(JSON.stringify({
            title: String(obj.title || '').trim(),
            description: descRaw,
            difficulty: difficulty
        }));
        var desc = escapeHtml(descRaw || 'No description');
        var difficultyColor = typeof difficultyToColor === 'function' ? difficultyToColor(difficulty) : '#b0b3b8';
        var tooltipHtml = difficulty !== null
            ? '<div><strong>Description:</strong> ' + desc + '</div><div><strong>Difficulty:</strong> <span style="color:' + difficultyColor + ';font-weight:600;opacity:0.9;">' + escapeHtml(String(difficulty)) + '/10</span></div>'
            : desc;
        var encodedTooltip = encodeURIComponent(tooltipHtml);
        var blockId = 'optionalObjective_' + turnId + '_' + idx;
        return '<button type="button" class="optional-objective-btn" data-objective="' + encodedObj + '" data-target-id="' + blockId + '" data-tooltip-html="' + encodedTooltip + '" style="background:transparent;border:1px solid #2f4258;color:#8ea4ba;font-size:0.78em;padding:0.4em 0.7em;border-radius:6px;cursor:pointer;opacity:0.72;">Add objective: ' + title + '</button>' +
            '<div id="' + blockId + '" style="margin-top:0.35em;"></div>';
    }).join('');

    if (!rows) return;

    var container = document.createElement('div');
    container.style.marginTop = '0.6em';
    container.innerHTML = '<div style="color:#7f8a96;font-size:0.86em;opacity:0.78;margin-bottom:0.5em;">Optional objectives:</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:0.5em;">' + rows + '</div>';
    actionResponseArea.appendChild(container);

    // Bind click handlers
    var buttons = container.querySelectorAll('.optional-objective-btn');
    buttons.forEach(function(btn) {
        btn.onmouseenter = btn.onfocus = function() {
            var encoded = this.getAttribute('data-tooltip-html') || '';
            if (!encoded) return;
            if (typeof showGlobalTooltip === 'function') showGlobalTooltip(decodeURIComponent(encoded), this);
        };
        btn.onmouseleave = btn.onblur = function() {
            if (typeof scheduleTooltipHide === 'function') scheduleTooltipHide();
        };
        btn.addEventListener('click', async function() {
            var encodedObjective = btn.getAttribute('data-objective') || '';
            var targetId = btn.getAttribute('data-target-id') || '';
            var target = targetId ? document.getElementById(targetId) : null;
            if (!encodedObjective || !target || !generatedCharacter || !environmentData) return;

            var objectiveData = null;
            try {
                objectiveData = JSON.parse(decodeURIComponent(encodedObjective));
            } catch (_) {
                objectiveData = null;
            }
            if (!objectiveData || !objectiveData.title) return;

            btn.disabled = true;
            btn.textContent = 'Adding objective...';
            try {
                var plan = await generateObjectiveSteps(
                    generatedCharacter,
                    environmentData,
                    objectiveData,
                    actionHistory
                );
                if (plan && plan.error) {
                    throw new Error(plan.error);
                }
                var nextObjective = {
                    id: 'obj_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    title: String((plan && plan.title) || objectiveData.title || '').trim(),
                    description: String((plan && plan.description) || objectiveData.description || '').trim(),
                    is_completed: false,
                    steps: Array.isArray(plan && plan.steps) ? plan.steps.map(function(step) {
                        var stepType = typeof normalizeObjectiveStepType === 'function'
                            ? normalizeObjectiveStepType(step && step.step_type)
                            : 'required';
                        var status = typeof normalizeObjectiveStepStatus === 'function'
                            ? normalizeObjectiveStepStatus(step && step.status, stepType, !!(step && step.is_completed))
                            : 'pending';
                        return {
                            user_text: String(step && (step.user_text || step.description) || '').trim(),
                            hidden_context: String(step && step.hidden_context || '').trim(),
                            step_type: stepType,
                            status: status,
                            is_completed: status === 'completed'
                        };
                    }).filter(function(step) { return step.user_text; }) : []
                };
                var difficulty2 = typeof normalizeObjectiveDifficulty === 'function'
                    ? normalizeObjectiveDifficulty((plan && plan.difficulty != null ? plan.difficulty : objectiveData.difficulty))
                    : null;
                if (difficulty2 !== null) {
                    nextObjective.difficulty = difficulty2;
                }

                if (!Array.isArray(currentObjectives)) {
                    currentObjectives = [];
                }
                if (!Array.isArray(generatedCharacter.objectives)) {
                    generatedCharacter.objectives = [];
                }

                var duplicate = currentObjectives.some(function(existing) {
                    return String(existing && existing.title || '').trim().toLowerCase() === nextObjective.title.toLowerCase();
                });
                if (!duplicate) {
                    currentObjectives.push(nextObjective);
                    generatedCharacter.objectives = currentObjectives;
                }

                syncObjectivesUI();
                delete generatedCharacter._pendingObjectives;
                await saveFullProgress(generatedCharacter, environmentData, actionHistory);
                target.innerHTML = '<div style="color:#9bb7cf;font-size:0.82em;">Objective added.</div>';
                btn.style.display = 'none';
            } catch (err) {
                console.error('[optional_objective] Exception:', err);
                btn.disabled = false;
                btn.textContent = 'Add objective: ' + String(objectiveData.title || '').trim();
                target.innerHTML = '<div style="color:#c98888;font-size:0.82em;">Failed to add objective.</div>';
            }
        });
    });
}
