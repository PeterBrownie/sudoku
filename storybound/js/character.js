// js/character.js — requires: js/storage.js, js/api-client.js, js/api-functions.js, js/render.js

// ─── Module Globals ───────────────────────────────────────────────────────────

var generatedCharacter = null;
var miniChars = [];
var selectedMiniChar = null;
var isGeneratingNames = false;
var isAddingCharacter = false;
var isEditingCharacterDetails = false;
var characterDetailsDraftJson = '';
var characterDetailsDraftError = '';
var savedCharacterData = {};
var savedEnvironmentData = {};
var savedHistoryData = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAdultAge(value) {
    var age = Number(value);
    return Number.isFinite(age) && age >= 18;
}

function parseLastPlayedTimestamp(value) {
    var parsed = Date.parse(String(value || '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function formatLastPlayedLabel(value) {
    var parsed = parseLastPlayedTimestamp(value);
    if (parsed === null) return 'Unknown';
    return new Date(parsed).toLocaleString();
}

function loadingPlaceholder(width, height, dots) {
    if (width === undefined) width = '5em';
    if (height === undefined) height = '1em';
    if (dots === undefined) dots = true;
    if (dots) {
        return '<span class="loading-ellipsis" style="min-width:' + width + ';display:inline-block;height:' + height + ';">' +
            '<span></span><span></span><span></span>' +
            '</span>';
    }
    return '<span class="loading-placeholder" style="display:inline-block;min-width:' + width + ';height:' + height + ';background:linear-gradient(90deg,#23272a 60%,hsl(var(--accent-h),37%,24%) 100%);border-radius:6px;animation:pulse 1s infinite;"></span>';
}

// ─── Character Edit Functions ───────────────────────

function beginCharacterDetailsEdit() {
    if (!generatedCharacter || isAddingCharacter) return;
    isEditingCharacterDetails = true;
    characterDetailsDraftError = '';
    characterDetailsDraftJson = JSON.stringify(generatedCharacter, null, 2);
    renderCharacterDetails(false, false);
}

function cancelCharacterDetailsEdit() {
    isEditingCharacterDetails = false;
    characterDetailsDraftJson = '';
    characterDetailsDraftError = '';
    renderCharacterDetails(false, false);
}

function applyCharacterDetailsEdit(options) {
    if (options === undefined) options = {};
    if (!isEditingCharacterDetails) return true;
    var shouldRerender = options.rerender !== false;
    var shouldAlert = options.showAlert === true;
    var parsed;
    try {
        parsed = JSON.parse(characterDetailsDraftJson || '{}');
    } catch (err) {
        characterDetailsDraftError = 'Invalid JSON: ' + err.message;
        if (shouldRerender) renderCharacterDetails(false, false);
        if (shouldAlert) alert(characterDetailsDraftError);
        return false;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        characterDetailsDraftError = 'Character details must be a JSON object.';
        if (shouldRerender) renderCharacterDetails(false, false);
        if (shouldAlert) alert(characterDetailsDraftError);
        return false;
    }
    generatedCharacter = parsed;
    isEditingCharacterDetails = false;
    characterDetailsDraftError = '';
    characterDetailsDraftJson = '';
    if (shouldRerender) renderCharacterDetails(false, false);
    return true;
}

// ─── Custom Action Input Setup ─────────────────────

function setupCustomActionInput() {
    var customActionInput = document.getElementById('customActionInput');
    var customActionBtn = document.getElementById('customActionBtn');
    if (!customActionInput || !customActionBtn) return;
    // --- Autosize textarea ---
    if (customActionInput.tagName === 'TEXTAREA') {
        var autosize = function() {
            this.style.height = 'auto';
            // Add 2px to account for border-box rounding issues
            this.style.height = (this.scrollHeight + 2) + 'px';
        };
        customActionInput.addEventListener('input', autosize);
        // Initial autosize
        autosize.call(customActionInput);
    }
    // Submit on button click
    customActionBtn.onclick = function() {
        var val = customActionInput.value.trim();
        if (val) {
            handleActionLoop(val);
            customActionInput.value = '';
            if (customActionInput.tagName === 'TEXTAREA') {
                customActionInput.style.height = 'auto';
            }
        }
    };
    // Submit on Enter key (with Shift+Enter for newline)
    customActionInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            customActionBtn.click();
        }
    });
}

// ─── Load Saved Characters on Startup ────────────────────────────────────────

async function loadSavedCharactersOnStartup() {
    var records = loadAllCharacters();
    if (!Array.isArray(records)) records = [];
    records.forEach(function(record) {
        savedCharacterData[record.key] = record.character;
        savedEnvironmentData[record.key] = record.environment;
        savedHistoryData[record.key] = record.history;
    });
    if (records.length > 0) renderSavedCharacterCards(records);
    else renderMiniChars();
}

function renderSavedCharacterCards(records) {
    // Build miniChars data array from saved records (only adult-age, not already present)
    records.forEach(function(record) {
        var char = record.character;
        if (!char || !char.name) return;
        if (!isAdultAge(char.age)) return;
        var existingMini = miniChars.find(function(c) { return c.isSaved && c.key === record.key; });
        var lastPlayedValue = record.lastPlayed || (char && char.last_played) || '';
        if (existingMini) {
            existingMini.lastPlayed = lastPlayedValue;
        } else {
            miniChars.push({
                key: record.key,
                name: char.name,
                gender: char.gender,
                age: char.age,
                position: char.position,
                lastPlayed: lastPlayedValue,
                isSaved: true,
                selected: false
            });
        }
    });

    renderMiniChars();
}

function resumeSavedCharacter(key) {
    var character = savedCharacterData[key];
    var environment = savedEnvironmentData[key];
    var history = savedHistoryData[key];
    if (!character) return;
    generatedCharacter = Object.assign({}, character);
    // Delegate to app.js global
    startGameWithSavedData(character, environment, history);
}

// ─── MiniChar Generation ──────────────────────────────────────────────────────

async function generateMiniChars() {
    var generateNamesBtn = document.getElementById('generateNamesBtn');
    if (isGeneratingNames) return;
    isGeneratingNames = true;
    if (generateNamesBtn) {
        generateNamesBtn.disabled = true;
        generateNamesBtn.textContent = 'Loading...';
    }
    selectedMiniChar = null;
    generatedCharacter = null;
    isEditingCharacterDetails = false;
    characterDetailsDraftJson = '';
    characterDetailsDraftError = '';
    renderCharacterDetails();

    try {
        var existingNames = miniChars.map(function(c) { return c.name; });
        // Build messages for getGoodMiniChars
        var systemMsg = {
            role: 'system',
            content: 'You are an expert RPG character generator. You generate brief details about fictional characters from an RPG universe, you may involve magic; At least one job should be mage. The NPC\'s jobs should be expected for an RPG game. You can even include some basic roles, like a baker. If possible, use gender neutral job titles, unless the job itself is specific to a certain gender. '
        };
        var userMsg = {
            role: 'user',
            content: 'Generate a list of 10 unique RPG character ideas. For each, provide only: name, gender, age, and position/title. You can use normal, real, and modern names. These characters should be level 2 (there are 20 total levels), which means they are not too powerful. They should each be 25 years old or younger. Do not use any names from this list: Elara, Jax, Kael, Rylan, Toren, Dax, ' + (existingNames.length ? existingNames.join(', ') : 'none') + '. Return as JSON array of objects with fields: name, gender, age, position.'
        };
        var miniList = await getGoodMiniChars([systemMsg, userMsg]);

        if (!Array.isArray(miniList)) miniList = [];

        // Only add new adult-age names not already in miniChars
        var existingNamesSet = {};
        miniChars.forEach(function(c) { existingNamesSet[c.name] = true; });
        var newMiniChars = miniList.filter(function(c) {
            return !existingNamesSet[c.name] && isAdultAge(c.age);
        });
        miniChars = miniChars.concat(newMiniChars.map(function(c) {
            return Object.assign({}, c, { selected: false });
        }));
        renderMiniChars();
    } catch (err) {
        alert('Error generating characters: ' + err);
    }

    isGeneratingNames = false;
    if (generateNamesBtn) {
        generateNamesBtn.disabled = false;
        generateNamesBtn.textContent = 'Generate Character Traits';
    }
}

// ─── MiniChar Rendering ───────────────────────────────────────────────────────

function renderMiniChars() {
    var miniCharsDiv = document.getElementById('miniChars');
    if (!miniCharsDiv) return;
    miniCharsDiv.innerHTML = '';

    // ── Custom character card (always shown) ──────────────────────────────────
    (function() {
        var card = document.createElement('div');
        card.className = 'character-card character-card--static';
        card.style.flexDirection = 'column';
        card.style.alignItems = 'stretch';

        var titleEl = document.createElement('div');
        titleEl.style.fontSize = '1.02em';
        titleEl.style.fontWeight = '600';
        titleEl.style.marginBottom = '0.8em';
        titleEl.textContent = 'Create your own character';
        card.appendChild(titleEl);

        var grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        grid.style.gap = '0.6em';

        function makeField(labelText, inputType, placeholder, opts) {
            var wrap = document.createElement('label');
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.gap = '0.25em';
            wrap.style.fontSize = '0.93em';
            wrap.style.color = '#b0b3b8';
            wrap.textContent = labelText;
            var input = document.createElement('input');
            input.type = inputType || 'text';
            input.placeholder = placeholder || '';
            if (opts && opts.min !== undefined) input.min = opts.min;
            if (opts && opts.max !== undefined) input.max = opts.max;
            input.style.background = '#1c2125';
            input.style.color = '#d9d9d9';
            input.style.border = '1px solid hsl(var(--accent-h),37%,24%)';
            input.style.borderRadius = '8px';
            input.style.padding = '0.45em 0.55em';
            input.style.fontSize = '0.96em';
            input.style.width = '100%';
            input.style.boxSizing = 'border-box';
            wrap.appendChild(input);
            grid.appendChild(wrap);
            return input;
        }

        var nameInput   = makeField('Name',   'text',   'e.g. Morgan');
        var genderInput = makeField('Gender', 'text',   'e.g. female');
        var ageInput    = makeField('Age',    'number', '18', { min: 18, max: 120 });
        var jobInput    = makeField('Job / Title', 'text', 'e.g. herbalist');
        card.appendChild(grid);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Create Character';
        btn.style.marginTop = '1.15em';
        btn.style.alignSelf = 'flex-end';
        btn.style.padding = '0.65em 1.2em';
        btn.style.fontSize = '0.98em';
        btn.style.fontWeight = '600';
        btn.style.borderRadius = '8px';
        btn.style.border = '1px solid hsl(var(--accent-h),70%,41%)';
        btn.style.background = 'hsl(var(--accent-h),74%,46%)';
        btn.style.color = '#ffffff';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease';
        btn.onmouseover = function() {
            btn.style.background = 'hsl(var(--accent-h),70%,41%)';
            btn.style.borderColor = '#0f4fa0';
            btn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.28)';
        };
        btn.onmouseout = function() {
            btn.style.background = 'hsl(var(--accent-h),74%,46%)';
            btn.style.borderColor = 'hsl(var(--accent-h),70%,41%)';
            btn.style.boxShadow = 'none';
        };
        btn.onclick = async function() {
            var name   = nameInput.value.trim();
            var gender = genderInput.value.trim();
            var age    = parseInt(ageInput.value, 10);
            var job    = jobInput.value.trim();
            if (!name)   { nameInput.focus();   return; }
            if (!gender) { genderInput.focus(); return; }
            if (!Number.isFinite(age) || age < 18) { ageInput.focus(); return; }
            if (!job)    { jobInput.focus();    return; }
            var customMiniChar = { name: name, gender: gender, age: age, position: job };
            try {
                selectMiniChar(customMiniChar);
                isEditingCharacterDetails = false;
                characterDetailsDraftJson = '';
                characterDetailsDraftError = '';
                generatedCharacter = Object.assign({}, customMiniChar);
                setPhase('details');
                renderCharacterDetails(false, true);
                await addCharacter();
                isAddingCharacter = false;
                renderCharacterDetails(false, false);
            } catch (e) {
                console.error('[customCharBtn] Error in addCharacter:', e);
                isAddingCharacter = false;
                renderCharacterDetails(false, false);
            }
        };
        card.appendChild(btn);
        miniCharsDiv.appendChild(card);
    }());

    var generatedMiniChars = miniChars.filter(function(mini) {
        return !mini.isSaved && isAdultAge(mini.age);
    });
    var savedMiniChars = miniChars
        .filter(function(mini) { return !!mini.isSaved && isAdultAge(mini.age); })
        .sort(function(a, b) {
            var bTime = parseLastPlayedTimestamp(b.lastPlayed);
            if (bTime === null) bTime = -1;
            var aTime = parseLastPlayedTimestamp(a.lastPlayed);
            if (aTime === null) aTime = -1;
            return bTime - aTime;
        });

    if (generatedMiniChars.length > 0) {
        var mixPanel = document.createElement('div');
        mixPanel.className = 'character-card character-card--static';
        // mixPanel.style.padding = '1em';
        mixPanel.style.flexDirection = 'column';
        mixPanel.style.alignItems = 'stretch';

        var title = document.createElement('div');
        title.style.fontSize = '1.02em';
        title.style.fontWeight = '600';
        title.style.marginBottom = '0.8em';
        title.textContent = 'Mix and match character traits';
        mixPanel.appendChild(title);

        var row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        row.style.gap = '0.6em';

        function getUniqueValues(list, key) {
            var seen = {};
            var values = [];
            list.forEach(function(item) {
                var raw = (item && item[key] !== undefined && item[key] !== null) ? String(item[key]).trim() : '';
                if (!raw) return;
                var normalized = raw.toLowerCase();
                if (seen[normalized]) return;
                seen[normalized] = true;
                values.push(raw);
            });
            return values;
        }

        var nameOptions = getUniqueValues(generatedMiniChars, 'name');
        var genderOptions = getUniqueValues(generatedMiniChars, 'gender');
        var ageOptions = getUniqueValues(generatedMiniChars, 'age')
            .filter(isAdultAge)
            .sort(function(a, b) {
                var numA = Number(a);
                var numB = Number(b);
                if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
                return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
            });
        var jobOptions = getUniqueValues(generatedMiniChars, 'position');

        function createLabeledSelect(labelText, options) {
            var wrap = document.createElement('label');
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.gap = '0.25em';
            wrap.style.fontSize = '0.93em';
            wrap.style.color = '#b0b3b8';
            wrap.textContent = labelText;

            var select = document.createElement('select');
            select.style.background = '#1c2125';
            select.style.color = '#d9d9d9';
            select.style.border = '1px solid hsl(var(--accent-h),37%,24%)';
            select.style.borderRadius = '8px';
            select.style.padding = '0.45em 0.55em';
            select.style.fontSize = '0.96em';
            options.forEach(function(value) {
                var option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            });
            wrap.appendChild(select);
            row.appendChild(wrap);
            return select;
        }

        var nameSelect = createLabeledSelect('Name', nameOptions);
        var genderSelect = createLabeledSelect('Gender', genderOptions);
        var ageSelect = createLabeledSelect('Age', ageOptions);
        var jobSelect = createLabeledSelect('Job', jobOptions);
        mixPanel.appendChild(row);

        // Keep data-minichar-name in sync with the name dropdown so selectMiniChar highlight works
        nameSelect.addEventListener('change', function() {
            if (chooseBtn) chooseBtn.setAttribute('data-minichar-name', String(nameSelect.value || '').trim());
        });

        var chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.textContent = 'Use these traits';
        chooseBtn.style.marginTop = '1.15em';
        chooseBtn.style.alignSelf = 'flex-end';
        chooseBtn.style.padding = '0.65em 1.2em';
        chooseBtn.style.fontSize = '0.98em';
        chooseBtn.style.fontWeight = '600';
        chooseBtn.style.borderRadius = '8px';
        chooseBtn.style.border = '1px solid hsl(var(--accent-h),70%,41%)';
        chooseBtn.style.background = 'hsl(var(--accent-h),74%,46%)';
        chooseBtn.style.color = '#ffffff';
        chooseBtn.style.cursor = 'pointer';
        chooseBtn.style.transition = 'background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease';
        if (nameOptions.length > 0) chooseBtn.setAttribute('data-minichar-name', nameOptions[0]);
        chooseBtn.onmouseover = function() {
            chooseBtn.style.background = 'hsl(var(--accent-h),70%,41%)';
            chooseBtn.style.borderColor = '#0f4fa0';
            chooseBtn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.28)';
        };
        chooseBtn.onmouseout = function() {
            chooseBtn.style.background = 'hsl(var(--accent-h),74%,46%)';
            chooseBtn.style.borderColor = 'hsl(var(--accent-h),70%,41%)';
            chooseBtn.style.boxShadow = 'none';
        };
        chooseBtn.onclick = async function() {
            try {
                var mixedMiniChar = {
                    name: String(nameSelect.value || '').trim(),
                    gender: String(genderSelect.value || '').trim(),
                    age: Number(ageSelect.value),
                    position: String(jobSelect.value || '').trim()
                };
                if (!mixedMiniChar.name || !mixedMiniChar.gender || !mixedMiniChar.position || !Number.isFinite(mixedMiniChar.age)) {
                    alert('Please select valid name, gender, age, and job values.');
                    return;
                }
                if (!isAdultAge(mixedMiniChar.age)) {
                    alert('Character age must be 18 or older.');
                    return;
                }
                chooseBtn.setAttribute('data-minichar-name', mixedMiniChar.name);
                selectMiniChar(mixedMiniChar);
                isEditingCharacterDetails = false;
                characterDetailsDraftJson = '';
                characterDetailsDraftError = '';
                generatedCharacter = Object.assign({}, mixedMiniChar);
                setPhase('details');
                renderCharacterDetails(false, true);
                await addCharacter();
                isAddingCharacter = false;
                renderCharacterDetails(false, false);
            } catch (e) {
                console.error('[chooseBtn] Error in addCharacter:', e);
                isAddingCharacter = false;
                renderCharacterDetails(false, false);
            }
        };
        mixPanel.appendChild(chooseBtn);
        miniCharsDiv.appendChild(mixPanel);
    } else {
        var emptyState = document.createElement('div');
        emptyState.className = 'character-card';
        emptyState.style.fontSize = '0.95em';
        emptyState.style.color = '#888';
        emptyState.textContent = 'Click "Generate Character Traits" to populate dropdown traits.';
        miniCharsDiv.appendChild(emptyState);
    }

    if (savedMiniChars.length > 0) {
        var savedHeader = document.createElement('div');
        savedHeader.style.marginTop = '0.8em';
        savedHeader.style.marginBottom = '0.4em';
        savedHeader.style.fontSize = '0.92em';
        savedHeader.style.color = 'hsl(var(--accent-h),90%,77%)';
        savedHeader.textContent = 'Saved Characters';
        miniCharsDiv.appendChild(savedHeader);

        savedMiniChars.forEach(function(mini) {
            var lastPlayedValue = mini.lastPlayed
                || (savedCharacterData[mini.key] && savedCharacterData[mini.key].last_played)
                || '';
            var lastPlayedLabel = formatLastPlayedLabel(lastPlayedValue);
            var card = document.createElement('div');
            card.className = 'character-card';
            card.style.cursor = 'pointer';
            card.style.display = 'flex';
            card.style.alignItems = 'center';
            card.style.justifyContent = 'space-between';
            card.style.margin = '0.2em 0';
            card.style.minHeight = 'unset';
            card.style.fontSize = '0.97em';

            var trash = document.createElement('span');
            trash.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='#FFFFFF' aria-hidden='true' data-slot='icon' stroke-linecap='round' stroke-linejoin='round' width='20px' height='20px'><path stroke-linecap='round' stroke-linejoin='round' d='m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0'/></svg>";
            trash.title = 'Remove';
            trash.style.fontSize = '1em';
            trash.style.opacity = '0.5';
            trash.style.marginLeft = '0.7em';
            trash.style.cursor = 'pointer';
            trash.onclick = function(e) {
                e.stopPropagation();
                var deleted = deleteCharacter(mini.key);
                if (!deleted) {
                    alert('Failed to remove saved character.');
                    return;
                }
                var idx = miniChars.findIndex(function(c) { return c.isSaved && c.key === mini.key; });
                if (idx >= 0) miniChars.splice(idx, 1);
                if (selectedMiniChar && selectedMiniChar.name === mini.name) {
                    selectedMiniChar = null;
                    generatedCharacter = null;
                }
                delete savedCharacterData[mini.key];
                delete savedEnvironmentData[mini.key];
                delete savedHistoryData[mini.key];
                renderMiniChars();
                renderCharacterDetails();
            };

            card.onclick = function() {
                resumeSavedCharacter(mini.key);
            };

            var infoDiv = document.createElement('div');
            infoDiv.style.flex = '1';
            infoDiv.style.minWidth = '0';
            infoDiv.innerHTML = '<strong>' + (mini.name || '') + '</strong><br>' +
                '<span style="color:#888;">' + (mini.gender || '') + ', age ' + (mini.age || '') + ', ' + (mini.position || '') + '</span>' +
                '<span style="color:hsl(var(--accent-h),90%,77%);font-size:0.75em;margin-left:0.5em;"><br>[saved]</span>' +
                '<span style="color:#b0b3b8;font-size:0.75em;"><br>Last played: ' + lastPlayedLabel + '</span>';

            card.appendChild(infoDiv);
            card.appendChild(trash);
            miniCharsDiv.appendChild(card);
        });
    }
}

// ─── MiniChar Selection ───────────────────────────────────────────────────────

function selectMiniChar(miniChar) {
    selectedMiniChar = miniChar;
    // Highlight selected button in #miniChars
    var miniCharsDiv = document.getElementById('miniChars');
    if (miniCharsDiv) {
        var buttons = miniCharsDiv.querySelectorAll('button[data-minichar-name]');
        buttons.forEach(function(btn) {
            btn.classList.toggle('selected', btn.getAttribute('data-minichar-name') === (miniChar && miniChar.name));
        });
    }
    renderCharacterDetails(false, miniChar);
}

// ─── Character Details Rendering ─────────────────────────────────────────────

function renderCharacterDetails(loading, partialMiniChar) {
    if (loading === undefined) loading = false;
    if (partialMiniChar === undefined) partialMiniChar = false;

    var characterDetailsDiv = document.getElementById('characterDetails');

    if (!characterDetailsDiv) return;

    if (loading) {
        characterDetailsDiv.innerHTML = '<div class="character-card selected character-details-card">' +
            '<div class="character-details-columns">' +
            '<div class="character-details-col" id="char-details-leftcol">' +
            '<div class="char-header">' +
            '<span class="char-name">' + loadingPlaceholder('6em', '1.5em', true) + '</span>' +
            '<span class="char-nickname">' + loadingPlaceholder('4em', '1em', true) + '</span>' +
            '<span class="char-title">' + loadingPlaceholder('4em', '1em', true) + '</span>' +
            '</div>' +
            '<div class="char-meta-row">' +
            '<span class="char-gender">' + loadingPlaceholder('2.5em', '1em', true) + '</span>' +
            '<span class="char-age">' + loadingPlaceholder('2.5em', '1em', true) + '</span>' +
            '<span class="char-height">' + loadingPlaceholder('2.5em', '1em', true) + '</span>' +
            '</div>' +
            '<div class="char-section-description char-section"><div class="char-section-label">Description</div><div class="char-description">' + loadingPlaceholder('6em', '1em', true) + '</div></div>' +
            '<div class="char-section-flaws char-section"><div class="char-section-label">Flaws</div><div class="char-flaws">' + loadingPlaceholder('4em', '1em', true) + '</div></div>' +
            '<div class="char-section-location char-section"><div class="char-section-label">Starting Location</div><div class="char-location">' + loadingPlaceholder('4em', '1em', true) + '</div></div>' +
            '<div class="char-section-agility char-section"><div class="char-section-label">Agility</div><div class="char-agility">' + loadingPlaceholder('3em', '1em', true) + '</div></div>' +
            '</div>' +
            '<div class="character-details-col" id="char-details-rightcol">' +
            '<div class="char-section-abilities char-section"><div class="char-section-label">Abilities</div><div class="char-abilities-content">' + loadingPlaceholder('3em', '1em', true) + '</div></div>' +
            '<div class="char-section-limitations char-section"><div class="char-section-label">Limitations</div><div class="char-limitations-content">' + loadingPlaceholder('3em', '1em', true) + '</div></div>' +
            '<div class="char-section-inventory char-section char-inventory-section"><div class="char-section-label">Inventory</div><div class="char-inventory-content"><ul class="char-inventory-list" style="gap:0.3em 0.7em;"><li class="char-inventory-item char-empty">' + loadingPlaceholder('3em', '1em', true) + '</li></ul></div></div>' +
            '<div id="chooseCharacterBtnContainer" class="character-actions-bar"></div>' +
            '</div>' +
            '</div>' +
            '</div>';
        return;
    }

    var char = generatedCharacter || {};
    if (partialMiniChar && selectedMiniChar) {
        char = Object.assign({}, selectedMiniChar);
    }
    if (!char || (!char.name && !partialMiniChar)) {
        characterDetailsDiv.innerHTML = '<div class="character-card selected" style="display:flex;align-items:center;justify-content:center;min-height:10em;">No character generated.</div>';
        return;
    }

    // Card structure: only create once
    var card = characterDetailsDiv.querySelector('.character-details-card');
    var leftCol, rightCol;
    if (!card) {
        characterDetailsDiv.innerHTML = '';
        card = document.createElement('div');
        card.className = 'character-card selected character-details-card';
        var columns = document.createElement('div');
        columns.className = 'character-details-columns';

        leftCol = document.createElement('div');
        leftCol.className = 'character-details-col';
        leftCol.id = 'char-details-leftcol';

        rightCol = document.createElement('div');
        rightCol.className = 'character-details-col';
        rightCol.id = 'char-details-rightcol';

        var headerSection = document.createElement('div');
        headerSection.className = 'char-header';
        headerSection.innerHTML = '<span class="char-name"></span><span class="char-nickname"></span><span class="char-title"></span>';
        leftCol.appendChild(headerSection);

        var metaSection = document.createElement('div');
        metaSection.className = 'char-meta-row';
        leftCol.appendChild(metaSection);

        var descSection = document.createElement('div');
        descSection.className = 'char-section-description char-section';
        descSection.innerHTML = '<div class="char-section-label">Description</div><div class="char-description"></div>';
        leftCol.appendChild(descSection);

        var flawsSection = document.createElement('div');
        flawsSection.className = 'char-section-flaws char-section';
        flawsSection.innerHTML = '<div class="char-section-label">Flaws</div><div class="char-flaws"></div>';
        leftCol.appendChild(flawsSection);

        var locSection = document.createElement('div');
        locSection.className = 'char-section-location char-section';
        locSection.innerHTML = '<div class="char-section-label">Starting Location</div><div class="char-location"></div>';
        leftCol.appendChild(locSection);

        var agiSection = document.createElement('div');
        agiSection.className = 'char-section-agility char-section';
        agiSection.innerHTML = '<div class="char-section-label">Agility</div><div class="char-agility"></div>';
        leftCol.appendChild(agiSection);

        var abilitiesSection = document.createElement('div');
        abilitiesSection.className = 'char-section-abilities char-section';
        abilitiesSection.innerHTML = '<div class="char-section-label">Abilities</div><div class="char-abilities-content"></div>';
        rightCol.appendChild(abilitiesSection);

        var limitationsSection = document.createElement('div');
        limitationsSection.className = 'char-section-limitations char-section';
        limitationsSection.innerHTML = '<div class="char-section-label">Limitations</div><div class="char-limitations-content"></div>';
        rightCol.appendChild(limitationsSection);

        var inventorySection = document.createElement('div');
        inventorySection.className = 'char-section-inventory char-section char-inventory-section';
        inventorySection.innerHTML = '<div class="char-section-label">Inventory</div><div class="char-inventory-content"></div>';
        rightCol.appendChild(inventorySection);

        var editorSection = document.createElement('div');
        editorSection.className = 'char-section-editor char-section';
        editorSection.innerHTML = '<div class="char-section-label">Character Details</div><div class="char-editor-content"></div>';
        rightCol.appendChild(editorSection);

        var btnContainer = document.createElement('div');
        btnContainer.id = 'chooseCharacterBtnContainer';
        btnContainer.className = 'character-actions-bar';
        rightCol.appendChild(btnContainer);

        columns.appendChild(leftCol);
        columns.appendChild(rightCol);
        card.appendChild(columns);
        characterDetailsDiv.appendChild(card);
    } else {
        leftCol = card.querySelector('#char-details-leftcol');
        rightCol = card.querySelector('#char-details-rightcol');
    }

    // Header
    var hSection = leftCol.querySelector('.char-header');
    if (hSection) {
        hSection.querySelector('.char-name').textContent = char.name || '';
        hSection.querySelector('.char-nickname').textContent = char.nickname ? '"' + char.nickname + '"' : '';
        hSection.querySelector('.char-title').textContent = char.position || '';
    }

    // Meta row
    var mSection = leftCol.querySelector('.char-meta-row');
    if (mSection) {
        function metaItem(label, value) {
            if (value !== undefined && value !== null && value !== '') {
                return '<span class="meta-tooltip-hover" tabindex="0" data-tooltip-html="' + encodeURIComponent('<span class=\'meta-tooltip-simple\'>' + label + '</span>') + '">' + value + '</span>';
            }
            return loadingPlaceholder('2.5em', '1em', true);
        }
        mSection.innerHTML =
            '<span class="char-gender"> ' + (('gender' in char) && char.gender !== undefined && char.gender !== null && char.gender !== '' ? metaItem('Gender', char.gender) : loadingPlaceholder('2.5em', '1em', true)) + '</span>' +
            '<span class="char-age"> ' + (('age' in char) && char.age !== undefined && char.age !== null && char.age !== '' ? metaItem('Age', char.age) : loadingPlaceholder('2.5em', '1em', true)) + '</span>' +
            '<span class="char-height"> ' + (('height' in char) && char.height !== undefined && char.height !== null && char.height !== '' ? metaItem('Height', char.height) : loadingPlaceholder('2.5em', '1em', true)) + '</span>';
    }

    // Helper for animated section updates
    function updateSection(el, newHtml) {
        if (el && el.innerHTML !== newHtml) {
            el.innerHTML = newHtml;
            el.classList.add('character-detail-fade');
            el.addEventListener('animationend', function handler() {
                el.classList.remove('character-detail-fade');
                el.removeEventListener('animationend', handler);
            });
        }
    }

    // Description
    var dSection = leftCol.querySelector('.char-section-description');
    if (dSection) {
        var dContent = dSection.querySelector('.char-description');
        var dHtml;
        if ('description' in char && char.description) {
            dHtml = char.description;
        } else if (!('description' in char)) {
            dHtml = loadingPlaceholder('6em', '1em', true);
        } else {
            dHtml = 'N/A';
        }
        updateSection(dContent, dHtml);
    }

    // Flaws
    var fSection = leftCol.querySelector('.char-section-flaws');
    if (fSection) {
        var fContent = fSection.querySelector('.char-flaws');
        var fHtml;
        if ('flaws' in char && char.flaws) {
            fHtml = char.flaws;
        } else if (!('flaws' in char)) {
            fHtml = loadingPlaceholder('4em', '1em', true);
        } else {
            fHtml = 'N/A';
        }
        updateSection(fContent, fHtml);
    }

    // Location
    var lSection = leftCol.querySelector('.char-section-location');
    if (lSection) {
        var lContent = lSection.querySelector('.char-location');
        var lHtml;
        if ('rpg_starting_location' in char && char.rpg_starting_location) {
            lHtml = char.rpg_starting_location;
        } else if (!('rpg_starting_location' in char)) {
            lHtml = loadingPlaceholder('4em', '1em', true);
        } else {
            lHtml = 'N/A';
        }
        updateSection(lContent, lHtml);
    }

    // Agility
    var aSection = leftCol.querySelector('.char-section-agility');
    if (aSection) {
        var aContent = aSection.querySelector('.char-agility');
        var aHtml;
        if ('agility' in char && char.agility) {
            aHtml = char.agility;
        } else if (!('agility' in char)) {
            aHtml = loadingPlaceholder('3em', '1em', true);
        } else {
            aHtml = 'N/A';
        }
        updateSection(aContent, aHtml);
    }

    // Abilities
    var abSection = rightCol.querySelector('.char-section-abilities');
    if (abSection) {
        var abContent = abSection.querySelector('.char-abilities-content');
        var abHtml;
        if ('abilities' in char && Array.isArray(char.abilities) && char.abilities.length > 0) {
            abHtml = '<ul class="char-abilities-list" style="gap:0.3em 0.7em;list-style:none;padding-left:0;margin:0;">' +
                char.abilities.map(function(item) {
                    if (typeof item === 'string') {
                        return '<li class="char-abilities-item" style="font-size:0.97em;padding:0.22em 0.7em;">' + item + '</li>';
                    }
                    return '<li class="char-abilities-item" style="font-size:0.97em;padding:0.22em 0.7em;"><strong>' + (item.name || '') + '</strong><span style="color:#b0b3b8;font-size:0.96em;margin-left:0.5em;">' + (item.description || '') + '</span></li>';
                }).join('') + '</ul>';
        } else if (!('abilities' in char)) {
            abHtml = '<div class="char-abilities char-empty">' + loadingPlaceholder('3em', '1em', true) + '</div>';
        } else {
            abHtml = '<div class="char-abilities char-empty">None</div>';
        }
        updateSection(abContent, abHtml);
    }

    // Limitations
    var limSection = rightCol.querySelector('.char-section-limitations');
    if (limSection) {
        var limContent = limSection.querySelector('.char-limitations-content');
        var limHtml;
        if ('limitations' in char && Array.isArray(char.limitations) && char.limitations.length > 0) {
            limHtml = '<ul class="char-limitations-list" style="gap:0.3em 0.7em;list-style:none;padding-left:0;margin:0">' +
                char.limitations.map(function(item) {
                    return '<li class="char-limitations-item" style="font-size:0.97em;padding:0.22em 0.7em;">' + item + '</li>';
                }).join('') + '</ul>';
        } else if (!('limitations' in char)) {
            limHtml = '<div class="char-limitations char-empty">' + loadingPlaceholder('3em', '1em', true) + '</div>';
        } else {
            limHtml = '<div class="char-limitations char-empty">None</div>';
        }
        updateSection(limContent, limHtml);
    }

    // Inventory
    var invSection = rightCol.querySelector('.char-section-inventory');
    if (invSection) {
        var invContent = invSection.querySelector('.char-inventory-content');
        var invHtml;
        if ('inventory' in char && Array.isArray(char.inventory) && char.inventory.length > 0) {
            invHtml = '<ul class="char-inventory-list" style="gap:0.3em 0.7em;">' +
                char.inventory.map(function(item) {
                    if (typeof item === 'string') {
                        return '<li class="char-inventory-item" style="font-size:0.97em;padding:0.22em 0.7em;">' + item + '</li>';
                    }
                    var tooltipRows = '';
                    if (item.description) {
                        tooltipRows += '<div class="popup-tooltip-row"><span class="popup-tooltip-label">Description:</span><span class="popup-tooltip-value">' + item.description + '</span></div>';
                    }
                    if (item.quantity !== undefined) {
                        tooltipRows += '<div class="popup-tooltip-row"><span class="popup-tooltip-label">Quantity:</span><span class="popup-tooltip-value">' + item.quantity + '</span></div>';
                    }
                    if (item.weight !== undefined) {
                        tooltipRows += '<div class="popup-tooltip-row"><span class="popup-tooltip-label">Weight:</span><span class="popup-tooltip-value">' + item.weight + '</span></div>';
                    }
                    var tooltipHtml = '<span class="popup-tooltip-title">' + (item.name || 'Item') + '</span>' +
                        (tooltipRows || '<div class="popup-tooltip-row"><span class="popup-tooltip-label">No details</span></div>');
                    return '<li class="char-inventory-item" style="font-size:0.97em;padding:0.22em 0.7em;position:relative;z-index:2;background:none;">' +
                        '<span class="inventory-hover" tabindex="0" data-tooltip-html="' + encodeURIComponent(tooltipHtml) + '" style="position:relative;z-index:3;">' +
                        (item.name || 'Item') + '</span></li>';
                }).join('') + '</ul>';
        } else if (!('inventory' in char)) {
            invHtml = '<ul class="char-inventory-list" style="gap:0.3em 0.7em;"><li class="char-inventory-item char-empty">' + loadingPlaceholder('3em', '1em', true) + '</li></ul>';
        } else {
            invHtml = '<ul class="char-inventory-list" style="gap:0.3em 0.7em;"><li class="char-inventory-item char-empty">Empty</li></ul>';
        }
        updateSection(invContent, invHtml);
    }

    // Editor section
    var edSection = rightCol.querySelector('.char-section-editor');
    if (edSection) {
        var edContent = edSection.querySelector('.char-editor-content');
        if (edContent) {
            edContent.innerHTML = '';
            if (isEditingCharacterDetails) {
                var helperText = document.createElement('div');
                helperText.style.fontSize = '0.92em';
                helperText.style.color = '#b0b3b8';
                helperText.style.marginBottom = '0.5em';
                helperText.textContent = 'Edit any character field as JSON before generating the environment.';
                edContent.appendChild(helperText);

                var textarea = document.createElement('textarea');
                textarea.id = 'characterJsonEditor';
                textarea.value = characterDetailsDraftJson || JSON.stringify(char, null, 2);
                textarea.style.width = '100%';
                textarea.style.minHeight = '13em';
                textarea.style.resize = 'vertical';
                textarea.style.padding = '0.55em 0.7em';
                textarea.style.borderRadius = '8px';
                textarea.style.border = '1px solid hsl(var(--accent-h),37%,24%)';
                textarea.style.background = '#1c2125';
                textarea.style.color = '#d9d9d9';
                textarea.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
                textarea.style.fontSize = '0.9em';
                textarea.oninput = function() {
                    characterDetailsDraftJson = textarea.value;
                    if (characterDetailsDraftError) {
                        characterDetailsDraftError = '';
                        renderCharacterDetails(false, false);
                    }
                };
                edContent.appendChild(textarea);

                var controls = document.createElement('div');
                controls.style.display = 'flex';
                controls.style.gap = '0.45em';
                controls.style.marginTop = '0.55em';

                var applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.textContent = 'Apply changes';
                applyBtn.disabled = isAddingCharacter;
                applyBtn.onclick = function() { applyCharacterDetailsEdit(); };

                var cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.disabled = isAddingCharacter;
                cancelBtn.onclick = cancelCharacterDetailsEdit;

                controls.appendChild(applyBtn);
                controls.appendChild(cancelBtn);
                edContent.appendChild(controls);

                if (characterDetailsDraftError) {
                    var errorEl = document.createElement('div');
                    errorEl.style.color = '#f28b82';
                    errorEl.style.fontSize = '0.9em';
                    errorEl.style.marginTop = '0.45em';
                    errorEl.textContent = characterDetailsDraftError;
                    edContent.appendChild(errorEl);
                }
            } else {
                var helperText2 = document.createElement('div');
                helperText2.style.fontSize = '0.92em';
                helperText2.style.color = '#b0b3b8';
                helperText2.style.marginBottom = '0.55em';
                helperText2.textContent = 'Need to tweak anything? Open full JSON and edit before starting.';
                edContent.appendChild(helperText2);

                var editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.textContent = 'Edit details (JSON)';
                editBtn.disabled = isAddingCharacter;
                editBtn.onclick = beginCharacterDetailsEdit;
                edContent.appendChild(editBtn);
            }
        }
    }

    // Button container
    var btnContainer = rightCol.querySelector('#chooseCharacterBtnContainer');
    if (!btnContainer) {
        btnContainer = document.createElement('div');
        btnContainer.id = 'chooseCharacterBtnContainer';
        btnContainer.className = 'character-actions-bar';
        rightCol.appendChild(btnContainer);
    }

    // Ensure Choose and Regenerate buttons exist in container
    var chooseCharacterBtn = document.getElementById('chooseCharacterBtn');
    var regenerateCharacterBtn = document.getElementById('regenerateCharacterBtn');

    if (chooseCharacterBtn && !btnContainer.contains(chooseCharacterBtn)) {
        btnContainer.appendChild(chooseCharacterBtn);
    }
    if (regenerateCharacterBtn && !btnContainer.contains(regenerateCharacterBtn)) {
        btnContainer.appendChild(regenerateCharacterBtn);
    }

    if (chooseCharacterBtn) chooseCharacterBtn.style.display = '';
    if (regenerateCharacterBtn) regenerateCharacterBtn.style.display = '';

    if (isAddingCharacter) {
        if (chooseCharacterBtn) { chooseCharacterBtn.disabled = true; chooseCharacterBtn.classList.add('disabled'); }
        if (regenerateCharacterBtn) { regenerateCharacterBtn.disabled = true; regenerateCharacterBtn.classList.add('disabled'); }
    } else {
        if (chooseCharacterBtn) { chooseCharacterBtn.disabled = false; chooseCharacterBtn.classList.remove('disabled'); }
        if (regenerateCharacterBtn) { regenerateCharacterBtn.disabled = false; regenerateCharacterBtn.classList.remove('disabled'); }
    }

    // Bind tooltip events to inventory and meta tooltip hover elements
    setTimeout(function() {
        document.querySelectorAll('.inventory-hover, .meta-tooltip-hover').forEach(function(elem) {
            elem.onmouseenter = function() {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                var html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                showGlobalTooltip(html, this);
            };
            elem.onmouseleave = function() {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
            elem.onfocus = function() {
                tooltipHoverState.overTarget = true;
                clearTimeout(tooltipHoverState.hideTimeout);
                var html = decodeURIComponent(this.getAttribute('data-tooltip-html') || '');
                showGlobalTooltip(html, this);
            };
            elem.onblur = function() {
                tooltipHoverState.overTarget = false;
                scheduleTooltipHide();
            };
        });
    }, 0);
}

// ─── Stepwise Character Generation ───────────────────────────────────────────

async function addCharacter() {
    if (!selectedMiniChar || isAddingCharacter) {
        console.log('[addCharacter] Skipped: selectedMiniChar or isAddingCharacter falsey', { selectedMiniChar: selectedMiniChar, isAddingCharacter: isAddingCharacter });
        return;
    }
    isAddingCharacter = true;
    isEditingCharacterDetails = false;
    characterDetailsDraftJson = '';
    characterDetailsDraftError = '';

    var chooseCharacterBtn = document.getElementById('chooseCharacterBtn');
    var regenerateCharacterBtn = document.getElementById('regenerateCharacterBtn');
    if (chooseCharacterBtn) { chooseCharacterBtn.disabled = true; chooseCharacterBtn.classList.add('disabled'); }
    if (regenerateCharacterBtn) { regenerateCharacterBtn.disabled = true; regenerateCharacterBtn.classList.add('disabled'); }

    generatedCharacter = Object.assign({}, selectedMiniChar);
    renderCharacterDetails(false, false);

    // Step 1: Basic info
    var basicInfo = null;
    try {
        console.log('[addCharacter] Fetching basic character info for:', selectedMiniChar);
        basicInfo = await getBasicCharacterInfo(selectedMiniChar);
        console.log('[addCharacter] basicInfo result:', basicInfo);
        generatedCharacter = Object.assign({}, generatedCharacter, basicInfo);
        renderCharacterDetails(false, false);
    } catch (err) {
        console.error('[addCharacter] Error in getBasicCharacterInfo:', err);
        renderCharacterDetails(false, false);
    }

    if (!basicInfo) {
        isAddingCharacter = false;
        renderCharacterDetails(false, false);
        return;
    }

    // Step 2: Traits
    var traits = null;
    try {
        console.log('[addCharacter] Fetching character traits for:', basicInfo);
        traits = await getCharacterTraits(basicInfo);
        console.log('[addCharacter] traits result:', traits);
        generatedCharacter = Object.assign({}, generatedCharacter, traits);
        renderCharacterDetails(false, false);
    } catch (err) {
        console.error('[addCharacter] Error in getCharacterTraits:', err);
        renderCharacterDetails(false, false);
    }

    // Step 3: Inventory
    try {
        console.log('[addCharacter] Fetching character inventory for:', { basicInfo: basicInfo, traits: traits });
        var inventoryResult = await getCharacterInventory(basicInfo, traits);
        console.log('[addCharacter] inventory result:', inventoryResult);
        generatedCharacter = Object.assign({}, generatedCharacter, { inventory: (inventoryResult && inventoryResult.items) ? inventoryResult.items : (Array.isArray(inventoryResult) ? inventoryResult : []) });
        renderCharacterDetails(false, false);
    } catch (err) {
        console.error('[addCharacter] Error in getCharacterInventory:', err);
        renderCharacterDetails(false, false);
    }

    isAddingCharacter = false;
    renderCharacterDetails(false, false);
}

async function regenerateCharacter() {
    if (!selectedMiniChar || isAddingCharacter) return;
    isAddingCharacter = true;
    isEditingCharacterDetails = false;
    characterDetailsDraftJson = '';
    characterDetailsDraftError = '';

    var chooseCharacterBtn = document.getElementById('chooseCharacterBtn');
    var regenerateCharacterBtn = document.getElementById('regenerateCharacterBtn');
    if (chooseCharacterBtn) { chooseCharacterBtn.disabled = true; chooseCharacterBtn.classList.add('disabled'); }
    if (regenerateCharacterBtn) { regenerateCharacterBtn.disabled = true; regenerateCharacterBtn.classList.add('disabled'); }

    generatedCharacter = Object.assign({}, selectedMiniChar);
    renderCharacterDetails(false, false);

    var basicInfo = null;
    try {
        basicInfo = await getBasicCharacterInfo(selectedMiniChar);
        generatedCharacter = Object.assign({}, generatedCharacter, basicInfo);
        renderCharacterDetails(false, false);
    } catch (err) {
        renderCharacterDetails(false, false);
        isAddingCharacter = false;
        renderCharacterDetails(false, false);
        return;
    }

    var traits = null;
    try {
        traits = await getCharacterTraits(basicInfo);
        generatedCharacter = Object.assign({}, generatedCharacter, traits);
        renderCharacterDetails(false, false);
    } catch (err) {
        renderCharacterDetails(false, false);
        isAddingCharacter = false;
        renderCharacterDetails(false, false);
        return;
    }

    try {
        var inventoryResult = await getCharacterInventory(basicInfo, traits);
        generatedCharacter = Object.assign({}, generatedCharacter, { inventory: (inventoryResult && inventoryResult.items) ? inventoryResult.items : (Array.isArray(inventoryResult) ? inventoryResult : []) });
        renderCharacterDetails(false, false);
    } catch (err) {
        renderCharacterDetails(false, false);
    }

    isAddingCharacter = false;
    renderCharacterDetails(false, false);
}
