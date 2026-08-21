/**
 * Mission Control Briefing & SITREP Synthesis Engine
 * Purpose: the Mission Control briefing and SITREP synthesis entry point — the
 *   barrel over the briefing domain modules.
 *
 * Compiles raw game-state snapshot data into immersive, actionable,
 * natural-language intelligence statements and strategic directives
 * for the Executive Council in Mission Control v2.
 *
 * ---------------------------------------------------------------------------
 * This file used to BE all of that -- 1,341 lines mixing the orchestration,
 * the SITREP prose, four directive builders, the Earth theater table, a
 * councilor roster, and twenty formatting helpers on one class. The
 * 2026-08-20 code review (section D) flagged it as a multi-functional file, so
 * the bodies moved out and this file kept only `generateMissionControlBriefing`
 * -- the single entry point used by `server/index.js`,
 * `scripts/push_latest_to_supabase.js`, `scripts/build_static_snapshot.js` and
 * the test suites, whose signature and result shape are unchanged.
 *
 * Every method on the class below is the SAME function object the module
 * exports, assigned onto the prototype rather than wrapped, so the delegation
 * cannot drift from the implementation. The one exception is
 * `buildResearchDirectives`, which is the only builder that reads
 * `this.config`; it forwards that one argument and is marked below.
 *
 *   briefing/format.js    coercion and presentation primitives -- every
 *                         formatter answers 'UNAVAILABLE', never 0
 *   briefing/roster.js    who is ours, who is free, what a masked stat says
 *   briefing/readers.js   snapshot joins and roll-ups shared with the
 *                         directive builders
 *   briefing/sitrep.js    the four-paragraph Executive SITREP
 *   directives/           the policyRank ladder: holdGround, geopolitical,
 *                         council, space, research -- moved beside
 *                         directiveEngine per the review, as a sibling of
 *                         server/engine/ rather than inside it
 *   ../earthTheater.js    the six Earth theater groupings and their status
 *
 * Where the review's suggestion and this layout differ: the review said
 * theater mapping "belongs in server/spaceTheater.js". The intent -- it does
 * not belong inside the briefing generator -- is right, and it moved out. But
 * spaceTheater.js maps solar-system BODIES into orbital theaters while this
 * maps Earth NATIONS into geopolitical ones; the two share no key space, so
 * merging them would make `theaterForBody('France')` look answerable. It is a
 * same-shaped PEER module, `server/earthTheater.js`, instead.
 * ---------------------------------------------------------------------------
 */

const snapshotIdentity = require('./snapshotIdentity');
const strategicIntelligence = require('./strategicIntelligence');
const directiveAdvisor = require('./directiveAdvisor');
const directiveEngine = require('./directiveEngine');
const { resolveConfig } = require('./config');
const { resolveObserverFaction } = require('../shared/util.mjs');
const format = require('./briefing/format');
const roster = require('./briefing/roster');
const readers = require('./briefing/readers');
const { buildExecutiveSitrep } = require('./briefing/sitrep');
const { buildTheaterStatus } = require('./earthTheater');
const directives = require('./directives');
const strategicCommentary = require('./commentary');

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

    // v1 rule engine (docs/archive/directive-rule-engine-plan.md). Runs alongside the
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

    // Hold Ground (docs/archive/directive-engine-v2-plan.md §4f). The affirmative
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

    // 5. Strategic Commentary (docs/archive/strategic-commentary-and-layout-plan.md)
    const commentary = strategicCommentary.generateStrategicCommentary({
      snapshot,
      rawSnapshot,
      campaignPosture,
      holdGround,
      changesSincePrevious: snapshot.changesSincePrevious,
      snapshotId: identity.snapshotId || identity.saveFilename
    });

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
      strategicCommentary: commentary,
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

  /**
   * The only method here that is not the extracted function itself: the
   * research ladder is the one builder that reads configuration, and forwarding
   * `this.config` keeps its public signature identical while letting the
   * builder stay a plain function like its four siblings.
   */
  buildResearchDirectives(globalResearch, observer, activeAlienStages, options = {}) {
    return directives.buildResearchDirectives(globalResearch, observer, activeAlienStages, options, this.config);
  }
}

// Assigned rather than declared so each method IS the module's function object.
// `this.asArray` / `this.toFiniteNumber` / `this.sameId` are called from the
// entry point above and from the tests; the rest are kept on the surface
// because they were reachable before this split and removing them would be a
// behaviour change dressed as a refactor.
Object.assign(BriefingGenerator.prototype, {
  // Prose and structure.
  buildExecutiveSitrep,
  buildTheaterStatus,
  buildOperativeRoster: roster.buildOperativeRoster,

  // The policyRank directive ladder.
  attachHateEstimate: directives.attachHateEstimate,
  buildHoldGroundDirective: directives.buildHoldGroundDirective,
  buildGeopoliticalDirectives: directives.buildGeopoliticalDirectives,
  buildCouncilDirectives: directives.buildCouncilDirectives,
  buildSpaceDirectives: directives.buildSpaceDirectives,

  // Snapshot readers.
  isFilteredDataAvailable: readers.isFilteredDataAvailable,
  getResearchSlots: readers.getResearchSlots,
  getControlledNationData: readers.getControlledNationData,
  getFleetCombatPower: readers.getFleetCombatPower,
  getMiningRateSummary: readers.getMiningRateSummary,
  buildAdvisableHabs: readers.buildAdvisableHabs,
  readObserverHateTrend: readers.readObserverHateTrend,

  // Roster readers.
  isOwnCouncilor: roster.isOwnCouncilor,
  visibleSkill: roster.visibleSkill,
  isIdleCouncilor: roster.isIdleCouncilor,
  eligibleOperatives: roster.eligibleOperatives,

  // Formatting and coercion. Thin delegates to shared/util.mjs live in
  // briefing/format.js; the definitions themselves are not copies.
  asArray: format.asArray,
  sameId: format.sameId,
  toFiniteNumber: format.toFiniteNumber,
  firstAvailableNumber: format.firstAvailableNumber,
  formatNumber: format.formatNumber,
  formatCount: format.formatCount,
  formatPower: format.formatPower,
  formatFactionGdp: format.formatFactionGdp,
  formatTargetGdp: format.formatTargetGdp,
  getResourceSnapshot: format.getResourceSnapshot,
  formatResourceSummary: format.formatResourceSummary,
  getTopSkillString: format.getTopSkillString
});

module.exports = new BriefingGenerator();
