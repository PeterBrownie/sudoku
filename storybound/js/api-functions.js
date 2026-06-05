const SCHEMA_BASIC_INFO = { 
  type: 'object', properties: { name:{type:'string'}, nickname:{type:'string'}, age:{type:'integer'}, height:{type:'string'}, gender:{type:'string'}, short_description:{type:'string'} }, required:['name','age','height','gender','short_description'] 
};
const SCHEMA_TRAITS = { 
  type:'object', properties:{ flaws:{type:'string'}, rpg_starting_location:{type:'string'}, description:{type:'string'}, agility:{type:'string'}, abilities:{type:'array',items:{type:'object',properties:{name:{type:'string'},description:{type:'string'}},required:['name','description']}}, limitations:{type:'array',items:{type:'string'}} }, required:['flaws','rpg_starting_location','agility','abilities','limitations','description'] 
};
const SCHEMA_INVENTORY = {
  type:'object', properties:{ inventoryTitle:{type:'string'}, items:{type:'array',items:{type:'object',properties:{name:{type:'string'},description:{type:'string'},quantity:{type:'integer'},weight:{type:'number'}},required:['name','description']}} }, required:['items','inventoryTitle'] 
};
const SCHEMA_MINICHAR = { type:'array', items:{type:'object',properties:{name:{type:'string'},gender:{type:'string'},age:{type:'integer'},position:{type:'string'}},required:['name','gender','age','position']} };
const SCHEMA_ENVIRONMENT = { 
  type:'object', properties:{ location:{type:'string'}, time_of_day:{type:'string'}, temperature:{type:'string'}, vibe:{type:'string'}, sounds:{type:'string'}, arrival_backstory:{type:'string'}, people:{type:'array',items:{type:'object',properties:{ name:{type:'string'},short_description:{type:'string'},opinion:{type:'number'},opinions:{type:'object',properties:{overall:{type:'number'},familiarity:{type:'number'},trust:{type:'number'},loyalty:{type:'number'},touch_comfort:{type:'number'}},required:['overall','familiarity','trust','loyalty','touch_comfort']},gender:{type:'string'},secret_npc_details:{type:'string'} },required:['name','short_description','opinion','opinions','gender']}} }, required:['location','time_of_day','temperature','vibe','sounds','arrival_backstory','people'] 
};
const SCHEMA_ACTIONS = { type:'object', properties:{ actions:{type:'array',items:{type:'string'}} }, required:['actions'] };
const SCHEMA_ACTION_STATE_CHANGES = { 
  type:'object', properties:{ environment:{type:'boolean'}, environment_justification:{type:'string'}, character:{type:'boolean'}, character_justification:{type:'string'}, inventory:{type:'boolean'}, needs_npc_inv:{type:'array',items:{type:'string'}}, optional_npc_inv:{type:'array',items:{type:'string'}}, optional_objectives:{type:'array',items:{type:'object',properties:{title:{type:'string'},description:{type:'string'},difficulty:{type:'integer'}}}}, story_log_addition:{type:'string'}, secret_story_detail:{type:'string'} }, required:['environment','character','inventory'] 
};
const SCHEMA_WORLD_STATE_PATCH = {
  type:'object',
  properties:{
    environment_patch:{type:'object'},
    character_patch:{type:'object',properties:{agility:{type:'string'},abilities:{type:'array',items:{type:'object',properties:{name:{type:'string'},description:{type:'string'}},required:['name','description']}},limitations:{type:'array',items:{type:'string'}},flaws:{type:'string'},description:{type:'string'}}}
  },
  required:['environment_patch','character_patch']
};
const SCHEMA_INVENTORY_CHANGES = { type:'object', properties:{ inventory:{type:'array'} }, required:['inventory'] };
const SCHEMA_STORY_LOG = { type:'object', properties:{ consolidated_story_log:{type:'string'} }, required:['consolidated_story_log'] };
const SCHEMA_SCENE_FOCUS = { type:'object', properties:{ options:{type:'array',items:{type:'string'}} }, required:['options'] };
const SCHEMA_SCENE_VISUAL = { type:'object', properties:{ description:{type:'string'} }, required:['description'] };
const SCHEMA_OBJECTIVE_PLAN = { type:'object', properties:{ steps:{type:'array',items:{type:'object',properties:{user_text:{type:'string'},hidden_context:{type:'string'},step_type:{type:'string'},status:{type:'string'}},required:['user_text']}} }, required:['steps'] };
const SCHEMA_OBJECTIVE_PROGRESS = { 
  type:'object', properties:{ objective_updates:{type:'array',items:{type:'object',properties:{title:{type:'string'},completed_steps:{type:'array',items:{type:'integer'}},passed_steps:{type:'array',items:{type:'integer'}},objective_completed:{type:'boolean'}},required:['title']}} }, required:['objective_updates'] 
};
const SCHEMA_ENTITY_INV = SCHEMA_INVENTORY;

// ─── Constants ───────────────────────────────────────────────────────────────

var MAX_HISTORY_MESSAGES = 20;
var HISTORY_PRUNE_BATCH_SIZE = 6;

var OPINION_PROFILE_KEYS = ['overall', 'familiarity', 'trust', 'loyalty', 'touch_comfort'];
var OPINION_PROFILE_KEY_ALIASES = {
  overall:       ['overall', 'opinion', 'overall_opinion'],
  familiarity:   ['familiarity', 'acquaintance', 'acquaintance_like', 'acquaintance_opinion'],
  trust:         ['trust', 'trust_opinion'],
  loyalty:       ['loyalty', 'loyalty_opinion'],
  touch_comfort: ['touch_comfort', 'physical_boundary', 'physical_boundaries', 'physical_boundary_level', 'physical_touch_comfort']
};


function cleanAiResponse(raw) {
  try {
    if (typeof raw !== 'string') return raw;
    var s = String(raw);
    if (s.indexOf('</think>') !== -1) {
      return s.split('</think>').pop().trim();
    }
    return s.trim();
  } catch (e) {
    console.error('Error cleaning AI response:', e);
    return raw;
  }
}

function extractFirstJsonObject(raw) {
  if (typeof raw !== 'string') return null;
  var text = cleanAiResponse(raw).trim();
  if (!text) return null;
  var start = text.indexOf('{');
  if (start < 0) return null;
  var depth = 0;
  var inStr = false;
  var esc = false;
  for (var i = start; i < text.length; i++) {
    var ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        var chunk = text.slice(start, i + 1);
        try {
          var parsed = JSON.parse(chunk);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
          }
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function _extractBracketBlock(text, startIdx, openCh, closeCh) {
  var depth = 0;
  var inDouble = false;
  var inSingle = false;
  var esc = false;
  for (var i = startIdx; i < text.length; i++) {
    var ch = text[i];
    if (inDouble) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inDouble = false; }
      continue;
    }
    if (inSingle) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === "'") { inSingle = false; }
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === openCh) { depth++; }
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return '';
}

function extractResponseField(raw) {
  if (raw === null || raw === undefined) return '';
  var text = cleanAiResponse(String(raw)).trim();
  if (!text) return '';

  // Strip opening code fence with optional language tag, and closing fence.
  var textNoFence = text.replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  // Try strict JSON parse.
  var candidates = [textNoFence, text];
  for (var ci = 0; ci < candidates.length; ci++) {
    try {
      var parsed = JSON.parse(candidates[ci]);
      if (parsed && typeof parsed === 'object' && 'response' in parsed) {
        return String(parsed.response || '').trim();
      }
    } catch (e) { /* continue */ }
  }

  function decodeJsonishText(s) {
    return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  }

  // Tolerate truncated JSON by manually extracting the response string.
  var keyMatch = textNoFence.match(/"response"\s*:\s*"/);
  if (keyMatch) {
    var i = keyMatch.index + keyMatch[0].length;
    var out = [];
    var escaped = false;
    while (i < textNoFence.length) {
      var ch = textNoFence[i];
      if (escaped) {
        out.push(ch);
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        break;
      } else {
        out.push(ch);
      }
      i++;
    }
    var extracted = out.join('').trim();
    var remainder = (i < textNoFence.length) ? textNoFence.slice(i + 1).trim() : '';

    remainder = remainder.replace(/^[\s,}]+/, '').replace(/[\s}]+$/, '');
    if (/^"[A-Za-z0-9_\-]+"\s*:/.test(remainder)) {
      remainder = '';
    }

    if (extracted) {
      var base = decodeJsonishText(extracted);
      var tail = remainder ? decodeJsonishText(remainder) : '';
      if (tail) {
        if (/[.!?"]$/.test(base)) {
          return (base + '\n\n' + tail).trim();
        }
        return (base + ' ' + tail).trim();
      }
      return base;
    }
  }

  // Fallback to plain text.
  return textNoFence;
}

function extractActionsPayload(raw, minActions, maxActions) {
  if (minActions === undefined) minActions = 1;
  if (maxActions === undefined) maxActions = 4;

  if (raw === null || raw === undefined) return { actions: [] };
  var text = cleanAiResponse(String(raw)).trim();
  if (!text) return { actions: [] };

  var textNoFence = text.replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  function normalizeList(values) {
    var out = [];
    for (var vi = 0; vi < values.length; vi++) {
      var s = String(values[vi] || '').trim();
      if (s) out.push(s);
    }
    if (maxActions > 0) out = out.slice(0, maxActions);
    return out;
  }

  // Strict parse attempts.
  var candidates = [textNoFence, text];
  for (var ci = 0; ci < candidates.length; ci++) {
    try {
      var parsed = JSON.parse(candidates[ci]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        var actions = parsed.actions;
        if (Array.isArray(actions)) {
          actions = normalizeList(actions);
          if (actions.length >= minActions) return { actions: actions };
        }
      }
    } catch (e) { /* continue */ }
  }

  // Extract first JSON object from mixed text.
  var obj = extractFirstJsonObject(textNoFence);
  if (obj && typeof obj === 'object') {
    var acts = obj.actions;
    if (Array.isArray(acts)) {
      acts = normalizeList(acts);
      if (acts.length >= minActions) return { actions: acts };
    }
  }

  // Recover from malformed JSON arrays after "actions": [...]
  var keyMatch = textNoFence.match(/"actions"\s*:\s*\[/);
  if (keyMatch) {
    var arrStart = textNoFence.indexOf('[', keyMatch.index);
    if (arrStart >= 0) {
      var arrBlock = _extractBracketBlock(textNoFence, arrStart, '[', ']');
      if (arrBlock) {
        try {
          var parsedArr = JSON.parse(arrBlock);
          if (Array.isArray(parsedArr)) {
            var normed = normalizeList(parsedArr);
            if (normed.length >= minActions) return { actions: normed };
          }
        } catch (e) { /* continue */ }
      }
    }
  }

  // Last-resort plain text split.
  var lines = textNoFence.split('\n');
  var cleaned = [];
  for (var li = 0; li < lines.length; li++) {
    var ln = lines[li].trim();
    if (!ln) continue;
    ln = ln.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
    if (!ln) continue;
    if (ln.toLowerCase().indexOf('actions') === 0) continue;
    // Skip lines that look like raw JSON (truncated or otherwise) — not valid action text
    if (ln.charAt(0) === '{' || ln.charAt(0) === '[') continue;
    cleaned.push(ln);
  }
  var finalActs = normalizeList(cleaned);
  if (finalActs.length >= minActions) return { actions: finalActs };

  return { actions: [] };
}

function looksCutOff(text) {
  if (typeof text !== 'string') return true;
  var s = text.trim();
  if (s.length < 24) return true;
  var backtickCount = (s.match(/```/g) || []).length;
  if (backtickCount % 2 !== 0) return true;
  if (/[,:;\-([{\/\\]$/.test(s)) return true;
  return false;
}

function getMessage(type) {
  var settings = getSettings();
  var allowMature = settings && settings.allowMatureContent;

  if (type === 'story') {
    if (allowMature) {
      return 'Be visually descriptive of characters. If the provided story context is explicit (NSFW) in nature, you may generate explicit content. Otherwise, generate normal content. Try to match the maturity level of the player, but you can be more mature only if the story context justifies it. ';
    }
    return 'This content is rated for all ages. You may not generate adult-rated content. If the player makes an adult-rated action, you must gracefully reorient the story naturally towards something more innocent. Worst case, if the player does not stop pushing for adult rated content (pushes boundaries directly at least 5 times), you may introduce "Death" (an NPC) to the scene/story to change things up a little. ';
  }

  if (allowMature) {
    return 'This content may include mature themes. ';
  }
  return 'This content is rated for all ages. You may only match the maturity level of the player. ';
}

function clampOpinionVal(value, defaultVal) {
  if (defaultVal === undefined) defaultVal = 0.0;
  try {
    var n = parseFloat(value);
    if (isNaN(n)) throw new Error('NaN');
    return Math.max(-0.99, Math.min(0.99, n));
  } catch (e) {
    return Math.max(-0.99, Math.min(0.99, parseFloat(defaultVal) || 0.0));
  }
}

function mergeOpinionProfile(raw, existing) {
  var profile = { overall: 0.0, familiarity: 0.0, trust: 0.0, loyalty: 0.0, touch_comfort: 0.0 };

  if (existing && typeof existing === 'object') {
    var existingOpinions = existing.opinions;
    if (existingOpinions && typeof existingOpinions === 'object') {
      for (var ki = 0; ki < OPINION_PROFILE_KEYS.length; ki++) {
        var k = OPINION_PROFILE_KEYS[ki];
        if (k in existingOpinions) {
          profile[k] = clampOpinionVal(existingOpinions[k], profile[k]);
        }
      }
    }
    if ('opinion' in existing) {
      profile.overall = clampOpinionVal(existing.opinion, profile.overall);
    }
  }

  if (raw && typeof raw === 'object' && 'opinion' in raw) {
    profile.overall = clampOpinionVal(raw.opinion, profile.overall);
  }

  var source = {};
  if (raw && typeof raw === 'object') {
    var candidate = raw.opinions;
    if (candidate && typeof candidate === 'object') {
      source = candidate;
    } else {
      source = raw;
    }
  }

  var aliasKeys = Object.keys(OPINION_PROFILE_KEY_ALIASES);
  for (var ai = 0; ai < aliasKeys.length; ai++) {
    var key = aliasKeys[ai];
    var aliases = OPINION_PROFILE_KEY_ALIASES[key];
    for (var aai = 0; aai < aliases.length; aai++) {
      var alias = aliases[aai];
      if (alias in source) {
        profile[key] = clampOpinionVal(source[alias], profile[key]);
        break;
      }
    }
  }

  // Keep legacy top-level overall in sync when present.
  if (raw && typeof raw === 'object' && 'opinion' in raw) {
    profile.overall = clampOpinionVal(raw.opinion, profile.overall);
  }

  return profile;
}

function sanitizeShortDescription(text) {
  text = String(text || '').trim();
  if (!text) return '';

  // Remove trailing parenthetical sentiment/meta tags like "(-0.50 Unfriendly)".
  text = text.replace(/\(\s*[-+]?\d+(?:\.\d+)?[^)]*\)\s*$/, '').trim();
  text = text.replace(/\s+/g, ' ').trim();

  // Keep only the first sentence.
  var sentenceMatch = text.match(/^.+?[.!?](?=\s|$)/);
  if (sentenceMatch) {
    text = sentenceMatch[0].trim();
  }

  // Cap at 40 words.
  var words = text.split(' ');
  if (words.length > 40) {
    text = words.slice(0, 40).join(' ').replace(/[,;:]$/, '');
  }

  return text;
}

function sanitizeSecretNpcDetails(text) {
  text = String(text || '').replace(/\n/g, ' ').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, ' ').trim();
  var words = text.split(' ');
  if (words.length > 60) {
    text = words.slice(0, 60).join(' ').trim();
  }
  return text;
}

function normalizePerson(raw) {
  if (!raw || typeof raw !== 'object') return {};
  var name = String(raw.name || '').trim();
  if (!name) return {};
  var shortDescription = String(raw.short_description || '').trim();
  var gender = String(raw.gender || '').trim() || 'unknown';
  var opinions = mergeOpinionProfile(raw);
  var opinion = opinions.overall;
  var out = {
    name: name,
    short_description: sanitizeShortDescription(shortDescription),
    opinion: opinion,
    opinions: opinions,
    gender: gender
  };
  var secretNpcDetails = sanitizeSecretNpcDetails(raw.secret_npc_details || '');
  if (secretNpcDetails) {
    out.secret_npc_details = secretNpcDetails;
  }
  return out;
}

function normalizePersonPatch(raw, existing) {
  if (!raw || typeof raw !== 'object') return {};
  var name = String(raw.name || '').trim();
  if (!name) return {};

  var base = Object.assign({}, existing || {});
  base.name = name;

  if ('short_description' in raw) {
    var sd = sanitizeShortDescription(raw.short_description || '');
    if (sd) base.short_description = sd;
  }

  if ('gender' in raw) {
    var gender = String(raw.gender || '').trim();
    if (gender) base.gender = gender;
  }

  if ('secret_npc_details' in raw) {
    var snd = sanitizeSecretNpcDetails(raw.secret_npc_details || '');
    if (snd) base.secret_npc_details = snd;
  }

  if ('opinion' in raw) {
    try {
      var opVal = parseFloat(raw.opinion);
      if (!isNaN(opVal)) {
        base.opinion = Math.max(-0.99, Math.min(0.99, opVal));
      }
    } catch (e) { /* ignore */ }
  }

  if ('opinions' in raw && raw.opinions && typeof raw.opinions === 'object') {
    base.opinions = mergeOpinionProfile(raw, base);
  }

  // Ensure required fields always exist.
  if (!('short_description' in base)) base.short_description = '';
  if (!('gender' in base)) base.gender = 'unknown';

  var mergedForProfile = Object.assign({}, base, raw);
  var normalizedProfile = mergeOpinionProfile(mergedForProfile, existing);
  base.opinions = normalizedProfile;
  base.opinion = normalizedProfile.overall;

  return base;
}

function normalizeActionHistory(history, maxMessages, pruneBatchSize, dropRecentMessages, blockedSubstrings) {
  if (maxMessages === undefined) maxMessages = MAX_HISTORY_MESSAGES;
  if (pruneBatchSize === undefined) pruneBatchSize = HISTORY_PRUNE_BATCH_SIZE;
  if (dropRecentMessages === undefined) dropRecentMessages = 0;
  if (blockedSubstrings === undefined) blockedSubstrings = [];

  if (!Array.isArray(history)) return [];

  var blocked = Array.isArray(blockedSubstrings) ? blockedSubstrings : [];
  var normalizedInput = [];

  for (var i = 0; i < history.length; i++) {
    var msg = history[i];
    if (!msg || typeof msg !== 'object') continue;
    var role = msg.role;
    var content = String(msg.content || '').trim();
    if (role !== 'user' && role !== 'assistant') continue;
    if (!content) continue;
    var hasBlocked = false;
    for (var bi = 0; bi < blocked.length; bi++) {
      if (content.indexOf(blocked[bi]) !== -1) { hasBlocked = true; break; }
    }
    if (hasBlocked) continue;
    normalizedInput.push({ role: role, content: content });
  }

  if (dropRecentMessages > 0) {
    if (normalizedInput.length <= dropRecentMessages) return [];
    normalizedInput = normalizedInput.slice(0, normalizedInput.length - dropRecentMessages);
  }

  var pruned = normalizedInput;
  if (maxMessages > 0) {
    while (pruned.length > maxMessages) {
      pruned = pruned.slice(pruneBatchSize);
    }
  }

  while (pruned.length > 0 && pruned[0].role !== 'user') {
    pruned = pruned.slice(1);
  }

  var output = [];
  var expectedRole = 'user';
  for (var oi = 0; oi < pruned.length; oi++) {
    var m = pruned[oi];
    if (m.role !== expectedRole) continue;
    output.push(m);
    expectedRole = (expectedRole === 'user') ? 'assistant' : 'user';
  }

  return output;
}

function environmentForPrompt(environment, includeHiddenNpcDetails) {
  if (!environment || typeof environment !== 'object') return {};
  var cleaned = {};
  var keys = Object.keys(environment);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    if (key === '_removed_people') continue;
    if (key !== 'people') {
      cleaned[key] = environment[key];
      continue;
    }
    var value = environment[key];
    if (!Array.isArray(value)) {
      cleaned.people = [];
      continue;
    }
    var peopleOut = [];
    for (var pi = 0; pi < value.length; pi++) {
      var normalized = normalizePerson(value[pi]);
      if (!normalized || !normalized.name) continue;
      if (!includeHiddenNpcDetails) {
        delete normalized.secret_npc_details;
      }
      peopleOut.push(normalized);
    }
    cleaned.people = peopleOut;
  }
  return cleaned;
}

function removedPeopleForPrompt(removedPeople, includeHiddenNpcDetails) {
  if (!Array.isArray(removedPeople)) return [];
  var normalized = [];
  var seenNames = {};
  for (var i = 0; i < removedPeople.length; i++) {
    var entry = removedPeople[i];
    if (!entry || typeof entry !== 'object') continue;
    var name = String(entry.name || '').trim();
    if (!name) continue;
    var key = name.toLowerCase();
    if (seenNames[key]) continue;
    seenNames[key] = true;
    var normalizedEntry = { name: name };
    var sd = String(entry.short_description || '').trim();
    if (sd) normalizedEntry.short_description = sd;
    var gender = String(entry.gender || '').trim();
    if (gender) normalizedEntry.gender = gender;
    if (includeHiddenNpcDetails) {
      var snd = sanitizeSecretNpcDetails(entry.secret_npc_details || '');
      if (snd) normalizedEntry.secret_npc_details = snd;
    }
    normalizedEntry.opinions = mergeOpinionProfile(entry);
    normalizedEntry.opinion = normalizedEntry.opinions.overall;
    normalized.push(normalizedEntry);
  }
  return normalized;
}

function displayedInventoriesForPrompt(displayedInventories) {
  if (!Array.isArray(displayedInventories)) return [];
  var normalized = [];
  var seenTitles = {};
  for (var i = 0; i < displayedInventories.length; i++) {
    var entry = displayedInventories[i];
    if (!entry || typeof entry !== 'object') continue;
    var title = String(entry.inventoryTitle || entry.name || '').trim();
    var items = entry.items;
    if (!title || !Array.isArray(items)) continue;
    var key = title.toLowerCase();
    if (seenTitles[key]) continue;
    seenTitles[key] = true;
    normalized.push({ inventoryTitle: title, items: items });
  }
  return normalized;
}

function objectivesForPrompt(objectives, includeHidden) {
  if (!Array.isArray(objectives)) return [];
  var normalized = [];
  for (var oi = 0; oi < objectives.length; oi++) {
    var obj = objectives[oi];
    if (!obj || typeof obj !== 'object') continue;
    var title = String(obj.title || '').trim();
    var description = String(obj.description || '').trim();
    if (!title) continue;
    var out = {
      title: title,
      description: description,
      is_completed: !!obj.is_completed
    };
    var difficulty = normalizeObjectiveDifficulty(obj.difficulty !== undefined ? obj.difficulty : null);
    if (difficulty !== null) out.difficulty = difficulty;
    var stepsIn = obj.steps;
    var stepsOut = [];
    if (Array.isArray(stepsIn)) {
      for (var si = 0; si < stepsIn.length; si++) {
        var step = stepsIn[si];
        if (!step || typeof step !== 'object') continue;
        var userText = String(step.user_text || step.description || '').trim();
        if (!userText) continue;
        var stepOut = {
          index: si + 1,
          user_text: userText,
          step_type: normalizeObjectiveStepType(step.step_type),
          status: normalizeObjectiveStepStatus(step.status, step.step_type, !!step.is_completed),
          is_completed: isObjectiveStepCompleted(step)
        };
        if (includeHidden) {
          var hidden = String(step.hidden_context || '').trim();
          if (hidden) stepOut.hidden_context = hidden;
        }
        stepsOut.push(stepOut);
      }
    }
    if (stepsOut.length > 0) out.steps = stepsOut;
    normalized.push(out);
  }
  return normalized;
}

function normalizeObjectiveStepType(stepType) {
  var value = String(stepType || '').trim().toLowerCase();
  if (value === 'required' || value === 'loose' || value === 'optional') return value;
  return 'required';
}

function normalizeObjectiveDifficulty(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  try {
    var text = String(value).trim();
    if (!text) return null;
    var match = text.match(/\d+/);
    if (!match) return null;
    var numeric = parseInt(match[0], 10);
    if (numeric < 1) numeric = 1;
    if (numeric > 10) numeric = 10;
    return numeric;
  } catch (e) {
    return null;
  }
}

function normalizeObjectiveStepStatus(status, stepType, isCompleted) {
  var normalizedType = normalizeObjectiveStepType(stepType);
  var value = String(status || '').trim().toLowerCase();
  if (value !== 'pending' && value !== 'completed' && value !== 'passed') {
    return isCompleted ? 'completed' : 'pending';
  }
  if (value === 'passed' && normalizedType !== 'optional') {
    return 'completed';
  }
  return value;
}

function isObjectiveStepCompleted(step) {
  if (!step || typeof step !== 'object') return false;
  var status = normalizeObjectiveStepStatus(step.status, step.step_type, !!step.is_completed);
  return status === 'completed';
}

function isObjectiveStepResolved(step) {
  if (!step || typeof step !== 'object') return false;
  var status = normalizeObjectiveStepStatus(step.status, step.step_type, !!step.is_completed);
  return status === 'completed' || status === 'passed';
}

function isObjectiveComplete(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  var requiredLike = steps.filter(function(s) {
    if (!s || typeof s !== 'object') return false;
    var t = normalizeObjectiveStepType(s.step_type);
    return t === 'required' || t === 'loose';
  });
  if (requiredLike.length > 0) {
    return requiredLike.every(function(step) { return isObjectiveStepCompleted(step); });
  }
  return steps.every(function(step) {
    return step && typeof step === 'object' && isObjectiveStepResolved(step);
  });
}

function mergeEnvironmentPatch(current, patch, playerName, removedPeople) {
  if (!current || typeof current !== 'object') current = {};
  if (!patch || typeof patch !== 'object') return Object.assign({}, current);

  var merged = Object.assign({}, current);
  playerName = String(playerName || '').trim();

  var scalarKeys = ['location', 'time_of_day', 'temperature', 'vibe', 'sounds'];
  for (var ski = 0; ski < scalarKeys.length; ski++) {
    var key = scalarKeys[ski];
    if (key in patch) {
      var val = patch[key];
      if (typeof val === 'string') {
        val = val.trim();
        if (val) merged[key] = val;
      }
    }
  }

  function buildRemovedPeopleMap(peopleList) {
    var map = {};
    if (!Array.isArray(peopleList)) return map;
    for (var pi = 0; pi < peopleList.length; pi++) {
      var norm = normalizePerson(peopleList[pi]);
      if (!norm || !norm.name) continue;
      var k = norm.name.trim().toLowerCase();
      if (playerName && k === playerName.toLowerCase()) continue;
      map[k] = norm;
    }
    return map;
  }

  var removedPeopleMap = buildRemovedPeopleMap(removedPeople);

  function buildPeopleMap(peopleList) {
    var peopleMap = {};
    var order = [];
    for (var pi = 0; pi < peopleList.length; pi++) {
      var p = peopleList[pi];
      if (!p || typeof p !== 'object') continue;
      var rawName = String(p.name || '').trim();
      if (!rawName) continue;
      var k = rawName.toLowerCase();
      var existingFromRemoved = removedPeopleMap[k] || null;
      var norm = normalizePersonPatch(p, existingFromRemoved);
      if (!norm || !norm.name) continue;
      k = norm.name.trim().toLowerCase();
      if (playerName && k === playerName.toLowerCase()) continue;
      if (!(k in peopleMap)) order.push(k);
      peopleMap[k] = norm;
    }
    return { map: peopleMap, order: order };
  }

  var currentPeople = merged.people;
  if (!Array.isArray(currentPeople)) currentPeople = [];

  var peopleResult;
  var peopleVisible = patch.people_visible;
  if (Array.isArray(peopleVisible)) {
    peopleResult = buildPeopleMap(peopleVisible);
  } else {
    peopleResult = buildPeopleMap(currentPeople);
  }
  var peopleMap = peopleResult.map;
  var order = peopleResult.order;

  // Apply people_renames
  var renames = patch.people_renames;
  if (Array.isArray(renames)) {
    for (var ri = 0; ri < renames.length; ri++) {
      var change = renames[ri];
      if (!change || typeof change !== 'object') continue;
      var oldName = String(change.old_name || '').trim();
      var newName = String(change.new_name || '').trim();
      if (!oldName || !newName) continue;
      var oldK = oldName.toLowerCase();
      var newK = newName.toLowerCase();
      if (oldK === newK) continue;
      if (playerName) {
        var playerK = playerName.toLowerCase();
        if (oldK === playerK || newK === playerK) continue;
      }
      var oldPerson = peopleMap[oldK];
      if (!oldPerson) continue;
      var renamedPerson = Object.assign({}, oldPerson);
      renamedPerson.name = newName;
      if (newK in peopleMap) {
        renamedPerson = normalizePersonPatch(peopleMap[newK], renamedPerson);
      }
      peopleMap[newK] = renamedPerson;
      delete peopleMap[oldK];
      var oldIndex = order.indexOf(oldK);
      if (oldIndex !== -1) {
        order.splice(oldIndex, 1);
        var newKIdx = order.indexOf(newK);
        if (newKIdx !== -1) order.splice(newKIdx, 1);
        order.splice(oldIndex, 0, newK);
      } else if (order.indexOf(newK) === -1) {
        order.push(newK);
      }
    }
  }

  // Apply people_remove
  var removes = patch.people_remove;
  if (Array.isArray(removes)) {
    for (var rmi = 0; rmi < removes.length; rmi++) {
      var rk = String(removes[rmi] || '').trim().toLowerCase();
      if (!rk) continue;
      if (playerName && rk === playerName.toLowerCase()) continue;
      delete peopleMap[rk];
      var rmIdx = order.indexOf(rk);
      if (rmIdx !== -1) order.splice(rmIdx, 1);
    }
  }

  // Apply people_add_or_update
  var adds = patch.people_add_or_update;
  if (Array.isArray(adds)) {
    for (var addi = 0; addi < adds.length; addi++) {
      var addP = adds[addi];
      if (!addP || typeof addP !== 'object') continue;
      var addRawName = String(addP.name || '').trim();
      if (!addRawName) continue;
      var addK = addRawName.toLowerCase();
      var previousName = String(addP.previous_name || '').trim().toLowerCase();
      if (previousName && previousName !== addK && previousName in peopleMap) {
        var renamedPrev = Object.assign({}, peopleMap[previousName]);
        renamedPrev.name = addRawName;
        delete peopleMap[previousName];
        var prevIdx = order.indexOf(previousName);
        if (prevIdx !== -1) {
          order.splice(prevIdx, 1);
          var kIdx = order.indexOf(addK);
          if (kIdx !== -1) order.splice(kIdx, 1);
          order.splice(prevIdx, 0, addK);
        } else if (order.indexOf(addK) === -1) {
          order.push(addK);
        }
        peopleMap[addK] = renamedPrev;
      }
      var existingEntry = peopleMap[addK] || removedPeopleMap[addK] || null;
      var normAdd = normalizePersonPatch(addP, existingEntry);
      if (!normAdd || !normAdd.name) continue;
      if (playerName && addK === playerName.toLowerCase()) continue;
      if (!(addK in peopleMap)) order.push(addK);
      peopleMap[addK] = normAdd;
    }
  }

  merged.people = order.filter(function(k) { return k in peopleMap; }).map(function(k) { return peopleMap[k]; });
  return merged;
}

function normalizeAbilityEntry(raw) {
  if (typeof raw === 'string') {
    var name = raw.trim();
    if (!name) return null;
    return { name: name, description: '' };
  }
  if (!raw || typeof raw !== 'object') return null;
  var name = String(raw.name || '').trim();
  if (!name) return null;
  var description = String(raw.description || '').trim();
  return { name: name, description: description };
}

function normalizeAbilityList(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var ability = normalizeAbilityEntry(raw[i]);
    if (!ability) continue;
    var key = ability.name.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(ability);
  }
  return out;
}

function mergeCharacterPatch(currentCharacter, patch) {
  if (!currentCharacter || typeof currentCharacter !== 'object') currentCharacter = {};
  if (!patch || typeof patch !== 'object') return {};

  var merged = {};

  var stringKeys = ['flaws', 'agility', 'description'];
  for (var ski = 0; ski < stringKeys.length; ski++) {
    var key = stringKeys[ski];
    if (!(key in patch)) continue;
    var value = patch[key];
    if (typeof value !== 'string') continue;
    value = value.trim();
    if (value && value !== currentCharacter[key]) {
      merged[key] = value;
    }
  }

  if ('limitations' in patch && Array.isArray(patch.limitations)) {
    var normalized = [];
    var seenLim = {};
    for (var li = 0; li < patch.limitations.length; li++) {
      var s = String(patch.limitations[li] || '').trim();
      if (!s) continue;
      var lk = s.toLowerCase();
      if (seenLim[lk]) continue;
      seenLim[lk] = true;
      normalized.push(s);
    }
    var currentLimitations = currentCharacter.limitations || [];
    if (JSON.stringify(normalized) !== JSON.stringify(currentLimitations)) {
      merged.limitations = normalized;
    }
  }

  if ('abilities' in patch && Array.isArray(patch.abilities)) {
    var normalizedAbilities = normalizeAbilityList(patch.abilities);
    var currentAbilities = normalizeAbilityList(currentCharacter.abilities || []);
    if (JSON.stringify(normalizedAbilities) !== JSON.stringify(currentAbilities)) {
      merged.abilities = normalizedAbilities;
    }
  }

  return merged;
}

function formatSceneHistoryForPrompt(history, maxMessages) {
  if (maxMessages === undefined) maxMessages = 12;
  if (!Array.isArray(history) || history.length === 0) return '';
  var trimmed = history.slice(-maxMessages);
  var lines = [];
  for (var i = 0; i < trimmed.length; i++) {
    var msg = trimmed[i];
    if (!msg || typeof msg !== 'object') continue;
    var role = String(msg.role || '').trim().toLowerCase();
    if (role !== 'user' && role !== 'assistant') continue;
    var content = String(msg.content || '').trim();
    if (!content) continue;
    var label = (role === 'user') ? 'Player action' : 'Narration';
    lines.push(label + ': ' + content);
  }
  return lines.join('\n');
}

// ─── Character Creation Functions ────────────────────────────────────

// MINI CHARS — initial characters selectable by the player
async function getGoodMiniChars(messages) {
  // SCHEMA_MINICHAR wraps the array - apiChat returns parsed object
  var schema = { type: 'object', properties: { mini_chars: SCHEMA_MINICHAR }, required: ['mini_chars'] };
  var result = await apiChat(messages, schema);
  if (result && Array.isArray(result.mini_chars)) return result.mini_chars;
  if (Array.isArray(result)) return result;
  return [];
}

// BASIC CHARACTER INFO — short description based on mini char seed
async function getBasicCharacterInfo(miniChar) {
  var additionalContentDisclaimer = getMessage();
  var messages = [
    { role: 'system', content: 'You are an expert RPG character creator. You generate a short description of this character. Nickname cannot be \'Sparks\', ever.' },
    { role: 'user', content: (
      'Given this character seed: Name: ' + miniChar.name + ', Gender: ' + miniChar.gender + ', ' +
      'Age: ' + miniChar.age + ', Position/Title: ' + miniChar.position + '. ' +
      additionalContentDisclaimer + '\nNow, provide flaws, starting location, description, agility, abilities, and limitations.Keep each section short; Respond in the formatted JSON. '
    )}
  ];
  return await apiChat(messages, SCHEMA_BASIC_INFO);
}

// CHARACTER TRAITS — flaws, description, agility, abilities, limitations
async function getCharacterTraits(basicInfo) {
  var additionalContentDisclaimer = getMessage();
  var messages = [
    { role: 'system', content: 'You are an expert RPG character creator. You come up clever character details. '
      + 'Some guidelines: '
      + '- The description should include a physical description of the character. \n'
      + '- Flaws should be minor and unique. Because the player will be assuming this identity, the flaws should be things that affect the way a story unfolds. For example, instead of saying \'unconfident\', it should say \'often fails to assert themselves when they try\'. This allows the player to take an action, and the story can generate an outcome that integrates the flaw in a reasonable way. \n'
      + '- Agility should be something very short, like \'low\', \'average\', or \'high\'. Only add more if there is a considerable fact about them that would affect their agility in a significant way. \n'
      + '- The abilities should be interesting and not too overpowered. Consider their basic information when generating abilities. Abilities may contain minor magical elements, even if the character\'s job title or role is not magical. For now, generate one ability, unless they\'re role is very simple; In cases where the character is not particularly interesting, you may make a second minor ability.\n'
      + '- Limitations should address the character\'s abilities, in cases where they are overpowered. You don\'t have to generate limitations if the abilities are reasonably mundane on their own.\n'
      + '- Nickname cannot be \'Sparks\', ever.' // It's just so annoying and repetitite (at least with grok)
    },
    { role: 'user', content: (
      'Given this character: Name: ' + basicInfo.name + ', Nickname: ' + (basicInfo.nickname || '') + ', ' +
      'Age: ' + basicInfo.age + ', Height: ' + basicInfo.height + ', Gender: ' + basicInfo.gender + ', ' +
      'Short Description: ' + basicInfo.short_description + '. ' +
      'Now, provide flaws, starting location, description, agility, abilities, and limitations. ' +
      additionalContentDisclaimer +
      ' Keep your responses short. Respond in JSON.'
    )}
  ];
  return await apiChat(messages, SCHEMA_TRAITS);
}

// INVENTORY — starting inventory appropriate to the character's background
async function getCharacterInventory(basicInfo, traits) {
  var additionalContentDisclaimer = getMessage();
  var messages = [
    { role: 'system', content: 'You are an expert RPG character creator.' },
    { role: 'user', content: (
      'Given this character: Name: ' + basicInfo.name + ', Nickname: ' + (basicInfo.nickname || '') + ', ' +
      'Age: ' + basicInfo.age + ', Height: ' + basicInfo.height + ', Gender: ' + basicInfo.gender + ', ' +
      'Short Description: ' + basicInfo.short_description + '. ' +
      'Flaws: ' + traits.flaws + ', Starting Location: ' + traits.rpg_starting_location + ', ' +
      'Agility: ' + traits.agility + ', Abilities: ' + JSON.stringify(traits.abilities) + ', Limitations: ' + JSON.stringify(traits.limitations) + '. ' +
      'Now, provide a starting inventory appropriate to their background. If items are inside a pouch or satchel, this should be indicated in the description of the item; This way we can retain accurate quantity information. List the satchel itself as an item as well. The inventory should only have up to FIVE items. ' +
      additionalContentDisclaimer + ' Respond ONLY in the provided JSON schema.'
    )}
  ];
  return await apiChat(messages, SCHEMA_INVENTORY);
}

// ============================================================
//   Game Loop Functions
// ============================================================

// ENVIRONMENT — generate a starting RPG environment
async function getEnvironment(startingLocation, character) {
  var additionalContentDisclaimer = getMessage();
  character = character || {};
  var messages = [
    { role: 'system', content: 'You are an expert RPG environment generator. This means you create location, time, temperature, vibe, sounds, and people. ' },
    { role: 'user', content: (
      'Given the starting location: ' + startingLocation + '. ' +
      'The player character is named ' + (character.name || '') + ', and is ' + (character.position || '') + ' with this short description: ' + (character.short_description || '') + '. ' +
      'Generate a short environment description for an RPG. Include: location, time_of_day, temperature, vibe, sounds, a short paragraph called arrival_backstory explaining how the character got to this location and how long ago, and a list of 0-5 people nearby. Each person should be an object with name, gender, short_description, opinion (overall float: -0.99 hostile to 0.99 very friendly), opinions (object with overall, familiarity, trust, loyalty, touch_comfort), and optional secret_npc_details (private GM-only note, up to 30 words, may include hidden intention/secret). For touch_comfort: -0.99 means no physical touch allowed, 0 means neutral boundaries, 0.99 means highly comfortable with intimacy. Keep opinion and opinions.overall equal. It\'s important to note that sometimes there should be nobody around the player. Initial people should be fairly neutral in opinion; recommended near 0.00 (plus or minus 0.3). Use American units of measurement. Location should include specific room, general building, city area. The arrival_backstory should not have the character suddenly rushing into the location; instead, the environment should be a neutral and calm setting; good for the start of a story.' +
      additionalContentDisclaimer +
      ' Respond ONLY in this JSON schema: ' + JSON.stringify(SCHEMA_ENVIRONMENT)
    )}
  ];
  return await apiChat(messages, SCHEMA_ENVIRONMENT);
}

// ACTIONS — generate 4 suggested player actions
async function getActions(character, environment, inventory, history, displayedInventories) {
  character = character || {};
  environment = environment || {};
  inventory = inventory || [];
  var environmentContext = environmentForPrompt(environment, false);
  var displayedInventoryContext = displayedInventoriesForPrompt(displayedInventories);
  var objectivesContext = objectivesForPrompt(
    (typeof character === 'object' && character !== null) ? (character.objectives || []) : [],
    false
  );
  var additionalContentDisclaimer = getMessage();
  var messages = [];
  messages.push({
    role: 'system',
    content: 'You are an expert RPG next-action writer. You do not generate story elements. Instead, you provide responses for a user to choose from that are simple and can move the story forward. These actions should be written in the first-person perspective of the player character (' + character.name + '). You should ensure the first action is zero-risk, the second and third are various risks (entirely context dependent), with the fourth being somewhat or very risky, context dependent. If a character asked the player a question, you may way to have the actions include a response to that question, but it\'s not always required.'
  });

  var normalizedHistory = normalizeActionHistory(history, 16);
  for (var i = 0; i < normalizedHistory.length; i++) {
    messages.push({ role: normalizedHistory[i].role, content: normalizedHistory[i].content });
  }

  var peopleContext = (Array.isArray(environmentContext.people) && environmentContext.people.length > 0 && typeof environmentContext.people[0] === 'object')
    ? environmentContext.people.map(function(p) { return p.name || ''; })
    : (environmentContext.people || '');

  messages.push({
    role: 'user',
    content: (
      'Given this character: ' + character.name + ', ' + (character.position || '') + ', age ' + character.age + ', gender ' + character.gender + ', abilities: ' + (character.abilities || '') + ', limitations: ' + (character.limitations || '') + ', flaws: ' + (character.flaws || '') + ', inventory: ' + JSON.stringify(inventory) + '. ' +
      'Current environment: location: ' + (environmentContext.location || '') + ', time_of_day: ' + (environmentContext.time_of_day || '') + ', temperature: ' + (environmentContext.temperature || '') + ', vibe: ' + (environmentContext.vibe || '') + ', sounds: ' + (environmentContext.sounds || '') + ', people: ' + JSON.stringify(peopleContext) + '. ' +
      'Inventories currently visible to the player this turn (transient UI context): ' + JSON.stringify(displayedInventoryContext) + '. ' +
      'Player objective tracker (user-visible only): ' + JSON.stringify(objectivesContext) + '. ' +
      'Generate 4 possible actions the player could take next, considering their unique attributes, inventory, and the environment. Write these options in the 1st-person, using the pronouns \'I\' and \'me\', NOT \'you\'), and keep them very short (around one to three sentences). For example, you can generate something like this: \'I walk over to (character) and take hand her my satchel.\' ' +
      'If there are active objectives, at least one action should make progress toward one of them. ' +
      additionalContentDisclaimer + '. Respond only with JSON schema. '
    )
  });

  var lastError = null;
  var runMessages = messages.slice();

  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var raw = await apiChat(runMessages, SCHEMA_ACTIONS);
      // apiChat may return parsed object or raw string
      var parsed = (typeof raw === 'object' && raw !== null) ? raw : null;
      if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        return { actions: parsed.actions.slice(0, 4) };
      }
      var rawStr = (typeof raw === 'string') ? raw : JSON.stringify(raw);
      var payload = extractActionsPayload(rawStr, 1, 4);
      if (payload && payload.actions && payload.actions.length > 0) {
        return payload;
      }
    } catch (e) {
      lastError = e;
      console.error('Error in getActions attempt', attempt + 1, ':', e);
    }
    // After any failed attempt (bad parse or exception), append JSON reminder before next attempt
    if (attempt === 0) {
      runMessages = messages.slice();
      runMessages.push({
        role: 'user',
        content: (
          'Your previous response was invalid JSON. Retry now and respond as valid JSON only. ' +
          'Exact required format: {"actions": ["...", "...", "...", "..."]}. ' +
          'No markdown, no code fences, no commentary.'
        )
      });
    }
  }

  // Fallback: plain retry with JSON reminder
  try {
    var fallbackMessages = messages.slice();
    fallbackMessages.push({
      role: 'user',
      content: (
        'Respond with valid JSON only: {"actions": ["...", "...", "...", "..."]}. ' +
        'No markdown or extra text.'
      )
    });
    var fallbackRaw = await apiChat(fallbackMessages, SCHEMA_ACTIONS);
    var fallbackStr = (typeof fallbackRaw === 'string') ? fallbackRaw : JSON.stringify(fallbackRaw);
    var fallbackPayload = extractActionsPayload(fallbackStr, 1, 4);
    if (fallbackPayload && fallbackPayload.actions && fallbackPayload.actions.length > 0) {
      return fallbackPayload;
    }
  } catch (e) {
    lastError = e;
    console.error('Error in getActions fallback:', e);
  }

  console.error('Error in getActions: unable to recover, returning empty actions.', lastError);
  return { actions: [] };
}

// ACTION RESPONSE — generate the narrative story response to a player action
async function getActionResponse(character, environment, inventory, action, history, displayedInventories, objectives, storyLog, removedPeople, secretStoryDetail) {
  var additionalContentDisclaimer = getMessage('story');
  var messages = [];
  var environmentContext = environmentForPrompt(environment, true);
  var displayedInventoryContext = displayedInventoriesForPrompt(displayedInventories);
  var objectiveContextHidden = objectivesForPrompt(
    (objectives !== null && objectives !== undefined) ? objectives : (character.objectives || []),
    true
  );
  var storyLogContext = String(storyLog || '').trim();
  var secretStoryDetailContext = String(secretStoryDetail || '').replace(/\n/g, ' ').trim();
  var removedPeopleContext = removedPeopleForPrompt(removedPeople, true);
  var playerName = character.name || 'The player';
  var people = (typeof environmentContext === 'object' && environmentContext !== null) ? (environmentContext.people || []) : [];
  var nearbyNames = people.filter(function(p) { return typeof p === 'object' && p !== null && p.name; }).map(function(p) { return p.name; });

  messages.push({
    role: 'system',
    content: (
      'Task: Write the next RPG scene after the player\'s action. The player is ' + playerName + '. ' +
      'Use simple, clear prose with dialogue in quotes.\n' +
      'Rules:\n' +
      '1) If the player speaks to, asks, tells, greets, or otherwise addresses someone nearby, at least one nearby NPC must reply in this turn.\n' +
      '1b) NPC language should be gramatically coherent and contextually appropriate. Do not allow NPC to speak in broken sentences.\n' +
      '2) Include NPC actions when relevant, not only narration.\n' +
      '3) Do not repeat descriptive phrases previously used in the story. Only describe new aspects of the vibe or nearby sounds, if they have changed.\n' +
      '3b) Do not open your response by restating or paraphrasing the player\'s action. Jump straight into the unfolding consequence or reaction.\n' +
      '3c) Do not recycle content from recent assistant turns. Every response must advance the scene with new information, new dialogue, or a new development.\n' +
      '4) Do not control the player\'s choices beyond the action already given.\n' +
      '5) Do not both offer and complete a trade in the same turn. Trade completion requires explicit player confirmation.\n' +
      '6) Aim for 2-4 paragraphs for routine actions. For emotionally significant, action-heavy, or dialogue-rich turns, write 4-7 paragraphs. Never truncate a scene prematurely — let each beat breathe.\n' +
      '7) If player mentions they\'re \'looking around\', you may output additional paragraphs describing the environment (e.g, pathways, buildings, houses, rooms, escape routes, windows, items, people, describe the ceiling height, etc; Whatever is reasonable to be noticed from the player\'s perspective in that moment). \n' +
      '7b) When descring the area around the player, you may provide a formatted list.\n' +
      '8) No bullet points (unless a list is expected), no meta commentary. (Rule 7b is an exception)\n' +
      '9) NPCs have their own personalities, but they are not adversarial by default. They can be persuaded, surprised, charmed, or worn down. Only resist firmly when the established story specifically gives them a reason to — not as a blanket default. Interesting story beats are preferable to flat refusals.\n' +
      '10) Do not try to override attributes listed in the environment/character description (e.g., don\'t specify exact opinion values).\n' +
      '11) Storyline should favor the player when player is in a tough spot, but not every turn.\n' +
      '12) NPCs should act according to their expected personality and role in the game world, especially if NPC specifics are outlined in an objective step\'s hidden context.\n' +
      '13) If time passes for a beat, allow the story to continue. This could mean players continue going somewhere they\'re going, an NPC volunteers additional relevenat information, or an NPC takes an action that affects the player without the player needing to do anything. ' +
      String(additionalContentDisclaimer)
    )
  });

  var normalizedHistory = normalizeActionHistory(
    history,
    20,
    6,
    0,
    ['The following changes have been notated for the environment:', '[The above changes have already been applied to the game state']
  );
  for (var i = 0; i < normalizedHistory.length; i++) {
    messages.push({ role: normalizedHistory[i].role, content: normalizedHistory[i].content });
  }

  messages.push({
    role: 'user',
    content: (
      'Begin Player Info: Player: ' + playerName + ', role: ' + (character.position || '') + ', age ' + character.age + ', gender ' + character.gender + '. ' +
      'Abilities: ' + (character.abilities || '') + '. Limitations: ' + (character.limitations || '') + '. Flaws: ' + (character.flaws || '') + '. ' +
      'Player inventory: ' + JSON.stringify(inventory) + '. ' +
      'Story log so far (chronological summary; use this as continuity context): ' + (storyLogContext ? storyLogContext : '[none]') + '. ' +
      'End Player Info; NPCs are not aware of the player\'s abilities, limitations, or flaws unless these have been explicitly revealed through previous player actions in the story. ' +
      'NPCs should only know things about the player that are visually or audibly apparent, or that the player has told them. ' +
      'Inventories currently visible to the player this turn (used to inform trading/looting): ' + JSON.stringify(displayedInventoryContext) + '. ' +
      'Objective tracker (the player should not be told hidden details directly): ' + JSON.stringify(objectiveContextHidden) + '. ' +
      'Private one-turn secret story detail (minor edge, do not reveal directly unless discovered through player action): ' +
      (secretStoryDetailContext ? secretStoryDetailContext : '[none]') + '. ' +
      'Previously nearby but currently absent entities (can return later; reuse these identities directly if they reappear): ' + JSON.stringify(removedPeopleContext) + '. ' +
      'Current environment: ' + JSON.stringify(environmentContext) + '. ' +
      'Nearby entities by name: ' + JSON.stringify(nearbyNames) + '. ' +
      'The player wants to do the following: ' + action + '. ' +
      'Default to finding a way to make the player\'s action work. Only redirect or resist if the action is outright physically impossible or directly contradicts a firmly established fact in the current scene — and even then, find the closest plausible version rather than refusing outright. Do not moralize, warn, or lecture the player. Do not have NPCs resist player intent without a clear in-world reason. If the player action is directed at a nearby entity, include that entity\'s spoken reply now. ' +
      'It is not your responsibility to identify when an objective step has been completed. ' +
      'Now, write the next part of the story following the player\'s action, following the rules given above. '
    )
  });

  var responseText = await apiChat(messages, null);
  if (typeof responseText !== 'string') {
    responseText = responseText ? String(responseText) : '';
  }

  if (looksCutOff(responseText)) {
    var retryMessages = messages.slice();
    retryMessages.push({
      role: 'user',
      content: (
        'Your previous reply appears cut off. Rewrite the full reply from the start. ' +
        'Use 1-2 complete paragraphs and do not end mid-sentence.'
      )
    });
    var retryText = await apiChat(retryMessages, null);
    if (typeof retryText !== 'string') {
      retryText = retryText ? String(retryText) : '';
    }
    if (retryText && !looksCutOff(retryText)) {
      responseText = retryText;
    }
  }

  return responseText;
}

// ─── Helper: normalize log text for dedup comparisons ───────────────────────
function normalizeLogText(s) {
  s = String(s || '').toLowerCase();
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ─── Helper: reduce a string to its first sentence ──────────────────────────
function singleSentence(s) {
  s = String(s || '').replace(/\n/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();

  var abbreviations = [
    'mr.', 'mrs.', 'ms.', 'mx.', 'dr.', 'prof.', 'sr.', 'jr.',
    'Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Dr.', 'Prof.', 'Sr.', 'Jr.',
    'st.', 'mt.', 'ft.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'no.',
    'St.', 'Mt.', 'Ft.', 'Vs.', 'Etc.', 'E.g.', 'I.e.', 'No.'
  ];

  function isSentenceBreak(idx) {
    var ch = s[idx];
    if (ch === '!' || ch === '?') return true;
    if (ch !== '.') return false;
    if (idx > 0 && idx + 1 < s.length && /\d/.test(s[idx - 1]) && /\d/.test(s[idx + 1])) return false;
    var before = s.slice(0, idx + 1);
    var tokenMatch = before.match(/([A-Za-z][A-Za-z.]*)\.$/)
    if (tokenMatch) {
      var token = tokenMatch[1].toLowerCase() + '.';
      if (abbreviations.indexOf(token) !== -1) return false;
      if (/^[a-z]\.$/.test(token)) return false;
    }
    return true;
  }

  var first = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (!isSentenceBreak(i)) continue;
    if (i + 1 < s.length && !/\s/.test(s[i + 1])) continue;
    first = s.slice(0, i + 1).trim();
    break;
  }

  if (!first) first = s;
  if ('.!?'.indexOf(first[first.length - 1]) === -1) first += '.';
  return first;
}

// ─── Helper: check if a candidate sentence is already in the story log ───────
function alreadyInStoryLog(candidate, existingLog) {
  var c = normalizeLogText(candidate);
  var e = normalizeLogText(existingLog);
  if (!c || !e) return false;
  if (c.indexOf(e) !== -1 || e.indexOf(c) !== -1) return true;
  var existingSentences = String(existingLog || '').split(/[.!?]+/).map(function(seg) { return seg.trim(); }).filter(Boolean);
  for (var i = 0; i < existingSentences.length; i++) {
    var segNorm = normalizeLogText(existingSentences[i]);
    if (!segNorm) continue;
    if (c === segNorm || c.indexOf(segNorm) !== -1 || segNorm.indexOf(c) !== -1) return true;
  }
  return false;
}

// ─── Helper: normalize optional_objectives list ───────────────────────────────
function normalizeObjectiveCandidates(items) {
  if (!Array.isArray(items)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var raw = items[i];
    if (!raw || typeof raw !== 'object') continue;
    var title = String(raw.title || '').replace(/\n/g, ' ').trim();
    var description = String(raw.description || '').replace(/\n/g, ' ').trim();
    if (!title) continue;
    title = title.split(/\s+/).slice(0, 3).join(' ').trim();
    if (!title) continue;
    description = description.split(/\s+/).join(' ').trim();
    var difficulty = normalizeObjectiveDifficulty(raw.difficulty !== undefined ? raw.difficulty : null);
    var key = title.toLowerCase() + '::' + description.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    var row = { title: title, description: description };
    if (difficulty !== null && difficulty !== undefined) row.difficulty = difficulty;
    out.push(row);
    if (out.length >= 3) break;
  }
  return out;
}

// ─── Helper: brief active objectives for prompt context ──────────────────────
function activeObjectivesBrief(objectives) {
  var normalized = objectivesForPrompt(Array.isArray(objectives) ? objectives : [], false);
  var brief = [];
  for (var i = 0; i < normalized.length; i++) {
    var obj = normalized[i];
    if (!obj || typeof obj !== 'object') continue;
    if (obj.is_completed) continue;
    var title = String(obj.title || '').replace(/\n/g, ' ').split(/\s+/).slice(0, 6).join(' ').trim();
    if (!title) continue;
    var description = String(obj.description || '').replace(/\n/g, ' ').split(/\s+/).slice(0, 14).join(' ').trim();
    var nextStep = '';
    var steps = Array.isArray(obj.steps) ? obj.steps : [];
    for (var j = 0; j < steps.length; j++) {
      var step = steps[j];
      if (!step || typeof step !== 'object') continue;
      var status = String(step.status || '').toLowerCase();
      if (status === 'completed' || status === 'passed') continue;
      nextStep = String(step.user_text || '').replace(/\n/g, ' ').split(/\s+/).slice(0, 12).join(' ').trim();
      if (nextStep) break;
    }
    var row = { title: title };
    if (description) row.description = description;
    if (nextStep) row.next_step = nextStep;
    brief.push(row);
    if (brief.length >= 5) break;
  }
  return brief;
}

// ─── Helper: filter candidate objectives similar to active ones ───────────────
function dropObjectiveCandidatesSimilarToActive(candidates, activeObjectives) {
  if (!candidates || !candidates.length || !activeObjectives || !activeObjectives.length) return candidates;

  var stopwords = {
    'the': 1, 'a': 1, 'an': 1, 'to': 1, 'for': 1, 'and': 1, 'or': 1, 'of': 1,
    'in': 1, 'on': 1, 'at': 1, 'with': 1, 'from': 1, 'by': 1, 'is': 1, 'are': 1,
    'be': 1, 'as': 1, 'into': 1, 'through': 1, 'your': 1, 'their': 1, 'his': 1,
    'her': 1, 'my': 1, 'our': 1, 'this': 1, 'that': 1, 'these': 1, 'those': 1
  };

  function tokenSet(text) {
    var norm = normalizeLogText(text);
    var words = norm.split(/\s+/).filter(function(w) { return w.length >= 3 && !stopwords[w]; });
    var set = {};
    for (var i = 0; i < words.length; i++) set[words[i]] = true;
    return set;
  }

  var activeTexts = [];
  for (var i = 0; i < activeObjectives.length; i++) {
    var obj = activeObjectives[i];
    if (!obj || typeof obj !== 'object') continue;
    var txt = [
      String(obj.title || '').trim(),
      String(obj.description || '').trim(),
      String(obj.next_step || '').trim()
    ].join(' ').trim();
    if (txt) activeTexts.push(txt);
  }

  var filtered = [];
  for (var i = 0; i < candidates.length; i++) {
    var cand = candidates[i];
    if (!cand || typeof cand !== 'object') continue;
    var candText = [String(cand.title || '').trim(), String(cand.description || '').trim()].join(' ').trim();
    if (!candText) continue;
    var candNorm = normalizeLogText(candText);
    var candTokens = tokenSet(candText);
    var candTokenKeys = Object.keys(candTokens);
    var isSimilar = false;
    for (var j = 0; j < activeTexts.length; j++) {
      var activeNorm = normalizeLogText(activeTexts[j]);
      if (!activeNorm) continue;
      if (candNorm === activeNorm || candNorm.indexOf(activeNorm) !== -1 || activeNorm.indexOf(candNorm) !== -1) {
        isSimilar = true;
        break;
      }
      var activeTokens = tokenSet(activeTexts[j]);
      var activeTokenKeys = Object.keys(activeTokens);
      var overlap = 0;
      for (var k = 0; k < candTokenKeys.length; k++) {
        if (activeTokens[candTokenKeys[k]]) overlap++;
      }
      var denom = Math.min(candTokenKeys.length, activeTokenKeys.length);
      if (denom > 0 && (overlap / denom) >= 0.6) {
        isSimilar = true;
        break;
      }
    }
    if (!isSimilar) filtered.push(cand);
  }
  return filtered;
}

// ─── Helper: normalize secret_story_detail to max 30 words ──────────────────
function normalizeSecretStoryDetail(value) {
  var text = String(value || '').replace(/\n/g, ' ').trim();
  if (!text) return '';
  return text.split(/\s+/).slice(0, 30).join(' ').trim();
}

async function detectNeedsStateRegen(character, environment, inventory, action, response, history, storyLog) {
  var additionalContentDisclaimer = getMessage();
  var environmentContext = environmentForPrompt(environment, true);
  var messages = [];
  var storyLogStr = String(storyLog || '').trim();
  var activeBrief = activeObjectivesBrief(
    (character && typeof character === 'object') ? (character.objectives || []) : []
  );

  messages.push({
    role: 'system',
    content: (
      'Task: Decide whether game state must be regenerated after one action.\n' +
      'Return exactly this JSON object and nothing else:\n' +
      '{"environment": true/false, "environment_justification": "brief reason string", "character": true/false, "character_justification": "brief reason string", "inventory": true/false, "needs_npc_inv": ["entity/location name", ...], "optional_objectives": [{"title":"max 3 words","description":"max 10 words","difficulty":1-10}], "story_log_addition": "single-sentence string or empty", "secret_story_detail": "up to 30 words or empty"}\n\n' +
      'Rule 1 - environment:\n' +
      '- Set to true when the scene likely changed: location, nearby people/creatures, mood, sounds, time, or other environment details.\n' +
      '- Set to true for movement between places (example: going through a door).\n' +
      '- Set to true if the player sleeps or does something that causes considerable time to pass.\n' +
      '- Set to true when NPC appearance/identity details are newly revealed (example: character reveals age or their name; age should be added to character description).\n' +
      '- Set to true when the player and NPC interact in a way that would majorly affect the brief description of the NPC.\n' +
      '- environment_justification is required ONLY if you\'ve set environment to true, and must explain in one short sentence why a change is needed.\n' +
      '- environment_justification must specifically state what attributes need to change (e.g., time, temp, character opinion, etc).\n' +
      '- environment_justification should NOT contain the new values specifically, just a general reason and/or direction they should be changed. \n' +
      '- Only attributes listed in the justification will be changed.\n' +
      '- If environment=false, set environment_justification to an empty string\n' +
      '- Otherwise set to false.\n\n' +
      'Rule 2 - character:\n' +
      '- Set to true only for persistent player-character changes.\n' +
      '- Set to true when the player learns a NEW ability.\n' +
      '- Set to true when the player IMPROVES an existing ability/mastery in a way that should persist.\n' +
      '- Set to true for durable trait shifts (agility, limitations, flaws, or character description) caused by the action/outcome.\n' +
      '- Do NOT set true for temporary boosts/debuffs, short-lived emotions, or one-turn effects.\n' +
      '- Do NOT set true for limitations unless they are permanent or long-lasting — a temporary injury, tiredness, or situational disadvantage does not qualify.\n' +
      '- Do NOT set true for abilities unless the player genuinely learned or substantially improved a skill — a single successful action does not qualify.\n' +
      '- character_justification is required ONLY if character=true and should briefly name what changed (example: learned new ability and refined agility).\n' +
      '- If character=false, set character_justification to an empty string.\n\n' +
      'Rule 3 - inventory:\n' +
      '- Set to true only when the PLAYER character inventory changed now (gain, loss, consume, damage, modify, or hand over item).\n' +
      '- Set to true if the player gives an item to someone or if someone forcefully takes an item.\n' +
      '- Set to true if an item is consumed by the actions of the player or a nearby NPC.\n' +
      '- If trade is only discussed and not confirmed, set to false.\n' +
      '- Otherwise set to false.\n\n' +
      'Rule 4 - needs_npc_inv (use rarely):\n' +
      '- Add names/locations only when another inventory is strongly relevant now (trade, combat, looting, searching, or look-around context).\n' +
      '- This can include NPCs, creatures, containers, or locations.\n' +
      '- Do not include entities whose inventories were just generated and likely unchanged.\n' +
      '- Include when the player\'s action explicitly asks to inspect/search/loot/inventory/trade, AND also when the context strongly implies an inventory would be useful (e.g. a merchant is offering wares, loot is nearby after combat, a container was just discovered).\n' +
      '- If the player action is normal dialogue (greeting, persuasion, questions, threats, movement) with no inventory relevance, return [].\n' +
      '- If unsure, return [].\n\n' +
      'Rule 5 - story_log_addition:\n' +
      '- Return either few words (string) or an empty string.\n' +
      '- Add a sentence only for significant long-term events: relationship shifts, promises/oaths/deals, missions/quests, major reveals, betrayals, alliances, injuries/deaths, or other likely recurring plot events.\n' +
      '- Do not add minor flavor details or routine dialogue.\n' +
      '- Do not repeat anything already present in the current story log.\n' +
      '- Keep it extremely concise, factual, and one sentence; Should be like few-word notes, can rely on implied connections to previous parts of log.\n\n' +
      'Rule 6 - optional_objectives:\n' +
      '- Suggest only when the action/response introduces a potential mission, promise, deal, plan, or goal.\n' +
      '- Return [] when no objective is implied.\n' +
      '- Each objective must include title (max 4 words) and description (max 10 words).\n' +
      '- difficulty is optional, but when present it must be an integer 1 to 10.\n' +
      '- Do not suggest objectives that overlap with the player\'s current active objectives.\n' +
      '- If the player is already pursuing the same intent, return [] or suggest a clearly distinct goal.\n' +
      '- Any mission/quest-like objectives should have slight difficulty or complexity implied in the description.\n' +
      '- You may suggest a bold objective that isn\'t necessarily implied at all in the current context, but builds relevantly on the existing story, possible moving it to an entirely new direction.\n' +
      '- Keep these concise and practical.\n\n' +
      '- Difficulty should be ranked out of 10 (1 = easy, 10 = nearly impossible).\n\n' +
      'Rule 7 - secret_story_detail:\n' +
      '- Return a subtle hidden detail (max 30 words) about nearby environment, characters, routes, objects, or timing.\n' +
      '- It should be minor but useful if the player later discovers it (small advantage, not major plot twist).\n' +
      '- Keep it factual and grounded in the current scene.\n' +
      '- Return empty string only if no good detail exists.\n\n' +
      'Output requirements:\n' +
      '- JSON only. No explanation text.\n' +
      '- environment, character, and inventory must be booleans.\n' +
      '- If environment=true, environment_justification must be non-empty; otherwise it must be empty.\n' +
      '- If character=true, character_justification must be non-empty; otherwise it must be empty.\n' +
      '- needs_npc_inv must be a list of strings.\n' +
      '- optional_objectives must be a list of {title,description,difficulty?} objects.\n' +
      '- story_log_addition must be a string (single sentence or empty).\n' +
      '- secret_story_detail must be a string up to 30 words.\n' +
      additionalContentDisclaimer
    )
  });

  var normalizedHistory = normalizeActionHistory(history, 16, 6, 2);
  for (var i = 0; i < normalizedHistory.length; i++) {
    messages.push({ role: normalizedHistory[i].role, content: normalizedHistory[i].content });
  }

  var actionText = String(action || '');
  var playerName = String((character && character.name) || '').trim();
  var playerNameLower = playerName.toLowerCase();

  // Hard gate: only allow NPC/environment inventory generation when player explicitly asks
  var explicitInvPatterns = [
    /\binventory\b/,
    /\bshow\b.*\b(what you have|your wares|your goods|what.*sell)\b/,
    /\bwhat (do )?you have\b/,
    /\bsearch\b/,
    /\bloot\b/,
    /\bcheck\b.*\b(pockets|bag|satchel|chest|crate|corpse|body)\b/,
    /\binspect\b.*\b(pockets|bag|satchel|chest|crate|corpse|body|inventory)\b/,
    /\btrade\b|\bbarter\b|\bbuy\b|\bsell\b/,
    /\blook around\b/
  ];
  var actionLower = actionText.toLowerCase();
  var playerExplicitlyRequestedInv = explicitInvPatterns.some(function(p) { return p.test(actionLower); });

  messages.push({
    role: 'user',
    content: (
      'Given this character: ' + JSON.stringify(character) + ', environment: ' + JSON.stringify(environmentContext) + ', inventory: ' + JSON.stringify(inventory) + ', ' +
      "and the action '" + action + "' with outcome '" + response + "', determine if the environment, inventory, and/or NPC inventories need to be (re)generated. " +
      'Current active objectives (brief): ' + (activeBrief && activeBrief.length ? JSON.stringify(activeBrief) : '[none]') + '. ' +
      "Current story log: '" + storyLogStr + "'. " +
      'DO NOT GENERATE AN INVENTORY FOR ' + playerName + '. ' +
      'Respond ONLY with a JSON object of the form: {"environment": true/false, "environment_justification": "brief reason", "character": true/false, "character_justification": "brief reason", "inventory": true/false, "needs_npc_inv": ["entity/location name", ...], "optional_objectives": [{"title":"max 3 words","description":"max 10 words","difficulty":1-10}], "story_log_addition": "single sentence or empty", "secret_story_detail": "up to 30 words or empty"}.' +
      additionalContentDisclaimer
    )
  });

  var content = await apiChat(messages, SCHEMA_ACTION_STATE_CHANGES);
  console.log('[detectNeedsStateRegen] raw response:', content);
  console.log('[detectNeedsStateRegen] playerExplicitlyRequestedInv:', playerExplicitlyRequestedInv, '| action:', actionText);

  var data = {};
  try {
    if (content && typeof content === 'object') {
      data = content;
    } else {
      data = JSON.parse(content);
    }
  } catch (e) {
    // crude fallback
    var contentStr = String(content || '');
    if (contentStr.indexOf('environment') !== -1 && contentStr.indexOf('inventory') !== -1) {
      var envPart = contentStr.toLowerCase().split('environment')[1] || '';
      var invPart = contentStr.toLowerCase().split('inventory')[1] || '';
      var envFlag = envPart.indexOf('true') !== -1;
      var invFlag = invPart.indexOf('true') !== -1;
      return {
        environment: envFlag,
        environment_justification: envFlag ? 'Scene details likely changed and should be refreshed.' : '',
        character: false, character_justification: '',
        inventory: invFlag,
        needs_npc_inv: [], optional_npc_inv: [], optional_objectives: [],
        story_log_addition: '', secret_story_detail: ''
      };
    }
    return {
      environment: false, environment_justification: '', character: false, character_justification: '',
      inventory: false, needs_npc_inv: [], optional_npc_inv: [], optional_objectives: [],
      story_log_addition: '', secret_story_detail: ''
    };
  }

  // Clean needs_npc_inv
  var rawNeeds = Array.isArray(data.needs_npc_inv) ? data.needs_npc_inv : [];
  var cleanedNeeds = [];
  for (var i = 0; i < rawNeeds.length; i++) {
    var s = String(rawNeeds[i] || '').trim();
    if (!s) continue;
    if (playerNameLower && s.toLowerCase() === playerNameLower) continue;
    cleanedNeeds.push(s);
  }
  var optionalNpcInv = [];
  if (!playerExplicitlyRequestedInv) {
    optionalNpcInv = cleanedNeeds.slice();
    cleanedNeeds = [];
  }

  var environmentFlag = !!data.environment;
  var environmentJustification = singleSentence(data.environment_justification || '');
  if (!environmentJustification) {
    environmentJustification = environmentFlag ? 'Scene details likely changed and should be refreshed.' : '';
  }

  var characterFlag = !!data.character;
  var characterJustification = singleSentence(data.character_justification || '');
  if (!characterJustification) {
    characterJustification = characterFlag ? 'Player progression likely changed and should be refreshed.' : '';
  }

  var storyLogAddition = singleSentence(data.story_log_addition || '');
  if (alreadyInStoryLog(storyLogAddition, storyLogStr)) {
    storyLogAddition = '';
  }

  var secretStoryDetail = normalizeSecretStoryDetail(data.secret_story_detail || '');
  var optionalObjectives = normalizeObjectiveCandidates(data.optional_objectives || []);
  optionalObjectives = dropObjectiveCandidatesSimilarToActive(optionalObjectives, activeBrief);

  var result = {
    environment: environmentFlag,
    environment_justification: environmentJustification,
    character: characterFlag,
    character_justification: characterJustification,
    inventory: !!data.inventory,
    needs_npc_inv: cleanedNeeds,
    optional_npc_inv: optionalNpcInv,
    optional_objectives: optionalObjectives,
    story_log_addition: storyLogAddition,
    secret_story_detail: secretStoryDetail
  };
  console.log('[detectNeedsStateRegen] final result:', result);
  return result;
}

async function regenerateEnvironmentState(character, environment, inventory, action, response, history, environmentJustification, characterJustification, removedPeople) {
  var additionalContentDisclaimer = getMessage();
  var playerName = String((character && character.name) || '').trim();
  var environmentContext = environmentForPrompt(environment, true);
  var removedPeopleContext = removedPeopleForPrompt(removedPeople, true);
  var envJust = String(environmentJustification || '').trim();
  var charJust = String(characterJustification || '').trim();
  var messages = [];

  var normalizedHistoryRegen = normalizeActionHistory(history, 20, 6, 2);
  for (var hi = 0; hi < normalizedHistoryRegen.length; hi++) {
    messages.push({ role: normalizedHistoryRegen[hi].role, content: normalizedHistoryRegen[hi].content });
  }

  messages.push({
    role: 'system',
    content: (
      'Task: Return world-state changes as a minimal patch.\n' +
      'Do NOT regenerate full environment or full character.\n' +
      'Use this exact JSON shape:\n' +
      '{\n' +
      '  "environment_patch": {\n' +
      '    "location": "optional string if changed",\n' +
      '    "time_of_day": "optional string if changed",\n' +
      '    "temperature": "optional string if changed",\n' +
      '    "vibe": "optional string if changed, keep it short <15 words.",\n' +
      '    "sounds": "optional string if changed",\n' +
      '    "people_visible": [\n' +
      '      {"name":"...","short_description":"...","opinion":0.0,"opinions":{"overall":0.0,"familiarity":0.0,"trust":0.0,"loyalty":0.0,"touch_comfort":0.0},"gender":"...","secret_npc_details":"optional details the NPC keeps secret from the player"}\n' +
      '    ],\n' +
      '    "people_renames": [\n' +
      '      {"old_name":"Old Name","new_name":"New Name"}\n' +
      '    ],\n' +
      '    "people_add_or_update": [\n' +
      '      {"name":"...","opinion":0.0},\n' +
      '      {"name":"...","opinions":{"trust":0.2}},\n' +
      '      {"name":"New Name","previous_name":"Old Name"},\n' +
      '      {"name":"...","short_description":"..."},\n' +
      '      {"name":"...","gender":"..."},\n' +
      '      {"name":"...","secret_npc_details":"optional details the NPC keeps secret from the player"}\n' +
      '    ],\n' +
      '    "people_remove": ["Name To Remove"]\n' +
      '  },\n' +
      '  "character_patch": {\n' +
      '    "agility": "optional updated value",\n' +
      '    "abilities": [\n' +
      '      {"name":"Ability Name","description":"short description"}\n' +
      '    ],\n' +
      '    "limitations": ["optional full final list if changed"],\n' +
      '    "flaws": "optional updated value",\n' +
      '    "description": "optional updated value"\n' +
      '  }\n' +
      '}\n' +
      'Rules:\n' +
      '- Include only fields that changed.\n' +
      '- environment_patch is for scene changes only.\n' +
      '- character_patch is for persistent player progression only.\n' +
      '- Reasonably follow both justifications. Try not to change anything else not specifically listed.\n' +
      '- Be sure to include the persons new name/identity, if it was recently revealed. The justification will likely tell you to do this.\n' +
      '- If the scene changed significantly in a way that changes most of who was/is now perceivable (player entering/leaving a building, turning a corner, changing rooms, moving far away), provide people_visible as the FULL final updated nearby list. Do not use this to generate simple character description/opinion updates.\n' +
      '- Location should include specific room, general building, city area.\n' +
      '- When people_visible is used, do not include out-of-sight or distant characters.\n' +
      '- Use people_add_or_update for new/updated nearby entities. For existing entities, provide name + ONLY changed fields (partial object updates are expected).\n' +
      '- For direct identity/name changes (X becomes Y), always include people_renames with {old_name,new_name}.\n' +
      '- For renamed people, also include an update entry for the NEW name in people_add_or_update (with changed fields only).\n' +
      '- If someone from removed_people returns, reuse that prior identity details instead of inventing a new unrelated person.\n' +
      '- You may include previous_name in people_add_or_update when helpful, but people_renames is preferred.\n' +
      '- If character age is known, it should be the first part of the short_description.\n' +
      '- If using people_visible for a major scene refresh, it must already contain only final names.\n' +
      '- secret_npc_details is information that is private to the character, like their intent, embarrasment, or hidden motivations.\n' +
      '- For a pure stance shift, send only changed opinion fields. Examples: {"name":"...","opinion":...} for overall only, or {"name":"...","opinions":{"trust":...}} for a specific metric.\n' +
      '- opinion must always stay equal to opinions.overall.\n' +
      '- Use people_remove for entities no longer nearby and likely not to return.\n' +
      '- Do not use people_remove for entities that are just stepping out for a moment.\n' +
      '- Do not use people_remove for entities that have recently died; If their body is present, they should remain in scene.\n' +
      '- Never add the player character (' + playerName + ') to people_add_or_update or to people_visible.\n' +
      '- short_description must be a broad, stable visual summary (around 6-14 words).\n' +
      '- short_description may include level of inebriation (e.g., \'slightly inebriated\', \'blacking out\'). \n' +
      '- Avoid highly specific or temporary details (exact objects, exact actions, symbolic interpretations, narrative commentary).\n' +
      '- Do not include sentiment labels or parenthetical meta in short_description.\n' +
      '- Do not include dialogue.\n' +
      '- If ability progression happened, character_patch.abilities must be the FULL final ability list after the change.\n' +
      '- For ability improvements, update the existing ability description (or name only if truly renamed).\n' +
      '- Do not add temporary buffs/debuffs to character_patch.\n' +
      '- Only update limitations when they have permanently and functionally changed — e.g. a permanent injury, a newly discovered hard constraint, or an existing limitation being fully resolved. Do NOT update limitations for temporary states (fatigue, intoxication, emotional state, short-term conditions) or narrative flavor. If the limitation will likely be gone next turn, do not add it.\n' +
      '- Only update abilities when the player has genuinely learned or meaningfully improved a skill. Do not update abilities for one-off successful actions, temporary boosts, or context-specific advantages.\n' +
      '- If no environment change, use an empty object for environment_patch.\n' +
      '- If no character progression change, use an empty object for character_patch.\n' +
      '- If nothing changed at all, return {"environment_patch": {}, "character_patch": {}}.' +
      additionalContentDisclaimer
    )
  });

  messages.push({
    role: 'user',
    content: (
      'Character: ' + (character && character.name) + ', ' + ((character && character.position) || '') + ', age ' + (character && character.age) + ', ' +
      'gender ' + (character && character.gender) + ', abilities: ' + ((character && character.abilities) || '') + ', limitations: ' + JSON.stringify((character && character.limitations) || '') + ', ' +
      'flaws: ' + ((character && character.flaws) || '') + ', inventory: ' + JSON.stringify(inventory) + '.\n' +
      'Current environment: ' + JSON.stringify(environmentContext) + '\n' +
      'Removed people memory (not currently nearby, but may reappear): ' + JSON.stringify(removedPeopleContext) + '\n' +
      "Action: '" + action + "'\n" +
      "Outcome: '" + response + "'\n" +
      "Environment regeneration justification: '" + envJust + "'\n" +
      "Character regeneration justification: '" + charJust + "'\n" +
      'Return only the minimal patch object.'
    )
  });

  var content = await apiChat(messages, SCHEMA_WORLD_STATE_PATCH);

  var patch = {};
  try {
    if (content && typeof content === 'object') {
      patch = content;
    } else {
      patch = JSON.parse(content);
    }
  } catch (e) {
    patch = {};
  }

  if (!patch || typeof patch !== 'object') patch = {};

  var envKeys = ['location', 'time_of_day', 'temperature', 'vibe', 'sounds', 'people_visible', 'people_renames', 'people_add_or_update', 'people_remove'];
  var environmentPatch;
  if (patch.environment_patch && typeof patch.environment_patch === 'object') {
    environmentPatch = patch.environment_patch;
  } else if (envKeys.some(function(k) { return k in patch; })) {
    // Backward compatibility: direct environment patch payload
    environmentPatch = patch;
  } else {
    environmentPatch = {};
  }

  var characterPatchRaw = (patch.character_patch && typeof patch.character_patch === 'object') ? patch.character_patch : {};

  var newEnvironment = mergeEnvironmentPatch(environment, environmentPatch, playerName, removedPeople);
  var characterPatch = mergeCharacterPatch(character, characterPatchRaw);

  return {
    environment: newEnvironment,
    characterPatch: characterPatch
  };
}

async function updateInventory(character, environment, prevInventory, action, response) {
  var additionalContentDisclaimer = getMessage();
  var objectiveContextHidden = objectivesForPrompt(
    (character && typeof character === 'object') ? (character.objectives || []) : [],
    true
  );
  var environmentContext = environmentForPrompt(environment, true);
  var messages = [
    {
      role: 'system',
      content: 'You are an expert RPG inventory updater. Update the player\'s inventory only. ' + additionalContentDisclaimer
    },
    {
      role: 'user',
      content: (
        'Previous inventory: ' + JSON.stringify(prevInventory) + '\n' +
        'Character: ' + (character && character.name) + ', ' + ((character && character.position) || '') + ', age ' + (character && character.age) + ', gender ' + (character && character.gender) + ', abilities: ' + ((character && character.abilities) || '') + ', limitations: ' + ((character && character.limitations) || '') + ', flaws: ' + ((character && character.flaws) || '') + '\n' +
        'Current environment: location: ' + (environmentContext.location || '') + ', time_of_day: ' + (environmentContext.time_of_day || '') + ', temperature: ' + (environmentContext.temperature || '') + ', vibe: ' + (environmentContext.vibe || '') + ', sounds: ' + (environmentContext.sounds || '') + ', people: ' + JSON.stringify(environmentContext.people || '') + '\n' +
        'Action taken: ' + action + '\n' +
        'AI response: ' + response + '\n' +
        'Objective tracker with hidden notes (may imply item gains/losses): ' + JSON.stringify(objectiveContextHidden) + '\n' +
        'Update the player\'s inventory to reflect any changes that should have occurred as a result of the action and its outcome. The item description should try to indicate how the item was acquired. If it was crafted from existing items, purchased, found, stolen, or otherwise acquired. If an item was used up, it should be removed from the inventory. This does not mean empty containers should be removed. Generic descriptions of containments are not helpful; Instead, specific lists of items inside containers should be included in the description of the container item. If describing currency, be specific about the type (e.g., \'Gold coins\', \'Silver coins\'). Each inventory item object will have its own quantity and description values. Ensure you are using the quantity value instead of including the total in the description of the item. If describing clothing, must specify if it is worn or not. Respond in the required JSON schema. '
      )
    }
  ];

  var result = await apiChat(messages, SCHEMA_INVENTORY_CHANGES);
  if (result && Array.isArray(result.inventory)) return result.inventory;
  return [];
}

async function getEntityInv(npcInfo, context, history) {
  var additionalContentDisclaimer = getMessage();
  var messages = [];

  var normalizedHistory = normalizeActionHistory(history, 20, 6, 0);
  for (var i = 0; i < normalizedHistory.length; i++) {
    messages.push({ role: normalizedHistory[i].role, content: normalizedHistory[i].content });
  }

  messages.push({
    role: 'system',
    content: 'You are an expert RPG NPC inventory generator. Based on the story context and description of this NPC, generate a plausible inventory for them. The player will be shown this inventory when interacting with them, so it should make sense for the NPC\'s character and the current story context. If the NPC is a trader, this should be their stock. If the NPC is a commoner, this should be their personal belongings. If the inventory is for a location, these should be items physically present in that location that the player could interact with or pick up. '
  });

  var npcDesc = (
    'NPC: Name: ' + (npcInfo && npcInfo.name) + ', Gender: ' + (npcInfo && npcInfo.gender) + ', Age: ' + (npcInfo && npcInfo.age) + ', ' +
    'Position/Title: ' + ((npcInfo && npcInfo.position) || '') + ', Description: ' + ((npcInfo && npcInfo.description) || '') + '. '
  );
  var contextDesc = '';
  if (context) {
    contextDesc = 'Context: ' + JSON.stringify(environmentForPrompt(context, true)) + '. ';
  }

  messages.push({
    role: 'user',
    content: (
      npcDesc +
      contextDesc +
      'Generate a list of items this entity (NPC, environment, or shop) would have in its inventory. This could be trader stock, personal items, shop stock, a container, and/or the environment. Give the inventory a name, then define each item in it. These items are physical objects. When describing the inventory of a location, you must list objects, NOT parts of the building/environment. An inventory title is required. Respond in the required JSON schema. ' +
      additionalContentDisclaimer
    )
  });

  var result = await apiChat(messages, SCHEMA_ENTITY_INV);
  var inventoryTitle = '';
  var items = [];
  if (result && typeof result === 'object') {
    inventoryTitle = String(result.inventoryTitle || result.inventory_title || '');
    items = Array.isArray(result.items) ? result.items : [];
  }
  return { inventoryTitle: inventoryTitle, items: items };
}

async function generateObjectiveSteps(character, environment, objective, history) {
  character = character || {};
  environment = environment || {};
  objective = objective || {};

  var additionalContentDisclaimer = getMessage('story');
  var playerName = String(character.name || 'The player').trim() || 'The player';
  var playerRole = String(character.position || '').trim();
  var playerAge = String(character.age || '').trim();
  var playerGender = String(character.gender || '').trim();
  var playerDescription = String(character.description || '').trim();
  var playerShortDescription = String(character.short_description || '').trim();
  var playerAbilities = character.abilities || [];
  var playerLimitations = character.limitations || [];
  var playerFlaws = String(character.flaws || '').trim();
  var playerAgility = String(character.agility || '').trim();

  var objectiveTitle = String(objective.title || '').trim();
  var objectiveDescription = String(objective.description || '').trim();
  var objectiveDifficulty = normalizeObjectiveDifficulty(objective.difficulty);

  var environmentContext = environmentForPrompt(environment, true);
  var normalizedHistory = normalizeActionHistory(history, 12);
  var storyLogContext = String(objective.story_log || '').trim();
  var inventory = Array.isArray(objective.inventory) ? objective.inventory : [];

  var messages = [];
  for (var i = 0; i < normalizedHistory.length; i++) {
    messages.push({ role: normalizedHistory[i].role, content: normalizedHistory[i].content });
  }
  messages.push({
    role: 'system',
    content: (
      'Task: Generate the steps for a player to complete an objective in an RPG.\n' +
      'Return JSON only in this shape:\n' +
      '{"steps": [{"user_text": "...", "hidden_context": "...", "step_type": "required|loose|optional", "status": "pending"}]}\n\n' +
      'Rules:\n' +
      '- Create 2 to 7 steps total.\n' +
      '- user_text must be short and clear (max 12 words).\n' +
      '- hidden_context can be empty.\n' +
      '- step_type values:\n' +
      '  * required: mandatory milestone needed to finish the objective.\n' +
      '  * loose: intent is clear, but there are many valid ways to do it.\n' +
      '  * optional: bonus path that can be skipped.\n' +
      '- Use \'loose\' when only broad intent is known and multiple methods are valid.\n' +
      '  * An example: Instead of saying \'Approach east gate undetected\', say \'approach the east gate, without causing issues with the guards\'.\n' +
      '  * This allows flexibility for the player to find creative solutions, while still giving clear guidance on the goal.\n' +
      '- Status for new steps should be pending.\n' +
      '- hidden_context can include secret details, challenge twists, vulnerabilities, npc-related secrets, or clue locations.\n' +
      '- hidden_context can be up to 40 words.\n' +
      '- hidden_context should add personalities and boundaries of mission-involved characters. This will ensure the mission has reasonable difficulty/consistency that would prevent the player from easily convincing an NPC to do something that doesn\'t fit their character. For example, if an NPC is a father with a family, the hidden_context can specify that they are protective of their family and would not easily share information that could put them in danger.\n' +
      '- The hidden_context can explain the stubborness or major boundaries of an NPC, including what the player cannot easily convince them to do.\n' +
      '- The hidden_context can include specific details about an NPC that would be relevant to the player discovering through interaction, such as their vulnerabilities, secrets, or what they value.\n' +
      '- The final step should mention reward/outcome in user_text when appropriate.\n' +
      '- Tailor steps to the player\'s role, known abilities, and practical limitations.\n' +
      '- If the player has expertise that applies (e.g., herbalist, hunter, mage), prefer that path over generic alternatives.\n' +
      '- Avoid unnecessary outsourcing when the player\'s profile suggests they can do the task directly.\n' +
      '- Keep steps grounded in the provided story and environment.\n' +
      '- Objective difficulty is optional. If provided, pace and complexity should match it:\n' +
      '  * 1-3: simple and direct path.\n' +
      '  * 4-7: high risk/complexity, multiple dependencies and tougher hidden constraints.\n' +
      '  * 8-10: Almost certainly impossible, major power imbalance or strong NPC resolve against the player.\n' +
      '- When the objective\'s difficulty is 8-10, the hidden context should explicitly specify the only viable path of success for one or more steps. This could be a specific code word, a secret item, or a highly specific NPC weakness that leads to player success.\n' +
      '- Do not include markdown.\n' +
      additionalContentDisclaimer
    )
  });
  messages.push({
    role: 'user',
    content: (
      'Player: ' + playerName + '. ' +
      'Role/title: ' + (playerRole || '[unknown]') + '. ' +
      'Age: ' + (playerAge || '[unknown]') + ', Gender: ' + (playerGender || '[unknown]') + '. ' +
      'Profile description: ' + (playerDescription || '[none]') + '. ' +
      'Short description: ' + (playerShortDescription || '[none]') + '. ' +
      'Agility: ' + (playerAgility || '[unknown]') + '. ' +
      'Abilities: ' + (playerAbilities.length ? JSON.stringify(playerAbilities) : '[none]') + '. ' +
      'Limitations: ' + (playerLimitations.length ? JSON.stringify(playerLimitations) : '[none]') + '. ' +
      'Flaws: ' + (playerFlaws || '[none]') + '. ' +
      'Objective title: ' + objectiveTitle + '. ' +
      'Objective description: ' + objectiveDescription + '. ' +
      'Objective difficulty (1-10, optional): ' + (objectiveDifficulty != null ? objectiveDifficulty : '[unspecified]') + '. ' +
      'Player inventory: ' + JSON.stringify(inventory) + '. ' +
      'Current environment: ' + JSON.stringify(environmentContext) + '. ' +
      'Story log: ' + (storyLogContext || '[none]') + '. ' +
      'Generate the objective steps now. If the objective is straightforward, you can generate fewer steps with simplistic information. If the objective is complex, you can generate more steps with more hidden_context details.'
    )
  });

  var result = await apiChat(messages, SCHEMA_OBJECTIVE_PLAN);
  var rawSteps = (result && Array.isArray(result.steps)) ? result.steps : [];
  var steps = [];
  for (var j = 0; j < rawSteps.length; j++) {
    var step = rawSteps[j];
    if (!step || typeof step !== 'object') continue;
    var userText = String(step.user_text || '').replace(/\n/g, ' ').trim();
    if (!userText) continue;
    var hiddenContext = String(step.hidden_context || '').replace(/\n/g, ' ').trim();
    var stepType = normalizeObjectiveStepType(step.step_type);
    var status = normalizeObjectiveStepStatus(step.status, stepType, false);
    var normalizedUser = userText.split(/\s+/).join(' ').trim();
    var normalizedHidden = hiddenContext.split(/\s+/).join(' ').trim();
    steps.push({
      user_text: normalizedUser,
      hidden_context: normalizedHidden,
      step_type: stepType,
      status: status,
      is_completed: status === 'completed'
    });
    if (steps.length >= 7) break;
  }
  if (steps.length < 2) {
    steps = [
      { user_text: 'Gather clues from involved NPCs.', hidden_context: '', step_type: 'loose', status: 'pending', is_completed: false },
      { user_text: 'Report completion and claim the reward.', hidden_context: '', step_type: 'required', status: 'pending', is_completed: false }
    ];
  }
  return {
    title: objectiveTitle,
    description: objectiveDescription,
    difficulty: objectiveDifficulty,
    steps: steps
  };
}

async function detectObjectiveStepCompletion(character, environment, inventory, action, response, history, storyLog) {
  if (!character || typeof character !== 'object') return [];
  var rawObjectives = Array.isArray(character.objectives) ? character.objectives : [];
  if (rawObjectives.length === 0) return [];

  var objectives = [];
  var shortObjectiveContext = [];
  var hasIncompleteSteps = false;

  for (var i = 0; i < rawObjectives.length; i++) {
    var obj = rawObjectives[i];
    if (!obj || typeof obj !== 'object') continue;
    var title = String(obj.title || '').trim();
    if (!title) continue;
    var description = String(obj.description || '').replace(/\n/g, ' ').split(/\s+/).slice(0, 10).join(' ').trim();
    var rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
    var normalizedSteps = [];
    var completedCount = 0;
    var resolvedCount = 0;
    for (var k = 0; k < rawSteps.length; k++) {
      var step = rawSteps[k];
      if (!step || typeof step !== 'object') continue;
      var userText = String(step.user_text || step.description || '').trim();
      if (!userText) continue;
      var stepType = normalizeObjectiveStepType(step.step_type);
      var status = normalizeObjectiveStepStatus(step.status, stepType, !!step.is_completed);
      var isCompleted = (status === 'completed');
      var isResolved = (status === 'completed' || status === 'passed');
      if (isCompleted) completedCount++;
      if (isResolved) resolvedCount++;
      if (!isResolved) hasIncompleteSteps = true;
      var normalizedStep = {};
      for (var key in step) { if (step.hasOwnProperty(key)) normalizedStep[key] = step[key]; }
      normalizedStep.user_text = userText;
      normalizedStep.step_type = stepType;
      normalizedStep.status = status;
      normalizedStep.is_completed = isCompleted;
      normalizedSteps.push(normalizedStep);
    }
    if (!normalizedSteps.length) continue;
    var objectiveCompleted = !!obj.is_completed || isObjectiveComplete(normalizedSteps);
    shortObjectiveContext.push({
      title: title,
      description: description,
      status: objectiveCompleted ? 'completed' : 'active',
      completed_steps: completedCount,
      resolved_steps: resolvedCount,
      total_steps: normalizedSteps.length
    });
    var normalizedObj = {};
    for (var key2 in obj) { if (obj.hasOwnProperty(key2)) normalizedObj[key2] = obj[key2]; }
    normalizedObj.title = title;
    normalizedObj.steps = normalizedSteps;
    objectives.push(normalizedObj);
  }

  if (!objectives.length || !hasIncompleteSteps) return objectives;

  var additionalContentDisclaimer = getMessage('story');
  var objectivesForPromptVal = objectivesForPrompt(objectives, false);
  var environmentContext = environmentForPrompt(environment, true);
  var storyLogContext = String(storyLog || '').trim();
  var normalizedHistory = normalizeActionHistory(history, 12, 6, 2);

  var messages = [];
  for (var m = 0; m < normalizedHistory.length; m++) {
    messages.push({ role: normalizedHistory[m].role, content: normalizedHistory[m].content });
  }
  messages.push({
    role: 'system',
    content: (
      'Task: Detect objective step completion from one RPG turn.\n' +
      'Return JSON only in this exact shape:\n' +
      '{"objective_updates":[{"title":"...","completed_steps":[1,2],"passed_steps":[3],"objective_completed":true/false}]}\n\n' +
      'Rules:\n' +
      '- Only mark steps completed if action + outcome clearly achieved them.\n' +
      '- Do not guess or force progress for vague partial attempts.\n' +
      '- completed_steps uses 1-based step indexes.\n' +
      '- passed_steps uses 1-based step indexes and is ONLY for optional steps that are no longer relevant or whose opportunity has passed.\n' +
      '- Never mark steps/objectives that are already completed as newly completed again.\n' +
      '- Do not include a step in both completed_steps and passed_steps.\n' +
      '- Include only objectives that changed this turn.\n' +
      '- If the final step of an objective is completed, mark every step and the objective as completed.\n' +
      '- Return {"objective_updates":[]} when nothing changed.\n' +
      additionalContentDisclaimer
    )
  });
  messages.push({
    role: 'user',
    content: (
      'All objectives short context (active + completed): ' + JSON.stringify(shortObjectiveContext) + '. ' +
      'Objectives with step detail: ' + JSON.stringify(objectivesForPromptVal) + '. ' +
      'Current environment: ' + JSON.stringify(environmentContext) + '. ' +
      'Player inventory: ' + JSON.stringify(inventory) + '. ' +
      'Action: ' + String(action || '') + '. ' +
      'Outcome: ' + String(response || '') + '. ' +
      'Story log: ' + (storyLogContext || '[none]') + '. ' +
      'Detect which objective steps were completed in this turn.'
    )
  });

  var result = await apiChat(messages, SCHEMA_OBJECTIVE_PROGRESS);
  var updatesIn = (result && Array.isArray(result.objective_updates)) ? result.objective_updates : [];

  var updatesMap = {};
  for (var u = 0; u < updatesIn.length; u++) {
    var upd = updatesIn[u];
    if (!upd || typeof upd !== 'object') continue;
    var updTitle = String(upd.title || '').trim();
    if (!updTitle) continue;
    var mapKey = updTitle.toLowerCase();
    var completedSteps = {};
    var passedSteps = {};
    var stepsRaw = Array.isArray(upd.completed_steps) ? upd.completed_steps : [];
    for (var ci = 0; ci < stepsRaw.length; ci++) {
      var idx = parseInt(stepsRaw[ci], 10);
      if (!isNaN(idx) && idx >= 1) completedSteps[idx] = true;
    }
    var passedRaw = Array.isArray(upd.passed_steps) ? upd.passed_steps : [];
    for (var pi = 0; pi < passedRaw.length; pi++) {
      var pidx = parseInt(passedRaw[pi], 10);
      if (!isNaN(pidx) && pidx >= 1 && !completedSteps[pidx]) passedSteps[pidx] = true;
    }
    var objCompleted = (upd.objective_completed != null) ? !!upd.objective_completed : null;
    updatesMap[mapKey] = { completed_steps: completedSteps, passed_steps: passedSteps, objective_completed: objCompleted };
  }

  if (!Object.keys(updatesMap).length) return objectives;

  var updatedObjectives = JSON.parse(JSON.stringify(objectives));
  for (var oi = 0; oi < updatedObjectives.length; oi++) {
    var uObj = updatedObjectives[oi];
    var uKey = String(uObj.title || '').trim().toLowerCase();
    if (!uKey || !updatesMap[uKey]) continue;
    var uUpd = updatesMap[uKey];
    var uSteps = Array.isArray(uObj.steps) ? uObj.steps : [];
    for (var si = 0; si < uSteps.length; si++) {
      var uStep = uSteps[si];
      if (!uStep || typeof uStep !== 'object') continue;
      var uStepType = normalizeObjectiveStepType(uStep.step_type);
      var oneBasedIdx = si + 1;
      if (uUpd.completed_steps[oneBasedIdx]) {
        uStep.status = 'completed';
        uStep.is_completed = true;
      } else if (uUpd.passed_steps[oneBasedIdx] && uStepType === 'optional') {
        uStep.status = 'passed';
        uStep.is_completed = false;
      } else {
        var uStatus = normalizeObjectiveStepStatus(uStep.status, uStepType, !!uStep.is_completed);
        uStep.status = uStatus;
        uStep.is_completed = (uStatus === 'completed');
      }
    }
    if (uUpd.objective_completed === true) {
      for (var fsi = 0; fsi < uSteps.length; fsi++) {
        var fStep = uSteps[fsi];
        if (!fStep || typeof fStep !== 'object') continue;
        var fType = normalizeObjectiveStepType(fStep.step_type);
        var fStatus = normalizeObjectiveStepStatus(fStep.status, fType, !!fStep.is_completed);
        if (fStatus === 'completed' || fStatus === 'passed') continue;
        if (fType === 'optional') {
          fStep.status = 'passed';
          fStep.is_completed = false;
        } else {
          fStep.status = 'completed';
          fStep.is_completed = true;
        }
      }
      uObj.is_completed = true;
    } else {
      uObj.is_completed = isObjectiveComplete(uSteps);
    }
  }
  return updatedObjectives;
}

async function consolidateStoryLog(storyLog) {
  var sourceLog = String(storyLog || '').trim();
  if (!sourceLog) return '';
  var words = sourceLog.match(/\S+/g) || [];
  var wordCount = words.length;
  if (wordCount <= 70) return sourceLog;

  var targetMinWords = Math.max(35, Math.min(140, Math.floor(wordCount * 0.28)));
  var targetMaxWords = Math.max(targetMinWords + 10, Math.min(220, Math.floor(wordCount * 0.45)));
  var additionalContentDisclaimer = getMessage('story');

  var messages = [
    {
      role: 'system',
      content: (
        'You compress RPG story logs.\n' +
        'Output must be faithful to provided facts only.\n' +
        'Use recency bias:\n' +
        '- Earliest events: highly compressed, short clauses.\n' +
        '- Middle events: concise.\n' +
        '- Most recent events: keep comparatively more detail.\n' +
        'Preserve key names, locations, unresolved quests/deals, major relationship changes, and major injuries/deaths.\n' +
        'Do not invent details.\n' +
        'Return only JSON in the schema.' +
        additionalContentDisclaimer
      )
    },
    {
      role: 'user',
      content: (
        'Condense this story log to about ' + targetMinWords + '-' + targetMaxWords + ' words.\n' +
        'Keep chronological order.\n' +
        'Story log:\n' +
        sourceLog
      )
    }
  ];

  try {
    var result = await apiChat(messages, SCHEMA_STORY_LOG);
    var condensed = (result && typeof result === 'object') ? String(result.consolidated_story_log || '').trim() : '';
    if (!condensed) return sourceLog;
    return condensed;
  } catch (e) {
    return sourceLog;
  }
}

async function generateSceneFocusOptions(character, environment, inventory, history, storyLog) {
  var fullSceneOption = 'No particular subject; Try to show the entire scene. ';
  character = character || {};
  environment = environment || {};
  inventory = inventory || [];
  var historyContext = formatSceneHistoryForPrompt(history, 6);
  var storyLogContext = String(storyLog || '').trim();
  if (storyLogContext.length > 900) {
    storyLogContext = storyLogContext.slice(-900);
  }

  var messages = [
    {
      role: 'system',
      content: (
        'You generate short scene focus options for an RPG image. Return concise visual focus targets the player could look at right now. Generate 5 distinct options. Each option should be a short phrase, 3-10 words, visually specific, and reference one concrete thing/area/person. Note on content policy: Options may NOT suggest directly pornographic imagery below the waist; Do not describe parts of characters that involve bare parts of the body below the waist. ' +
        'A few examples: "view through the grimy window towards (character)", "the scar on the left arm (character)", "the eerie glowing object on the table", "the shadowy figure lurking in the corner", "the intricate pattern on the floor". Ensure you don\'t actually just say "(character)" in the output, replace it with the actual name of the character if it\'s available in the context. Use artistic language.'
      )
    },
    {
      role: 'user',
      content: (
        'Below is the story context:\nPlayer: ' + (character.name || 'The player') + ' (' + (character.position || '') + '). ' +
        'Environment: location=' + (environment.location || '') + ', vibe=' + (environment.vibe || '') + ', ' +
        'time_of_day=' + (environment.time_of_day || '') + ', nearby_people=' + JSON.stringify(environment.people || []) + '. ' +
        'Inventory: ' + JSON.stringify(inventory) + '. ' +
        'Story summary: ' + storyLogContext + '. ' +
        'Recent turns: ' + historyContext + '. ' +
        ' ' +
        'Respond only in JSON as: {"options": ["...", "...", ...]}'
      )
    }
  ];

  var result = await apiChat(messages, SCHEMA_SCENE_FOCUS);
  var options = [];
  if (result && Array.isArray(result.options)) {
    for (var i = 0; i < result.options.length; i++) {
      var opt = String(result.options[i] || '').trim();
      if (opt) options.push(opt);
    }
  }
  if (!options.length) {
    options = [
      'closest person in front of me',
      'objects on the nearest surface',
      'the room entrance and nearby path',
      'lighting and shadows in this area',
      'the most suspicious detail nearby'
    ];
  }
  // Deduplicate and cap at 6
  var deduped = [];
  var seen = {};
  for (var j = 0; j < options.length; j++) {
    var key = options[j].toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(options[j]);
    if (deduped.length >= 6) break;
  }
  // Remove any entry matching fullSceneOption then prepend it
  deduped = deduped.filter(function(o) { return o.trim().toLowerCase() !== fullSceneOption.trim().toLowerCase(); });
  deduped.unshift(fullSceneOption);
  return { options: deduped };
}

async function generateSceneVisualDescription(character, environment, inventory, history, storyLog, focusPreference) {
  character = character || {};
  environment = environment || {};
  inventory = inventory || [];
  var historyContext = formatSceneHistoryForPrompt(history, 6);
  var storyLogContext = String(storyLog || '').trim();
  if (storyLogContext.length > 1600) {
    storyLogContext = storyLogContext.slice(-1600);
  }
  var focusContext = String(focusPreference || '').trim();

  var messages = [
    {
      role: 'system',
      content: (
        'You create image-generation prompts for RPG scenes. Write one concise visual description from the first-person viewpoint of the player character, based on the given visual focus preference and current scene context. Describe only what can be seen in the current moment. ' +
        'The image should be described as photo-realistic, dreamy, and artistic. You could also describe blurry, candid, or imperfect photos. Be specific with focal length, photographic style, lighting, and composition details. Output only one paragraph suitable as an image-generation prompt. It\'s important to state whether the image is taken indoor or outdoor and the time of day, and overall time period. Also, ensure the description notes that this image is of a fictional scenario. Clothing should be included if applicable. ' +
        'Ensure the image description describes the scene as if it were taken from the player\'s perspective (like its taken from a camera). Do not use first person pronouns like \'I\' or \'me\' or \'my\'. Instead, describe the scene as if you are narrating the contents of a photo taken from the player\'s perspective. You cannot use the name of the player or any characters (the image model doesn\'t have any story context, so it won\'t know who they are). Do not reference \'the player\'. ' +
        'Do not include descriptions of sounds or other sensory details that cannot be seen visually. Focus on visual details that would help create a compelling image prompt, such as lighting, composition, colors, and specific objects or people in the scene. Do not include any safety warnings or disclaimers in the description; Image descriptions may NOT suggest directly pornographic imagery below the waist; Do not describe parts of characters that involve bare parts of the body below the waist. Do not even mention body parts below the body EVER. You may indicate motion blur or other photographic effects if they would be present in a photo taken from the player\'s perspective. ' +
        'The framing can be \'close-up\', \'macro\', \'wide angle\', \'overhead shot\', or \'first-person view\'. It\'s extremely important that you make it clear in the prompt which framing this uses AND you should be using the closest framing possible based on the visual focus preference from the player. If the framing is very close, you may withold adding other details of the scene that would not be visible in that framing. For example: if the player has a strong visual focus preference on the eyes of a nearby person, the description should be a close-up of that person\'s eyes; Literally the entire frame should be of that persons eyes, the background shouldn\'t even be described. On the other hand, if the player has a visual focus preference on the overall scene, the description should be a wide angle shot that captures as much of the environment as possible. Character description should include age (above 18 only). Use simple, scientific, and widely conventional terms when describing the subject. '
      )
    },
    {
      role: 'user',
      content: (
        'Player character: ' + (character.name || 'The player') + ', role: ' + (character.position || '') + ', ' +
        'age: ' + (character.age || '') + ', gender: ' + (character.gender || '') + ', appearance: ' + (character.description || '') + '. ' +
        'Environment: location=' + (environment.location || '') + ', time_of_day=' + (environment.time_of_day || '') + ', ' +
        'temperature=' + (environment.temperature || '') + ', vibe=' + (environment.vibe || '') + '. ' +
        'Nearby people: ' + JSON.stringify(environment.people || []) + '. ' +
        'Inventory carried: ' + JSON.stringify(inventory) + '. ' +
        'Recent turn history: ' + historyContext + '. ' +
        getMessage('story') +
        'Visual focus preference from player: ' + focusContext + '. It\'s important you describe only what is within the player\'s visual focus preference and use the closest framing possible based on that preference. ' +
        'Generate the description now, ensuring you use the environment, context, and focus preference when writing the visual description. '
      )
    }
  ];

  var result = await apiChat(messages, SCHEMA_SCENE_VISUAL);
  if (result && typeof result === 'object' && result.description) {
    return String(result.description).trim();
  }
  return '';
}

async function generateSceneImage(character, environment, inventory, history, storyLog, focusPreference) {
  var description = await generateSceneVisualDescription(character, environment, inventory, history, storyLog, focusPreference);
  if (!description) throw new Error('generateSceneVisualDescription returned empty description');
  var imageResult;
  try {
    imageResult = await apiImage(description);
  } catch (e) {
    throw new Error('Scene image generation failed: ' + (e.message || 'unknown error'));
  }
  var dataUrl = imageResult.dataUrl || '';
  var revisedPrompt = imageResult.revisedPrompt || '';
  var settings = getSettings();
  return {
    id: crypto.randomUUID(),
    url: dataUrl,
    created_at: new Date().toISOString(),
    visual_description: description,
    image_model: settings.imageModel || '',
    revised_prompt: revisedPrompt,
    character_name: (character && character.name) ? character.name : ''
  };
}

function sanitizeObjectiveSteps(steps, includeHidden) {
  if (!Array.isArray(steps)) return [];
  var out = [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (!step || typeof step !== 'object') continue;
    var userText = String(step.user_text || step.description || '').trim();
    if (!userText) continue;
    var stepType = normalizeObjectiveStepType(step.step_type);
    var status = normalizeObjectiveStepStatus(
      step.status,
      stepType,
      !!step.is_completed
    );
    var cleanStep = {
      user_text: userText,
      step_type: stepType,
      status: status,
      is_completed: status === 'completed'
    };
    if (includeHidden) {
      var hiddenContext = String(step.hidden_context || '').trim();
      if (hiddenContext) {
        cleanStep.hidden_context = hiddenContext;
      }
    }
    out.push(cleanStep);
  }
  return out;
}

function sanitizeObjectives(objectives, includeHidden) {
  if (!Array.isArray(objectives)) return [];
  var out = [];
  for (var i = 0; i < objectives.length; i++) {
    var objective = objectives[i];
    if (!objective || typeof objective !== 'object') continue;
    var title = String(objective.title || '').trim();
    if (!title) continue;
    var cleanObj = {
      title: title,
      description: String(objective.description || '').trim(),
      is_completed: !!objective.is_completed,
      steps: sanitizeObjectiveSteps(objective.steps || [], includeHidden)
    };
    var difficulty = normalizeObjectiveDifficulty(objective.difficulty);
    if (difficulty !== null && difficulty !== undefined) {
      cleanObj.difficulty = difficulty;
    }
    out.push(cleanObj);
  }
  return out;
}

function sanitizePersonForModel(person, includeSecretNpcDetails) {
  if (!person || typeof person !== 'object') return {};
  var cleaned = Object.assign({}, person);
  var strKeys = ['name', 'short_description', 'gender', 'secret_npc_details'];
  for (var i = 0; i < strKeys.length; i++) {
    var k = strKeys[i];
    if (k in cleaned) {
      cleaned[k] = String(cleaned[k] || '').trim();
    }
  }
  if (includeSecretNpcDetails) {
    if (!cleaned.secret_npc_details) {
      delete cleaned.secret_npc_details;
    }
  } else {
    delete cleaned.secret_npc_details;
  }
  return cleaned;
}

function sanitizeEnvironmentForModel(environment, includeSecretNpcDetails) {
  if (!environment || typeof environment !== 'object') return {};
  var cleaned = Object.assign({}, environment);
  if (Array.isArray(environment.people)) {
    cleaned.people = environment.people
      .filter(function(p) { return p && typeof p === 'object'; })
      .map(function(p) { return sanitizePersonForModel(p, includeSecretNpcDetails); });
  }
  if (Array.isArray(environment._removed_people)) {
    cleaned._removed_people = environment._removed_people
      .filter(function(p) { return p && typeof p === 'object'; })
      .map(function(p) { return sanitizePersonForModel(p, includeSecretNpcDetails); });
  }
  return cleaned;
}

function sanitizeCharacterForModel(character, includeHiddenObjectiveData) {
  if (!character || typeof character !== 'object') return {};
  var cleaned = Object.assign({}, character);
  delete cleaned.scene_images;
  delete cleaned.latest_scene_image;
  if ('objectives' in cleaned) {
    cleaned.objectives = sanitizeObjectives(cleaned.objectives || [], includeHiddenObjectiveData);
  }
  return cleaned;
}

function ensureSecretNpcDetailsForSave(environment) {
  if (!environment || typeof environment !== 'object') return environment;
  var cleaned = Object.assign({}, environment);
  var keys = ['people', '_removed_people'];
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var entries = cleaned[key];
    if (!Array.isArray(entries)) continue;
    var nextEntries = [];
    for (var ei = 0; ei < entries.length; ei++) {
      var entry = entries[ei];
      if (!entry || typeof entry !== 'object') continue;
      var person = Object.assign({}, entry);
      person.secret_npc_details = String(person.secret_npc_details || '');
      nextEntries.push(person);
    }
    cleaned[key] = nextEntries;
  }
  return cleaned;
}

// Module-level map: character name → pending secretStoryDetail string
var _pendingSecretStoryDetail = {};

function _getSecretStoryDetail(characterName) {
  return _pendingSecretStoryDetail[String(characterName || '')] || '';
}
function _setSecretStoryDetail(characterName, value) {
  _pendingSecretStoryDetail[String(characterName || '')] = String(value || '');
}

async function applyActionChanges(character, environment, inventory, action, response, history, objectives, storyLog) {
  var charName = character && character.name ? character.name : '';
  var secretStoryDetail = _getSecretStoryDetail(charName);

  // 1. detectNeedsStateRegen
  var stateChanges = await detectNeedsStateRegen(character, environment, inventory, action, response, history, storyLog);

  // 2. Pull removed people from environment metadata
  var removedPeople = (environment && Array.isArray(environment._removed_people)) ? environment._removed_people : [];

  // 3. Run regenerateEnvironmentState + updateInventory in parallel (only if needed)
  var envPromise = stateChanges.environment
    ? regenerateEnvironmentState(character, environment, inventory, action, response, history, stateChanges.environment_justification, stateChanges.character_justification, removedPeople)
    : Promise.resolve(null);
  var invPromise = stateChanges.inventory
    ? updateInventory(character, environment, inventory, action, response)
    : Promise.resolve(null);

  var results = await Promise.all([envPromise, invPromise]);
  var envResult = results[0];  // { environment, characterPatch } or null
  var newInventory = results[1] || inventory;  // new inventory array or unchanged

  var newEnvironment = envResult ? envResult.environment : environment;
  var characterPatch = envResult ? envResult.characterPatch : {};

  // Apply characterPatch to character
  var newCharacter = Object.assign({}, character, characterPatch);

  // 4. Generate NPC inventories in parallel for needs_npc_inv
  var displayedInventories = [];
  if (Array.isArray(stateChanges.needs_npc_inv) && stateChanges.needs_npc_inv.length > 0) {
    var npcInvPromises = stateChanges.needs_npc_inv.map(function(npcName) {
      return getEntityInv({ name: npcName }, newEnvironment, history)
        .then(function(inv) { return inv; })
        .catch(function() { return null; });
    });
    var npcInvResults = await Promise.all(npcInvPromises);
    displayedInventories = npcInvResults.filter(Boolean);
  }

  // 5. Detect objective step completion
  var objectiveUpdates = null;
  if (Array.isArray(objectives) && objectives.length > 0) {
    objectiveUpdates = await detectObjectiveStepCompletion(newCharacter, newEnvironment, newInventory, action, response, history, storyLog)
      .catch(function() { return null; });
  }

  // 6. Store secret story detail for next turn (always overwrite to clear stale values)
  _setSecretStoryDetail(charName, stateChanges.secret_story_detail || '');

  return {
    character: newCharacter,
    environment: newEnvironment,
    inventory: newInventory,
    storyLogAddition: stateChanges.story_log_addition || '',
    optionalObjectives: stateChanges.optional_objectives || [],
    objectiveUpdates: objectiveUpdates,
    displayedInventories: displayedInventories,
    optionalNpcInv: stateChanges.optional_npc_inv || []
  };
}
