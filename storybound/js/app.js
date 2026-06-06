// js/app.js — requires: all other js/ files

var mainFlex = document.getElementById('mainFlex');
var phase1Box = document.getElementById('phase1-centerbox');
var contentBox = document.querySelector('.content');
var gameSidebar = document.getElementById('gameSidebar');
var gameContent = document.getElementById('gameContent');
var phase1Placeholder = document.getElementById('phase1-placeholder');

function setPhase(newPhase) {
  if (newPhase === 'select') {
    mainFlex.classList.add('centered-phase');
    if (phase1Box) phase1Box.style.display = '';
    if (contentBox) contentBox.style.display = 'none';
    if (gameSidebar) gameSidebar.style.display = 'none';
    if (gameContent) gameContent.style.display = 'none';
    if (phase1Placeholder) phase1Placeholder.style.display = '';
  } else if (newPhase === 'details') {
    mainFlex.classList.remove('centered-phase');
    if (phase1Box) phase1Box.style.display = 'none';
    if (contentBox) contentBox.style.display = '';
    if (gameSidebar) gameSidebar.style.display = 'none';
    if (gameContent) gameContent.style.display = 'none';
    if (phase1Placeholder) phase1Placeholder.style.display = 'none';
  } else if (newPhase === 'game') {
    mainFlex.classList.remove('centered-phase');
    if (phase1Box) phase1Box.style.display = 'none';
    if (contentBox) contentBox.style.display = 'none';
    if (gameSidebar) gameSidebar.style.display = '';
    if (gameContent) gameContent.style.display = '';
    if (phase1Placeholder) phase1Placeholder.style.display = 'none';
    // Trigger textarea autosize now that it's visible
    var customActionInput = document.getElementById('customActionInput');
    if (customActionInput) customActionInput.dispatchEvent(new Event('input'));
  }
  updateTopPanelsLayout();
}

function saveFullProgress(character, environment, history) {
  if (!character) return;
  var env = ensureSecretNpcDetailsForSave(environment);
  saveWorldCharacter(currentWorldId, currentCharacterId, character, env, history);

  // Sync world-level NPC and location knowledge from current session state
  if (currentWorldId && character.name) {
    var allNpcs = [];
    if (environment && Array.isArray(environment.people)) {
      allNpcs = allNpcs.concat(environment.people);
    }
    if (typeof removedNearbyCharacters !== 'undefined' && Array.isArray(removedNearbyCharacters)) {
      removedNearbyCharacters.forEach(function(p) {
        var already = allNpcs.some(function(n) {
          return String(n.name).toLowerCase().trim() === String(p.name).toLowerCase().trim();
        });
        if (!already) allNpcs.push(p);
      });
    }
    var location = environment && environment.location ? environment.location : '';
    syncWorldKnowledge(currentWorldId, allNpcs, location, character.name);
  }
}

// Build world context for getActionResponse: other characters + world NPCs not currently nearby
function buildWorldContext() {
  if (!currentWorldId || !currentCharacterId) return null;
  var world = getWorld(currentWorldId);
  if (!world) return null;
  var others = Array.isArray(world.characters) ? world.characters.filter(function(c) {
    return c.id !== currentCharacterId && c.character && c.character.name;
  }) : [];

  // World NPCs that are not currently nearby in this session
  var nearbyNames = (typeof environmentData !== 'undefined' && Array.isArray(environmentData && environmentData.people))
    ? environmentData.people.map(function(p) { return String(p.name).toLowerCase().trim(); })
    : [];
  var worldNpcs = Array.isArray(world.npcs) ? world.npcs.filter(function(n) {
    return nearbyNames.indexOf(String(n.name).toLowerCase().trim()) === -1;
  }) : [];

  // NPC memories for currently nearby NPCs
  var nearbyNpcMemories = {};
  if (typeof environmentData !== 'undefined' && Array.isArray(environmentData && environmentData.people)) {
    var worldNpcMap = {};
    (Array.isArray(world.npcs) ? world.npcs : []).forEach(function(n) {
      worldNpcMap[String(n.name).toLowerCase().trim()] = n;
    });
    environmentData.people.forEach(function(p) {
      var wn = worldNpcMap[String(p.name).toLowerCase().trim()];
      if (wn && Array.isArray(wn.memories) && wn.memories.length > 0) {
        nearbyNpcMemories[p.name] = wn.memories;
      }
    });
  }

  if (!others.length && !worldNpcs.length && !Object.keys(nearbyNpcMemories).length) return null;
  return {
    otherCharacters: others.map(function(c) {
      return {
        name: c.character.name,
        position: c.character.position || '',
        location: (c.environment && c.environment.location) || 'unknown location'
      };
    }),
    worldNpcs: worldNpcs,
    nearbyNpcMemories: nearbyNpcMemories
  };
}

// Build world context for environment generation: story logs + world-level NPC/location knowledge
function buildWorldContextForEnv() {
  if (!currentWorldId || !currentCharacterId) return null;
  var world = getWorld(currentWorldId);
  if (!world) return null;
  var others = Array.isArray(world.characters) ? world.characters.filter(function(c) {
    return c.id !== currentCharacterId && c.character && c.character.name;
  }) : [];
  var storyLogs = others
    .filter(function(c) { return c.character && c.character.story_log; })
    .map(function(c) { return c.character.name + ': ' + c.character.story_log; });
  var worldNpcs = Array.isArray(world.npcs) ? world.npcs : [];
  var worldLocations = Array.isArray(world.locations) ? world.locations : [];
  if (!others.length && !worldNpcs.length && !worldLocations.length) return null;
  return {
    otherCharacters: others.map(function(c) {
      return {
        name: c.character.name,
        position: c.character.position || '',
        location: (c.environment && c.environment.location) || ''
      };
    }),
    worldHistory: storyLogs.length ? storyLogs.join(' | ') : null,
    worldNpcs: worldNpcs,
    worldLocations: worldLocations
  };
}

async function generateEnvironment(startingLocation, character) {
  var worldCtx = buildWorldContextForEnv();
  var env = await getEnvironment(startingLocation, character, worldCtx);
  if (typeof env === 'string') env = JSON.parse(env);

  // Extract and apply world name, then strip it from the environment data
  var worldName = String(env.world_name || '').trim();
  delete env.world_name;

  if (worldName && currentWorldId) {
    var world = getWorld(currentWorldId);
    if (world && world.name === 'Unnamed World') {
      renameWorld(currentWorldId, worldName);
      // Refresh the world name display if the world select panel is around
      if (typeof refreshWorldNameDisplay === 'function') refreshWorldNameDisplay(currentWorldId, worldName);
    }
  }

  environmentData = env;
  hydrateRemovedNearbyCharactersFromEnvironment();
  renderGameSidebar();
  setPhase('game');

  // Show arrival backstory in action response area
  var actionResponseArea = document.getElementById('actionResponseArea');
  if (actionResponseArea) {
    var arrivalBackstory = String((env && env.arrival_backstory) || '').trim();
    if (arrivalBackstory) {
      actionResponseArea.innerHTML =
        '<div style="margin-bottom:0.9em;color:#d5e7ff;opacity:0.94;">' + highlightCharacterTermsInHtml(renderMarkdown(arrivalBackstory)) + '</div>' +
        '<div style="color:hsl(var(--accent-h),80%,83%);font-size:1.2em;">What will you do?</div>';
    } else {
      actionResponseArea.innerHTML = '<div style="color:hsl(var(--accent-h),80%,83%);font-size:1.2em;">What will you do?</div>';
    }
  }
  await regeneratePossibleActions();
}

async function renderEnvironmentPhase(character) {
  var startingLocation = character.rpg_starting_location || character.starting_location || '';

  // Ensure we have a world and character ID before saving anything
  if (!currentWorldId) {
    var newWorld = createWorld('Unnamed World');
    currentWorldId = newWorld.id;
  }
  if (!currentCharacterId) {
    currentCharacterId = generateId();
  }

  // Show loading UI while fetching environment
  var loadingContainer = document.getElementById('loading-container');
  if (loadingContainer) {
    loadingContainer.style.display = 'flex';
    loadingContainer.innerHTML =
      '<div>' +
        '<div class="loading-character-name">' + escapeHtml(character.name || '') + '</div>' +
        '<div>Generating environment...</div>' +
      '</div>';
    loadingContainer.style.pointerEvents = 'none';
    loadingContainer.style.cursor = 'default';
  }

  // Save chosen character before environment is ready
  saveFullProgress(character, environmentData, []);

  setPhase('details');

  try {
    await generateEnvironment(startingLocation, character);
    saveFullProgress(character, environmentData, []);
  } catch (err) {
    console.error('[renderEnvironmentPhase] generateEnvironment failed:', err);
    if (loadingContainer) {
      loadingContainer.innerHTML = '<div class="error-message">Failed to generate environment: ' + escapeHtml(err && err.message || 'Unknown error') + '</div>';
      setTimeout(function() { loadingContainer.style.display = 'none'; }, 3000);
    }
    environmentData = null;
    setPhase('select');
    return;
  }

  if (loadingContainer) {
    loadingContainer.style.display = 'none';
    loadingContainer.innerHTML = '';
  }
}

async function startGameWithSavedData(character, environment, history, worldId, characterId) {
  if (worldId) currentWorldId = worldId;
  if (characterId) currentCharacterId = characterId;
  generatedCharacter = character;
  environmentData = environment;
  actionHistory = history || [];
  currentStoryLog = String(character && character.story_log || '');
  currentObjectives = Array.isArray(character && character.objectives) ? character.objectives : [];
  hydrateRemovedNearbyCharactersFromEnvironment();
  renderGameSidebar();
  setPhase('game');
  syncObjectivesUI();
  renderActionHistoryPanel();

  // Restore last user/AI exchange in the action response area
  var actionResponseArea = document.getElementById('actionResponseArea');
  if (actionResponseArea) {
    var lastUser = null, lastAI = null;
    for (var i = actionHistory.length - 1; i >= 0; i--) {
      if (!lastAI && actionHistory[i].role === 'assistant') lastAI = actionHistory[i].content;
      if (!lastUser && actionHistory[i].role === 'user') lastUser = actionHistory[i].content;
      if (lastUser && lastAI) break;
    }
    if (lastUser || lastAI) {
      var html = '';
      if (lastUser) {
        html += '<div style="font-size:1.08em;color:hsl(var(--accent-h),90%,77%);margin-bottom:0.7em;"><strong>You:</strong> ' +
          formatPlainTextWithCharacterHighlights(lastUser) + '</div>';
      }
      if (lastAI) {
        html += '<div>' + highlightCharacterTermsInHtml(renderMarkdown(lastAI)) + '</div>';
      }
      actionResponseArea.innerHTML = html;
    } else {
      var arrivalBackstory = String((environment && environment.arrival_backstory) || '').trim();
      if (arrivalBackstory) {
        actionResponseArea.innerHTML =
          '<div style="margin-bottom:0.9em;color:#d5e7ff;opacity:0.94;">' + highlightCharacterTermsInHtml(renderMarkdown(arrivalBackstory)) + '</div>' +
          '<div style="color:hsl(var(--accent-h),80%,83%);font-size:1.2em;">What will you do?</div>';
      } else {
        actionResponseArea.innerHTML = '<div style="color:hsl(var(--accent-h),80%,83%);font-size:1.2em;">What will you do?</div>';
      }
    }
  }

  // Restore pending objective suggestions if any were saved before refresh
  if (Array.isArray(character._pendingObjectives) && character._pendingObjectives.length > 0) {
    renderOptionalObjectives(character._pendingObjectives);
  }

  await regeneratePossibleActions();
}

document.addEventListener('DOMContentLoaded', function() {
  // Run migration before anything else
  migrateCharactersToWorlds();

  // Create chooseCharacterBtn if not already in DOM (character.js manages it by ID)
  var chooseCharacterBtn = document.getElementById('chooseCharacterBtn');
  if (!chooseCharacterBtn) {
    chooseCharacterBtn = document.createElement('button');
    chooseCharacterBtn.id = 'chooseCharacterBtn';
    chooseCharacterBtn.type = 'button';
    chooseCharacterBtn.textContent = 'Choose this character';
    chooseCharacterBtn.style.display = 'none';
    document.body.appendChild(chooseCharacterBtn);
  }
  chooseCharacterBtn.addEventListener('click', async function(e) {
    if (chooseCharacterBtn.disabled) { e.preventDefault(); return; }
    if (!generatedCharacter) return;
    if (isEditingCharacterDetails) {
      var applied = applyCharacterDetailsEdit({ rerender: true, showAlert: true });
      if (!applied) return;
    }
    await renderEnvironmentPhase(generatedCharacter);
  });

  // Create regenerateCharacterBtn if not already in DOM
  var regenerateCharacterBtn = document.getElementById('regenerateCharacterBtn');
  if (!regenerateCharacterBtn) {
    regenerateCharacterBtn = document.createElement('button');
    regenerateCharacterBtn.id = 'regenerateCharacterBtn';
    regenerateCharacterBtn.type = 'button';
    regenerateCharacterBtn.textContent = 'Regenerate';
    regenerateCharacterBtn.style.display = 'none';
    document.body.appendChild(regenerateCharacterBtn);
  }
  regenerateCharacterBtn.addEventListener('click', function(e) {
    if (regenerateCharacterBtn.disabled) { e.preventDefault(); return; }
    regenerateCharacter();
  });

  // Load saved worlds
  loadSavedWorldsOnStartup();

  // Wire buttons
  var generateNamesBtn = document.getElementById('generateNamesBtn');
  if (generateNamesBtn) generateNamesBtn.onclick = generateMiniChars;

  // Wire regenerate character button
  var regenBtn = document.getElementById('regenBtn');
  if (regenBtn) regenBtn.onclick = regenerateCharacter;

  // Wire regenerate actions button
  var regenerateActionsBtn = document.getElementById('regenerateActionsBtn');
  if (regenerateActionsBtn) regenerateActionsBtn.onclick = regeneratePossibleActions;

  // Apply image gen gate on load
  if (typeof syncImageGenGate === 'function') syncImageGenGate();

  // Wire panel toggle buttons
  var objToggle = document.getElementById('objectivesToggleBtn');
  if (objToggle) objToggle.onclick = function() {
    setObjectivesExpanded(!isObjectivesExpanded);
  };
  var sceneToggle = document.getElementById('sceneViewToggleBtn');
  if (sceneToggle) sceneToggle.onclick = function() {
    setSceneViewExpanded(!isSceneViewExpanded);
  };
  var histToggle = document.getElementById('actionHistoryToggleBtn');
  if (histToggle) histToggle.onclick = function() {
    setActionHistoryExpanded(!isActionHistoryExpanded);
  };

  // Custom action input
  setupCustomActionInput();

  // Open settings if no API key saved
  // (settings.js handles this automatically)
});
