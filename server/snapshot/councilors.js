// server/snapshot/councilors.js
//
// Purpose: the councilor roster reducer, including the org join and the
//   base-versus-resolved attribute split.
//
// The councilor roster reducer, including the org join and the base-versus-
// resolved attribute split.
//
// `attributes` is the BASE block from the save; org bonuses and trait stat
// mods are applied at resolution time by the game, so anything reasoning about
// mission odds must read `resolvedAttributes.effective` instead.

const { buildCouncilorAttributes } = require('../../shared/councilorAttributes.mjs');
const { ALIEN_FACTION_DISPLAY_NAME } = require('../../shared/constants.mjs');
const { strictFiniteNumber } = require('../../shared/util.mjs');
const { resolveFactionName } = require('./lookups');

function buildCouncilors(rawCouncilors, {
  factionsById,
  regionsById,
  habsById,
  orgsById,
  missionsById,
  traitStatMods
}) {
  const councilors = [];
  for (const c of rawCouncilors) {
    const councilorId = c.ID?.value;
    if (!councilorId) continue;

    const factionId = c.faction?.value || null;
    const factionRecord = factionId ? factionsById.get(factionId) : null;
    const factionName = factionRecord?.displayName || 'Independent';
    const lifecycleStatus = String(c.status || 'Active').trim();
    const isActiveCouncilor = Boolean(factionId && factionRecord && lifecycleStatus.toLowerCase() === 'active');
    const isIndependent = String(factionName).trim().toLowerCase() === 'independent';

    // TICouncilorState also stores the independent pool and other save-level
    // people who are not active faction councilors. They are useful to the
    // game, but are not part of an intelligence roster and should never be
    // presented as an active faction operative.
    if (!isActiveCouncilor || isIndependent) continue;

    const isAlien = !!(c.typeTemplateName && c.typeTemplateName.toLowerCase().includes('alien')) || factionName === ALIEN_FACTION_DISPLAY_NAME;

    const locationId = c.location?.value || c.location || null;
    const locationRegion = locationId ? regionsById.get(locationId) : null;
    const locationHab = locationId ? habsById.get(locationId) : null;
    const locationName = locationRegion ? locationRegion.displayName : (locationHab ? locationHab.displayName : 'In Transit / Orbit');
    const locationType = locationRegion ? 'Earth Region' : (locationHab ? (locationHab.habType || 'Station / Base') : 'In Transit');

    const homeRegionId = c.homeRegion?.value || null;
    const homeRegionName = homeRegionId ? (regionsById.get(homeRegionId)?.displayName || 'Unknown') : 'Unknown';

    const agentForFactionId = c.agentForFaction?.value || null;
    const agentForFactionName = resolveFactionName(factionsById, agentForFactionId, null);

    const seenByFactionIds = Array.isArray(c.knowsIveBeenSeenBy) ? c.knowsIveBeenSeenBy.map(x => x.value || x) : [];

    const activeMissionObj = c.activeMission?.value ? missionsById.get(c.activeMission.value) : null;
    const activeMissionName = activeMissionObj ? activeMissionObj.displayName : (c.priorMissionTemplateName ? `Prior: ${c.priorMissionTemplateName}` : 'Idle / Standby');
    const activeMissionTarget = activeMissionObj ? activeMissionObj.targetName : null;

    const assignedOrgs = [];
    if (Array.isArray(c.orgs)) {
      for (const orgRef of c.orgs) {
        const orgId = orgRef.value || orgRef;
        const orgObj = orgsById.get(orgId);
        if (orgObj) {
          const bonuses = [];
          if (orgObj.administration) bonuses.push(`+${orgObj.administration} ADM`);
          if (orgObj.persuasion) bonuses.push(`+${orgObj.persuasion} PER`);
          if (orgObj.investigation) bonuses.push(`+${orgObj.investigation} INV`);
          if (orgObj.espionage) bonuses.push(`+${orgObj.espionage} ESP`);
          if (orgObj.command) bonuses.push(`+${orgObj.command} CMD`);
          if (orgObj.science) bonuses.push(`+${orgObj.science} SCI`);
          if (orgObj.security) bonuses.push(`+${orgObj.security} SEC`);
          if (orgObj.incomeMoney_month) bonuses.push(`$${orgObj.incomeMoney_month > 0 ? '+' : ''}${orgObj.incomeMoney_month}/mo`);
          if (orgObj.incomeInfluence_month) bonuses.push(`+${orgObj.incomeInfluence_month} Inf/mo`);
          if (orgObj.incomeOps_month) bonuses.push(`+${orgObj.incomeOps_month} Ops/mo`);
          if (orgObj.incomeBoost_month) bonuses.push(`+${orgObj.incomeBoost_month} Boost/mo`);

          assignedOrgs.push({
            id: orgId,
            displayName: orgObj.displayName,
            templateName: orgObj.templateName,
            stars: orgObj.tier || 1,
            tier: orgObj.tier || 1,
            bonusesText: bonuses.join(', '),
            // The org's ROLLED space-mining output bonus, and the game's own
            // flag for whether it is currently applying its bonuses at all.
            //
            // Read from `TIOrgState`, never from `TIOrgTemplate`: five of the
            // seven templates carrying `miningBonus` are `randomized: true`, so
            // the template value is a mean and the instance value is what the
            // game uses -- `RandomSpaceMining12` instances read 0.04, 0.05 and
            // 0.06 against a template 0.04 on `ExitSave.gz` (2026-08-22).
            //
            // `applyingBonuses` is false for a newly bought org before the next
            // mission phase and for every org on a Detained councilor (wiki
            // `Orgs`, raw wikitext, 2026-08-22). It is carried as a BOOLEAN so
            // `shared/spaceMiningBonus.mjs` can tell "suspended" from "flag not
            // present" -- absent makes the whole bonus unknown rather than
            // silently counting a suspended org.
            miningBonus: strictFiniteNumber(orgObj.miningBonus),
            applyingBonuses: typeof orgObj.applyingBonuses === 'boolean' ? orgObj.applyingBonuses : null,
            statBonuses: {
              adm: orgObj.administration || 0,
              per: orgObj.persuasion || 0,
              inv: orgObj.investigation || 0,
              esp: orgObj.espionage || 0,
              cmd: orgObj.command || 0,
              sci: orgObj.science || 0,
              sec: orgObj.security || 0
            },
            income: {
              money: orgObj.incomeMoney_month || 0,
              influence: orgObj.incomeInfluence_month || 0,
              ops: orgObj.incomeOps_month || 0,
              boost: orgObj.incomeBoost_month || 0
            }
          });
        }
      }
    }

    const attrs = {
      Persuasion: c.attributes?.Persuasion ?? 0,
      Investigation: c.attributes?.Investigation ?? 0,
      Espionage: c.attributes?.Espionage ?? 0,
      Command: c.attributes?.Command ?? 0,
      Administration: c.attributes?.Administration ?? 0,
      Science: c.attributes?.Science ?? 0,
      Security: c.attributes?.Security ?? 0,
      Loyalty: c.attributes?.Loyalty ?? 0,
      ApparentLoyalty: c.attributes?.ApparentLoyalty ?? 0
    };

    const totalSkills = attrs.Persuasion + attrs.Investigation + attrs.Espionage +
                        attrs.Command + attrs.Administration + attrs.Science +
                        attrs.Security;

    councilors.push({
      ID: councilorId,
      displayName: c.displayName,
      personalName: c.personalName || '',
      familyName: c.familyName || '',
      typeTemplateName: c.typeTemplateName || 'Unknown',
      factionId,
      factionName,
      isAlien,
      status: lifecycleStatus,
      isActiveCouncilor: true,
      isIndependent,
      locationRegionId: locationId,
      locationName,
      locationType,
      homeRegionName,
      attributes: attrs,
      // `attributes` is the BASE block from the save; the game applies org
      // bonuses at resolution time. Anything reasoning about mission odds
      // must use resolvedAttributes.effective, not these raw values.
      resolvedAttributes: buildCouncilorAttributes({
        attributes: attrs,
        orgs: assignedOrgs,
        traits: Array.isArray(c.traitTemplateNames) ? c.traitTemplateNames : [],
        status: lifecycleStatus
      }, { traitStatMods }),
      totalSkills,
      traits: Array.isArray(c.traitTemplateNames) ? c.traitTemplateNames : [],
      orgs: assignedOrgs,
      activeMissionName,
      activeMissionTarget,
      priorMissionTemplateName: c.priorMissionTemplateName || null,
      activeMission: c.activeMission?.value || null,
      agentForFactionId,
      agentForFactionName,
      seenByFactionIds,
      xp: c.XP || 0,
      gender: c.gender || '',
      dateBorn: c.dateBorn || null
    });
  }
  return councilors;
}

module.exports = { buildCouncilors };
