// server/intelligenceFilter.js
//
// Purpose: redact and filter a raw snapshot down to what the observer is allowed to see.

const capabilityResolver = require('./capabilityResolver');
const opportunityScorer = require('./opportunityScorer');
const snapshotIdentity = require('./snapshotIdentity');
const { resolveConfig } = require('./config');
const { buildAlienHateEconomics } = require('./alienHateEconomics');
const {
  ALIEN_FACTION_DISPLAY_NAME,
  INITIATIVE_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME
} = require('../shared/constants.mjs');
// One id-matching idiom for the whole redaction path. This file previously
// mixed three -- bare `===`, `String(x) === String(y)`, and `parseInt(x) === y`
// -- so whether a record counted as "ours" depended on which line was reached.
// `sameId` compares numerically when both sides parse and treats an absent id
// as matching nothing, which is what the String() form needed its extra
// null-guards for.
const {
  toFiniteNumber,
  sameId,
  resolveObserverFaction
} = require('../shared/util.mjs');

const DEFAULT_OBSERVER_FACTION_ID = resolveConfig().campaign.defaultObserverFactionId;
const RUNTIME_CONFIG = resolveConfig();
const POWER_NORMALIZERS = RUNTIME_CONFIG.analysis.powerScore.normalizers;

class IntelligenceFilter {
  // Absent stays null. `Number(null) === 0` and `Number('') === 0` are both
  // finite, so presence must be checked before coercion. The guard lives in
  // shared/util.mjs; this method name is kept because it is called from ~40
  // places in this class and from the redaction assertions.
  toFiniteOrNull(value) {
    return toFiniteNumber(value);
  }

  applyFilter(rawSnapshot, mode = 'player', observerFactionId = DEFAULT_OBSERVER_FACTION_ID) {
    // The fallback chain is unchanged, only made explicit. It stays silent
    // here deliberately: both entry points that can still answer a caller --
    // snapshotLoader.resolveObserverId and requestValidation.assertKnownObserver
    // -- already reject an unknown observer with a 404 before this runs.
    const observer = resolveObserverFaction(rawSnapshot.factions, observerFactionId, {
      fallbackDisplayName: INITIATIVE_DISPLAY_NAME,
      fallbackToFirst: true
    });

    const actualObserverId = observer ? observer.ID : observerFactionId;
    const identity = snapshotIdentity.readSnapshotIdentity(rawSnapshot);
    const observerIntelligence = rawSnapshot.factionIntelligence?.[actualObserverId] || {};
    const isEnhanced = mode === 'enhanced';
    const visibleNations = (rawSnapshot.nations || []).map((nation) => ({
      ...nation,
      controlPoints: (nation.controlPoints || []).map((controlPoint) => {
        // The explicit null guard this line used to carry is inside sameId:
        // `String(null) === String(null)` is true, which is why it was needed.
        const belongsToObserver = sameId(controlPoint.factionId, actualObserverId);
        if (isEnhanced || belongsToObserver) return controlPoint;
        const { defended, defendExpiration, ...publicControlPoint } = controlPoint;
        return publicControlPoint;
      })
    }));

    const capabilities = capabilityResolver.resolveCapabilities(
      observer,
      rawSnapshot.globalResearch,
      observerIntelligence
    );

    const priorityTargetFaction = this.getPriorityTargetFaction(rawSnapshot, actualObserverId);
    const priorityTargets = priorityTargetFaction
      ? this.buildPriorityTargets(rawSnapshot, actualObserverId, priorityTargetFaction)
      : [];
    const factionRelationships = this.filterFactionRelationships(
      rawSnapshot.factionRelationships,
      actualObserverId,
      mode
    );
    // Elapsed campaign years gate the alien total-war declaration, so the
    // hate model needs them to report anything but 'unavailable'.
    const campaignYear = Number(
      String(rawSnapshot.metadata?.gameTimeString || '').match(/\/(\d{4})\b/)?.[1]
    );
    // Number(null) is 0 and Number('') is 0, both of which are finite, so an
    // absent start year would otherwise pass the guard below and make the
    // campaign look ~2000 years old. Probe for presence before coercing.
    //
    // The save does not record a campaign start year at all, so the measured
    // value is normally null and the snapshot offers 2022 as an explicitly
    // labelled assumption instead. The elapsed-years figure is derived from
    // whichever is available and `yearsElapsedSource` says which was used --
    // an assumption stated is not the same as a default applied in silence.
    const measuredStartYear = this.toFiniteOrNull(rawSnapshot.metadata?.campaignStartYear);
    const assumedStartYear = this.toFiniteOrNull(rawSnapshot.metadata?.assumedCampaignStartYear);
    const startYear = measuredStartYear ?? assumedStartYear;
    const yearsElapsed = Number.isFinite(campaignYear) && startYear !== null
      ? campaignYear - startYear
      : null;
    const yearsElapsedSource = yearsElapsed === null
      ? 'unavailable: campaign year or start year missing'
      : (measuredStartYear !== null
        ? 'measured: save metadata campaignStartYear'
        : (rawSnapshot.metadata?.campaignStartYearSource
          || `assumed start year ${assumedStartYear}`));

    const buildHateEconomics = (visibleHateEstimate = null) => ({
      ...buildAlienHateEconomics({
        observer,
        difficulty: rawSnapshot.metadata?.difficulty,
        mode,
        visibleHateEstimate,
        yearsElapsed
      }),
      yearsElapsed,
      yearsElapsedSource,
      campaignStartYearMeasured: measuredStartYear !== null
    });

    if (mode === 'omniscient') {
      return {
        ...identity,
        mode: 'omniscient',
        observerFactionId: actualObserverId,
        observerFactionName: observer?.displayName || INITIATIVE_DISPLAY_NAME,
        capabilities,
        metadata: rawSnapshot.metadata,
        factions: rawSnapshot.factions.map(f => ({
          ...f,
          alienHate: {
            actual: Number.isFinite(f.assessedAlienHateOfMe) ? f.assessedAlienHateOfMe : null,
            playerVisible: true,
            visibleEstimate: Number.isFinite(f.assessedAlienHateOfMe)
              ? f.assessedAlienHateOfMe.toFixed(2)
              : 'UNKNOWN',
            visibility: Number.isFinite(f.assessedAlienHateOfMe) ? 'raw_save_only' : 'unavailable'
          }
        })),
        factionRelationships,
        nations: rawSnapshot.nations,
        councilors: rawSnapshot.councilors.map(c => ({
          ...c,
          visibility: 'raw_save_only',
          investigationConfidence: 'OMNISCIENT',
          maskedAttributes: Object.fromEntries(
            Object.entries(c.attributes).map(([k, v]) => [k, { actual: v, visible: v, visibility: 'raw_save_only' }])
          )
        })),
        fleets: rawSnapshot.fleets,
        habs: rawSnapshot.habs,
        habSites: rawSnapshot.habSites,
        habModules: rawSnapshot.habModules,
        shipyardStations: rawSnapshot.shipyardStations,
        shipyardQueues: rawSnapshot.shipyardQueues,
        shipDesigns: rawSnapshot.shipDesigns || [],
        resourceTransfers: rawSnapshot.resourceTransfers,
        globalResearch: rawSnapshot.globalResearch,
        activeXenoforming: rawSnapshot.activeXenoforming,
        builtAlienFacilities: rawSnapshot.builtAlienFacilities,
        alienHateEconomics: buildHateEconomics(),
        servantTargets: priorityTargets,
        priorityTargetFaction,
        techMatrix: rawSnapshot.techMatrix,
        techTree: rawSnapshot.techTree,
        shipHullStats: rawSnapshot.shipHullStats,
        // Mission rules are public game data, not intelligence -- nothing
        // about them is observer-dependent, so they pass through unfiltered
        // in both modes.
        missionSpecs: rawSnapshot.missionSpecs,
        // Likewise the unlock index, drive stats and propellant modules: they
        // are the installed templates, identical for every faction and every
        // mode. What IS observer-dependent -- which of these a faction has
        // completed or may research -- lives on the faction record, which the
        // player branch below redacts.
        unlockIndex: rawSnapshot.unlockIndex,
        driveStats: rawSnapshot.driveStats,
        propellantModules: rawSnapshot.propellantModules,
        projectGating: rawSnapshot.projectGating,
        componentStats: rawSnapshot.componentStats,
        effectIndex: rawSnapshot.effectIndex,
        miningScarcityWeights: rawSnapshot.miningScarcityWeights,
        isOmniscient: true
      };
    }

    // Gated PLAYER / ENHANCED mode

    // 1. Alien Hate Filtering
    const filteredFactions = rawSnapshot.factions.map(f => {
      let hateObj = null;
      // A faction whose hate the save does not carry is unmeasured, not
      // peaceful. `|| 0` used to render an empty 5-pip meter -- the most
      // reassuring reading available -- from no data, and print a confident
      // "0.00" beside it. Matches the omniscient branch above.
      const rawHate = typeof f.assessedAlienHateOfMe === 'number' && Number.isFinite(f.assessedAlienHateOfMe)
        ? f.assessedAlienHateOfMe
        : null;
      if (capabilities.canEstimateAlienThreat) {
        const pips = rawHate === null ? null : Math.min(5, Math.max(0, Math.round(rawHate / 10)));
        const pipStr = pips === null ? 'UNKNOWN' : '■'.repeat(pips) + '□'.repeat(5 - pips);
        hateObj = {
          actual: isEnhanced ? rawHate : null,
          playerVisible: true,
          visibleEstimate: pipStr,
          pips,
          maxPips: 5,
          visibility: rawHate === null
            ? 'unavailable'
            : (isEnhanced ? 'raw_save_only' : 'estimated'),
          status: rawHate === null ? 'unavailable' : 'available',
          ...(rawHate === null
            ? { unavailableReason: 'assessedAlienHateOfMe not present in save' }
            : {})
        };
      } else {
        hateObj = {
          actual: isEnhanced ? rawHate : null,
          playerVisible: isEnhanced,
          visibleEstimate: isEnhanced
            ? (rawHate === null ? 'UNKNOWN' : rawHate.toFixed(2))
            : 'UNAVAILABLE',
          visibility: isEnhanced && rawHate !== null ? 'raw_save_only' : 'unavailable',
          status: 'unavailable',
          requiredProject: (() => {
            const detail = capabilities.details?.estimateAlienThreat || {};
            if (detail.requiredDisplayName && detail.requiredProject) {
              return `${detail.requiredDisplayName} (${detail.requiredProject})`;
            }
            return detail.requiredDisplayName || detail.requiredProject || 'Alien threat assessment capability';
          })()
        };
      }

      const isObserver = sameId(f.ID, actualObserverId);
      // Filter enemy projects and private financial/production telemetry if
      // not omniscient. Own-faction resource values remain available to the
      // player; enhanced mode intentionally exposes the broader save view.
      const completedProjs = isObserver ? f.completedProjects : f.completedProjects.slice(0, 5); // Partial visibility for enemy

      // The save's true alien hate is a raw float the player has no legitimate
      // way to read -- the in-game knowledge is the 5-pip estimate meter built
      // above. It was stripped from every OTHER faction here while `isObserver`
      // short-circuited the redaction for the observer's own row, so player
      // mode published the exact hate on `factions[].assessedAlienHateOfMe`
      // beside a correctly-nulled `alienHate.actual` and a correctly-nulled
      // `alienHateEconomics.actualAlienHate`. That one surviving raw field then
      // fed /api/intel/summary, /factions, /resources, /alien-threat and the
      // save-to-save delta. Enhanced mode is the explicit whitelisted-raw-
      // metrics view, so it keeps the field.
      const withoutRawAlienHate = (faction) => {
        const { assessedAlienHateOfMe, ...rest } = faction;
        return rest;
      };

      const safeFaction = isEnhanced
        ? f
        : isObserver
          ? withoutRawAlienHate(f)
          : (({
            assessedAlienHateOfMe,
            resources,
            monthlyIncome,
            monthlyExpense,
            monthlyNet,
            financials,
            shipyardCount,
            shipyardQueueCount,
            ...rest
          }) => ({
            ...rest,
            resources: null,
            monthlyIncome: null,
            monthlyExpense: null,
            monthlyNet: null,
            financials: null,
            shipyardCount: null,
            shipyardQueueCount: null
          }))(f);

      return {
        ...safeFaction,
        alienHate: hateObj,
        completedProjects: completedProjs,
        currentProjects: isObserver ? f.currentProjects : [],
        // Same class as `currentProjects`: how a rival distributes its research
        // pips across slots is their internal allocation, not something the
        // player observes. Null rather than [] -- an enemy reported with an
        // empty weight array reads as "assigns no research anywhere", which is
        // a confident claim from no evidence.
        researchWeights: isEnhanced || isObserver ? f.researchWeights : null,
        availableProjectNames: isObserver ? f.availableProjectNames : [],
        // Same class as the alien-hate leak: `availableProjectNames` was
        // redacted to [] for enemies while the count derived from that very
        // list survived intact, publishing "169 available projects" of enemy
        // research state. Absent stays null and never 0 -- an enemy reported
        // with 0 available projects reads as fully researched out.
        availableProjectsCount: isEnhanced || isObserver ? f.availableProjectsCount : null,
        // Same class again: the top-level `shipDesigns` array is filtered to
        // the observer's own designs below, but each faction object carried an
        // unfiltered inline copy -- 425 enemy hull/weapon/armor loadouts
        // readable in player mode from /api/snapshot, and from the ship-designs
        // and production-plan resources, which both fall back to this field
        // when the top-level list is empty.
        shipDesigns: isEnhanced || isObserver ? f.shipDesigns : []
      };
    });

    const observerFaction = resolveObserverFaction(filteredFactions, actualObserverId);
    const alienHateEconomics = buildHateEconomics(observerFaction?.alienHate?.visibleEstimate || null);

    // 2. Councilor Intelligence Filtering
    const turnedCouncilorIds = new Set(
      rawSnapshot.councilors.filter(c => sameId(c.agentForFactionId, actualObserverId)).map(c => c.ID)
    );

    const filteredCouncilors = [];
    let detectedAlienCount = 0;

    for (const c of rawSnapshot.councilors) {
      const isOwnCouncilor = sameId(c.factionId, actualObserverId);
      const isTurnedMole = turnedCouncilorIds.has(c.ID) || sameId(c.agentForFactionId, actualObserverId);
      const isSeen = c.seenByFactionIds?.includes(actualObserverId);

      if (c.isAlien) {
        if (!capabilities.canDirectlyDetectAlienCouncilors) {
          // Player cannot directly detect alien operatives yet
          continue;
        }
        if (!isSeen && !isTurnedMole) {
          // Detectable in theory, but not yet sighted in campaign
          continue;
        }
        detectedAlienCount++;
      }

      // If enemy councilor and not seen/turned, skip in player intel
      if (!isOwnCouncilor && !isTurnedMole && !isSeen && !isEnhanced) {
        continue;
      }

      const maskedAttributes = {};
      for (const [attrName, actualVal] of Object.entries(c.attributes)) {
        if (isOwnCouncilor || isTurnedMole) {
          maskedAttributes[attrName] = {
            actual: actualVal,
            visible: actualVal,
            visibility: 'confirmed',
            source: isTurnedMole ? 'turned_agent' : 'own_council'
          };
        } else if (isEnhanced) {
          maskedAttributes[attrName] = {
            actual: actualVal,
            visible: actualVal,
            visibility: 'raw_save_only',
            source: 'enhanced_telemetry'
          };
        } else if (isSeen) {
          // Partially investigated or seen
          const isBasicAttr = ['Administration', 'Science', 'Persuasion'].includes(attrName);
          maskedAttributes[attrName] = {
            actual: actualVal,
            visible: isBasicAttr ? actualVal : null,
            visibility: isBasicAttr ? 'estimated' : 'unknown',
            source: 'surveillance'
          };
        } else {
          maskedAttributes[attrName] = {
            actual: actualVal,
            visible: null,
            visibility: 'unknown',
            source: null
          };
        }
      }

      const exposesRawCouncilorData = isOwnCouncilor || isTurnedMole || isEnhanced;
      const councilorData = exposesRawCouncilorData
        ? c
        : this.sanitizeObservedCouncilor(c, maskedAttributes);

      filteredCouncilors.push({
        ...councilorData,
        isTurnedMole,
        isOwnCouncilor,
        visibility: isOwnCouncilor ? 'confirmed' : (isTurnedMole ? 'confirmed' : (isSeen ? 'detected' : 'raw_save_only')),
        investigationConfidence: isOwnCouncilor ? 'HIGH' : (isTurnedMole ? 'VERY HIGH' : (isSeen ? 'PARTIAL' : 'NONE')),
        maskedAttributes: exposesRawCouncilorData ? maskedAttributes : this.sanitizeMaskedAttributes(maskedAttributes)
      });
    }

    // 3. Alien Intelligence Stage Status
    const stageFromCapability = (detailKey, outputKey, fallbackName, fallbackDescription, extra = {}) => {
      const detail = capabilities.details?.[detailKey] || {};
      const active = capabilities[outputKey] === true;
      return {
        ...extra,
        active,
        name: detail.requiredDisplayName || detail.name || fallbackName,
        status: active ? 'AVAILABLE' : 'LOCKED',
        description: detail.description || fallbackDescription
      };
    };
    const alienIntelligenceStage = {
      abductions: stageFromCapability(
        'detectAlienAbductions',
        'canDetectAlienAbductions',
        'Alien Signatures',
        'Detects alien abductions in surveyed regions.'
      ),
      contacts: stageFromCapability(
        'detectAlienHumanContacts',
        'canDetectAlienHumanContacts',
        'Alien Methods',
        'Detects alien contacts and enthrall activities with human factions.'
      ),
      operations: stageFromCapability(
        'detectAlienOperations',
        'canDetectAlienOperations',
        'Alien Operations',
        'Detects worldwide alien operations and updates the threat meter.'
      ),
      operatives: stageFromCapability(
        'detectAlienCouncilors',
        'canDirectlyDetectAlienCouncilors',
        'Alien Movements',
        'Directly detects and tracks individual alien operatives (Hydras).',
        { detectedCount: capabilities.canDirectlyDetectAlienCouncilors ? detectedAlienCount : null }
      )
    };

    // 4. Tech Matrix Filtering
    const filteredTechMatrix = rawSnapshot.techMatrix.map(row => {
      const filteredFactionsStatus = {};
      for (const [fid, statusObj] of Object.entries(row.factions)) {
        // `fid` is an object key, so it is always a string here; parseInt also
        // accepted a trailing-garbage key like '4712x' as a match.
        const isObs = sameId(fid, actualObserverId);
        if (isObs || isEnhanced) {
          filteredFactionsStatus[fid] = statusObj;
        } else {
          // In player intel, hide exact locked status if completely unknown
          filteredFactionsStatus[fid] = {
            ...statusObj,
            status: statusObj.status === 'completed' ? 'completed' : 'unknown'
          };
        }
      }
      return {
        ...row,
        factions: filteredFactionsStatus
      };
    });

    // Space assets and Earth alien activity are filtered from the observer's
    // actual save-backed intel and Skywatch capability. This is the trust
    // boundary for Player Intel mode.
    const visibleSpaceAssets = this.filterSpaceAssets(
      rawSnapshot,
      actualObserverId,
      observerIntelligence,
      capabilities,
      isEnhanced
    );
    const visibleFactions = this.filterFactionSpaceMetrics(
      filteredFactions,
      rawSnapshot,
      visibleSpaceAssets,
      actualObserverId,
      capabilities,
      isEnhanced
    );
    const visibleXenoforming = this.filterXenoforming(
      rawSnapshot.activeXenoforming,
      observerIntelligence,
      capabilities,
      isEnhanced
    );
    const visibleAlienFacilities = this.filterAlienFacilities(
      rawSnapshot.builtAlienFacilities,
      observerIntelligence,
      capabilities,
      isEnhanced
    );
    const visibleHabModules = (rawSnapshot.habModules || [])
      // Seeing a hab's location does not reveal its module manifest. Player
      // mode gets own-faction modules; Enhanced/Omniscient are the explicit
      // telemetry views that expose other factions' internals.
      .filter(module => isEnhanced || sameId(module.factionId, actualObserverId))
      .map(module => ({
        ...module,
        visibility: isEnhanced ? 'enhanced telemetry' : (sameId(module.factionId, actualObserverId) ? 'own faction' : 'known hab')
      }));
    const visibleShipyardQueues = (rawSnapshot.shipyardQueues || [])
      .filter(queue => isEnhanced || sameId(queue.factionId, actualObserverId))
      .map(queue => ({ ...queue, visibility: isEnhanced ? 'enhanced telemetry' : 'own faction' }));
    const visibleShipyardStations = (rawSnapshot.shipyardStations || [])
      .filter(station => isEnhanced || sameId(station.factionId, actualObserverId))
      .map(station => ({
        ...station,
        queue: (station.queue || []).filter(queue => isEnhanced || sameId(queue.factionId, actualObserverId)),
        currentConstruction: isEnhanced || sameId(station.factionId, actualObserverId) ? station.currentConstruction : null,
        visibility: isEnhanced ? 'enhanced telemetry' : 'own faction'
      }));
    const visibleResourceTransfers = (rawSnapshot.resourceTransfers || [])
      .filter(transfer => isEnhanced || sameId(transfer.sourceFactionId, actualObserverId) || sameId(transfer.targetFactionId, actualObserverId))
      .map(transfer => ({ ...transfer, visibility: isEnhanced ? 'enhanced telemetry' : 'own faction' }));

    return {
      ...identity,
      mode,
      observerFactionId: actualObserverId,
      observerFactionName: observer?.displayName || INITIATIVE_DISPLAY_NAME,
      capabilities,
      alienIntelligenceStage,
      metadata: rawSnapshot.metadata,
      factions: visibleFactions,
      factionRelationships,
      nations: visibleNations,
      councilors: filteredCouncilors,
      fleets: visibleSpaceAssets.fleets,
      habs: visibleSpaceAssets.habs,
      habSites: visibleSpaceAssets.habSites,
        habModules: visibleHabModules,
        shipyardStations: visibleShipyardStations,
        shipyardQueues: visibleShipyardQueues,
        shipDesigns: (rawSnapshot.shipDesigns || []).filter(d => isEnhanced || sameId(d.factionId, actualObserverId)),
        resourceTransfers: visibleResourceTransfers,
      globalResearch: rawSnapshot.globalResearch,
      activeXenoforming: visibleXenoforming,
      builtAlienFacilities: visibleAlienFacilities,
      alienHateEconomics,
      servantTargets: priorityTargets,
      priorityTargetFaction,
      techMatrix: filteredTechMatrix,
      techTree: rawSnapshot.techTree,
      shipHullStats: rawSnapshot.shipHullStats,
      // Public game rules, not intelligence -- unfiltered in player mode too.
      missionSpecs: rawSnapshot.missionSpecs,
      unlockIndex: rawSnapshot.unlockIndex,
      driveStats: rawSnapshot.driveStats,
      propellantModules: rawSnapshot.propellantModules,
      projectGating: rawSnapshot.projectGating,
      componentStats: rawSnapshot.componentStats,
      // The effect index is template data too. What a given faction has
      // ALREADY activated is not, and that is read from the faction record's
      // completed-project list, which this branch redacts for everyone but the
      // observer -- so an economic baseline can only ever be built for the
      // observer in player mode, and the endpoint says so rather than
      // silently pricing a rival's research against our own figures.
      effectIndex: rawSnapshot.effectIndex,
      miningScarcityWeights: rawSnapshot.miningScarcityWeights,
      isOmniscient: false
    };
  }

  getPriorityTargetFaction(rawSnapshot, observerFactionId) {
    return opportunityScorer.selectPriorityTargetFaction(
      rawSnapshot.factions,
      rawSnapshot.nations,
      observerFactionId
    );
  }

  buildPriorityTargets(rawSnapshot, observerFactionId, targetFaction) {
    const controlPointsByNationId = new Map(
      rawSnapshot.nations.map(nation => [nation.ID, nation.controlPoints || []])
    );
    return opportunityScorer.evaluateCampaignTargets(
      rawSnapshot.nations,
      controlPointsByNationId,
      observerFactionId,
      targetFaction.id,
      targetFaction.name
    );
  }

  filterFactionRelationships(relationships, observerFactionId, mode) {
    if (!Array.isArray(relationships)) return [];

    return relationships
      .filter((relationship) => mode === 'omniscient' || mode === 'enhanced' ||
        sameId(relationship.sourceFactionId, observerFactionId))
      .map((relationship) => ({
        ...relationship,
        visibility: mode === 'omniscient'
          ? 'raw_save_only'
          : mode === 'enhanced'
            ? 'enhanced telemetry'
            : 'observer faction telemetry'
      }));
  }

  sanitizeObservedCouncilor(councilor, maskedAttributes) {
    const {
      attributes,
      // resolvedAttributes carries base + org bonuses in the clear. It must be
      // stripped alongside `attributes` and `orgs`, or an observed enemy
      // councilor would expose exact stats the player has not earned.
      resolvedAttributes,
      maskedAttributes: rawMaskedAttributes,
      orgs,
      traits,
      totalSkills,
      ...safeCouncilor
    } = councilor;

    return {
      ...safeCouncilor,
      maskedAttributes: this.sanitizeMaskedAttributes(maskedAttributes)
    };
  }

  sanitizeMaskedAttributes(maskedAttributes) {
    return Object.fromEntries(Object.entries(maskedAttributes || {}).map(([name, value]) => {
      if (!value || typeof value !== 'object') return [name, value];
      const { actual, ...safeValue } = value;
      return [name, safeValue];
    }));
  }

  /**
   * Asserts the player-mode redaction invariants on a filtered snapshot.
   *
   * These are the rules Player Intel mode exists to enforce, so an enhanced or
   * omniscient snapshot is *expected* to fail this check -- it validates the
   * invariants, not the label the snapshot carries.
   */
  assertPlayerSnapshotSafe(snapshot) {
    const leaks = [];
    for (const councilor of snapshot?.councilors || []) {
      if (councilor.isOwnCouncilor || councilor.isTurnedMole) continue;
      if (councilor.attributes && Object.keys(councilor.attributes).length) {
        leaks.push(`${councilor.ID}:attributes`);
      }
      for (const [name, value] of Object.entries(councilor.maskedAttributes || {})) {
        if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'actual')) {
          leaks.push(`${councilor.ID}:maskedAttributes.${name}.actual`);
        }
      }
    }
    if (leaks.length) {
      throw new Error(`Player snapshot contains hidden councilor telemetry: ${leaks.join(', ')}`);
    }

    // Faction-level raw telemetry. Each of these is a raw save field whose
    // derived, redacted twin sits next to it -- the shape of bug that let the
    // observer's own `assessedAlienHateOfMe` reach Player Intel while
    // `alienHate.actual` beside it was correctly null.
    const observerId = snapshot?.observerFactionId;
    const factionLeaks = [];
    for (const faction of snapshot?.factions || []) {
      const isObserver = sameId(faction.ID, observerId);
      // The true hate float is hidden from every faction including the
      // observer's own; the 5-pip estimate on `alienHate` is what the player
      // legitimately knows.
      if (this.toFiniteOrNull(faction.assessedAlienHateOfMe) !== null) {
        factionLeaks.push(`${faction.ID}:assessedAlienHateOfMe`);
      }
      if (faction.alienHate && this.toFiniteOrNull(faction.alienHate.actual) !== null) {
        factionLeaks.push(`${faction.ID}:alienHate.actual`);
      }
      if (isObserver) continue;
      if ((faction.shipDesigns || []).length) {
        factionLeaks.push(`${faction.ID}:shipDesigns[${faction.shipDesigns.length}]`);
      }
      if ((faction.currentProjects || []).length) {
        factionLeaks.push(`${faction.ID}:currentProjects[${faction.currentProjects.length}]`);
      }
      if ((faction.availableProjectNames || []).length) {
        factionLeaks.push(`${faction.ID}:availableProjectNames[${faction.availableProjectNames.length}]`);
      }
      if (Array.isArray(faction.researchWeights)) {
        factionLeaks.push(`${faction.ID}:researchWeights[${faction.researchWeights.length}]`);
      }
      if (this.toFiniteOrNull(faction.availableProjectsCount) !== null) {
        factionLeaks.push(`${faction.ID}:availableProjectsCount`);
      }
      if (this.toFiniteOrNull(faction.researchBreakdown?.habModules) !== null) {
        factionLeaks.push(`${faction.ID}:researchBreakdown.habModules`);
      }
    }
    if (factionLeaks.length) {
      throw new Error(`Player snapshot contains hidden faction telemetry: ${factionLeaks.join(', ')}`);
    }

    if (this.toFiniteOrNull(snapshot?.alienHateEconomics?.actualAlienHate) !== null) {
      throw new Error('Player snapshot contains the raw alien hate: alienHateEconomics.actualAlienHate');
    }
    return true;
  }

  /**
   * The alien faction, matched by display name only.
   *
   * Deliberately NOT `findAlienFaction` from shared/intelResources.mjs, which
   * also accepts ALIEN_FACTION_ID: this is the visibility path, and widening
   * what counts as "the aliens" here widens what a player-mode snapshot
   * publishes. Extracted because the same lookup ran in two methods below.
   */
  resolveAlienFactionId(rawSnapshot) {
    return (rawSnapshot.factions || [])
      .find(f => f.displayName === ALIEN_FACTION_DISPLAY_NAME)?.ID;
  }

  // Identity comparisons in the three methods below stay strict on purpose.
  // They GRANT visibility from the observer's own recorded intel, and every id
  // on both sides comes from the same save-parsing pass, so there is no
  // string/number split to reconcile. Loosening them would publish more in
  // player mode -- the opposite of what the redaction path is for.
  hasIntel(observerIntelligence, id, typeFragment = null) {
    if (id === null || id === undefined) return false;
    return (observerIntelligence.intel || []).some(entry =>
      entry.id === id &&
      (!typeFragment || (entry.typeName || '').includes(typeFragment)) &&
      Number(entry.value || 0) > 0
    );
  }

  knownRegion(observerIntelligence, regionId) {
    if (regionId === null || regionId === undefined) return false;
    return (observerIntelligence.knownAlienSiteRegionIds || []).includes(regionId) ||
      this.hasIntel(observerIntelligence, regionId, 'TIRegionState');
  }

  filterSpaceAssets(rawSnapshot, observerFactionId, observerIntelligence, capabilities, isEnhanced) {
    const alienFactionId = this.resolveAlienFactionId(rawSnapshot);
    const canSeeAlienEverywhere = capabilities.canTrackSolarSystemSpaceAssets;
    const canSeeAlienInnerSystem = capabilities.canTrackInnerSpaceAssets;

    // sameId, not `===`. Note the second-order effect on an alien faction this
    // snapshot does not carry: `alienFactionId` is then undefined, and the old
    // `asset.factionId === alienFactionId` matched every asset with NO owner,
    // publishing unowned assets as alien sightings. sameId treats an absent id
    // as matching nothing, so an unresolvable alien faction now yields no alien
    // sightings rather than a false set of them.
    const visibilityForAsset = (asset, typeFragment) => {
      if (isEnhanced) return { visible: true, source: 'enhanced telemetry' };
      if (sameId(asset.factionId, observerFactionId)) {
        return { visible: true, source: 'own faction' };
      }
      if (sameId(asset.factionId, alienFactionId) && canSeeAlienEverywhere) {
        return { visible: true, source: 'Deep System Skywatch' };
      }
      if (sameId(asset.factionId, alienFactionId) && canSeeAlienInnerSystem && asset.insideSaturnOrbit === true) {
        return { visible: true, source: 'Skywatch' };
      }
      if (this.hasIntel(observerIntelligence, asset.ID ?? asset.id, typeFragment)) {
        return { visible: true, source: 'faction intel' };
      }
      return { visible: false, source: 'not discovered' };
    };

    const fleets = rawSnapshot.fleets
      .map(asset => ({ asset, visibility: visibilityForAsset(asset, 'TISpaceFleetState') }))
      .filter(item => item.visibility.visible)
      .map(item => ({ ...item.asset, visibility: item.visibility.source }));

    const habs = rawSnapshot.habs
      .map(asset => ({ asset, visibility: visibilityForAsset(asset, 'TIHabState') }))
      .filter(item => item.visibility.visible)
      .map(item => ({ ...item.asset, visibility: item.visibility.source }));

    const visibleHabIds = new Set(habs.map(hab => hab.ID));
    const habSites = rawSnapshot.habSites
      .map(site => {
        if (isEnhanced || sameId(site.factionId, observerFactionId) || !site.factionId || visibleHabIds.has(site.habId)) {
          return { site, visible: true, source: isEnhanced ? 'enhanced telemetry' : (site.factionId ? 'own/known hab' : 'unclaimed prospecting data') };
        }
        if (sameId(site.factionId, alienFactionId) && canSeeAlienEverywhere) {
          return { site, visible: true, source: 'Deep System Skywatch' };
        }
        return {
          site,
          visible: this.hasIntel(observerIntelligence, site.ID, 'TIHabSiteState'),
          source: 'faction intel'
        };
      })
      .filter(item => item.visible)
      .map(item => ({ ...item.site, visibility: item.source }));

    return { fleets, habs, habSites };
  }

  filterFactionSpaceMetrics(factions, rawSnapshot, visibleAssets, observerFactionId, capabilities, isEnhanced) {
    const alienFactionId = this.resolveAlienFactionId(rawSnapshot);
    const weights = resolveObserverFaction(rawSnapshot.factions, observerFactionId)?.powerScore?.weights ||
      RUNTIME_CONFIG.analysis.powerScore.weights;
    const hasFullSpaceVisibility = (factionId) =>
      isEnhanced || sameId(factionId, observerFactionId) ||
      (sameId(factionId, alienFactionId) && capabilities.canTrackSolarSystemSpaceAssets);

    const visibleByFaction = (items, factionId) => items.filter(item => sameId(item.factionId, factionId));

    // The faction's headline research figure comes from the save's own income
    // rate and stays visible, but the hab-module component of the breakdown is
    // a module manifest -- exactly what habModules withholds in player mode.
    // Redact it to null (unmeasured), never to zero.
    const redactHabResearch = (breakdown) => (breakdown
      ? { ...breakdown, habModules: null, habModuleCount: null, habModulesUnresolved: null }
      : breakdown);
    // Seeing a faction's habs is not seeing inside them. Deep System Skywatch
    // grants full *space asset* visibility of the aliens, which sent that
    // faction down the early-return below and straight past redactHabResearch
    // -- so player mode published the aliens' hab-module research component
    // while withholding every one of the 502 alien hab modules it is computed
    // from. Enhanced mode publishes the manifest, so it keeps the breakdown.
    const withholdsHabManifest = (factionId) => !isEnhanced && !sameId(factionId, observerFactionId);

    return factions.map(faction => {
      const visibleFleets = visibleByFaction(visibleAssets.fleets, faction.ID);
      const visibleHabs = visibleByFaction(visibleAssets.habs, faction.ID);
      const fullVisibility = hasFullSpaceVisibility(faction.ID);
      const visibleShipCount = visibleFleets.reduce((sum, fleet) => sum + (fleet.shipsCount || 0), 0);
      const visibleCombatPower = visibleFleets.reduce((sum, fleet) => sum + (fleet.combatPower || 0), 0);

      if (fullVisibility) {
        return {
          ...faction,
          researchBreakdown: withholdsHabManifest(faction.ID)
            ? redactHabResearch(faction.researchBreakdown)
            : faction.researchBreakdown,
          spaceVisibility: 'confirmed',
          combatPowerAvailable: faction.combatPowerAvailable
        };
      }

      if (visibleFleets.length === 0 && visibleHabs.length === 0) {
        return {
          ...faction,
          habsCount: null,
          fleetsCount: null,
          shipsCount: null,
          combatPower: null,
          combatPowerAvailable: false,
          researchBreakdown: redactHabResearch(faction.researchBreakdown),
          spaceVisibility: 'unavailable',
          powerScore: { ...faction.powerScore, overall: null, spaceEconomy: null, fleet: null }
        };
      }

      // Known enemy assets are a lower bound, not a complete faction total.
      return {
        ...faction,
        habsCount: visibleHabs.length,
        fleetsCount: visibleFleets.length,
        shipsCount: visibleShipCount,
        combatPower: visibleCombatPower || null,
        combatPowerAvailable: visibleFleets.some(fleet => fleet.combatPowerAvailable),
        researchBreakdown: redactHabResearch(faction.researchBreakdown),
        spaceVisibility: 'partial',
        powerScore: {
          ...faction.powerScore,
          overall: null,
          spaceEconomy: Math.min(100, Math.round((visibleHabs.length / POWER_NORMALIZERS.habs) * 100)),
          fleet: Math.min(100, Math.round((visibleCombatPower / POWER_NORMALIZERS.combatPower) * 100))
        },
        visibilityNote: 'Visible assets only; total faction strength is unknown.'
      };
    });
  }

  filterXenoforming(activeXenoforming, observerIntelligence, capabilities, isEnhanced) {
    if (isEnhanced) return activeXenoforming.map(item => ({ ...item, visibility: 'enhanced telemetry' }));
    if (!capabilities.canDetectXenoforming) return [];

    const threshold = capabilities.xenoformingAutomaticVisibilityThreshold ??
      RUNTIME_CONFIG.analysis.rules.xenoforming.automaticVisibilityThreshold;
    return activeXenoforming
      .filter(item => !capabilities.xenoformingRequiresRegionDiscovery ||
        this.knownRegion(observerIntelligence, item.regionId) ||
        (item.level || 0) >= threshold ||
        this.hasIntel(observerIntelligence, item.id, 'TIRegionXenoformingState'))
      .map(item => ({ ...item, visibility: 'discovered region' }));
  }

  filterAlienFacilities(facilities, observerIntelligence, capabilities, isEnhanced) {
    if (isEnhanced) return facilities.map(item => ({ ...item, visibility: 'enhanced telemetry' }));
    if (!capabilities.canDetectAlienFacilities) return [];

    return facilities
      .filter(item => !capabilities.facilityRequiresRegionDiscovery ||
        this.knownRegion(observerIntelligence, item.regionId) ||
        this.hasIntel(observerIntelligence, item.id, 'TIRegionAlienFacilityState'))
      .map(item => ({ ...item, visibility: 'discovered region' }));
  }
}

module.exports = new IntelligenceFilter();
