/**
 * server/engine/budgets.js
 * Purpose: tracks the shared portfolio budget pools across the entire
 *   allocation cycle.
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
          pool: 'alienHate',
          shortfall: Number((this.pools.alienHate.used + expHate - this.pools.alienHate.cap).toFixed(2))
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
          pool: poolName,
          shortfall: Number((pool.used + amount - pool.cap).toFixed(2))
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
        currentHate: this.pools.alienHate.currentHate
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
