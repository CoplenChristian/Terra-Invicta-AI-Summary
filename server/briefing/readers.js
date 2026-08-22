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
 * The save's `habSites[].<resource>` is the DEPOSIT rate and carries no
 * faction's tech bonus (measured 2026-08-22, see shared/miningTechBonus.mjs),
 * so a resource the observer holds a completed mine project for reads 1.15x per
 * grant short here. `miningTechBonus` is that multiplier; when it is absent or
 * unresolved the raw rates are printed and the trailing clause SAYS they are
 * raw, rather than the reader assuming the figure is finished.
 */
function getMiningRateSummary(habSites, ownHabs, observerId, miningTechBonus = null) {
  const ownHabIds = new Set(asArray(ownHabs).map(hab => String(hab.ID ?? hab.id)));
  const visibleSites = asArray(habSites).filter(site =>
    sameId(site.factionId, observerId) || (site.habId !== null && site.habId !== undefined && ownHabIds.has(String(site.habId)))
  );
  const rates = [
    ['Water', 'water'],
    ['Volatiles', 'volatiles'],
    ['Metals', 'metals'],
    ['NobleMetals', 'nobleMetals'],
    ['Fissiles', 'fissiles']
  ].map(([label, key]) => {
    const values = visibleSites.map(site => toFiniteNumber(site[key])).filter(value => value !== null);
    if (values.length === 0) return null;
    const raw = values.reduce((sum, value) => sum + value, 0);
    const adjusted = applyMiningTechBonus(raw, miningTechBonus, key);
    return `${label} ${adjusted.value.toFixed(1)}/day`;
  }).filter(Boolean);
  if (rates.length === 0) return null;
  // Only said when there is something to say: a fully measured, fully
  // unbonused observer gets no trailing clause at all.
  const caveat = miningTechBonus === null ? null : miningTechBonusCaveat(miningTechBonus);
  return caveat ? `${rates.join(', ')} (${caveat})` : rates.join(', ');
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
 * `advise-hab:*`. The save's site rate is the DEPOSIT rate and carries no tech
 * bonus (measured 2026-08-22, shared/miningTechBonus.mjs), so a bonused
 * resource was being priced 1.15x per grant short. `miningTechBonus` corrects
 * it; `resourceOutputBonus` on each hab says whether the correction was applied
 * and names its source, so an adjusted output is never mistaken for a raw one.
 */
function buildAdvisableHabs(habs, habSites, observerId, miningTechBonus = null) {
  const sitesByHab = new Map();
  for (const site of asArray(habSites)) {
    const habId = site?.habId;
    if (habId === null || habId === undefined) continue;
    const key = String(habId);
    if (!sitesByHab.has(key)) sitesByHab.set(key, []);
    sitesByHab.get(key).push(site);
  }

  const RESOURCE_KEYS = ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles'];

  return asArray(habs)
    .filter(hab => sameId(hab.factionId, observerId))
    .map(hab => {
      const sites = sitesByHab.get(String(hab.ID)) || [];
      const monthly = {};
      const bonusByResource = {};
      for (const key of RESOURCE_KEYS) {
        let total = null;
        for (const site of sites) {
          const rate = toFiniteNumber(site[key]);
          if (rate === null) continue;
          total = (total ?? 0) + rate * 30;
        }
        const adjusted = applyMiningTechBonus(total, miningTechBonus, key, { places: 2 });
        monthly[key] = adjusted.value;
        bonusByResource[key] = {
          applied: adjusted.applied,
          multiplier: adjusted.multiplier,
          state: adjusted.state,
          source: adjusted.source,
          raw: adjusted.raw
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
        resourceOutputSource: sites.length > 0
          ? `${sites.length} joined hab site(s), daily rate x30`
            + (miningTechBonus?.available === true
              ? (miningTechBonus.boostedResources.length > 0
                ? `, ${miningTechBonusCaveat(miningTechBonus)}`
                : ', no completed project raises mine output')
              : ', mining tech bonuses UNRESOLVED (raw deposit rates, a lower bound)')
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
