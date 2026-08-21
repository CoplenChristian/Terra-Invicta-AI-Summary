// shared/economicValue.mjs
//
// Economic valuation -- phase 3 of the research advisor (spec section 4).
//
// Phase 1 priced drives and phase 2 priced everything a warship is built out
// of. Both value what a research gate UNLOCKS. This module values what a tech
// or project DOES: the 275 effect templates that techs and projects actually
// reference, priced against the observer's own live figures.
//
// ---------------------------------------------------------------------------
// THE FAILURE THIS MODULE IS BUILT AROUND
// ---------------------------------------------------------------------------
//
// A tech whose value silently computes to 0 gets ranked last and never
// surfaces. That is worse than an error, because an error is visible. Spec
// section 4 calls it out by name and CLAUDE.md records it as this repo's most
// repeated defect class.
//
// So every priced row is one of three things and never two of them at once:
//
//   priced          a number, with the quantity and formula that produced it
//   inert           a MEASURED zero -- the effect genuinely changes nothing
//                   for this observer right now, and the reason says why
//                   (already at the ceiling, nothing queued to apply it to,
//                   the free allowance is not yet binding)
//   unpriceable     null, with the context named and the reason stated
//
// `inert` and `unpriceable` are different facts and must never share a value:
// "worth nothing" is a measurement, "not measurable" is a gap. Collapsing them
// is the same state-collapsing error section 3b exists to prevent for
// availability.
//
// ---------------------------------------------------------------------------
// STACKING CHANGES THE ANSWER
// ---------------------------------------------------------------------------
//
// An effect is not worth its face value; it is worth the difference between the
// observer's state with it and without it.
//
//   stackable Multiplicative   compounds with what is already active
//   non-stackable              worth nothing if the same effect is already held
//   IncreaseToValue            never stacks, and is worth NOTHING when the
//                              observer is already at or above the value
//   DecreaseToValue            the mirror image
//   SetToFixedValue            can be a DOWNGRADE, and is reported as one
//
// So the observer's active effect set is read first, from their completed
// projects and the finished global techs, and every price is a delta against
// that baseline rather than an absolute.
//
// ---------------------------------------------------------------------------
// WHAT IS PINNED AND WHAT IS NOT
// ---------------------------------------------------------------------------
//
// Phase 1 pinned delta-V against `currentMaxDeltaVKps` and phase 2 pinned
// kinetic damage against `damage_MJ`. The equivalent here is thinner, and the
// honest report of it is:
//
//   PINNED, against a figure the save itself states
//     mission control   ship `missionControlConsumption` plus the negative
//                       mission-control cost of hab core modules reproduces
//                       `missionControlUsage` EXACTLY for 7 of the 8 factions
//                       in the sampled save. One faction carries a residual the
//                       model does not explain; it is reported with the residual
//                       visible rather than hidden. This validates the quantity
//                       behind ShipMissionControlReduction,
//                       HabMissionControlReduction and MCFreeSpaceMineNetwork.
//
//   CROSS-CHECKED, against another part of the same snapshot
//     controlled GDP    summing nation GDP over the nations where the observer
//                       holds at least one control point reproduces
//                       `faction.totalGdp` exactly for all 8 factions in both
//                       modes. That is internal consistency, not a game output.
//     hab research      the summed `researchIncomeMonth` of the observer's hab
//                       modules equals `researchBreakdown.habModules`. Both come
//                       from the same reading upstream, so it is a consistency
//                       check and NOT an independent pin.
//
//   NOT PINNED -- no shipped figure exists to check them against
//     mining output     faction resource income also carries transfers, alien
//                       resource sharing and in-situ production, and the ratio
//                       of site output to income runs from 0.81 to 4.43 across
//                       the eight factions in the sampled save. There is no
//                       arithmetic that isolates the mining term, so the mining
//                       quantity is the summed SITE output and is labelled as
//                       such rather than being presented as validated.
//     the operations    Additive / Multiplicative / IncreaseToValue and the rest
//                       are read from their names. The game publishes no
//                       statement of what they mean, so the reading is MODELLED
//                       and every row that depends on it says so.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, round, sameId, toFiniteNumber as toFinite } from './util.mjs';

// ---------------------------------------------------------------------------
// PRICING STATES
// ---------------------------------------------------------------------------

export const PRICING_STATES = Object.freeze({
  /** A number was produced, from a measured quantity. */
  priced: 'priced',
  /**
   * A measured zero. The effect applies, the quantity it applies to is known,
   * and the product is genuinely nothing for this observer right now.
   * NEVER used for an unmeasured quantity -- that is `unpriceable`.
   */
  inert: 'inert',
  /** No number. The reason names the context or the missing quantity. */
  unpriceable: 'unpriceable'
});

/**
 * Why a row could not be priced. Expanded once per response; rows carry the
 * code. Prose repeated on 900 rows is 200 KB of the same sentence.
 */
export const UNPRICEABLE_CODES = Object.freeze({
  'no-quantity-mapping': 'this effect\'s context has no substantiated mapping to a quantity in the snapshot. The context is named on the row so it can be checked; no mapping was invented to make a number appear.',
  'quantity-unmeasured': 'the context maps to a quantity this snapshot does not measure for this observer, so the benefit is not quantifiable from this save.',
  'no-operation': 'the effect template states no operation, so there is no rule for combining it with what is already active.',
  'no-value': 'the effect template states no numeric value.',
  'unknown-operation': 'the effect states an operation this module has no semantics for. Guessing one would be indistinguishable from knowing it.',
  'effect-not-indexed': 'this effect is not in the baked effect index. Re-publish after upgrading; it is not evidence that the effect does nothing.',
  'instant-effect-unpriced': 'this is a one-time instant effect whose target quantity is not measured in the snapshot. The instant-effect kind is named on the row.',
  'grant-income-unmeasured': 'the resource is granted, but this snapshot records no monthly income figure for it, so the grant cannot be expressed as months of income. The absolute amount is still reported.',
  'grant-income-zero': 'the resource is granted, and this observer\'s measured monthly income in it is exactly zero -- so the grant is worth an unbounded number of months rather than a finite one. Reporting a number here would be a division by zero dressed up as a valuation; the absolute amount is reported instead.',
  'level-move-on-a-rate-context': 'this operation moves a LEVEL (raises to, lowers to, or sets a value) on a context whose mapped quantity is a monthly rate. Converting a level into a monthly figure needs the level\'s units, which the game states nowhere, so no number is produced. The level movement itself is reported under `levelChange`.',
  'baseline-unavailable': 'the observer\'s completed-project and finished-tech lists are not readable in this snapshot, so what is already active cannot be established and no delta can be computed.'
});

/** Why a measured zero is a zero. Same expand-once treatment. */
export const INERT_CODES = Object.freeze({
  'already-at-or-above-value': 'this operation raises the context TO a value and never stacks; the observer is already at or above it, so it changes nothing.',
  'already-at-or-below-value': 'this operation lowers the context TO a value and never stacks; the observer is already at or below it, so it changes nothing.',
  'already-held-and-not-stackable': 'this exact effect is already active and the template marks it non-stackable, so a second copy adds nothing.',
  'quantity-is-zero': 'the quantity this effect applies to is measured and is zero right now, so the effect has nothing to act on. It would be worth something once the quantity is non-zero.',
  'allowance-not-binding': 'the allowance this effect raises is not currently binding, so raising it saves nothing today.',
  'multiplier-is-unity': 'the effect\'s multiplier is exactly 1, so it changes nothing.',
  'value-is-zero': 'the effect\'s stated value is zero.'
});

// ---------------------------------------------------------------------------
// OPERATION SEMANTICS
// ---------------------------------------------------------------------------

/**
 * How each `operation` combines with what is already active.
 *
 * MODELLED. The game states the operation names and nothing else, so this is a
 * reading of those names, not a documented rule -- and `validatedAgainstGameOutput`
 * is false for every derivation that depends on it. It is written out here, once,
 * so the reading is auditable rather than buried in a switch statement.
 */
export const OPERATION_SEMANTICS = Object.freeze({
  Additive: Object.freeze({
    stacks: 'when the template marks it stackable',
    combines: 'sums with the additive total already active on the context',
    reading: 'the value is added to the context\'s running modifier. Where the context is a fraction (SpaceMiningBonus states 0.05) that is five percentage points, not five percent.'
  }),
  Multiplicative: Object.freeze({
    stacks: 'when the template marks it stackable',
    combines: 'multiplies the product already active on the context',
    reading: 'the value is a factor: 1.15 is +15%, 0.8 is -20%. Applied to the observer\'s CURRENT figure, so a second +15% is worth 15% of the already-boosted number.'
  }),
  IncreaseToValue: Object.freeze({
    stacks: 'never',
    combines: 'raises the context to the value, and does nothing if it is already at or above it',
    reading: 'a floor, not a bonus. The observer holding TargetingComputer2 (0.3) makes TargetingComputer1 (0.1) worth exactly nothing, and reporting it as a 0.1 gain would be a fabrication.'
  }),
  DecreaseToValue: Object.freeze({
    stacks: 'never',
    combines: 'lowers the context to the value, and does nothing if it is already at or below it',
    reading: 'the mirror of IncreaseToValue, used where lower is better (exploration range in AU).'
  }),
  SetToFixedValue: Object.freeze({
    stacks: 'never',
    combines: 'sets the context to the value regardless of what it was',
    reading: 'can be a DOWNGRADE. A set to a value below the current one is reported as a loss with the sign intact, never as an absolute-value gain.'
  })
});

// ---------------------------------------------------------------------------
// FORMULAE
// ---------------------------------------------------------------------------

/**
 * Every formula this module applies, in the wording the API reports.
 *
 * Section 7: a derived metric that cannot be traced is not usable, and a
 * template-derived fact must be visually distinct from a judgement call.
 * `validatedAgainstGameOutput` is the flag that keeps them distinct.
 */
export const ECONOMIC_FORMULAE = Object.freeze({
  multiplicativeDelta: Object.freeze({
    formula: 'deltaPerMonth = currentQuantity * (value - 1)',
    basis: 'a stackable multiplicative effect compounds on the CURRENT figure, so its worth is that figure times the fractional change. The quantities below are the observer\'s current output, so this needs no knowledge of what the base was. Where the snapshot figure is instead a PRE-modifier base, the true delta is larger by the multiplier already active, which is reported beside every row as `activeMultiplier` so the alternative reading is visible rather than hidden.',
    validatedAgainstGameOutput: false
  }),
  additiveFractionDelta: Object.freeze({
    formula: 'deltaPerMonth = currentQuantity * value',
    basis: 'an Additive effect on a fractional context (SpaceMiningBonus states 0.05) adds percentage points to a rate. Applied to the current quantity this is the monthly change. MODELLED: the game does not state that these contexts are fractions, but every value in them is between 0 and 1 while the counted contexts (MCFreeSpaceMineNetwork, CouncilSize) carry whole numbers, and the two are handled separately for that reason.',
    validatedAgainstGameOutput: false
  }),
  additiveCountDelta: Object.freeze({
    formula: 'delta = value, in the context\'s own unit',
    basis: 'an Additive effect on a counted context adds whole units -- three more free mines, one more council seat. No quantity multiplication is involved and none is invented.',
    validatedAgainstGameOutput: false
  }),
  raiseToValueDelta: Object.freeze({
    formula: 'levelChange.delta = value - currentLevel, and the effect is inert when currentLevel >= value',
    basis: 'IncreaseToValue never stacks. The current level is the highest value already active on the context, read from the observer\'s completed projects and finished global techs. This produces a LEVEL movement, not a monthly quantity: converting one into the other needs the level\'s units, which the game states nowhere, so a level move on a rate context is reported as unpriceable with the movement attached rather than multiplied into a number.',
    validatedAgainstGameOutput: false
  }),
  freeMineAllowance: Object.freeze({
    formula: 'missionControlSaved = min(value, max(0, mineCount - freeMineAllowance))',
    basis: 'mines beyond the free allowance are what cost mission control, so raising the allowance saves nothing until the allowance is binding. The allowance is the additive total of MCFreeSpaceMineNetwork already active; the mine count is the observer\'s hab sites carrying a mine module.',
    validatedAgainstGameOutput: false
  }),
  missionControlUsage: Object.freeze({
    formula: 'missionControlUsage = sum(ships[].missionControlConsumption) + abs(sum(negative missionControl of hab core modules))',
    basis: 'PINNED. Reproduces the save\'s own `missionControlUsage` EXACTLY for 7 of the 8 factions in the sampled save (measured 2026-08-21). The eighth carries a residual of 40 that this decomposition does not explain and it is reported with the residual visible, exactly as phase 1 reports alien hulls whose acceleration the model does not reproduce.',
    validatedAgainstGameOutput: true
  }),
  controlledGdp: Object.freeze({
    formula: 'controlledNationGdp = sum(GDP of every nation where the observer holds at least one control point)',
    basis: 'CROSS-CHECKED: reproduces `faction.totalGdp` exactly for all 8 factions in both modes. That is internal consistency with another part of the snapshot, not agreement with a figure the game publishes, and it is labelled as the former.',
    validatedAgainstGameOutput: false
  }),
  miningOutput: Object.freeze({
    formula: 'miningOutputPerMonth = sum over the observer\'s mining sites of the site rate, times 30 where the rate is per day',
    basis: 'NOT PINNED. Faction resource income also carries transfers, alien resource sharing and in-situ production; the ratio of summed site output to reported income runs 0.81 to 4.43 across the eight factions in the sampled save, so no arithmetic isolates the mining term. This quantity is therefore the SITE output only, and it is reported as that rather than as validated mining income.',
    validatedAgainstGameOutput: false
  }),
  controlPointResearch: Object.freeze({
    formula: 'controlPointResearchIncome = the snapshot\'s own `researchBreakdown.earthControlPointShare`',
    basis: 'each nation\'s research is divided among its control points and the observer earns the share of the points it holds. The save\'s reported total research exceeds this share plus hab-module research by an amount that orgs, traits and unused mission control account for; that residual is reported as `unexplainedResearchIncome` so the coverage of this quantity is visible rather than implied.',
    validatedAgainstGameOutput: false
  }),
  grantMonthsOfIncome: Object.freeze({
    formula: 'monthsOfIncome = grantedAmount / monthlyIncome(resource)',
    basis: 'a one-time grant is worth what it would otherwise take to earn. Null -- never zero -- where the observer has no measured monthly income in that resource, because dividing by an unmeasured rate is how an absent income becomes an infinite windfall.',
    validatedAgainstGameOutput: false
  }),
  councilAttributeDelta: Object.freeze({
    formula: 'attributePointsGained = value * activeCouncilorCount',
    basis: 'a FactionAllCouncilorsModifyAttribute grant names its attribute in `strValue` and applies to the whole council. The council\'s current total in that attribute travels with the row as `councilTotalBefore` so the gain is proportionate to something; it is null with a stated reason where the attribute blocks are unreadable, never a zero baseline that would make any gain look infinite.',
    validatedAgainstGameOutput: false
  }),
  valuePerResearchPoint: Object.freeze({
    formula: 'valuePerResearchPoint = monthlyValue / remainingResearchCost',
    basis: 'spec section 2: a 150,000-cost tech with twice the benefit of a 25,000-cost one is worse. Null where either side is unmeasured, and deliberately NOT summed across units -- a research-per-month figure and a tonnes-per-month figure have no exchange rate, so each unit keeps its own ratio.',
    validatedAgainstGameOutput: false
  })
});

// ---------------------------------------------------------------------------
// QUANTITIES
// ---------------------------------------------------------------------------

/**
 * The mined resources, in the save's own spelling.
 *
 * `shared/intel/common.mjs` already carries this table for the mining
 * endpoints. It is repeated here rather than imported because that module
 * pulls in `sameId` plus a body-matching vocabulary this file does not use, and
 * because the per-resource CONTEXT binding below has to live beside the table
 * it keys off. The two are asserted equal in tests/economicValue.test.js so
 * they cannot drift.
 */
export const MINED_RESOURCES = Object.freeze([
  Object.freeze({ siteKey: 'water', saveKey: 'Water', label: 'water', context: 'MiningWaterBonus' }),
  Object.freeze({ siteKey: 'volatiles', saveKey: 'Volatiles', label: 'volatiles', context: 'MiningVolatilesBonus' }),
  Object.freeze({ siteKey: 'metals', saveKey: 'Metals', label: 'metals', context: 'MiningMetalsBonus' }),
  Object.freeze({ siteKey: 'nobleMetals', saveKey: 'NobleMetals', label: 'noble metals', context: 'MiningNoblesBonus' }),
  Object.freeze({ siteKey: 'fissiles', saveKey: 'Fissiles', label: 'fissiles', context: 'MiningFissilesBonus' })
]);

/**
 * How a context's numeric value should be read.
 *
 *   rate      the context scales a per-month quantity; a multiplicative or
 *             fractional-additive change is worth quantity * change.
 *   count     the context is a whole-unit allowance; the value IS the delta.
 *   level     the context is a raised-to level with no quantity behind it; the
 *             change is reported in the context's own units and priced only
 *             where a quantity exists.
 */
export const CONTEXT_KINDS = Object.freeze({ rate: 'rate', count: 'count', level: 'level' });

/**
 * The substantiated context -> live quantity mappings.
 *
 * Spec section 4 names five of these as a starting point. There are 140
 * contexts reachable from techs and projects; these are the ones whose target
 * quantity is actually measured in the snapshot, each naming the field it reads.
 * The other 126 are reported as unpriceable WITH THE CONTEXT NAMED, which is the
 * point -- a reader can see exactly what was not priced and why, and no mapping
 * was invented to make a number appear.
 *
 * `quantityKey` indexes `buildLiveQuantities`. `direction` says which way is
 * good, so a construction-time multiplier below 1 reads as a saving rather than
 * as a loss.
 */
export const CONTEXT_QUANTITY_MAP = Object.freeze({
  SpaceMiningBonus: Object.freeze({
    quantityKey: 'miningOutputTotal', kind: CONTEXT_KINDS.rate, direction: 'higher',
    note: 'applies across all five mined resources; the quantity is the observer\'s total site output.'
  }),
  ...Object.fromEntries(MINED_RESOURCES.map(resource => [resource.context, Object.freeze({
    quantityKey: `miningOutput_${resource.siteKey}`, kind: CONTEXT_KINDS.rate, direction: 'higher',
    note: `applies to ${resource.label} only.`
  })])),
  Economy_BasePCGDPIncrease: Object.freeze({
    quantityKey: 'controlledNationGdp', kind: CONTEXT_KINDS.rate, direction: 'higher',
    note: 'the per-capita GDP growth base for every nation the observer draws from. The delta is annual GDP, not a monthly resource flow, and its unit says so.'
  }),
  ControlPointResearch: Object.freeze({
    quantityKey: 'controlPointResearchIncome', kind: CONTEXT_KINDS.rate, direction: 'higher',
    note: 'the observer\'s share of its nations\' research, which is what a control-point research multiplier scales.'
  }),
  HabResearchProduction: Object.freeze({
    quantityKey: 'habResearchIncome', kind: CONTEXT_KINDS.rate, direction: 'higher',
    note: 'research produced by the observer\'s orbital labs, which is a separate stream from the control-point share.'
  }),
  ShipConstructionTime: Object.freeze({
    quantityKey: 'queuedShipBuildDays', kind: CONTEXT_KINDS.rate, direction: 'lower',
    note: 'priced against the days actually queued. An empty queue makes it measurably worth nothing TODAY, which is reported as inert with that reason -- not as unmeasured, and not as a silent zero.'
  }),
  MCFreeSpaceMineNetwork: Object.freeze({
    quantityKey: 'mineCount', kind: CONTEXT_KINDS.count, direction: 'higher',
    note: 'free mines only save mission control once the allowance is binding, so this is priced against the mines beyond the allowance rather than against the raise itself.'
  }),
  HabMissionControlReduction: Object.freeze({
    quantityKey: 'habMissionControlCost', kind: CONTEXT_KINDS.rate, direction: 'lower',
    note: 'the mission control the observer\'s hab cores consume.'
  }),
  ShipMissionControlReduction: Object.freeze({
    quantityKey: 'shipMissionControlCost', kind: CONTEXT_KINDS.rate, direction: 'lower',
    note: 'the mission control the observer\'s ships consume.'
  }),
  CouncilSize: Object.freeze({
    quantityKey: 'councilorCount', kind: CONTEXT_KINDS.count, direction: 'higher',
    note: 'a whole extra councilor, against the council the observer actually fields.'
  })
});

/** Every context this module can price. */
export const PRICED_CONTEXTS = Object.freeze(Object.keys(CONTEXT_QUANTITY_MAP));

/**
 * One measured quantity.
 *
 * `formulaKey` points into ECONOMIC_FORMULAE where the quantity is DERIVED
 * rather than read straight off a field -- section 7 requires every derived
 * metric to state its formula, and a quantity is a derived metric. It is null
 * for the ones that are a single snapshot field verbatim.
 */
const quantity = (key, label, unit, value, source, reason = null, formulaKey = null) => ({
  key,
  label,
  unit,
  formulaKey,
  // Every quantity but one is a single number. `valueShape` says which, so a
  // consumer iterating the list does not have to discover the exception by
  // arithmetic on an object.
  valueShape: 'scalar',
  value: value === null ? null : round(value, 4),
  measured: value !== null,
  source,
  reason: value === null ? reason : null
});

const isOwn = (row, observerId) => sameId(row?.factionId, observerId);

/** Site rates are per day unless the snapshot says otherwise. */
const siteRateMultiplier = (site) =>
  (String(site?.resourceRateUnit || '').toLowerCase().includes('month') ? 1 : 30);

/**
 * Every live quantity the context map can point at, measured once.
 *
 * Each entry carries `measured`, its `source` field path, and -- when absent --
 * the reason. A caller can therefore tell "measured and zero" from "not
 * measured", which is the whole point: the first is a fact about the campaign
 * and the second is a gap in the snapshot.
 */
export function buildLiveQuantities(snapshot, observerId) {
  const faction = asArray(snapshot?.factions).find(entry => sameId(entry?.ID, observerId)) || null;
  const out = {};
  const add = (record) => { out[record.key] = record; };

  // --- mining -------------------------------------------------------------
  const sites = asArray(snapshot?.habSites).filter(site => isOwn(site, observerId));
  const minedTotals = Object.fromEntries(MINED_RESOURCES.map(r => [r.siteKey, null]));
  let siteRatesRead = 0;
  for (const site of sites) {
    const multiplier = siteRateMultiplier(site);
    for (const resource of MINED_RESOURCES) {
      const rate = toFinite(site?.[resource.siteKey]);
      if (rate === null) continue;
      siteRatesRead += 1;
      minedTotals[resource.siteKey] = (minedTotals[resource.siteKey] ?? 0) + rate * multiplier;
    }
  }
  const minedGrandTotal = MINED_RESOURCES.reduce((sum, resource) => {
    const value = minedTotals[resource.siteKey];
    return value === null ? sum : (sum ?? 0) + value;
  }, null);

  for (const resource of MINED_RESOURCES) {
    add(quantity(
      `miningOutput_${resource.siteKey}`,
      `${resource.label} mined per month`,
      'tonnes/month',
      minedTotals[resource.siteKey],
      'habSites[owned].' + resource.siteKey + ' x 30 (rates are per day)',
      sites.length === 0
        ? 'this observer holds no mining sites in this snapshot'
        : `no site reports a ${resource.label} rate`,
      'miningOutput'
    ));
  }
  add(quantity(
    'miningOutputTotal',
    'all mined resources per month',
    'tonnes/month',
    minedGrandTotal,
    'habSites[owned] summed over the five mined resources x 30',
    sites.length === 0
      ? 'this observer holds no mining sites in this snapshot'
      : 'no site reports any resource rate',
    'miningOutput'
  ));

  // --- Earth economy ------------------------------------------------------
  const nations = asArray(snapshot?.nations);
  const controlled = nations.filter(nation =>
    asArray(nation?.controlPoints).some(point => sameId(point?.factionId, observerId)));
  const controlledGdp = controlled.reduce((sum, nation) => {
    const gdp = toFinite(nation?.GDP);
    return gdp === null ? sum : (sum ?? 0) + gdp;
  }, null);
  add(quantity(
    'controlledNationGdp',
    'annual GDP of nations the observer holds a control point in',
    'dollars/year',
    controlledGdp,
    'sum of nations[].GDP where nations[].controlPoints[].factionId is the observer',
    controlled.length === 0
      ? 'this observer holds no control points in any nation in this snapshot'
      : 'no controlled nation reports a GDP',
    'controlledGdp'
  ));

  // --- research -----------------------------------------------------------
  const breakdown = faction?.researchBreakdown || null;
  add(quantity(
    'controlPointResearchIncome',
    'research per month from control points',
    'research/month',
    toFinite(breakdown?.earthControlPointShare),
    'factions[observer].researchBreakdown.earthControlPointShare',
    'this snapshot carries no control-point research share for the observer',
    'controlPointResearch'
  ));
  const habModules = asArray(snapshot?.habModules).filter(module => isOwn(module, observerId));
  const habResearch = habModules.reduce((sum, module) => {
    const value = toFinite(module?.researchIncomeMonth);
    return value === null ? sum : (sum ?? 0) + value;
  }, null);
  add(quantity(
    'habResearchIncome',
    'research per month from hab modules',
    'research/month',
    habResearch,
    'sum of habModules[owned].researchIncomeMonth',
    habModules.length === 0
      ? 'this observer\'s hab modules are not listed in this snapshot'
      : 'no owned hab module reports a monthly research income'
  ));
  add(quantity(
    'totalResearchIncome',
    'total research per month',
    'research/month',
    toFinite(faction?.totalResearch),
    'factions[observer].totalResearch',
    'this snapshot carries no research income for the observer'
  ));

  // --- construction -------------------------------------------------------
  const queues = asArray(snapshot?.shipyardQueues).filter(row => isOwn(row, observerId));
  // An EMPTY queue is a measurement of zero days, not an absent measurement:
  // the observer demonstrably has nothing building. An entry whose remaining
  // days are absent is the opposite, and is counted as unresolved rather than
  // folded in as zero.
  let queuedDays = queues.length === 0 ? 0 : null;
  let queueUnresolved = 0;
  for (const row of queues) {
    const days = toFinite(row?.daysToCompletion);
    if (days === null) { queueUnresolved += 1; continue; }
    queuedDays = (queuedDays ?? 0) + days;
  }
  add({
    ...quantity(
      'queuedShipBuildDays',
      'ship-days remaining in the observer\'s build queues',
      'days',
      queuedDays,
      'sum of shipyardQueues[owned].daysToCompletion',
      'every queued build in this snapshot lacks a remaining-days figure'
    ),
    queueCount: queues.length,
    unresolvedQueueEntries: queueUnresolved,
    // The distinction the rest of the module leans on: nothing queued is a
    // measured zero, and it makes a build-time reduction inert TODAY rather
    // than unmeasurable.
    emptyQueue: queues.length === 0
  });

  // --- mission control ----------------------------------------------------
  let shipMissionControl = null;
  let shipsRead = 0;
  let shipsUnresolved = 0;
  for (const fleet of asArray(snapshot?.fleets)) {
    if (!isOwn(fleet, observerId)) continue;
    for (const ship of asArray(fleet?.ships)) {
      const value = toFinite(ship?.missionControlConsumption);
      if (value === null) { shipsUnresolved += 1; continue; }
      shipsRead += 1;
      shipMissionControl = (shipMissionControl ?? 0) + value;
    }
  }
  add({
    ...quantity(
      'shipMissionControlCost',
      'mission control consumed by the observer\'s ships',
      'mission control',
      shipMissionControl,
      'sum of fleets[owned].ships[].missionControlConsumption',
      'no owned ship reports a mission-control consumption'
    ),
    shipsRead,
    shipsUnresolved
  });

  const habModuleStats = snapshot?.componentStats?.hab_module || null;
  let habMissionControl = null;
  let habModulesRead = 0;
  let habModulesUnresolved = 0;
  for (const module of habModules) {
    const stats = habModuleStats?.[module?.templateName];
    if (!stats) { habModulesUnresolved += 1; continue; }
    habModulesRead += 1;
    const value = toFinite(stats.missionControl);
    // Only the NEGATIVE entries are a cost. Administration modules carry a
    // positive `missionControl` because they GRANT capacity, and summing the
    // two together would net a cost against a capacity and report neither.
    if (value !== null && value < 0) habMissionControl = (habMissionControl ?? 0) + Math.abs(value);
  }
  if (habMissionControl === null && habModulesRead > 0) habMissionControl = 0;
  add({
    ...quantity(
      'habMissionControlCost',
      'mission control consumed by the observer\'s hab cores',
      'mission control',
      habMissionControl,
      'sum of the negative componentStats.hab_module[].missionControl over habModules[owned]',
      habModuleStats
        ? 'no owned hab module resolves to a baked template record'
        : 'componentStats is not present on this snapshot'
    ),
    habModulesRead,
    habModulesUnresolved
  });

  const reportedUsage = toFinite(faction?.missionControlUsage);
  const capacity = toFinite(faction?.missionControlCapacity);
  const modelledUsage = (shipMissionControl === null && habMissionControl === null)
    ? null
    : (shipMissionControl ?? 0) + (habMissionControl ?? 0);
  add({
    ...quantity(
      'missionControlHeadroom',
      'unused mission control',
      'mission control',
      (capacity === null || reportedUsage === null) ? null : capacity - reportedUsage,
      'factions[observer].missionControlCapacity - .missionControlUsage',
      'this snapshot carries no mission-control capacity or usage for the observer',
      'missionControlUsage'
    ),
    capacity,
    reportedUsage,
    // The pin, carried on the quantity itself so a reader can check it rather
    // than take the claim on trust. A non-zero residual is a MODEL DISAGREEMENT
    // and is surfaced, never absorbed.
    modelledUsage,
    residual: (modelledUsage === null || reportedUsage === null) ? null : round(reportedUsage - modelledUsage, 4),
    modelReproducesUsage: (modelledUsage === null || reportedUsage === null)
      ? null
      : Math.abs(reportedUsage - modelledUsage) < 1e-6
  });

  add({
    ...quantity(
      'mineCount',
      'mining sites the observer operates',
      'mines',
      sites.length === 0 && asArray(snapshot?.habSites).length === 0 ? null : sites.length,
      'count of habSites[owned]',
      'this snapshot lists no hab sites at all'
    )
  });

  // --- council ------------------------------------------------------------
  const councilors = asArray(snapshot?.councilors).filter(row => isOwn(row, observerId));
  add(quantity(
    'councilorCount',
    'councilors the observer fields',
    'councilors',
    asArray(snapshot?.councilors).length === 0 ? null : councilors.length,
    'count of councilors[owned]',
    'this snapshot lists no councilors at all'
  ));

  // Per-attribute council totals, so a "+2 to every councilor's Command" grant
  // can be reported against something. Each attribute keeps its own null: a
  // council whose Espionage is genuinely 0 and one whose attributes were never
  // read must not produce the same figure.
  const attributeTotals = {};
  for (const councilor of councilors) {
    const attributes = councilor?.attributes || councilor?.resolvedAttributes?.effective || null;
    if (!attributes || typeof attributes !== 'object') continue;
    for (const [name, value] of Object.entries(attributes)) {
      const parsed = toFinite(value);
      if (parsed === null) continue;
      attributeTotals[name] = (attributeTotals[name] ?? 0) + parsed;
    }
  }
  out.councilAttributeTotals = {
    key: 'councilAttributeTotals',
    label: 'the council\'s combined score in each attribute',
    unit: 'attribute points',
    // The one non-scalar quantity: a map of attribute name to council total.
    valueShape: 'map',
    value: Object.keys(attributeTotals).length > 0 ? attributeTotals : null,
    measured: Object.keys(attributeTotals).length > 0,
    source: 'sum of councilors[owned].attributes',
    reason: Object.keys(attributeTotals).length > 0
      ? null
      : (councilors.length === 0
        ? 'this observer has no councilors in this snapshot'
        : 'no owned councilor carries a readable attribute block')
  };

  return {
    quantities: out,
    siteRatesRead,
    observerFactionPresent: faction !== null,
    // The gap between the save's reported research and the two streams above,
    // reported so the coverage of `controlPointResearchIncome` is visible.
    unexplainedResearchIncome: (() => {
      const total = toFinite(faction?.totalResearch);
      const cp = toFinite(breakdown?.earthControlPointShare);
      const hab = toFinite(breakdown?.habModules);
      if (total === null || cp === null || hab === null) return null;
      return round(total - cp - hab, 2);
    })()
  };
}

// ---------------------------------------------------------------------------
// THE ACTIVE BASELINE
// ---------------------------------------------------------------------------

/**
 * A per-context accumulator over the effects the observer already has.
 *
 * Occurrences are COUNTED, not deduped. `snapshot.capabilities.activeEffects`
 * is a Set and therefore loses multiplicity -- the sampled observer holds
 * `Effect_EnthrallElitesDefense` from three separate completed projects, and a
 * stackable effect held three times is not the same state as held once. That
 * set is still read, as a cross-check on the DISTINCT names, and any
 * disagreement is reported rather than silently preferred one way.
 */
function emptyContextState(context) {
  return {
    context,
    additiveTotal: 0,
    multiplicativeProduct: 1,
    raisedToLevel: null,
    loweredToLevel: null,
    fixedValues: [],
    contributingEffects: [],
    occurrences: 0
  };
}

/**
 * Reads the observer's completed projects and the finished global techs, joins
 * them to the baked effect index, and accumulates per context.
 *
 * The join goes through the tech tree's own nodes, which already carry each
 * node's effect id list -- there is no second project -> effect mapping built
 * here, for the same reason phase 2 resolves gates through the unlock index
 * rather than rebuilding the relation.
 */
export function buildEffectBaseline(snapshot, observerId) {
  const index = snapshot?.effectIndex || null;
  if (!index || !index.effects) {
    return {
      available: false,
      reason: 'effectIndex is not present on this snapshot; re-publish after upgrading',
      contexts: {},
      heldEffectCounts: {},
      sources: null,
      crossCheck: null
    };
  }

  const nodes = asArray(snapshot?.techTree?.nodes);
  if (nodes.length === 0) {
    return {
      available: false,
      reason: 'this snapshot carries no tech tree, so the observer\'s completed research cannot be resolved to effects',
      contexts: {},
      heldEffectCounts: {},
      sources: null,
      crossCheck: null
    };
  }
  const nodeById = new Map(nodes.map(node => [node.id, node]));

  const faction = asArray(snapshot?.factions).find(entry => sameId(entry?.ID, observerId)) || null;
  const factionStatus = (snapshot?.techTree?.factionStatus || {})[observerId] || {};
  const completedProjects = asArray(faction?.completedProjects).length > 0
    ? asArray(faction.completedProjects)
    : asArray(factionStatus.completedProjects);
  const finishedTechs = asArray(snapshot?.techTree?.finishedTechsNames).length > 0
    ? asArray(snapshot.techTree.finishedTechsNames)
    : asArray(snapshot?.globalResearch?.finishedTechsNames);

  // A faction that has completed nothing is a real state (turn one). A faction
  // whose completed list is ABSENT is not the same state, and the two must not
  // render identically -- so presence of the field decides, not its length.
  const completedKnown = Array.isArray(faction?.completedProjects) ||
    Array.isArray(factionStatus.completedProjects);
  if (!completedKnown) {
    return {
      available: false,
      reason: 'the observer\'s completed-project list is absent in this snapshot, so what is already active cannot be established',
      contexts: {},
      heldEffectCounts: {},
      sources: null,
      crossCheck: null
    };
  }

  const contexts = {};
  const heldEffectCounts = {};
  const unresolvedSources = [];
  let resolvedSources = 0;

  const absorb = (effectId, sourceId, sourceKind) => {
    heldEffectCounts[effectId] = (heldEffectCounts[effectId] || 0) + 1;
    const effect = index.effects[effectId];
    if (!effect) return;
    const stackable = effect.stackable === true;
    // A non-stackable effect counts once no matter how many completed projects
    // grant it. Counting it twice is how a ceiling gets reported as a bonus.
    if (!stackable && heldEffectCounts[effectId] > 1) return;
    for (const context of asArray(effect.contexts)) {
      if (!contexts[context]) contexts[context] = emptyContextState(context);
      const state = contexts[context];
      const value = toFinite(effect.value);
      state.occurrences += 1;
      state.contributingEffects.push({ effectId, sourceId, sourceKind, operation: effect.operation ?? null, value });
      if (value === null) continue;
      switch (effect.operation) {
        case 'Additive': state.additiveTotal += value; break;
        case 'Multiplicative': state.multiplicativeProduct *= value; break;
        case 'IncreaseToValue':
          state.raisedToLevel = state.raisedToLevel === null ? value : Math.max(state.raisedToLevel, value);
          break;
        case 'DecreaseToValue':
          state.loweredToLevel = state.loweredToLevel === null ? value : Math.min(state.loweredToLevel, value);
          break;
        case 'SetToFixedValue': state.fixedValues.push(value); break;
        default: break;
      }
    }
  };

  for (const projectId of completedProjects) {
    const node = nodeById.get(projectId);
    if (!node) { unresolvedSources.push({ id: projectId, kind: 'faction_project' }); continue; }
    resolvedSources += 1;
    for (const entry of asArray(node.effects)) {
      if (entry?.effectId) absorb(entry.effectId, projectId, 'faction_project');
    }
  }
  for (const techId of finishedTechs) {
    const node = nodeById.get(techId);
    if (!node) { unresolvedSources.push({ id: techId, kind: 'global_tech' }); continue; }
    resolvedSources += 1;
    for (const entry of asArray(node.effects)) {
      if (entry?.effectId) absorb(entry.effectId, techId, 'global_tech');
    }
  }

  // Cross-check against the snapshot's own active-effect set. It is deduped, so
  // only the DISTINCT names are comparable; the counts are ours alone.
  const reported = asArray(snapshot?.capabilities?.activeEffects);
  const ours = new Set(Object.keys(heldEffectCounts));
  const crossCheck = reported.length === 0
    ? { available: false, reason: 'this snapshot carries no capabilities.activeEffects list to check against' }
    : {
      available: true,
      reason: null,
      reportedDistinct: new Set(reported).size,
      reconstructedDistinct: ours.size,
      missingFromReconstruction: reported.filter(name => !ours.has(name)),
      absentFromSnapshotList: [...ours].filter(name => !reported.includes(name)),
      agrees: reported.every(name => ours.has(name)) && [...ours].every(name => reported.includes(name))
    };

  return {
    available: true,
    reason: null,
    contexts,
    heldEffectCounts,
    sources: {
      completedProjects: completedProjects.length,
      finishedGlobalTechs: finishedTechs.length,
      resolvedToTechTreeNodes: resolvedSources,
      unresolved: unresolvedSources,
      basis: 'the observer\'s own completed projects and the finished global techs, joined to the tech tree\'s per-node effect lists. Occurrences are counted rather than deduped, because a stackable effect held three times is not the state of holding it once.'
    },
    crossCheck
  };
}

// ---------------------------------------------------------------------------
// PRICING
// ---------------------------------------------------------------------------

const priceable = (state, reason) => ({ state, reason });

/**
 * What one context-scoped effect is worth to this observer, right now.
 *
 * Returns a row that is exactly one of `priced` / `inert` / `unpriceable`, with
 * the quantity, formula key and reason that produced it. Never a bare number.
 */
export function priceContextEffect({ effectId, effect, context, baseline, quantities }) {
  const mapping = CONTEXT_QUANTITY_MAP[context] || null;
  const state = baseline?.contexts?.[context] || emptyContextState(context);
  const alreadyHeld = (baseline?.heldEffectCounts?.[effectId] || 0) > 0;
  const stackable = effect?.stackable === true;
  const operation = effect?.operation || null;
  const value = toFinite(effect?.value);

  const base = {
    effectId,
    context,
    operation,
    value,
    stackable,
    alreadyHeld,
    quantityKey: mapping?.quantityKey ?? null,
    contextKind: mapping?.kind ?? null,
    direction: mapping?.direction ?? null,
    // The state the effect lands on, reported whether or not a price follows.
    activeAdditiveTotal: round(state.additiveTotal, 6),
    activeMultiplier: round(state.multiplicativeProduct, 6),
    activeRaisedToLevel: state.raisedToLevel,
    activeOccurrences: state.occurrences,
    delta: null,
    deltaUnit: null,
    formulaKey: null,
    quantity: null,
    unpriceableCode: null,
    inertCode: null
  };

  if (!effect) return { ...base, ...priceable(PRICING_STATES.unpriceable, null), unpriceableCode: 'effect-not-indexed' };
  if (!operation) return { ...base, ...priceable(PRICING_STATES.unpriceable, null), unpriceableCode: 'no-operation' };
  if (!OPERATION_SEMANTICS[operation]) {
    return { ...base, ...priceable(PRICING_STATES.unpriceable, null), unpriceableCode: 'unknown-operation' };
  }
  if (value === null) return { ...base, ...priceable(PRICING_STATES.unpriceable, null), unpriceableCode: 'no-value' };

  // --- inert cases that do not need a quantity at all ---------------------
  if (!stackable && alreadyHeld && (operation === 'Additive' || operation === 'Multiplicative')) {
    return { ...base, ...priceable(PRICING_STATES.inert, null), delta: 0, inertCode: 'already-held-and-not-stackable' };
  }
  if (operation === 'IncreaseToValue' && state.raisedToLevel !== null && state.raisedToLevel >= value) {
    return { ...base, ...priceable(PRICING_STATES.inert, null), delta: 0, inertCode: 'already-at-or-above-value' };
  }
  if (operation === 'DecreaseToValue' && state.loweredToLevel !== null && state.loweredToLevel <= value) {
    return { ...base, ...priceable(PRICING_STATES.inert, null), delta: 0, inertCode: 'already-at-or-below-value' };
  }
  if (operation === 'Multiplicative' && value === 1) {
    return { ...base, ...priceable(PRICING_STATES.inert, null), delta: 0, inertCode: 'multiplier-is-unity' };
  }
  if (operation === 'Additive' && value === 0) {
    return { ...base, ...priceable(PRICING_STATES.inert, null), delta: 0, inertCode: 'value-is-zero' };
  }

  // --- level changes that carry no quantity -------------------------------
  // IncreaseToValue / DecreaseToValue / SetToFixedValue on a context with no
  // mapped quantity still have a REAL, reportable change: the level moves. That
  // is not a price, so it is not reported as one -- but it is not nothing
  // either, and `levelChange` carries it so a caller can rank on movement where
  // there is nothing to multiply against.
  const levelChange = (() => {
    if (operation === 'IncreaseToValue') {
      return { from: state.raisedToLevel, to: value, delta: round(value - (state.raisedToLevel ?? 0), 6) };
    }
    if (operation === 'DecreaseToValue') {
      return { from: state.loweredToLevel, to: value, delta: state.loweredToLevel === null ? null : round(value - state.loweredToLevel, 6) };
    }
    if (operation === 'SetToFixedValue') {
      const from = state.fixedValues.length > 0 ? state.fixedValues[state.fixedValues.length - 1] : null;
      return { from, to: value, delta: from === null ? null : round(value - from, 6), isDowngrade: from !== null && value < from };
    }
    return null;
  })();

  if (!mapping) {
    return {
      ...base,
      ...priceable(PRICING_STATES.unpriceable, null),
      unpriceableCode: 'no-quantity-mapping',
      levelChange
    };
  }

  const measured = quantities?.quantities?.[mapping.quantityKey] || null;
  if (!measured || measured.measured !== true) {
    return {
      ...base,
      ...priceable(PRICING_STATES.unpriceable, null),
      unpriceableCode: 'quantity-unmeasured',
      quantity: measured ? { ...measured } : null,
      levelChange
    };
  }

  const q = measured.value;
  const quantityEcho = { key: measured.key, label: measured.label, unit: measured.unit, value: q, source: measured.source };

  // --- counted contexts ---------------------------------------------------
  if (mapping.kind === CONTEXT_KINDS.count) {
    if (context === 'MCFreeSpaceMineNetwork') {
      // Free mines save mission control only for mines beyond the allowance.
      const mineCount = q;
      const allowance = state.additiveTotal;
      const binding = Math.max(0, mineCount - allowance);
      const saved = Math.min(value, binding);
      const row = {
        ...base,
        formulaKey: 'freeMineAllowance',
        quantity: { ...quantityEcho, value: binding, label: 'mines beyond the current free allowance', unit: 'mines' },
        freeMineAllowance: allowance,
        mineCount,
        delta: round(saved, 4),
        deltaUnit: 'mission control saved',
        levelChange
      };
      return saved === 0
        ? { ...row, ...priceable(PRICING_STATES.inert, null), inertCode: 'allowance-not-binding' }
        : { ...row, ...priceable(PRICING_STATES.priced, null) };
    }
    // A plain counted allowance: the value IS the delta.
    return {
      ...base,
      ...priceable(PRICING_STATES.priced, null),
      formulaKey: 'additiveCountDelta',
      quantity: quantityEcho,
      delta: round(value, 4),
      deltaUnit: measured.unit,
      levelChange
    };
  }

  // --- rate contexts ------------------------------------------------------
  if (q === 0) {
    return {
      ...base,
      ...priceable(PRICING_STATES.inert, null),
      delta: 0,
      deltaUnit: measured.unit,
      quantity: quantityEcho,
      // The quantity IS measured and IS zero. That is a fact about the
      // campaign -- an empty build queue, a faction that mines nothing yet --
      // and it is deliberately not the same answer as `quantity-unmeasured`
      // above, which means the snapshot never told us.
      inertCode: 'quantity-is-zero',
      levelChange
    };
  }

  if (operation === 'Multiplicative') {
    const delta = q * (value - 1);
    return {
      ...base,
      ...priceable(delta === 0 ? PRICING_STATES.inert : PRICING_STATES.priced, null),
      inertCode: delta === 0 ? 'multiplier-is-unity' : null,
      formulaKey: 'multiplicativeDelta',
      quantity: quantityEcho,
      delta: round(delta, 4),
      deltaUnit: measured.unit,
      // A construction-time multiplier below 1 is a SAVING. The sign stays
      // intact and `direction` says which way is good; nothing is abs()'d.
      improvesQuantity: mapping.direction === 'lower' ? delta < 0 : delta > 0,
      levelChange
    };
  }

  if (operation === 'Additive') {
    // A fractional additive on a rate context is percentage points.
    const delta = q * value;
    return {
      ...base,
      ...priceable(delta === 0 ? PRICING_STATES.inert : PRICING_STATES.priced, null),
      inertCode: delta === 0 ? 'value-is-zero' : null,
      formulaKey: 'additiveFractionDelta',
      quantity: quantityEcho,
      delta: round(delta, 4),
      deltaUnit: measured.unit,
      improvesQuantity: mapping.direction === 'lower' ? delta < 0 : delta > 0,
      levelChange
    };
  }

  // IncreaseToValue, DecreaseToValue and SetToFixedValue on a rate context all
  // MOVE A LEVEL rather than scale the quantity, and turning a level into a
  // monthly figure needs to know what the level's units are. The game states
  // them nowhere, and no shipped effect exercises this combination -- every
  // effect on every priced context is Additive or Multiplicative (verified
  // 2026-08-21 against the installed 1.0 templates). Multiplying the quantity
  // by the level difference anyway would be inventing a mapping to make a
  // number appear, which is exactly what section 4 forbids. The level movement
  // IS reported, under `levelChange`, so the change is not lost.
  return {
    ...base,
    ...priceable(PRICING_STATES.unpriceable, null),
    unpriceableCode: 'level-move-on-a-rate-context',
    formulaKey: 'raiseToValueDelta',
    quantity: quantityEcho,
    levelChange
  };
}

/**
 * A one-time instant effect.
 *
 * Only two of the twenty instant kinds reachable from techs and projects have a
 * target quantity the snapshot measures. The other eighteen are reported with
 * their kind named and no number, which is the honest answer -- an instant
 * effect that changes a map region's GDP cannot be priced against a snapshot
 * that carries no regions.
 */
export function priceInstantEffect({ effectId, effect, quantities }) {
  const kind = effect?.instantEffect || null;
  const value = toFinite(effect?.value);
  const base = {
    effectId,
    instantEffect: kind,
    value,
    strValue: effect?.strValue ?? null,
    oneTime: true,
    delta: null,
    deltaUnit: null,
    formulaKey: null,
    quantity: null,
    unpriceableCode: null,
    inertCode: null
  };

  if (kind === 'FactionAllCouncilorsModifyAttribute' && value !== null) {
    const council = quantities?.quantities?.councilorCount || null;
    if (!council || council.measured !== true) {
      return { ...base, ...priceable(PRICING_STATES.unpriceable, null), unpriceableCode: 'quantity-unmeasured' };
    }
    // The council's CURRENT total in the named attribute, so a +12 gain is
    // proportionate to something rather than floating free. Absent when the
    // effect names no attribute or the attribute blocks are unreadable, and
    // absent stays null rather than becoming a confident zero baseline.
    const attributeName = effect?.strValue || null;
    const totals = quantities?.quantities?.councilAttributeTotals || null;
    const currentTotal = (attributeName && totals?.measured === true)
      ? (toFinite(totals.value?.[attributeName]) ?? null)
      : null;
    return {
      ...base,
      ...priceable(council.value === 0 ? PRICING_STATES.inert : PRICING_STATES.priced, null),
      inertCode: council.value === 0 ? 'quantity-is-zero' : null,
      formulaKey: 'councilAttributeDelta',
      quantity: { key: council.key, label: council.label, unit: council.unit, value: council.value, source: council.source },
      attribute: attributeName,
      councilTotalBefore: currentTotal,
      councilTotalBeforeReason: currentTotal === null
        ? (attributeName
          ? 'this snapshot carries no readable council total for that attribute'
          : 'the effect names no attribute')
        : null,
      delta: round(value * council.value, 4),
      deltaUnit: `${attributeName || 'attribute'} points across the council`
    };
  }

  return { ...base, ...priceable(PRICING_STATES.unpriceable, null), unpriceableCode: 'instant-effect-unpriced' };
}

/**
 * A project's `resourcesGranted` entry, priced as months of the observer's own
 * income in that resource.
 *
 * Null months -- never zero, never Infinity -- where the income is unmeasured
 * or zero: dividing by an absent rate is how a faction with no antimatter
 * industry gets told a 0.005 t grant is worth an infinite number of months.
 */
export function priceResourceGrant({ resource, amount, monthlyIncome }) {
  const granted = toFinite(amount);
  const income = toFinite(monthlyIncome);
  const months = (granted === null || income === null || !(income > 0)) ? null : granted / income;
  // A measured income of exactly zero and an absent income figure produce the
  // same null here and mean different things, so they carry different codes.
  const unpriceableCode = granted === null
    ? 'no-value'
    : (income === null
      ? 'grant-income-unmeasured'
      : (income > 0 ? null : 'grant-income-zero'));
  return {
    resource,
    amount: granted,
    monthlyIncome: income,
    monthsOfIncome: months === null ? null : round(months, 2),
    formulaKey: 'grantMonthsOfIncome',
    state: unpriceableCode === null ? PRICING_STATES.priced : PRICING_STATES.unpriceable,
    unpriceableCode
  };
}

/**
 * Rolls a set of priced rows into per-unit totals.
 *
 * Deliberately per unit and never one number: research per month, tonnes per
 * month and dollars per year have no exchange rate, and summing them would be
 * the same error phase 1 and phase 2 both refuse to make with a blended score.
 */
export function summarizeValue(rows) {
  const byUnit = new Map();
  let pricedCount = 0;
  let inertCount = 0;
  let unpriceableCount = 0;
  for (const row of asArray(rows)) {
    if (row?.state === PRICING_STATES.priced) {
      pricedCount += 1;
      const unit = row.deltaUnit || 'unitless';
      const delta = toFinite(row.delta);
      if (delta === null) continue;
      byUnit.set(unit, (byUnit.get(unit) || 0) + delta);
    } else if (row?.state === PRICING_STATES.inert) inertCount += 1;
    else if (row?.state === PRICING_STATES.unpriceable) unpriceableCount += 1;
  }
  return {
    pricedCount,
    inertCount,
    unpriceableCount,
    byUnit: [...byUnit].map(([unit, total]) => ({ unit, total: round(total, 4) }))
      .sort((a, b) => String(a.unit).localeCompare(String(b.unit)))
  };
}

/**
 * Value per research point, per unit.
 *
 * Null on both sides is preserved: an unmeasured remaining cost cannot produce
 * a ratio, and a project whose value is unpriceable has no ratio to report --
 * which is exactly the row that must NOT be ranked last with a silent zero.
 */
export function valuePerResearchPoint(summary, remainingResearchCost) {
  const cost = toFinite(remainingResearchCost);
  if (cost === null || !(cost > 0)) {
    return {
      available: false,
      reason: cost === null
        ? 'the remaining research cost is unmeasured for this item'
        : 'the remaining research cost is zero, so a value-per-point ratio would divide by zero',
      formulaKey: 'valuePerResearchPoint',
      byUnit: []
    };
  }
  return {
    available: summary.byUnit.length > 0,
    reason: summary.byUnit.length > 0 ? null : 'nothing about this item could be priced, so there is no value to divide',
    formulaKey: 'valuePerResearchPoint',
    remainingResearchCost: cost,
    byUnit: summary.byUnit.map(entry => ({
      unit: entry.unit,
      total: entry.total,
      perResearchPoint: round(entry.total / cost, 8)
    }))
  };
}
