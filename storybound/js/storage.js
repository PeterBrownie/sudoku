// js/storage.js

const SETTINGS_KEY = 'storybound_settings';
const CHARACTERS_KEY = 'storybound_characters'; // legacy key, kept for migration only
const WORLDS_KEY = 'storybound_worlds';

const DEFAULT_SETTINGS = {
  apiBaseUrl: 'https://api.x.ai/v1',
  apiKey: '',
  textModel: 'grok-4-1-fast-non-reasoning',
  imageModel: 'grok-imagine-image-pro',
  allowMatureContent: false
};

function generateId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    return false;
  }
}

// ─── World storage ────────────────────────────────────────────────────────────

function loadAllWorlds() {
  try {
    const raw = localStorage.getItem(WORLDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveAllWorlds(worlds) {
  try {
    localStorage.setItem(WORLDS_KEY, JSON.stringify(worlds));
    return true;
  } catch (e) {
    return false;
  }
}

function createWorld(name) {
  var worlds = loadAllWorlds();
  var world = {
    id: generateId(),
    name: String(name || 'Unnamed World').trim() || 'Unnamed World',
    createdAt: new Date().toISOString(),
    characters: [],
    npcs: [],
    locations: []
  };
  worlds.push(world);
  saveAllWorlds(worlds);
  return world;
}

// Append a memory note to a specific NPC's memory list, capped at maxMemories entries.
function appendNpcMemory(worldId, npcName, memory, maxMemories) {
  if (!worldId || !npcName || !memory) return false;
  var cap = maxMemories || 8;
  var worlds = loadAllWorlds();
  var world = worlds.find(function(w) { return w.id === worldId; });
  if (!world) return false;
  if (!Array.isArray(world.npcs)) world.npcs = [];
  var key = String(npcName).toLowerCase().trim();
  var npc = world.npcs.find(function(n) { return String(n.name).toLowerCase().trim() === key; });
  if (!npc) {
    npc = { name: npcName, description: '', gender: '', last_location: '', known_by: [], memories: [], last_updated: new Date().toISOString() };
    world.npcs.push(npc);
  }
  if (!Array.isArray(npc.memories)) npc.memories = [];
  npc.memories.push(String(memory).trim());
  if (npc.memories.length > cap) npc.memories = npc.memories.slice(npc.memories.length - cap);
  npc.last_updated = new Date().toISOString();
  return saveAllWorlds(worlds);
}

// Merge NPC and location knowledge into the world record.
// npcs: array of { name, description, gender }
// location: string (current location name)
// characterName: string (who encountered these)
function syncWorldKnowledge(worldId, npcs, location, characterName) {
  if (!worldId) return false;
  var worlds = loadAllWorlds();
  var world = worlds.find(function(w) { return w.id === worldId; });
  if (!world) return false;
  if (!Array.isArray(world.npcs)) world.npcs = [];
  if (!Array.isArray(world.locations)) world.locations = [];

  var now = new Date().toISOString();

  (npcs || []).forEach(function(npc) {
    if (!npc || !npc.name) return;
    var key = String(npc.name).toLowerCase().trim();
    var existing = world.npcs.find(function(n) { return String(n.name).toLowerCase().trim() === key; });
    if (existing) {
      if (npc.description) existing.description = npc.description;
      if (npc.gender) existing.gender = npc.gender;
      if (location) existing.last_location = location;
      if (characterName && Array.isArray(existing.known_by) && existing.known_by.indexOf(characterName) === -1) {
        existing.known_by.push(characterName);
      }
      existing.last_updated = now;
    } else {
      world.npcs.push({
        name: npc.name,
        description: npc.description || '',
        gender: npc.gender || '',
        last_location: location || '',
        known_by: characterName ? [characterName] : [],
        last_updated: now
      });
    }
  });

  if (location) {
    var locKey = String(location).toLowerCase().trim();
    var existingLoc = world.locations.find(function(l) { return String(l.name).toLowerCase().trim() === locKey; });
    if (existingLoc) {
      if (characterName) existingLoc.last_visited_by = characterName;
      existingLoc.last_updated = now;
    } else {
      world.locations.push({
        name: location,
        last_visited_by: characterName || '',
        last_updated: now
      });
    }
  }

  return saveAllWorlds(worlds);
}

function getWorld(worldId) {
  var worlds = loadAllWorlds();
  return worlds.find(function(w) { return w.id === worldId; }) || null;
}

function renameWorld(worldId, newName) {
  var worlds = loadAllWorlds();
  var world = worlds.find(function(w) { return w.id === worldId; });
  if (!world) return false;
  world.name = String(newName || 'Unnamed World').trim() || 'Unnamed World';
  return saveAllWorlds(worlds);
}

function deleteWorld(worldId) {
  var filtered = loadAllWorlds().filter(function(w) { return w.id !== worldId; });
  return saveAllWorlds(filtered);
}

function saveWorldCharacter(worldId, characterId, character, environment, history) {
  if (!worldId || !characterId) return false;
  var worlds = loadAllWorlds();
  var world = worlds.find(function(w) { return w.id === worldId; });
  if (!world) return false;
  var record = {
    id: characterId,
    character: character,
    environment: environment,
    history: history,
    lastPlayed: new Date().toISOString()
  };
  var idx = world.characters.findIndex(function(c) { return c.id === characterId; });
  if (idx >= 0) {
    world.characters[idx] = record;
  } else {
    world.characters.push(record);
  }
  return saveAllWorlds(worlds);
}

function deleteWorldCharacter(worldId, characterId) {
  var worlds = loadAllWorlds();
  var world = worlds.find(function(w) { return w.id === worldId; });
  if (!world) return false;
  world.characters = world.characters.filter(function(c) { return c.id !== characterId; });
  return saveAllWorlds(worlds);
}

// ─── Legacy character storage (kept for migration only) ───────────────────────

function loadAllCharacters() {
  try {
    const raw = localStorage.getItem(CHARACTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// One-time migration: moves old flat character list into a world
function migrateCharactersToWorlds() {
  if (localStorage.getItem(WORLDS_KEY)) return false; // already on new format
  var old = loadAllCharacters();
  if (!old || old.length === 0) return false;
  var world = {
    id: generateId(),
    name: 'Imported World',
    createdAt: new Date().toISOString(),
    npcs: [],
    locations: [],
    characters: old.map(function(r) {
      return {
        id: generateId(),
        character: r.character,
        environment: r.environment,
        history: r.history || [],
        lastPlayed: r.lastPlayed || new Date().toISOString()
      };
    })
  };
  return saveAllWorlds([world]);
}

function hasSettings() {
  const s = getSettings();
  return Boolean(s.apiKey);
}
