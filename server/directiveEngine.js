/**
 * Directive Rule Engine — v1
 *
 * Turns a frozen "world" snapshot into a ranked set of concrete action
 * candidates, using data-driven rules instead of the hand-tuned policyRank
 * ladder in briefingGenerator.js. See docs/directive-rule-engine-plan.md for
 * the full design; this module implements the P3/P4/P5 subset described
 * there: open-control-point expansion, the zero-hate Investigate->Turn
 * council axis, the "capability without sighting" intelligence gap, and the
 * six named rules in the plan's rule table.
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
 * action. If every generated candidate is vetoed, `no-safe-action` is
 * returned explicitly -- never null, never an empty state.
 *
 * Pure module: no I/O, no network, no filesystem. Only requires
 * ./directiveAdvisor, ./alienHateEconomics, and node builtins, so the same
 * logic runs identically in tests, the local server, and any future export
 * path.
 */

const directiveAdvisor = require('./directiveAdvisor');
const { ALIEN_HATE_WAR_THRESHOLD, ALIEN_TOTAL_WAR_HATE } = require('./alienHateEconomics');

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

  // Scales resourceCost = spend / stock in the objective function.
  RESOURCE_POINTS: 1,

  // How many lowest-Loyalty enemy councilors to generate Investigate/Turn
  // candidates for. Not a game constant -- just keeps the candidate list
  // bounded. Tunable.
  TOP_N_COUNCIL_TARGETS: 3
});

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
    value: { targetLoyalty: loyalty },
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
      toAliens: { low: 0, high: 0 },
      note: 'TIMissionTemplate Turn Councilor hate row is [0,3,3,0,0,0] -- zero on the normal- and '
        + 'critical-success slots (index 4-5). The two failure slots cost 3 each; this candidate scores the '
        + 'expected-success outcome, not the failure branch.'
    },
    // Bonus-cost mission: the amount scales with the roll and is genuinely
    // unfillable without a success-odds calculator (plan §4 / Notion 09,14),
    // which is out of scope for v1. Absent stays null.
    cost: { resource: 'Influence', amount: null, kind: 'bonus' },
    value: { targetLoyalty: loyalty },
    score: null,
    provenance: {
      source: 'TIMissionTemplate Turn Councilor outcome array, slots 4-5',
      estimateClass: 'exact'
    },
    unmetPreconditions: [
      'HasSpySlot is not present in this snapshot -- cannot confirm a free spy slot exists on this target.',
      'HasIntelOnCouncilorSecrets is not present in this snapshot -- investigationConfidence reports the '
        + 'snapshot MODE (e.g. OMNISCIENT), not per-councilor secret depth, and is not a substitute.'
    ]
  };
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
      .slice(0, WEIGHTS.TOP_N_COUNCIL_TARGETS);
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
  for (const { councilor } of scored.slice(0, WEIGHTS.TOP_N_COUNCIL_TARGETS)) {
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
 * and does not apply here. Budget-gated by hate/total-war-budget below.
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

  for (const alien of visibleAliens) {
    candidates.push({
      id: `detain-alien:${alien.ID}`,
      family: 'intelligence',
      missionType: 'Detain',
      title: `Detain ${alien.displayName} -- alien operative sighted`,
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
      cost: { resource: 'Operations', amount: null, kind: 'bonus' },
      value: { alienCouncilorId: alien.ID },
      score: null,
      provenance: {
        source: 'wiki Diplomacy § "Actions that affect hatred" (post-1.0)',
        estimateClass: 'exact'
      },
      unmetPreconditions: []
    });
  }

  return candidates;
}

function generateCandidates(world) {
  return [
    ...generateOpenControlPointCandidates(world),
    ...generateCouncilCandidates(world),
    ...generateIntelligenceCandidates(world)
  ];
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
      const budget = headroom * WEIGHTS.TOTAL_WAR_SAFETY_MARGIN;
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
      const budget = headroom * WEIGHTS.TOTAL_WAR_SAFETY_MARGIN;
      return high > budget
        ? `Up to ${high} hate exceeds the safety-margined Total War budget `
          + `(${headroom.toFixed(1)} headroom × ${WEIGHTS.TOTAL_WAR_SAFETY_MARGIN} = ${budget.toFixed(1)}).`
        : `Up to ${high} hate is within the safety-margined Total War budget `
          + `(${headroom.toFixed(1)} headroom × ${WEIGHTS.TOTAL_WAR_SAFETY_MARGIN} = ${budget.toFixed(1)}).`;
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
      let weight = WEIGHTS.HATE_CROSSING.staysUnder50;
      if (current !== null && current !== undefined && Number.isFinite(current)) {
        const projected = current + high;
        if (current < ALIEN_TOTAL_WAR_HATE && projected >= ALIEN_TOTAL_WAR_HATE) {
          weight = WEIGHTS.HATE_CROSSING.crossing200;
        } else if (current < ALIEN_HATE_WAR_THRESHOLD && projected >= ALIEN_HATE_WAR_THRESHOLD) {
          weight = WEIGHTS.HATE_CROSSING.crossing50;
        }
      }
      // current === null (redacted player-mode hate) falls through to the
      // conservative staysUnder50 (1x) weight rather than guessing a
      // crossing -- this is a scoring heuristic, not a safety gate (the
      // safety gate is hate/total-war-budget above), so a defensible
      // default is used instead of a three-outcome unknown.
      return -(mid * weight * WEIGHTS.HATE_POINTS);
    },
    because(world, candidate) {
      const { low, high } = candidate.hate.toAliens;
      const mid = (low + high) / 2;
      if (!(mid > 0)) return 'No expected alien hate from this action.';
      const current = world.posture ? world.posture.actualAlienHate : null;
      if (current === null || current === undefined || !Number.isFinite(current)) {
        return 'Alien hate is unobservable this cycle; scored at the default 1x (stays-under-50) weight '
          + 'rather than guessing a crossing.';
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
      return valueDensity * WEIGHTS.VALUE_POINTS;
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
 * ladder. A candidate whose cost amount is unfillable (Turn/Investigate's
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
  return (candidate.cost.amount / stock) * WEIGHTS.RESOURCE_POINTS;
}

function scoreCandidates(world, candidates) {
  return candidates.map((candidate) => {
    const scoreRules = RULES.filter((rule) => rule.kind === 'score' && rule.appliesTo(candidate));
    const breakdown = scoreRules.map((rule) => ({
      ruleId: rule.id,
      contribution: rule.evaluate(world, candidate),
      reason: rule.because(world, candidate)
    }));
    const resourceCost = computeResourceCost(world, candidate);
    const total = breakdown.reduce((sum, entry) => sum + (Number.isFinite(entry.contribution) ? entry.contribution : 0), 0)
      - resourceCost;
    return { ...candidate, score: total, scoreBreakdown: breakdown, resourceCost };
  });
}

/**
 * The explicit fallback when every generated candidate is vetoed. Never
 * null, never an empty state, and its title names an action (hold and
 * preserve posture) rather than reading as a bare prohibition -- the same
 * structural fix the plan describes for the old geo-hold directive.
 *
 * `family` doesn't fit the normal expansion/council/intelligence split; it
 * is tagged 'council' as the closest fit (this is posture-level advice, not
 * a specific mission), and callers can key off `isFallback` instead of
 * `family` if they need to distinguish it.
 */
function buildNoSafeActionCandidate(world, rejected, uncertain) {
  return {
    id: 'no-safe-action',
    family: 'council',
    missionType: 'Hold',
    title: 'No safe action survives this cycle -- hold and preserve posture',
    target: { kind: 'none', nation: null, faction: null, controlPointType: null, isExecutive: null },
    hate: { toAliens: { low: 0, high: 0 }, note: 'Holding spends no hate.' },
    cost: null,
    value: { rejectedCount: rejected.length, uncertainCount: uncertain.length },
    score: null,
    provenance: {
      source: 'directiveEngine fallback -- every generated candidate this cycle was vetoed or is unmeasurable',
      estimateClass: 'exact'
    },
    unmetPreconditions: [],
    isFallback: true
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
  resources = null,
  nations = [],
  councilors = [],
  capabilities = {},
  alienIntelligenceStage = null
} = {}) {
  return Object.freeze({
    observerId,
    observerName,
    posture: posture || {},
    resources: resources || null,
    nations: Array.isArray(nations) ? nations : [],
    councilors: Array.isArray(councilors) ? councilors : [],
    capabilities: capabilities || {},
    // Survives player-mode filtering when the raw alien councilor list does
    // not, so it is the only signal for "capability on, nothing sighted".
    alienIntelligenceStage: alienIntelligenceStage || null
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
  const scoredUncertainCandidates = scoreCandidates(world, uncertain.map((e) => e.candidate));
  const scoredUncertain = uncertain.map((entry, i) => ({ ...entry, candidate: scoredUncertainCandidates[i] }));

  let primary;
  let alternatives;
  if (scoredSurviving.length > 0) {
    const sorted = [...scoredSurviving].sort((a, b) => b.score - a.score);
    [primary, ...alternatives] = sorted;
  } else {
    primary = buildNoSafeActionCandidate(world, finalRejected, scoredUncertain);
    alternatives = [];
  }

  return {
    primary,
    alternatives,
    rejected: finalRejected,
    uncertain: scoredUncertain,
    futureOpportunities
  };
}

module.exports = {
  WEIGHTS,
  RULES,
  buildWorld,
  generateOpenControlPointCandidates,
  generateCouncilCandidates,
  generateIntelligenceCandidates,
  generateCandidates,
  applyRules,
  scoreCandidates,
  runEngine,
  // Exposed for tests and for callers (e.g. a future UI) that want the
  // shared posture formatter without re-deriving it.
  formatShipPosture: directiveAdvisor.formatShipPosture
};
