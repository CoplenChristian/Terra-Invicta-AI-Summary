// server/directives/geopolitical.js
//
// Purpose: the Earth-facing policyRank ladder — hold ground, the escalate-late
//   deferral, the non-proxy alternative, the containment sweep.
//
// The Earth-facing policyRank ladder: hold ground, the escalate-late deferral,
// the non-proxy alternative, the containment sweep, and the standing
// Defend Interests order.
//
// This is the v1 hand-tuned ladder the rule engine is gradually replacing. It
// still runs because the engine does not yet cover space, research or mining,
// and deleting the ranks now would drop those directives with no successor
// (docs/archive/directive-rule-engine-plan.md §7, P5 note).
//
// `attachHateEstimate` is the discipline that keeps this ladder honest: every
// offensive directive carries the expected alien hate of the mission it names,
// sourced from directiveAdvisor rather than restated here.

const directiveAdvisor = require('../directiveAdvisor');
const { asArray, toFiniteNumber, firstAvailableNumber, formatTargetGdp } = require('../briefing/format');
const { eligibleOperatives } = require('../briefing/roster');
const { buildHoldGroundDirective } = require('./holdGround');

function attachHateEstimate(directive, missionType, proxy) {
  const estimate = directiveAdvisor.expectedAlienHate(missionType, proxy);
  return {
    ...directive,
    expectedAlienHate: estimate.label,
    expectedAlienHateNote: estimate.note,
    policyNote: estimate.feedsProxyHate ? estimate.note : (directive.policyNote || null)
  };
}

function buildGeopoliticalDirectives(servantTargets, nations, targetFactionName, observer, observerName = null, councilors = [], observerId = null, context = {}) {
  const directives = [];
  const targets = asArray(servantTargets);
  const factionLabel = targetFactionName || 'the selected opposing faction';
  const observerLabel = observerName || observer?.displayName || 'the selected faction';
  const resolvedObserverId = observerId ?? observer?.ID;
  const campaignPosture = context.campaignPosture || {};
  const targetFaction = context.targetFaction || { displayName: targetFactionName };
  const proxy = directiveAdvisor.classifyProxy(targetFaction);
  const escalateLate = campaignPosture.escalateLate === true && proxy.share > 0 && proxy.share < 1;
  const purgeHate = directiveAdvisor.expectedAlienHate('Purge', proxy);
  const crackdownHate = directiveAdvisor.expectedAlienHate('Crackdown', proxy);

  // Leads the board when it fires. Holding is the cycle's action, so it goes
  // first -- and it is the only directive here that does not need a proxy
  // target to exist, which is exactly the case the old holds could not cover.
  const holdGroundDirective = buildHoldGroundDirective(
    context.holdGround,
    councilors,
    resolvedObserverId,
    observerLabel
  );
  if (holdGroundDirective) directives.push(holdGroundDirective);

  if (escalateLate && targets.length > 0 && targetFactionName) {
    const t = targets[0];
    directives.push({
      id: 'geo-hold',
      policyRank: 100,
      title: `Protect core holdings while preparing the ${targetFactionName} operation in ${t.nationName}`,
      category: 'ESCALATE LATE',
      severity: 'CRITICAL',
      target: t.nationName,
      statement: `${targetFactionName} still hold ${t.nationName || 'the identified nation'} ($${formatTargetGdp(t)}T GDP), but Crackdown/Purge against them feeds alien hate (${proxy.shareLabel}). Current posture: ${campaignPosture.reasons.join('; ')}. A Purge success would add ${purgeHate.label}; Crackdown ${crackdownHate.label}.`,
      action: `Assign Defend Interests to own majors, keep ${t.nationName} on the watch list, and prepare the proxy operation for the next survivable window.`,
      successFactor: 'SURVIVAL FIRST',
      missionType: 'Defend Interests',
      preparation: 'Assign Administration or Persuasion to executive nations. Leave the proxy holding on watch.',
      window: 'Until fleet posture can survive open war',
      missionCost: '20 Influence',
      expectedAlienHate: 'none (Defend Interests)',
      expectedAlienHateNote: 'Defend Interests success-slot hate is 0. Crackdown/Purge vs this proxy is deferred because it feeds alien hate.',
      policyNote: campaignPosture.reasons.join(' · '),
      eligibleOperatives: eligibleOperatives(councilors, resolvedObserverId, ['Administration', 'Persuasion', 'Security'])
    });

    directives.push(attachHateEstimate({
      id: 'geo-1',
      policyRank: 25,
      title: `Monitor ${targetFactionName} holding in ${t.nationName} and prepare a later operation`,
      category: 'DEFERRED — PROXY HATE',
      severity: 'WATCH',
      target: t.nationName,
      statement: `${t.nationName} remains a scored ${targetFactionName} holding, including ${t.isExecutiveTarget ? 'executive authority' : 'non-executive CPs'}. Offensive action is deferred while alien hate is elevated and the fleet is fragile.`,
      action: 'Prepare the target dossier and stage Crackdown or Purge for a window when hate is ventable and the fleet can absorb retaliation.',
      successFactor: 'DEFERRED',
      missionType: 'Crackdown / Purge',
      preparation: 'Maintain the target watch list and build the dossier for the next survivable operation window.',
      window: 'Deferred',
      missionCost: 'UNAVAILABLE',
      policyNote: `${proxy.shareLabel}. ${purgeHate.note}`,
      eligibleOperatives: eligibleOperatives(councilors, resolvedObserverId, ['Espionage', 'Investigation'])
    }, 'Crackdown / Purge', proxy));

    const alt = directiveAdvisor.findHumanNonProxyTarget(nations, context.factions, resolvedObserverId);
    if (alt) {
      directives.push(attachHateEstimate({
        id: 'geo-human',
        policyRank: 70,
        title: `Optional human target: ${alt.nationName} (${alt.executiveFactionName})`,
        category: 'NON-PROXY PURGE',
        severity: 'HIGH',
        target: alt.nationName,
        statement: `${alt.nationName} ($${(alt.gdpTrillion).toFixed(1)}T GDP) is held by ${alt.executiveFactionName}, which does not share hate with the aliens the way ${proxy.label} do.`,
        action: `If an Earth offensive is still required this cycle, Purge ${alt.executiveFactionName} in ${alt.nationName} rather than ${proxy.label}.`,
        successFactor: 'NO PROXY HATE SHARE',
        missionType: 'Purge',
        preparation: 'Confirm the executive CP and assign Espionage. Influence cost remains UNAVAILABLE.',
        window: 'This cycle, only if a councilor is free after warding own majors',
        missionCost: 'UNAVAILABLE',
        eligibleOperatives: eligibleOperatives(councilors, resolvedObserverId, ['Espionage'])
      }, 'Purge', alt.proxy));
    }
  } else if (targets.length > 0 && targetFactionName) {
    const t = targets[0];
    const targetCpCount = firstAvailableNumber(t.targetCPCount, t.servantCPCount);
    const unrest = toFiniteNumber(t.unrest);
    directives.push(attachHateEstimate({
      id: 'geo-1',
      policyRank: 90,
      title: `Authorize Operation 'Severance' in ${t.nationName}`,
      category: 'CRACKDOWN & PURGE',
      severity: 'CRITICAL',
      target: t.nationName,
      statement: `${t.nationName || 'The identified nation'} ($${formatTargetGdp(t)}T GDP) holds ${targetCpCount === null ? 'an unknown number of' : targetCpCount} ${targetFactionName} control point${targetCpCount === 1 ? '' : 's'}${t.isExecutiveTarget ? ', including Executive authority' : ''}. Stability data is ${unrest === null ? 'unavailable' : unrest > 4 ? 'degraded (Unrest: ' + unrest + ')' : 'not critically degraded'}. ${proxy.share > 0 ? `Expected alien hate from a Purge success: ${purgeHate.label}.` : ''}`,
      action: `Deploy a suitable ${observerLabel} operative to investigate the holding and execute a visible crackdown or purge only when the current target data supports it.`,
      successFactor: unrest !== null && unrest > 4 ? 'HIGH (Vulnerable to subversion)' : 'MODERATE',
      missionType: 'Crackdown / Purge',
      preparation: 'Confirm executive control, then assign an idle Espionage or Investigation operative in-theater.',
      window: unrest !== null && unrest > 4 ? 'This cycle — unrest is already degraded' : 'This cycle',
      missionCost: 'UNAVAILABLE',
      policyNote: proxy.share > 0 ? purgeHate.note : null,
      eligibleOperatives: eligibleOperatives(councilors, resolvedObserverId, ['Espionage', 'Investigation', 'Command'])
    }, 'Crackdown / Purge', proxy));
  }

  if (targets.length > 1 && targetFactionName) {
    const t2 = targets[1];
    const targetCpCount = firstAvailableNumber(t2.targetCPCount, t2.servantCPCount);
    directives.push(attachHateEstimate({
      id: 'geo-2',
      policyRank: escalateLate ? 45 : 60,
      title: `Containment Sweep in ${t2.nationName}`,
      category: 'PUBLIC CAMPAIGN',
      severity: escalateLate ? 'WATCH' : 'HIGH',
      target: t2.nationName,
      statement: `${targetFactionName} maintain${targetCpCount === 1 ? 's' : ''} ${targetCpCount === null ? 'an unknown number of' : targetCpCount} control point${targetCpCount === 1 ? '' : 's'} in ${t2.nationName || 'the identified nation'} ($${formatTargetGdp(t2)}T GDP).`,
      action: `Deploy a high-Persuasion ${observerLabel} councilor on a visible Public Campaign mission if the current intelligence picture confirms the opportunity.`,
      successFactor: 'VERY HIGH',
      missionType: 'Public Campaign',
      preparation: 'Stage a Persuasion-led councilor in-country before the campaign order.',
      window: 'This cycle',
      missionCost: 'UNAVAILABLE',
      eligibleOperatives: eligibleOperatives(councilors, resolvedObserverId, ['Persuasion', 'Administration'])
    }, 'Public Campaign', proxy));
  }

  directives.push(attachHateEstimate({
    id: 'geo-3',
    policyRank: escalateLate ? 75 : 40,
    title: `Protect ${observerLabel} Core Holdings`,
    category: 'DEFEND INTERESTS',
    severity: escalateLate ? 'HIGH' : 'STANDARD',
    target: 'Core National Holdings',
    statement: targetFactionName
      ? `Unprotected control points in high-GDP nations remain susceptible to rival operations, including ${factionLabel} activity where visible.`
      : 'No priority opposing faction is identified in this filtered snapshot; protect confirmed executive and high-value control points while intelligence is incomplete.',
    action: 'Verify all confirmed executive and major-economy control points have active "Defend Interests" wards in place.',
    successFactor: 'GUARANTEED PROTECTION',
    missionType: 'Defend Interests',
    preparation: 'Confirm executive nations, then assign an Administration or Persuasion operative to ward them.',
    window: escalateLate ? 'This cycle — first Earth action' : 'Standing order',
    missionCost: '20 Influence',
    eligibleOperatives: eligibleOperatives(councilors, resolvedObserverId, ['Administration', 'Persuasion', 'Security'])
  }, 'Defend Interests', { share: 0, label: observerLabel }));

  return directives;
}

module.exports = { attachHateEstimate, buildGeopoliticalDirectives };
