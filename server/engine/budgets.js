/**
 * server/engine/budgets.js
 * Purpose: tracks the shared portfolio budget pools across the entire
 *   allocation cycle, and reports every refusal with the charge, the remaining
 *   capacity and the basis the cap rests on.
 *
 * Tracks shared portfolio budget pools across the entire allocation cycle.
 * Prevents multiple individually affordable missions from jointly exceeding
 * campaign hate, influence, operations, or MC capacity limits.
 *
 * ABSENT CAPACITY IS UNKNOWN, NOT A NUMBER.
 *
 * This file used to write `Number(res.influence?.stockpile ?? res.influence ?? 100)`,
 * `?? 50` for operations and `?? 500` for money. Two things went wrong with
 * that at once:
 *
 *   1. The save's faction resource block is CAPITALISED (`Influence`,
 *      `Operations`, `Money`), so on a real snapshot every lookup missed and
 *      every pool silently fell back to its placeholder -- a 100-influence cap
 *      against a measured pool of 2946. A caller bridged the capitalisation at
 *      its own call site, which fixed that one path and left every other
 *      caller on the placeholders. Both spellings are read HERE now, so there
 *      is nothing left to bridge.
 *   2. A placeholder cap is a fabricated measurement. An absent pool now has
 *      `cap: null` / `capMeasured: false`, and a check against it reports
 *      `evaluated: false` -- the caller is told the check could not be run
 *      rather than being handed a pass or a fail it cannot trust.
 */

const { ALIEN_TOTAL_WAR_HATE } = require('../alienHateEconomics');
// Number(null) === 0 and Number('') === 0, so presence must be probed before
// coercion or an absent pool becomes a confident zero cap. That guard lives in
// shared/util.mjs now.
const { toFiniteNumber } = require('../../shared/util.mjs');

// Faction resource blocks appear in three shapes across snapshot, fixture and
// briefing paths: a bare number, `{ stockpile }`, and the save's own
// capitalised key. All are read; none is invented.
function readPoolCapacity(resources, names) {
  if (!resources || typeof resources !== 'object') return null;
  for (const name of names) {
    const raw = resources[name];
    if (raw === undefined || raw === null) continue;
    const value = (typeof raw === 'object')
      ? (raw.stockpile ?? raw.amount ?? raw.value ?? raw.available)
      : raw;
    const parsed = toFiniteNumber(value);
    if (parsed !== null) return Math.max(0, parsed);
  }
  return null;
}

const POOL_SOURCE_KEYS = Object.freeze({
  influence: ['influence', 'Influence'],
  operations: ['operations', 'Operations', 'ops', 'Ops'],
  money: ['money', 'Money']
});

class BudgetPoolManager {
  constructor(world = {}, options = {}) {
    const res = world.resources || world.observerFaction?.resources || {};

    // --- Alien hate ---------------------------------------------------
    // `?? 0` here read "we have no hate reading" as "hate is zero", which in
    // player mode (where the assessed hate is redacted) handed the cycle the
    // maximum hate budget on a snapshot that cannot support the claim.
    //
    // The spellings below are all real: fixtures use `assessedHate`/`hate`,
    // the snapshot's own faction block uses `alienHate.actual`, and the hate
    // economics block uses `actualAlienHate` / `minimumAlienHate`. Reading only
    // the fixture spellings is what left every live-save pool unmeasured --
    // the same field-name mismatch that produced the 100-influence placeholder.
    const economics = world.alienHateEconomics || {};
    const measuredHate = toFiniteNumber(
      world.alienHate?.assessedHate
      ?? world.alienHate?.hate
      ?? world.alienHate?.actual
      ?? world.alienThreat?.hate
      ?? economics.actualAlienHate
    );
    const hateFloor = toFiniteNumber(
      world.alienHate?.mcFloor
      ?? world.alienThreat?.mcFloor
      ?? economics.minimumAlienHate
    );
    const effectiveHate = (measuredHate === null && hateFloor === null)
      ? null
      : Math.max(measuredHate ?? 0, hateFloor ?? 0);

    const safetyMargin = typeof options.safetyMargin === 'number' ? options.safetyMargin : 0.5;
    const totalWarHate = toFiniteNumber(ALIEN_TOTAL_WAR_HATE) ?? 200;
    const hateHeadroom = effectiveHate === null ? null : Math.max(0, totalWarHate - effectiveHate);
    // Cycle hate budget reserves safety margin against total war threshold.
    const cycleHateCap = hateHeadroom === null
      ? null
      : Math.max(1.0, Math.min(15.0, Number((hateHeadroom * safetyMargin * 0.1).toFixed(1))));

    // WHAT THE CAP WAS DERIVED FROM, which is not the same question as whether
    // a number came out.
    //
    // Player mode redacts `actualAlienHate`, so `measuredHate` is null there
    // and `effectiveHate` falls back to `minimumAlienHate` -- the Mission
    // Control floor, which is a LOWER BOUND on hate and observable without
    // xenology intel. A cap still comes out (8.5 on the frozen save against
    // omniscient's 7.9), and `capMeasured: true` was the only thing said about
    // it, which reads as "this cap was measured". It was not: true hate can
    // only be >= the floor, so the headroom can only be <= this one and the cap
    // is an UPPER BOUND, not a measurement.
    //
    // Refusing the cap outright in that case was considered and rejected -- it
    // would make every affordability check unevaluated in player mode and so
    // change which candidates the plan assigns, and an UNBOUNDED hate budget is
    // a worse failure than an optimistic one. The basis is reported instead, so
    // every surface that prints the budget can say what it rests on.
    //
    // `measured` means a hate reading was present, whether or not the floor
    // then exceeded it: both inputs were known and the max of two known numbers
    // is known. `floor` means ONLY the floor was readable. `null` means neither
    // was, and then there is no cap at all.
    const currentHateBasis = effectiveHate === null
      ? null
      : (measuredHate !== null ? 'measured' : 'floor');

    // --- Resource pools ------------------------------------------------
    const influencePool = readPoolCapacity(res, POOL_SOURCE_KEYS.influence);
    const opsPool = readPoolCapacity(res, POOL_SOURCE_KEYS.operations);
    const moneyPool = readPoolCapacity(res, POOL_SOURCE_KEYS.money);

    const mcUsed = toFiniteNumber(
      world.usedMC
      ?? res.missionControl?.used
      ?? res.MissionControl?.used
      ?? economics.usedMissionControl
    );
    const mcCap = toFiniteNumber(
      world.mcCapacity
      ?? res.missionControl?.capacity
      ?? res.MissionControl?.capacity
      ?? economics.missionControlCapacity
    );

    this.pools = {
      alienHate: {
        used: 0,
        cap: cycleHateCap,
        capMeasured: cycleHateCap !== null,
        headroom: hateHeadroom,
        currentHate: effectiveHate,
        currentHateBasis,
        // True when the cap rests on the hate FLOOR rather than a hate reading,
        // so the real budget can only be this size or smaller.
        capIsUpperBound: currentHateBasis === 'floor',
        unit: 'hate'
      },
      influence: {
        used: 0,
        cap: influencePool,
        capMeasured: influencePool !== null,
        unit: 'influence'
      },
      operations: {
        used: 0,
        cap: opsPool,
        capMeasured: opsPool !== null,
        unit: 'ops'
      },
      money: {
        used: 0,
        cap: moneyPool,
        capMeasured: moneyPool !== null,
        unit: 'money'
      },
      missionControl: {
        used: mcUsed,
        cap: mcCap,
        capMeasured: mcCap !== null,
        unit: 'mc'
      }
    };
  }

  /** Pool name a cost line item charges against, or null if it names none. */
  static poolForCost(cost = {}) {
    const resType = String(cost.resource || cost.resourceType || '').toLowerCase();
    if (!resType) return null;
    if (resType.includes('influence')) return 'influence';
    if (resType.includes('operation') || resType === 'ops') return 'operations';
    if (resType.includes('money')) return 'money';
    return null;
  }

  /**
   * The three numbers a refusal has to carry for a reader to act on it.
   *
   * "The alienHate budget refused this" is not actionable on its own: the
   * reader cannot tell whether they are 0.1 short or 40 short, nor whether a
   * second option would fit beside the first. `shortfall` alone answered the
   * first question and neither of the others, so the CHARGE this action makes
   * and what was LEFT to pay it with travel with every refusal.
   *
   * `charge - remaining === shortfall` by construction, and `remaining` is
   * clamped at 0 because an over-consumed pool has nothing left rather than a
   * negative amount of it.
   */
  static describeRefusal(pool, poolName, amount) {
    const remaining = Math.max(0, Number((pool.cap - pool.used).toFixed(2)));
    return {
      pool: poolName,
      shortfall: Number((pool.used + amount - pool.cap).toFixed(2)),
      charge: Number(amount.toFixed(2)),
      cap: pool.cap,
      used: Number(pool.used.toFixed(2)),
      remaining,
      unit: pool.unit
    };
  }

  /**
   * A pool whose cap is unmeasured cannot answer "can we afford this". It is
   * reported through `evaluated: false` and `unmeasuredPools` rather than
   * silently passing as affordable or silently failing as broke -- the caller
   * records the gap so the plan can say the budget was never verified.
   */
  canAfford(cost = {}, expectedHate = 0) {
    const unmeasuredPools = [];
    const expHate = toFiniteNumber(expectedHate) ?? 0;

    if (expHate > 0) {
      if (this.pools.alienHate.cap === null) {
        unmeasuredPools.push('alienHate');
      } else if ((this.pools.alienHate.used + expHate) > this.pools.alienHate.cap) {
        return {
          affordable: false,
          evaluated: true,
          unmeasuredPools,
          ...BudgetPoolManager.describeRefusal(this.pools.alienHate, 'alienHate', expHate)
        };
      }
    }

    const poolName = BudgetPoolManager.poolForCost(cost);
    const amount = toFiniteNumber(cost.amount ?? cost.value) ?? 0;

    if (poolName && amount > 0) {
      const pool = this.pools[poolName];
      if (pool.cap === null) {
        unmeasuredPools.push(poolName);
      } else if ((pool.used + amount) > pool.cap) {
        return {
          affordable: false,
          evaluated: true,
          unmeasuredPools,
          ...BudgetPoolManager.describeRefusal(pool, poolName, amount)
        };
      }
    }

    return {
      affordable: true,
      evaluated: unmeasuredPools.length === 0,
      unmeasuredPools
    };
  }

  consume(cost = {}, expectedHate = 0) {
    const expHate = toFiniteNumber(expectedHate) ?? 0;
    if (expHate > 0) {
      this.pools.alienHate.used = Number((this.pools.alienHate.used + expHate).toFixed(2));
    }

    const poolName = BudgetPoolManager.poolForCost(cost);
    const amount = toFiniteNumber(cost.amount ?? cost.value) ?? 0;
    if (poolName && amount > 0) {
      this.pools[poolName].used += amount;
    }
  }

  /** Names of every pool whose cap the snapshot does not carry. */
  unmeasuredPools() {
    return Object.entries(this.pools)
      .filter(([, pool]) => pool.capMeasured === false)
      .map(([name]) => name);
  }

  getSummary() {
    const summarise = (name, extra = {}) => ({
      used: this.pools[name].used,
      cap: this.pools[name].cap,
      capMeasured: this.pools[name].capMeasured,
      unit: this.pools[name].unit,
      ...extra
    });

    return {
      alienHate: summarise('alienHate', {
        headroom: this.pools.alienHate.headroom,
        currentHate: this.pools.alienHate.currentHate,
        // `capMeasured` says a number came out; these two say what it rests on.
        // See the constructor for why a floor-derived cap is kept rather than
        // refused.
        currentHateBasis: this.pools.alienHate.currentHateBasis,
        capIsUpperBound: this.pools.alienHate.capIsUpperBound
      }),
      influence: summarise('influence'),
      operations: summarise('operations'),
      money: summarise('money'),
      missionControl: summarise('missionControl'),
      // A cap of null is not a cap of zero, and a consumer that only reads
      // `cap` would not be able to tell. This names the gap explicitly.
      unmeasured: this.unmeasuredPools()
    };
  }
}

module.exports = {
  BudgetPoolManager,
  readPoolCapacity
};
