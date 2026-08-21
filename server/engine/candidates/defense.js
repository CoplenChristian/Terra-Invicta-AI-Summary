// server/engine/candidates/defense.js
//
// Purpose: the Defend Interests candidate generator — protecting holdings the
//   observer already owns.
//
// Defend Interests -- protecting holdings the observer already owns.
//
// A holding whose wards are ALL measurably active is skipped, because renewing
// a live ward is maintenance rather than a decision. A ward that cannot be
// evaluated does NOT suppress the candidate: it keeps the holding actionable
// and carries the uncertainty forward as an unmet precondition, so an
// unreadable campaign date can never make an unprotected holding read as safe.

const { toFiniteNumber, sameId } = require('../../../shared/util.mjs');
const { parseCampaignDate, defenseStatus } = require('../campaignDate');

function generateDefendInterestsCandidates(world) {
  const candidates = [];
  const observerId = world.observerId;
  if (observerId === null || observerId === undefined) return candidates;

  // A campaign date we cannot parse makes every ward expiry unevaluable. Say
  // so once, here, rather than letting each control point quietly resolve to
  // "protected".
  const campaignDateReadable = parseCampaignDate(world.campaignDate) !== null;

  const ownNations = [];
  for (const nation of world.nations) {
    const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
    const ownCps = cps.filter((cp) => sameId(cp.factionId, observerId));
    if (ownCps.length > 0) {
      const statuses = ownCps.map((cp) => defenseStatus(cp, world.campaignDate));
      const activeDefenseCount = statuses.filter((s) => s === 'active').length;
      const defenseUnknownCount = statuses.filter((s) => s === 'unknown').length;
      // A future-dated ward already protects every owned CP in this nation;
      // do not turn a maintenance state into a duplicate action. Only a
      // MEASURED full-coverage state suppresses the candidate -- an unknown
      // ward keeps the holding actionable and carries its uncertainty forward.
      if (activeDefenseCount === ownCps.length) continue;
      const gdpRaw = toFiniteNumber(nation.GDP);
      const gdpBn = gdpRaw === null ? null : gdpRaw / 1e9;
      ownNations.push({
        nation,
        ownCps,
        gdpBn: gdpBn ?? 0,
        activeDefenseCount,
        defenseUnknownCount
      });
    }
  }

  // Sort by highest GDP to defend major holdings first (Notion 09)
  const ranked = ownNations.sort((a, b) => b.gdpBn - a.gdpBn).slice(0, 3);
  for (const { nation, ownCps, gdpBn, activeDefenseCount, defenseUnknownCount } of ranked) {
    const execCp = ownCps.find((c) => c.isExecutive) || ownCps[0];
    const unprotectedCount = ownCps.length - activeDefenseCount;
    candidates.push({
      id: `defend-interests:${nation.displayName}`,
      // 'defense', not 'council': Defend Interests is a holding-protection
      // mission, not a councilor-targeted operation. It used to share the
      // 'council' family with Investigate/Turn, which forced
      // value/counter-councilor to carry a `missionType !== 'Defend Interests'`
      // exclusion to keep from scoring it as a councilor takedown.
      family: 'defense',
      missionType: 'Defend Interests',
      title: `Defend Interests in ${nation.displayName}`,
      recommendation: `Deploy an Administration or Persuasion operative on Defend Interests in ${nation.displayName} (protects core GDP against Crackdown/Purge at 0 alien hate).`,
      target: {
        kind: 'controlPoint',
        nation: nation.displayName,
        faction: world.observerName || 'Observer',
        controlPointType: execCp?.controlPointType || 'Executive',
        isExecutive: execCp?.isExecutive === true
      },
      hate: {
        toAliens: { low: 0, high: 0 },
        note: 'TIMissionTemplate Defend Interests hate row is [0,0,0,0,0,0] -- zero on every outcome.'
      },
      cost: { resource: 'Influence', amount: 20, kind: 'flat' },
      value: {
        gdpBn,
        nationName: nation.displayName,
        isDefendInterests: true,
        defendedControlPointCount: activeDefenseCount,
        unprotectedControlPointCount: unprotectedCount,
        defenseUnknownCount
      },
      score: null,
      provenance: {
        source: 'TIMissionTemplate Defend Interests (flat 20 Influence, 0 alien hate); Notion 09',
        estimateClass: 'exact'
      },
      unmetPreconditions: [
        ...(defenseUnknownCount > 0
          ? [`Existing Defend Interests coverage is not fully observable for this holding `
            + `(${defenseUnknownCount} of ${ownCps.length} control point wards could not be evaluated).`]
          : []),
        ...(campaignDateReadable
          ? []
          : ['The campaign date is not readable from this snapshot, so no ward expiry could be '
            + 'compared against it -- existing coverage is unknown, not absent.'])
      ]
    });
  }
  return candidates;
}

module.exports = { generateDefendInterestsCandidates };
