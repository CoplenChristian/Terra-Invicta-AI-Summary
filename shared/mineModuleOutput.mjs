// shared/mineModuleOutput.mjs
//
// Purpose: the mine module's own output multiplier — measured per built mine,
//   refused as a projection for an unowned site, and the upgrade headroom that
//   falls out of both.
//
// ---------------------------------------------------------------------------
// WHAT THE MULTIPLIER IS, AND WHY IT IS A MEASUREMENT AND NOT A MODEL
// ---------------------------------------------------------------------------
//
// `shared/miningTechBonus.mjs` established that `TIHabSiteState.<resource>_day`
// is the DEPOSIT's rate, not a mine's realised output. The mine module built on
// the site multiplies it. `TIHabModuleTemplate.json` (read 2026-08-22) carries
// exactly seven modules with `mine: true`, and their `miningModifier` spans
// 1.0 to 4.0 -- a LARGER term than the x1.15-per-grant tech bonus and one that
// applies to all five resources at once.
//
// The income model closes on it. Against `ExitSave.gz` (campaign date 1/1/2035,
// md5 5C0D9EF98213C91D8187AE11BF885D57):
//
//   SUM over OPERATIONAL mines of (site.<resource> x mineModule.miningModifier)
//     x 365.25/12 x 1.15^grants   ==   financials.projectedMonthlyIncome
//
// reads 0.999978 for the observer and 0.999979 for the Academy on all five
// resources -- 0.0022% error, every digit the save carries. So for a site that
// HAS a mine, the multiplier is read off the save, not assumed.
//
// TWO THINGS THAT MEASUREMENT ALSO SETTLED, both of which shape this module:
//
//   1. `AlienSettlementMiningComplex` is x2.0 while the human `Settlement` is
//      x1.5, so TIER DOES NOT DETERMINE THE MULTIPLIER. The join is by template
//      name. `site.mineTier` is 2 for both and would give the alien mine a 25%
//      understatement.
//   2. A NON-OPERATIONAL mine produces NOTHING. Re-running the reconciliation
//      with `building` and `pending-hab` modules folded in destroys it: Project
//      Exodus (12 of 22 mines building) goes from a 1.4e-5 spread across the
//      five resources to 1.2e+0, the Resistance (8 of 12) from 1.2e-4 to
//      8.0e-1, Humanity First (1 of 10) from 1.4e-5 to 3.0e-1. Measured on
//      three factions, so `constructionStatus` is a filter, not a decoration.
//
// ---------------------------------------------------------------------------
// THE DECISION THIS MODULE EXISTS TO RECORD: UNOWNED SITES ARE NOT PROJECTED
// ---------------------------------------------------------------------------
//
// An unowned candidate has no mine module -- 272 of 272 scored candidates on
// the measured save carry no `mineModuleTemplate`, no `mineTier` and no
// `habId`. Multiplying its yield therefore requires DECIDING which tier gets
// built, which is a modelling call. `MINE_MODULE_PROJECTION_POLICY` below is
// the decision and the evidence for it. The short version: the expansion
// board's score is non-linear (`evaluateSaturatingUtility` saturates), so a
// uniform assumed multiplier REORDERS the board -- 60 of 85 candidates move
// between x1.00 and x1.25, 64 of 85 between x1.25 and x1.50, 54 of 85 between
// x1.50 and x2.00. An ordering that reshuffles 64 sites when an unmeasurable
// assumption moves from 1.25 to 1.5 is not an ordering the save supports.
//
// So the multiplier is published as a BAND on the observer's own buildable
// tiers and is kept OUT of the score, which stays on the measured deposit rate
// times the measured tech bonus. `moduleMultiplierExcludedFromScore` says so on
// every candidate.
//
// ---------------------------------------------------------------------------
// ABSENT STAYS NULL, AND "NO MINE" IS NOT "x1.0"
// ---------------------------------------------------------------------------
//
// Three states, and only the first carries a number:
//
//   `measured`   the site names a module this table knows -> multiplier read.
//   `not-built`  the site names NO module. There is no mine, so there is no
//                module multiplier and no mined output. multiplier stays null;
//                a x1.0 here would claim an Outpost that does not exist.
//   `unknown`    the site names a module this table does NOT know (a modded or
//                post-1.0 module). multiplier stays null and the reason names
//                the module, because guessing 1.0 would silently understate a
//                x4.0 mine by 75%.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, toFiniteNumber as toFinite } from './util.mjs';

/** Every claim in this module cites templates read on this date. */
export const MINE_MODULE_MEASURED_ON = '2026-08-22';

/** How a site's mine-module multiplier resolved. */
export const MINE_MODULE_STATES = Object.freeze({
  measured: 'measured',
  notBuilt: 'not-built',
  unknown: 'unknown'
});

/**
 * The seven modules in `TIHabModuleTemplate.json` with `mine: true`, read
 * 2026-08-22.
 *
 * `upgradesFromTemplate` is the template's own `upgradesFromName`. Note what it
 * does NOT contain: nothing upgrades from `AutomatedMiningComplex`. It is a
 * terminal tier-1 branch, so a faction that built Automated mines cannot
 * upgrade them into a Settlement complex, and this module reports that as
 * `no-upgrade-path` rather than pricing an upgrade the templates do not offer.
 */
export const MINE_MODULE_TEMPLATES = Object.freeze([
  Object.freeze({
    template: 'OutpostMiningComplex',
    label: 'Outpost Mining Complex',
    tier: 1,
    multiplier: 1,
    requiredProject: 'Project_OutpostMiningComplex',
    upgradesFromTemplate: null,
    alienModule: false
  }),
  Object.freeze({
    template: 'AutomatedMiningComplex',
    label: 'Automated Mining Complex',
    tier: 1,
    multiplier: 1.25,
    requiredProject: 'Project_AutomatedMiningComplex',
    upgradesFromTemplate: null,
    alienModule: false
  }),
  Object.freeze({
    template: 'SettlementMiningComplex',
    label: 'Settlement Mining Complex',
    tier: 2,
    multiplier: 1.5,
    requiredProject: 'Project_SettlementMiningComplex',
    upgradesFromTemplate: 'OutpostMiningComplex',
    alienModule: false
  }),
  Object.freeze({
    template: 'ColonyMiningComplex',
    label: 'Colony Mining Complex',
    tier: 3,
    multiplier: 2,
    requiredProject: 'Project_ColonyMiningComplex',
    upgradesFromTemplate: 'SettlementMiningComplex',
    alienModule: false
  }),
  Object.freeze({
    template: 'AlienOutpostMiningComplex',
    label: 'Alien Outpost Mining Complex',
    tier: 1,
    multiplier: 1,
    requiredProject: 'Project_AlienMasterProject',
    upgradesFromTemplate: null,
    alienModule: true
  }),
  Object.freeze({
    // x2.0 at TIER 2, where the human Settlement complex is x1.5. This row is
    // why the join is by template name and never by `site.mineTier`.
    template: 'AlienSettlementMiningComplex',
    label: 'Alien Settlement Mining Complex',
    tier: 2,
    multiplier: 2,
    requiredProject: 'Project_AlienMasterProject',
    upgradesFromTemplate: 'AlienOutpostMiningComplex',
    alienModule: true
  }),
  Object.freeze({
    template: 'AlienColonyMiningComplex',
    label: 'Alien Colony Mining Complex',
    tier: 3,
    multiplier: 4,
    requiredProject: 'Project_AlienMasterProject',
    upgradesFromTemplate: 'AlienSettlementMiningComplex',
    alienModule: true
  })
]);

/**
 * The construction states in which a mine is actually producing.
 *
 * Measured, not assumed -- see the header. `server/snapshot/space.js` writes
 * `operational`, `building`, `pending-hab` and `not-installed`.
 */
export const MINE_OPERATIONAL_STATUS = 'operational';

/**
 * Why the expansion score does NOT carry a projected module multiplier.
 *
 * This object is PUBLISHED in player-mode payloads, so it names no faction and
 * no rival's holdings -- only the observer's own board and the arithmetic.
 */
export const MINE_MODULE_PROJECTION_POLICY = Object.freeze({
  decision: 'not-projected',
  summary: 'An unowned site has no mine module, so its module multiplier is a DECISION about which tier '
    + 'would be built, not a reading. The expansion score is left on the measured deposit rate and the '
    + 'measured tech bonus, and the module multiplier is published beside it as a band over the tiers the '
    + 'observer can actually build.',
  evidence: 'the site score saturates, so a uniform assumed multiplier reorders the board rather than '
    + 'scaling it: 60 of 85 candidates change rank between x1.00 and x1.25, 64 of 85 between x1.25 and '
    + `x1.50, and 54 of 85 between x1.50 and x2.00 (measured ${MINE_MODULE_MEASURED_ON}). The top nine `
    + 'are identical under every one of those multipliers, so a projection buys no change in the advice '
    + 'and costs 54-65 places of assumption-driven churn below it.',
  rejectedAlternatives: Object.freeze([
    Object.freeze({
      rule: 'assume the highest buildable tier',
      why: 'it contradicts what the faction actually builds. On the measured save the observer can build '
        + 'the x1.5 Settlement complex and 16 of its 17 mines are cheaper tiers.'
    }),
    Object.freeze({
      rule: 'assume the tier the faction builds most',
      why: 'it makes the ranking of UNOWNED sites depend on the faction\'s past building habits, which is '
        + 'a hidden, save-dependent reordering nobody asked for.'
    }),
    Object.freeze({
      rule: 'assume the cheapest buildable tier',
      why: 'cheapest is ambiguous and the ambiguity is not in the board\'s favour: the Automated complex '
        + '(x1.25) is cheaper than the Outpost complex (x1.0) on crew, power, build time and upkeep, and '
        + 'loses only on the upgrade path.'
    }),
    Object.freeze({
      rule: 'present a range and rank on it',
      why: 'a range cannot be sorted. Ranking still needs a point estimate, so this is the same decision '
        + 'wearing a wider label.'
    })
  ]),
  published: 'a band over the observer\'s buildable tiers, per candidate, in the ESTIMATE register'
});

const BY_TEMPLATE = new Map(MINE_MODULE_TEMPLATES.map(entry => [entry.template, entry]));
const UPGRADE_SUCCESSOR = new Map(
  MINE_MODULE_TEMPLATES
    .filter(entry => entry.upgradesFromTemplate !== null)
    .map(entry => [entry.upgradesFromTemplate, entry])
);

/**
 * Whether this set of sites models mine modules at all.
 *
 * `resolveMineModuleMultiplier` cannot tell "this site has no mine" from "this
 * snapshot does not carry the field", because both read as absent one site at a
 * time. Across a SET the difference is visible: a snapshot that models mines
 * writes `mineModuleTemplate` on every site, `null` included. One that predates
 * the field writes it nowhere.
 *
 * The distinction is load-bearing. Treating a snapshot that never carried the
 * field as "no site has a mine" would silently zero a faction's entire mined
 * output, which is the confident-zero this repo keeps fixing. A caller that
 * gets `false` here must fall back to the RAW deposit rates and SAY the module
 * term is unavailable, never claim the raw figure is module-adjusted.
 *
 * @param {Array} sites
 * @returns {boolean} true when at least one site carries the key in any form.
 */
export const mineModuleDataAvailable = (sites) => asArray(sites)
  .some(site => site && typeof site === 'object'
    && Object.prototype.hasOwnProperty.call(site, 'mineModuleTemplate'));

/**
 * One site's mine-module multiplier, and which of the three states it is in.
 *
 * @param {Object|null} site - a snapshot hab site (`mineModuleTemplate`,
 *   `constructionStatus`).
 * @returns {Object} never throws; `multiplier` is a number ONLY in the
 *   `measured` state.
 */
export const resolveMineModuleMultiplier = (site) => {
  const rawTemplate = site && typeof site === 'object' ? site.mineModuleTemplate : null;
  const template = typeof rawTemplate === 'string' && rawTemplate.trim() !== '' ? rawTemplate.trim() : null;
  const status = site && typeof site === 'object' && typeof site.constructionStatus === 'string'
    ? site.constructionStatus
    : null;
  const operational = status === MINE_OPERATIONAL_STATUS;

  if (template === null) {
    return Object.freeze({
      state: MINE_MODULE_STATES.notBuilt,
      multiplier: null,
      template: null,
      label: null,
      tier: null,
      constructionStatus: status,
      operational: false,
      reason: 'this site carries no mine module, so there is no mine and no module multiplier. It is a '
        + 'deposit rate, not an output — a x1.0 here would claim an Outpost complex that does not exist'
    });
  }

  const entry = BY_TEMPLATE.get(template) || null;
  if (entry === null) {
    return Object.freeze({
      state: MINE_MODULE_STATES.unknown,
      multiplier: null,
      template,
      label: null,
      tier: toFinite(site?.mineTier),
      constructionStatus: status,
      operational,
      reason: `'${template}' is not one of the seven mine modules in TIHabModuleTemplate.json `
        + `(read ${MINE_MODULE_MEASURED_ON}), so its output multiplier is UNKNOWN. Assuming 1.0 would `
        + 'understate a x4.0 module by 75%'
    });
  }

  return Object.freeze({
    state: MINE_MODULE_STATES.measured,
    multiplier: entry.multiplier,
    template: entry.template,
    label: entry.label,
    tier: entry.tier,
    constructionStatus: status,
    operational,
    reason: null
  });
};

/**
 * Applies one site's measured module multiplier to a raw figure, and says what
 * it did.
 *
 * Deliberately the same shape as `applyMiningTechBonus`, so a caller carrying
 * both writes the same code twice rather than two different disciplines.
 *
 * `notBuilt` and `unknown` both return `applied: false` with a reason. They
 * differ in what the caller should do: a `notBuilt` site has no mined output at
 * all (`producing` is false), while an `unknown` one is producing an amount
 * this table cannot scale.
 *
 * @param {number|null} value - the raw deposit figure. null in, null out.
 * @param {Object|null} resolution - the result of resolveMineModuleMultiplier.
 * @param {Object} [options]
 * @param {number|null} [options.places=null] - decimal places for the result.
 * @param {boolean} [options.requireOperational=true] - a mine that is not
 *   operational produces nothing (measured; see the header).
 */
export const applyMineModuleMultiplier = (value, resolution, { places = null, requireOperational = true } = {}) => {
  const round = (n) => (places === null ? n : Number(n.toFixed(places)));
  const state = resolution?.state ?? MINE_MODULE_STATES.unknown;
  const multiplier = typeof resolution?.multiplier === 'number' && Number.isFinite(resolution.multiplier)
    ? resolution.multiplier
    : null;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      value: null,
      raw: null,
      applied: false,
      producing: false,
      multiplier,
      state,
      module: resolution?.template ?? null,
      source: null,
      reason: 'no measured deposit figure to adjust'
    };
  }

  if (state === MINE_MODULE_STATES.notBuilt) {
    return {
      value: null,
      raw: round(value),
      applied: false,
      producing: false,
      multiplier: null,
      state,
      module: null,
      source: null,
      reason: resolution?.reason
        || 'this site carries no mine module, so it has no mined output'
    };
  }

  if (multiplier === null) {
    return {
      value: round(value),
      raw: round(value),
      applied: false,
      producing: true,
      multiplier: null,
      state: MINE_MODULE_STATES.unknown,
      module: resolution?.template ?? null,
      source: null,
      reason: resolution?.reason
        || 'the mine module multiplier could not be resolved, so this is the RAW deposit rate'
    };
  }

  if (requireOperational && resolution?.operational !== true) {
    return {
      value: null,
      raw: round(value),
      applied: false,
      producing: false,
      multiplier,
      state,
      module: resolution?.template ?? null,
      source: null,
      reason: `the ${resolution?.label || resolution?.template} on this site is `
        + `'${resolution?.constructionStatus ?? 'unrecorded'}', not operational, so it is producing nothing yet `
        + `(measured ${MINE_MODULE_MEASURED_ON}: folding non-operational mines into the income model `
        + 'destroys a reconciliation that is otherwise exact)'
    };
  }

  return {
    value: round(value * multiplier),
    raw: round(value),
    applied: multiplier !== 1,
    producing: true,
    multiplier,
    state,
    module: resolution.template,
    source: `${resolution.label} (miningModifier x${multiplier}, TIHabModuleTemplate.json read ${MINE_MODULE_MEASURED_ON})`,
    reason: null
  };
};

/**
 * Which mine complexes the observer's completed projects let it build.
 *
 * This is the only place the PROJECTION band comes from, and it is bounded by
 * measurement on both ends: a tier the observer has not researched is not in
 * the band at all.
 *
 * @param {Object|null} faction
 * @param {Object} [options]
 * @param {boolean|null} [options.projectListComplete=null] - true ONLY when the
 *   caller knows the list is the observer's own, unredacted one. Player mode
 *   truncates every other faction's `completedProjects` to five entries, so a
 *   band read from a rival's list would be wrong rather than absent.
 */
export const buildMineModuleCapability = (faction, { projectListComplete = null } = {}) => {
  const rawList = Array.isArray(faction?.completedProjects)
    ? faction.completedProjects
    : (Array.isArray(faction?.finishedProjectNames) ? faction.finishedProjectNames : null);

  let unavailableReason = null;
  if (!faction || typeof faction !== 'object') {
    unavailableReason = 'no faction was supplied, so no completed-project list could be read';
  } else if (rawList === null) {
    unavailableReason = 'the faction carries no completedProjects / finishedProjectNames array';
  } else if (projectListComplete !== true) {
    unavailableReason = 'the completed-project list is not known to be complete. Only the observer\'s own '
      + 'list is; player mode truncates every other faction\'s to five entries, so the buildable tiers read '
      + 'from it would be wrong rather than absent';
  }

  if (unavailableReason !== null) {
    return Object.freeze({
      available: false,
      unavailableReason,
      measuredOn: MINE_MODULE_MEASURED_ON,
      buildableTiers: Object.freeze([]),
      bestBuildable: null,
      projectedMultiplierRange: null,
      projectionPolicy: MINE_MODULE_PROJECTION_POLICY
    });
  }

  const held = new Set(asArray(rawList));
  // Alien modules are gated behind `Project_AlienMasterProject` and are not a
  // tier a human faction chooses between, so the band is the human ladder only.
  // An observer that somehow holds the alien project still gets them, because
  // the filter is the template's own requiredProject and nothing else.
  const buildableTiers = MINE_MODULE_TEMPLATES
    .filter(entry => held.has(entry.requiredProject))
    .map(entry => Object.freeze({
      template: entry.template,
      label: entry.label,
      tier: entry.tier,
      multiplier: entry.multiplier,
      requiredProject: entry.requiredProject
    }));

  if (buildableTiers.length === 0) {
    return Object.freeze({
      available: true,
      unavailableReason: null,
      measuredOn: MINE_MODULE_MEASURED_ON,
      buildableTiers: Object.freeze([]),
      bestBuildable: null,
      // Measured empty, not unknown: the list WAS read and it grants no mine
      // complex. A reader can tell that from `available: true`.
      projectedMultiplierRange: null,
      projectionPolicy: MINE_MODULE_PROJECTION_POLICY
    });
  }

  const bestBuildable = buildableTiers.reduce((best, entry) => (entry.multiplier > best.multiplier ? entry : best));
  const lowest = buildableTiers.reduce((low, entry) => (entry.multiplier < low.multiplier ? entry : low));

  return Object.freeze({
    available: true,
    unavailableReason: null,
    measuredOn: MINE_MODULE_MEASURED_ON,
    buildableTiers: Object.freeze(buildableTiers),
    bestBuildable,
    // The PROJECTION, and the only one this module publishes. It is a band, not
    // a point, precisely so it cannot be read as a measurement.
    projectedMultiplierRange: Object.freeze({
      low: lowest.multiplier,
      lowModule: lowest.template,
      lowLabel: lowest.label,
      high: bestBuildable.multiplier,
      highModule: bestBuildable.template,
      highLabel: bestBuildable.label,
      basis: 'the mine complexes the observer\'s completed projects allow; a tier it has not researched is '
        + 'not in the band'
    }),
    projectionPolicy: MINE_MODULE_PROJECTION_POLICY
  });
};

/**
 * The measured upgrade headroom on the observer's own mines.
 *
 * This is the half of the module multiplier that IS actionable and IS a
 * measurement: every term comes from the save or the templates, and nothing is
 * assumed. It matters because of an asymmetry the expansion board could not
 * previously state -- a NEW mine costs one against the faction's mine limit,
 * past which the Mission Control penalty is quadratic, while UPGRADING an
 * existing mine replaces the module in place (`onePerHab: true` on every mine
 * complex, and the successor's `upgradesFromName` names the module it replaces)
 * and so leaves the mine count, the limit and the penalty untouched.
 *
 * Three states per site, and the third is the one that keeps this honest:
 * `available` (a researched successor exists), `not-researched` (a successor
 * exists and the observer has not researched it — the project is named), and
 * `no-upgrade-path` (nothing in the templates upgrades from this module at all,
 * which is the Automated Mining Complex's situation).
 *
 * @param {Object} options
 * @param {Array} options.habSites
 * @param {number|string} options.observerId
 * @param {Object|null} options.capability - buildMineModuleCapability's result.
 * @param {Object|null} [options.miningTechBonus] - the observer's per-resource
 *   tech multipliers, applied so the gain is stated in the same units the rest
 *   of the board uses. Absent leaves the gain on raw deposit rates and says so.
 * @param {Array} options.resources - `[{ key, label }]`, the five mined
 *   resources, supplied by the caller so this module does not re-declare them.
 * @param {Function} [options.applyTechBonus] - `applyMiningTechBonus`, injected
 *   so this module keeps no dependency on the tech-bonus module's internals.
 */
export const buildMineUpgradeOpportunities = ({
  habSites = [],
  observerId = null,
  capability = null,
  miningTechBonus = null,
  resources = [],
  applyTechBonus = null,
  sameId = (a, b) => String(a) === String(b)
} = {}) => {
  const resourceKeys = asArray(resources).map(entry => entry?.key).filter(key => typeof key === 'string');
  const held = capability?.available === true
    ? new Set(asArray(capability.buildableTiers).map(entry => entry.template))
    : null;

  const sites = asArray(habSites).filter(site => sameId(site?.factionId, observerId));
  const opportunities = [];
  const counts = { available: 0, notResearched: 0, noUpgradePath: 0, notOperational: 0, unknownModule: 0, noMine: 0 };
  // Totals start at a measured zero, not at null: with the buildable tiers
  // resolved and every site examined, "no upgrade is available" is a real
  // answer of zero. A resource goes null only when a site that WOULD have
  // contributed had no readable rate, so a partial sum is never presented as a
  // complete one.
  const totalGain = {};
  const totalGainUnreadable = {};
  for (const key of resourceKeys) { totalGain[key] = 0; totalGainUnreadable[key] = false; }

  for (const site of sites) {
    const resolution = resolveMineModuleMultiplier(site);
    if (resolution.state === MINE_MODULE_STATES.notBuilt) { counts.noMine++; continue; }
    if (resolution.state === MINE_MODULE_STATES.unknown) {
      counts.unknownModule++;
      opportunities.push(Object.freeze({
        siteId: site.ID ?? null,
        displayName: site.displayName ?? null,
        parentBodyName: site.parentBodyName ?? null,
        currentModule: resolution.template,
        currentMultiplier: null,
        nextModule: null,
        nextMultiplier: null,
        multiplierGain: null,
        monthlyGain: null,
        state: 'unknown-module',
        reason: resolution.reason
      }));
      continue;
    }
    if (resolution.operational !== true) {
      counts.notOperational++;
      opportunities.push(Object.freeze({
        siteId: site.ID ?? null,
        displayName: site.displayName ?? null,
        parentBodyName: site.parentBodyName ?? null,
        currentModule: resolution.template,
        currentMultiplier: resolution.multiplier,
        nextModule: null,
        nextMultiplier: null,
        multiplierGain: null,
        monthlyGain: null,
        state: 'not-operational',
        reason: `this mine is '${resolution.constructionStatus ?? 'unrecorded'}' and is not producing yet, `
          + 'so there is nothing to upgrade'
      }));
      continue;
    }

    const successor = UPGRADE_SUCCESSOR.get(resolution.template) || null;
    if (successor === null) {
      counts.noUpgradePath++;
      opportunities.push(Object.freeze({
        siteId: site.ID ?? null,
        displayName: site.displayName ?? null,
        parentBodyName: site.parentBodyName ?? null,
        currentModule: resolution.template,
        currentMultiplier: resolution.multiplier,
        nextModule: null,
        nextMultiplier: null,
        multiplierGain: null,
        monthlyGain: null,
        state: 'no-upgrade-path',
        reason: `nothing in TIHabModuleTemplate.json upgrades from ${resolution.label} `
          + `(read ${MINE_MODULE_MEASURED_ON}), so this site is at its ceiling`
      }));
      continue;
    }

    if (held === null || !held.has(successor.template)) {
      counts.notResearched++;
      opportunities.push(Object.freeze({
        siteId: site.ID ?? null,
        displayName: site.displayName ?? null,
        parentBodyName: site.parentBodyName ?? null,
        currentModule: resolution.template,
        currentMultiplier: resolution.multiplier,
        nextModule: successor.template,
        nextMultiplier: successor.multiplier,
        multiplierGain: null,
        monthlyGain: null,
        state: held === null ? 'buildable-tiers-unknown' : 'not-researched',
        reason: held === null
          ? `the observer's buildable tiers are unresolved (${capability?.unavailableReason || 'reason not carried'}), `
            + 'so whether this upgrade is available cannot be decided'
          : `${successor.label} needs ${successor.requiredProject}, which is not in the observer's completed projects`
      }));
      continue;
    }

    const multiplierGain = Number((successor.multiplier - resolution.multiplier).toFixed(4));
    const monthlyGain = {};
    for (const { key } of asArray(resources)) {
      if (typeof key !== 'string') continue;
      const daily = toFinite(site?.[key]);
      if (daily === null) { monthlyGain[key] = null; totalGainUnreadable[key] = true; continue; }
      const rawGain = daily * 30 * multiplierGain;
      // The gain is stated in the same units the rest of the board uses, so it
      // carries the tech bonus when the caller supplied one. When it did not,
      // the figure is a raw deposit gain and `techBonusApplied` says so.
      const adjusted = typeof applyTechBonus === 'function'
        ? applyTechBonus(rawGain, miningTechBonus, key, { places: 1 })
        : { value: Number(rawGain.toFixed(1)) };
      monthlyGain[key] = adjusted.value;
      if (adjusted.value === null) totalGainUnreadable[key] = true;
      else totalGain[key] += adjusted.value;
    }

    counts.available++;
    opportunities.push(Object.freeze({
      siteId: site.ID ?? null,
      displayName: site.displayName ?? null,
      parentBodyName: site.parentBodyName ?? null,
      currentModule: resolution.template,
      currentMultiplier: resolution.multiplier,
      nextModule: successor.template,
      nextMultiplier: successor.multiplier,
      multiplierGain,
      monthlyGain: Object.freeze(monthlyGain),
      state: 'available',
      reason: null
    }));
  }

  for (const key of resourceKeys) {
    totalGain[key] = totalGainUnreadable[key] ? null : Number(totalGain[key].toFixed(1));
  }
  // The totals are a measurement only when the buildable tiers were resolved.
  // With them unresolved every site fell into `buildable-tiers-unknown`, and a
  // zero total would read as "no upgrade is worth anything".
  const gainMeasurable = held !== null;

  // Ranked by the multiplier gain, then by the site's own total gain, so the
  // fattest upgrade is first. A site with an unmeasurable gain sorts last
  // rather than being compared as though its gain were zero.
  const rankValue = (entry) => {
    if (entry.state !== 'available' || !entry.monthlyGain) return null;
    const values = Object.values(entry.monthlyGain).filter(v => typeof v === 'number' && Number.isFinite(v));
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  opportunities.sort((a, b) => {
    const av = rankValue(a);
    const bv = rankValue(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });

  return Object.freeze({
    measuredOn: MINE_MODULE_MEASURED_ON,
    // Every term here is read from the save or the templates. Nothing is
    // projected, which is what separates this block from the candidate band.
    basis: 'measured: the observer\'s own operational mines, their module\'s miningModifier, and the '
      + 'successor module TIHabModuleTemplate.json names for it',
    techBonusApplied: typeof applyTechBonus === 'function' && miningTechBonus?.available === true,
    // Upgrading replaces the module in place, so it does not move the mine
    // count the limit is measured against. A new claim does.
    mineLimitCost: 0,
    mineLimitNote: 'upgrading replaces the mine module in place (every mine complex is onePerHab, and the '
      + 'successor names the module it upgrades from), so the faction\'s mine count — and the quadratic '
      + 'Mission Control penalty measured against the limit — is unchanged. A NEW claim costs one.',
    counts: Object.freeze(counts),
    totalMonthlyGain: gainMeasurable ? Object.freeze(totalGain) : null,
    totalMonthlyGainMeasured: gainMeasurable,
    opportunities: Object.freeze(opportunities),
    opportunityTotalCount: opportunities.length
  });
};
