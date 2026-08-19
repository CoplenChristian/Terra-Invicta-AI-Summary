// Save-derived calculation for the alien minimum-hate floor created by used
// Mission Control. Keep this pure so the local server, hosted worker, exports,
// and tests all agree on the same calculation.

export const DIFFICULTY_MULTIPLIERS = Object.freeze({
  cinematic: 0.05,
  normal: 0.30,
  veteran: 0.60,
  brutal: 1.00
});

export const ALIEN_HATE_WAR_THRESHOLD = 50;

export const ALIEN_HATE_REDUCTION_PROJECTS = Object.freeze([
  Object.freeze({ id: 'Project_StrategicDeception', label: 'Strategic Deception', appliesTo: 'human' }),
  Object.freeze({ id: 'Project_Maskirovka', label: 'Maskirovka', appliesTo: 'human' }),
  Object.freeze({ id: 'Project_OperationalMisdirection', label: 'Operational Misdirection', appliesTo: 'human' }),
  Object.freeze({ id: 'Project_OperationalSecurity', label: 'Operational Security', appliesTo: 'resistance' })
]);

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeDifficulty = (difficulty) => String(difficulty || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '');

const normalizeFactionName = (name) => String(name || '').trim().toLowerCase();

const isResistance = (factionName) => factionName.includes('resistance');

const isExemptFaction = (factionName) =>
  factionName.includes('servant') || factionName.includes('protectorate');

const formatFactor = (value) => value === null ? 'UNAVAILABLE' : Number(value).toFixed(2);

export function buildAlienHateEconomics({
  observer = {},
  difficulty,
  mode = 'player',
  visibleHateEstimate = null
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
      reductionFactor: projectApplicable ? 0.8 : null
    };
  });

  const completedReductionProjects = reductionProjects.filter(project => project.completed);
  const concealmentMultiplier = 0.8 ** completedReductionProjects.length;
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
