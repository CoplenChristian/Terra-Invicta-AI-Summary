// shared/intel/economicValue.mjs
//
// Purpose: /api/intel/economic-value — phase 3 of the research advisor, pricing
//   what a researched tech actually does against live quantities.
//
// `/api/intel/economic-value` -- phase 3 of the research advisor.
//
// Phase 1 priced drives and phase 2 priced the fourteen other unlock families.
// Both answer "what does this gate let me BUILD". This answers "what does this
// research DO", by pricing each candidate's effects and grants against the
// observer's own live figures.
//
// It consumes the earlier phases rather than repeating them:
//
//   shared/researchAvailability.mjs  the six availability states, read from the
//                                    save's own `availableProjectNames`
//   shared/economicValue.mjs         the quantities, the baseline, the pricing
//   snapshot.techTree                the candidate set and each node's effects
//   snapshot.effectIndex             the four effect fields the tech tree omits
//
// and it does NOT rank across units, allocate research slots or render a panel.
// Those are phases 4 and 5.
//
// ---------------------------------------------------------------------------
// THREE STATES, NEVER TWO
// ---------------------------------------------------------------------------
//
// Every priced thing is `priced`, `inert` or `unpriceable`, and the endpoint
// reports the census of all three at the top. A candidate whose benefit cannot
// be quantified is surfaced with the context named -- it is never scored zero,
// which would rank it last and hide it. That is spec section 4's central
// requirement and this repo's most repeated defect class.
//
// The `contextCoverage` block exists for the same reason: it names every one of
// the contexts this module CANNOT price, with how many effects use each. A
// reader can therefore see the size of the gap instead of inferring from silence
// that the gap is not there.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, round, sameId, toFiniteNumber as toFinite } from '../util.mjs';
import {
  AVAILABILITY_STATES,
  buildAvailabilityResolver,
  tallyAvailabilityStates
} from '../researchAvailability.mjs';
import {
  MEASURED_INCOME_BASIS,
  buildResearchCategoryBonuses,
  categoryBonusSummary,
  monthsAtIncomeForCategory
} from '../researchCategoryBonus.mjs';
import {
  CONTEXT_KINDS,
  CONTEXT_QUANTITY_MAP,
  ECONOMIC_FORMULAE,
  INERT_CODES,
  MINED_RESOURCES,
  OPERATION_SEMANTICS,
  PRICED_CONTEXTS,
  PRICING_STATES,
  UNPRICEABLE_CODES,
  buildEffectBaseline,
  buildLiveQuantities,
  priceContextEffect,
  priceInstantEffect,
  priceResourceGrant,
  summarizeValue,
  valuePerResearchPoint
} from '../economicValue.mjs';

const DEFAULT_CANDIDATE_LIMIT = 25;
const MAX_CANDIDATE_LIMIT = 1000;

/**
 * Why a context has no quantity mapping, grouped so the answer is a reason
 * rather than a shrug.
 *
 * These are judgements about scope, not measurements, and they are worded as
 * such. Every context that is not in `CONTEXT_QUANTITY_MAP` gets one of these,
 * so nothing falls off the list silently.
 */
export const UNPRICED_CONTEXT_GROUPS = Object.freeze({
  'mission-modifier': 'a modifier on a contested mission roll. That is a covert-operations axis with its own odds model, not an economic quantity, and section 4 is economic valuation.',
  'nation-priority': 'a weight on a nation investment priority. The snapshot records nation GDP, population and research but not the priority sliders those weights act on, so there is no measured quantity behind it.',
  'ground-and-orbital-combat': 'a ground, bombardment or fighter combat modifier. The snapshot carries army counts but no engagement model to price a combat bonus against.',
  'capability-unlock': 'a boolean or level capability rather than a rate. The level change it produces is reported on the row; there is no monthly quantity to multiply it by.',
  'space-operations': 'a transfer, sensor or ship-combat parameter. Phase 1 prices propulsion and phase 2 prices armament from the component templates; neither is an economic flow, so this endpoint reports the level change and leaves the valuation to those endpoints.',
  'council-and-orgs': 'a council recruitment, org-market or councilor-capacity parameter. The snapshot carries the council roster and each councilor\'s attributes, but not the recruit pool or the org market those numbers act on.',
  unmapped: 'no quantity in this snapshot was found to substantiate a mapping for this context. It is named here rather than being quietly dropped, and no mapping was invented to make a number appear.'
});

/**
 * The prose lives ONCE in the table above; a row carries only its group key.
 * 127 unpriced contexts x a 250-character sentence is 32 KB of the same five
 * sentences, which is the same reason `military-value` expands its ratio and
 * magazine codes once per response instead of per row.
 */
const UNPRICED_CONTEXT_RULES = Object.freeze([
  [/^Mission_/, 'mission-modifier'],
  [/Priority$/, 'nation-priority'],
  [/^Army|^Bombardment|Megafauna|NuclearStrike|^STOFighter|^Xenoforming|Atrocity/, 'ground-and-orbital-combat'],
  [/Transfer|Probe|ExplorationRange_AU|LaserDefense|TargetingComputer|^Ship_Max|^Combat_Ship|DamageReduction|^Ship(Laser|Mag|Conv)|^Hab(Nuclear|MissionControl)/, 'space-operations'],
  [/Recruit|^CouncilSize$|^MaxAvailableOrgs$|^OrgPurchaseCost$|Councilor|^Interrogation|^NewCouncilor/, 'council-and-orgs'],
  [/^Can[A-Z]|^Explore|^Detect|^Advanced|^Global(Fission|Fusion)|^Human|^Alien|^Vaccine|^InfluenceLies|^Faked|^Marked|^Infiltrated|^Buddy|^Pherocyte/, 'capability-unlock']
]);

const unpricedContextGroup = (context) => {
  for (const [pattern, group] of UNPRICED_CONTEXT_RULES) {
    if (pattern.test(context)) return group;
  }
  return 'unmapped';
};

// ---------------------------------------------------------------------------
// CANDIDATES
// ---------------------------------------------------------------------------

/**
 * Prices one tech-tree node: its effects, its resource grants and its org grant.
 *
 * A node with nothing to price still produces a row -- with
 * `valuationState: 'unpriceable'` and the reasons attached -- because the whole
 * point of this endpoint is that such a node stays visible.
 */
function priceNode({
  node, effectIndex, baseline, quantities, availability, monthlyResearch, monthlyIncome,
  categoryBonuses, detail
}) {
  const rows = [];
  const contextsSeen = new Set();

  for (const entry of asArray(node?.effects)) {
    const effectId = entry?.effectId;
    if (!effectId) continue;
    const effect = effectIndex?.effects?.[effectId] || null;
    const contexts = asArray(effect?.contexts);

    if (contexts.length === 0) {
      // Either a one-time instant grant, or an unlock the phase-2 endpoint
      // owns. An unlock is not an economic effect and is labelled, not priced.
      //
      // `type: 'unlock'` is produced by `shared/techGraph.effectRecord` only
      // when the graph is built with a `componentByEffect` map, and
      // `server/snapshot/research.js` currently passes an empty one -- so no
      // node in a published snapshot carries one today. The branch is kept
      // because the graph builder can emit it and mis-pricing an unlock as an
      // economic gap would be wrong; it is NOT claimed to be exercised.
      if (entry?.type === 'unlock') {
        rows.push({
          effectId,
          kind: 'unlock',
          state: PRICING_STATES.unpriceable,
          unpriceableCode: 'no-quantity-mapping',
          unlockClass: entry.class ?? null,
          unlockTargetId: entry.targetId ?? null,
          note: 'this effect unlocks a buildable component; its military value is priced by /api/intel/military-value and its propulsion value by /api/intel/propulsion.'
        });
        continue;
      }
      if (!effect) {
        rows.push({ effectId, kind: 'effect', state: PRICING_STATES.unpriceable, unpriceableCode: 'effect-not-indexed' });
        continue;
      }
      if (effect.instantEffect) {
        rows.push({ ...priceInstantEffect({ effectId, effect, quantities }), kind: 'instant' });
        continue;
      }
      rows.push({ effectId, kind: 'effect', state: PRICING_STATES.unpriceable, unpriceableCode: 'no-quantity-mapping' });
      continue;
    }

    for (const context of contexts) {
      contextsSeen.add(context);
      rows.push({
        ...priceContextEffect({ effectId, effect, context, baseline, quantities }),
        kind: 'modifier'
      });
    }
  }

  // Resource grants are a project field the tech tree does not carry.
  const grant = effectIndex?.grants?.[node?.id] || null;
  const grantRows = asArray(grant?.resources).map(([resource, amount]) => ({
    ...priceResourceGrant({ resource, amount, monthlyIncome: monthlyIncome?.[resource] ?? null }),
    kind: 'grant',
    // A grant is one-time; the summary keeps it out of the per-month totals for
    // that reason, and the flag is what lets a caller keep the two apart.
    oneTime: true,
    deltaUnit: `months of ${resource} income`,
    delta: null
  }));

  // Per-month value only. A one-time grant is real value but it is not a rate,
  // and adding a windfall to a monthly total is how a 5,000-Exotics grant reads
  // as a permanent income stream.
  const recurring = rows.filter(row => row.oneTime !== true);
  const summary = summarizeValue(recurring);
  const instantRows = rows.filter(row => row.kind === 'instant');
  const oneTimeSummary = {
    grants: grantRows.length,
    instantEffects: instantRows.length,
    monthsOfIncome: grantRows
      .filter(row => row.monthsOfIncome !== null)
      .map(row => ({ resource: row.resource, amount: row.amount, monthsOfIncome: row.monthsOfIncome })),
    // The absolute amount survives even when months-of-income cannot be
    // computed, because "5,000 Exotics" is still the fact the reader wants.
    unpriceableGrants: grantRows
      .filter(row => row.monthsOfIncome === null)
      .map(row => ({ resource: row.resource, amount: row.amount, unpriceableCode: row.unpriceableCode })),
    // A priced instant effect produces a real number that is NOT a monthly
    // rate. Reporting only the census would have left the node showing
    // `priced` with an empty monthly value and no number anywhere.
    instantEffectValue: instantRows
      .filter(row => row.state === PRICING_STATES.priced)
      .map(row => ({
        effectId: row.effectId,
        instantEffect: row.instantEffect,
        delta: row.delta,
        deltaUnit: row.deltaUnit,
        formulaKey: row.formulaKey ?? null
      })),
    unpriceableInstantEffects: instantRows
      .filter(row => row.state === PRICING_STATES.unpriceable)
      .map(row => row.instantEffect)
      .filter((value, index, list) => value && list.indexOf(value) === index),
    org: grant?.org ?? null,
    orgNote: grant?.org
      ? 'this project grants a council org outright. Orgs are tech-gated council equipment with their own attribute and income bonuses; this endpoint names the org rather than pricing it, because the snapshot carries no org catalogue to price it from.'
      : null
  };

  const allRows = [...rows, ...grantRows];
  const pricedCount = allRows.filter(row => row.state === PRICING_STATES.priced).length;
  const inertCount = allRows.filter(row => row.state === PRICING_STATES.inert).length;
  const unpriceableCount = allRows.filter(row => row.state === PRICING_STATES.unpriceable).length;

  // The node's own overall state. `unpriceable` wins only when NOTHING about
  // the node could be priced -- so a node with one priced effect and three
  // unpriceable ones reads as priced-but-incomplete rather than as either
  // extreme, and `counts` says how incomplete.
  const valuationState = pricedCount > 0
    ? PRICING_STATES.priced
    : (inertCount > 0 ? PRICING_STATES.inert : PRICING_STATES.unpriceable);

  // What kind of thing this node offers at all. An unlock-only node is not an
  // economic gap -- its value is priced by /api/intel/military-value and
  // /api/intel/propulsion -- and lumping it in with contexts this module has
  // no mapping for would overstate how much is genuinely unquantified here.
  const unlockRows = rows.filter(row => row.kind === 'unlock').length;
  const modifierRows = rows.filter(row => row.kind === 'modifier').length;
  const economicContent = (modifierRows > 0 || grantRows.length > 0 || instantRows.length > 0)
    ? 'economic'
    // A project whose only grant is a council org has real value that this
    // endpoint cannot price -- the snapshot carries no org catalogue. That is
    // a different fact from having nothing at all, and the two had the same
    // label until an org-only project turned up reading as `none`.
    : (grant?.org ? 'org-only' : (unlockRows > 0 ? 'unlocks-only' : 'none'));

  const remaining = availability?.remainingResearchCost ?? null;
  // The duration is the flat figure, labelled with the observer's measured
  // bonus for THIS project's category rather than adjusted by it -- see
  // `researchCategoryBonus.mjs` for why the flat figure is kept.
  const duration = monthsAtIncomeForCategory(
    remaining,
    monthlyResearch,
    categoryBonuses.bonusFor(node.category ?? null)
  );

  return {
    id: node.id,
    displayName: node.displayName || node.id,
    type: node.type,
    category: node.category ?? null,
    subcategory: node.subcategory ?? null,
    availability: {
      state: availability?.state ?? AVAILABILITY_STATES.unknown,
      reason: availability?.reason ?? null,
      researchCost: availability?.researchCost ?? null,
      researchProgress: availability?.researchProgress ?? null,
      remainingResearchCost: remaining,
      monthsAtCurrentIncome: duration.months,
      // Why that number is what it is: whether the flat rate is the right rate
      // for this category, or the right rate with an unapplied bonus beside it.
      // The state is a CODE; `research.categoryBonuses.durationStates` spells
      // each one out once.
      monthsAtCurrentIncomeState: duration.state,
      // The EFFECTIVE bonus after the wiki diminishing-returns rule, not the
      // raw sum. Equal to the sum below the 50%-per-source-type threshold.
      categoryResearchBonus: duration.categoryBonus,
      flatRateMonths: duration.flatRateMonths,
      unlockChance: availability?.unlockChance ?? null,
      missingPrerequisites: detail === 'full' ? (availability?.missingPrerequisites ?? null) : null
    },
    valuationState,
    economicContent,
    counts: {
      priced: pricedCount,
      inert: inertCount,
      unpriceable: unpriceableCount,
      total: allRows.length,
      unlocks: unlockRows
    },
    contexts: [...contextsSeen].sort(),
    // The specific reasons, deduped, so a summary row still says WHY it could
    // not be priced instead of merely how often.
    unpriceableCodes: [...new Set(allRows
      .filter(row => row.state === PRICING_STATES.unpriceable && row.unpriceableCode)
      .map(row => row.unpriceableCode))].sort(),
    inertCodes: [...new Set(allRows
      .filter(row => row.state === PRICING_STATES.inert && row.inertCode)
      .map(row => row.inertCode))].sort(),
    monthlyValue: summary.byUnit,
    oneTimeValue: oneTimeSummary,
    valuePerResearchPoint: valuePerResearchPoint(summary, remaining),
    // The single largest priced monthly effect, so a summary row carries one
    // concrete number rather than only a census.
    largestPricedEffect: (() => {
      const best = recurring
        .filter(row => row.state === PRICING_STATES.priced && toFinite(row.delta) !== null)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      return best
        ? {
          effectId: best.effectId,
          context: best.context ?? null,
          delta: best.delta,
          deltaUnit: best.deltaUnit,
          quantityValue: best.quantity?.value ?? null,
          quantityLabel: best.quantity?.label ?? null,
          formulaKey: best.formulaKey ?? null
        }
        : null;
    })(),
    effects: detail === 'full' ? allRows : undefined
  };
}

// ---------------------------------------------------------------------------
// RESOURCE
// ---------------------------------------------------------------------------

/**
 * `/api/intel/economic-value` -- phase 3 of the research advisor.
 *
 * @param {Object} snapshot
 * @param {Object} [options]
 * @param {number|string} [options.observerId]
 * @param {string} [options.mode]           player | enhanced | omniscient
 * @param {string|null} [options.family]    narrow to one effect context
 * @param {string|null} [options.status]    narrow to one availability state
 * @param {number|null} [options.limit]
 * @param {string} [options.detail]         summary | full
 */
export const economicValueResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  mode = 'player',
  family = null,
  status = null,
  limit = null,
  detail = 'summary'
} = {}) => {
  const wantsFull = String(detail) === 'full';
  const requestedLimit = toFinite(limit);
  const candidateLimit = requestedLimit === null
    ? DEFAULT_CANDIDATE_LIMIT
    : Math.max(1, Math.min(MAX_CANDIDATE_LIMIT, Math.trunc(requestedLimit)));

  const effectIndex = snapshot?.effectIndex || null;
  const observerFaction = asArray(snapshot?.factions).find(entry => sameId(entry?.ID, observerId)) || null;
  const monthlyResearch = toFinite(observerFaction?.totalResearch);
  const monthlyIncome = observerFaction?.financials?.projectedMonthlyIncome
    || observerFaction?.monthlyIncome
    || null;

  const quantities = buildLiveQuantities(snapshot, observerId);
  const resolver = buildAvailabilityResolver(snapshot, mode, observerId);
  // Built once for the whole candidate sweep rather than per node: it walks
  // every hab module and councilor the observer holds.
  const categoryBonuses = buildResearchCategoryBonuses(snapshot, { observerId });
  const baseline = buildEffectBaseline(snapshot, observerId);

  const head = {
    resource: 'economic-value',
    observerFactionId: observerId,
    intelMode: mode,
    detail: wantsFull ? 'full' : 'summary',
    formulae: ECONOMIC_FORMULAE,
    operations: OPERATION_SEMANTICS,
    codes: {
      pricingStates: Object.values(PRICING_STATES),
      unpriceable: UNPRICEABLE_CODES,
      inert: INERT_CODES
    },
    method: {
      threeStates: 'every priced thing is `priced` (a number, from a measured quantity), `inert` (a MEASURED zero, with the reason it is zero) or `unpriceable` (null, with the context named). `inert` and `unpriceable` are different facts and never share a value: a tech whose value silently computes to 0 gets ranked last and never surfaces, which is the failure this endpoint is built around.',
      stacking: 'every price is a DELTA against what the observer already has active, read from their completed projects and the finished global techs. A non-stackable effect already held is worth nothing, an IncreaseToValue below the current level is worth nothing, and a SetToFixedValue below the current level is reported as a downgrade with the sign intact.',
      neverBlended: 'monthly value is reported per unit and never summed into one number. Research per month, tonnes per month and dollars per year have no exchange rate, and value-per-research-point is likewise computed per unit.',
      oneTimeSeparate: 'resource grants and instant effects are one-time and are kept out of the per-month totals. A 5,000-Exotics grant added to a monthly stream would read as permanent income.',
      baseline: 'every quantity is the observer\'s own current figure, read from this snapshot at request time. No threshold, resource name total, faction id or nation appears anywhere in the valuation.',
      modeSensitivity: 'the effect templates, the tech graph and the operation semantics are static game data and are identical in both modes. What is mode-sensitive is the OBSERVER\'S OWN state -- completed projects, ship and hab manifests, mining sites -- and player mode preserves all of it for the observer while redacting it for rivals. This endpoint therefore values the observer\'s research only, and makes no comparative claim that would need a rival\'s project state.'
    }
  };

  if (!effectIndex || !effectIndex.effects) {
    return {
      ...head,
      effectIndex: {
        available: false,
        reason: 'effectIndex is not present on this snapshot; re-publish after upgrading',
        census: null
      },
      quantities: { available: false, reason: 'not evaluated without an effect index', items: [] },
      baseline: { available: false, reason: baseline.reason, sources: null, crossCheck: null, contexts: [] },
      contextCoverage: null,
      research: {
        availabilityResolvable: resolver.available && resolver.availabilityKnown,
        availabilitySource: resolver.availabilitySource,
        availableProjectCount: resolver.availableProjectCount,
        reason: resolver.available ? null : resolver.reason,
        monthlyResearchIncome: monthlyResearch,
        monthlyResearchIncomeBasis: MEASURED_INCOME_BASIS,
        categoryBonuses: categoryBonusSummary(categoryBonuses),
        states: Object.values(AVAILABILITY_STATES)
      },
      filter: { context: null, state: null, candidateLimit, detail: wantsFull ? 'full' : 'summary' },
      count: 0,
      items: []
    };
  }

  // --- candidate set ------------------------------------------------------
  // Every node the observer has NOT completed that carries an effect, a
  // resource grant or an org grant. Availability comes from the save's own
  // list through the resolver; it is never derived from prerequisites here.
  const nodes = asArray(snapshot?.techTree?.nodes);
  const wantedContext = family ? String(family).trim() : null;
  const wantedState = status ? String(status).trim() : null;

  const candidates = [];
  let completedSkipped = 0;
  for (const node of nodes) {
    const hasEffects = asArray(node?.effects).length > 0;
    const grant = effectIndex.grants?.[node?.id] || null;
    if (!hasEffects && !grant) continue;
    const availability = resolver.resolve(node.id);
    if (availability.state === AVAILABILITY_STATES.completed) { completedSkipped += 1; continue; }
    const row = priceNode({
      node,
      effectIndex,
      baseline,
      quantities,
      availability,
      monthlyResearch,
      monthlyIncome,
      categoryBonuses,
      detail: wantsFull ? 'full' : 'summary'
    });
    if (wantedContext && !row.contexts.includes(wantedContext)) continue;
    if (wantedState && row.availability.state !== wantedState) continue;
    candidates.push(row);
  }

  // Deterministic and NOT a value ranking. Cross-unit ranking is phase 4 (spec
  // section 9 step 4); ordering these by any single number would be the blended
  // score phases 1 and 2 both refuse to produce.
  //
  // What the order DOES encode is reachability, which is not a judgement: a
  // project the save says the observer can research today is a different
  // proposition from one restricted to another faction's council, and putting
  // the second first made an unreachable target lead the response. Pricing
  // state breaks the tie and id breaks that, so the same snapshot always
  // yields the same order.
  const reachOrder = {
    [AVAILABILITY_STATES.researchableNow]: 0,
    [AVAILABILITY_STATES.researching]: 1,
    [AVAILABILITY_STATES.prereqClearUnrolled]: 2,
    [AVAILABILITY_STATES.prereqBlocked]: 3,
    [AVAILABILITY_STATES.ungated]: 4,
    [AVAILABILITY_STATES.factionRestricted]: 5,
    [AVAILABILITY_STATES.unknown]: 6,
    [AVAILABILITY_STATES.completed]: 7
  };
  const stateOrder = { [PRICING_STATES.priced]: 0, [PRICING_STATES.inert]: 1, [PRICING_STATES.unpriceable]: 2 };
  const rank = (row) => reachOrder[row.availability.state] ?? 9;
  candidates.sort((a, b) =>
    (rank(a) - rank(b)) ||
    (stateOrder[a.valuationState] - stateOrder[b.valuationState]) ||
    (b.counts.priced - a.counts.priced) ||
    String(a.id).localeCompare(String(b.id)));

  const tally = {
    priced: candidates.filter(row => row.valuationState === PRICING_STATES.priced).length,
    inert: candidates.filter(row => row.valuationState === PRICING_STATES.inert).length,
    unpriceable: candidates.filter(row => row.valuationState === PRICING_STATES.unpriceable).length,
    // Broken out of `unpriceable` because they are different facts: an
    // unlock-only node has no economic effect BY DESIGN and is priced by the
    // military and propulsion endpoints, and an org-only node has value this
    // snapshot carries no catalogue to price. Counting either as an economic
    // gap would overstate how much this endpoint cannot answer.
    unlocksOnly: candidates.filter(row => row.economicContent === 'unlocks-only').length,
    orgOnly: candidates.filter(row => row.economicContent === 'org-only').length,
    noContent: candidates.filter(row => row.economicContent === 'none').length
  };

  // --- context coverage ---------------------------------------------------
  const contextCounts = effectIndex.census?.contextCounts || {};
  const priced = PRICED_CONTEXTS.map(context => ({
    context,
    quantityKey: CONTEXT_QUANTITY_MAP[context].quantityKey,
    kind: CONTEXT_QUANTITY_MAP[context].kind,
    direction: CONTEXT_QUANTITY_MAP[context].direction,
    note: CONTEXT_QUANTITY_MAP[context].note,
    quantityMeasured: quantities.quantities?.[CONTEXT_QUANTITY_MAP[context].quantityKey]?.measured ?? false,
    effectsUsingIt: contextCounts[context] ?? 0
  })).sort((a, b) => b.effectsUsingIt - a.effectsUsingIt || a.context.localeCompare(b.context));

  const unpriced = Object.entries(contextCounts)
    .filter(([context]) => !CONTEXT_QUANTITY_MAP[context])
    .map(([context, effectsUsingIt]) => ({ context, effectsUsingIt, group: unpricedContextGroup(context) }))
    .sort((a, b) => b.effectsUsingIt - a.effectsUsingIt || a.context.localeCompare(b.context));

  const pricedRefs = priced.reduce((sum, row) => sum + row.effectsUsingIt, 0);
  const unpricedRefs = unpriced.reduce((sum, row) => sum + row.effectsUsingIt, 0);

  const shown = candidates.slice(0, candidateLimit);

  return {
    ...head,
    effectIndex: {
      available: true,
      reason: null,
      census: effectIndex.census || null,
      unresolved: asArray(effectIndex.unresolved)
    },
    quantities: {
      available: quantities.observerFactionPresent,
      reason: quantities.observerFactionPresent
        ? null
        : 'this observer has no faction record in this snapshot, so no live quantity could be measured',
      // Every quantity, measured or not, each naming its source field. A
      // caller can therefore audit which numbers the prices came from.
      items: Object.values(quantities.quantities),
      measuredCount: Object.values(quantities.quantities).filter(entry => entry.measured).length,
      totalCount: Object.keys(quantities.quantities).length,
      // Reported so the coverage of `controlPointResearchIncome` is visible:
      // the save's own research total exceeds the control-point share plus hab
      // modules by this much, from orgs, traits and unused mission control.
      unexplainedResearchIncome: quantities.unexplainedResearchIncome,
      missionControlPin: {
        formulaKey: 'missionControlUsage',
        modelledUsage: quantities.quantities.missionControlHeadroom?.modelledUsage ?? null,
        reportedUsage: quantities.quantities.missionControlHeadroom?.reportedUsage ?? null,
        residual: quantities.quantities.missionControlHeadroom?.residual ?? null,
        reproducesSaveFigure: quantities.quantities.missionControlHeadroom?.modelReproducesUsage ?? null
      }
    },
    baseline: {
      available: baseline.available,
      reason: baseline.reason,
      sources: baseline.sources,
      crossCheck: baseline.crossCheck,
      // The observer's active state on every context that has one, so a reader
      // can see WHY an effect priced the way it did.
      contexts: Object.values(baseline.contexts)
        .map(state => ({
          context: state.context,
          occurrences: state.occurrences,
          additiveTotal: round(state.additiveTotal, 6),
          multiplicativeProduct: round(state.multiplicativeProduct, 6),
          raisedToLevel: state.raisedToLevel,
          loweredToLevel: state.loweredToLevel,
          pricedByThisEndpoint: Boolean(CONTEXT_QUANTITY_MAP[state.context]),
          contributingEffects: wantsFull ? state.contributingEffects : state.contributingEffects.length
        }))
        .sort((a, b) => b.occurrences - a.occurrences || a.context.localeCompare(b.context))
    },
    contextCoverage: {
      pricedContextCount: priced.length,
      unpricedContextCount: unpriced.length,
      pricedEffectReferences: pricedRefs,
      unpricedEffectReferences: unpricedRefs,
      coverageOfEffectReferences: (pricedRefs + unpricedRefs) > 0
        ? round(pricedRefs / (pricedRefs + unpricedRefs), 4)
        : null,
      basis: 'the mappings below are the ones whose target quantity is actually measured in this snapshot. Every context WITHOUT a mapping is listed too, with the number of effects that use it and the group whose reason explains it, so the size of the gap is visible rather than inferred from silence.',
      // The reason prose, stated once. Rows carry the group key.
      unpricedGroups: UNPRICED_CONTEXT_GROUPS,
      unpricedGroupCounts: unpriced.reduce((counts, row) => {
        counts[row.group] = (counts[row.group] || 0) + 1;
        return counts;
      }, {}),
      priced,
      // Truncating this would hide exactly what the block exists to show, so
      // it is emitted in full at both detail levels.
      unpriced
    },
    research: {
      availabilityResolvable: resolver.available && resolver.availabilityKnown,
      availabilitySource: resolver.availabilitySource,
      availableProjectCount: resolver.availableProjectCount,
      reason: resolver.available
        ? (resolver.availabilityKnown ? null : 'the observer\'s available-project list is absent in this mode')
        : resolver.reason,
      monthlyResearchIncome: monthlyResearch,
      monthlyResearchIncomeBasis: MEASURED_INCOME_BASIS,
      // The observer's per-category research bonuses, with their sources, and
      // the model that says why no duration is divided by them.
      categoryBonuses: categoryBonusSummary(categoryBonuses),
      states: Object.values(AVAILABILITY_STATES),
      availabilityStates: tallyAvailabilityStates(candidates),
      completedAndExcluded: completedSkipped
    },
    valuation: {
      ...tally,
      candidatesConsidered: candidates.length,
      note: 'a candidate counts as `priced` when at least one of its effects or grants produced a number, `inert` when nothing priced but at least one thing WAS measured and found to change nothing, and `unpriceable` when nothing about it could be quantified from this save. The third group is listed, never dropped and never scored zero. `unlocksOnly` is a subset of the whole set, counted separately because a node whose only effects are component unlocks has no economic content by design.'
    },
    filter: {
      context: wantedContext,
      state: wantedState,
      candidateLimit,
      detail: wantsFull ? 'full' : 'summary',
      ordering: 'stable and deterministic: by REACHABILITY first (researchable now, then researching, prereq-clear, prereq-blocked, ungated, faction-restricted), then priced before inert before unpriceable, then by how many effects priced, then by id. This is NOT a value ranking -- cross-unit ranking is a later phase, and ordering by a single blended number is exactly what this feature refuses to do.',
      note: wantsFull
        ? null
        : 'summary detail: each candidate reports its census, its per-unit monthly value and its largest priced effect. Add `detail=full` for the per-effect rows and the prerequisite chains, `family=<context>` to narrow to one effect context, or `status=<state>` to narrow to one availability state.'
    },
    count: shown.length,
    totalCandidates: candidates.length,
    items: shown
  };
};

/**
 * The mined-resource table, re-exported so a caller (and the test that guards
 * the two against drift) can compare it with `shared/intel/common.mjs`.
 */
export { MINED_RESOURCES, CONTEXT_KINDS };
