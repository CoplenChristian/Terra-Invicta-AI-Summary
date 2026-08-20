/**
 * Mission Control Briefing & SITREP Synthesis Engine
 *
 * Compiles raw game-state snapshot data into immersive, actionable,
 * natural-language intelligence statements and strategic directives
 * for the Executive Council in Mission Control v2.
 */

const snapshotIdentity = require('./snapshotIdentity');
const strategicIntelligence = require('./strategicIntelligence');
const directiveAdvisor = require('./directiveAdvisor');
const directiveEngine = require('./directiveEngine');
const { resolveConfig } = require('./config');
const {
  asArray,
  strictFiniteNumber,
  sameId,
  resolveObserverFaction
} = require('../shared/util.mjs');

// Trillions. GDP is quoted in dollars throughout the save.
const ONE_TRILLION = 1e12;

/**
 * The attribute score at which a councilor is called out by that skill in the
 * operative roster. Repeated five times as a bare `12` in one if/else ladder.
 * A judgement call in this repo's own presentation layer, not a game rule.
 */
const NOTABLE_SKILL_THRESHOLD = 12;

class BriefingGenerator {
  constructor(config = resolveConfig()) {
    this.config = config;
  }

  generateMissionControlBriefing(snapshot = {}, rawSnapshot = null) {
    const metadata = snapshot.metadata || {};
    const factions = this.asArray(snapshot.factions);
    const requestedObserverId = this.toFiniteNumber(snapshot.observerFactionId);
    // No display-name step here on purpose: this briefing is written about
    // whichever faction the snapshot was already filtered for, so falling back
    // to a faction named "the Initiative" would describe a different one.
    const observer = resolveObserverFaction(factions, requestedObserverId, {
      fallbackToFirst: true
    }) || {};
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
    const identity = snapshotIdentity.readSnapshotIdentity(rawSnapshot || snapshot);
    const strategic = strategicIntelligence.build(snapshot, observerId);
    const campaignPosture = directiveAdvisor.assessCampaignPosture({
      alienHateEconomics: snapshot.alienHateEconomics,
      observer,
      observerHate: observer.alienHate,
      factions,
      fleets
    });

    // v1 rule engine (docs/directive-rule-engine-plan.md). Runs alongside the
    // policyRank-based directives below rather than replacing them -- it
    // does not yet cover space, research, or mining, so deleting the ranks
    // now would drop those directives with no successor (plan §7, P5 note).
    const engineWorld = directiveEngine.buildWorld({
      observerId,
      observerName,
      posture: campaignPosture,
      campaignDate: snapshot.metadata?.gameTimeString || null,
      resources: observer.resources,
      nations,
      councilors,
      // Owned habs, joined to their mining sites so the Advise economics has
      // real monthly outputs to scale. Without this the engine could never
      // generate an `advise-hab:*` candidate on a live save, and a councilor
      // already advising a hab could not have their commitment priced.
      habs: this.buildAdvisableHabs(habs, habSites, observerId),
      capabilities,
      alienIntelligenceStage: snapshot.alienIntelligenceStage || null,
      directiveWeights: this.config.analysis?.directiveWeights || null,
      missionSpecs: snapshot.missionSpecs || null,
      alienHate: observer.alienHate || snapshot.alienThreat?.hate || null,
      alienThreat: snapshot.alienThreat || null,
      // The cycle hate budget needs a measured hate figure. In player mode the
      // raw assessed hate is redacted, but the minimum-hate FLOOR is still
      // computed, so without this block the budget pool had nothing to read
      // and silently fell back to treating hate as zero.
      alienHateEconomics: snapshot.alienHateEconomics || null,
      usedMC: this.toFiniteNumber(observer.missionControlUsage),
      mcCapacity: this.toFiniteNumber(observer.missionControlCapacity)
    });
    const engineResult = directiveEngine.runEngine(engineWorld);

    // Hold Ground (docs/directive-engine-v2-plan.md §4f). The affirmative
    // counterpart to the vetoes: when hate is at the war line and the fleet
    // cannot contest, holding IS the move, and the panel should say so rather
    // than degrading toward empty. Built here because it needs both the
    // posture and what the engine actually held back this cycle.
    const holdGround = directiveAdvisor.buildHoldGround({
      posture: campaignPosture,
      alienHateEconomics: snapshot.alienHateEconomics || {},
      hateTrend: this.readObserverHateTrend(snapshot, observerId, campaignPosture),
      deferredCounts: engineResult.heldHateBearingByMission || null,
      observerName
    });

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
      habSites,
      campaignPosture
    });

    // 2. Department Directives (Actionable Statements)
    const geopoliticalDirectives = this.buildGeopoliticalDirectives(
      targetEntries,
      nations,
      targetFactionName,
      observer,
      observerName,
      councilors,
      observerId,
      { campaignPosture, factions, targetFaction, holdGround }
    );
    const councilDirectives = this.buildCouncilDirectives(councilors, observerId, campaignPosture);
    const spaceDirectives = this.buildSpaceDirectives(habs, fleets, habSites, observer, observerName, campaignPosture);
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
    const operativeRoster = this.buildOperativeRoster(councilors, observerId, campaignPosture);

    return {
      ...identity,
      generatedAt: identity.generatedAt || new Date().toISOString(),
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
      operatives: operativeRoster,
      campaignPosture,
      // The full structured posture assessment behind the Hold Ground
      // directive: the measured fleet comparison, the ranked capability
      // deficit, the zero-hate work that stays available, what was deferred
      // and at what hate, and the exit condition. Carried whether or not it
      // fires, so a caller can see the stand-down reason too.
      holdGround,
      engineDirectives: {
        primary: engineResult.primary,
        alternatives: engineResult.alternatives,
        // `rejected` / `uncertain` / `futureOpportunities` are CAPPED for
        // transport (the uncapped player-mode payload was 1.3 MB of
        // near-identical entries). Forwarding the arrays without their totals
        // made a 25-entry slice read as the complete set, which is the same
        // defect class as fabricating data. The true totals and the omitted
        // counts travel with them.
        rejected: engineResult.rejected,
        rejectedTotalCount: engineResult.rejectedTotalCount,
        rejectedOmittedCount: engineResult.rejectedOmittedCount,
        uncertain: engineResult.uncertain,
        uncertainTotalCount: engineResult.uncertainTotalCount,
        uncertainOmittedCount: engineResult.uncertainOmittedCount,
        futureOpportunities: engineResult.futureOpportunities,
        futureOpportunitiesTotalCount: engineResult.futureOpportunitiesTotalCount,
        futureOpportunitiesOmittedCount: engineResult.futureOpportunitiesOmittedCount,
        droppedCandidates: engineResult.droppedCandidates,
        cyclePlan: engineResult.cyclePlan,
        decisionReasoning: engineResult.decisionReasoning
      },
      primaryDirective: directiveAdvisor.pickPrimaryDirective({
        geopolitical: geopoliticalDirectives,
        council: councilDirectives,
        space: spaceDirectives,
        research: researchDirectives
      }),
      strategic,
      changesSincePrevious: snapshot.changesSincePrevious || { available: false, message: 'No previous snapshot comparison is available.' }
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
      habSites = [],
      campaignPosture = null,
      targetFaction = null
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
      ? ` The strongest visible rival is ${leadingFactionName} (composite score estimate: ${this.formatPower(topFactionPower)}/100).`
      : ' No opposing faction has a confirmed higher visible power score.';
    const p1 = `As of ${metadata.gameTimeString || 'the current operational cycle'}, ${observerLabel} ${rankText} with a composite strategic score estimate of ${powerText}/100. Its network commands ${this.formatCount(controlPoints)} control points across ${this.formatCount(controlledNationCount)} nations, representing $${gdpTrillion}T in terrestrial GDP and ${this.formatCount(researchPts)} monthly scientific output.${rivalText} Current reserves: ${resourceText}.`;

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

    const idleOwn = ownCouncilors.filter(c => this.isIdleCouncilor(c)).length;
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

  attachHateEstimate(directive, missionType, proxy) {
    const estimate = directiveAdvisor.expectedAlienHate(missionType, proxy);
    return {
      ...directive,
      expectedAlienHate: estimate.label,
      expectedAlienHateNote: estimate.note,
      policyNote: estimate.feedsProxyHate ? estimate.note : (directive.policyNote || null)
    };
  }

  /**
   * The observer's alien-hate movement since the previous save, or null.
   *
   * GUARDED ON MODE ON PURPOSE. `changesSincePrevious` carries an "Assessed
   * alien hate" row for the observer, and that row is the SAVE's raw figure --
   * the one player mode redacts everywhere else. Reading it unguarded would
   * both leak the redacted value and produce a rate that silently disappears
   * the moment the leak is closed. `hateObservable` is exactly "the true hate
   * is legitimately readable in this mode", so gate on that and nothing else.
   */
  readObserverHateTrend(snapshot = {}, observerId = null, posture = {}) {
    if (posture?.hateObservable !== true) return null;
    const changes = snapshot.changesSincePrevious;
    if (!changes || changes.available !== true) return null;
    const elapsedGameDays = this.toFiniteNumber(changes.elapsedGameDays);
    if (elapsedGameDays === null || !(elapsedGameDays > 0)) return null;
    const entry = this.asArray(changes.factions).find(f => this.sameId(f.factionId, observerId));
    const change = this.asArray(entry?.changes)
      .find(c => /alien hate/i.test(String(c?.metric || '')));
    const delta = this.toFiniteNumber(change?.delta);
    if (delta === null) return null;
    return {
      delta,
      from: this.toFiniteNumber(change.from),
      to: this.toFiniteNumber(change.to),
      elapsedGameDays
    };
  }

  /**
   * Hold Ground as a first-class directive (plan §4f).
   *
   * It is ranked above the deferred-crackdown hold because it is the same
   * decision stated affirmatively AND it fires on posture alone -- including
   * the case the old hold could not reach, where there is no proxy target at
   * all and the board would otherwise degrade toward empty.
   */
  buildHoldGroundDirective(holdGround, councilors, observerId, observerName) {
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
      eligibleOperatives: this.eligibleOperatives(
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

  buildGeopoliticalDirectives(servantTargets, nations, targetFactionName, observer, observerName = null, councilors = [], observerId = null, context = {}) {
    const directives = [];
    const targets = this.asArray(servantTargets);
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
    const holdGroundDirective = this.buildHoldGroundDirective(
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
        statement: `${targetFactionName} still hold ${t.nationName || 'the identified nation'} ($${this.formatTargetGdp(t)}T GDP), but Crackdown/Purge against them feeds alien hate (${proxy.shareLabel}). Current posture: ${campaignPosture.reasons.join('; ')}. A Purge success would add ${purgeHate.label}; Crackdown ${crackdownHate.label}.`,
        action: `Assign Defend Interests to own majors, keep ${t.nationName} on the watch list, and prepare the proxy operation for the next survivable window.`,
        successFactor: 'SURVIVAL FIRST',
        missionType: 'Defend Interests',
        preparation: 'Assign Administration or Persuasion to executive nations. Leave the proxy holding on watch.',
        window: 'Until fleet posture can survive open war',
        missionCost: '20 Influence',
        expectedAlienHate: 'none (Defend Interests)',
        expectedAlienHateNote: 'Defend Interests success-slot hate is 0. Crackdown/Purge vs this proxy is deferred because it feeds alien hate.',
        policyNote: campaignPosture.reasons.join(' · '),
        eligibleOperatives: this.eligibleOperatives(councilors, resolvedObserverId, ['Administration', 'Persuasion', 'Security'])
      });

      directives.push(this.attachHateEstimate({
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
        eligibleOperatives: this.eligibleOperatives(councilors, resolvedObserverId, ['Espionage', 'Investigation'])
      }, 'Crackdown / Purge', proxy));

      const alt = directiveAdvisor.findHumanNonProxyTarget(nations, context.factions, resolvedObserverId);
      if (alt) {
        directives.push(this.attachHateEstimate({
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
          eligibleOperatives: this.eligibleOperatives(councilors, resolvedObserverId, ['Espionage'])
        }, 'Purge', alt.proxy));
      }
    } else if (targets.length > 0 && targetFactionName) {
      const t = targets[0];
      const targetCpCount = this.firstAvailableNumber(t.targetCPCount, t.servantCPCount);
      const unrest = this.toFiniteNumber(t.unrest);
      directives.push(this.attachHateEstimate({
        id: 'geo-1',
        policyRank: 90,
        title: `Authorize Operation 'Severance' in ${t.nationName}`,
        category: 'CRACKDOWN & PURGE',
        severity: 'CRITICAL',
        target: t.nationName,
        statement: `${t.nationName || 'The identified nation'} ($${this.formatTargetGdp(t)}T GDP) holds ${targetCpCount === null ? 'an unknown number of' : targetCpCount} ${targetFactionName} control point${targetCpCount === 1 ? '' : 's'}${t.isExecutiveTarget ? ', including Executive authority' : ''}. Stability data is ${unrest === null ? 'unavailable' : unrest > 4 ? 'degraded (Unrest: ' + unrest + ')' : 'not critically degraded'}. ${proxy.share > 0 ? `Expected alien hate from a Purge success: ${purgeHate.label}.` : ''}`,
        action: `Deploy a suitable ${observerLabel} operative to investigate the holding and execute a visible crackdown or purge only when the current target data supports it.`,
        successFactor: unrest !== null && unrest > 4 ? 'HIGH (Vulnerable to subversion)' : 'MODERATE',
        missionType: 'Crackdown / Purge',
        preparation: 'Confirm executive control, then assign an idle Espionage or Investigation operative in-theater.',
        window: unrest !== null && unrest > 4 ? 'This cycle — unrest is already degraded' : 'This cycle',
        missionCost: 'UNAVAILABLE',
        policyNote: proxy.share > 0 ? purgeHate.note : null,
        eligibleOperatives: this.eligibleOperatives(councilors, resolvedObserverId, ['Espionage', 'Investigation', 'Command'])
      }, 'Crackdown / Purge', proxy));
    }

    if (targets.length > 1 && targetFactionName) {
      const t2 = targets[1];
      const targetCpCount = this.firstAvailableNumber(t2.targetCPCount, t2.servantCPCount);
      directives.push(this.attachHateEstimate({
        id: 'geo-2',
        policyRank: escalateLate ? 45 : 60,
        title: `Containment Sweep in ${t2.nationName}`,
        category: 'PUBLIC CAMPAIGN',
        severity: escalateLate ? 'WATCH' : 'HIGH',
        target: t2.nationName,
        statement: `${targetFactionName} maintain${targetCpCount === 1 ? 's' : ''} ${targetCpCount === null ? 'an unknown number of' : targetCpCount} control point${targetCpCount === 1 ? '' : 's'} in ${t2.nationName || 'the identified nation'} ($${this.formatTargetGdp(t2)}T GDP).`,
        action: `Deploy a high-Persuasion ${observerLabel} councilor on a visible Public Campaign mission if the current intelligence picture confirms the opportunity.`,
        successFactor: 'VERY HIGH',
        missionType: 'Public Campaign',
        preparation: 'Stage a Persuasion-led councilor in-country before the campaign order.',
        window: 'This cycle',
        missionCost: 'UNAVAILABLE',
        eligibleOperatives: this.eligibleOperatives(councilors, resolvedObserverId, ['Persuasion', 'Administration'])
      }, 'Public Campaign', proxy));
    }

    directives.push(this.attachHateEstimate({
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
      eligibleOperatives: this.eligibleOperatives(councilors, resolvedObserverId, ['Administration', 'Persuasion', 'Security'])
    }, 'Defend Interests', { share: 0, label: observerLabel }));

    return directives;
  }

  buildCouncilDirectives(councilors, observerId, campaignPosture = {}) {
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
        successFactor: 'CONFIRMED STREAM',
        policyRank: 95
      });
    }

    // Operative Readiness Directives
    const idleAgents = ownCouncilors.filter(c => !c.activeMissionName || c.activeMissionName.includes('Idle') || c.activeMissionName.includes('Standby'));
    if (idleAgents.length > 0) {
      const agent = idleAgents[0];
      const attrs = agent.attributes || {};
      const holdProxy = campaignPosture?.escalateLate === true;
      const specialty = holdProxy
        ? (attrs.Persuasion > 10 ? 'Public Campaign or Defend Interests' : 'Defend Interests / Advise Nation, then prepare a proxy operation for a survivable window')
        : (attrs.Persuasion > 10 ? 'Public Campaign' : (attrs.Espionage > 10 ? 'Crackdown / Sabotage' : 'Advise Nation'));
      directives.push({
        id: 'c-idle',
        policyRank: holdProxy ? 50 : 55,
        title: `Assign Mission Orders to ${agent.displayName} (${agent.typeTemplateName})`,
        category: 'OPERATIVE ASSIGNMENT',
        severity: 'HIGH',
        statement: `${agent.displayName} is currently stationed in ${agent.locationName || 'an unknown location'} with no active operations queued (Skills: ADM ${attrs.Administration ?? 'UNAVAILABLE'}, PER ${attrs.Persuasion ?? 'UNAVAILABLE'}, ESP ${attrs.Espionage ?? 'UNAVAILABLE'}).`,
        action: `Deploy on a priority mission matched to specialty: ${specialty}.`,
        successFactor: 'IMMEDIATE',
        missionType: holdProxy ? 'Defend Interests' : (attrs.Persuasion > 10 ? 'Public Campaign' : (attrs.Espionage > 10 ? 'Crackdown / Purge' : 'Advise')),
        missionCost: 'UNAVAILABLE',
        expectedAlienHate: holdProxy ? 'none (Defend Interests)' : 'depends on target'
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
        successFactor: 'PEAK EFFICIENCY',
        policyRank: 15
      });
    }

    return directives;
  }

  buildSpaceDirectives(habs, fleets, habSites, observer, observerName = null, campaignPosture = {}) {
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
      policyRank: 20,
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
    const escalateLate = campaignPosture?.escalateLate === true;
    directives.push({
      id: 'sp-2',
      policyRank: escalateLate ? 85 : 35,
      title: escalateLate
        ? `Preserve the fleet — escalate late (${directiveAdvisor.formatShipPosture(campaignPosture)})`
        : `Orbital Defense Squadron Posture (${ownFleets.length} Fleets Active)`,
      category: 'SPACE DEFENSE',
      severity: escalateLate ? 'CRITICAL' : 'STANDARD',
      statement: ownFleets.length > 0
        ? `Visible fleet combat power for ${observerLabel} is ${this.formatPower(fleetPower)} across ${ownFleets.length} fleet group${ownFleets.length === 1 ? '' : 's'}. ${escalateLate ? 'Doctrine is escalate late: ship count is not combat capability, but this force cannot be assumed to survive the retaliation cycle if proxy actions add more alien hate.' : ''}`
        : 'No own fleet groups are visible in this filtered snapshot; fleet posture cannot be confirmed.',
      action: escalateLate
        ? 'Prioritize fleet preservation: keep experienced hulls intact, limit new Mission Control, and stage proxy operations for a survivable window.'
        : ownFleets.length > 0
          ? 'Maintain a defensive patrol in a relevant inner-system orbit and assign intercept orders when a confirmed threat is identified.'
          : 'Obtain current fleet telemetry before issuing an orbital defense order.',
      successFactor: escalateLate ? 'SURVIVAL FIRST' : (ownFleets.length > 0 ? 'DETERRENCE' : 'INTELLIGENCE REQUIRED'),
      policyNote: escalateLate ? campaignPosture.reasons.join(' · ') : null
    });

    return directives;
  }

  buildResearchDirectives(globalResearch, observer, activeAlienStages, options = {}) {
    const directives = [];
    const researchSlots = this.getResearchSlots(globalResearch);
    const stages = activeAlienStages || {};
    const hasStageData = Object.keys(stages).length > 0;
    const effects = this.config.analysis?.effects || {};
    const projects = new Map(
      (this.config.analysis?.strategicProjects || []).map(project => [project.id, project])
    );
    const unlockLabel = (effectId, fallback) => {
      const descriptor = effects[effectId] || {};
      const id = descriptor.defaultProject || descriptor.defaultTech;
      if (!id) return fallback;
      const displayName = projects.get(id)?.name || id;
      const kind = descriptor.defaultTech ? 'Tech' : 'Project';
      return `${kind} '${displayName}' (${id})`;
    };

    // Research Vector 1: Alien Threat Meter
    if (hasStageData && stages.operations && stages.operations.active === false) {
      directives.push({
        id: 'res-1',
        title: `Unlock ${unlockLabel('Effect_UpdateAlienThreatMeter', 'the configured alien threat project')}`,
        category: 'STRATEGIC INTEL UNLOCK',
        severity: 'CRITICAL',
        statement: 'Our intelligence command is currently blind to the calibrated Alien Threat Meter and worldwide alien operations.',
        action: 'Prioritize faction engineering slots on Alien Operations to unlock real-time alien hate estimation.',
        successFactor: 'MISSION CRITICAL',
        policyRank: 55
      });
    }

    // Research Vector 2: Direct Hydra Detection
    if (hasStageData && stages.operatives && stages.operatives.active === false) {
      directives.push({
        id: 'res-2',
        title: `Advance ${unlockLabel('Effect_DetectAlienMovements', 'the configured alien movement project')}`,
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
      const totalGdpTrillion = (totalGdp / ONE_TRILLION).toFixed(1);

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
          gdpTrillion: ((n.GDP || 0) / ONE_TRILLION).toFixed(1),
          nukes: n.nukes || 0,
          unrest: (n.unrest || 0).toFixed(1)
        }))
      };
    });
  }

  buildOperativeRoster(councilors, observerId, campaignPosture = {}) {
    const ownCouncilors = this.asArray(councilors).filter(c => this.isOwnCouncilor(c, observerId));

    // `escalateLate` is true when ANY hold fired, and the holds are no longer
    // interchangeable: Total War proximity holds on its own, with a strong
    // fleet and hate that is nowhere near the war threshold. Naming the
    // fragile-fleet case regardless produced advice that contradicted the
    // measured posture (spaceFragile false, hold text about Total War), so
    // quote the reason that actually fired instead of assuming one.
    const holdReasons = this.asArray(campaignPosture?.holds)
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
        topSkill: this.getTopSkillString(attrs),
        orgsCount: c.orgs?.length || 0,
        traitsCount: c.traits?.length || 0,
        recommendedOrder: recOrder
      };
    });
  }

  // Thin delegates to shared/util.mjs, kept as methods because `this.asArray`
  // / `this.toFiniteNumber` / `this.sameId` are called from ~200 places in this
  // class and from its tests. The definitions themselves are no longer copies.
  asArray(value) {
    return asArray(value);
  }

  /**
   * Owned habs, enriched with the monthly resource output the directive
   * engine's Advise economics needs.
   *
   * A hab record in the snapshot carries identity and posture but no output
   * figures at all, so passing it straight through would give every hab five
   * absent inputs. The mined output IS derivable: hab sites join to their hab
   * by `habId` and carry per-day rates. 30x each measured rate is the monthly
   * output Advise scales by Administration.
   *
   * `research`, `money` and marine combat are NOT in the snapshot. They stay
   * null rather than being filled with a plausible-looking number, and a hab
   * left with nothing measurable is dropped by the candidate generator with a
   * recorded reason.
   */
  buildAdvisableHabs(habs, habSites, observerId) {
    const sitesByHab = new Map();
    for (const site of this.asArray(habSites)) {
      const habId = site?.habId;
      if (habId === null || habId === undefined) continue;
      const key = String(habId);
      if (!sitesByHab.has(key)) sitesByHab.set(key, []);
      sitesByHab.get(key).push(site);
    }

    const RESOURCE_KEYS = ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles'];

    return this.asArray(habs)
      .filter(hab => this.sameId(hab.factionId, observerId))
      .map(hab => {
        const sites = sitesByHab.get(String(hab.ID)) || [];
        const monthly = {};
        for (const key of RESOURCE_KEYS) {
          let total = null;
          for (const site of sites) {
            const rate = this.toFiniteNumber(site[key]);
            if (rate === null) continue;
            total = (total ?? 0) + rate * 30;
          }
          monthly[key] = total === null ? null : Number(total.toFixed(2));
        }
        return {
          ...hab,
          ...monthly,
          resourceOutputSource: sites.length > 0
            ? `${sites.length} joined hab site(s), daily rate x30`
            : 'no hab site joins to this hab',
          // Explicitly absent rather than absent by omission.
          research: this.toFiniteNumber(hab.research),
          money: this.toFiniteNumber(hab.money),
          marineCombatValue: this.toFiniteNumber(hab.marineCombatValue ?? hab.combatValue)
        };
      });
  }

  // The STRICT variant: this class reads arbitrary snapshot fields that may
  // hold a boolean or an array, and `Number(true)` is 1 while `Number([])` is
  // 0. See shared/util.mjs for why the two coercions are named separately.
  toFiniteNumber(value) {
    return strictFiniteNumber(value);
  }

  sameId(left, right) {
    return sameId(left, right);
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

  visibleSkill(councilor, skill) {
    const masked = councilor?.maskedAttributes?.[skill];
    if (masked && typeof masked === 'object') {
      if (masked.visibility === 'unknown' || masked.visibility === 'unavailable') return null;
      return this.toFiniteNumber(masked.visible ?? masked.actual);
    }
    return this.toFiniteNumber(councilor?.attributes?.[skill]);
  }

  isIdleCouncilor(councilor) {
    const mission = String(councilor?.activeMissionName || '');
    return !mission || /idle|standby/i.test(mission);
  }

  eligibleOperatives(councilors, observerId, skills = [], limit = 3) {
    const wanted = Array.isArray(skills) && skills.length ? skills : ['Espionage', 'Persuasion'];
    return this.asArray(councilors)
      .filter(councilor => this.isOwnCouncilor(councilor, observerId))
      .map(councilor => {
        const scores = wanted.map(skill => ({ skill, value: this.visibleSkill(councilor, skill) }))
          .filter(entry => entry.value !== null)
          .sort((a, b) => b.value - a.value);
        const best = scores[0] || null;
        return {
          id: councilor.ID,
          name: councilor.displayName,
          profession: councilor.typeTemplateName || 'Councilor',
          location: councilor.locationName || 'Unknown location',
          mission: councilor.activeMissionName || 'Standby',
          available: this.isIdleCouncilor(councilor),
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
      // Last-resort fallback for a snapshot with no faction totalResearch. A
      // nation's research is split equally between its control points (wiki,
      // Nations, 2026-05-17), so take our share rather than the whole nation.
      // It still omits space and org research, so it is a floor, not a total.
      research: controlled.length > 0
        ? controlled.reduce((sum, nation) => {
          const nationControlPoints = this.asArray(nation.controlPoints);
          if (nationControlPoints.length === 0) return sum;
          const owned = nationControlPoints.filter(cp => this.sameId(cp.factionId, observerId)).length;
          return sum + (this.toFiniteNumber(nation.research) || 0) * (owned / nationControlPoints.length);
        }, 0)
        : null
    };
  }

  formatFactionGdp(observer, fallbackGdp = null) {
    const totalGdp = this.firstAvailableNumber(observer?.totalGdp, fallbackGdp);
    if (totalGdp !== null) return (totalGdp / ONE_TRILLION).toFixed(1);
    const alreadyTrillion = this.toFiniteNumber(observer?.gdpTrillion);
    return alreadyTrillion === null ? 'UNAVAILABLE' : alreadyTrillion.toFixed(1);
  }

  formatTargetGdp(target) {
    const targetGdpTrillion = this.toFiniteNumber(target?.gdpTrillion);
    if (targetGdpTrillion !== null) return targetGdpTrillion.toFixed(2);
    const rawGdp = this.toFiniteNumber(target?.GDP);
    return rawGdp === null ? 'UNAVAILABLE' : (rawGdp / ONE_TRILLION).toFixed(2);
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
