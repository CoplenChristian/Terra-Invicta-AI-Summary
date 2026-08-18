const capabilityResolver = require('./capabilityResolver');
const opportunityScorer = require('./opportunityScorer');
const snapshotIdentity = require('./snapshotIdentity');
const {
  ALIEN_FACTION_DISPLAY_NAME,
  INITIATIVE_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME
} = require('../shared/constants.mjs');

class IntelligenceFilter {
  applyFilter(rawSnapshot, mode = 'player', observerFactionId = 4712) {
    const observer = rawSnapshot.factions.find(f => f.ID === observerFactionId) ||
                     rawSnapshot.factions.find(f => f.displayName === INITIATIVE_DISPLAY_NAME) ||
                     rawSnapshot.factions[0];

    const actualObserverId = observer ? observer.ID : observerFactionId;
    const identity = snapshotIdentity.readSnapshotIdentity(rawSnapshot);
    const observerIntelligence = rawSnapshot.factionIntelligence?.[actualObserverId] || {};
    const isEnhanced = mode === 'enhanced';

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
            actual: typeof f.assessedAlienHateOfMe === 'number' ? f.assessedAlienHateOfMe : null,
            playerVisible: true,
            visibleEstimate: typeof f.assessedAlienHateOfMe === 'number'
              ? f.assessedAlienHateOfMe.toFixed(2)
              : 'UNKNOWN',
            visibility: 'raw_save_only'
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
        globalResearch: rawSnapshot.globalResearch,
        activeXenoforming: rawSnapshot.activeXenoforming,
        builtAlienFacilities: rawSnapshot.builtAlienFacilities,
        servantTargets: priorityTargets,
        priorityTargetFaction,
        techMatrix: rawSnapshot.techMatrix,
        isOmniscient: true
      };
    }

    // Gated PLAYER / ENHANCED mode

    // 1. Alien Hate Filtering
    const filteredFactions = rawSnapshot.factions.map(f => {
      let hateObj = null;
      if (capabilities.canEstimateAlienThreat) {
        const val = f.assessedAlienHateOfMe || 0;
        const pips = Math.min(5, Math.max(0, Math.round(val / 10)));
        const pipStr = '■'.repeat(pips) + '□'.repeat(5 - pips);
        hateObj = {
          actual: isEnhanced ? val : null,
          playerVisible: true,
          visibleEstimate: pipStr,
          pips,
          maxPips: 5,
          visibility: isEnhanced ? 'raw_save_only' : 'estimated',
          status: 'available'
        };
      } else {
        hateObj = {
          actual: isEnhanced ? f.assessedAlienHateOfMe : null,
          playerVisible: isEnhanced,
          visibleEstimate: isEnhanced ? (f.assessedAlienHateOfMe || 0).toFixed(2) : 'UNAVAILABLE',
          visibility: isEnhanced ? 'raw_save_only' : 'unavailable',
          status: 'unavailable',
          requiredProject: 'Alien Operations (Project_TheirOperations)'
        };
      }

      // Filter enemy projects if not omniscient
      const isObserver = f.ID === actualObserverId;
      const completedProjs = isObserver ? f.completedProjects : f.completedProjects.slice(0, 5); // Partial visibility for enemy

      const safeFaction = isEnhanced ? f : (({ assessedAlienHateOfMe, ...rest }) => rest)(f);

      return {
        ...safeFaction,
        alienHate: hateObj,
        completedProjects: completedProjs,
        currentProjects: isObserver ? f.currentProjects : []
      };
    });

    // 2. Councilor Intelligence Filtering
    const turnedCouncilorIds = new Set(
      rawSnapshot.councilors.filter(c => c.agentForFactionId === actualObserverId).map(c => c.ID)
    );

    const filteredCouncilors = [];
    let detectedAlienCount = 0;

    for (const c of rawSnapshot.councilors) {
      const isOwnCouncilor = c.factionId === actualObserverId;
      const isTurnedMole = turnedCouncilorIds.has(c.ID) || c.agentForFactionId === actualObserverId;
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
    const alienIntelligenceStage = {
      abductions: {
        active: capabilities.canDetectAlienAbductions,
        name: 'Alien Signatures',
        status: capabilities.canDetectAlienAbductions ? 'AVAILABLE' : 'LOCKED',
        description: 'Detects alien abductions in surveyed regions.'
      },
      contacts: {
        active: capabilities.canDetectAlienHumanContacts,
        name: 'Alien Methods',
        status: capabilities.canDetectAlienHumanContacts ? 'AVAILABLE' : 'LOCKED',
        description: 'Detects alien contacts and enthrall activities with human factions.'
      },
      operations: {
        active: capabilities.canDetectAlienOperations,
        name: 'Alien Operations',
        status: capabilities.canDetectAlienOperations ? 'AVAILABLE' : 'LOCKED',
        description: 'Detects worldwide alien operations and updates the threat meter.'
      },
      operatives: {
        active: capabilities.canDirectlyDetectAlienCouncilors,
        name: 'Alien Movements',
        status: capabilities.canDirectlyDetectAlienCouncilors ? 'AVAILABLE' : 'LOCKED',
        detectedCount: capabilities.canDirectlyDetectAlienCouncilors ? detectedAlienCount : null,
        description: 'Directly detects and tracks individual alien operatives (Hydras).'
      }
    };

    // 4. Tech Matrix Filtering
    const filteredTechMatrix = rawSnapshot.techMatrix.map(row => {
      const filteredFactionsStatus = {};
      for (const [fid, statusObj] of Object.entries(row.factions)) {
        const isObs = parseInt(fid, 10) === actualObserverId;
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
      nations: rawSnapshot.nations,
      councilors: filteredCouncilors,
      fleets: visibleSpaceAssets.fleets,
      habs: visibleSpaceAssets.habs,
      habSites: visibleSpaceAssets.habSites,
      globalResearch: rawSnapshot.globalResearch,
      activeXenoforming: visibleXenoforming,
      builtAlienFacilities: visibleAlienFacilities,
      servantTargets: priorityTargets,
      priorityTargetFaction,
      techMatrix: filteredTechMatrix,
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
        String(relationship.sourceFactionId) === String(observerFactionId))
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
    return true;
  }

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
    const alienFactionId = rawSnapshot.factions.find(f => f.displayName === ALIEN_FACTION_DISPLAY_NAME)?.ID;
    const canSeeAlienEverywhere = capabilities.canTrackSolarSystemSpaceAssets;
    const canSeeAlienInnerSystem = capabilities.canTrackInnerSpaceAssets;

    const visibilityForAsset = (asset, typeFragment) => {
      if (isEnhanced) return { visible: true, source: 'enhanced telemetry' };
      if (asset.factionId === observerFactionId) {
        return { visible: true, source: 'own faction' };
      }
      if (asset.factionId === alienFactionId && canSeeAlienEverywhere) {
        return { visible: true, source: 'Deep System Skywatch' };
      }
      if (asset.factionId === alienFactionId && canSeeAlienInnerSystem && asset.insideSaturnOrbit === true) {
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
        if (isEnhanced || site.factionId === observerFactionId || !site.factionId || visibleHabIds.has(site.habId)) {
          return { site, visible: true, source: isEnhanced ? 'enhanced telemetry' : (site.factionId ? 'own/known hab' : 'unclaimed prospecting data') };
        }
        if (site.factionId === alienFactionId && canSeeAlienEverywhere) {
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
    const alienFactionId = rawSnapshot.factions.find(f => f.displayName === ALIEN_FACTION_DISPLAY_NAME)?.ID;
    const weights = rawSnapshot.factions.find(f => f.ID === observerFactionId)?.powerScore?.weights || {
      earthEconomy: 0.20,
      earthPolitics: 0.15,
      researchPower: 0.20,
      spaceEconomy: 0.15,
      fleetPower: 0.20,
      militaryPower: 0.10
    };
    const hasFullSpaceVisibility = (factionId) =>
      isEnhanced || factionId === observerFactionId ||
      (factionId === alienFactionId && capabilities.canTrackSolarSystemSpaceAssets);

    const visibleByFaction = (items, factionId) => items.filter(item => item.factionId === factionId);

    return factions.map(faction => {
      const visibleFleets = visibleByFaction(visibleAssets.fleets, faction.ID);
      const visibleHabs = visibleByFaction(visibleAssets.habs, faction.ID);
      const fullVisibility = hasFullSpaceVisibility(faction.ID);
      const visibleShipCount = visibleFleets.reduce((sum, fleet) => sum + (fleet.shipsCount || 0), 0);
      const visibleCombatPower = visibleFleets.reduce((sum, fleet) => sum + (fleet.combatPower || 0), 0);

      if (fullVisibility) {
        return {
          ...faction,
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
        spaceVisibility: 'partial',
        powerScore: {
          ...faction.powerScore,
          overall: null,
          spaceEconomy: Math.min(100, Math.round((visibleHabs.length / 20) * 100)),
          fleet: Math.min(100, Math.round((visibleCombatPower / 3000) * 100))
        },
        visibilityNote: 'Visible assets only; total faction strength is unknown.'
      };
    });
  }

  filterXenoforming(activeXenoforming, observerIntelligence, capabilities, isEnhanced) {
    if (isEnhanced) return activeXenoforming.map(item => ({ ...item, visibility: 'enhanced telemetry' }));
    if (!capabilities.canDetectXenoforming) return [];

    const threshold = capabilities.xenoformingAutomaticVisibilityThreshold || 65;
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
