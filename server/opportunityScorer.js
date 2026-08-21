const { resolveConfig } = require('./config');

class OpportunityScorer {
  constructor(config = null) {
    this.rules = config?.analysis?.opportunityScoring || resolveConfig().analysis.opportunityScoring;
  }

  scoreNationTarget(nation, controlPoints, observerFactionId, targetFactionId, targetFactionName = 'the Servants') {
    if (!nation) return null;

    let score = 0;
    const reasons = [];

    const targetCPs = controlPoints.filter(cp => cp.factionId === targetFactionId);
    const observerCPs = controlPoints.filter(cp => cp.factionId === observerFactionId);
    const isTargetControlled = targetCPs.length > 0;
    const isExecutiveTarget = controlPoints.some(cp => cp.isExecutive && cp.factionId === targetFactionId);

    if (!isTargetControlled && observerCPs.length === controlPoints.length) {
      return null; // Already fully controlled by player
    }

    // 1. Economic value (GDP)
    const gdpBillion = (nation.GDP || 0) / 1e9;
    const gdpTrillion = gdpBillion / 1000;
    if (gdpTrillion >= this.rules.gdp.superpowerThresholdTrillion) {
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
    const nukes = nation.nukes || 0;
    if (nukes > 0) {
      score += Math.min(this.rules.nukes.pointCap, nukes * this.rules.nukes.pointsPerBarrage);
      reasons.push(`Nuclear Arsenal (${nukes} barrage${nukes > 1 ? 's' : ''})`);
    }

    // 4. Mission Control & Boost
    const mc = nation.missionControl || 0;
    if (mc >= this.rules.missionControl.threshold) {
      score += this.rules.missionControl.points;
      reasons.push(`Strategic Mission Control (${mc} MC)`);
    }
    const boost = nation.boost || 0;
    if (boost >= this.rules.boost.threshold) {
      score += this.rules.boost.points;
      reasons.push(`Significant Boost Launch Capacity (${boost.toFixed(1)}/mo)`);
    }

    // 5. Crackdown vulnerability (high unrest, low cohesion)
    const unrest = nation.unrest || 0;
    const cohesion = nation.cohesion || 5;
    if (unrest >= this.rules.unrest.threshold) {
      score += this.rules.unrest.points;
      reasons.push(`High Unrest (${unrest.toFixed(1)}), Vulnerable to Crackdown`);
    }
    if (cohesion <= this.rules.cohesion.threshold) {
      score += this.rules.cohesion.points;
      reasons.push(`Fractured Cohesion (${cohesion.toFixed(1)})`);
    }

    // 6. Research output
    const research = nation.research || 0;
    if (research >= this.rules.research.threshold) {
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
      isServantControlled: targetFactionName === 'the Servants' ? isTargetControlled : undefined,
      isExecutiveServant: targetFactionName === 'the Servants' ? isExecutiveTarget : undefined,
      servantCPCount: targetFactionName === 'the Servants' ? targetCPs.length : undefined,
      totalCPCount: controlPoints.length,
      gdpTrillion: gdpTrillion.toFixed(2),
      nukes,
      mc,
      reasons
    };
  }

  selectPriorityTargetFaction(factions, nations, observerFactionId) {
    const observer = factions.find(f => f.ID === observerFactionId);
    const servants = factions.find(f => f.displayName === 'the Servants');

    // For every non-Servant observer, the Servants remain the campaign's
    // primary hostile target. If the observer is the Servants, choose the most
    // powerful opposing human faction from the save rather than hard-coding
    // Initiative.
    if (servants && servants.ID !== observerFactionId) {
      return { id: servants.ID, name: servants.displayName };
    }

    const candidates = factions.filter(f =>
      f.ID !== observerFactionId && f.displayName !== 'the Aliens'
    );
    const byNation = new Map();
    for (const nation of nations) {
      const cpIds = new Set((nation.controlPoints || []).map(cp => cp.factionId));
      for (const faction of candidates) {
        if (cpIds.has(faction.ID)) {
          const current = byNation.get(faction.ID) || { gdp: 0, cps: 0 };
          current.gdp += nation.GDP || 0;
          current.cps += (nation.controlPoints || []).filter(cp => cp.factionId === faction.ID).length;
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

  evaluateCampaignTargets(nations, controlPointsByNationId, observerFactionId, targetFactionId, targetFactionName = 'the Servants') {
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
