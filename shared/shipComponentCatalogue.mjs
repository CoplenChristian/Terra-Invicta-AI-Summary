// shared/shipComponentCatalogue.mjs
//
// Purpose: normalize the seven ship-designer component families, join each
//   row to its unlock project, and resolve player versus omniscient buildability.

// This module deliberately reads only a snapshot. The template directory is
// available while a snapshot is built, but not to the hosted worker (or to a
// future page consuming this read model). `server/snapshot/templates.js`
// already bakes the component stats and `snapshot.unlockIndex` already carries
// the authoritative item -> research-gate relation in the other direction.

import { asArray, sameId } from './util.mjs';
import {
  buildItemGateMap,
  unlockIndexUnavailableReason
} from './unlockIndex.mjs';
import { DEFAULT_OBSERVER_FACTION_ID } from './constants.mjs';

export const SHIP_COMPONENT_FAMILIES = Object.freeze([
  Object.freeze({ outputFamily: 'drives', unlockFamily: 'drive', sourceKey: 'driveStats', drive: true }),
  Object.freeze({ outputFamily: 'reactors', unlockFamily: 'power_plant', sourceKey: 'power_plant' }),
  Object.freeze({ outputFamily: 'radiators', unlockFamily: 'radiator', sourceKey: 'radiator' }),
  Object.freeze({ outputFamily: 'hulls', unlockFamily: 'ship_hull', sourceKey: 'ship_hull' }),
  Object.freeze({ outputFamily: 'utilityModules', unlockFamily: 'utility_module', sourceKey: 'utility_module' }),
  Object.freeze({ outputFamily: 'armour', unlockFamily: 'ship_armor', sourceKey: 'ship_armor' }),
  Object.freeze({ outputFamily: 'batteries', unlockFamily: 'battery', sourceKey: 'battery' })
]);

export const DRIVE_THRUSTER_COUNTS = Object.freeze([1, 2, 3, 4, 5, 6]);

const DRIVE_LADDER_FIELDS = Object.freeze([
  'thrust_N',
  'reqPowerGW',
  'thrustRatingGW'
]);

// `req power` and `thrustRating_GW` are written by the game as strings with
// three decimal places. Comparing xN with a multiplication of the already
// rounded x1 value therefore needs the largest possible accumulated rounding
// error, not a relative tolerance that would be too generous for small drives.
const THREE_DECIMAL_QUANTIZATION = 0.0005;
const EXACT_NUMERIC_TOLERANCE = 1e-6;

const NUMERIC_FIELDS = Object.freeze({
  drives: Object.freeze({
    EV_kps: ['EV_kps'],
    thrust_N: ['thrust_N'],
    thrustCap: ['thrustCap'],
    flatMass_tons: ['flatMass_tons', 'flatMassTons'],
    reqPowerGW: ['reqPowerGW', 'req power', 'req_power', 'reqPower'],
    thrustRatingGW: ['thrustRatingGW', 'thrustRating_GW']
  }),
  reactors: Object.freeze({
    maxOutputGW: ['maxOutputGW'],
    specificPowerTGW: ['specificPowerTGW'],
    efficiency: ['efficiency'],
    crew: ['crew']
  }),
  radiators: Object.freeze({
    specificPowerKWkg: ['specificPowerKWkg'],
    specificMassKgM2: ['specificMassKgM2'],
    operatingTempK: ['operatingTempK'],
    emissivity: ['emissivity'],
    vulnerability: ['vulnerability'],
    crew: ['crew']
  }),
  hulls: Object.freeze({
    noseHardpoints: ['noseHardpoints'],
    hullHardpoints: ['hullHardpoints'],
    internalModules: ['internalModules'],
    structuralIntegrity: ['structuralIntegrity'],
    massTons: ['massTons'],
    missionControl: ['missionControl'],
    baseConstructionTimeDays: ['baseConstructionTimeDays'],
    consTier: ['consTier'],
    maxOfficers: ['maxOfficers'],
    crew: ['crew'],
    monthlyIncomeMoney: ['monthlyIncomeMoney']
  }),
  utilityModules: Object.freeze({
    massTons: ['massTons'],
    powerRequirementMW: ['powerRequirementMW'],
    specialModuleValue: ['specialModuleValue'],
    minConsTier: ['minConsTier'],
    crew: ['crew']
  }),
  armour: Object.freeze({
    baryonicHalfValueCm: ['baryonicHalfValueCm'],
    xRayHalfValueCm: ['xRayHalfValueCm'],
    densityKgM3: ['densityKgM3'],
    heatOfVaporizationMJkg: ['heatOfVaporizationMJkg']
  }),
  batteries: Object.freeze({
    energyCapacityGJ: ['energyCapacityGJ'],
    massTons: ['massTons'],
    rechargeRateGJs: ['rechargeRateGJs'],
    hp: ['hp'],
    crew: ['crew']
  })
});

const DRIVE_VARIANT_PATTERN = /^(.*)x([1-6])$/;

// `componentStats.utility_module` intentionally omits this template row: it
// is the game's empty-slot placeholder, not a buildable module. The unlock
// index still counts it in the 58-entry source family, so the difference must
// be visible in the family census rather than looking like a truncation.
const KNOWN_SOURCE_OMISSIONS = Object.freeze({
  utilityModules: Object.freeze({
    count: 1,
    ids: Object.freeze(['Empty']),
    reason: 'the `Empty` utility-template row is an unfilled-slot placeholder, not a component'
  })
});

const isRecord = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value);

/**
 * Parse template numerics without turning absence into zero.
 *
 * The installed drive file uses values such as `"2,130.928"`; removing
 * separators is part of the catalogue contract. A malformed value is null,
 * because a designer must be able to distinguish "not measured" from zero.
 */
export const parseCatalogueNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value;
};

const firstPresent = (record, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record || {}, key)) return record[key];
  }
  return null;
};

/**
 * Normalize the already-baked stat object while retaining fields the next
 * design phase may need. Known numeric fields are always present as a number
 * or null. Unknown fields are copied without guessing their type.
 */
function normalizeStats(rawStats, outputFamily) {
  const raw = isRecord(rawStats) ? rawStats : {};
  const out = {};
  const numeric = NUMERIC_FIELDS[outputFamily] || {};
  const consumedAliases = new Set(Object.values(numeric).flat());

  for (const [key, value] of Object.entries(raw)) {
    if (consumedAliases.has(key)) continue;
    out[key] = cloneValue(value);
  }

  for (const [field, aliases] of Object.entries(numeric)) {
    out[field] = parseCatalogueNumber(firstPresent(raw, aliases));
  }

  // The existing baked armour table stores specialties as compact pairs. The
  // names remain strings; only their numeric values need the same null rule.
  if (outputFamily === 'armour' && Array.isArray(raw.specialties)) {
    out.specialties = raw.specialties.map(entry => Array.isArray(entry)
      ? [entry[0] ?? null, parseCatalogueNumber(entry[1])]
      : cloneValue(entry));
  }

  return out;
}

const sourceFor = (snapshot, definition) => definition.drive
  ? snapshot?.driveStats
  : snapshot?.componentStats?.[definition.sourceKey];

const sourceEntries = (source) => isRecord(source) ? Object.entries(source) : null;

const projectNameMap = (snapshot) => {
  const names = new Map();
  for (const node of asArray(snapshot?.techTree?.nodes)) {
    if (!node?.id) continue;
    names.set(node.id, node.displayName || node.id);
  }
  return names;
};

const factionStatusFor = (snapshot, observerId) => {
  const faction = asArray(snapshot?.factions)
    .find(entry => sameId(entry?.ID, observerId)) || null;
  const statusEntries = Object.entries(snapshot?.techTree?.factionStatus || {});
  const status = statusEntries
    .find(([id]) => sameId(id, observerId))?.[1] || null;

  // An explicitly empty array is a known turn-one state. Only fall back when
  // the first source is absent, not when it is empty.
  const completedProjects = Array.isArray(faction?.completedProjects)
    ? faction.completedProjects
    : (Array.isArray(status?.completedProjects) ? status.completedProjects : null);

  return {
    faction,
    status,
    completedProjects,
    completedSet: new Set(asArray(completedProjects)),
    known: Array.isArray(completedProjects),
    source: Array.isArray(faction?.completedProjects)
      ? 'factions[observer].completedProjects'
      : (Array.isArray(status?.completedProjects)
        ? 'techTree.factionStatus[observer].completedProjects'
        : null)
  };
};

const gateFor = (itemGateMap, unlockFamily, id, indexAvailable) => {
  if (!indexAvailable) return null;
  return itemGateMap.get(`${unlockFamily}:${id}`) || null;
};

const projectForGate = (gate, names) => {
  if (!gate) return null;
  return {
    id: gate.gateId,
    name: names.get(gate.gateId) || gate.gateId,
    kind: gate.gateKind || null
  };
};

/**
 * Resolve the research state independently from omniscient visibility.
 *
 * `researched` answers the faction question. `buildable` answers the current
 * catalogue mode question: omniscient deliberately exposes every row, while
 * player mode requires the observer's completed project. If the observer's
 * completed-project list is absent, player buildability is null rather than a
 * reassuring false/true guess.
 */
const researchStateFor = (gate, researchContext, mode, indexAvailable) => {
  if (!indexAvailable) {
    return {
      status: 'unknown',
      researched: null,
      buildable: mode === 'omniscient' ? true : null,
      locked: mode === 'omniscient' ? false : null
    };
  }

  if (!gate) {
    return {
      status: 'ungated',
      researched: null,
      buildable: true,
      locked: false
    };
  }

  const researched = researchContext.known
    ? researchContext.completedSet.has(gate.gateId)
    : null;
  if (mode === 'omniscient') {
    return {
      status: researched === true ? 'researched' : (researched === false ? 'not-researched' : 'unknown'),
      researched,
      buildable: true,
      locked: false
    };
  }

  return {
    status: researched === null ? 'unknown' : (researched ? 'researched' : 'not-researched'),
    researched,
    buildable: researched,
    locked: researched === null ? null : !researched
  };
};

const makeRow = ({
  id,
  displayName,
  family,
  stats,
  gate,
  projectNames,
  researchContext,
  mode,
  indexAvailable
}) => {
  const unlockProject = projectForGate(gate, projectNames);
  const research = researchStateFor(gate, researchContext, mode, indexAvailable);
  return {
    id,
    displayName: displayName || id,
    family,
    stats,
    unlockProject,
    unlockProjectId: unlockProject?.id || null,
    unlockProjectName: unlockProject?.name || null,
    unlockProjectKind: unlockProject?.kind || null,
    researchStatus: research.status,
    researched: research.researched,
    buildable: research.buildable,
    locked: research.locked
  };
};

const parseDriveVariantId = (id) => {
  const match = String(id).match(DRIVE_VARIANT_PATTERN);
  if (!match) {
    return { baseId: String(id), thrusters: 1, patternMatched: false };
  }
  return { baseId: match[1], thrusters: Number(match[2]), patternMatched: true };
};

const baseDriveDisplayName = (variant) => String(variant?.stats?.displayName || variant?.id || '')
  .replace(/\s+x1$/i, '') || variant?.id || null;

const groupDriveEntries = (driveStats) => {
  const groups = new Map();
  const idAnomalies = [];
  for (const [id, rawStats] of driveStats) {
    const parsed = parseDriveVariantId(id);
    if (!parsed.patternMatched) {
      idAnomalies.push({ id, reason: 'drive id does not end in x1 through x6; treated as a single-thruster row' });
    }
    if (!groups.has(parsed.baseId)) groups.set(parsed.baseId, []);
    groups.get(parsed.baseId).push({
      id,
      thrusters: parsed.thrusters,
      stats: normalizeStats(rawStats, 'drives')
    });
  }
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.thrusters - b.thrusters || a.id.localeCompare(b.id));
  }
  return { groups, idAnomalies };
};

const exactCounts = (entries) => entries.length === DRIVE_THRUSTER_COUNTS.length
  && DRIVE_THRUSTER_COUNTS.every(count => entries.some(entry => entry.thrusters === count));

const fieldTolerance = (field, baseValue, thrusters) => {
  if (field === 'thrust_N') return EXACT_NUMERIC_TOLERANCE;
  // A true zero cannot acquire a non-zero value through rounding of a zero
  // x1 source. Keep that check exact while permitting three-decimal residuals
  // for non-zero powers and ratings.
  if (baseValue === 0) return EXACT_NUMERIC_TOLERANCE;
  return THREE_DECIMAL_QUANTIZATION * (thrusters + 1) + EXACT_NUMERIC_TOLERANCE;
};

const relation = (actual, expected) => {
  const absolute = Math.abs(actual - expected);
  const relative = expected === 0 ? (absolute === 0 ? 0 : null) : absolute / Math.abs(expected);
  return { absolute, relative };
};

/**
 * Verify the xN drive ladder independently of the catalogue join.
 *
 * The report distinguishes a real non-linear mismatch from a source-rounded
 * decimal residual. `status: 'unknown'` means one of the fields could not be
 * evaluated; it never becomes a pass or a zero.
 */
export function verifyDriveThrusterLadders(driveStats = {}) {
  const entries = Array.isArray(driveStats)
    ? driveStats
    : (sourceEntries(driveStats) || []);
  const { groups, idAnomalies } = groupDriveEntries(entries);
  const mismatches = [];
  const unknownChecks = [];
  const roundingResiduals = [];
  const fieldSummary = Object.fromEntries(DRIVE_LADDER_FIELDS.map(field => [field, {
    checked: 0,
    unknown: 0,
    withinTolerance: 0,
    roundingResiduals: 0,
    mismatchCount: 0,
    maxAbsoluteResidual: 0,
    maxRelativeResidual: 0
  }]));

  for (const [baseId, group] of groups) {
    const base = group.find(entry => entry.thrusters === 1) || null;
    if (!base) {
      for (const field of DRIVE_LADDER_FIELDS) {
        fieldSummary[field].unknown += group.length;
        unknownChecks.push({ baseId, field, reason: 'x1 variant is absent' });
      }
      continue;
    }

    for (const variant of group) {
      if (variant === base) continue;
      for (const field of DRIVE_LADDER_FIELDS) {
        const actual = variant.stats[field];
        const baseValue = base.stats[field];
        const summary = fieldSummary[field];
        if (actual === null || baseValue === null) {
          summary.unknown += 1;
          unknownChecks.push({
            baseId,
            variantId: variant.id,
            thrusters: variant.thrusters,
            field,
            reason: actual === null && baseValue === null
              ? 'x1 and xN values are unparseable or absent'
              : (baseValue === null ? 'x1 value is unparseable or absent' : 'xN value is unparseable or absent')
          });
          continue;
        }

        const expected = baseValue * variant.thrusters;
        const { absolute, relative } = relation(actual, expected);
        const tolerance = fieldTolerance(field, baseValue, variant.thrusters);
        summary.checked += 1;
        summary.maxAbsoluteResidual = Math.max(summary.maxAbsoluteResidual, absolute);
        if (relative !== null) summary.maxRelativeResidual = Math.max(summary.maxRelativeResidual, relative);

        if (absolute > tolerance) {
          summary.mismatchCount += 1;
          mismatches.push({
            baseId,
            variantId: variant.id,
            thrusters: variant.thrusters,
            field,
            actual,
            expected,
            absoluteResidual: absolute,
            relativeResidual: relative,
            tolerance
          });
          continue;
        }

        summary.withinTolerance += 1;
        if (absolute > EXACT_NUMERIC_TOLERANCE) {
          summary.roundingResiduals += 1;
          roundingResiduals.push({
            baseId,
            variantId: variant.id,
            thrusters: variant.thrusters,
            field,
            actual,
            expected,
            absoluteResidual: absolute,
            relativeResidual: relative
          });
        }
      }
    }
  }

  const fullLadderCount = [...groups.values()].filter(exactCounts).length;
  const partialLadders = [...groups.entries()]
    .filter(([, group]) => !exactCounts(group))
    .map(([baseId, group]) => ({
      baseId,
      thrusterCounts: [...new Set(group.map(entry => entry.thrusters))].sort((a, b) => a - b),
      variantIds: group.map(entry => entry.id)
    }));
  const status = mismatches.length > 0
    ? 'mismatch'
    : (unknownChecks.length > 0 || idAnomalies.length > 0 ? 'unknown' : 'verified');

  return {
    status,
    verified: status === 'verified' ? true : (status === 'unknown' ? null : false),
    sourceVariantCount: entries.length,
    baseCount: groups.size,
    fullLadderCount,
    partialLadderCount: partialLadders.length,
    expectedThrusterCounts: [...DRIVE_THRUSTER_COUNTS],
    fieldsChecked: [...DRIVE_LADDER_FIELDS],
    tolerance: {
      thrust_N: '1e-6 absolute',
      reqPowerGW: '0.0005 × (N + 1) absolute for three-decimal source quantization; exact when x1 is zero',
      thrustRatingGW: '0.0005 × (N + 1) absolute for three-decimal source quantization; exact when x1 is zero'
    },
    fieldSummary,
    partialLadders,
    idAnomalies,
    unknownChecks,
    mismatches,
    roundingResidualCount: roundingResiduals.length,
    roundingResiduals
  };
}

const rowForDriveGroup = ({
  baseId,
  group,
  definition,
  itemGateMap,
  projectNames,
  researchContext,
  mode,
  indexAvailable,
  unresolved
}) => {
  const base = group.find(entry => entry.thrusters === 1) || group[0];
  const gates = group
    .map(entry => gateFor(itemGateMap, definition.unlockFamily, entry.id, indexAvailable))
    .filter(Boolean);
  const gate = gates[0] || null;
  const distinctGateIds = [...new Set(gates.map(entry => entry.gateId))];
  if (distinctGateIds.length > 1) {
    unresolved.push({
      kind: 'drive-ladder',
      family: definition.unlockFamily,
      id: baseId,
      reason: 'drive variants do not share one unlock project',
      gateIds: distinctGateIds
    });
  }

  const row = makeRow({
    id: baseId,
    displayName: baseDriveDisplayName(base),
    family: definition.outputFamily,
    stats: base.stats,
    gate,
    projectNames,
    researchContext,
    mode,
    indexAvailable
  });
  const counts = [...new Set(group.map(entry => entry.thrusters))].sort((a, b) => a - b);
  row.thrusterRange = {
    min: counts.length > 0 ? counts[0] : null,
    max: counts.length > 0 ? counts[counts.length - 1] : null,
    counts,
    fullLadder: exactCounts(group)
  };
  row.variantIds = group.map(entry => entry.id);
  row.variants = group.map(entry => ({
    id: entry.id,
    displayName: entry.stats.displayName || entry.id,
    thrusters: entry.thrusters,
    stats: entry.stats
  }));
  return row;
};

const emptyFamily = (definition, reason) => ({
  family: definition.outputFamily,
  unlockFamily: definition.unlockFamily,
  available: false,
  reason,
  items: [],
  totalCount: null,
  omittedCount: null,
  sourceTotalCount: null,
  sourceOmittedCount: null
});

const familyIndexFor = (snapshot, definition) => snapshot?.unlockIndex?.families?.[definition.unlockFamily] || null;

const familyResult = ({
  definition,
  entries,
  snapshot,
  itemGateMap,
  projectNames,
  researchContext,
  mode,
  indexAvailable,
  unresolved
}) => {
  if (!entries) return emptyFamily(definition, `snapshot does not carry ${definition.outputFamily} stats`);

  const familyIndex = familyIndexFor(snapshot, definition);
  const sourceTotalCount = familyIndex
    ? (parseCatalogueNumber(familyIndex.total) ?? entries.length)
    : null;
  const sourceOmittedCount = sourceTotalCount === null
    ? null
    : Math.max(0, sourceTotalCount - entries.length);
  const sourceExtraCount = sourceTotalCount === null
    ? null
    : Math.max(0, entries.length - sourceTotalCount);
  const knownOmission = KNOWN_SOURCE_OMISSIONS[definition.outputFamily] || null;
  const sourceIds = new Set(entries.map(([id]) => id));
  const knownOmissionIds = asArray(knownOmission?.ids);
  const omissionIsExpected = Boolean(knownOmission)
    && sourceOmittedCount === knownOmission.count
    && knownOmissionIds.length === knownOmission.count
    && knownOmissionIds.every(id => !sourceIds.has(id));

  if (sourceExtraCount > 0 || (sourceOmittedCount > 0 && !omissionIsExpected)) {
    unresolved.push({
      kind: 'component-census',
      family: definition.outputFamily,
      expectedSourceEntries: sourceTotalCount,
      actualSourceEntries: entries.length,
      reason: 'component stats count does not reconcile with the unlock-index family census'
    });
  }
  const familyIndexAvailable = indexAvailable && Boolean(familyIndex);

  let items;
  if (definition.drive) {
    const { groups } = groupDriveEntries(entries);
    items = [...groups.entries()].map(([baseId, group]) => rowForDriveGroup({
      baseId,
      group,
        definition,
        itemGateMap,
      projectNames,
        researchContext,
        mode,
        indexAvailable: familyIndexAvailable,
        unresolved
      }));
  } else {
    items = entries.map(([id, rawStats]) => {
      const stats = normalizeStats(rawStats, definition.outputFamily);
      return makeRow({
        id,
        displayName: stats.displayName || id,
        family: definition.outputFamily,
        stats,
        gate: gateFor(itemGateMap, definition.unlockFamily, id, familyIndexAvailable),
        projectNames,
        researchContext,
        mode,
        indexAvailable
      });
    });
  }

  return {
    family: definition.outputFamily,
    unlockFamily: definition.unlockFamily,
    available: true,
    reason: null,
    items,
    totalCount: items.length,
    omittedCount: 0,
    sourceTotalCount,
    sourceOmittedCount,
    sourceExtraCount,
    sourceOmittedReason: sourceOmittedCount > 0
      ? (omissionIsExpected
        ? knownOmission.reason
        : 'the source carries fewer entries than the unlock-index family census')
      : null,
    sourceOmittedIds: omissionIsExpected ? [...knownOmissionIds] : [],
    gatedCount: familyIndex ? familyIndex.gated : null,
    ungatedCount: familyIndex ? familyIndex.ungated : null
  };
};

const reactorCompatibility = (driveRows, reactorFamily, unresolved) => {
  const reactors = reactorFamily?.items || [];
  const sourceAvailable = reactorFamily?.available === true;
  const reactorIds = reactors.map(row => row.id);
  const byClass = new Map();
  const requiredClassNames = new Set();
  for (const row of reactors) {
    const plantClass = row.stats?.powerPlantClass || null;
    if (!byClass.has(plantClass)) byClass.set(plantClass, []);
    byClass.get(plantClass).push(row.id);
  }

  let wildcardVariantCount = 0;
  let wildcardBaseCount = 0;
  const namedVariantCounts = new Map();
  const namedBaseCounts = new Map();

  for (const row of driveRows) {
    const required = typeof row.stats?.requiredPowerPlant === 'string' && row.stats.requiredPowerPlant !== ''
      ? row.stats.requiredPowerPlant
      : null;
    if (required !== null) requiredClassNames.add(required);
    let compatibleReactorIds = null;
    let compatibilityStatus = 'unknown';
    if (sourceAvailable && required !== null) {
      if (required === 'Any_General') {
        compatibleReactorIds = [...reactorIds];
        compatibilityStatus = 'wildcard';
        wildcardBaseCount += 1;
        wildcardVariantCount += row.variants.length;
      } else {
        compatibleReactorIds = [...(byClass.get(required) || [])];
        compatibilityStatus = compatibleReactorIds.length > 0 ? 'class-match' : 'no-reactor-class-match';
      }
      const variantCount = row.variants.length;
      namedVariantCounts.set(required, (namedVariantCounts.get(required) || 0) + variantCount);
      namedBaseCounts.set(required, (namedBaseCounts.get(required) || 0) + 1);
    } else if (sourceAvailable && required === null) {
      compatibilityStatus = 'unknown';
    }

    row.requiredPowerPlantClass = required;
    row.compatibleReactorIds = compatibleReactorIds;
    row.compatibleReactorCount = compatibleReactorIds ? compatibleReactorIds.length : null;
    row.reactorCompatibility = {
      requiredPowerPlantClass: required,
      wildcard: required === 'Any_General',
      status: compatibilityStatus,
      reactorIds: compatibleReactorIds
    };
  }

  const classes = [...byClass.entries()]
    .filter(([plantClass]) => plantClass !== null)
    .map(([plantClass, ids]) => ({
      powerPlantClass: plantClass,
      reactorIds: [...ids],
      directlyNamedByDriveBaseCount: namedBaseCounts.get(plantClass) || 0,
      directlyNamedByDriveVariantCount: namedVariantCounts.get(plantClass) || 0,
      wildcardCompatibleDriveBaseCount: wildcardVariantCount > 0 ? wildcardBaseCount : 0,
      wildcardCompatibleDriveVariantCount: wildcardVariantCount > 0 ? wildcardVariantCount : 0
    }));
  const unreferencedDirectClasses = classes
    .filter(entry => entry.directlyNamedByDriveVariantCount === 0)
    .map(entry => entry.powerPlantClass);

  if (sourceAvailable) {
    const unknownClassRows = driveRows.filter(row => row.requiredPowerPlantClass === null);
    if (unknownClassRows.length > 0) {
      unresolved.push({
        kind: 'drive-compatibility',
        reason: 'one or more drives do not name a required power-plant class',
        driveIds: unknownClassRows.map(row => row.id)
      });
    }
  }

  return {
    reactorSourceAvailable: sourceAvailable,
    reactorCount: reactorIds.length,
    reactorClassCount: classes.length,
    requiredClassNameCount: requiredClassNames.size,
    requiredClassNames: [...requiredClassNames],
    directlyNamedReactorClassCount: classes.filter(entry => entry.directlyNamedByDriveVariantCount > 0).length,
    reactorClasses: classes,
    // These classes are not named directly by a drive. They can still be
    // compatible with an Any_General drive; the field is deliberately named
    // "unreferenced direct" so it does not claim that wildcard compatibility
    // is absent. In particular this keeps Molten_Salt_Core_Fission visible
    // without pretending a drive explicitly requires it.
    unreferencedDirectClasses,
    unusedReactorClasses: unreferencedDirectClasses,
    wildcard: {
      requiredClass: 'Any_General',
      baseDriveCount: wildcardBaseCount,
      variantCount: wildcardVariantCount
    }
  };
};

const validateGateCoverage = (snapshot, definitions, sourceMaps, unresolved) => {
  for (const definition of definitions) {
    const familyIndex = familyIndexFor(snapshot, definition);
    const source = sourceMaps.get(definition.outputFamily);
    if (!familyIndex || !source) continue;
    const sourceIds = new Set(source.map(([id]) => id));
    let matched = 0;
    for (const [gateId, gate] of Object.entries(snapshot.unlockIndex.gates || {})) {
      for (const item of asArray(gate?.unlocks?.[definition.unlockFamily])) {
        if (sourceIds.has(item?.id)) {
          matched += 1;
        } else {
          unresolved.push({
            kind: 'component-gate',
            family: definition.outputFamily,
            sourceFamily: definition.unlockFamily,
            id: item?.id || null,
            gateId,
            reason: 'unlock-index entry has no component stats row'
          });
        }
      }
    }
    if (matched !== familyIndex.gated) {
      unresolved.push({
        kind: 'component-gate-census',
        family: definition.outputFamily,
        expectedGated: familyIndex.gated,
        matchedGated: matched,
        reason: 'the gated-entry census did not join to the component stats source'
      });
    }
  }
};

/**
 * Build the server-side ship-designer catalogue.
 *
 * The seven `families.*.items` arrays carry one normalized row per selectable
 * component. Drives are one row per base drive with the actual xN variants
 * nested beneath it; all other families retain one row per template entry.
 * `unresolved` is specifically for failed unlock/stat joins and is separate
 * from `available: false`, which means the snapshot lacks a required source.
 */
export function buildShipComponentCatalogue(snapshot, {
  mode = snapshot?.mode || 'player',
  observerId = DEFAULT_OBSERVER_FACTION_ID
} = {}) {
  if (mode !== 'player' && mode !== 'omniscient') {
    throw new TypeError(`unsupported ship-component catalogue mode: ${mode}`);
  }

  const indexReason = unlockIndexUnavailableReason(snapshot);
  const indexAvailable = !indexReason;
  const itemGateMap = indexAvailable ? buildItemGateMap(snapshot) : new Map();
  const projectNames = projectNameMap(snapshot);
  const researchContext = factionStatusFor(snapshot, observerId);
  const unresolved = asArray(snapshot?.unlockIndex?.unresolved).map(entry => ({
    kind: 'unlock-index',
    ...cloneValue(entry)
  }));
  const sourceMaps = new Map();
  const availabilityReasons = [];
  const families = {};

  for (const definition of SHIP_COMPONENT_FAMILIES) {
    const entries = sourceEntries(sourceFor(snapshot, definition));
    sourceMaps.set(definition.outputFamily, entries);
    if (!entries) availabilityReasons.push(`snapshot does not carry ${definition.outputFamily} stats`);
    if (indexAvailable && !familyIndexFor(snapshot, definition)) {
      availabilityReasons.push(`unlockIndex does not carry the ${definition.unlockFamily} family census`);
    }
    families[definition.outputFamily] = familyResult({
      definition,
      entries,
      snapshot,
      itemGateMap,
      projectNames,
      researchContext,
      mode,
      indexAvailable,
      unresolved
    });
  }

  // The per-family check above is useful when building one family in
  // isolation; this second pass covers all gated entries in one report and is
  // intentionally kept here so a future family definition cannot skip it.
  if (indexAvailable) {
    validateGateCoverage(snapshot, SHIP_COMPONENT_FAMILIES, sourceMaps, unresolved);
  }

  const driveSource = sourceMaps.get('drives');
  const driveLadder = driveSource
    ? verifyDriveThrusterLadders(driveSource)
    : {
      status: 'unknown',
      verified: null,
      sourceVariantCount: null,
      baseCount: null,
      fullLadderCount: null,
      partialLadderCount: null,
      expectedThrusterCounts: [...DRIVE_THRUSTER_COUNTS],
      fieldsChecked: [...DRIVE_LADDER_FIELDS],
      fieldSummary: null,
      partialLadders: [],
      idAnomalies: [],
      unknownChecks: [],
      mismatches: [],
      roundingResidualCount: null,
      roundingResiduals: []
    };

  const compatibility = reactorCompatibility(
    families.drives.items,
    families.reactors,
    unresolved
  );

  const allItems = Object.values(families).flatMap(family => family.items);
  const totals = Object.fromEntries(Object.entries(families).map(([family, result]) => [family, {
    rows: result.totalCount,
    sourceEntries: result.sourceTotalCount,
    sourceOmitted: result.sourceOmittedCount
  }]));
  totals.drives = {
    ...totals.drives,
    variants: driveLadder.sourceVariantCount,
    baseRows: driveLadder.baseCount,
    fullLadders: driveLadder.fullLadderCount,
    partialLadders: driveLadder.partialLadderCount
  };

  return {
    available: indexAvailable && availabilityReasons.length === 0,
    complete: indexAvailable && availabilityReasons.length === 0 && unresolved.length === 0,
    reason: [
      indexReason,
      ...availabilityReasons,
      unresolved.length > 0 ? `${unresolved.length} unlock/stat join issue(s) were recorded` : null
    ].filter(Boolean).join('; ') || null,
    mode,
    observerId,
    research: {
      completedProjectsKnown: researchContext.known,
      completedProjectsSource: researchContext.source,
      completedProjectCount: researchContext.known ? researchContext.completedProjects.length : null
    },
    families,
    items: allItems,
    totals,
    driveLadder,
    compatibility,
    unresolved,
    unresolvedCount: unresolved.length
  };
}

// Short aliases keep the module discoverable to callers that use the noun
// rather than the builder verb. They are the same function object, not wrappers.
export const shipComponentCatalogue = buildShipComponentCatalogue;
export const componentCatalogue = buildShipComponentCatalogue;
