/**
 * server/engine/missionCatalogue.js
 * Purpose: structured query access to the MissionSpec objects baked into the
 *   snapshot.
 *
 * Provides structured query access to MissionSpec objects baked into the
 * snapshot. Works in both local and hosted environments without filesystem
 * dependencies.
 */

class MissionCatalogue {
  constructor(missionSpecs = {}) {
    this.specs = new Map();
    if (missionSpecs && typeof missionSpecs === 'object') {
      for (const [key, spec] of Object.entries(missionSpecs)) {
        if (spec && typeof spec === 'object') {
          this.specs.set(key, spec);
          if (spec.friendlyName && spec.friendlyName !== key) {
            this.specs.set(spec.friendlyName, spec);
          }
        }
      }
    }
  }

  get(nameOrKey) {
    if (!nameOrKey) return null;
    return this.specs.get(nameOrKey) || null;
  }

  has(nameOrKey) {
    if (!nameOrKey) return false;
    return this.specs.has(nameOrKey);
  }

  isContested(nameOrKey) {
    const spec = this.get(nameOrKey);
    return spec ? Boolean(spec.contested) : false;
  }

  isAutomatic(nameOrKey) {
    const spec = this.get(nameOrKey);
    if (!spec) return false;
    return !spec.contested;
  }

  getCost(nameOrKey) {
    const spec = this.get(nameOrKey);
    if (!spec) return { resource: null, kind: null, amount: null };
    return {
      resource: spec.costResource || null,
      kind: spec.costKind || null,
      amount: typeof spec.costAmount === 'number' ? spec.costAmount : null
    };
  }

  getHate(nameOrKey) {
    const spec = this.get(nameOrKey);
    if (!spec) return { success: 0, failure: 0, critical: 0 };
    return {
      success: typeof spec.successHate === 'number' ? spec.successHate : 0,
      failure: typeof spec.failureHate === 'number' ? spec.failureHate : 0,
      critical: typeof spec.criticalHate === 'number' ? spec.criticalHate : 0
    };
  }

  getBaseDifficulty(nameOrKey) {
    const spec = this.get(nameOrKey);
    return spec && typeof spec.baseDifficulty === 'number' ? spec.baseDifficulty : 0;
  }

  getAttackAttribute(nameOrKey) {
    const spec = this.get(nameOrKey);
    return spec?.attack || null;
  }

  getDefendAttribute(nameOrKey) {
    const spec = this.get(nameOrKey);
    return spec?.defend || null;
  }

  all() {
    return Array.from(new Set(this.specs.values()));
  }

  get size() {
    return new Set(this.specs.values()).size;
  }
}

module.exports = {
  MissionCatalogue
};
