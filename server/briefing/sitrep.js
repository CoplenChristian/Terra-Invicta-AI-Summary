// server/briefing/sitrep.js
//
// Purpose: the Executive SITREP — four prose paragraphs, a DEFCON tone, three
//   threat cards and the key-metric block.
//
// The Executive SITREP: four prose paragraphs, a DEFCON tone, three threat
// cards and the key-metric block.
//
// The tone is derived only from alien indicators VISIBLE in this filtered
// snapshot. An unavailable telemetry stream produces
// "DEFCON 3 — LIMITED ALIEN THREAT PICTURE", never the quiet-world reading:
// the difference between "nothing out there" and "we cannot see" is the whole
// point of the three-way availability flags threaded through this function.

const directiveAdvisor = require('../directiveAdvisor');
const {
  asArray,
  sameId,
  toFiniteNumber,
  firstAvailableNumber,
  formatNumber,
  formatCount,
  formatPower,
  formatFactionGdp,
  formatTargetGdp,
  getResourceSnapshot,
  formatResourceSummary
} = require('./format');
const { isOwnCouncilor, isIdleCouncilor } = require('./roster');
const {
  getControlledNationData,
  getFleetCombatPower,
  getMiningRateSummary
} = require('./readers');

function buildExecutiveSitrep(ctx = {}) {
  const {
    metadata = {},
    observer = {},
    observerId = observer.ID,
    observerName,
    observerRank,
    observerPower,
    totalFactions,
    topFaction = {},
    topFactionPower,
    nations = [],
    targetFactionName,
    servantTargets = [],
    activeAlienStages = {},
    capabilities = {},
    mode = 'player',
    visibility = 'filtered intelligence',
    xenoforming = [],
    xenoformingAvailable = true,
    builtAlienFacilities = [],
    alienFacilitiesAvailable = true,
    councilors = [],
    habs = [],
    fleets = [],
    habSites = [],
    campaignPosture = null,
    targetFaction = null
  } = ctx;

  const visibleCouncilors = asArray(councilors);
  const ownCouncilors = visibleCouncilors.filter(c => isOwnCouncilor(c, observerId));
  const moles = visibleCouncilors.filter(c => c.isTurnedMole === true || sameId(c.agentForFactionId, observerId));
  const hydras = visibleCouncilors.filter(c => c.isAlien === true || /alien/i.test(c.typeTemplateName || ''));
  const visibleXenoforming = asArray(xenoforming);
  const visibleAlienFacilities = asArray(builtAlienFacilities);
  const ownHabs = asArray(habs).filter(h => sameId(h.factionId, observerId));
  const ownFleets = asArray(fleets).filter(f => sameId(f.factionId, observerId));
  const observerLabel = observerName || observer.displayName || 'the selected faction';
  const leadingFactionName = topFaction.displayName || 'a rival faction';
  const factionCountText = formatCount(totalFactions);
  const rankText = observerRank === null || observerRank === undefined
    ? 'has no confirmed strategic rank in the filtered intelligence picture'
    : `maintains rank #${observerRank} among ${factionCountText} visible factions`;
  const powerText = formatPower(observerPower);
  const targetEntries = asArray(servantTargets);
  const xenoformingKnown = xenoformingAvailable !== false;
  const alienFacilitiesKnown = alienFacilitiesAvailable !== false;
  const alienCouncilorKnown = mode === 'omniscient' || mode === 'enhanced' ||
    activeAlienStages.operatives !== undefined ||
    capabilities.canDirectlyDetectAlienCouncilors === true ||
    hydras.length > 0;
  const xenoCount = xenoformingKnown ? visibleXenoforming.length : null;
  const facilityCount = alienFacilitiesKnown ? visibleAlienFacilities.length : null;
  const controlledNationData = getControlledNationData(nations, observerId);
  const controlPoints = firstAvailableNumber(
    observer.controlPointsCount,
    controlledNationData.controlPoints
  );
  const controlledNationCount = firstAvailableNumber(
    observer.nationsCount,
    controlledNationData.nations
  );
  const gdpTrillion = formatFactionGdp(observer, controlledNationData.gdp);
  const researchPts = firstAvailableNumber(
    observer.totalResearch,
    observer.monthlyResearch,
    controlledNationData.research
  );
  const fleetCombatPower = getFleetCombatPower(observer, ownFleets);
  const ownHabCount = ownHabs.length || (!habs.length ? toFiniteNumber(observer.habsCount) || 0 : 0);
  const ownFleetCount = ownFleets.length || (!fleets.length ? toFiniteNumber(observer.fleetsCount) || 0 : 0);
  const resources = getResourceSnapshot(observer.resources);
  const resourceText = formatResourceSummary(resources);
  const totalFactionText = formatCount(totalFactions);

  // Overall Status Tone is based only on alien indicators visible in this
  // filtered snapshot. An unavailable telemetry stream is not reported as
  // proof that the world is quiet.
  const visibleAlienThreat = (xenoCount !== null && xenoCount > 0) ||
    (facilityCount !== null && facilityCount > 0) || hydras.length > 0;
  const threatPictureUnavailable = !xenoformingKnown && !alienFacilitiesKnown && !alienCouncilorKnown;
  let defconLevel = 'DEFCON 3 — ELEVATED TACTICAL SURVEILLANCE';
  if (visibleAlienThreat) {
    defconLevel = 'DEFCON 2 — ACTIVE ALIEN INCURSION IN PROGRESS';
  } else if (threatPictureUnavailable) {
    defconLevel = 'DEFCON 3 — LIMITED ALIEN THREAT PICTURE';
  }

  // Paragraph 1: Dynamic Geopolitical Stance
  const rivalText = topFaction.displayName && !sameId(topFaction.ID, observerId)
    ? ` The strongest visible rival is ${leadingFactionName} (composite score estimate: ${formatPower(topFactionPower)}/100).`
    : ' No opposing faction has a confirmed higher visible power score.';
  const p1 = `As of ${metadata.gameTimeString || 'the current operational cycle'}, ${observerLabel} ${rankText} with a composite strategic score estimate of ${powerText}/100. Its network commands ${formatCount(controlPoints)} control points across ${formatCount(controlledNationCount)} nations, representing $${gdpTrillion}T in terrestrial GDP and ${formatCount(researchPts)} monthly scientific output.${rivalText} Current reserves: ${resourceText}.`;

  // Paragraph 2: Priority Target / Geopolitical Visibility
  let p2;
  if (targetEntries.length > 0 && targetFactionName) {
    const topTarget = targetEntries[0];
    const targetCpCount = firstAvailableNumber(topTarget.targetCPCount, topTarget.servantCPCount);
    const targetCpText = targetCpCount === null
      ? 'control-point count unavailable'
      : `${targetCpCount}/${formatCount(topTarget.totalCPCount)} CPs`;
    const targetGdp = formatTargetGdp(topTarget);
    const targetReasons = asArray(topTarget.vulnerabilities).length > 0
      ? `Visible vulnerabilities: ${topTarget.vulnerabilities.join(', ')}.`
      : asArray(topTarget.reasons).length > 0
        ? `Visible indicators: ${topTarget.reasons.slice(0, 3).join('; ')}.`
        : topTarget.isExecutiveTarget
          ? 'Executive authority is included in the visible holding.'
          : 'No additional vulnerability data is available.';
    p2 = `PRIORITY THEATER ALERT: ${targetFactionName} control is visible in ${topTarget.nationName || 'an unidentified nation'} ($${targetGdp}T GDP, ${targetCpText}). ${targetReasons}`;
  } else if (targetFactionName) {
    p2 = `PRIORITY THEATER STATUS: No scored holdings for ${targetFactionName} are visible in this filtered snapshot. This does not establish that the faction has no holdings outside the current intelligence picture.`;
  } else {
    p2 = 'PRIORITY THEATER STATUS: No priority opposing faction or target holdings are identified in this filtered snapshot; geopolitical targeting data is unavailable.';
  }

  // Paragraph 3: Visible Alien Threat & Xenoforming Activity
  const directDetectionText = mode === 'omniscient'
    ? 'ONLINE (omniscient view)'
    : activeAlienStages.operatives?.active === true || capabilities.canDirectlyDetectAlienCouncilors === true
      ? 'ONLINE'
      : activeAlienStages.operatives !== undefined
        ? 'RESTRICTED by current intelligence capabilities'
        : 'UNAVAILABLE in the current intelligence view';
  const alienCouncilorText = alienCouncilorKnown
    ? `${hydras.length} visible alien councilor${hydras.length === 1 ? '' : 's'}`
    : 'alien councilor detections are unavailable';
  const xenoformingText = !xenoformingKnown
    ? 'xenoforming telemetry is unavailable'
    : xenoCount === 0
      ? 'no active xenoforming sites are visible'
      : (() => {
        const topXeno = visibleXenoforming[0];
        const level = formatNumber(topXeno.level, 1);
        return `active xenoforming is visible in ${xenoCount} region${xenoCount === 1 ? '' : 's'} (highest activity: ${topXeno.regionName || 'unknown region'} at level ${level})`;
      })();
  const facilityText = !alienFacilitiesKnown
    ? 'alien facility telemetry is unavailable'
    : `${facilityCount} visible alien facilit${facilityCount === 1 ? 'y' : 'ies'}`;
  const p3Prefix = visibleAlienThreat ? 'ALIEN INCURSION ADVISORY' : 'ALIEN/XENOFORMING STATUS';
  const p3 = `${p3Prefix}: ${alienCouncilorText}; ${xenoformingText}; ${facilityText}. Direct alien-councilor detection: ${directDetectionText}.`;

  // Paragraph 4: Space Logistics & Asset Posture
  const miningRates = getMiningRateSummary(habSites, ownHabs, observerId);
  const spaceResources = miningRates || 'visible mining-rate data is unavailable';
  const p4 = `SPACE POSTURE: ${observerLabel} has ${formatCount(ownHabCount)} visible orbital installation${ownHabCount === 1 ? '' : 's'} and ${formatCount(ownFleetCount)} visible fleet group${ownFleetCount === 1 ? '' : 's'}. Fleet combat power is ${formatPower(fleetCombatPower)}; ${spaceResources}.`;

  const counts = {
    controlPoints,
    nations: controlledNationCount,
    visibleCouncilors: visibleCouncilors.length,
    ownCouncilors: ownCouncilors.length,
    turnedMoles: moles.length,
    visibleAlienCouncilors: alienCouncilorKnown ? hydras.length : null,
    orbitalInstallations: ownHabCount,
    fleets: ownFleetCount,
    visibleXenoformingSites: xenoCount,
    visibleAlienFacilities: facilityCount
  };

  const idleOwn = ownCouncilors.filter(c => isIdleCouncilor(c)).length;
  const observerShort = String(observerLabel || '').replace(/^the\s+/i, '');
  const holdProxy = campaignPosture?.escalateLate === true && targetEntries.length > 0 && targetFactionName;
  const threatCards = [
    {
      id: 'geo',
      severity: holdProxy ? 'HOLD' : (targetEntries.length && targetFactionName ? 'CRITICAL' : 'WATCH'),
      title: holdProxy
        ? `Protect core holdings and stage the ${targetFactionName} operation`
        : (targetEntries.length && targetFactionName
          ? `${targetFactionName} in ${targetEntries[0].nationName || 'an unidentified nation'}`
          : 'Priority theater'),
      statement: holdProxy
        ? `Crackdown/Purge vs ${targetFactionName} would feed alien hate (${directiveAdvisor.classifyProxy(targetFaction || { displayName: targetFactionName }).shareLabel}) while ${directiveAdvisor.formatShipPosture(campaignPosture)}. ${campaignPosture.reasons[0]}.`
        : p2.replace(/^PRIORITY THEATER (ALERT|STATUS):\s*/i, '')
    },
    {
      id: 'alien',
      severity: visibleAlienThreat ? 'CRITICAL' : threatPictureUnavailable ? 'UNKNOWN' : 'WATCH',
      title: visibleAlienThreat ? 'Alien incursion' : 'Alien / xenoforming picture',
      statement: p3.replace(/^(ALIEN INCURSION ADVISORY|ALIEN\/XENOFORMING STATUS):\s*/i, '')
    },
    {
      id: 'ops',
      severity: idleOwn > 0 ? 'READY' : 'WATCH',
      title: idleOwn > 0
        ? `${idleOwn} idle operative${idleOwn === 1 ? '' : 's'}`
        : 'Council roster committed',
      statement: idleOwn > 0
        ? `${idleOwn} of ${ownCouncilors.length} visible ${observerShort} councilors are standing by and can take a mission this cycle.`
        : ownCouncilors.length
          ? `All ${ownCouncilors.length} visible ${observerShort} councilors currently have an assigned mission.`
          : 'No observer councilors are visible in this intelligence picture.'
    }
  ];

  return {
    defcon: defconLevel,
    summaryParagraphs: [p1, p2, p3, p4],
    threatCards,
    keyMetrics: {
      strategicRank: observerRank === null || observerRank === undefined
        ? 'UNAVAILABLE'
        : `#${observerRank} of ${totalFactionText}`,
      powerScore: `${powerText}/100`,
      activeOperatives: `${ownCouncilors.length} Visible Field Agents`,
      turnedMoles: `${moles.length} Assets Embedded`,
      alienHateAssessment: observer.alienHate?.visibleEstimate || 'UNAVAILABLE',
      orbitalInstallations: `${ownHabCount} Visible Habs Active`,
      resources,
      resourceSummary: resourceText,
      counts,
      visibility
    }
  };
}

module.exports = { buildExecutiveSitrep };
