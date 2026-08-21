// server/briefing/roster.js
//
// Purpose: reading the councilor roster — who is ours, who is free, what a
//   masked stat says, and the per-councilor recommendation card.
//
// Reading the councilor roster: who is ours, who is free, what a masked stat
// actually says, and the per-councilor recommendation card.
//
// `visibleSkill` is the one that matters for player mode. Observed enemies
// carry `maskedAttributes` rather than `attributes`, where an unresolved stat
// is `{ visible: null, visibility: 'unknown' }`. Reading `attributes` alone
// dropped every enemy from the eligible list; reading `masked.visible`
// unguarded would report an unknown stat as absent-and-therefore-zero. Both
// are wrong in the same direction, so the visibility flag is checked first.

const { asArray, sameId, toFiniteNumber, getTopSkillString } = require('./format');

/**
 * The attribute score at which a councilor is called out by that skill in the
 * operative roster. Repeated five times as a bare `12` in one if/else ladder.
 * A judgement call in this repo's own presentation layer, not a game rule.
 */
const NOTABLE_SKILL_THRESHOLD = 12;

function isOwnCouncilor(councilor, observerId) {
  return councilor?.isOwnCouncilor === true || sameId(councilor?.factionId, observerId);
}

function visibleSkill(councilor, skill) {
  const masked = councilor?.maskedAttributes?.[skill];
  if (masked && typeof masked === 'object') {
    if (masked.visibility === 'unknown' || masked.visibility === 'unavailable') return null;
    return toFiniteNumber(masked.visible ?? masked.actual);
  }
  return toFiniteNumber(councilor?.attributes?.[skill]);
}

function isIdleCouncilor(councilor) {
  const mission = String(councilor?.activeMissionName || '');
  return !mission || /idle|standby/i.test(mission);
}

function eligibleOperatives(councilors, observerId, skills = [], limit = 3) {
  const wanted = Array.isArray(skills) && skills.length ? skills : ['Espionage', 'Persuasion'];
  return asArray(councilors)
    .filter(councilor => isOwnCouncilor(councilor, observerId))
    .map(councilor => {
      const scores = wanted.map(skill => ({ skill, value: visibleSkill(councilor, skill) }))
        .filter(entry => entry.value !== null)
        .sort((a, b) => b.value - a.value);
      const best = scores[0] || null;
      return {
        id: councilor.ID,
        name: councilor.displayName,
        profession: councilor.typeTemplateName || 'Councilor',
        location: councilor.locationName || 'Unknown location',
        mission: councilor.activeMissionName || 'Standby',
        available: isIdleCouncilor(councilor),
        matchSkill: best ? best.skill : null,
        matchValue: best ? best.value : null,
        orgsCount: Array.isArray(councilor.orgs) ? councilor.orgs.length : 0
      };
    })
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return (b.matchValue ?? -1) - (a.matchValue ?? -1);
    })
    .slice(0, limit);
}

function buildOperativeRoster(councilors, observerId, campaignPosture = {}) {
  const ownCouncilors = asArray(councilors).filter(c => isOwnCouncilor(c, observerId));

  // `escalateLate` is true when ANY hold fired, and the holds are no longer
  // interchangeable: Total War proximity holds on its own, with a strong
  // fleet and hate that is nowhere near the war threshold. Naming the
  // fragile-fleet case regardless produced advice that contradicted the
  // measured posture (spaceFragile false, hold text about Total War), so
  // quote the reason that actually fired instead of assuming one.
  const holdReasons = asArray(campaignPosture?.holds)
    .filter(hold => typeof hold === 'string' && hold.trim() !== '');
  const holdClause = holdReasons.length > 0
    ? holdReasons.join('; ')
    : 'the campaign posture is holding proxy offensives';

  return ownCouncilors.map(c => {
    let readiness = 'READY FOR DEPLOYMENT';
    let readinessColor = '#10b981';
    if (c.activeMissionName && !c.activeMissionName.includes('Idle') && !c.activeMissionName.includes('Standby')) {
      readiness = `EXECUTING: ${c.activeMissionName.toUpperCase()}`;
      readinessColor = '#00e5ff';
    }

    // Determine Tactical Recommendation
    let recOrder = 'Maintain current patrol and intelligence sweep.';
    const attrs = c.attributes || {};
    if (attrs.Persuasion >= NOTABLE_SKILL_THRESHOLD) {
      recOrder = 'Deploy to high-GDP nation to run Public Campaign or Defend Interests.';
    } else if (attrs.Espionage >= NOTABLE_SKILL_THRESHOLD) {
      recOrder = campaignPosture?.escalateLate
        ? `Ward own majors and prepare a non-proxy operation. Posture hold: ${holdClause}.`
        : 'Deploy to hostile territory to execute Crackdown or Sabotage Facilities.';
    } else if (attrs.Investigation >= NOTABLE_SKILL_THRESHOLD) {
      recOrder = 'Conduct Surveil Location or Investigate Councilor to unmask enemy moles.';
    } else if (attrs.Administration >= NOTABLE_SKILL_THRESHOLD) {
      recOrder = 'Manage assigned organizations, advise executive nations, or conduct Hostile Takeover.';
    } else if (attrs.Command >= NOTABLE_SKILL_THRESHOLD) {
      recOrder = 'Lead military assault, suppress unrest, or organize orbital defense.';
    }

    return {
      id: c.ID,
      name: c.displayName,
      profession: c.typeTemplateName,
      location: c.locationName,
      locationType: c.locationType || 'Earth Region',
      activeMission: c.activeMissionName || 'Standby',
      activeMissionTarget: c.activeMissionTarget || null,
      readiness,
      readinessColor,
      totalSkills: c.totalSkills || 0,
      topSkill: getTopSkillString(attrs),
      orgsCount: c.orgs?.length || 0,
      traitsCount: c.traits?.length || 0,
      recommendedOrder: recOrder
    };
  });
}

module.exports = {
  NOTABLE_SKILL_THRESHOLD,
  isOwnCouncilor,
  visibleSkill,
  isIdleCouncilor,
  eligibleOperatives,
  buildOperativeRoster
};
