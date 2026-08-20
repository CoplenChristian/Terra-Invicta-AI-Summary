/**
 * server/engine/budgets.js
 *
 * Tracks shared portfolio budget pools across the entire allocation cycle.
 * Prevents multiple individually affordable missions from jointly exceeding
 * campaign hate, influence, operations, or MC capacity limits.
 */

const { ALIEN_TOTAL_WAR_HATE } = require('../alienHateEconomics');

class BudgetPoolManager {
  constructor(world = {}, options = {}) {
    const rawHate = Number(world.alienHate?.assessedHate ?? world.alienHate?.hate ?? world.alienThreat?.hate ?? 0);
    const hateFloor = Number(world.alienHate?.mcFloor ?? world.alienThreat?.mcFloor ?? 0);
    const effectiveHate = Math.max(rawHate, hateFloor);

    const safetyMargin = typeof options.safetyMargin === 'number' ? options.safetyMargin : 0.5;
    const totalWarHate = ALIEN_TOTAL_WAR_HATE || 200;
    const hateHeadroom = Math.max(0, totalWarHate - effectiveHate);
    // Cycle hate budget reserves safety margin against total war threshold
    const cycleHateCap = Math.max(1.0, Math.min(15.0, Number((hateHeadroom * safetyMargin * 0.1).toFixed(1))));

    // Extract resources
    const res = world.resources || world.observerFaction?.resources || {};
    const influencePool = Math.max(0, Number(res.influence?.stockpile ?? res.influence ?? 100));
    const opsPool = Math.max(0, Number(res.operations?.stockpile ?? res.operations ?? 50));
    const moneyPool = Math.max(0, Number(res.money?.stockpile ?? res.money ?? 500));
    const mcUsed = Number(world.usedMC ?? res.missionControl?.used ?? 0);
    const mcCap = Number(world.mcCapacity ?? res.missionControl?.capacity ?? 100);

    this.pools = {
      alienHate: {
        used: 0,
        cap: cycleHateCap,
        headroom: hateHeadroom,
        currentHate: effectiveHate,
        unit: 'hate'
      },
      influence: {
        used: 0,
        cap: influencePool,
        unit: 'influence'
      },
      operations: {
        used: 0,
        cap: opsPool,
        unit: 'ops'
      },
      money: {
        used: 0,
        cap: moneyPool,
        unit: 'money'
      },
      missionControl: {
        used: mcUsed,
        cap: mcCap,
        unit: 'mc'
      }
    };
  }

  canAfford(cost = {}, expectedHate = 0) {
    const expHate = Number(expectedHate) || 0;
    if (expHate > 0 && (this.pools.alienHate.used + expHate) > this.pools.alienHate.cap) {
      return {
        affordable: false,
        pool: 'alienHate',
        shortfall: Number((this.pools.alienHate.used + expHate - this.pools.alienHate.cap).toFixed(2))
      };
    }

    const resType = String(cost.resource || cost.resourceType || '').toLowerCase();
    const amount = Number(cost.amount || cost.value || 0);

    if (amount > 0) {
      if (resType.includes('influence') && (this.pools.influence.used + amount) > this.pools.influence.cap) {
        return {
          affordable: false,
          pool: 'influence',
          shortfall: this.pools.influence.used + amount - this.pools.influence.cap
        };
      }
      if ((resType.includes('operation') || resType === 'ops') && (this.pools.operations.used + amount) > this.pools.operations.cap) {
        return {
          affordable: false,
          pool: 'operations',
          shortfall: this.pools.operations.used + amount - this.pools.operations.cap
        };
      }
      if (resType.includes('money') && (this.pools.money.used + amount) > this.pools.money.cap) {
        return {
          affordable: false,
          pool: 'money',
          shortfall: this.pools.money.used + amount - this.pools.money.cap
        };
      }
    }

    return { affordable: true };
  }

  consume(cost = {}, expectedHate = 0) {
    const expHate = Number(expectedHate) || 0;
    if (expHate > 0) {
      this.pools.alienHate.used = Number((this.pools.alienHate.used + expHate).toFixed(2));
    }

    const resType = String(cost.resource || cost.resourceType || '').toLowerCase();
    const amount = Number(cost.amount || cost.value || 0);

    if (amount > 0) {
      if (resType.includes('influence')) {
        this.pools.influence.used += amount;
      } else if (resType.includes('operation') || resType === 'ops') {
        this.pools.operations.used += amount;
      } else if (resType.includes('money')) {
        this.pools.money.used += amount;
      }
    }
  }

  getSummary() {
    return {
      alienHate: {
        used: this.pools.alienHate.used,
        cap: this.pools.alienHate.cap,
        headroom: this.pools.alienHate.headroom,
        unit: this.pools.alienHate.unit
      },
      influence: {
        used: this.pools.influence.used,
        cap: this.pools.influence.cap,
        unit: this.pools.influence.unit
      },
      operations: {
        used: this.pools.operations.used,
        cap: this.pools.operations.cap,
        unit: this.pools.operations.unit
      },
      money: {
        used: this.pools.money.used,
        cap: this.pools.money.cap,
        unit: this.pools.money.unit
      },
      missionControl: {
        used: this.pools.missionControl.used,
        cap: this.pools.missionControl.cap,
        unit: this.pools.missionControl.unit
      }
    };
  }
}

module.exports = {
  BudgetPoolManager
};
