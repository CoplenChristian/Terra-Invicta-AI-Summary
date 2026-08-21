/**
 * server/commentary/grammar.js
 *
 * Layer 4 — Templated phrasing, connective assembly, and prose generation.
 *
 * Rules:
 * - Deterministic phrasing selection via seeded PRNG.
 * - Connectives follow beat severity and sign.
 * - Zero null, undefined, or NaN in rendered prose.
 * - Clear distinction between measured facts and simulated numbers.
 */

'use strict';

const { createPrng } = require('./prng');

/**
 * Formats a simulated threshold count or band into prose text.
 */
function formatSimulatedThreshold(simResult) {
  if (!simResult || !simResult.available || !Array.isArray(simResult.tiers) || simResult.tiers.length === 0) {
    return 'adequate modern combat forces';
  }

  // Look for heavy or typical alien tier
  const heavyTier = simResult.tiers.find(t => t.id === 'heavy-alien-capital') || simResult.tiers[simResult.tiers.length - 1];
  const typicalTier = simResult.tiers.find(t => t.id === 'typical-alien-combatant') || simResult.tiers[0];

  const targetHull = simResult.ownBestDesign || simResult.ownBestHull || 'heavy combatants';

  if (heavyTier && heavyTier.winnable) {
    return `${heavyTier.bandLabel} ${targetHull}`;
  } else if (typicalTier && typicalTier.winnable) {
    return `${typicalTier.bandLabel} ${targetHull}`;
  }

  return `a decisive fleet of ${targetHull}`;
}

/**
 * Generates natural language strategic commentary prose and headline.
 */
function generateGrammar({ facts, beats, simulation }) {
  const prng = createPrng(`${facts.snapshotId}-grammar`);

  const hasForcedTransition = beats.some(b => b.id === 'forced-fleet-transition');
  const hasRecoveryWindow = beats.some(b => b.id === 'recovery-window');
  const hasDecisiveDeficit = beats.some(b => b.id === 'capability-gap-widening');
  const hasBankedBudget = beats.some(b => b.id === 'hate-budget-banked');
  const isHoldGround = facts.isHoldGroundActive;

  const simThresholdText = formatSimulatedThreshold(simulation);
  const targetDesign = simulation.ownBestDesign || simulation.ownBestHull || 'modern combat hulls';

  // 1. Headline Generation
  let headline = '';
  if (hasForcedTransition) {
    const templates = [
      'Strategic Pivot: Fleet transition forced by attrition into superior hull tiers',
      'Combat Reset: Fleet losses concentrated in older generation while newer hulls survived',
      'Fleet Consolidation: Hostility burned down, surviving force concentrated in higher tier'
    ];
    headline = prng.choice(templates);
  } else if (hasRecoveryWindow) {
    const templates = [
      'Strategic Window: Alien hostility venting below war threshold',
      'Recovery Phase: Alien pressure reduced, window open for economic consolidation',
      'Operational Respite: Alien hostility declining across the solar system'
    ];
    headline = prng.choice(templates);
  } else if (isHoldGround || hasDecisiveDeficit) {
    const dominantLabel = facts.dominantDeficit?.label || 'fleet capability';
    const templates = [
      `Hold Posture: Defending holdings while closing the ${dominantLabel} deficit`,
      `Strategic Rebalance: Prioritizing zero-hate economic expansion during fleet gap`,
      `Defensive Stand: Consolidating assets until fleet contestability is achieved`
    ];
    headline = prng.choice(templates);
  } else if (hasBankedBudget) {
    const templates = [
      'Stable Equilibrium: Substantial alien threat headroom banked',
      'Strategic Runway: Low alien hostility permits focused development',
      'Operational Freedom: Alien threat meter stable with available capacity'
    ];
    headline = prng.choice(templates);
  } else {
    headline = 'Campaign Intelligence Assessment: Status quo across major theaters';
  }

  // 2. Prose Assembly
  const proseParagraphs = [];

  // Opening / Concessive statement
  if (hasForcedTransition) {
    const hateText = facts.actualAlienHate !== null
      ? `roughly ${Math.round(facts.actualAlienHate)} hate`
      : 'sustainable baseline levels';

    const p1 = `The critical takeaway is not simply that ${facts.shipsLost} ship(s) were lost in earlier engagements. `
      + `It is that the aliens burned enough hostility that we are back below active war pressure at ${hateText}, `
      + `while our surviving space assets are now concentrated in Tier ${facts.medianSurvivingHullTier || 2} construction.`;
    proseParagraphs.push(p1);
  } else if (hasRecoveryWindow) {
    const deltaStr = facts.hateDelta !== null ? Math.abs(facts.hateDelta).toFixed(1) : 'material';
    const p1 = `Alien hostility has trended downward (burning ${deltaStr} points of hostility on the recent interval). `
      + `This establishes a clear defensive recovery window before future escalation cycles.`;
    proseParagraphs.push(p1);
  } else if (isHoldGround) {
    const p1 = `The strategic read matches executive doctrine: with the alien war threshold active and fleet capabilities `
      + `asymmetric, holding non-provocative ground is the optimal move. Declining to add hate allows hostility to vent naturally.`;
    proseParagraphs.push(p1);
  } else {
    const p1 = `Current campaign telemetry indicates stable operational posture across Earth and orbital theaters. `
      + `Alien hostility remains within manageable thresholds.`;
    proseParagraphs.push(p1);
  }

  // Middle analysis & Simulation advice
  if (simulation.available && simulation.tiers.length > 0) {
    const heavyTier = simulation.tiers.find(t => t.id === 'heavy-alien-capital') || simulation.tiers[simulation.tiers.length - 1];
    const typicalTier = simulation.tiers.find(t => t.id === 'typical-alien-combatant') || simulation.tiers[0];

    let simText = '';
    if (heavyTier && heavyTier.winnable) {
      simText = `Monte Carlo engagement simulations against realistic alien strike forces indicate our ${targetDesign} `
        + `achieves an 80% victory probability against a heavy capital tier at approximately ${heavyTier.bandLabel}. `
        + `Against a typical single alien combatant, ${typicalTier.bandLabel} is sufficient.`;
    } else if (typicalTier && typicalTier.winnable) {
      simText = `Simulations indicate parity against a typical alien combatant requires ${typicalTier.bandLabel}, `
        + `while heavier capital concentrations remain unwinnable at current tech parameters.`;
    } else {
      simText = `Simulations indicate current combat designs cannot reliably achieve an 80% win probability `
        + `against concentrated alien elements without further research advances in drives and weaponry.`;
    }
    proseParagraphs.push(simText);
  }

  // Actionable strategic conclusion
  let advice = '';
  if (isHoldGround || hasDecisiveDeficit) {
    advice = `Do not voluntarily initiate engagements against alien combat fleets until you have on the order of ${simThresholdText}. `
      + `Maintain councilors on zero-hate Advise and Defend Interests to maximize research and GDP throughput.`;
  } else if (hasBankedBudget) {
    advice = `Leverage banked threat headroom for essential orbital expansion, while keeping shipyard throughput aligned with fleet replacement needs.`;
  } else {
    advice = `Continue building out orbital infrastructure and monitoring alien movement vectors across outer theaters.`;
  }
  proseParagraphs.push(advice);

  const fullProse = proseParagraphs.join(' ');

  return {
    headline,
    prose: fullProse,
    advice,
    simulatedThresholdText: simThresholdText
  };
}

module.exports = {
  generateGrammar,
  formatSimulatedThreshold
};
