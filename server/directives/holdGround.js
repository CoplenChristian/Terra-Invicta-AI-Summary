// server/directives/holdGround.js
//
// Hold Ground as a first-class directive (docs/directive-engine-v2-plan.md §4f).
//
// It is ranked above the deferred-crackdown hold because it is the same
// decision stated affirmatively AND it fires on posture alone -- including
// the case the old hold could not reach, where there is no proxy target at
// all and the board would otherwise degrade toward empty.
//
// The structured `holdGround` payload is carried through verbatim so the panel
// can show the measured fleet comparison, the ranked capability deficit, what
// was deferred and at what hate, and the exit condition -- rather than only
// the flat pill text.

const { eligibleOperatives } = require('../briefing/roster');

function buildHoldGroundDirective(holdGround, councilors, observerId, observerName) {
  if (!holdGround || holdGround.fires !== true) return null;
  const dominant = holdGround.comparison?.axes?.find(axis => axis.decisive) || null;
  const gapText = holdGround.canContest === 'unknown'
    ? 'the alien fleet comparison could not be made'
    : dominant
      ? `the widest measured gap is ${dominant.label} (${dominant.text})`
      : 'the capability gap is recorded in the comparison below';
  return {
    id: 'hold-ground',
    // Above the deferred-crackdown hold (100): when both fire they say the
    // same thing, and this one says it as an action.
    policyRank: 105,
    title: holdGround.headline,
    category: 'HOLD GROUND',
    severity: 'CRITICAL',
    target: 'Campaign posture',
    statement: holdGround.statement,
    action: holdGround.action,
    successFactor: 'ZERO HATE ADDED',
    // The concrete zero-hate mission this posture spends the cycle on.
    missionType: 'Defend Interests',
    preparation: `Keep councilors on Advise and Defend Interests, and push research at `
      + `${holdGround.recommendations?.[0]?.label || 'the measured capability gap'}.`,
    window: `Until alien hate vents below ${holdGround.exit?.threshold ?? 50} and the capability gap narrows`,
    // Never a bare number here: the point of the hold is that the cost is
    // zero hate, and the influence side depends on which order is issued.
    missionCost: '0 alien hate — influence cost depends on the order issued',
    expectedAlienHate: '0 (every recommended action has a template success-slot hate of 0)',
    expectedAlienHateNote: holdGround.deferredNote,
    policyNote: `${holdGround.warLine} ${holdGround.capabilityLine}`,
    eligibleOperatives: eligibleOperatives(
      councilors,
      observerId,
      ['Administration', 'Persuasion', 'Science', 'Security']
    ),
    // Structured payload for the board. The pill card renders flat text; the
    // sections below let the panel show the comparison, the ranked
    // recommendations, what was deferred and at what hate, and the exit.
    holdGround,
    summaryLine: `${observerName || 'This faction'}: hold — ${gapText}.`
  };
}

module.exports = { buildHoldGroundDirective };
