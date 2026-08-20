/**
 * Directive Rule Engine — v1
 *
 * Turns a frozen "world" snapshot into a ranked set of concrete action
 * candidates, using data-driven rules instead of the hand-tuned policyRank
 * ladder in briefingGenerator.js. See docs/directive-rule-engine-plan.md for
 * the full design; this module implements the P3/P4/P5 subset described
 * there: open-control-point expansion, defensive holdings, the zero-hate
 * Investigate->Turn council axis, the "capability without sighting"
 * intelligence gap, and the named rules in the plan's rule table.
 *
 * Architecture (plan §3):
 *   world -> generateCandidates -> applyRules -> scoreCandidates -> primary
 *
 * A veto rule returns one of THREE outcomes, never collapsed to two:
 *   'pass'    - the candidate is unaffected by this rule
 *   'veto'    - the candidate is rejected outright
 *   'unknown' - the input this rule needs is unmeasurable from this
 *               snapshot/mode. The candidate survives but moves to the
 *               `uncertain` bucket, confidence-downgraded, carrying a reason
 *               naming what could not be measured. `unknown` must never be
 *               read as `pass` -- that would render an absent measurement as
 *               a confident "safe", which is the failure mode this codebase
 *               exists to avoid (see server/directiveAdvisor.js and
 *               shared/alienHateEconomics.mjs for the same discipline).
 *
 * `primary` is always drawn from `surviving` candidates, so it is always an
 * action. If every generated candidate is vetoed, a positive preparation
 * action is returned explicitly -- never a negative prohibition. Rejected and
 * uncertain candidates remain explanatory evidence under decisionReasoning.
 *
 * Pure module: no I/O, no network, no filesystem. Only requires
 * ./directiveAdvisor, ./alienHateEconomics, and node builtins, so the same
 * logic runs identically in tests, the local server, and any future export
 * path.
 */

const directiveAdvisor = require('./directiveAdvisor');
const { ALIEN_HATE_WAR_THRESHOLD, ALIEN_TOTAL_WAR_HATE } = require('./alienHateEconomics');
const { MissionCatalogue } = require('./engine/missionCatalogue');
const { allocateCyclePlan } = require('./engine/assignment');
const { computeStrategicClocks } = require('./engine/clocks');
const { generateMissionCandidatesFromSpecs } = require('./engine/candidates/missions');

const ALIEN_DETAIN_STORY_GATE = 'CaptureAHydra objective (Unlocked/Completed) / AccessLiveHydra milestone';

function toFiniteNumber(value) {
  // Number(null) and Number('') both evaluate to 0, so a bare Number.isFinite
  // check would silently turn an absent measurement into a confident zero.
  // That is the single most-repeated bug class in this repo's history --
  // guard on presence first.
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
}

function parseCampaignDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && Number.isFinite(Number(value.year)) && Number.isFinite(Number(value.month)) && Number.isFinite(Number(value.day))) {
    const date = new Date(Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour) || 0,
      Number(value.minute) || 0,
      Number(value.second) || 0,
      Number(value.millisecond) || 0
    ));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function defenseIsActive(controlPoint, campaignDate) {
  if (controlPoint?.defended !== true) return false;
  const expiry = parseCampaignDate(controlPoint.defendExpiration);
  const now = parseCampaignDate(campaignDate);
  return !expiry || !now || expiry.getTime() > now.getTime();
}

/**
 * Tunable weights, in one place per the plan's instruction ("Weights live in
 * ONE exported config object, not scattered literals"). Two families:
 *  - Verified game constants get their own source comment at the point of
 *    use (TIMissionTemplate rows, wiki citations) rather than living here,
 *    because they are not tunable -- changing them would make the model
 *    wrong, not differently calibrated.
 *  - Everything below IS a judgement call (plan §2, §8 open question 1) and
 *    is deliberately collected here so a future balance pass touches one
 *    object instead of hunting through rule bodies.
 */
const WEIGHTS = Object.freeze({
  // Spend at most this fraction of the remaining Total War headroom on any
  // single candidate. ASSUMPTION -- the plan flags the weighting itself as
  // judgement, not derived; 0.5 leaves room for more than one action per
  // cycle before the irreversible 200-hate line.
  TOTAL_WAR_SAFETY_MARGIN: 0.5,

  // Cost ladder for crossing a hate threshold, keyed by reversibility
  // (plan §2): staying under the war threshold is cheap and recoverable;
  // crossing 50 starts an asset hunt (recoverable by venting); crossing 200
  // is permanent. ASSUMPTION -- these multipliers are tunable config, not a
  // verified game formula.
  HATE_CROSSING: Object.freeze({
    staysUnder50: 1,
    crossing50: 3,
    crossing200: 10
  }),

  // Scales the weighted-hate cost term in the objective function
  // (score = value - hateCost - resourceCost) into the same units as value.
  HATE_POINTS: 1,

  // Scales the GDP/CP-cost value-density term. See value/gdp-per-cp-cost
  // below for the formula itself.
  VALUE_POINTS: 1,

  // Value for the non-expansion families. Expansion value falls out of a
  // real formula (GDP density); nothing comparable exists for taking an
  // enemy councilor off the board or for unblocking the alien-response
  // axis, so these are calibrated judgement, not derived quantities --
  // every rule using them is marked estimateClass 'heuristic'.
  //
  // Calibration point: on the live save the four takeable control points
  // score 4.4-5.5, so these are set to make a councilor Turn comparable to
  // a mid-value CP grab rather than automatically beating or losing to it.
  // Change them here, not at the call sites.
  COUNCIL: Object.freeze({
    // Turn is the payoff -- it removes a councilor from the enemy board and
    // puts an agent inside their faction, at zero alien hate on success.
    turn: 6,
    // Investigate is the enabler, not the prize: it feeds Turn's secrets
    // precondition and is the only way to read a masked Loyalty. Valued
    // below Turn so it never outranks the thing it exists to unlock.
    investigate: 3,
    // Notion 02: "Protectorate must be treated as a real strategic
    // adversary." Proxy factions also feed alien hate, so denying them a
    // councilor is worth more than denying a neutral human faction.
    proxyTargetBonus: 3
  }),

  // Per unconfirmable precondition. Small on purpose: these are unverifiable
  // rather than known-unmet, so this breaks ties toward actions we can
  // confirm are available without burying a genuinely better option.
  UNMET_PRECONDITION_PENALTY: 0.75,

  INTELLIGENCE: Object.freeze({
    // Holding alien-tracking capability with zero sightings blocks every
    // downstream alien action -- Detain, interception, facility response.
    // A blocker is worth more than any single action it gates.
    unblockSightings: 5,
    // Under escalate-late the fleet cannot absorb what it cannot see, so
    // the blocker gets worse, not better, the more fragile we are.
    escalateLateBonus: 4,
    // Removing an alien operative from Earth, before hate cost is applied
    // by the hate rules.
    detainAlien: 7
  }),

  // Core holding defense (Defend Interests).
  DEFENSE: Object.freeze({
    base: 5,
    gdpDensityPoints: 0.2,
    escalateLateBonus: 3
  }),

  // Scales resourceCost = spend / stock in the objective function.
  RESOURCE_POINTS: 1,

  // How many lowest-Loyalty enemy councilors to generate Investigate/Turn
  // candidates for. Not a game constant -- just keeps the candidate list
  // bounded. Tunable.
  TOP_N_COUNCIL_TARGETS: 3
});

function getWeights(world) {
  const configured = world?.directiveWeights;
  if (!configured) return WEIGHTS;
  return {
    ...WEIGHTS,
    TOTAL_WAR_SAFETY_MARGIN: configured.totalWarSafetyMargin ?? WEIGHTS.TOTAL_WAR_SAFETY_MARGIN,
    HATE_CROSSING: { ...WEIGHTS.HATE_CROSSING, ...(configured.hateCrossing || {}) },
    HATE_POINTS: configured.hatePoints ?? WEIGHTS.HATE_POINTS,
    VALUE_POINTS: configured.valuePoints ?? WEIGHTS.VALUE_POINTS,
    COUNCIL: { ...WEIGHTS.COUNCIL, ...(configured.council || {}) },
    UNMET_PRECONDITION_PENALTY: configured.unmetPreconditionPenalty ?? WEIGHTS.UNMET_PRECONDITION_PENALTY,
    INTELLIGENCE: { ...WEIGHTS.INTELLIGENCE, ...(configured.intelligence || {}) },
    DEFENSE: { ...WEIGHTS.DEFENSE, ...(configured.defense || {}) },
    RESOURCE_POINTS: configured.resourcePoints ?? WEIGHTS.RESOURCE_POINTS,
    TOP_N_COUNCIL_TARGETS: configured.topNCouncilTargets ?? WEIGHTS.TOP_N_COUNCIL_TARGETS
  };
}

// ---------------------------------------------------------------------------
// Candidate generators
// ---------------------------------------------------------------------------

/**
 * (a) Open control points -- server/snapshotBuilder.js nations[].controlPoints[]
 * where factionId is null (neutral).
 *
 * Every neutral CP becomes a candidate, including the ones that will be
 * vetoed. Nothing is silently dropped at generation time: the territory and
 * executive-last filters run as real veto rules (legality/no-territory,
 * legality/executive-last) so their rejections are recorded with a reason,
 * not filtered away before the pipeline sees them. The one exception is the
 * `territoryClass: 'unformed'` case, which the top-level `runEngine` orchestration
 * moves from `rejected` into `futureOpportunities` after the veto fires --
 * see the comment on that reclassification below for why.
 *
 * Measured on the 2026-08-20 live save (136 unclaimed CPs; the plan's
 * write-up from the previous day cites 120/8, one day of campaign drift
 * off the 121/7 measured here):
 *   121 unformed nations   (0 regions, 0 population -- e.g. Aceh, Alaska)
 *     7 absorbed nations   (0 regions, population on record -- e.g. Italy,
 *                           East Germany; territory folded into a bloc)
 *     4 executive CPs genuinely blocked by executive-last
 *     4 actually takeable  (Malawi, Honduras, Madagascar, Namibia)
 */
function buildControlNationCandidate(nation, cp, allCpsInNation, world) {
  const regionsCount = toFiniteNumber(nation.regionsCount);
  const population = toFiniteNumber(nation.population);
  const gdpRaw = toFiniteNumber(nation.GDP);
  const gdpBn = gdpRaw === null ? null : gdpRaw / 1e9;
  const hasTerritory = regionsCount !== null && regionsCount > 0;
  // Both unformed and absorbed nations report 0 regions; population is the
  // only field that tells them apart (absorbed nations keep a real
  // population on record even though their territory has been folded into a
  // bloc -- Italy 58.9M, East Germany 82.8M). When regionsCount itself is
  // unmeasurable, classification is left null rather than guessed.
  const territoryClass = regionsCount === null
    ? null
    : hasTerritory
      ? 'real'
      : (population !== null && population > 0 ? 'absorbed' : 'unformed');
  const otherCps = allCpsInNation.filter((c) => c.id !== cp.id);
  const allOtherCpsOwnedByObserver = world.observerId === null || world.observerId === undefined
    ? null
    : otherCps.every((c) => sameId(c.factionId, world.observerId));

  return {
    id: `control-nation:${nation.displayName}:${cp.controlPointType}`,
    family: 'expansion',
    missionType: 'Control Nation',
    title: `Take the ${cp.controlPointType} control point in ${nation.displayName}`,
    target: {
      kind: 'controlPoint',
      nation: nation.displayName,
      faction: null,
      controlPointType: cp.controlPointType,
      isExecutive: cp.isExecutive === true
    },
    hate: {
      toAliens: { low: 0, high: 0 },
      note: 'TIMissionTemplate Control Nation (GainInfluence) hate row is [0,0,0,0,0,0] -- zero on every outcome slot.'
    },
    // No verified flat or bonus resource price for GainInfluence exists in
    // the sources this repo has checked (TIMissionTemplate is not present in
    // this repo; only the Notion-verified hate row and Defend Interests'
    // flat cost are confirmed). Absent stays null rather than invented.
    cost: null,
    value: {
      gdpBn,
      isExecutive: cp.isExecutive === true,
      cpCountInNation: allCpsInNation.length,
      nationName: nation.displayName,
      regionsCount,
      population,
      territoryClass,
      allOtherCpsOwnedByObserver
    },
    score: null,
    provenance: {
      source: 'snapshot nations[].controlPoints[]; hate row from TIMissionTemplate GainInfluence',
      estimateClass: 'exact'
    },
    unmetPreconditions: []
  };
}

function generateOpenControlPointCandidates(world) {
  const candidates = [];
  for (const nation of world.nations) {
    const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
    const neutralCps = cps.filter((cp) => cp.factionId === null || cp.factionId === undefined);
    for (const cp of neutralCps) {
      candidates.push(buildControlNationCandidate(nation, cp, cps, world));
    }
  }
  return candidates;
}

/**
 * (b) Council: Investigate -> Turn -- the zero-hate offensive.
 *
 * Verified from TIMissionTemplate (six-slot outcome array; slot 4 = normal
 * success, slot 5 = critical success), per server/directiveAdvisor.js's own
 * header sourcing convention:
 *   Turn Councilor:        [0,3,3,0,0,0] -- zero on success, 3 on the two
 *                           failure slots. Attack Persuasion, defence
 *                           Loyalty. Cost: Influence (bonus).
 *   Investigate Councilor: [0,0,0,0,0,0] -- zero on every outcome. Attack
 *                           Investigation, defence Espionage. Cost: Ops
 *                           (bonus).
 *
 * Targets are ranked by low Loyalty (resolvedAttributes.effective.Loyalty
 * when present, else the base attributes.Loyalty; a councilor with neither
 * is left out of the ranking rather than sorted as if Loyalty were 0).
 *
 * Turn's real preconditions are HasSpySlot and HasIntelOnCouncilorSecrets.
 * Neither is present in the snapshot: investigationConfidence
 * (server/intelligenceFilter.js) reports the snapshot MODE (e.g.
 * "OMNISCIENT"), not per-councilor secret depth, and is not a substitute.
 * Turn candidates carry both as unmetPreconditions and say so in the title,
 * per the plan -- "do not pretend they are satisfiable."
 */
/**
 * Is this faction one of the alien proxies? Routed through directiveAdvisor
 * so there is one definition of "proxy" in the codebase -- it already knows
 * the Servants/Protectorate template names and display-name spellings.
 */
function isProxyFaction(factionName) {
  if (!factionName) return false;
  const kind = directiveAdvisor.classifyProxy({ displayName: factionName }).kind;
  return kind === 'servants' || kind === 'protectorate';
}

function loyaltyOf(councilor) {
  const effective = toFiniteNumber(councilor?.resolvedAttributes?.effective?.Loyalty);
  if (effective !== null) return effective;
  const base = toFiniteNumber(councilor?.attributes?.Loyalty);
  if (base !== null) return base;
  // Player mode strips `attributes` from observed enemies and exposes
  // `maskedAttributes` instead, where an unresolved stat is
  // { visible: null, visibility: 'unknown' }. Read the masked view rather
  // than treating the whole councilor as unrankable -- but keep returning
  // null when `visible` really is null, because that is the honest answer.
  return toFiniteNumber(councilor?.maskedAttributes?.Loyalty?.visible);
}

function buildInvestigateCandidate(councilor, loyalty) {
  return {
    id: `investigate-councilor:${councilor.ID}`,
    family: 'council',
    missionType: 'Investigate Councilor',
    title: `Investigate ${councilor.displayName} (${councilor.factionName})`,
    target: {
      kind: 'councilor',
      nation: null,
      faction: councilor.factionName,
      controlPointType: null,
      isExecutive: null,
      councilorId: councilor.ID,
      councilorName: councilor.displayName,
      loyalty
    },
    hate: {
      toAliens: { low: 0, high: 0 },
      note: 'TIMissionTemplate Investigate Councilor hate row is [0,0,0,0,0,0] -- zero on every outcome.'
    },
    cost: { resource: 'Operations', amount: null, kind: 'bonus' },
    value: {
      targetLoyalty: loyalty,
      // Servants and Protectorate both feed alien hate and are the factions
      // Notion 02 names as real adversaries, so denying them a councilor is
      // worth more than denying a neutral human faction.
      targetIsProxy: isProxyFaction(councilor.factionName)
    },
    score: null,
    provenance: {
      source: 'TIMissionTemplate Investigate Councilor outcome array',
      estimateClass: 'exact'
    },
    unmetPreconditions: []
  };
}

function buildTurnCandidate(councilor, loyalty) {
  return {
    id: `turn-councilor:${councilor.ID}`,
    family: 'council',
    missionType: 'Turn Councilor',
    title: `Turn ${councilor.displayName} (${councilor.factionName}) -- pending spy slot & secrets intel`,
    target: {
      kind: 'councilor',
      nation: null,
      faction: councilor.factionName,
      controlPointType: null,
      isExecutive: null,
      councilorId: councilor.ID,
      councilorName: councilor.displayName,
      loyalty
    },
    hate: {
      toAliens: { low: 0, high: 3 },
      note: 'TIMissionTemplate Turn Councilor hate row is [0,3,3,0,0,0] -- zero on normal and critical '
        + 'success (slots 4-5), 3 on failure (slots 1-2). Without success odds, the failure-risk branch '
        + 'carries up to 3 alien hate.'
    },
    // Bonus-cost mission: the amount scales with the roll and is genuinely
    // unfillable without a success-odds calculator (plan §4 / Notion 09,14),
    // which is out of scope for v1. Absent stays null.
    cost: { resource: 'Influence', amount: null, kind: 'bonus' },
    value: {
      targetLoyalty: loyalty,
      // Servants and Protectorate both feed alien hate and are the factions
      // Notion 02 names as real adversaries, so denying them a councilor is
      // worth more than denying a neutral human faction.
      targetIsProxy: isProxyFaction(councilor.factionName)
    },
    score: null,
    provenance: {
      source: 'TIMissionTemplate Turn Councilor outcome array, slots 1-2 & 4-5',
      estimateClass: 'exact'
    },
    unmetPreconditions: [
      'HasSpySlot is not present in this snapshot -- cannot confirm a free spy slot exists on this target.',
      'HasIntelOnCouncilorSecrets is not present in this snapshot -- investigationConfidence reports the '
        + 'snapshot MODE (e.g. OMNISCIENT), not per-councilor secret depth, and is not a substitute.'
    ]
  };
}

function generateDefendInterestsCandidates(world) {
  const candidates = [];
  const observerId = world.observerId;
  if (observerId === null || observerId === undefined) return candidates;

  const ownNations = [];
  for (const nation of world.nations) {
    const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
    const ownCps = cps.filter((cp) => sameId(cp.factionId, observerId));
    if (ownCps.length > 0) {
      const activeDefenses = ownCps.filter((cp) => defenseIsActive(cp, world.campaignDate));
      const defenseUnknownCount = ownCps.filter((cp) => cp.defended !== true && cp.defended !== false).length;
      // A future-dated ward already protects every owned CP in this nation;
      // do not turn a maintenance state into a duplicate action. Unknown
      // fields remain actionable so older/filtered snapshots stay useful.
      if (activeDefenses.length === ownCps.length && defenseUnknownCount === 0) continue;
      const gdpRaw = toFiniteNumber(nation.GDP);
      const gdpBn = gdpRaw === null ? null : gdpRaw / 1e9;
      ownNations.push({
        nation,
        ownCps,
        gdpBn: gdpBn ?? 0,
        activeDefenseCount: activeDefenses.length,
        defenseUnknownCount
      });
    }
  }

  // Sort by highest GDP to defend major holdings first (Notion 09)
  const ranked = ownNations.sort((a, b) => b.gdpBn - a.gdpBn).slice(0, 3);
  for (const { nation, ownCps, gdpBn, activeDefenseCount, defenseUnknownCount } of ranked) {
    const execCp = ownCps.find((c) => c.isExecutive) || ownCps[0];
    const unprotectedCount = ownCps.length - activeDefenseCount;
    candidates.push({
      id: `defend-interests:${nation.displayName}`,
      family: 'council',
      missionType: 'Defend Interests',
      title: `Defend Interests in ${nation.displayName}`,
      recommendation: `Deploy an Administration or Persuasion operative on Defend Interests in ${nation.displayName} (protects core GDP against Crackdown/Purge at 0 alien hate).`,
      target: {
        kind: 'controlPoint',
        nation: nation.displayName,
        faction: world.observerName || 'Observer',
        controlPointType: execCp?.controlPointType || 'Executive',
        isExecutive: execCp?.isExecutive === true
      },
      hate: {
        toAliens: { low: 0, high: 0 },
        note: 'TIMissionTemplate Defend Interests hate row is [0,0,0,0,0,0] -- zero on every outcome.'
      },
      cost: { resource: 'Influence', amount: 20, kind: 'flat' },
      value: {
        gdpBn,
        nationName: nation.displayName,
        isDefendInterests: true,
        defendedControlPointCount: activeDefenseCount,
        unprotectedControlPointCount: unprotectedCount,
        defenseUnknownCount
      },
      score: null,
      provenance: {
        source: 'TIMissionTemplate Defend Interests (flat 20 Influence, 0 alien hate); Notion 09',
        estimateClass: 'exact'
      },
      unmetPreconditions: defenseUnknownCount > 0
        ? ['Existing Defend Interests coverage is not fully observable for this holding.']
        : []
    });
  }
  return candidates;
}

function generateCouncilCandidates(world) {
  const observerId = world.observerId;
  const councilors = Array.isArray(world.councilors) ? world.councilors : [];
  const enemyCouncilors = councilors.filter((c) => c
    && c.isAlien !== true
    && c.isIndependent !== true
    && c.factionId !== null && c.factionId !== undefined
    && !sameId(c.factionId, observerId));

  const scored = enemyCouncilors.map((c) => ({ councilor: c, loyalty: loyaltyOf(c) }));
  // A councilor with no measurable Loyalty is not sorted to the front as if
  // Loyalty were 0.
  const rankable = scored.filter((entry) => entry.loyalty !== null);

  const candidates = [];

  if (rankable.length > 0) {
    const ranked = rankable
      .sort((a, b) => a.loyalty - b.loyalty)
      .slice(0, getWeights(world).TOP_N_COUNCIL_TARGETS);
    for (const { councilor, loyalty } of ranked) {
      candidates.push(buildInvestigateCandidate(councilor, loyalty));
      candidates.push(buildTurnCandidate(councilor, loyalty));
    }
    return candidates;
  }

  // Nobody has readable Loyalty. That is the normal state in player mode,
  // where observed enemies carry maskedAttributes with visible: null -- and
  // dropping the whole council axis there would hide the one offensive that
  // costs no alien hate, in the mode the dashboard actually runs in.
  //
  // Turn is genuinely un-targetable without Loyalty, since Loyalty is the
  // defending stat and there is no basis for choosing between targets. But
  // Investigate Councilor is precisely the mission that resolves that, and it
  // is free on every outcome. So emit Investigate alone and say why.
  for (const { councilor } of scored.slice(0, getWeights(world).TOP_N_COUNCIL_TARGETS)) {
    const candidate = buildInvestigateCandidate(councilor, null);
    candidate.title = `Investigate ${councilor.displayName} (${councilor.factionName}) `
      + '-- Loyalty unreadable, and Turn cannot be targeted without it';
    candidate.unmetPreconditions = [
      ...candidate.unmetPreconditions,
      'Target Loyalty is not observable in this mode, so Turn targets cannot be ranked. '
        + 'Investigate Councilor is the mission that resolves it, and costs no alien hate on any outcome.'
    ];
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * (c) Intelligence: capability without sighting.
 *
 * capabilities.canDirectlyDetectAlienCouncilors (Project_TheirMovements) can
 * be true while zero alien councilors are visible -- councilors[].isAlien
 * true but seenByFactionIds never contains the observer's own faction ID.
 * That is a real state, not a bug: on the 2026-08-20 live save, 6 alien
 * councilors exist and all 6 have an empty seenByFactionIds. Reporting
 * "detectedCount: 0" next to an unlocked capability reads as "nothing out
 * there" when the truth is "we aren't looking" -- this candidate exists to
 * say that explicitly.
 *
 * If an alien councilor IS visible, a Detain candidate is emitted instead.
 * Detain against an alien is special-cased in the wiki (Diplomacy §
 * "Actions that affect hatred"): 10 hate on normal success, 0 on critical --
 * the TIMissionTemplate [0,1,1,0,2,3] Detain row is the human-target case
 * and does not apply here. Budget-gated by hate/total-war-budget below and
 * story-gated by legality/story-gate (CaptureAHydra Unlocked/Completed or
 * AccessLiveHydra).
 */
function generateIntelligenceCandidates(world) {
  const candidates = [];
  const councilors = Array.isArray(world.councilors) ? world.councilors : [];
  const alienCouncilors = councilors.filter((c) => c && c.isAlien === true);
  const canDetect = world.capabilities?.canDirectlyDetectAlienCouncilors === true;
  const visibleAliens = alienCouncilors.filter((c) => Array.isArray(c.seenByFactionIds)
    && c.seenByFactionIds.some((id) => sameId(id, world.observerId)));

  // Player mode strips unsighted alien councilors from the list entirely, so
  // `alienCouncilors` is empty there even when aliens exist and we hold the
  // tracking capability -- which is exactly the state this candidate is for.
  // alienIntelligenceStage.operatives survives filtering and carries the same
  // fact as an explicit count, so prefer it and fall back to the raw list.
  const operatives = world.alienIntelligenceStage?.operatives || null;
  const detectedCount = toFiniteNumber(operatives?.detectedCount);
  const capabilityUnused = operatives?.active === true && detectedCount === 0;
  const unusedFromRawList = canDetect && alienCouncilors.length > 0 && visibleAliens.length === 0;

  if (capabilityUnused || unusedFromRawList) {
    candidates.push({
      id: 'intel:capability-unlocked-unused',
      family: 'intelligence',
      missionType: 'Investigate Alien Activity',
      title: 'Convert alien-detection capability into sightings -- Investigate Alien Activity / Surveil Location',
      target: { kind: 'capability', nation: null, faction: 'the Aliens', controlPointType: null, isExecutive: null },
      hate: null,
      cost: null,
      // Known alien count is omniscient-only; in player mode we know the
      // capability is on and the sighting count is zero, but not how many
      // operatives are out there. Null, not 0 -- "none sighted" and "none
      // exist" are opposite conclusions.
      value: {
        alienCouncilorCount: alienCouncilors.length > 0 ? alienCouncilors.length : null,
        sightedCount: 0,
        capabilityUnlockedUnused: true
      },
      score: null,
      provenance: {
        source: 'capabilities.canDirectlyDetectAlienCouncilors (Project_TheirMovements) + councilors[].seenByFactionIds',
        estimateClass: 'exact'
      },
      unmetPreconditions: []
    });
  }

  const canDetain = world.capabilities?.canDetainAlienCouncilors;
  for (const alien of visibleAliens) {
    const storyGateKnown = canDetain !== undefined && canDetain !== null;
    const storyGatePassed = canDetain === true;
    const unmet = [];
    if (!storyGateKnown) {
      unmet.push(`${ALIEN_DETAIN_STORY_GATE} cannot be confirmed from this snapshot.`);
    } else if (!storyGatePassed) {
      unmet.push(`${ALIEN_DETAIN_STORY_GATE} is not available -- Detain mission against aliens is story-locked.`);
    }

    candidates.push({
      id: `detain-alien:${alien.ID}`,
      family: 'intelligence',
      missionType: 'Detain',
      title: storyGatePassed
        ? `Detain ${alien.displayName} -- alien operative sighted`
        : `Detain ${alien.displayName} -- pending ${ALIEN_DETAIN_STORY_GATE}`,
      target: {
        kind: 'alienCouncilor',
        nation: null,
        faction: 'the Aliens',
        controlPointType: null,
        isExecutive: null,
        councilorId: alien.ID,
        councilorName: alien.displayName
      },
      hate: {
        toAliens: { low: 0, high: 10 },
        note: 'Detain vs an alien councilor is special-cased: 10 hate on normal success, 0 on critical '
          + 'success, no retaliation (wiki Diplomacy § "Actions that affect hatred"). The TIMissionTemplate '
          + '[0,1,1,0,2,3] Detain row is the human-target case and does not apply to an alien target.'
      },
      // Consumed by generateCandidates below: this candidate has already said
      // in its own hate note why the Detain TIMissionTemplate row does not
      // describe it, so the row must not be attached back onto it by the
      // generic spec lookup.
      templateApplies: false,
      cost: { resource: 'Operations', amount: null, kind: 'bonus' },
      value: { alienCouncilorId: alien.ID, storyGatePassed, storyGateKnown },
      score: null,
      provenance: {
        source: `wiki Diplomacy § "Actions that affect hatred" (post-1.0); ${ALIEN_DETAIN_STORY_GATE} story gate`,
        estimateClass: 'exact'
      },
      unmetPreconditions: unmet
    });
  }

  return candidates;
}

function generateCandidates(world) {
  const existing = [
    ...generateOpenControlPointCandidates(world),
    ...generateDefendInterestsCandidates(world),
    ...generateCouncilCandidates(world),
    ...generateIntelligenceCandidates(world)
  ];

  if (world.missionSpecs && typeof world.missionSpecs === 'object') {
    const catalogue = new MissionCatalogue(world.missionSpecs);

    // The hand-written generators name their mission but carry none of its
    // rules, so the odds layer saw no spec and reported odds unavailable even
    // on a snapshot shipping all 43 templates. The catalogue indexes by
    // friendlyName as well as dataName, which is what `missionType` holds.
    //
    // Defend Interests is the case that shows why this matters: its spec says
    // `contested: false`, which is the difference between "100%, automatic"
    // and "there is no roll here to compute".
    for (const candidate of existing) {
      if (candidate.missionSpec || candidate.templateApplies === false) continue;
      const spec = catalogue.get(candidate.missionType);
      if (spec) candidate.missionSpec = spec;
    }

    const generic = generateMissionCandidatesFromSpecs(world, catalogue);
    const existingIds = new Set(existing.map((c) => c.id));
    for (const g of generic) {
      if (!existingIds.has(g.id)) {
        existing.push(g);
        existingIds.add(g.id);
      }
    }
  }

  return existing;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RULES = Object.freeze([
  {
    id: 'hate/total-war-budget',
    kind: 'veto',
    appliesTo: (candidate) => Boolean(candidate.hate) && candidate.hate.toAliens !== null,
    evaluate(world, candidate) {
      const high = candidate.hate.toAliens.high;
      // Zero measured exposure can never breach a budget, regardless of
      // whether the budget itself is observable -- this is what keeps
      // Control Nation / Investigate / Turn candidates from being
      // confidence-downgraded by a redacted hate meter they don't expose
      // any hate to in the first place.
      if (!(high > 0)) return 'pass';
      const proximity = world.posture ? world.posture.totalWarProximity : null;
      if (proximity === 'unknown' || proximity === null || proximity === undefined) return 'unknown';
      const headroom = world.posture.totalWarHeadroom;
      if (headroom === null || headroom === undefined || !Number.isFinite(headroom)) return 'unknown';
      const budget = headroom * getWeights(world).TOTAL_WAR_SAFETY_MARGIN;
      return high > budget ? 'veto' : 'pass';
    },
    because(world, candidate) {
      const high = candidate.hate?.toAliens?.high;
      if (!(high > 0)) return 'This action carries no measured alien-hate exposure.';
      const proximity = world.posture ? world.posture.totalWarProximity : null;
      const headroom = world.posture ? world.posture.totalWarHeadroom : null;
      if (proximity === 'unknown' || headroom === null || headroom === undefined || !Number.isFinite(headroom)) {
        return 'Distance to Total War (200 hate) is not observable from this save/mode, so the budget check '
          + 'cannot clear this action.';
      }
      const budget = headroom * getWeights(world).TOTAL_WAR_SAFETY_MARGIN;
      return high > budget
        ? `Up to ${high} hate exceeds the safety-margined Total War budget `
          + `(${headroom.toFixed(1)} headroom × ${getWeights(world).TOTAL_WAR_SAFETY_MARGIN} = ${budget.toFixed(1)}).`
        : `Up to ${high} hate is within the safety-margined Total War budget `
          + `(${headroom.toFixed(1)} headroom × ${getWeights(world).TOTAL_WAR_SAFETY_MARGIN} = ${budget.toFixed(1)}).`;
    },
    source: 'wiki Diplomacy § "Alien Total War" (rev 2026-08-11); headroom from directiveAdvisor.assessCampaignPosture.',
    estimateClass: 'heuristic'
  },
  {
    id: 'hate/war-threshold-crossing',
    kind: 'score',
    appliesTo: (candidate) => Boolean(candidate.hate) && candidate.hate.toAliens !== null,
    evaluate(world, candidate) {
      const { low, high } = candidate.hate.toAliens;
      const mid = (low + high) / 2;
      if (!(mid > 0)) return 0;
      const current = world.posture ? world.posture.actualAlienHate : null;
      let weight = getWeights(world).HATE_CROSSING.staysUnder50;
      if (current !== null && current !== undefined && Number.isFinite(current)) {
        const projected = current + high;
        if (current < ALIEN_TOTAL_WAR_HATE && projected >= ALIEN_TOTAL_WAR_HATE) {
          weight = getWeights(world).HATE_CROSSING.crossing200;
        } else if (current < ALIEN_HATE_WAR_THRESHOLD && projected >= ALIEN_HATE_WAR_THRESHOLD) {
          weight = getWeights(world).HATE_CROSSING.crossing50;
        }
      } else {
        // Redacted hate in player mode: evaluate using visible estimate and posture
        const pips = toFiniteNumber(world.posture?.pips);
        const totalWarProx = world.posture?.totalWarProximity;
        if (totalWarProx === 'active' || totalWarProx === 'near') {
          weight = getWeights(world).HATE_CROSSING.crossing200;
        } else if (world.posture?.warExceeded || world.posture?.hateHot || world.posture?.hateElevated || (pips !== null && pips >= 4)) {
          weight = getWeights(world).HATE_CROSSING.crossing50;
        } else if (pips !== null && pips < 4) {
          weight = getWeights(world).HATE_CROSSING.staysUnder50;
        } else {
          weight = getWeights(world).HATE_CROSSING.crossing50;
        }
      }
      return -(mid * weight * getWeights(world).HATE_POINTS);
    },
    because(world, candidate) {
      const { low, high } = candidate.hate.toAliens;
      const mid = (low + high) / 2;
      if (!(mid > 0)) return 'No expected alien hate from this action.';
      const current = world.posture ? world.posture.actualAlienHate : null;
      if (current === null || current === undefined || !Number.isFinite(current)) {
        const pips = toFiniteNumber(world.posture?.pips);
        const totalWarProx = world.posture?.totalWarProximity;
        if (totalWarProx === 'active' || totalWarProx === 'near') {
          return `Alien hate is unobservable but Total War proximity is ${totalWarProx} -- scored at 10x crossing200.`;
        }
        if (world.posture?.warExceeded || world.posture?.hateHot || world.posture?.hateElevated || (pips !== null && pips >= 4)) {
          return `Alien hate is unobservable but visible estimate is ${pips !== null ? pips + '/5 diamonds' : 'elevated'} -- scored at 3x crossing50.`;
        }
        if (pips !== null && pips < 4) {
          return `Visible hate meter ${pips}/5 diamonds is below threshold -- scored at 1x stays-under-50.`;
        }
        return 'Alien hate is unobservable; scored conservatively at 3x crossing50.';
      }
      const projected = current + high;
      if (current < ALIEN_TOTAL_WAR_HATE && projected >= ALIEN_TOTAL_WAR_HATE) {
        return `Current hate ${current.toFixed(1)} + up to ${high} would cross the irreversible Total War `
          + `line at ${ALIEN_TOTAL_WAR_HATE} -- scored at 10x.`;
      }
      if (current < ALIEN_HATE_WAR_THRESHOLD && projected >= ALIEN_HATE_WAR_THRESHOLD) {
        return `Current hate ${current.toFixed(1)} + up to ${high} would cross the war threshold at `
          + `${ALIEN_HATE_WAR_THRESHOLD} -- scored at 3x.`;
      }
      return `Current hate ${current.toFixed(1)} + up to ${high} stays clear of the next threshold -- scored at 1x.`;
    },
    source: 'docs/directive-rule-engine-plan.md §2 -- cost ladder is ASSUMPTION, tunable weights, anchored on '
      + 'the war/Total War thresholds from wiki Diplomacy (rev 2026-08-11).',
    estimateClass: 'heuristic'
  },
  {
    id: 'legality/executive-last',
    kind: 'veto',
    appliesTo: (candidate) => candidate.family === 'expansion' && candidate.target?.isExecutive === true,
    evaluate(world, candidate) {
      const cpCount = toFiniteNumber(candidate.value?.cpCountInNation);
      if (cpCount === null) return 'unknown';
      if (cpCount === 1) return 'pass';
      const allOtherCpsOwnedByObserver = candidate.value?.allOtherCpsOwnedByObserver;
      if (allOtherCpsOwnedByObserver === null || allOtherCpsOwnedByObserver === undefined) return 'unknown';
      return allOtherCpsOwnedByObserver ? 'pass' : 'veto';
    },
    because(world, candidate) {
      const nation = candidate.target?.nation;
      const cpCount = candidate.value?.cpCountInNation;
      if (cpCount === 1) return `${nation} has only one control point, so executive-last is trivially satisfied.`;
      const owned = candidate.value?.allOtherCpsOwnedByObserver;
      if (owned === null || owned === undefined) {
        return `Cannot confirm whether every other control point in ${nation} is ours -- ownership of the `
          + 'other CPs is unmeasurable from this snapshot.';
      }
      return owned
        ? `Every other control point in ${nation} is already ours, so the executive seat can be taken last.`
        : `${nation} has ${cpCount} control points and at least one non-executive CP is not ours yet -- `
          + 'executive-last blocks taking the executive seat first.';
    },
    source: 'Notion 09 -- executive control points can only be taken last, after every other CP in the nation is held.',
    estimateClass: 'exact'
  },
  {
    id: 'legality/no-territory',
    kind: 'veto',
    appliesTo: (candidate) => candidate.family === 'expansion',
    evaluate(world, candidate) {
      const regionsCount = candidate.value?.regionsCount;
      if (regionsCount === null || regionsCount === undefined) return 'unknown';
      return regionsCount > 0 ? 'pass' : 'veto';
    },
    because(world, candidate) {
      const nation = candidate.target?.nation;
      const cls = candidate.value?.territoryClass;
      if (cls === 'unformed') {
        return `${nation} has 0 regions and 0 population -- the nation has not formed yet; this is a future `
          + 'opportunity tied to a formation project, not a takeable CP.';
      }
      if (cls === 'absorbed') {
        return `${nation} has 0 regions despite population on record -- its territory has been absorbed into `
          + 'a bloc; the control point is a ghost.';
      }
      return `${nation} reports 0 regions in this snapshot.`;
    },
    source: 'Live-save analysis (docs/directive-rule-engine-plan.md §4a): unclaimed CPs split into unformed '
      + 'placeholder nations, nations absorbed into blocs, and real territory. regionsCount > 0 is the decisive filter.',
    estimateClass: 'exact'
  },
  {
    id: 'legality/story-gate',
    kind: 'veto',
    appliesTo: (candidate) => candidate.missionType === 'Detain' && candidate.target?.kind === 'alienCouncilor',
    evaluate(world, candidate) {
      const canDetain = world.capabilities?.canDetainAlienCouncilors;
      if (canDetain === true) return 'pass';
      if (canDetain === false) return 'veto';
      return 'unknown';
    },
    because(world, candidate) {
      const canDetain = world.capabilities?.canDetainAlienCouncilors;
      if (canDetain === true) return `${ALIEN_DETAIN_STORY_GATE} is available, so Detain against alien councilors is unlocked.`;
      if (canDetain === false) return `${ALIEN_DETAIN_STORY_GATE} is not available -- Detain mission against aliens is story-locked.`;
      return `${ALIEN_DETAIN_STORY_GATE} status is not observable in this snapshot -- cannot verify whether Detain on aliens is unlocked.`;
    },
    source: `Game story gates (${ALIEN_DETAIN_STORY_GATE} required for alien councilor detention).`,
    estimateClass: 'exact'
  },
  {
    id: 'value/gdp-per-cp-cost',
    kind: 'score',
    appliesTo: (candidate) => candidate.family === 'expansion' && Number.isFinite(candidate.value?.gdpBn),
    evaluate(world, candidate) {
      const gdpBn = candidate.value.gdpBn;
      if (!(gdpBn > 0)) return 0;
      const cpCount = toFiniteNumber(candidate.value.cpCountInNation) || 1;
      const outputPerCp = gdpBn / cpCount;
      // Notion 09's CP-cost formula. The absolute scale is unverified (plan
      // §4a: councilor-derived capacity and this formula land an order of
      // magnitude apart on the live save) -- what IS verified is that cost
      // is sublinear in GDP while output splits evenly, so value density
      // rises with GDP. That ordering is all v1 relies on.
      const cpCost = gdpBn ** 0.6 / 2;
      if (!(cpCost > 0)) return 0;
      const valueDensity = outputPerCp / cpCost;
      return valueDensity * getWeights(world).VALUE_POINTS;
    },
    because(world, candidate) {
      const gdpBn = candidate.value.gdpBn;
      if (!(gdpBn > 0)) return 'GDP is not available for this control point, so no value density can be scored.';
      const cpCount = toFiniteNumber(candidate.value.cpCountInNation) || 1;
      const outputPerCp = gdpBn / cpCount;
      const cpCost = gdpBn ** 0.6 / 2;
      const valueDensity = cpCost > 0 ? outputPerCp / cpCost : 0;
      return `${candidate.target.nation} ($${gdpBn.toFixed(1)}Bn GDP) splits output across ${cpCount} control `
        + `point(s); CP cost ≈ GDP_Bn^0.6/2 = ${cpCost.toFixed(2)} (Notion 09, absolute scale unverified). `
        + `Value density ${valueDensity.toFixed(3)}.`;
    },
    source: 'Notion 09 -- output ÷ (GDP_Bn^0.6 / 2); docs/directive-rule-engine-plan.md §3, §4a.',
    estimateClass: 'heuristic'
  },
  {
    id: 'value/defend-interests',
    kind: 'score',
    appliesTo: (candidate) => candidate.missionType === 'Defend Interests' && candidate.value?.isDefendInterests === true,
    evaluate(world, candidate) {
      const gdpBn = toFiniteNumber(candidate.value?.gdpBn) || 0;
      const gdpDensity = gdpBn > 0
        ? (gdpBn / (gdpBn ** 0.6 / 2)) * getWeights(world).DEFENSE.gdpDensityPoints
        : 0;
      const escalateLateBonus = world.posture?.escalateLate === true ? getWeights(world).DEFENSE.escalateLateBonus : 0;
      return getWeights(world).DEFENSE.base + gdpDensity + escalateLateBonus;
    },
    because(world, candidate) {
      const nation = candidate.target?.nation || 'core holding';
      const escalateLate = world.posture?.escalateLate === true;
      const unprotected = candidate.value?.unprotectedControlPointCount;
      const unknown = candidate.value?.defenseUnknownCount;
      const coverage = unknown > 0
        ? `${unknown} control point${unknown === 1 ? '' : 's'} have unmeasured existing coverage`
        : unprotected === 0
          ? 'the current ward is approaching renewal'
          : `${unprotected} control point${unprotected === 1 ? '' : 's'} need${unprotected === 1 ? 's' : ''} coverage`;
      return escalateLate
        ? `Defending ${nation} (${coverage}) wards core GDP at 0 alien hate while offensive operations are deferred under escalate-late doctrine.`
        : `Defending ${nation} (${coverage}) wards core GDP at 0 alien hate against rival subversion.`;
    },
    source: 'Notion 09 (Defend Interests protects majors); TIMissionTemplate flat 20 Influence cost.',
    estimateClass: 'heuristic'
  },
  {
    id: 'value/counter-councilor',
    kind: 'score',
    appliesTo: (candidate) => candidate.family === 'council' && candidate.isFallback !== true && candidate.missionType !== 'Defend Interests',
    evaluate(world, candidate) {
      const base = candidate.missionType === 'Turn Councilor'
        ? getWeights(world).COUNCIL.turn
        : getWeights(world).COUNCIL.investigate;
      return base + (candidate.value?.targetIsProxy === true ? getWeights(world).COUNCIL.proxyTargetBonus : 0);
    },
    because(world, candidate) {
      const who = candidate.target?.councilorName || 'this councilor';
      const proxy = candidate.value?.targetIsProxy === true;
      const stem = candidate.missionType === 'Turn Councilor'
        ? `Turning ${who} takes them off the enemy board and puts an agent inside their faction, at zero alien hate on success`
        : `Investigating ${who} is free on every outcome and unlocks both Turn's secrets precondition and a masked Loyalty`;
      return proxy
        ? `${stem}. Their faction is an alien proxy, which both feeds alien hate and is a real strategic adversary (Notion 02).`
        : `${stem}.`;
    },
    source: 'Notion 02 (Protectorate as a real adversary); TIMissionTemplate zero-hate success rows. '
      + 'Weights are calibrated judgement -- see WEIGHTS.COUNCIL.',
    estimateClass: 'heuristic'
  },
  {
    id: 'readiness/unmet-preconditions',
    kind: 'score',
    appliesTo: (candidate) => Array.isArray(candidate.unmetPreconditions) && candidate.unmetPreconditions.length > 0,
    evaluate(world, candidate) {
      // A discount, not a veto: the precondition is unverifiable rather than
      // known-unmet, so the action may well be available in-game. But
      // "recommended right now" should prefer something we can confirm is
      // actionable when values are otherwise close.
      return -(getWeights(world).UNMET_PRECONDITION_PENALTY * candidate.unmetPreconditions.length);
    },
    because(world, candidate) {
      const n = candidate.unmetPreconditions.length;
      return `${n} precondition${n === 1 ? '' : 's'} cannot be confirmed from this snapshot, so this ranks `
        + 'below an equally valuable action we know is available.';
    },
    source: 'docs/directive-rule-engine-plan.md §4 -- Turn\'s HasSpySlot and HasIntelOnCouncilorSecrets are '
      + 'not in the snapshot and must not be presented as satisfiable.',
    estimateClass: 'heuristic'
  },
  {
    id: 'value/unblock-alien-response',
    kind: 'score',
    appliesTo: (candidate) => candidate.family === 'intelligence',
    evaluate(world, candidate) {
      if (candidate.value?.capabilityUnlockedUnused === true) {
        const escalateLate = world.posture?.escalateLate === true;
        return getWeights(world).INTELLIGENCE.unblockSightings
          + (escalateLate ? getWeights(world).INTELLIGENCE.escalateLateBonus : 0);
      }
      return getWeights(world).INTELLIGENCE.detainAlien;
    },
    because(world, candidate) {
      if (candidate.value?.capabilityUnlockedUnused !== true) {
        return 'Detaining a sighted alien operative removes them from Earth without triggering retaliation.';
      }
      return world.posture?.escalateLate === true
        ? 'Alien tracking is unlocked and unused, which blocks every downstream alien action. '
          + 'Escalate-late posture makes that worse: the fleet cannot absorb what it cannot see.'
        : 'Alien tracking is unlocked and unused, which blocks every downstream alien action.';
    },
    source: 'docs/directive-rule-engine-plan.md §5; weights are judgement -- see WEIGHTS.INTELLIGENCE.',
    estimateClass: 'heuristic'
  },
  {
    id: 'cost/affordability',
    kind: 'veto',
    appliesTo: (candidate) => candidate.cost !== null && candidate.cost !== undefined && candidate.cost.kind === 'flat',
    evaluate(world, candidate) {
      const amount = toFiniteNumber(candidate.cost.amount);
      if (amount === null) return 'unknown';
      const stock = world.resources ? toFiniteNumber(world.resources[candidate.cost.resource]) : null;
      if (stock === null) return 'unknown';
      return amount > stock ? 'veto' : 'pass';
    },
    because(world, candidate) {
      const amount = candidate.cost?.amount;
      const stock = world.resources ? world.resources[candidate.cost.resource] : undefined;
      if (amount === null || amount === undefined) return 'Flat cost amount is not resolvable for this candidate.';
      const stockNumber = toFiniteNumber(stock);
      if (stockNumber === null) {
        return `${candidate.cost.resource} stock is not available in this snapshot -- affordability cannot be confirmed.`;
      }
      return amount > stockNumber
        ? `Costs ${amount} ${candidate.cost.resource}, only ${stockNumber} in stock.`
        : `Costs ${amount} ${candidate.cost.resource}; ${stockNumber} in stock covers it.`;
    },
    source: 'Notion 09 / TIMissionTemplate -- Defend Interests is a verified flat 20 Influence cost; '
      + 'generalised here to any flat-cost mission candidate.',
    estimateClass: 'exact'
  }
]);

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function evaluateVetoes(world, candidate) {
  return RULES
    .filter((rule) => rule.kind === 'veto' && rule.appliesTo(candidate))
    .map((rule) => ({ rule, outcome: rule.evaluate(world, candidate) }));
}

/**
 * candidates -> { surviving, rejected, uncertain }.
 *
 * A candidate is rejected if ANY applicable veto rule returns 'veto'. Absent
 * a veto, it is uncertain if ANY applicable veto rule returns 'unknown' --
 * confidence-downgraded but never silently promoted to surviving, and never
 * silently demoted to rejected. Only when every applicable veto rule passes
 * does the candidate survive.
 */
function applyRules(world, candidates) {
  const surviving = [];
  const rejected = [];
  const uncertain = [];

  for (const candidate of candidates) {
    const results = evaluateVetoes(world, candidate);
    const vetoes = results.filter((r) => r.outcome === 'veto');
    const unknowns = results.filter((r) => r.outcome === 'unknown');

    if (vetoes.length > 0) {
      rejected.push({
        candidate,
        reasons: vetoes.map((v) => ({ ruleId: v.rule.id, reason: v.rule.because(world, candidate), source: v.rule.source }))
      });
    } else if (unknowns.length > 0) {
      uncertain.push({
        candidate: {
          ...candidate,
          provenance: { ...candidate.provenance, confidenceDowngradedBy: unknowns.map((u) => u.rule.id) }
        },
        reasons: unknowns.map((u) => ({ ruleId: u.rule.id, reason: u.rule.because(world, candidate), source: u.rule.source }))
      });
    } else {
      surviving.push({ candidate });
    }
  }

  return { surviving, rejected, uncertain };
}

/**
 * score = value - hateCost - resourceCost (plan §3 objective function).
 * value and hateCost come from the applicable 'score' rules; resourceCost is
 * computed directly here from candidate.cost, since none of the six named
 * rules cover it and it is a straightforward ratio rather than a judgement
 * ladder. It is recorded as a calculated breakdown entry so the explanation
 * can show the cost that lowered a recommendation's score. A candidate whose
 * cost amount is unfillable (Turn/Investigate's
 * bonus cost, per plan §4) or whose stock is unmeasured contributes 0 to
 * resourceCost -- score-neutral, not a claim that the cost is actually zero
 * (the safety-relevant version of "can we afford this" is the
 * cost/affordability VETO above, which correctly returns 'unknown' rather
 * than a number when stock is unmeasured).
 */
function computeResourceCost(world, candidate) {
  if (!candidate.cost || candidate.cost.amount === null || candidate.cost.amount === undefined) return 0;
  const stock = world.resources ? toFiniteNumber(world.resources[candidate.cost.resource]) : null;
  if (stock === null || !(stock > 0)) return 0;
  return (candidate.cost.amount / stock) * getWeights(world).RESOURCE_POINTS;
}

function scoreCandidates(world, candidates) {
  return candidates.map((candidate) => {
    const scoreRules = RULES.filter((rule) => rule.kind === 'score' && rule.appliesTo(candidate));
    const breakdown = scoreRules.map((rule) => ({
      ruleId: rule.id,
      contribution: rule.evaluate(world, candidate),
      reason: rule.because(world, candidate),
      source: rule.source,
      estimateClass: rule.estimateClass
    }));
    const resourceCost = computeResourceCost(world, candidate);
    if (resourceCost > 0) {
      breakdown.push({
        ruleId: 'resource-cost',
        contribution: -resourceCost,
        reason: `Consumes ${resourceCost.toFixed(2)} configured resource-cost points.`,
        source: 'directiveEngine objective function',
        estimateClass: 'calculated'
      });
    }
    const total = breakdown.reduce((sum, entry) => sum + (Number.isFinite(entry.contribution) ? entry.contribution : 0), 0);
    return { ...candidate, score: total, scoreBreakdown: breakdown, resourceCost };
  });
}

/**
 * The explicit fallback when every generated candidate is vetoed. Never
 * null, never an empty state, and its title names a preparation action rather
 * than reading as a bare prohibition -- the same structural fix the plan
 * describes for the old geo-hold directive.
 *
 * `family` doesn't fit the normal expansion/council/intelligence split; it
 * is tagged 'council' as the closest fit (this is posture-level advice, not
 * a specific mission), and callers can key off `isFallback` instead of
 * `family` if they need to distinguish it.
 */
function buildPreparationFallbackCandidate(world, rejected, uncertain) {
  return {
    id: 'prepare-next-action',
    family: 'council',
    missionType: 'Prepare',
    title: 'Protect strategic posture and prepare the next actionable move',
    recommendation: 'Maintain defensive coverage, resolve the missing intelligence, and revisit the highest-value operation next cycle.',
    target: { kind: 'none', nation: null, faction: null, controlPointType: null, isExecutive: null },
    hate: { toAliens: { low: 0, high: 0 }, note: 'Holding spends no hate.' },
    cost: null,
    value: { rejectedCount: rejected.length, uncertainCount: uncertain.length },
    score: null,
    provenance: {
      source: 'directiveEngine preparation fallback -- every generated candidate this cycle was vetoed or is unmeasurable',
      estimateClass: 'exact'
    },
    unmetPreconditions: [],
    isFallback: true
  };
}

function buildDecisionReasoning(primary, alternatives, rejected, uncertain, futureOpportunities, candidateCount) {
  const breakdown = Array.isArray(primary?.scoreBreakdown) ? primary.scoreBreakdown : [];
  const factors = breakdown.filter(entry => Number(entry.contribution) > 0);
  const tradeoffs = breakdown.filter(entry => Number(entry.contribution) < 0);
  const confidenceDowngraded = primary?.isFallback
    ? uncertain.length > 0
    : Boolean(
      primary?.provenance?.confidenceDowngradedBy?.length
      || primary?.unmetPreconditions?.length
    );
  const sources = [...new Set([
    primary?.provenance?.source,
    ...breakdown.map(entry => entry.source),
    ...((primary?.provenance?.confidenceDowngradedBy || []).map(String)),
    ...rejected.flatMap(entry => (entry.vetoReasons || []).map(reason => reason.source)),
    ...uncertain.flatMap(entry => (entry.uncertaintyReasons || []).map(reason => reason.source))
  ].filter(Boolean))];
  const counts = {
    generated: candidateCount,
    recommended: primary && !primary.isFallback ? 1 : 0,
    alternatives: alternatives.length,
    uncertain: uncertain.length,
    rejected: rejected.length,
    future: futureOpportunities.length
  };
  return {
    heading: 'Why this action',
    summary: primary?.isFallback
      ? 'No mission could be fully cleared from the available evidence, so the recommendation is a positive preparation step: protect the current posture and resolve the blockers.'
      : `${primary.title} ranks highest among the candidates that cleared the available safety and legality checks.`,
    selectionMethod: 'The engine combines configured value, alien-hate exposure, resource cost, and readiness. Rejected or unmeasurable candidates are shown as trade-offs, never as recommendations.',
    factors,
    tradeoffs,
    counts,
    confidence: confidenceDowngraded ? 'conditional' : 'supported',
    sources
  };
}

/**
 * Wraps a set of already-computed snapshot-derived inputs into the frozen
 * world object the rest of this module reads. `posture` is expected to be
 * the output of directiveAdvisor.assessCampaignPosture -- computed once by
 * the caller (briefingGenerator already does this for its own directives),
 * not recomputed here, per "reuse posture/proxy logic, not replace."
 */
function buildWorld({
  observerId = null,
  observerName = null,
  posture = null,
  campaignDate = null,
  resources = null,
  nations = [],
  councilors = [],
  capabilities = {},
  alienIntelligenceStage = null,
  directiveWeights = null,
  missionSpecs = null,
  alienHate = null,
  alienThreat = null
} = {}) {
  return Object.freeze({
    observerId,
    observerName,
    posture: posture || {},
    campaignDate,
    resources: resources || null,
    nations: Array.isArray(nations) ? nations : [],
    councilors: Array.isArray(councilors) ? councilors : [],
    capabilities: capabilities || {},
    directiveWeights: directiveWeights || null,
    // Survives player-mode filtering when the raw alien councilor list does
    // not, so it is the only signal for "capability on, nothing sighted".
    alienIntelligenceStage: alienIntelligenceStage || null,
    missionSpecs: missionSpecs || null,
    alienHate: alienHate || null,
    alienThreat: alienThreat || null
  });
}

/**
 * generateCandidates -> applyRules -> scoreCandidates -> primary = max(surviving).
 *
 * Reclassification: a candidate rejected specifically because it is an
 * unformed nation (legality/no-territory, territoryClass === 'unformed') is
 * moved out of `rejected` and into `futureOpportunities`. Per the plan, an
 * unformed nation's unclaimed CP is not a takeable-but-blocked action, it is
 * a DIFFERENT kind of advice -- "this becomes available once a formation
 * project fires" -- so it does not belong on the same "here's what we
 * rejected and why" board as a genuinely illegal move. Absorbed nations
 * (population > 0, 0 regions) stay in `rejected`: their territory is gone
 * for good, there is no future project that un-absorbs them.
 */
function runEngine(world) {
  const candidates = generateCandidates(world);
  const { surviving, rejected, uncertain } = applyRules(world, candidates);

  const finalRejected = [];
  const futureOpportunities = [];
  for (const entry of rejected) {
    if (entry.candidate.value?.territoryClass === 'unformed') {
      futureOpportunities.push({
        ...entry.candidate,
        unmetPreconditions: [
          ...entry.candidate.unmetPreconditions,
          `${entry.candidate.target.nation} has not formed yet (0 regions, 0 population) -- this control `
            + 'point becomes takeable only after its formation project or event fires.'
        ]
      });
    } else {
      finalRejected.push(entry);
    }
  }

  const scoredSurviving = scoreCandidates(world, surviving.map((e) => e.candidate));

  // Every list is a flat array of candidates, and a candidate carries its own
  // reasons. The alternative -- candidates in some lists and { candidate,
  // reasons } wrappers in others -- makes every consumer branch on which list
  // it happens to be reading.
  const scoredUncertain = scoreCandidates(world, uncertain.map((e) => e.candidate))
    .map((candidate, i) => ({ ...candidate, uncertaintyReasons: uncertain[i].reasons }));
  const rejectedCandidates = finalRejected.map((entry) => ({
    ...entry.candidate,
    vetoReasons: entry.reasons
  }));

  const ownCouncilors = Array.isArray(world.councilors)
    ? world.councilors.filter((c) => !world.observerId || sameId(c.factionId, world.observerId) || c.isObserver)
    : [];

  const cyclePlan = allocateCyclePlan(scoredSurviving, ownCouncilors, world);

  let primary;
  let alternatives;
  if (cyclePlan.assignments.length > 0) {
    primary = {
      ...cyclePlan.assignments[0].candidate,
      assignedCouncilor: cyclePlan.assignments[0].councilor,
      assignment: cyclePlan.assignments[0]
    };
    alternatives = cyclePlan.assignments.slice(1).map((a) => a.candidate);
  } else if (scoredSurviving.length > 0) {
    const sorted = [...scoredSurviving].sort((a, b) => b.score - a.score);
    [primary, ...alternatives] = sorted;
  } else {
    primary = buildPreparationFallbackCandidate(world, rejectedCandidates, scoredUncertain);
    alternatives = [];
  }

  return {
    primary,
    alternatives,
    rejected: rejectedCandidates,
    uncertain: scoredUncertain,
    futureOpportunities,
    cyclePlan,
    decisionReasoning: buildDecisionReasoning(
      primary,
      alternatives,
      rejectedCandidates,
      scoredUncertain,
      futureOpportunities,
      candidates.length
    )
  };
}

module.exports = {
  WEIGHTS,
  RULES,
  buildWorld,
  generateOpenControlPointCandidates,
  generateDefendInterestsCandidates,
  generateCouncilCandidates,
  generateIntelligenceCandidates,
  generateCandidates,
  applyRules,
  scoreCandidates,
  runEngine,
  buildDecisionReasoning,
  // Exposed for tests and for callers (e.g. a future UI) that want the
  // shared posture formatter without re-deriving it.
  formatShipPosture: directiveAdvisor.formatShipPosture
};
