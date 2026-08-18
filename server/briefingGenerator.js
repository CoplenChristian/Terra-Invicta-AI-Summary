/**
 * Mission Control Briefing & SITREP Synthesis Engine
 *
 * Compiles raw game-state snapshot data into immersive, actionable,
 * natural-language intelligence statements and strategic directives
 * for the Executive Council in Mission Control v2.
 */

class BriefingGenerator {
  generateMissionControlBriefing(snapshot = {}, rawSnapshot = null) {
    const metadata = snapshot.metadata || {};
    const factions = this.asArray(snapshot.factions);
    const requestedObserverId = this.toFiniteNumber(snapshot.observerFactionId);
    const observer = (requestedObserverId !== null
      ? factions.find(f => this.sameId(f.ID, requestedObserverId))
      : null) || factions[0] || {};
    const observerId = observer.ID ?? snapshot.observerFactionId ?? null;
    const observerName = observer.displayName || snapshot.observerFactionName || 'the selected faction';
    const councilors = this.asArray(snapshot.councilors);
    const nations = this.asArray(snapshot.nations);
    const targetEntries = this.asArray(snapshot.servantTargets);
    const priorityTarget = snapshot.priorityTargetFaction || {};
    const priorityTargetId = priorityTarget.id ?? priorityTarget.ID ?? priorityTarget.factionId ?? targetEntries[0]?.targetFactionId ?? null;
    const targetFaction = factions.find(f => this.sameId(f.ID, priorityTargetId));
    const targetFactionName = targetFaction?.displayName || priorityTarget.name || targetEntries[0]?.targetFactionName || null;
    const activeAlienStages = snapshot.alienIntelligenceStage || {};
    const xenoforming = this.asArray(snapshot.activeXenoforming);
    const builtAlienFacilities = this.asArray(snapshot.builtAlienFacilities);
    const globalResearch = this.getResearchSlots(snapshot.globalResearch);
    const habs = this.asArray(snapshot.habs);
    const fleets = this.asArray(snapshot.fleets);
    const habSites = this.asArray(snapshot.habSites);
    const mode = snapshot.mode || (snapshot.isOmniscient ? 'omniscient' : 'player');
    const visibility = snapshot.visibility || `${mode} filtered intelligence`;
    const capabilities = snapshot.capabilities || {};

    const getPowerOverall = (f) => {
      if (!f) return null;
      const powerValue = typeof f.powerScore === 'number'
        ? f.powerScore
        : f.powerScore?.overall;
      return this.toFiniteNumber(powerValue);
    };

    // Calculate Strategic Rank from the filtered power values. Unknown enemy
    // power is kept unknown and sorted after factions with visible scores.
    const sortedFactions = [...factions].sort((a, b) => {
      const aPower = getPowerOverall(a);
      const bPower = getPowerOverall(b);
      if (aPower === null && bPower === null) return 0;
      if (aPower === null) return 1;
      if (bPower === null) return -1;
      return bPower - aPower;
    });
    const observerIndex = observer.ID === undefined || observer.ID === null
      ? -1
      : sortedFactions.findIndex(f => this.sameId(f.ID, observer.ID));
    const observerRank = observerIndex >= 0 ? observerIndex + 1 : null;
    const observerPower = getPowerOverall(observer);
    const visibleRivals = sortedFactions.filter(f => !this.sameId(f.ID, observerId));
    const topFaction = visibleRivals[0] || observer;
    const topFactionPower = getPowerOverall(topFaction);
    const xenoformingAvailable = this.isFilteredDataAvailable(
      snapshot,
      'activeXenoforming',
      'canDetectXenoforming',
      mode
    );
    const alienFacilitiesAvailable = this.isFilteredDataAvailable(
      snapshot,
      'builtAlienFacilities',
      'canDetectAlienFacilities',
      mode
    );

    // 1. Executive SITREP
    const sitrep = this.buildExecutiveSitrep({
      metadata,
      observer,
      observerId,
      observerName,
      observerRank,
      observerPower,
      totalFactions: factions.length,
      topFaction,
      topFactionPower,
      factions,
      nations,
      targetFactionName,
      targetFactionId: priorityTargetId,
      targetFaction,
      servantTargets: targetEntries,
      activeAlienStages,
      capabilities,
      mode,
      visibility,
      xenoforming,
      xenoformingAvailable,
      builtAlienFacilities,
      alienFacilitiesAvailable,
      councilors,
      habs,
      fleets,
      habSites
    });

    // 2. Department Directives (Actionable Statements)
    const geopoliticalDirectives = this.buildGeopoliticalDirectives(targetEntries, nations, targetFactionName, observer, observerName);
    const councilDirectives = this.buildCouncilDirectives(councilors, observerId);
    const spaceDirectives = this.buildSpaceDirectives(habs, fleets, habSites, observer, observerName);
    const researchDirectives = this.buildResearchDirectives(globalResearch, observer, activeAlienStages, {
      mode,
      capabilities
    });

    // 3. Theater Command Status
    const theaterStatus = this.buildTheaterStatus(
      nations,
      xenoforming,
      targetFactionName,
      observerId,
      observerName,
      xenoformingAvailable,
      priorityTargetId
    );

    // 4. Operative Roster with Tactical Recommendations
    const operativeRoster = this.buildOperativeRoster(councilors, observerId);

    return {
      generatedAt: new Date().toISOString(),
      campaignDate: metadata.gameTimeString || 'Unknown',
      mode,
      intelMode: mode,
      visibility,
      observerFactionId: observerId,
      observerName,
      priorityTargetFaction: targetFactionName
        ? { id: priorityTargetId, name: targetFactionName }
        : null,
      observerRank,
      powerScore: observerPower,
      alienHateStatus: observer.alienHate?.visibleEstimate || 'UNAVAILABLE',
      sitrep,
      directives: {
        geopolitical: geopoliticalDirectives,
        council: councilDirectives,
        space: spaceDirectives,
        research: researchDirectives
      },
      theaters: theaterStatus,
      operatives: operativeRoster
    };
  }

  buildExecutiveSitrep(ctx = {}) {
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
      habSites = []
    } = ctx;

    const visibleCouncilors = this.asArray(councilors);
    const ownCouncilors = visibleCouncilors.filter(c => this.isOwnCouncilor(c, observerId));
    const moles = visibleCouncilors.filter(c => c.isTurnedMole === true || this.sameId(c.agentForFactionId, observerId));
    const hydras = visibleCouncilors.filter(c => c.isAlien === true || /alien/i.test(c.typeTemplateName || ''));
    const visibleXenoforming = this.asArray(xenoforming);
    const visibleAlienFacilities = this.asArray(builtAlienFacilities);
    const ownHabs = this.asArray(habs).filter(h => this.sameId(h.factionId, observerId));
    const ownFleets = this.asArray(fleets).filter(f => this.sameId(f.factionId, observerId));
    const observerLabel = observerName || observer.displayName || 'the selected faction';
    const leadingFactionName = topFaction.displayName || 'a rival faction';
    const factionCountText = this.formatCount(totalFactions);
    const rankText = observerRank === null || observerRank === undefined
      ? 'has no confirmed strategic rank in the filtered intelligence picture'
      : `maintains rank #${observerRank} among ${factionCountText} visible factions`;
    const powerText = this.formatPower(observerPower);
    const targetEntries = this.asArray(servantTargets);
    const xenoformingKnown = xenoformingAvailable !== false;
    const alienFacilitiesKnown = alienFacilitiesAvailable !== false;
    const alienCouncilorKnown = mode === 'omniscient' || mode === 'enhanced' ||
      activeAlienStages.operatives !== undefined ||
      capabilities.canDirectlyDetectAlienCouncilors === true ||
      hydras.length > 0;
    const xenoCount = xenoformingKnown ? visibleXenoforming.length : null;
    const facilityCount = alienFacilitiesKnown ? visibleAlienFacilities.length : null;
    const controlledNationData = this.getControlledNationData(nations, observerId);
    const controlPoints = this.firstAvailableNumber(
      observer.controlPointsCount,
      controlledNationData.controlPoints
    );
    const controlledNationCount = this.firstAvailableNumber(
      observer.nationsCount,
      controlledNationData.nations
    );
    const gdpTrillion = this.formatFactionGdp(observer, controlledNationData.gdp);
    const researchPts = this.firstAvailableNumber(
      observer.totalResearch,
      observer.monthlyResearch,
      controlledNationData.research
    );
    const fleetCombatPower = this.getFleetCombatPower(observer, ownFleets);
    const ownHabCount = ownHabs.length || (!habs.length ? this.toFiniteNumber(observer.habsCount) || 0 : 0);
    const ownFleetCount = ownFleets.length || (!fleets.length ? this.toFiniteNumber(observer.fleetsCount) || 0 : 0);
    const resources = this.getResourceSnapshot(observer.resources);
    const resourceText = this.formatResourceSummary(resources);
    const totalFactionText = this.formatCount(totalFactions);

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
    const rivalText = topFaction.displayName && !this.sameId(topFaction.ID, observerId)
      ? ` The strongest visible rival is ${leadingFactionName} (Power Index: ${this.formatPower(topFactionPower)}/100).`
      : ' No opposing faction has a confirmed higher visible power score.';
    const p1 = `As of ${metadata.gameTimeString || 'the current operational cycle'}, ${observerLabel} ${rankText} with a Strategic Power Index of ${powerText}/100. Its network commands ${this.formatCount(controlPoints)} control points across ${this.formatCount(controlledNationCount)} nations, representing $${gdpTrillion}T in terrestrial GDP and ${this.formatCount(researchPts)} monthly scientific output.${rivalText} Current reserves: ${resourceText}.`;

    // Paragraph 2: Priority Target / Geopolitical Visibility
    let p2;
    if (targetEntries.length > 0 && targetFactionName) {
      const topTarget = targetEntries[0];
      const targetCpCount = this.firstAvailableNumber(topTarget.targetCPCount, topTarget.servantCPCount);
      const targetCpText = targetCpCount === null
        ? 'control-point count unavailable'
        : `${targetCpCount}/${this.formatCount(topTarget.totalCPCount)} CPs`;
      const targetGdp = this.formatTargetGdp(topTarget);
      const targetReasons = this.asArray(topTarget.vulnerabilities).length > 0
        ? `Visible vulnerabilities: ${topTarget.vulnerabilities.join(', ')}.`
        : this.asArray(topTarget.reasons).length > 0
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
          const level = this.formatNumber(topXeno.level, 1);
          return `active xenoforming is visible in ${xenoCount} region${xenoCount === 1 ? '' : 's'} (highest activity: ${topXeno.regionName || 'unknown region'} at level ${level})`;
        })();
    const facilityText = !alienFacilitiesKnown
      ? 'alien facility telemetry is unavailable'
      : `${facilityCount} visible alien facilit${facilityCount === 1 ? 'y' : 'ies'}`;
    const p3Prefix = visibleAlienThreat ? 'ALIEN INCURSION ADVISORY' : 'ALIEN/XENOFORMING STATUS';
    const p3 = `${p3Prefix}: ${alienCouncilorText}; ${xenoformingText}; ${facilityText}. Direct alien-councilor detection: ${directDetectionText}.`;

    // Paragraph 4: Space Logistics & Asset Posture
    const miningRates = this.getMiningRateSummary(habSites, ownHabs, observerId);
    const spaceResources = miningRates || 'visible mining-rate data is unavailable';
    const p4 = `SPACE POSTURE: ${observerLabel} has ${this.formatCount(ownHabCount)} visible orbital installation${ownHabCount === 1 ? '' : 's'} and ${this.formatCount(ownFleetCount)} visible fleet group${ownFleetCount === 1 ? '' : 's'}. Fleet combat power is ${this.formatPower(fleetCombatPower)}; ${spaceResources}.`;

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

    return {
      defcon: defconLevel,
      summaryParagraphs: [p1, p2, p3, p4],
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

  buildGeopoliticalDirectives(servantTargets, nations, targetFactionName, observer, observerName = null) {
    const directives = [];
    const targets = this.asArray(servantTargets);
    const factionLabel = targetFactionName || 'the selected opposing faction';
    const observerLabel = observerName || observer?.displayName || 'the selected faction';

    // Target 1: Top visible opposing holding
    if (targets.length > 0 && targetFactionName) {
      const t = targets[0];
      const targetCpCount = this.firstAvailableNumber(t.targetCPCount, t.servantCPCount);
      const unrest = this.toFiniteNumber(t.unrest);
      directives.push({
        id: 'geo-1',
        title: `Authorize Operation 'Severance' in ${t.nationName}`,
        category: 'CRACKDOWN & PURGE',
        severity: 'CRITICAL',
        target: t.nationName,
        statement: `${t.nationName || 'The identified nation'} ($${this.formatTargetGdp(t)}T GDP) holds ${targetCpCount === null ? 'an unknown number of' : targetCpCount} ${targetFactionName} control point${targetCpCount === 1 ? '' : 's'}${t.isExecutiveTarget ? ', including Executive authority' : ''}. Stability data is ${unrest === null ? 'unavailable' : unrest > 4 ? 'degraded (Unrest: ' + unrest + ')' : 'not critically degraded'}.`,
        action: `Deploy a suitable ${observerLabel} operative to investigate the holding and execute a visible crackdown or purge only when the current target data supports it.`,
        successFactor: unrest !== null && unrest > 4 ? 'HIGH (Vulnerable to subversion)' : 'MODERATE'
      });
    }

    // Target 2: Secondary visible holding
    if (targets.length > 1 && targetFactionName) {
      const t2 = targets[1];
      const targetCpCount = this.firstAvailableNumber(t2.targetCPCount, t2.servantCPCount);
      directives.push({
        id: 'geo-2',
        title: `Containment Sweep in ${t2.nationName}`,
        category: 'PUBLIC CAMPAIGN',
        severity: 'HIGH',
        target: t2.nationName,
        statement: `${targetFactionName} maintain${targetCpCount === 1 ? 's' : ''} ${targetCpCount === null ? 'an unknown number of' : targetCpCount} control point${targetCpCount === 1 ? '' : 's'} in ${t2.nationName || 'the identified nation'} ($${this.formatTargetGdp(t2)}T GDP).`,
        action: `Deploy a high-Persuasion ${observerLabel} councilor on a visible Public Campaign mission if the current intelligence picture confirms the opportunity.`,
        successFactor: 'VERY HIGH'
      });
    }

    // General defense / data-quality directive
    directives.push({
      id: 'geo-3',
      title: `Protect ${observerLabel} Core Holdings`,
      category: 'DEFEND INTERESTS',
      severity: 'STANDARD',
      target: 'Core National Holdings',
      statement: targetFactionName
        ? `Unprotected control points in high-GDP nations remain susceptible to rival operations, including ${factionLabel} activity where visible.`
        : 'No priority opposing faction is identified in this filtered snapshot; protect confirmed executive and high-value control points while intelligence is incomplete.',
      action: 'Verify all confirmed executive and major-economy control points have active "Defend Interests" wards in place.',
      successFactor: 'GUARANTEED PROTECTION'
    });

    return directives;
  }

  buildCouncilDirectives(councilors, observerId) {
    const directives = [];
    const visibleCouncilors = this.asArray(councilors);
    const ownCouncilors = visibleCouncilors.filter(c => this.isOwnCouncilor(c, observerId));
    const moles = visibleCouncilors.filter(c => c.isTurnedMole === true || this.sameId(c.agentForFactionId, observerId));

    // Mole Directive
    if (moles.length > 0) {
      const m = moles[0];
      directives.push({
        id: 'c-mole',
        title: `Exploit Embedded Asset '${m.displayName}' (${m.factionName})`,
        category: 'COUNTER-INTELLIGENCE',
        severity: 'CRITICAL',
        statement: `Turned operative ${m.displayName} remains embedded inside ${m.factionName} hierarchy at location ${m.locationName}. Current mission telemetry: ${m.activeMissionName || 'Standby'}.`,
        action: 'Maintain intelligence surveillance stream. Use known enemy movement schedules to preempt hostile council actions.',
        successFactor: 'CONFIRMED STREAM'
      });
    }

    // Operative Readiness Directives
    const idleAgents = ownCouncilors.filter(c => !c.activeMissionName || c.activeMissionName.includes('Idle') || c.activeMissionName.includes('Standby'));
    if (idleAgents.length > 0) {
      const agent = idleAgents[0];
      const attrs = agent.attributes || {};
      directives.push({
        id: 'c-idle',
        title: `Assign Mission Orders to ${agent.displayName} (${agent.typeTemplateName})`,
        category: 'OPERATIVE ASSIGNMENT',
        severity: 'HIGH',
        statement: `${agent.displayName} is currently stationed in ${agent.locationName || 'an unknown location'} with no active operations queued (Skills: ADM ${attrs.Administration ?? 'UNAVAILABLE'}, PER ${attrs.Persuasion ?? 'UNAVAILABLE'}, ESP ${attrs.Espionage ?? 'UNAVAILABLE'}).`,
        action: `Deploy on a priority mission matched to specialty: ${attrs.Persuasion > 10 ? 'Public Campaign' : (attrs.Espionage > 10 ? 'Crackdown / Sabotage' : 'Advise Nation')}.`,
        successFactor: 'IMMEDIATE'
      });
    }

    // High Stat Specialization
    const masterAgent = [...ownCouncilors].sort((a, b) => (b.totalSkills || 0) - (a.totalSkills || 0))[0];
    if (masterAgent) {
      directives.push({
        id: 'c-master',
        title: `Leverage Master Operative '${masterAgent.displayName}' (Total Skills: ${masterAgent.totalSkills})`,
        category: 'STRATEGIC ASSET',
        severity: 'STANDARD',
        statement: `${masterAgent.displayName} (${masterAgent.typeTemplateName}) possesses our highest operational skill rating with ${masterAgent.orgs?.length || 0} assigned organizations.`,
        action: `Assign to spearhead critical superpower acquisition or council turn operations.`,
        successFactor: 'PEAK EFFICIENCY'
      });
    }

    return directives;
  }

  buildSpaceDirectives(habs, fleets, habSites, observer, observerName = null) {
    const directives = [];
    const visibleHabs = this.asArray(habs);
    const visibleFleets = this.asArray(fleets);
    const visibleHabSites = this.asArray(habSites);
    const ownHabs = visibleHabs.filter(h => this.sameId(h.factionId, observer?.ID));
    const ownFleets = visibleFleets.filter(f => this.sameId(f.factionId, observer?.ID));
    const observerLabel = observerName || observer?.displayName || 'the selected faction';
    const fleetPower = this.getFleetCombatPower(observer || {}, ownFleets);
    const miningRates = this.getMiningRateSummary(visibleHabSites, ownHabs, observer?.ID);

    // Directive 1: Mining Infrastructure
    directives.push({
      id: 'sp-1',
      title: `Review Off-World Mining Grid (${ownHabs.length} Habs Visible)`,
      category: 'LOGISTICS & MINING',
      severity: 'HIGH',
      statement: miningRates
        ? `${observerLabel}'s visible mining sites report ${miningRates}.`
        : visibleHabSites.length > 0
          ? 'Mining-site records are visible, but current production rates are not available.'
          : 'No mining-site records are visible in this filtered snapshot; current off-world production cannot be assessed.',
      action: visibleHabSites.length > 0
        ? 'Prioritize construction or expansion at confirmed high-yield sites after comparing current resource reserves.'
        : 'Acquire prospecting data before assigning a mining expansion order.',
      successFactor: miningRates ? 'DATA-SUPPORTED' : 'INTELLIGENCE REQUIRED'
    });

    // Directive 2: Orbital Fleet Readiness
    directives.push({
      id: 'sp-2',
      title: `Orbital Defense Squadron Posture (${ownFleets.length} Fleets Active)`,
      category: 'SPACE DEFENSE',
      severity: 'STANDARD',
      statement: ownFleets.length > 0
        ? `Visible fleet combat power for ${observerLabel} is ${this.formatPower(fleetPower)} across ${ownFleets.length} fleet group${ownFleets.length === 1 ? '' : 's'}.`
        : 'No own fleet groups are visible in this filtered snapshot; fleet posture cannot be confirmed.',
      action: ownFleets.length > 0
        ? 'Maintain a defensive patrol in a relevant inner-system orbit and assign intercept orders when a confirmed threat is identified.'
        : 'Obtain current fleet telemetry before issuing an orbital defense order.',
      successFactor: ownFleets.length > 0 ? 'DETERRENCE' : 'INTELLIGENCE REQUIRED'
    });

    return directives;
  }

  buildResearchDirectives(globalResearch, observer, activeAlienStages, options = {}) {
    const directives = [];
    const researchSlots = this.getResearchSlots(globalResearch);
    const stages = activeAlienStages || {};
    const hasStageData = Object.keys(stages).length > 0;

    // Research Vector 1: Alien Threat Meter
    if (hasStageData && stages.operations && stages.operations.active === false) {
      directives.push({
        id: 'res-1',
        title: "Unlock Project 'Alien Operations' (Project_TheirOperations)",
        category: 'STRATEGIC INTEL UNLOCK',
        severity: 'CRITICAL',
        statement: 'Our intelligence command is currently blind to the calibrated Alien Threat Meter and worldwide alien operations.',
        action: 'Prioritize faction engineering slots on Alien Operations to unlock real-time alien hate estimation.',
        successFactor: 'MISSION CRITICAL'
      });
    }

    // Research Vector 2: Direct Hydra Detection
    if (hasStageData && stages.operatives && stages.operatives.active === false) {
      directives.push({
        id: 'res-2',
        title: "Advance Project 'Alien Movements' (Project_TheirMovements)",
        category: 'TACTICAL RECONNAISSANCE',
        severity: 'HIGH',
        statement: 'Alien Hydra operatives on Earth cannot be directly targeted or unmasked on satellite telemetry without completed xenobiology tracking.',
        action: 'Direct science leadership to unlock Alien Movements upon completing Alien Operations.',
        successFactor: 'TACTICAL ADVANTAGE'
      });
    }

    // Research Vector 3: Global Tech Dominance
    if (researchSlots.length > 0) {
      const topSlot = researchSlots[0];
      const progress = this.firstAvailableNumber(topSlot.progressPct, topSlot.percent);
      const displayName = topSlot.displayName || topSlot.techId || 'the current technology';
      const isLeading = topSlot.isLeading === true ||
        this.sameId(topSlot.leadFactionId, observer?.ID) ||
        (topSlot.leadFactionName && topSlot.leadFactionName === observer?.displayName);
      directives.push({
        id: 'res-3',
        title: `Contribute to Global Technology: ${displayName}`,
        category: 'GLOBAL R&D LEADERSHIP',
        severity: 'STANDARD',
        statement: `Global research slot #${topSlot.slotNumber || 1} is researching '${displayName}' (${progress === null ? 'progress unavailable' : Math.round(progress) + '% complete'}). Leading contributor: ${topSlot.leadFactionName || 'unavailable'}.`,
        action: `Maintain or increase ${observer?.displayName || 'the selected faction'} research allocation when the visible slot data supports leadership.`,
        successFactor: `${isLeading ? 'CURRENT LEADER' : 'CONTESTED'}`
      });
    }

    return directives;
  }

  buildTheaterStatus(
    nations,
    xenoforming,
    targetFactionName,
    observerId,
    observerName = null,
    xenoformingAvailable = true,
    targetFactionId = null
  ) {
    const theaters = [
      { id: 'nam', name: 'North America', nations: ['United States', 'Canada', 'Mexico'] },
      { id: 'eur', name: 'Europe & Mediterranean', nations: ['France', 'Germany', 'United Kingdom', 'Italy', 'Spain', 'Poland', 'Ukraine'] },
      { id: 'eap', name: 'East Asia & Pacific', nations: ['China', 'Japan', 'South Korea', 'Taiwan', 'Australia', 'Indonesia'] },
      { id: 'sam', name: 'South America', nations: ['Brazil', 'Argentina', 'Colombia', 'Chile', 'Peru'] },
      { id: 'mea', name: 'Eurasia & Middle East', nations: ['Russia', 'India', 'Pakistan', 'Saudi Arabia', 'Iran', 'Turkey'] },
      { id: 'afr', name: 'African Continent', nations: ['Nigeria', 'Egypt', 'South Africa', 'Ethiopia', 'Kenya'] }
    ];

    const visibleNations = this.asArray(nations);
    const visibleXenoforming = this.asArray(xenoforming);
    const selectedFactionLabel = observerName || 'the selected faction';
    const hasTarget = targetFactionName || targetFactionId !== null && targetFactionId !== undefined;

    return theaters.map(t => {
      const matchedNations = visibleNations.filter(n => t.nations.includes(n.displayName));
      const totalGdp = matchedNations.reduce((sum, n) => sum + (n.GDP || 0), 0);
      const totalGdpTrillion = (totalGdp / 1e12).toFixed(1);

      const hostileCount = hasTarget
        ? matchedNations.filter(n => targetFactionId !== null && targetFactionId !== undefined
          ? this.sameId(n.executiveFactionId, targetFactionId)
          : n.executiveFactionName === targetFactionName).length
        : 0;
      const ownCount = matchedNations.filter(n => this.sameId(n.executiveFactionId, observerId)).length;

      let statusTone = 'STABLE';
      let statusColor = '#10b981';
      if (!hasTarget) {
        statusTone = 'NO PRIORITY TARGET DATA';
        statusColor = '#64748b';
      } else if (hostileCount > 0) {
        statusTone = `CONTESTED (${hostileCount} Hostile ${targetFactionName} Executives)`;
        statusColor = '#ef4444';
      } else if (ownCount > 0) {
        statusTone = `SECURED (${ownCount} ${selectedFactionLabel} Executives)`;
        statusColor = '#00e5ff';
      }

      // Xenoforming check
      const sectorXeno = visibleXenoforming.filter(x => matchedNations.some(n => n.displayName.includes(x.regionName) || x.regionName.includes(n.displayName)));

      return {
        id: t.id,
        name: t.name,
        gdpTrillion: totalGdpTrillion,
        statusTone,
        statusColor,
        hostileCount,
        ownCount,
        nationsCount: matchedNations.length,
        xenoformingActive: xenoformingAvailable === false ? null : sectorXeno.length > 0,
        xenoCount: xenoformingAvailable === false ? null : sectorXeno.length,
        targetFactionName: targetFactionName || null,
        keyNations: matchedNations.slice(0, 4).map(n => ({
          name: n.displayName,
          executive: n.executiveFactionName || 'UNAVAILABLE',
          gdpTrillion: ((n.GDP || 0) / 1e12).toFixed(1),
          nukes: n.nukes || 0,
          unrest: (n.unrest || 0).toFixed(1)
        }))
      };
    });
  }

  buildOperativeRoster(councilors, observerId) {
    const ownCouncilors = this.asArray(councilors).filter(c => this.isOwnCouncilor(c, observerId));

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
      if (attrs.Persuasion >= 12) {
        recOrder = 'Deploy to high-GDP nation to run Public Campaign or Defend Interests.';
      } else if (attrs.Espionage >= 12) {
        recOrder = 'Deploy to hostile territory to execute Crackdown or Sabotage Facilities.';
      } else if (attrs.Investigation >= 12) {
        recOrder = 'Conduct Surveil Location or Investigate Councilor to unmask enemy moles.';
      } else if (attrs.Administration >= 12) {
        recOrder = 'Manage assigned organizations, advise executive nations, or conduct Hostile Takeover.';
      } else if (attrs.Command >= 12) {
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
        topSkill: this.getTopSkillString(attrs),
        orgsCount: c.orgs?.length || 0,
        traitsCount: c.traits?.length || 0,
        recommendedOrder: recOrder
      };
    });
  }

  asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  toFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  sameId(left, right) {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return String(left) === String(right);
  }

  firstAvailableNumber(...values) {
    for (const value of values) {
      const number = this.toFiniteNumber(value);
      if (number !== null) return number;
    }
    return null;
  }

  formatNumber(value, decimals = 0) {
    const number = this.toFiniteNumber(value);
    if (number === null) return 'UNAVAILABLE';
    return decimals > 0 ? number.toFixed(decimals) : Math.round(number).toString();
  }

  formatCount(value) {
    const number = this.toFiniteNumber(value);
    return number === null ? 'UNAVAILABLE' : Math.round(number).toString();
  }

  formatPower(value) {
    const number = this.toFiniteNumber(value);
    return number === null ? 'UNAVAILABLE' : Math.round(number).toString();
  }

  isOwnCouncilor(councilor, observerId) {
    return councilor?.isOwnCouncilor === true || this.sameId(councilor?.factionId, observerId);
  }

  isFilteredDataAvailable(snapshot, fieldName, capabilityName, mode) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, fieldName)) return false;
    if (mode === 'player' && snapshot.capabilities && snapshot.capabilities[capabilityName] === false) return false;
    return true;
  }

  getResearchSlots(globalResearch) {
    if (Array.isArray(globalResearch)) return globalResearch;
    return this.asArray(globalResearch?.activeSlots);
  }

  getControlledNationData(nations, observerId) {
    const visibleNations = this.asArray(nations);
    let controlPoints = 0;
    let hasControlPointData = false;
    const controlled = [];

    for (const nation of visibleNations) {
      const nationControlPoints = this.asArray(nation.controlPoints);
      const ownControlPoints = nationControlPoints.filter(cp => this.sameId(cp.factionId, observerId));
      if (nationControlPoints.length > 0) hasControlPointData = true;
      if (ownControlPoints.length > 0 || this.sameId(nation.executiveFactionId, observerId)) {
        controlled.push(nation);
        controlPoints += ownControlPoints.length;
      }
    }

    return {
      controlPoints: hasControlPointData ? controlPoints : null,
      nations: controlled.length > 0 ? controlled.length : null,
      gdp: controlled.length > 0 ? controlled.reduce((sum, nation) => sum + (this.toFiniteNumber(nation.GDP) || 0), 0) : null,
      research: controlled.length > 0 ? controlled.reduce((sum, nation) => sum + (this.toFiniteNumber(nation.research) || 0), 0) : null
    };
  }

  formatFactionGdp(observer, fallbackGdp = null) {
    const totalGdp = this.firstAvailableNumber(observer?.totalGdp, fallbackGdp);
    if (totalGdp !== null) return (totalGdp / 1e12).toFixed(1);
    const alreadyTrillion = this.toFiniteNumber(observer?.gdpTrillion);
    return alreadyTrillion === null ? 'UNAVAILABLE' : alreadyTrillion.toFixed(1);
  }

  formatTargetGdp(target) {
    const targetGdpTrillion = this.toFiniteNumber(target?.gdpTrillion);
    if (targetGdpTrillion !== null) return targetGdpTrillion.toFixed(2);
    const rawGdp = this.toFiniteNumber(target?.GDP);
    return rawGdp === null ? 'UNAVAILABLE' : (rawGdp / 1e12).toFixed(2);
  }

  getFleetCombatPower(observer, ownFleets) {
    const visibleFleets = this.asArray(ownFleets);
    const fleetValues = visibleFleets
      .map(fleet => this.toFiniteNumber(fleet.combatPower))
      .filter(value => value !== null);
    if (fleetValues.length > 0) return fleetValues.reduce((sum, value) => sum + value, 0);
    if (observer?.combatPowerAvailable === false) return null;
    return this.firstAvailableNumber(observer?.combatPower, observer?.fleetCombatPower);
  }

  getResourceSnapshot(resources) {
    if (!resources || typeof resources !== 'object') return null;
    const keys = ['Money', 'Influence', 'Operations', 'Boost', 'Water', 'Volatiles', 'Metals', 'NobleMetals', 'Fissiles', 'Exotics'];
    const snapshot = {};
    for (const key of keys) {
      const value = this.toFiniteNumber(resources[key]);
      if (value !== null) snapshot[key] = value;
    }
    return Object.keys(snapshot).length > 0 ? snapshot : null;
  }

  formatResourceSummary(resources) {
    if (!resources) return 'UNAVAILABLE';
    const labels = [
      ['Money', 'Money', 0],
      ['Influence', 'Influence', 0],
      ['Operations', 'Operations', 0],
      ['Boost', 'Boost', 1],
      ['Water', 'Water', 0],
      ['Volatiles', 'Volatiles', 0],
      ['Metals', 'Metals', 0],
      ['NobleMetals', 'Noble Metals', 0],
      ['Fissiles', 'Fissiles', 0],
      ['Exotics', 'Exotics', 0]
    ];
    const entries = labels
      .filter(([key]) => resources[key] !== undefined)
      .map(([key, label, decimals]) => `${label} ${this.formatNumber(resources[key], decimals)}`);
    return entries.length > 0 ? entries.join(', ') : 'UNAVAILABLE';
  }

  getMiningRateSummary(habSites, ownHabs, observerId) {
    const ownHabIds = new Set(this.asArray(ownHabs).map(hab => String(hab.ID ?? hab.id)));
    const visibleSites = this.asArray(habSites).filter(site =>
      this.sameId(site.factionId, observerId) || (site.habId !== null && site.habId !== undefined && ownHabIds.has(String(site.habId)))
    );
    const rates = [
      ['Water', 'water'],
      ['Volatiles', 'volatiles'],
      ['Metals', 'metals'],
      ['NobleMetals', 'nobleMetals'],
      ['Fissiles', 'fissiles']
    ].map(([label, key]) => {
      const values = visibleSites.map(site => this.toFiniteNumber(site[key])).filter(value => value !== null);
      return values.length > 0 ? `${label} ${values.reduce((sum, value) => sum + value, 0).toFixed(1)}/day` : null;
    }).filter(Boolean);
    return rates.length > 0 ? rates.join(', ') : null;
  }

  getTopSkillString(attrs) {
    if (!attrs) return 'Standard';
    const skills = [
      { name: 'Administration', val: attrs.Administration || 0, code: 'ADM' },
      { name: 'Persuasion', val: attrs.Persuasion || 0, code: 'PER' },
      { name: 'Investigation', val: attrs.Investigation || 0, code: 'INV' },
      { name: 'Espionage', val: attrs.Espionage || 0, code: 'ESP' },
      { name: 'Command', val: attrs.Command || 0, code: 'CMD' },
      { name: 'Science', val: attrs.Science || 0, code: 'SCI' },
      { name: 'Security', val: attrs.Security || 0, code: 'SEC' }
    ];
    skills.sort((a, b) => b.val - a.val);
    const top = skills[0];
    return `${top.code} ${top.val} (${top.name})`;
  }
}

module.exports = new BriefingGenerator();
