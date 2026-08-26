/**
 * src/v2/panels/factionIntelUtils.js
 *
 * Purpose: pure selectors, formatters and visibility rules for the faction
 *   dossier React panel — every read-from-snapshot decision, with no DOM.
 *
 * NULL DISCIPLINE — two predicates, deliberately NOT one.
 *
 *   `hasMetricValue` answers "is this a usable metric?" and therefore treats
 *   the sentinel strings 'UNAVAILABLE' / 'UNKNOWN' / 'N/A' / 'NA' / 'NULL' as
 *   missing. Twenty-odd metric call sites depend on that.
 *
 *   `isExplicitlyEmpty` answers a different question — "did the snapshot
 *   decline to state this at all?" — and is true only for null, undefined and
 *   a blank string. A declared 'UNAVAILABLE' is a statement, not an absence.
 *
 * Collapsing the two reopens live-defect #11: `'UNAVAILABLE'` is itself a
 * member of MISSING_VALUES, so guarding the explicit-declaration branch with
 * `hasMetricValue` made an explicit `earthVisibility: 'UNAVAILABLE'` fail the
 * guard, fall through to the data-inference branch, and render as EARTH
 * VISIBLE on a faction that had earth data — an explicit negative assertion
 * inverted into a positive one. Keep them separate.
 */

export const UNKNOWN_VALUE = 'UNAVAILABLE';
export const UNKNOWN_RELATIONSHIP = 'UNKNOWN';

export const MISSING_VALUES = {
  '': true,
  UNKNOWN: true,
  UNAVAILABLE: true,
  'N/A': true,
  NA: true,
  NULL: true,
};

const SKILL_NAMES = [
  'Administration',
  'Persuasion',
  'Investigation',
  'Espionage',
  'Command',
  'Science',
  'Security',
];

const SKILL_ABBREVIATIONS = {
  Administration: 'ADM',
  Persuasion: 'PER',
  Investigation: 'INV',
  Espionage: 'ESP',
  Command: 'CMD',
  Science: 'SCI',
  Security: 'SEC',
};

const VISIBILITY_LABELS = {
  raw_save_only: 'RAW SAVE ONLY',
  raw_save: 'RAW SAVE ONLY',
  unavailable: 'UNAVAILABLE',
  unknown: 'UNKNOWN',
  partial: 'PARTIAL',
  estimated: 'ESTIMATED',
  confirmed: 'CONFIRMED',
  visible: 'VISIBLE',
  available: 'AVAILABLE',
  enhanced: 'ENHANCED',
  snapshot_flag: 'SNAPSHOT FLAG',
};

const METRIC_VISIBILITY_KEYS = {
  earth: ['earthVisibility', 'terrestrialVisibility', 'politicalVisibility'],
  space: ['spaceVisibility'],
  research: ['researchVisibility', 'technologyVisibility'],
  power: ['powerVisibility'],
};

// ---------------------------------------------------------------------------
// Presence predicates and field reads
// ---------------------------------------------------------------------------

/** Is this a usable metric value? Sentinel labels count as missing. */
export function hasMetricValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return !MISSING_VALUES[value.trim().toUpperCase()];
  return true;
}

export function isMissingLabel(value) {
  return !hasMetricValue(value);
}

/**
 * Did the snapshot decline to state this at all? Only null / undefined /
 * blank string qualify — a declared sentinel is a statement, not an absence.
 * See the module header: this is the guard live-defect #11 turns on.
 */
export function isExplicitlyEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

export function sameId(left, right) {
  if (left === null || left === undefined || left === '') return false;
  if (right === null || right === undefined || right === '') return false;
  return String(left) === String(right);
}

export function readField(source, keys) {
  if (!source || typeof source !== 'object') return { found: false, value: null };
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      return { found: true, value: source[key] };
    }
  }
  return { found: false, value: null };
}

export function firstValue(source, keys) {
  const field = readField(source, keys);
  return field.found ? field.value : undefined;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function normalizeVisibility(value) {
  if (isExplicitlyEmpty(value)) return 'UNAVAILABLE';
  const raw = String(value).trim();
  const lower = raw.toLowerCase().replace(/[-\s]+/g, '_');
  return VISIBILITY_LABELS[lower] || raw.toUpperCase();
}

export function formatCount(value) {
  if (!hasMetricValue(value)) return UNKNOWN_VALUE;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatGdp(value) {
  if (!hasMetricValue(value)) return UNKNOWN_VALUE;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `$${(number / 1000000000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}T`;
}

export function formatPopulation(value) {
  if (!hasMetricValue(value)) return UNKNOWN_VALUE;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatResearch(value) {
  if (!hasMetricValue(value)) return UNKNOWN_VALUE;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })} / cycle`;
}

export function formatHate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  return String(value);
}

export function metricValue(value, formatter, suffix) {
  if (!hasMetricValue(value)) return UNKNOWN_VALUE;
  let result = formatter ? formatter(value) : String(value);
  if (suffix && result !== UNKNOWN_VALUE) result += ` ${suffix}`;
  return result;
}

export function metricText(value) {
  return hasMetricValue(value) ? String(value) : UNKNOWN_VALUE;
}

export function metricScore(value) {
  return hasMetricValue(value) ? `${formatCount(value)} / 100` : UNKNOWN_VALUE;
}

/** A hex accent supplied by the save, or null when the colour is unusable. */
export function accentColor(color) {
  if (typeof color !== 'string') return null;
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : null;
}

export function factionLogoHtml(faction, className) {
  const shared = typeof window !== 'undefined' ? window.MissionControlShared : null;
  if (shared && typeof shared.factionLogoImgHtml === 'function' && faction) {
    return shared.factionLogoImgHtml(faction, { className });
  }
  return '';
}

// ---------------------------------------------------------------------------
// Faction identity
// ---------------------------------------------------------------------------

export function getFactionId(faction) {
  if (!faction || typeof faction !== 'object') return null;
  const field = readField(faction, ['ID', 'id', 'factionId']);
  return field.found ? field.value : null;
}

export function getFactionName(faction) {
  if (!faction || typeof faction !== 'object') return UNKNOWN_RELATIONSHIP;
  const field = readField(faction, ['displayName', 'name', 'factionName', 'templateName']);
  return field.found && hasMetricValue(field.value) ? String(field.value) : UNKNOWN_RELATIONSHIP;
}

export function findFaction(factions, id) {
  return factions.find((faction) => sameId(getFactionId(faction), id)) || null;
}

/**
 * A stable per-row key. An unresolvable identity becomes an index-scoped key,
 * never the string 'undefined' — this repo has twice lost records to a
 * template literal collapsing an absent id into a colliding dedupe key.
 */
export function getEntryKey(faction, index) {
  const id = getFactionId(faction);
  return id === null || id === undefined || id === '' ? `index-${index}` : String(id);
}

export function chooseInitialKey(factions, observerId) {
  const observerIndex = factions.findIndex((faction) => sameId(getFactionId(faction), observerId));
  if (observerIndex >= 0) return getEntryKey(factions[observerIndex], observerIndex);
  return factions.length ? getEntryKey(factions[0], 0) : null;
}

// ---------------------------------------------------------------------------
// Snapshot context
// ---------------------------------------------------------------------------

export function unwrapSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  if (snapshot.data && typeof snapshot.data === 'object' && Array.isArray(snapshot.data.factions)) {
    return snapshot.data;
  }
  return snapshot;
}

export function resolveObserverId(data, briefing, suppliedId) {
  if (suppliedId !== undefined && suppliedId !== null && suppliedId !== '') return suppliedId;
  if (data.observerFactionId !== undefined && data.observerFactionId !== null) {
    return data.observerFactionId;
  }
  if (briefing && briefing.observerFactionId !== undefined) return briefing.observerFactionId;
  if (briefing && briefing.observerId !== undefined) return briefing.observerId;
  return null;
}

export function resolvePriorityKey(data, factions) {
  const priority = data.priorityTargetFaction;
  if (!priority) return null;
  const priorityId = typeof priority === 'object'
    ? firstValue(priority, ['id', 'ID', 'factionId'])
    : priority;
  if (priorityId !== undefined && priorityId !== null && priorityId !== '') {
    const byId = factions.findIndex((faction) => sameId(getFactionId(faction), priorityId));
    if (byId >= 0) return getEntryKey(factions[byId], byId);
  }
  const priorityName = typeof priority === 'object'
    ? firstValue(priority, ['name', 'displayName', 'factionName'])
    : priority;
  if (priorityName) {
    const byName = factions.findIndex((faction) => getFactionName(faction) === String(priorityName));
    if (byName >= 0) return getEntryKey(factions[byName], byName);
  }
  return null;
}

export function getMode(data) {
  const raw = data.mode || data.intelMode || data.visibility;
  const lower = String(raw || '').toLowerCase();
  if (data.isOmniscient === true || lower === 'omniscient') return 'OMNISCIENT';
  if (lower === 'enhanced') return 'ENHANCED';
  if (lower === 'player' || lower === 'player intel') return 'PLAYER INTEL';
  return raw ? normalizeVisibility(raw) : 'UNKNOWN VIEW';
}

/** The read-once context every selector below is evaluated against. */
export function buildContext(snapshot, briefing, observerId) {
  const data = unwrapSnapshot(snapshot);
  const factions = Array.isArray(data.factions) ? data.factions : [];
  const resolvedObserverId = resolveObserverId(data, briefing, observerId);
  return {
    data,
    briefing: briefing || null,
    factions,
    observerId: resolvedObserverId,
    observer: findFaction(factions, resolvedObserverId),
    mode: getMode(data),
    priorityKey: resolvePriorityKey(data, factions),
  };
}

export function headerCycleDate(context) {
  const metadata = context.data.metadata;
  const date = metadata && (metadata.gameTimeString || metadata.lastModified);
  if (date) return date;
  if (context.briefing) return context.briefing.campaignDate;
  return null;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

export function getPowerValue(faction) {
  const direct = readField(faction, ['powerScore']);
  if (direct.found && typeof direct.value === 'number' && Number.isFinite(direct.value)) {
    return direct.value;
  }
  if (direct.found && direct.value && typeof direct.value === 'object') {
    const overall = readField(direct.value, ['overall']);
    if (overall.found && typeof overall.value === 'number' && Number.isFinite(overall.value)) {
      return overall.value;
    }
  }
  const fallback = readField(faction, ['overallPower', 'power']);
  return fallback.found && typeof fallback.value === 'number' && Number.isFinite(fallback.value)
    ? fallback.value
    : null;
}

export function getPowerComponents(faction) {
  const source = faction && faction.powerScore && typeof faction.powerScore === 'object'
    ? faction.powerScore
    : faction;
  return {
    earthEconomy: readField(source, ['earthEconomy', 'earthEconomyScore']),
    earthPolitics: readField(source, ['earthPolitics', 'earthPoliticsScore']),
    research: readField(source, ['research', 'researchPower', 'researchScore']),
    spaceEconomy: readField(source, ['spaceEconomy', 'spaceEconomyScore']),
    fleet: readField(source, ['fleet', 'fleetPower', 'fleetScore']),
    military: readField(source, ['military', 'militaryPower', 'militaryScore']),
  };
}

export function isPowerEstimate(faction) {
  return Boolean(
    faction
      && faction.powerScore
      && typeof faction.powerScore === 'object'
      && faction.powerScore.isEstimate === true,
  );
}

export function formatPower(faction) {
  const value = getPowerValue(faction);
  return value === null ? UNKNOWN_VALUE : `${formatCount(value)}/100`;
}

export function powerMetrics(faction) {
  const power = getPowerValue(faction);
  const components = getPowerComponents(faction);
  return [
    {
      label: 'Composite score estimate',
      value: metricValue(power, (value) => `${formatCount(value)} / 100`),
    },
    { label: 'Military score', value: metricScore(components.military.value) },
    // An absent power score cannot answer "is this an estimate?" — it reports
    // UNAVAILABLE rather than defaulting to a confident NO.
    { label: 'Estimated', value: isPowerEstimate(faction) ? 'YES' : (power === null ? UNKNOWN_VALUE : 'NO') },
  ];
}

export function visibilityForPower(context, faction) {
  const power = getPowerValue(faction);
  const explicit = readField(faction, ['powerVisibility', 'visibility']);
  if (explicit.found && !isExplicitlyEmpty(explicit.value)) return normalizeVisibility(explicit.value);
  return visibilityForMetric(context, faction, 'power', power !== null);
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Distinguish "field absent or blank" (fall back to data inference) from
 * "field explicitly declared, including to an UNAVAILABLE / UNKNOWN sentinel"
 * (respect the declaration). `hasMetricValue` here would collapse both into
 * the same branch — live-defect #11. See the module header.
 */
export function visibilityForMetric(context, faction, metricName, hasData) {
  const keys = METRIC_VISIBILITY_KEYS[metricName] || [];
  const explicit = readField(faction, keys);
  if (explicit.found && !isExplicitlyEmpty(explicit.value)) return normalizeVisibility(explicit.value);
  if (!hasData) return 'UNAVAILABLE';
  if (context.mode === 'OMNISCIENT') return 'RAW SAVE ONLY';
  if (context.mode === 'ENHANCED') return 'ENHANCED';
  return 'VISIBLE';
}

// ---------------------------------------------------------------------------
// Metric groups
// ---------------------------------------------------------------------------

export function readProjectCount(faction, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const result = readField(faction, [keys[index]]);
    if (!result.found) continue;
    if (Array.isArray(result.value)) return { found: true, value: result.value.length };
    return result;
  }
  return { found: false, value: null };
}

export function countVisibleAssets(items, factionId) {
  if (!Array.isArray(items) || factionId === null || factionId === undefined) {
    return { found: false, value: null };
  }
  return {
    found: true,
    value: items.filter((item) => sameId(getFactionId(item), factionId)).length,
    visibleOnly: true,
  };
}

export function countVisibleShips(items, factionId) {
  if (!Array.isArray(items) || factionId === null || factionId === undefined) {
    return { found: false, value: null };
  }
  let total = 0;
  let matched = false;
  items.forEach((item) => {
    if (!sameId(getFactionId(item), factionId)) return;
    matched = true;
    const count = readField(item, ['shipsCount', 'shipCount']);
    if (count.found && typeof count.value === 'number' && Number.isFinite(count.value)) {
      total += count.value;
    }
  });
  return { found: matched, value: matched ? total : null, visibleOnly: true };
}

export function getCombatPower(faction) {
  const available = readField(faction, ['combatPowerAvailable']);
  const power = readField(faction, ['combatPower', 'fleetCombatPower']);
  if (available.found && available.value === false) return { found: false, value: null };
  if (power.found && hasMetricValue(power.value)) return power;
  return { found: false, value: null };
}

export function getEarthMetrics(context, faction) {
  const controlPoints = readField(faction, ['controlPointsCount', 'controlPointCount', 'controlPoints']);
  const nations = readField(faction, ['nationsCount', 'nationCount', 'nations']);
  const gdp = readField(faction, ['totalGdp', 'gdp', 'GDP']);
  const population = readField(faction, ['totalPopulation', 'population']);
  const power = getPowerComponents(faction);
  const hasData = controlPoints.found
    || nations.found
    || gdp.found
    || population.found
    || power.earthEconomy.found
    || power.earthPolitics.found;

  return {
    controlPoints: metricValue(controlPoints.value, formatCount),
    nations: metricValue(nations.value, formatCount),
    gdp: metricValue(gdp.value, formatGdp),
    population: metricValue(population.value, formatPopulation),
    metrics: [
      { label: 'Control points', value: metricValue(controlPoints.value, formatCount) },
      { label: 'Nations', value: metricValue(nations.value, formatCount) },
      { label: 'GDP', value: metricValue(gdp.value, formatGdp) },
      { label: 'Population', value: metricValue(population.value, formatPopulation) },
      { label: 'Economy score', value: metricScore(power.earthEconomy.value) },
      { label: 'Politics score', value: metricScore(power.earthPolitics.value) },
    ],
    visibility: visibilityForMetric(context, faction, 'earth', hasData),
  };
}

export function getSpaceMetrics(context, faction) {
  let habs = readField(faction, ['habsCount', 'habCount']);
  let fleets = readField(faction, ['fleetsCount', 'fleetCount']);
  let ships = readField(faction, ['shipsCount', 'shipCount']);
  const combatPower = getCombatPower(faction);
  const factionId = getFactionId(faction);
  const fallbackHabs = !habs.found ? countVisibleAssets(context.data.habs, factionId) : { found: false };
  const fallbackFleets = !fleets.found ? countVisibleAssets(context.data.fleets, factionId) : { found: false };
  const fallbackShips = !ships.found ? countVisibleShips(context.data.fleets, factionId) : { found: false };

  if (!habs.found && fallbackHabs.found) habs = fallbackHabs;
  if (!fleets.found && fallbackFleets.found) fleets = fallbackFleets;
  if (!ships.found && fallbackShips.found) ships = fallbackShips;

  const power = getPowerComponents(faction);
  const hasData = habs.found
    || fleets.found
    || ships.found
    || combatPower.found
    || power.spaceEconomy.found
    || power.fleet.found;
  const visibility = visibilityForMetric(context, faction, 'space', hasData);
  const countSuffix = visibility === 'PARTIAL' ? ' visible' : '';
  const withSuffix = (value) => formatCount(value) + countSuffix;

  return {
    habs: metricValue(habs.value, withSuffix),
    fleets: metricValue(fleets.value, withSuffix),
    ships: metricValue(ships.value, withSuffix),
    combatPower: { value: metricValue(combatPower.value, formatCount), found: combatPower.found },
    metrics: [
      { label: 'Habs / stations', value: metricValue(habs.value, withSuffix) },
      { label: 'Fleets', value: metricValue(fleets.value, withSuffix) },
      { label: 'Ships', value: metricValue(ships.value, withSuffix) },
      { label: 'Combat power', value: metricValue(combatPower.value, formatCount) },
      { label: 'Space score', value: metricScore(power.spaceEconomy.value) },
      { label: 'Fleet score', value: metricScore(power.fleet.value) },
    ],
    visibility,
  };
}

export function getResearchMetrics(context, faction) {
  const output = readField(faction, ['totalResearch', 'monthlyResearch', 'researchOutput']);
  const completed = readProjectCount(faction, ['completedProjectsCount', 'completedProjects']);
  const current = readProjectCount(faction, ['currentProjectsCount', 'currentProjects']);
  const available = readField(faction, ['availableProjectsCount']);
  const hasData = output.found || completed.found || current.found || available.found;

  return {
    output: output.value,
    metrics: [
      { label: 'Research output', value: metricValue(output.value, formatResearch) },
      { label: 'Projects listed', value: metricValue(completed.value, formatCount, 'listed') },
      { label: 'Active projects listed', value: metricValue(current.value, formatCount, 'listed') },
      { label: 'Available projects', value: metricValue(available.value, formatCount) },
      { label: 'Research score', value: metricScore(getPowerComponents(faction).research.value) },
    ],
    visibility: visibilityForMetric(context, faction, 'research', hasData),
  };
}

// ---------------------------------------------------------------------------
// Alien hate
// ---------------------------------------------------------------------------

export function getAlienHate(context, faction) {
  const hate = faction && faction.alienHate;
  const modeAllowsRaw = context.mode === 'OMNISCIENT' || context.mode === 'ENHANCED';

  if (hate && typeof hate === 'object') {
    const visibility = hate.visibility || (hate.playerVisible ? 'visible' : 'unavailable');
    const actual = readField(hate, ['actual', 'value']);
    const visible = readField(hate, ['visibleEstimate', 'estimate', 'display']);
    let value = null;

    if (actual.found && hasMetricValue(actual.value) && (modeAllowsRaw || hate.playerVisible === true)) {
      value = formatHate(actual.value);
    } else if (visible.found && !isMissingLabel(visible.value)) {
      value = String(visible.value);
    }

    return {
      value: value === null ? UNKNOWN_VALUE : value,
      visibility: value === null ? 'unavailable' : visibility,
      requiredProject: hate.requiredProject || null,
      note: value === null && hate.requiredProject ? `Required project: ${hate.requiredProject}.` : null,
    };
  }

  if (modeAllowsRaw) {
    const raw = readField(faction, ['assessedAlienHateOfMe', 'alienHateValue']);
    if (raw.found && hasMetricValue(raw.value)) {
      return {
        value: formatHate(raw.value),
        visibility: 'raw_save_only',
        requiredProject: null,
        note: null,
      };
    }
  }

  return { value: UNKNOWN_VALUE, visibility: 'unavailable', requiredProject: null, note: null };
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export function unwrapRelationshipValue(value) {
  if (!value || typeof value !== 'object') return value;
  return firstValue(value, ['relationship', 'relation', 'status', 'attitude', 'stance', 'label', 'name', 'value']);
}

export function displayRelationship(value) {
  if (value === null || value === undefined) return UNKNOWN_RELATIONSHIP;
  if (typeof value === 'number' && Number.isFinite(value)) return formatCount(value);
  return String(value);
}

export function relationshipMatches(relation, observerId, factionId) {
  if (!relation || typeof relation !== 'object') return false;
  const from = firstValue(relation, ['observerFactionId', 'observerId', 'fromFactionId', 'fromId', 'sourceFactionId']);
  const to = firstValue(relation, ['targetFactionId', 'targetId', 'toFactionId', 'toId', 'factionId']);
  return sameId(from, observerId) && sameId(to, factionId);
}

export function findDirectionalRelationship(data, sourceId, targetId) {
  const sources = [data.relationships, data.factionRelationships, data.diplomacy];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    if (Array.isArray(source)) {
      for (let relationIndex = 0; relationIndex < source.length; relationIndex += 1) {
        const candidate = source[relationIndex];
        if (relationshipMatches(candidate, sourceId, targetId)) {
          return {
            found: true,
            value: unwrapRelationshipValue(candidate),
            visibility: candidate && candidate.visibility,
          };
        }
      }
    } else if (source && typeof source === 'object') {
      const bySource = source[String(sourceId)];
      const byTarget = source[String(targetId)];
      let value;
      if (bySource && typeof bySource === 'object' && bySource[String(targetId)] !== undefined) {
        value = bySource[String(targetId)];
      } else if (byTarget && typeof byTarget === 'object' && byTarget[String(sourceId)] !== undefined) {
        value = byTarget[String(sourceId)];
      }
      if (value !== undefined) {
        return {
          found: true,
          value: unwrapRelationshipValue(value),
          visibility: value && typeof value === 'object' ? value.visibility : null,
        };
      }
    }
  }

  return { found: false, value: null, visibility: null };
}

export function findExplicitRelationship(data, observerId, factionId, faction) {
  const direct = readField(faction, [
    'relationshipToObserver',
    'observerRelationship',
    'relationship',
    'relation',
    'diplomaticStatus',
    'attitude',
    'stance',
  ]);
  if (direct.found) {
    return {
      found: true,
      value: unwrapRelationshipValue(direct.value),
      visibility: direct.value && typeof direct.value === 'object' ? direct.value.visibility : null,
    };
  }

  const directional = findDirectionalRelationship(data, observerId, factionId);
  if (directional.found) return directional;

  return { found: false, value: null, visibility: null };
}

export function directionalRelationshipValue(value, direction) {
  const rendered = displayRelationship(value);
  const hateMatch = /^HATE\s+(.+)$/i.exec(rendered);
  if (hateMatch) {
    return direction === 'HATE OF US'
      ? `${direction} ${hateMatch[1]}`
      : `${direction} HATE ${hateMatch[1]}`;
  }
  return `${direction} ${rendered}`;
}

export function cleanRelationshipValue(value) {
  if (!hasMetricValue(value)) return UNKNOWN_VALUE;
  const text = String(value).trim();
  const cleaned = text.replace(/^(?:HATE\s+OF\s+US|OUR\s+HATE|HATE)\s*/i, '').trim();
  return hasMetricValue(cleaned) ? cleaned : UNKNOWN_VALUE;
}

export function summarizeRelationship(theirs, ours) {
  const parts = [];
  const cleanTheirs = cleanRelationshipValue(theirs);
  const cleanOurs = cleanRelationshipValue(ours);
  if (cleanTheirs !== UNKNOWN_VALUE) parts.push(`Hate of us ${cleanTheirs}`);
  if (cleanOurs !== UNKNOWN_VALUE) parts.push(`Our hate ${cleanOurs}`);
  return parts.join(' · ') || UNKNOWN_RELATIONSHIP;
}

export function getRelationship(context, faction) {
  if (sameId(getFactionId(faction), context.observerId)) {
    return {
      value: 'OBSERVER',
      visibility: 'confirmed',
      explicit: true,
      ours: null,
      theirs: null,
      oursVisibility: 'confirmed',
      theirsVisibility: 'unavailable',
    };
  }

  const factionId = getFactionId(faction);
  const relation = findExplicitRelationship(context.data, context.observerId, factionId, faction);
  const inverse = findDirectionalRelationship(context.data, factionId, context.observerId);
  const ours = relation.found && hasMetricValue(relation.value)
    ? directionalRelationshipValue(relation.value, 'OUR')
    : null;
  const theirs = inverse.found && hasMetricValue(inverse.value)
    ? directionalRelationshipValue(inverse.value, 'HATE OF US')
    : null;

  if (ours || theirs) {
    return {
      value: summarizeRelationship(theirs, ours),
      visibility: inverse.visibility || relation.visibility || 'confirmed',
      explicit: true,
      ours,
      theirs,
      oursVisibility: relation.visibility || 'unavailable',
      theirsVisibility: inverse.visibility || 'unavailable',
    };
  }

  const key = getEntryKey(faction, context.factions.indexOf(faction));
  if (context.priorityKey && context.priorityKey === key) {
    return {
      value: 'PRIORITY TARGET',
      visibility: 'snapshot flag',
      explicit: true,
      ours: null,
      theirs: null,
      oursVisibility: 'unavailable',
      theirsVisibility: 'unavailable',
    };
  }

  return {
    value: UNKNOWN_RELATIONSHIP,
    visibility: 'unavailable',
    explicit: false,
    ours: null,
    theirs: null,
    oursVisibility: 'unavailable',
    theirsVisibility: 'unavailable',
  };
}

export function relationshipMetrics(relationship) {
  const theirs = cleanRelationshipValue(relationship.theirs);
  const ours = cleanRelationshipValue(relationship.ours);
  const directionCount = [theirs, ours].filter((value) => value !== UNKNOWN_VALUE).length;
  let summary;
  if (directionCount === 2) summary = 'BOTH DIRECTIONS RECORDED';
  else if (directionCount === 1) summary = 'ONE DIRECTION RECORDED';
  else summary = relationship.value || UNKNOWN_RELATIONSHIP;

  return [
    { label: 'Hate of us', value: theirs },
    { label: 'Our hate', value: ours },
    {
      label: 'Summary',
      value: summary,
      note: directionCount ? 'Directional hate values shown above.' : null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Councilors
// ---------------------------------------------------------------------------

export function getFactionCouncilors(context, faction) {
  const factionId = getFactionId(faction);
  if (factionId === null || factionId === undefined) return [];
  const councilors = Array.isArray(context.data.councilors) ? context.data.councilors : [];
  return councilors
    .filter((councilor) => {
      if (councilor.isActiveCouncilor === false || councilor.isIndependent === true) return false;
      if (String(councilor.status || 'Active').toLowerCase() !== 'active') return false;
      return sameId(councilor.factionId, factionId);
    })
    .sort((a, b) => {
      const aSkills = Number(a.totalSkills);
      const bSkills = Number(b.totalSkills);
      if (Number.isFinite(aSkills) && Number.isFinite(bSkills) && aSkills !== bSkills) {
        return bSkills - aSkills;
      }
      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    });
}

export function councilorVisibility(context, faction, councilors) {
  if (context.mode === 'OMNISCIENT') return 'RAW SAVE ONLY';
  if (sameId(getFactionId(faction), context.observerId)) return 'CONFIRMED';
  if (councilors.some((councilor) => councilor.visibility === 'detected')) return 'PARTIAL';
  if (councilors.some((councilor) => councilor.isTurnedMole === true)) return 'CONFIRMED';
  return councilors.length ? 'VISIBLE' : 'UNAVAILABLE';
}

/**
 * Observed enemies carry `maskedAttributes`; the observer's own councilors
 * carry `attributes`. Reading only one of the two silently empties a whole
 * axis in the other intelligence mode.
 */
export function councilorTopSkill(councilor) {
  const source = councilor && councilor.maskedAttributes && typeof councilor.maskedAttributes === 'object'
    ? councilor.maskedAttributes
    : councilor && councilor.attributes;
  let bestName = null;
  let bestValue = null;

  if (source && typeof source === 'object') {
    Object.keys(source).forEach((name) => {
      const entry = source[name];
      const value = entry && typeof entry === 'object' ? entry.visible : entry;
      if (!SKILL_NAMES.includes(name)) return;
      if (value === null || value === undefined || value === '') return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      if (bestValue === null || numeric > bestValue) {
        bestName = name;
        bestValue = numeric;
      }
    });
  }

  if (bestName === null) return `SKILL / ${UNKNOWN_VALUE}`;
  const prefix = SKILL_ABBREVIATIONS[bestName] || bestName;
  return `SKILL / ${prefix} ${formatCount(bestValue)}`;
}

/** The four visible strings of one councilor row, each with its own fallback. */
export function councilorRowFields(councilor) {
  const target = firstValue(councilor, ['activeMissionTarget', 'missionTarget']);
  const mission = firstValue(councilor, ['activeMissionName', 'missionName', 'assignment']) || 'No active mission';
  return {
    name: firstValue(councilor, ['displayName', 'name', 'personalName']) || UNKNOWN_VALUE,
    profession: firstValue(councilor, ['typeTemplateName', 'profession', 'type']) || 'Councilor',
    location: firstValue(councilor, ['locationName', 'location', 'regionName']) || UNKNOWN_VALUE,
    mission: `MISSION / ${String(mission)}${target ? ` → ${String(target)}` : ''}`,
    skill: councilorTopSkill(councilor),
    status: normalizeVisibility(councilor.visibility || councilor.investigationConfidence || 'unknown'),
  };
}

// ---------------------------------------------------------------------------
// Plan of action
// ---------------------------------------------------------------------------

export function firstActiveProject(faction) {
  const projects = faction && Array.isArray(faction.currentProjects) ? faction.currentProjects : [];
  const project = projects.find((candidate) => {
    const percent = firstValue(candidate, ['percent', 'progress']);
    return percent === undefined || Number(percent) < 100;
  });
  if (!project) return null;
  const name = firstValue(project, ['displayName', 'name', 'projectId', 'id']);
  const progress = firstValue(project, ['percent', 'progress']);
  return {
    name: name ? String(name) : 'the listed project',
    progress: progress === undefined || progress === null ? 'progress unknown' : `${String(progress)}%`,
  };
}

export function deriveActions(context, faction, intel) {
  const actions = [];
  const isObserver = sameId(getFactionId(faction), context.observerId);
  const factionName = getFactionName(faction);

  if (isObserver) {
    const activeProject = firstActiveProject(faction);
    if (activeProject) {
      actions.push(`Keep ${activeProject.name} moving; the listed research progress is ${activeProject.progress}.`);
    } else if (hasMetricValue(intel.research.output)) {
      actions.push(`Protect the current research throughput of ${formatResearch(intel.research.output)}.`);
    } else {
      actions.push('Reacquire research telemetry before setting a project priority.');
    }

    if (hasMetricValue(intel.earth.controlPoints) || hasMetricValue(intel.earth.nations)) {
      actions.push(`Consolidate the visible terrestrial footprint: ${metricText(intel.earth.controlPoints)} control points across ${metricText(intel.earth.nations)} nations.`);
    } else {
      actions.push('Reacquire terrestrial control data before changing the faction posture.');
    }

    if (intel.space.visibility === 'UNAVAILABLE') {
      actions.push('Restore orbital telemetry before committing to a space posture.');
    } else if (intel.space.combatPower.value === UNKNOWN_VALUE) {
      actions.push('Confirm fleet combat telemetry before committing the visible orbital assets.');
    } else {
      actions.push(`Maintain the visible orbital posture of ${metricText(intel.space.habs)} habs and ${metricText(intel.space.ships)} ships.`);
    }
  } else {
    if (intel.relationship.value === UNKNOWN_RELATIONSHIP) {
      actions.push('Keep the diplomatic posture open; no observer-relative relationship is present in this snapshot.');
    } else {
      actions.push(`Use the recorded relationship posture — ${intel.relationship.value} — when assigning surveillance priority.`);
    }

    if (context.priorityKey && context.priorityKey === getEntryKey(faction, context.factions.indexOf(faction))) {
      actions.push(`Keep ${factionName} on the priority watchlist; the snapshot flags it as the current priority target.`);
    } else if (hasMetricValue(intel.earth.controlPoints) || hasMetricValue(intel.earth.nations)) {
      actions.push(`Track ${factionName}'s terrestrial footprint at ${metricText(intel.earth.controlPoints)} control points across ${metricText(intel.earth.nations)} nations.`);
    } else {
      actions.push('Maintain surveillance until terrestrial holdings are visible in a later snapshot.');
    }

    if (intel.space.visibility === 'UNAVAILABLE') {
      actions.push(`Develop orbital intelligence before estimating ${factionName}'s total space strength.`);
    } else if (intel.space.visibility === 'PARTIAL') {
      actions.push('Treat the orbital counts as visible assets only; total space strength remains unknown.');
    } else {
      actions.push('Compare the confirmed orbital posture against the next save before changing priorities.');
    }
  }

  if (intel.hate.value === UNKNOWN_VALUE) {
    if (intel.hate.requiredProject) {
      actions.push(`Advance ${intel.hate.requiredProject} only if an alien-hate estimate is needed; the current value is unavailable.`);
    } else {
      actions.push('Treat alien-hate posture as unknown until a visible estimate is supplied.');
    }
  } else {
    actions.push(`Track the visible alien-hate signal (${intel.hate.value}; ${normalizeVisibility(intel.hate.visibility)}).`);
  }

  return actions.slice(0, 4);
}

/** Every derived block one selected faction needs, read once. */
export function buildFactionIntel(context, faction) {
  return {
    relationship: getRelationship(context, faction),
    hate: getAlienHate(context, faction),
    earth: getEarthMetrics(context, faction),
    space: getSpaceMetrics(context, faction),
    research: getResearchMetrics(context, faction),
  };
}
