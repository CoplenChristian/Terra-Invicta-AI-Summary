// Save-derived calculation for the alien minimum-hate floor created by used
// Mission Control. Keep this pure so the local server, hosted worker, exports,
// and tests all agree on the same calculation.

import { toFiniteNumber } from './util.mjs';

export const DIFFICULTY_MULTIPLIERS = Object.freeze({
  cinematic: 0.05,
  normal: 0.30,
  veteran: 0.60,
  brutal: 1.00
});

export const ALIEN_HATE_WAR_THRESHOLD = 50;

// Total war requires BOTH conditions. Verified against the wiki's Diplomacy
// page ("Alien Total War"), last edited 2026-08-11.
export const ALIEN_TOTAL_WAR_HATE = 200;

// Years since the campaign began before total war can be declared. Note Brutal
// is 0: there, reaching 200 hate is sufficient on its own.
export const ALIEN_TOTAL_WAR_YEARS = Object.freeze({
  cinematic: 25,
  normal: 20,
  veteran: 10,
  brutal: 0
});

// Alien maximum hate: starting value and yearly growth by difficulty.
export const ALIEN_MAX_HATE = Object.freeze({
  cinematic: { start: 70, perYear: 2 },
  normal: { start: 1000, perYear: 100 },
  veteran: { start: 1000, perYear: 100 },
  brutal: { start: 1000, perYear: 100 }
});

// If this many years have passed and the maximum is still below 200, it is
// raised to 200. Campaign-duration checks are divided by progression speed.
const MAX_HATE_FLOOR_YEARS = 25;
const MAX_HATE_FLOOR_VALUE = 200;

export const ALIEN_HATE_REDUCTION_PROJECTS = Object.freeze([
  Object.freeze({ id: 'Project_StrategicDeception', label: 'Strategic Deception', appliesTo: 'human' }),
  Object.freeze({ id: 'Project_Maskirovka', label: 'Maskirovka', appliesTo: 'human' }),
  Object.freeze({ id: 'Project_OperationalMisdirection', label: 'Operational Misdirection', appliesTo: 'human' }),
  Object.freeze({ id: 'Project_OperationalSecurity', label: 'Operational Security', appliesTo: 'resistance' })
]);

/**
 * Each completed hate-reduction project multiplies the Mission Control hate
 * floor by this factor -- a 20% cut, stacking multiplicatively across the
 * projects listed above.
 *
 * Verified against the wiki's Alien Hate / Concealment material for 1.0
 * (shipped 2026-01-05), same source as ALIEN_TOTAL_WAR_HATE above. Previously
 * written out as a bare `0.8` in two places: the per-project `reductionFactor`
 * reported to callers, and the `0.8 ** completed` multiplier actually applied.
 * Two copies of one game constant is exactly how those two silently disagree.
 */
export const ALIEN_HATE_CONCEALMENT_FACTOR = 0.8;

const normalizeDifficulty = (difficulty) => String(difficulty || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '');

const normalizeFactionName = (name) => String(name || '').trim().toLowerCase();

const isResistance = (factionName) => factionName.includes('resistance');

const isExemptFaction = (factionName) =>
  factionName.includes('servant') || factionName.includes('protectorate');

const formatFactor = (value) => value === null ? 'UNAVAILABLE' : Number(value).toFixed(2);

/**
 * Total war state, given elapsed campaign years and difficulty.
 * Returns 'unavailable' when either input is unknown -- never a false 'safe'.
 */
export function buildTotalWarState({
  difficultyKey,
  actualAlienHate,
  yearsElapsed,
  alienProgressionSpeed = 1
} = {}) {
  const speed = Number(alienProgressionSpeed) > 0 ? Number(alienProgressionSpeed) : 1;
  const baseYears = ALIEN_TOTAL_WAR_YEARS[difficultyKey];
  const maxHateConfig = ALIEN_MAX_HATE[difficultyKey];

  if (baseYears === undefined || yearsElapsed === null || yearsElapsed === undefined) {
    return {
      state: 'unavailable',
      hateThreshold: ALIEN_TOTAL_WAR_HATE,
      yearsThreshold: baseYears === undefined ? null : baseYears / speed,
      yearsElapsed: yearsElapsed ?? null,
      hateRemaining: null,
      yearsRemaining: null,
      maximumAlienHate: null,
      progressionSpeedAssumed: speed === 1
    };
  }

  const yearsThreshold = baseYears / speed;
  const yearsRemaining = Math.max(0, yearsThreshold - yearsElapsed);
  const yearGateOpen = yearsElapsed >= yearsThreshold;

  let maximumAlienHate = null;
  if (maxHateConfig) {
    maximumAlienHate = maxHateConfig.start + maxHateConfig.perYear * yearsElapsed;
    if (yearsElapsed >= MAX_HATE_FLOOR_YEARS / speed && maximumAlienHate < MAX_HATE_FLOOR_VALUE) {
      maximumAlienHate = MAX_HATE_FLOOR_VALUE;
    }
  }

  const hateRemaining = actualAlienHate === null || actualAlienHate === undefined
    ? null
    : Math.max(0, ALIEN_TOTAL_WAR_HATE - actualAlienHate);

  let state;
  if (actualAlienHate === null || actualAlienHate === undefined) {
    // The year gate is knowable even when hate is not.
    state = yearGateOpen ? 'armed_hate_unknown' : 'safe_hate_unknown';
  } else if (yearGateOpen && actualAlienHate >= ALIEN_TOTAL_WAR_HATE) {
    state = 'active';
  } else if (yearGateOpen) {
    // Year gate passed: only hate stands between the faction and total war.
    state = 'armed';
  } else if (actualAlienHate >= ALIEN_TOTAL_WAR_HATE) {
    // Hate is already sufficient; total war lands the moment the years elapse.
    state = 'pending';
  } else {
    state = 'safe';
  }

  return {
    state,
    hateThreshold: ALIEN_TOTAL_WAR_HATE,
    yearsThreshold,
    yearsElapsed,
    hateRemaining,
    yearsRemaining,
    maximumAlienHate,
    progressionSpeedAssumed: speed === 1
  };
}

export function buildAlienHateEconomics({
  observer = {},
  difficulty,
  mode = 'player',
  visibleHateEstimate = null,
  yearsElapsed = null,
  alienProgressionSpeed = 1
} = {}) {
  const factionName = normalizeFactionName(observer.displayName);
  const exempt = isExemptFaction(factionName);
  const applicable = !exempt;
  const difficultyKey = normalizeDifficulty(difficulty);
  const difficultyMultiplier = DIFFICULTY_MULTIPLIERS[difficultyKey] ?? null;
  const completedProjectIds = new Set(
    Array.isArray(observer.completedProjects)
      ? observer.completedProjects
      : Array.isArray(observer.finishedProjectNames)
        ? observer.finishedProjectNames
        : []
  );
  const resistance = isResistance(factionName);

  const reductionProjects = ALIEN_HATE_REDUCTION_PROJECTS.map((project) => {
    const projectApplicable = applicable && (project.appliesTo === 'human' || (project.appliesTo === 'resistance' && resistance));
    return {
      id: project.id,
      label: project.label,
      applicable: projectApplicable,
      completed: projectApplicable && completedProjectIds.has(project.id),
      reductionFactor: projectApplicable ? ALIEN_HATE_CONCEALMENT_FACTOR : null
    };
  });

  const completedReductionProjects = reductionProjects.filter(project => project.completed);
  const concealmentMultiplier = ALIEN_HATE_CONCEALMENT_FACTOR ** completedReductionProjects.length;
  const usedMissionControl = toFiniteNumber(observer.missionControlUsage);
  const missionControlCapacity = toFiniteNumber(observer.missionControlCapacity);
  const actualRaw = toFiniteNumber(observer.assessedAlienHateOfMe);
  const actualAlienHate = mode === 'player' ? null : actualRaw;
  const baseMultiplier = difficultyMultiplier === null ? null : difficultyMultiplier * concealmentMultiplier;
  const minimumAlienHate = applicable && usedMissionControl !== null && baseMultiplier !== null
    ? usedMissionControl * baseMultiplier
    : null;
  const hateAboveFloor = actualAlienHate !== null && minimumAlienHate !== null
    ? Math.max(0, actualAlienHate - minimumAlienHate)
    : null;
  const minimumHateDelta = minimumAlienHate === null
    ? null
    : ALIEN_HATE_WAR_THRESHOLD - minimumAlienHate;
  const minimumHateHeadroom = minimumHateDelta === null
    ? null
    : Math.max(0, minimumHateDelta);
  const mcWarFloor = applicable && baseMultiplier !== null && baseMultiplier > 0
    ? ALIEN_HATE_WAR_THRESHOLD / baseMultiplier
    : null;

  const totalWar = buildTotalWarState({
    difficultyKey,
    actualAlienHate,
    yearsElapsed,
    alienProgressionSpeed
  });

  let minimumFloorStatus = 'UNAVAILABLE';
  let statusCode = 'unavailable';
  if (!applicable) {
    minimumFloorStatus = 'NOT APPLICABLE';
    statusCode = 'not_applicable';
  } else if (minimumAlienHate !== null) {
    minimumFloorStatus = minimumAlienHate >= ALIEN_HATE_WAR_THRESHOLD
      ? 'PERMANENT-WAR FLOOR REACHED'
      : 'BELOW PERMANENT-WAR FLOOR';
    statusCode = minimumAlienHate >= ALIEN_HATE_WAR_THRESHOLD
      ? 'permanent_war_floor'
      : 'below_permanent_war_floor';
  }

  let currentWarStatus = 'UNAVAILABLE';
  if (actualAlienHate !== null) {
    currentWarStatus = actualAlienHate >= ALIEN_HATE_WAR_THRESHOLD
      ? 'WAR THRESHOLD EXCEEDED'
      : 'BELOW WAR THRESHOLD';
  } else if (visibleHateEstimate !== null && visibleHateEstimate !== undefined && visibleHateEstimate !== '') {
    currentWarStatus = 'GAME-VISIBLE ESTIMATE';
  }

  const formulaText = minimumAlienHate === null || usedMissionControl === null || difficultyMultiplier === null
    ? 'UNAVAILABLE — missing used Mission Control or difficulty data'
    : `${formatFactor(usedMissionControl)} × ${formatFactor(difficultyMultiplier)}${completedReductionProjects.length ? ` × ${formatFactor(concealmentMultiplier)}` : ''} = ${formatFactor(minimumAlienHate)}`;

  return {
    applicable,
    status: statusCode,
    minimumFloorStatus,
    currentWarStatus,
    factionName: observer.displayName || null,
    difficulty: difficulty || null,
    difficultyKey: difficultyKey || null,
    difficultyMultiplier,
    usedMissionControl,
    missionControlCapacity,
    capacityAffectsHate: false,
    actualAlienHate,
    actualHateVisibility: actualAlienHate !== null
      ? 'raw_save_only'
      : visibleHateEstimate
        ? 'game_visible_estimate'
        : 'unavailable',
    visibleHateEstimate: actualAlienHate === null ? visibleHateEstimate : null,
    minimumAlienHate,
    hateAboveFloor,
    // Hate above the floor is not automatically recoverable: venting requires
    // not being at total war, the asset not trespassing, and the aliens having
    // targeted it. Total war makes the whole differential unrecoverable.
    ventingBlockedByTotalWar: totalWar.state === 'active',
    totalWar,
    warThreshold: ALIEN_HATE_WAR_THRESHOLD,
    minimumHateDelta,
    minimumHateHeadroom,
    mcWarFloor,
    concealmentMultiplier,
    completedReductionProjectCount: completedReductionProjects.length,
    reductionProjects,
    formula: {
      usedMissionControl,
      difficultyMultiplier,
      concealmentMultiplier,
      completedReductionProjectCount: completedReductionProjects.length,
      result: minimumAlienHate,
      text: formulaText
    },
    source: 'save-derived'
  };
}
