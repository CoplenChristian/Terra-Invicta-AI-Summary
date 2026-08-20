const { resolveConfig } = require('./config');
const {
  SERVANTS_DISPLAY_NAME,
  ALIEN_FACTION_DISPLAY_NAME
} = require('../shared/constants.mjs');
// Absent stays null. `Number(null) === 0`, so every scoring input is probed
// for presence before it is coerced -- a nation whose GDP or Mission Control
// the save does not carry must not score as a nation that genuinely has none.
// The guard now lives in shared/util.mjs; the local name is kept because it
// reads well at ~15 call sites in this file.
const { toFiniteNumber: measured, sameId } = require('../shared/util.mjs');

class OpportunityScorer {
  constructor(config = null) {
    this.rules = config?.analysis?.opportunityScoring || resolveConfig().analysis.opportunityScoring;
  }

  scoreNationTarget(nation, controlPoints, observerFactionId, targetFactionId, targetFactionName = SERVANTS_DISPLAY_NAME) {
    if (!nation) return null;

    let score = 0;
    const reasons = [];

    const targetCPs = controlPoints.filter(cp => sameId(cp.factionId, targetFactionId));
    const observerCPs = controlPoints.filter(cp => sameId(cp.factionId, observerFactionId));
    const isTargetControlled = targetCPs.length > 0;
    const isExecutiveTarget = controlPoints.some(cp => cp.isExecutive && sameId(cp.factionId, targetFactionId));

    if (!isTargetControlled && observerCPs.length === controlPoints.length) {
      return null; // Already fully controlled by player
    }

    // 1. Economic value (GDP). An unmeasured GDP scores no economic points and
    // is named in `unmeasuredInputs`, rather than being scored as a $0 economy
    // -- which is a real finding ("this state has collapsed"), not a gap.
    const unmeasuredInputs = [];
    const gdp = measured(nation.GDP);
    const gdpBillion = gdp === null ? null : gdp / 1e9;
    const gdpTrillion = gdpBillion === null ? null : gdpBillion / 1000;
    if (gdpTrillion === null) {
      unmeasuredInputs.push('GDP');
      reasons.push('GDP UNAVAILABLE (not scored)');
    } else if (gdpTrillion >= this.rules.gdp.superpowerThresholdTrillion) {
      score += this.rules.gdp.superpowerPoints;
      reasons.push(`Superpower Economy ($${gdpTrillion.toFixed(1)}T GDP)`);
    } else if (gdpTrillion >= this.rules.gdp.majorThresholdTrillion) {
      score += this.rules.gdp.majorPoints;
      reasons.push(`Major Economy ($${gdpTrillion.toFixed(1)}T GDP)`);
    } else if (gdpBillion >= this.rules.gdp.regionalThresholdBillion) {
      score += this.rules.gdp.regionalPoints;
      reasons.push(`Regional Economy ($${gdpBillion.toFixed(0)}B GDP)`);
    }

    // 2. Target-faction holding severity
    if (isExecutiveTarget) {
      score += this.rules.targetControl.executivePoints;
      reasons.push(`${targetFactionName} Executive Control (National Priority Target)`);
    } else if (isTargetControlled) {
      score += this.rules.targetControl.heldBasePoints + (targetCPs.length * this.rules.targetControl.heldPerControlPoint);
      reasons.push(`${targetFactionName} hold ${targetCPs.length}/${controlPoints.length} Control Points`);
    }

    // 3. Nuclear capability
    const nukes = measured(nation.nukes);
    if (nukes === null) unmeasuredInputs.push('nukes');
    else if (nukes > 0) {
      score += Math.min(this.rules.nukes.pointCap, nukes * this.rules.nukes.pointsPerBarrage);
      reasons.push(`Nuclear Arsenal (${nukes} barrage${nukes > 1 ? 's' : ''})`);
    }

    // 4. Mission Control & Boost
    const mc = measured(nation.missionControl);
    if (mc === null) unmeasuredInputs.push('missionControl');
    else if (mc >= this.rules.missionControl.threshold) {
      score += this.rules.missionControl.points;
      reasons.push(`Strategic Mission Control (${mc} MC)`);
    }
    const boost = measured(nation.boost);
    if (boost === null) unmeasuredInputs.push('boost');
    else if (boost >= this.rules.boost.threshold) {
      score += this.rules.boost.points;
      reasons.push(`Significant Boost Launch Capacity (${boost.toFixed(1)}/mo)`);
    }

    // 5. Crackdown vulnerability (high unrest, low cohesion).
    // Cohesion previously defaulted to 5, which sits above the vulnerability
    // threshold -- an unmeasured nation was silently judged politically solid.
    const unrest = measured(nation.unrest);
    const cohesion = measured(nation.cohesion);
    if (unrest === null) unmeasuredInputs.push('unrest');
    else if (unrest >= this.rules.unrest.threshold) {
      score += this.rules.unrest.points;
      reasons.push(`High Unrest (${unrest.toFixed(1)}), Vulnerable to Crackdown`);
    }
    if (cohesion === null) unmeasuredInputs.push('cohesion');
    else if (cohesion <= this.rules.cohesion.threshold) {
      score += this.rules.cohesion.points;
      reasons.push(`Fractured Cohesion (${cohesion.toFixed(1)})`);
    }

    // 6. Research output
    const research = measured(nation.research);
    if (research === null) unmeasuredInputs.push('research');
    else if (research >= this.rules.research.threshold) {
      score += this.rules.research.points;
      reasons.push(`High Research Output (${research.toFixed(0)}/mo)`);
    }

    return {
      nationId: nation.ID,
      nationName: nation.displayName,
      score: Math.min(this.rules.scoreCap, Math.round(score)),
      targetFactionId,
      targetFactionName,
      isTargetControlled,
      isExecutiveTarget,
      targetCPCount: targetCPs.length,
      // Backwards-compatible aliases for existing exports and UI consumers.
      isServantControlled: targetFactionName === SERVANTS_DISPLAY_NAME ? isTargetControlled : undefined,
      isExecutiveServant: targetFactionName === SERVANTS_DISPLAY_NAME ? isExecutiveTarget : undefined,
      servantCPCount: targetFactionName === SERVANTS_DISPLAY_NAME ? targetCPs.length : undefined,
      totalCPCount: controlPoints.length,
      gdpTrillion: gdpTrillion === null ? null : gdpTrillion.toFixed(2),
      gdpAvailable: gdpTrillion !== null,
      nukes,
      mc,
      // Which scoring inputs the save did not carry. A score computed from a
      // partial input set is still returned, but it is now possible to say so
      // instead of presenting it as fully evidenced.
      unmeasuredInputs,
      scoreInputsComplete: unmeasuredInputs.length === 0,
      reasons
    };
  }

  selectPriorityTargetFaction(factions, nations, observerFactionId) {
    const observer = factions.find(f => sameId(f.ID, observerFactionId));
    const servants = factions.find(f => f.displayName === SERVANTS_DISPLAY_NAME);

    // For every non-Servant observer, the Servants remain the campaign's
    // primary hostile target. If the observer is the Servants, choose the most
    // powerful opposing human faction from the save rather than hard-coding
    // Initiative.
    if (servants && !sameId(servants.ID, observerFactionId)) {
      return { id: servants.ID, name: servants.displayName };
    }

    const candidates = factions.filter(f =>
      !sameId(f.ID, observerFactionId) && f.displayName !== ALIEN_FACTION_DISPLAY_NAME
    );
    const byNation = new Map();
    for (const nation of nations) {
      const cpIds = new Set((nation.controlPoints || []).map(cp => cp.factionId));
      for (const faction of candidates) {
        if (cpIds.has(faction.ID)) {
          const current = byNation.get(faction.ID) || { gdp: 0, cps: 0 };
          current.gdp += nation.GDP || 0;
          current.cps += (nation.controlPoints || []).filter(cp => sameId(cp.factionId, faction.ID)).length;
          byNation.set(faction.ID, current);
        }
      }
    }

    const selected = candidates.sort((a, b) => {
      const av = byNation.get(a.ID) || { gdp: 0, cps: 0 };
      const bv = byNation.get(b.ID) || { gdp: 0, cps: 0 };
      return (bv.gdp - av.gdp) || (bv.cps - av.cps);
    })[0];

    return selected ? { id: selected.ID, name: selected.displayName } : null;
  }

  evaluateCampaignTargets(nations, controlPointsByNationId, observerFactionId, targetFactionId, targetFactionName = SERVANTS_DISPLAY_NAME) {
    const targets = [];
    if (!targetFactionId) return targets;
    for (const nation of nations) {
      const cps = controlPointsByNationId.get(nation.ID) || [];
      const evaluated = this.scoreNationTarget(nation, cps, observerFactionId, targetFactionId, targetFactionName);
      if (evaluated && evaluated.score > this.rules.minimumScore) {
        targets.push(evaluated);
      }
    }
    return targets.sort((a, b) => b.score - a.score);
  }
}

module.exports = new OpportunityScorer();
