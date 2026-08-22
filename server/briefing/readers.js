// server/briefing/readers.js
//
// Purpose: snapshot-shaped readers — the joins and roll-ups the briefing and
//   directive builders both need.
//
// Snapshot-shaped readers: the joins and roll-ups the briefing and the
// directive builders both need, kept apart from the prose that consumes them.
//
// Each one distinguishes "the snapshot does not carry this" from "the measured
// value is zero". `getControlledNationData` returns null control points when
// no nation carried a control-point list at all; `getFleetCombatPower` returns
// null when the observer explicitly reports `combatPowerAvailable: false`
// rather than summing an empty list to 0.

const {
  asArray,
  sameId,
  toFiniteNumber,
  firstAvailableNumber
} = require('./format');
const {
  applyMiningTechBonus,
  miningTechBonusCaveat
} = require('../../shared/miningTechBonus.mjs');
const {
  applySpaceMiningBonus,
  spaceMiningBonusCaveat
} = require('../../shared/spaceMiningBonus.mjs');
const {
  applyMineModuleMultiplier,
  mineModuleDataAvailable,
  resolveMineModuleMultiplier,
  MINE_MODULE_STATES
} = require('../../shared/mineModuleOutput.mjs');

/**
 * One site's contribution to a mined-output total, module multiplier included.
 *
 * The save's site rate is the DEPOSIT's rate; the mine module built on it
 * multiplies that by 1.0 to 4.0 (`shared/mineModuleOutput.mjs`). Summing raw
 * rates therefore understated every owned figure by the whole module term,
 * which is larger than the tech bonus.
 *
 * Three outcomes, and only the first is a number:
 *   * a MEASURED, operational module -> rate x its miningModifier.
 *   * a site with no module, or a module that is not operational -> it is
 *     producing NOTHING, so it contributes nothing and is counted under
 *     `notProducing`. This is measured, not assumed: folding non-operational
 *     mines into the income model destroys a reconciliation that is otherwise
 *     exact on three separate factions.
 *   * a module this build does not recognise -> UNKNOWN. The raw rate is used
 *     so the total is not silently short, and the site is counted under
 *     `unknownModule` so the caller can say the total is a lower bound.
 *
 * `moduleDataAvailable` is the fourth case and it is a whole-snapshot one: a
 * snapshot that never carried `mineModuleTemplate` would otherwise read as "no
 * site anywhere has a mine" and zero the faction's entire mined output. When it
 * is false every site falls back to its RAW rate and the caller says the module
 * term is unavailable -- a labelled lower bound, not a claim.
 */
function siteMinedRate(site, resourceKey, moduleDataAvailable = true) {
  const raw = toFiniteNumber(site?.[resourceKey]);
  if (moduleDataAvailable !== true) {
    return {
      value: raw,
      raw,
      state: MINE_MODULE_STATES.unknown,
      producing: raw !== null,
      multiplier: null,
      module: null,
      fallbackRaw: raw
    };
  }
  const resolution = resolveMineModuleMultiplier(site);
  const applied = applyMineModuleMultiplier(raw, resolution);
  return {
    value: applied.value,
    raw: applied.raw,
    state: applied.state,
    producing: applied.producing,
    multiplier: applied.multiplier,
    module: applied.module,
    // An unrecognised module still produces; we just cannot scale it. Using the
    // raw rate keeps the total honest-low rather than dropping the site.
    fallbackRaw: applied.state === MINE_MODULE_STATES.unknown ? applied.raw : null
  };
}

function isFilteredDataAvailable(snapshot, fieldName, capabilityName, mode) {
  if (!Object.prototype.hasOwnProperty.call(snapshot, fieldName)) return false;
  if (mode === 'player' && snapshot.capabilities && snapshot.capabilities[capabilityName] === false) return false;
  return true;
}

function getResearchSlots(globalResearch) {
  if (Array.isArray(globalResearch)) return globalResearch;
  return asArray(globalResearch?.activeSlots);
}

function getControlledNationData(nations, observerId) {
  const visibleNations = asArray(nations);
  let controlPoints = 0;
  let hasControlPointData = false;
  const controlled = [];

  for (const nation of visibleNations) {
    const nationControlPoints = asArray(nation.controlPoints);
    const ownControlPoints = nationControlPoints.filter(cp => sameId(cp.factionId, observerId));
    if (nationControlPoints.length > 0) hasControlPointData = true;
    if (ownControlPoints.length > 0 || sameId(nation.executiveFactionId, observerId)) {
      controlled.push(nation);
      controlPoints += ownControlPoints.length;
    }
  }

  return {
    controlPoints: hasControlPointData ? controlPoints : null,
    nations: controlled.length > 0 ? controlled.length : null,
    gdp: controlled.length > 0 ? controlled.reduce((sum, nation) => sum + (toFiniteNumber(nation.GDP) || 0), 0) : null,
    // Last-resort fallback for a snapshot with no faction totalResearch. A
    // nation's research is split equally between its control points (wiki,
    // Nations, 2026-05-17), so take our share rather than the whole nation.
    // It still omits space and org research, so it is a floor, not a total.
    research: controlled.length > 0
      ? controlled.reduce((sum, nation) => {
        const nationControlPoints = asArray(nation.controlPoints);
        if (nationControlPoints.length === 0) return sum;
        const owned = nationControlPoints.filter(cp => sameId(cp.factionId, observerId)).length;
        return sum + (toFiniteNumber(nation.research) || 0) * (owned / nationControlPoints.length);
      }, 0)
      : null
  };
}

function getFleetCombatPower(observer, ownFleets) {
  const visibleFleets = asArray(ownFleets);
  const fleetValues = visibleFleets
    .map(fleet => toFiniteNumber(fleet.combatPower))
    .filter(value => value !== null);
  if (fleetValues.length > 0) return fleetValues.reduce((sum, value) => sum + value, 0);
  if (observer?.combatPowerAvailable === false) return null;
  return firstAvailableNumber(observer?.combatPower, observer?.fleetCombatPower);
}

/**
 * The observer's per-day mined rates, as one sentence fragment.
 *
 * The save's `habSites[].<resource>` is the DEPOSIT rate. Two multipliers stand
 * between it and what the observer actually mines, and BOTH are applied here:
 *
 *   * the mine module's own `miningModifier` (1.0 to 4.0), read per site from
 *     the module the save says is built there (`shared/mineModuleOutput.mjs`);
 *   * the observer's completed-project tech bonuses, x1.15 per grant,
 *     multiplicative (`shared/miningTechBonus.mjs`).
 *
 * With both applied the figure reconciles against the game's own
 * `projectedMonthlyIncome` at 0.0022% on all five resources, so it is the
 * observer's mined rate rather than a lower bound on it. When either
 * multiplier cannot be resolved the trailing clause SAYS so and the figure is
 * flagged as raw, rather than the reader assuming it is finished.
 */
function getMiningRateSummary(habSites, ownHabs, observerId, miningTechBonus = null, spaceMiningBonus = null) {
  const ownHabIds = new Set(asArray(ownHabs).map(hab => String(hab.ID ?? hab.id)));
  const visibleSites = asArray(habSites).filter(site =>
    sameId(site.factionId, observerId) || (site.habId !== null && site.habId !== undefined && ownHabIds.has(String(site.habId)))
  );
  const moduleDataAvailable = mineModuleDataAvailable(visibleSites);
  let unknownModuleSites = 0;
  let notProducingSites = 0;
  const rates = [
    ['Water', 'water'],
    ['Volatiles', 'volatiles'],
    ['Metals', 'metals'],
    ['NobleMetals', 'nobleMetals'],
    ['Fissiles', 'fissiles']
  ].map(([label, key], resourceIndex) => {
    const values = [];
    for (const site of visibleSites) {
      const contribution = siteMinedRate(site, key, moduleDataAvailable);
      // Count each site once, not once per resource. When the snapshot carries
      // no module data at all that is one fact about the snapshot, not N facts
      // about N sites, so it is reported separately below.
      if (resourceIndex === 0 && moduleDataAvailable) {
        if (contribution.state === MINE_MODULE_STATES.unknown) unknownModuleSites++;
        else if (contribution.producing === false && contribution.raw !== null) notProducingSites++;
      }
      const value = contribution.value ?? contribution.fallbackRaw;
      if (value !== null) values.push(value);
    }
    if (values.length === 0) return null;
    const moduleAdjusted = values.reduce((sum, value) => sum + value, 0);
    const adjusted = applyMiningTechBonus(moduleAdjusted, miningTechBonus, key);
    // The faction-wide additive bonus multiplies the product of the
    // per-resource x1.15 grants, once, after them -- the order measured in
    // `shared/spaceMiningBonus.mjs`. Chained, not folded in, so each term keeps
    // its own `applied` flag and an unresolved one leaves the figure unchanged
    // and labelled rather than silently scaled by 1.
    const withOperations = applySpaceMiningBonus(adjusted.value, spaceMiningBonus);
    return `${label} ${withOperations.value.toFixed(1)}/day`;
  }).filter(Boolean);
  if (rates.length === 0) return null;
  // Only said when there is something to say: a fully measured, fully
  // unbonused observer gets no trailing clause at all.
  const clauses = [];
  const caveat = miningTechBonus === null ? null : miningTechBonusCaveat(miningTechBonus);
  if (caveat) clauses.push(caveat);
  const operationsCaveat = spaceMiningBonus === null ? null : spaceMiningBonusCaveat(spaceMiningBonus);
  if (operationsCaveat) clauses.push(operationsCaveat);
  if (!moduleDataAvailable) {
    clauses.push('this snapshot carries no mine-module data, so the module\'s own 1.0-4.0 output multiplier '
      + 'is UNAVAILABLE and these are RAW deposit rates — a lower bound, not a measured output');
  }
  if (notProducingSites > 0) {
    clauses.push(`${notProducingSites} joined site(s) have no operational mine and contribute nothing yet`);
  }
  if (unknownModuleSites > 0) {
    clauses.push(`${unknownModuleSites} site(s) carry a mine module this build does not recognise, so their `
      + 'deposit rate is counted unscaled and the total is a LOWER BOUND');
  }
  return clauses.length > 0 ? `${rates.join(', ')} (${clauses.join('; ')})` : rates.join(', ');
}

/**
 * Owned habs, enriched with the monthly resource output the directive
 * engine's Advise economics needs.
 *
 * A hab record in the snapshot carries identity and posture but no output
 * figures at all, so passing it straight through would give every hab five
 * absent inputs. The mined output IS derivable: hab sites join to their hab
 * by `habId` and carry per-day rates. 30x each measured rate is the monthly
 * output Advise scales by Administration.
 *
 * `research`, `money` and marine combat are NOT in the snapshot. They stay
 * null rather than being filled with a plausible-looking number, and a hab
 * left with nothing measurable is dropped by the candidate generator with a
 * recorded reason.
 *
 * THESE FIGURES REACH COUNCILOR RECOMMENDATIONS, not just a display: the
 * directive engine's Advise economics scales them by Administration to price
 * `advise-hab:*`. The save's site rate is the DEPOSIT rate, and TWO multipliers
 * stand between it and the hab's realised output: the mine module's own
 * `miningModifier` (1.0-4.0, per site, `shared/mineModuleOutput.mjs`) and the
 * observer's completed-project tech bonuses (x1.15 per grant,
 * `shared/miningTechBonus.mjs`). Both are applied here; with both in, the
 * observer's total reconciles against the game's own monthly income to 0.0022%.
 * `resourceOutputBonus` and `mineModules` on each hab say what was applied and
 * name the source, so an adjusted output is never mistaken for a raw one.
 */
function buildAdvisableHabs(habs, habSites, observerId, miningTechBonus = null, spaceMiningBonus = null) {
  const sitesByHab = new Map();
  for (const site of asArray(habSites)) {
    const habId = site?.habId;
    if (habId === null || habId === undefined) continue;
    const key = String(habId);
    if (!sitesByHab.has(key)) sitesByHab.set(key, []);
    sitesByHab.get(key).push(site);
  }

  const RESOURCE_KEYS = ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles'];
  // One fact about the snapshot, decided once over every site rather than
  // per hab -- a hab whose sites happen to have no mine must not be mistaken
  // for a snapshot that does not model mines at all.
  const moduleDataAvailable = mineModuleDataAvailable(habSites);

  return asArray(habs)
    .filter(hab => sameId(hab.factionId, observerId))
    .map(hab => {
      const sites = sitesByHab.get(String(hab.ID)) || [];
      // What each joined site's mine module is, once, so the hab can say which
      // multiplier produced its numbers instead of the reader guessing.
      const mineModules = !moduleDataAvailable ? [] : sites.map(site => {
        const resolution = resolveMineModuleMultiplier(site);
        return {
          siteId: site.ID ?? null,
          site: site.displayName ?? null,
          module: resolution.template,
          multiplier: resolution.multiplier,
          state: resolution.state,
          operational: resolution.operational,
          reason: resolution.reason
        };
      });
      const unknownModuleCount = mineModules.filter(m => m.state === MINE_MODULE_STATES.unknown).length;
      const monthly = {};
      const bonusByResource = {};
      for (const key of RESOURCE_KEYS) {
        let total = null;
        for (const site of sites) {
          const contribution = siteMinedRate(site, key, moduleDataAvailable);
          // A site with no operational mine yields nothing; an unrecognised
          // module falls back to the unscaled rate rather than being dropped.
          const rate = contribution.value ?? contribution.fallbackRaw;
          if (rate === null) continue;
          total = (total ?? 0) + rate * 30;
        }
        const adjusted = applyMiningTechBonus(total, miningTechBonus, key, { places: 2 });
        // Then the faction-wide additive bonus, once, over the top -- the order
        // `shared/spaceMiningBonus.mjs` measured. It is the same factor on all
        // five resources, so it is reported once on the hab rather than five
        // times, but the per-resource block still carries its own applied flag
        // so a reader can tell an adjusted figure from an unadjusted one.
        const withOperations = applySpaceMiningBonus(adjusted.value, spaceMiningBonus, { places: 2 });
        monthly[key] = withOperations.value;
        bonusByResource[key] = {
          applied: adjusted.applied,
          multiplier: adjusted.multiplier,
          state: adjusted.state,
          source: adjusted.source,
          raw: adjusted.raw,
          spaceMiningBonusApplied: withOperations.applied,
          spaceMiningBonusMultiplier: withOperations.multiplier,
          spaceMiningBonusState: withOperations.state
        };
      }
      return {
        ...hab,
        ...monthly,
        // Which of the five monthly figures above are bonus-adjusted, by how
        // much, and from what. An unresolved multiplier leaves the RAW figure
        // in place with `applied: false` -- it is never reported as a measured
        // "no bonus".
        resourceOutputBonus: bonusByResource,
        resourceOutputBonusApplied: miningTechBonus?.available === true,
        // The faction-wide additive space-mining bonus, once, with the orgs and
        // effects that make it up named. `available: false` means the five
        // monthly figures above OMIT it and are a lower bound -- never that the
        // observer holds none.
        spaceMiningBonus: spaceMiningBonus === null ? null : {
          available: spaceMiningBonus.available === true,
          state: spaceMiningBonus.state,
          multiplier: spaceMiningBonus.multiplier,
          additiveTotal: spaceMiningBonus.additiveTotal,
          sources: spaceMiningBonus.sources,
          inactiveSources: spaceMiningBonus.inactiveSources,
          unknownReason: spaceMiningBonus.unknownReason
        },
        // The mine module behind each joined site's figures, and its measured
        // multiplier. `multiplier: null` with state `not-built` means the site
        // has no mine and contributed nothing -- it is NOT a x1.0.
        mineModules,
        mineModulesApplied: mineModules.some(m => m.state === MINE_MODULE_STATES.measured),
        mineModuleDataAvailable: moduleDataAvailable,
        mineModuleUnknownCount: unknownModuleCount,
        resourceOutputSource: sites.length > 0
          ? `${sites.length} joined hab site(s), `
            + (moduleDataAvailable
              ? 'deposit rate x mine module miningModifier x30'
              : 'RAW deposit rate x30 — this snapshot carries no mine-module data, so the module\'s own '
                + '1.0-4.0 multiplier is UNAVAILABLE and this is a lower bound')
            + (unknownModuleCount > 0
              ? `, ${unknownModuleCount} module(s) UNRECOGNISED and counted unscaled (a lower bound)`
              : '')
            + (miningTechBonus?.available === true
              ? (miningTechBonus.boostedResources.length > 0
                ? `, ${miningTechBonusCaveat(miningTechBonus)}`
                : ', no completed project raises mine output')
              : ', mining tech bonuses UNRESOLVED (raw deposit rates, a lower bound)')
            + (spaceMiningBonus === null
              ? ''
              : (spaceMiningBonus.available === true
                ? (spaceMiningBonusCaveat(spaceMiningBonus) !== null
                  ? `, ${spaceMiningBonusCaveat(spaceMiningBonus)}`
                  : ', no org or effect raises mine output faction-wide')
                : `, ${spaceMiningBonusCaveat(spaceMiningBonus)}`))
          : 'no hab site joins to this hab',
        // Explicitly absent rather than absent by omission.
        research: toFiniteNumber(hab.research),
        money: toFiniteNumber(hab.money),
        marineCombatValue: toFiniteNumber(hab.marineCombatValue ?? hab.combatValue)
      };
    });
}

/**
 * The observer's alien-hate movement since the previous save, or null.
 *
 * GUARDED ON MODE ON PURPOSE. `changesSincePrevious` carries an "Assessed
 * alien hate" row for the observer, and that row is the SAVE's raw figure --
 * the one player mode redacts everywhere else. Reading it unguarded would
 * both leak the redacted value and produce a rate that silently disappears
 * the moment the leak is closed. `hateObservable` is exactly "the true hate
 * is legitimately readable in this mode", so gate on that and nothing else.
 */
function readObserverHateTrend(snapshot = {}, observerId = null, posture = {}) {
  if (posture?.hateObservable !== true) return null;
  const changes = snapshot.changesSincePrevious;
  if (!changes || changes.available !== true) return null;
  const elapsedGameDays = toFiniteNumber(changes.elapsedGameDays);
  if (elapsedGameDays === null || !(elapsedGameDays > 0)) return null;
  const entry = asArray(changes.factions).find(f => sameId(f.factionId, observerId));
  const change = asArray(entry?.changes)
    .find(c => /alien hate/i.test(String(c?.metric || '')));
  const delta = toFiniteNumber(change?.delta);
  if (delta === null) return null;
  return {
    delta,
    from: toFiniteNumber(change.from),
    to: toFiniteNumber(change.to),
    elapsedGameDays
  };
}

module.exports = {
  isFilteredDataAvailable,
  getResearchSlots,
  getControlledNationData,
  getFleetCombatPower,
  getMiningRateSummary,
  buildAdvisableHabs,
  readObserverHateTrend
};
