// Purpose: pure alien minimum-hate floor and total-war gate calculation from
//   used Mission Control, elapsed campaign time and alien progression speed,
//   shared by local server, worker, exports and tests.
//
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
// page ("Alien Total War"), last edited 2026-08-11; re-read as raw wikitext
// 2026-08-21 at its new home, https://wiki.hoodedhorse.com/Terra_Invicta/
// (the fandom mirror now returns 410 Gone).
export const ALIEN_TOTAL_WAR_HATE = 200;

// Years since the campaign began before total war can be declared. Note Brutal
// is 0: there, reaching 200 hate is sufficient on its own.
//
// Divided by Alien Progression Speed. Diplomacy, "Alien Total War", verbatim:
// "These values are divided by the Alien Progression Speed." At the 200% this
// campaign runs, Normal's 20 becomes 10.
export const ALIEN_TOTAL_WAR_YEARS = Object.freeze({
  cinematic: 25,
  normal: 20,
  veteran: 10,
  brutal: 0
});

// Alien maximum hate: starting value and yearly growth by difficulty.
// Diplomacy, "Alien Maximum Hate Amount", read 2026-08-21.
export const ALIEN_MAX_HATE = Object.freeze({
  cinematic: { start: 70, perYear: 2 },
  normal: { start: 1000, perYear: 100 },
  veteran: { start: 1000, perYear: 100 },
  brutal: { start: 1000, perYear: 100 }
});

// If this many years have passed and the maximum is still below 200, it is
// raised to 200.
//
// TWO DIFFERENT SCALINGS, and they are not the same one written twice. Aliens,
// "Alien Progression Rate", read as raw wikitext 2026-08-21, lists both:
//
//   "Increase in Alien Maximum Hate per Year is multiplied by X%."
//   "Every \"Years Before Aliens Can Do Something\" timer has its duration
//    divided by X%."
//
// So the yearly ACCRUAL is multiplied by speed while the year THRESHOLDS are
// divided by it. Diplomacy states the second as "All Campaign Duration checks
// are multiplied by the Alien Progression Speed ... every year that passes
// counts as 2 years", which is the same arithmetic from the other side.
//
// Only the threshold half was implemented until 2026-08-21, and it was inert
// because no caller passed a speed. Wiring the measured 200% in is what made
// the missing accrual half observable: without it this campaign's maximum hate
// would have been published as 1891 instead of 2782.
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
 *
 * ON `alienProgressionSpeed`, and the custom-difficulty audit of 2026-08-21
 * (docs/campaign-settings-spec.md; verdicts indexed in
 * shared/campaignSettings.mjs as CAMPAIGN_SETTING_VERDICTS):
 *
 * The hate MODEL is clear. `buildAlienHateEconomics` reports
 * `source: 'save-derived'`, and the venting rate is measured from a
 * previous-save comparison and explicitly refused when unmeasurable, including
 * in player mode where the true hate figure is redacted. Nothing there projects
 * from a stock rate, so no multiplier belongs in it.
 *
 * THIS function was the one exception, and as of 2026-08-21 it no longer is.
 * The audit left it alone because wiring the measured speed in MOVES a
 * published figure, and said that deserved to be its own verifiable change.
 * This is that change: `server/intelligenceFilter.js` and
 * `shared/strategicSnapshot.mjs` now both read the save's own setting through
 * `resolveAlienProgressionSpeed` (shared/campaignElapsed.mjs) and pass it here.
 *
 * On this campaign that took the Normal gate from 20 years to 10, and -- with
 * elapsed campaign time also corrected from an assumed 13 years to a measured
 * 8.91 -- the published verdict from "safe, 7 years remaining" to "safe, 1.09
 * years remaining". Both halves were individually announced (`progressionSpeedAssumed`,
 * `yearsElapsedSource`) and the composite on screen was still materially wrong,
 * which is the point worth keeping: an announced assumption is not a harmless
 * one when two of them compound in the same direction.
 *
 * `alienProgressionSpeed` still DEFAULTS to 1, because a synthetic fixture or a
 * save parsed before the custom-difficulty block existed genuinely has no
 * setting to read. That default remains an assumption and `progressionSpeedAssumed`
 * still announces it; what changed is that a real save no longer reaches it.
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
      progressionSpeedAssumed: speed === 1,
      alienProgressionSpeed: speed
    };
  }

  const yearsThreshold = baseYears / speed;
  // Rounded because the subtraction is done in binary floating point and
  // `10 - 8.91` is `1.0899999999999999`. The GATE is tested against the
  // unrounded difference below, so rounding here only affects what is
  // published, never whether total war is judged available.
  const yearsRemaining = Number(Math.max(0, yearsThreshold - yearsElapsed).toFixed(2));
  const yearGateOpen = yearsElapsed >= yearsThreshold;

  let maximumAlienHate = null;
  if (maxHateConfig) {
    // The yearly increase is MULTIPLIED by progression speed while the 25-year
    // floor check is DIVIDED by it -- see the two verbatim wiki lines above.
    // The accrual half was missing until 2026-08-21 and only became observable
    // once a real speed was passed in.
    maximumAlienHate = Number(
      (maxHateConfig.start + (maxHateConfig.perYear * speed) * yearsElapsed).toFixed(2)
    );
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
    progressionSpeedAssumed: speed === 1,
    // The multiplier actually applied, so a reader can check the arithmetic
    // rather than only being told whether it was assumed.
    alienProgressionSpeed: speed
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
