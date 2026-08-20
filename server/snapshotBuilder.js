const templateLoader = require('./templateLoader');
const opportunityScorer = require('./opportunityScorer');
const spaceTheater = require('./spaceTheater');
const { buildCouncilorAttributes } = require('../shared/councilorAttributes.mjs');
const techGraph = require('../shared/techGraph.mjs');

class SnapshotBuilder {
  constructor() {
    templateLoader.load();
  }

  buildRawSnapshot(saveData) {
    const gamestates = saveData.gamestates || {};

    const metaList = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIMetadataState');
    const meta = metaList[0] || {};

    const rawFactions = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIFactionState');
    const rawNations = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TINationState');
    const rawControlPoints = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIControlPoint');
    const rawCouncilors = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TICouncilorState');
    const rawOrgs = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIOrgState');
    const rawHabs = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIHabState');
    const rawHabModules = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIHabModuleState');
    const rawHabSectors = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISectorState');
    const rawHabSites = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIHabSiteState');
    const rawFleets = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISpaceFleetState');
    const rawShips = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISpaceShipState');
    const rawSpaceBodies = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISpaceBodyState');
    const rawOrbits = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIOrbitState');
    const rawRegions = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIRegionState');
    const rawAlienFacilities = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIRegionAlienFacilityState');
    const rawXenoforming = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIRegionXenoformingState');
    const rawGlobalResearch = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIGlobalResearchState');
    const rawMissions = this.getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIMissionState');

    const factionIntelligence = {};
    for (const f of rawFactions) {
      const factionId = f.ID?.value;
      if (factionId) {
        factionIntelligence[factionId] = this.normalizeFactionIntelligence(f);
      }
    }

    // ID Maps
    const factionsById = new Map();
    const factionsByName = new Map();
    for (const f of rawFactions) {
      if (f.ID?.value) {
        factionsById.set(f.ID.value, f);
        factionsByName.set(f.displayName, f);
      }
    }

    const nationsById = new Map();
    for (const n of rawNations) {
      if (n.ID?.value) nationsById.set(n.ID.value, n);
    }

    const habsById = new Map();
    for (const h of rawHabs) {
      if (h.ID?.value) habsById.set(h.ID.value, h);
    }

    const bodiesById = new Map();
    for (const b of rawSpaceBodies) {
      if (b.ID?.value) bodiesById.set(b.ID.value, b);
    }

    const habSectorsById = new Map();
    for (const sector of rawHabSectors) {
      if (sector.ID?.value) habSectorsById.set(sector.ID.value, sector);
    }

    const habModulesById = new Map();
    for (const module of rawHabModules) {
      if (module.ID?.value) habModulesById.set(module.ID.value, module);
    }

    const habModuleLocationById = new Map();
    for (const sector of rawHabSectors) {
      const sectorId = sector.ID?.value || null;
      const habId = sector.hab?.value || null;
      for (const moduleRef of (Array.isArray(sector.habModules) ? sector.habModules : [])) {
        const moduleId = moduleRef?.value ?? moduleRef;
        if (moduleId) habModuleLocationById.set(moduleId, { sectorId, habId, sector });
      }
    }

    const fleetsById = new Map();
    for (const fleet of rawFleets) {
      if (fleet.ID?.value) fleetsById.set(fleet.ID.value, fleet);
    }

    const bodyDistanceAUById = new Map();
    for (const b of rawSpaceBodies) {
      if (!b.ID?.value || !b.globalPosition) continue;
      const p = b.globalPosition;
      const distanceMeters = Math.sqrt((p.x || 0) ** 2 + (p.y || 0) ** 2 + (p.z || 0) ** 2);
      bodyDistanceAUById.set(b.ID.value, distanceMeters / 149597870700);
    }
    const saturnBody = rawSpaceBodies.find(b => b.displayName === 'Saturn');
    const saturnOrbitDistanceAU = saturnBody?.ID?.value
      ? bodyDistanceAUById.get(saturnBody.ID.value) || null
      : null;

    const orbitsById = new Map();
    for (const o of rawOrbits) {
      if (o.ID?.value) orbitsById.set(o.ID.value, o);
    }

    const regionsById = new Map();
    for (const r of rawRegions) {
      if (r.ID?.value) regionsById.set(r.ID.value, r);
    }

    const orgsById = new Map();
    for (const org of rawOrgs) {
      if (org.ID?.value) orgsById.set(org.ID.value, org);
    }

    const missionsById = new Map();
    for (const m of rawMissions) {
      if (m.ID?.value) {
        const targetId = m.target?.value || null;
        let targetName = null;
        if (targetId) {
          targetName = regionsById.get(targetId)?.displayName ||
                       nationsById.get(targetId)?.displayName ||
                       habsById.get(targetId)?.displayName ||
                       null;
        }
        missionsById.set(m.ID.value, {
          id: m.ID.value,
          displayName: m.displayName || m.templateName || 'Assigned Mission',
          templateName: m.templateName,
          targetId,
          targetName,
          outcome: m.missionOutcome || 'In Progress'
        });
      }
    }

    const shipsById = new Map();
    for (const s of rawShips) {
      if (s.ID?.value) shipsById.set(s.ID.value, s);
    }

    // JSON.NET preserves shared ship modules through $id/$ref pairs. Build a
    // local reference index before resolving each ship's weapon loadout.
    const shipModuleRefs = new Map();
    for (const ship of rawShips) {
      this.registerShipModuleRefs(ship, shipModuleRefs);
    }

    const controlPointsById = new Map();
    const controlPointsByNationId = new Map();
    for (const cp of rawControlPoints) {
      if (cp.ID?.value) {
        const cpId = cp.ID.value;
        const factionId = cp.faction?.value || null;
        const nationId = cp.nation?.value || null;
        const isExecutive = !!cp.executive || cp.controlPointType === 'Executive';

        const cpData = {
          id: cpId,
          factionId,
          factionName: factionId ? (factionsById.get(factionId)?.displayName || 'Unknown') : 'Neutral',
          nationId,
          isExecutive,
          controlPointType: cp.controlPointType || 'Standard',
          benefits: cp.benefits || null
        };

        controlPointsById.set(cpId, cpData);
        if (nationId) {
          if (!controlPointsByNationId.has(nationId)) {
            controlPointsByNationId.set(nationId, []);
          }
          controlPointsByNationId.get(nationId).push(cpData);
        }
      }
    }

    // Process Nations
    const nations = [];
    for (const n of rawNations) {
      const nationId = n.ID?.value;
      if (!nationId) continue;

      const cps = controlPointsByNationId.get(nationId) || [];
      const execCp = cps.find(c => c.isExecutive);
      const executiveFactionId = execCp?.factionId || null;
      const executiveFactionName = executiveFactionId ? (factionsById.get(executiveFactionId)?.displayName || 'None') : 'None';

      const gdp = n.GDP || n.gdp || 0;
      const population = n.population || (n.historyPopulation?.length ? n.historyPopulation[n.historyPopulation.length - 1] : 0);
      const boost = n.historyBoost?.length ? n.historyBoost[n.historyBoost.length - 1] : 0;
      const research = n.historyResearch?.length ? n.historyResearch[n.historyResearch.length - 1] : 0;
      const milTech = n.milTech || n.militaryTechLevel || 0;
      const democracy = n.democracy || 0;
      const cohesion = n.cohesion || 0;
      const unrest = n.unrest || 0;
      const nukes = n.nuclearWeapons || n.nukes || (n.historyNuclearWeapons?.length ? n.historyNuclearWeapons[n.historyNuclearWeapons.length - 1] : 0);
      const armies = Array.isArray(n.armies) ? n.armies.length : 0;
      const currentMissionControl = Number(n.missionControl);
      const mc = Number.isFinite(currentMissionControl)
        ? currentMissionControl
        : this.lastFiniteNumber(n.historyMissionControl);

      nations.push({
        ID: nationId,
        displayName: n.displayName,
        templateName: n.templateName,
        GDP: gdp,
        population,
        boost,
        research,
        milTech,
        democracy,
        cohesion,
        unrest,
        nukes,
        armies,
        missionControl: mc,
        controlPoints: cps,
        executiveFactionId,
        executiveFactionName,
        regionsCount: Array.isArray(n.regions) ? n.regions.length : 0
      });
    }

    // Process Councilors
    // Built once for the whole roster rather than per councilor.
    const traitStatMods = this.buildTraitStatMods();
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

      const isAlien = !!(c.typeTemplateName && c.typeTemplateName.toLowerCase().includes('alien')) || factionName === 'the Aliens';

      const locationId = c.location?.value || c.location || null;
      const locationRegion = locationId ? regionsById.get(locationId) : null;
      const locationHab = locationId ? habsById.get(locationId) : null;
      const locationName = locationRegion ? locationRegion.displayName : (locationHab ? locationHab.displayName : 'In Transit / Orbit');
      const locationType = locationRegion ? 'Earth Region' : (locationHab ? (locationHab.habType || 'Station / Base') : 'In Transit');

      const homeRegionId = c.homeRegion?.value || null;
      const homeRegionName = homeRegionId ? (regionsById.get(homeRegionId)?.displayName || 'Unknown') : 'Unknown';

      const agentForFactionId = c.agentForFaction?.value || null;
      const agentForFactionName = agentForFactionId ? (factionsById.get(agentForFactionId)?.displayName || null) : null;

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

    // Process Space Fleets
    const fleets = [];
    for (const f of rawFleets) {
      const fleetId = f.ID?.value;
      if (!fleetId) continue;

      const factionId = f.faction?.value || null;
      const factionName = factionId ? (factionsById.get(factionId)?.displayName || 'Unknown') : 'Unknown';

      const shipRefs = Array.isArray(f.ships) ? f.ships : [];
      const shipList = [];
      let totalCombatPower = 0;
      let combatPowerAvailable = false;
      const fleetWeaponCounts = new Map();

      for (const sr of shipRefs) {
        const sId = sr.value || sr;
        const sObj = shipsById.get(sId);
        if (sObj) {
          const power = this.readShipCombatPower(sObj);
          if (power !== null) {
            totalCombatPower += power;
            combatPowerAvailable = true;
          }
          const weaponLoadout = this.buildWeaponLoadout(sObj, shipModuleRefs);
          for (const entry of weaponLoadout) {
            fleetWeaponCounts.set(entry.role, (fleetWeaponCounts.get(entry.role) || 0) + entry.count);
          }

          shipList.push({
            id: sId,
            displayName: sObj.displayName,
            hullName: sObj.hullTemplateName || sObj.templateName,
            combatPower: power,
            combatPowerSource: power === null ? 'not present in save' : 'save',
            weaponLoadout,
            dominantWeaponType: this.getDominantWeaponType(weaponLoadout),
            currentDeltaVKps: this.firstNumericOrNull(sObj.currentDeltaV_kps),
            currentMaxDeltaVKps: this.firstNumericOrNull(sObj.currentMaxDeltaV_kps),
            cruiseAccelerationMps2: this.firstNumericOrNull(sObj.cruiseAcceleration_mps2),
            combatAccelerationMps2: this.firstNumericOrNull(sObj.combatAcceleration_mps2),
            currentMassKg: this.firstNumericOrNull(sObj.currentMass_kg),
            missionControlConsumption: this.firstNumericOrNull(sObj.missionControlConsumption),
            propellantTons: this.firstNumericOrNull(sObj.propellant_tons),
            armor: this.normalizeArmor(sObj.armor),
            armorMedian: this.medianArmor(sObj.armor)
          });
        }
      }

      const orbitBody = this.resolveOrbitBody(f, bodiesById, orbitsById);
      const theater = spaceTheater.theaterForBody(orbitBody);
      const orbitBodyDistanceAU = this.resolveOrbitBodyDistanceAU(f, bodiesById, orbitsById, bodyDistanceAUById);
      const trajectory = f.trajectory || null;
      const fleetWeaponBreakdown = this.summarizeWeaponCounts(fleetWeaponCounts);
      const destination = this.resolveFleetDestination(trajectory, fleetsById, habsById, bodiesById, orbitsById);
      const arrivalDate = this.dateValueToIso(trajectory?.arrivalTime || null);
      const shipDeltaVs = shipList.map(ship => ship.currentDeltaVKps).filter(value => value !== null);
      const shipCombatAccelerations = shipList.map(ship => ship.combatAccelerationMps2).filter(value => value !== null);
      const shipArmorMedians = shipList.map(ship => ship.armorMedian).filter(value => value !== null);

      fleets.push({
        ID: fleetId,
        displayName: f.displayName,
        factionId,
        factionName,
        shipsCount: shipRefs.length,
        ships: shipList,
        combatPower: combatPowerAvailable ? Math.round(totalCombatPower) : null,
        combatPowerAvailable,
        combatPowerSource: combatPowerAvailable ? 'save' : 'not present in save',
        weaponBreakdown: fleetWeaponBreakdown,
        dominantWeaponType: this.getDominantWeaponType(fleetWeaponBreakdown),
        weaponSummary: this.formatWeaponSummary(fleetWeaponBreakdown),
        orbitBody,
        spaceTheaterKey: theater.key,
        spaceTheaterName: theater.name,
        orbitBodyDistanceAU,
        insideSaturnOrbit: saturnOrbitDistanceAU !== null && orbitBodyDistanceAU !== null
          ? orbitBodyDistanceAU <= saturnOrbitDistanceAU + 0.25
          : null,
        mission: f.currentOperations?.[0]?.templateName || (f.inCombat ? 'Combat' : (trajectory ? 'Transfer' : 'Stationary / Patrol')),
        destination: destination.name,
        destinationType: destination.type,
        destinationId: destination.id,
        arrivalDate,
        currentOrders: {
          mission: f.currentOperations?.[0]?.templateName || null,
          destination: destination.name,
          arrivalDate,
          inTransit: Boolean(trajectory)
        },
        lowestDeltaVKps: shipDeltaVs.length ? Math.min(...shipDeltaVs) : null,
        lowestCombatAccelerationMps2: shipCombatAccelerations.length ? Math.min(...shipCombatAccelerations) : null,
        armorMedian: shipArmorMedians.length ? this.roundNumber(shipArmorMedians.reduce((sum, value) => sum + value, 0) / shipArmorMedians.length, 2) : null,
        inCombat: !!f.inCombat
      });
    }

    // Process Habs
    const habs = [];
    for (const h of rawHabs) {
      const habId = h.ID?.value;
      if (!habId) continue;

      const factionId = h.faction?.value || null;
      const factionName = factionId ? (factionsById.get(factionId)?.displayName || 'Unknown') : 'Unknown';
      const orbitBody = this.resolveOrbitBody(h, bodiesById, orbitsById);
      const theater = spaceTheater.theaterForBody(orbitBody);
      const orbitBodyDistanceAU = this.resolveOrbitBodyDistanceAU(h, bodiesById, orbitsById, bodyDistanceAUById);

      habs.push({
        ID: habId,
        displayName: h.displayName,
        factionId,
        factionName,
        habType: h.habType || 'Station',
        tier: h.tier || 1,
        orbitBody,
        spaceTheaterKey: theater.key,
        spaceTheaterName: theater.name,
        orbitBodyDistanceAU,
        insideSaturnOrbit: saturnOrbitDistanceAU !== null && orbitBodyDistanceAU !== null
          ? orbitBodyDistanceAU <= saturnOrbitDistanceAU + 0.25
          : null,
        inEarthLEO: !!h.inEarthLEO,
        templateName: h.templateName || h.habSchematicTemplateName,
        inCombat: !!h.inCombat,
        underAssault: !!h.underAssault,
        underBombardment: !!h.underBombardment
      });
    }

    // Process Hab Sites & Mining Deposits
    const habSites = [];
    for (const hs of rawHabSites) {
      const siteId = hs.ID?.value;
      if (!siteId) continue;

      const parentBodyId = hs.parentBody?.value || null;
      const parentBody = parentBodyId ? bodiesById.get(parentBodyId) : null;
      const parentBodyName = parentBody ? parentBody.displayName : 'Unknown';
      const theater = spaceTheater.theaterForBody(parentBodyName);

      const habId = hs.hab?.value || null;
      const hab = habId ? rawHabs.find(x => x.ID?.value === habId) : null;
      const factionId = hab?.faction?.value || null;
      const factionName = factionId ? (factionsById.get(factionId)?.displayName || 'Unclaimed') : 'Unclaimed';

      // Mining state lives on the hab's sector/module records. Resolve the
      // active mining complex so the API can distinguish an operational mine
      // from one still under construction and report its actual tier.
      const miningModules = [];
      for (const sectorRef of (Array.isArray(hab?.sectors) ? hab.sectors : [])) {
        const sectorId = sectorRef?.value ?? sectorRef;
        const sector = habSectorsById.get(sectorId);
        for (const moduleRef of (Array.isArray(sector?.habModules) ? sector.habModules : [])) {
          const moduleId = moduleRef?.value ?? moduleRef;
          const module = habModulesById.get(moduleId);
          if (!module) continue;

          const moduleTemplate = module.templateName
            ? templateLoader.templates.habModules.get(module.templateName)
            : null;
          const isMiningModule = moduleTemplate?.mine === true ||
            /mining/i.test(module.templateName || module.displayName || '');
          if (isMiningModule) {
            miningModules.push({ module, moduleTemplate });
          }
        }
      }

      miningModules.sort((a, b) =>
        (b.moduleTemplate?.tier || b.module.tier || 0) -
        (a.moduleTemplate?.tier || a.module.tier || 0)
      );
      const miningModule = miningModules[0] || null;
      const module = miningModule?.module;
      const moduleTemplate = miningModule?.moduleTemplate;
      const completionDate = module?.completionDate || null;
      const gameDate = saveData.gameTimeString ? new Date(saveData.gameTimeString) : null;
      const moduleCompletion = completionDate ? new Date(completionDate) : null;
      const hasValidDates = gameDate && !Number.isNaN(gameDate.getTime()) &&
        moduleCompletion && !Number.isNaN(moduleCompletion.getTime());

      let constructionStatus = 'not-installed';
      if (module) {
        if (module.destroyed) constructionStatus = 'destroyed';
        else if (module.decommissioning) constructionStatus = 'decommissioning';
        else if (module.constructionCompleted) constructionStatus = 'operational';
        else constructionStatus = 'building';
      } else if (hs.pendingHab) {
        constructionStatus = 'pending-hab';
      }

      const daysRemaining = constructionStatus === 'building' && hasValidDates
        ? Math.max(0, Math.round(((moduleCompletion - gameDate) / 86400000) * 10) / 10)
        : constructionStatus === 'operational' ? 0 : null;

      // Join the site's mining profile from the game templates. The save omits
      // it on unclaimed sites, but it is what determines yields -- without it
      // an expansion-target ranking cannot tell a genuinely rich site from one
      // of the ~95 that share the generic Common Carbonaceous profile.
      const siteTemplate = templateLoader.templates.habSites.get(hs.templateName)
        || templateLoader.templates.habSites.get(hs.displayName)
        || null;

      habSites.push({
        ID: siteId,
        displayName: hs.displayName,
        miningProfileName: siteTemplate?.miningProfileName || null,
        siteDensity: siteTemplate?.Density ?? null,
        parentBodyId,
        parentBodyName,
        spaceTheaterKey: theater.key,
        spaceTheaterName: theater.name,
        habId,
        factionId,
        factionName,
        habName: hab?.displayName || null,
        habTier: hab?.tier || null,
        pendingHab: !!hs.pendingHab,
        mineModuleId: module?.ID?.value || null,
        mineModuleTemplate: module?.templateName || null,
        mineModuleName: module?.displayName || null,
        mineTier: moduleTemplate?.tier || module?.tier || null,
        constructionStatus,
        constructionCompleted: module?.constructionCompleted ?? null,
        completionDate,
        startBuildDate: module?.startBuildDate || null,
        buildDurationDays: module?.baseBuildDuration_days ?? moduleTemplate?.buildTime_Days ?? null,
        daysRemaining,
        // Current saves store production as *_day. Keep legacy aliases as
        // fallbacks for older save formats.
        water: this.firstNumeric(hs.water_day, hs.water, hs.waterDailyRate),
        volatiles: this.firstNumeric(hs.volatiles_day, hs.volatiles, hs.volatilesDailyRate),
        metals: this.firstNumeric(hs.metals_day, hs.metals, hs.metalsDailyRate),
        nobleMetals: this.firstNumeric(hs.nobles_day, hs.nobleMetals, hs.nobleMetalsDailyRate),
        fissiles: this.firstNumeric(hs.fissiles_day, hs.fissiles, hs.fissilesDailyRate),
        resourceRateUnit: 'per day'
      });
    }

    // Process hab module detail and shipyard queues. The save stores these as
    // separate sector/module records, so join them back to the owning hab
    // before exposing them through the focused API.
    const habModules = [];
    const shipyardCountByFaction = new Map();
    const habModuleRowsById = new Map();
    for (const module of rawHabModules) {
      const moduleId = module.ID?.value;
      if (!moduleId || module.archived) continue;
      const template = module.templateName
        ? templateLoader.templates.habModules.get(module.templateName)
        : null;
      if (!module.templateName && !module.displayName) continue;

      const location = habModuleLocationById.get(moduleId);
      const hab = location?.habId ? habs.find(item => item.ID === location.habId) : null;
      const factionId = hab?.factionId || null;
      const factionName = factionId ? (factionsById.get(factionId)?.displayName || 'Unknown') : null;
      const constructionStatus = this.moduleConstructionStatus(module);
      const moduleType = this.classifyHabModule(module, template);
      const completionDate = this.dateValueToIso(module.completionDate);
      const startBuildDate = this.dateValueToIso(module.startBuildDate);
      const moduleCompletion = completionDate ? new Date(completionDate) : null;
      const gameDate = saveData.gameTimeString ? new Date(saveData.gameTimeString) : null;
      const daysRemaining = constructionStatus === 'building' && gameDate && moduleCompletion &&
        !Number.isNaN(gameDate.getTime()) && !Number.isNaN(moduleCompletion.getTime())
        ? Math.max(0, this.roundNumber((moduleCompletion - gameDate) / 86400000, 1))
        : constructionStatus === 'operational' ? 0 : null;
      const isShipyard = template?.allowsShipConstruction === true ||
        (Array.isArray(template?.specialRules) && template.specialRules.includes('Shipyard'));

      const row = {
        id: moduleId,
        name: template?.friendlyName || module.displayName || module.templateName,
        templateName: module.templateName || null,
        moduleType,
        factionId,
        factionName,
        habId: hab?.ID || null,
        habName: hab?.displayName || null,
        habTier: hab?.tier || null,
        sectorId: location?.sectorId || null,
        sectorNumber: location?.sector?.sectorNum ?? null,
        orbitBody: hab?.orbitBody || null,
        spaceTheaterKey: hab?.spaceTheaterKey || null,
        spaceTheaterName: hab?.spaceTheaterName || null,
        isShipyard,
        constructionStatus,
        constructionCompleted: module.constructionCompleted ?? null,
        powered: module.powered ?? null,
        destroyed: module.destroyed ?? false,
        decommissioning: module.decommissioning ?? false,
        completionDate,
        startBuildDate,
        buildDurationDays: module.baseBuildDuration_days ?? template?.buildTime_Days ?? null,
        daysRemaining,
        buildCost: this.normalizeResourceCosts(module.buildCost)
      };
      habModules.push(row);
      habModuleRowsById.set(moduleId, row);
      if (isShipyard && constructionStatus !== 'destroyed' && factionId) {
        shipyardCountByFaction.set(factionId, (shipyardCountByFaction.get(factionId) || 0) + 1);
      }
    }

    const shipyardQueues = [];
    for (const rawFaction of rawFactions) {
      const factionId = rawFaction.ID?.value;
      if (!factionId || !Array.isArray(rawFaction.nShipyardQueues)) continue;
      for (const queue of rawFaction.nShipyardQueues) {
        const shipyardId = queue?.Key?.value ?? queue?.Key ?? null;
        const shipyard = shipyardId ? habModuleRowsById.get(shipyardId) : null;
        const entries = Array.isArray(queue?.Value) ? queue.Value : [];
        entries.forEach((entry, index) => {
          const startDate = this.dateValueToIso(entry?.startDate);
          const daysToCompletion = this.firstNumericOrNull(entry?.daysToCompletion);
          const completionDate = startDate && daysToCompletion !== null
            ? new Date(new Date(startDate).getTime() + daysToCompletion * 86400000).toISOString()
            : null;
          shipyardQueues.push({
            id: `${factionId}:${shipyardId || 'unknown'}:${index}`,
            factionId,
            factionName: factionsById.get(factionId)?.displayName || 'Unknown',
            shipyardId,
            shipyardName: shipyard?.name || null,
            habId: shipyard?.habId || null,
            habName: shipyard?.habName || null,
            orbitBody: shipyard?.orbitBody || null,
            spaceTheaterKey: shipyard?.spaceTheaterKey || null,
            spaceTheaterName: shipyard?.spaceTheaterName || null,
            queuePosition: index + 1,
            design: entry?.shipDesignTemplateName || null,
            hull: entry?.shipDesignTemplateName || null,
            isRefit: entry?.isRefit === true,
            costPaid: entry?.costPaid === true,
            constructionStatus: entry?.costPaid === true ? 'building' : 'queued',
            startDate,
            completionDate,
            daysToCompletion,
            resourcesCost: this.normalizeResourceCosts(entry?.resourcesCost),
            resourcesRefund: this.normalizeResourceCosts(entry?.resourcesRefund),
            aiGoalId: entry?.AIFactionGoal?.value || null,
            aiGoalType: entry?.AIFactionGoal?.$type || null
          });
        });
      }
    }

    const resourceTransfers = [];
    for (const rawFaction of rawFactions) {
      const sourceFactionId = rawFaction.ID?.value;
      const transferList = Array.isArray(rawFaction.dailyResourceTransfers)
        ? rawFaction.dailyResourceTransfers
        : [];
      transferList.forEach((entry, index) => {
        const targetFactionId = entry?.targetFaction?.value || null;
        const resource = entry?.transfer?.resource || null;
        const amountPerDay = this.firstNumericOrNull(entry?.transfer?.value);
        if (!sourceFactionId || !targetFactionId || !resource || amountPerDay === null) return;
        resourceTransfers.push({
          id: `${sourceFactionId}:${targetFactionId}:${resource}:${index}`,
          sourceFactionId,
          sourceFactionName: factionsById.get(sourceFactionId)?.displayName || 'Unknown',
          targetFactionId,
          targetFactionName: factionsById.get(targetFactionId)?.displayName || 'Unknown',
          resource,
          amountPerDay: this.roundNumber(amountPerDay, 3),
          expiry: this.dateValueToIso(entry?.expiry)
        });
      });
    }

    const shipyardStations = habModules
      .filter(module => module.isShipyard)
      .map(station => {
        const queue = shipyardQueues.filter(item => item.shipyardId === station.id);
        return {
          ...station,
          queueCount: queue.length,
          currentConstruction: queue[0] || null,
          queue
        };
      });

    // Process Global Research
    const globalResearchObj = rawGlobalResearch[0] || {};
    const finishedTechsNames = Array.isArray(globalResearchObj.finishedTechsNames) ? globalResearchObj.finishedTechsNames : [];
    const techProgress = Array.isArray(globalResearchObj.techProgress) ? globalResearchObj.techProgress : [];

    const activeGlobalSlots = techProgress.map((slot, index) => {
      const techTemplate = templateLoader.getTech(slot.techTemplateName);
      const totalCost = techTemplate?.researchCost || 10000;
      const accumulated = slot.accumulatedResearch || 0;
      const percent = Math.min(100, Math.round((accumulated / totalCost) * 1000) / 10);

      const contributions = [];
      let leadFactionId = null;
      let maxContribution = -1;

      if (Array.isArray(slot.factionContributions)) {
        for (const fc of slot.factionContributions) {
          const fid = fc.Key?.value || fc.Key;
          const val = fc.Value || 0;
          const fname = factionsById.get(fid)?.displayName || 'Unknown';
          contributions.push({ factionId: fid, factionName: fname, contribution: Math.round(val) });
          if (val > maxContribution) {
            maxContribution = val;
            leadFactionId = fid;
          }
        }
      }

      contributions.sort((a, b) => b.contribution - a.contribution);

      return {
        slotNumber: index + 1,
        techId: slot.techTemplateName,
        displayName: techTemplate?.friendlyName || slot.techTemplateName,
        category: techTemplate?.techCategory || 'General',
        accumulatedResearch: Math.round(accumulated),
        totalCost,
        percent,
        contributions,
        leadFactionId,
        leadFactionName: leadFactionId ? (factionsById.get(leadFactionId)?.displayName || 'None') : 'None',
        leadContribution: Math.round(maxContribution)
      };
    });

    // Process Factions Summary & Power Scores
    const factions = [];
    const scoreWeights = templateLoader.config.powerScoreWeights || {
      earthEconomy: 0.20,
      earthPolitics: 0.15,
      researchPower: 0.20,
      spaceEconomy: 0.15,
      fleetPower: 0.20,
      militaryPower: 0.10
    };

    // FactionHate is stored as a per-faction map in the save. Preserve it as
    // an explicit, shallow relationship list so observer-relative screens can
    // explain faction posture without exposing the raw save structure.
    const factionRelationships = [];
    for (const source of rawFactions) {
      const sourceFactionId = source.ID?.value;
      if (!sourceFactionId || !Array.isArray(source.factionHate)) continue;
      for (const entry of source.factionHate) {
        const targetFactionId = entry?.Key?.value ?? entry?.Key?.Value ?? entry?.key?.value ?? entry?.key;
        const hate = entry?.Value ?? entry?.value;
        if (!targetFactionId || typeof hate !== 'number' || !Number.isFinite(hate)) continue;
        const target = rawFactions.find(f => f.ID?.value === targetFactionId);
        if (!target) continue;
        const roundedHate = Math.round(hate * 100) / 100;
        factionRelationships.push({
          sourceFactionId,
          sourceFactionName: source.displayName,
          targetFactionId,
          targetFactionName: target.displayName,
          hate: roundedHate,
          relationship: `HATE ${roundedHate.toFixed(2)}`,
          visibility: 'raw_save_only'
        });
      }
    }

    for (const f of rawFactions) {
      const factionId = f.ID?.value;
      if (!factionId) continue;

      const fCouncilors = councilors.filter(c => c.factionId === factionId);
      const fHabs = habs.filter(h => h.factionId === factionId);
      const fFleets = fleets.filter(fl => fl.factionId === factionId);
      const fShipsCount = fFleets.reduce((acc, fl) => acc + fl.shipsCount, 0);
      const fCombatPowerValues = fFleets
        .map(fl => fl.combatPower)
        .filter(value => typeof value === 'number' && Number.isFinite(value));
      const fCombatPower = fCombatPowerValues.length > 0
        ? Math.round(fCombatPowerValues.reduce((acc, value) => acc + value, 0))
        : null;

      // Controlled CPs and Nations
      const fCPs = Array.from(controlPointsById.values()).filter(cp => cp.factionId === factionId);
      const fNationIds = new Set(fCPs.map(cp => cp.nationId).filter(Boolean));
      const fNations = nations.filter(n => fNationIds.has(n.ID));
      const totalGdp = fNations.reduce((acc, n) => acc + (n.GDP || 0), 0);
      const totalPop = fNations.reduce((acc, n) => acc + (n.population || 0), 0);
      const totalBoost = fNations.reduce((acc, n) => acc + (n.boost || 0), 0);
      const totalResearch = fNations.reduce((acc, n) => acc + (n.research || 0), 0);
      const recent30DayFlow = this.summarizeRecentTransactions(f.Transactions, saveData.gameTimeString, 30);
      const projectedMonthlyIncome = this.scaleResourceMap(f.cachedYearlyRevenue, 1 / 12);
      const monthlyIncome = recent30DayFlow.income;
      const monthlyExpense = recent30DayFlow.expense;
      const monthlyNet = recent30DayFlow.net;

      // Power Score Components (0-100 scales)
      const earthEconomyScore = Math.min(100, Math.round((totalGdp / 40e12) * 100));
      const earthPoliticsScore = Math.min(100, Math.round((fCPs.length / 50) * 100));
      const researchPowerScore = Math.min(100, Math.round((totalResearch / 5000) * 100));
      const spaceEconomyScore = Math.min(100, Math.round((fHabs.length / 20) * 100));
      const fleetPowerScore = fCombatPower === null
        ? null
        : Math.min(100, Math.round((fCombatPower / 3000) * 100));
      const militaryPowerScore = Math.min(100, Math.round((fNations.reduce((acc, n) => acc + (n.nukes || 0), 0) * 20)));

      const scoreComponents = [
        [earthEconomyScore, scoreWeights.earthEconomy],
        [earthPoliticsScore, scoreWeights.earthPolitics],
        [researchPowerScore, scoreWeights.researchPower],
        [spaceEconomyScore, scoreWeights.spaceEconomy],
        [fleetPowerScore, scoreWeights.fleetPower],
        [militaryPowerScore, scoreWeights.militaryPower]
      ].filter(([value, weight]) => typeof value === 'number' && Number.isFinite(value) && Number(weight) > 0);
      const totalScoreWeight = scoreComponents.reduce((sum, [, weight]) => sum + Number(weight), 0);
      const overallPower = totalScoreWeight > 0
        ? Math.round(scoreComponents.reduce((sum, [value, weight]) => sum + value * Number(weight), 0) / totalScoreWeight)
        : null;

      const completedProjects = Array.isArray(f.finishedProjectNames) ? f.finishedProjectNames : [];
      const availableProjects = Array.isArray(f.availableProjectNames) ? f.availableProjectNames : [];

      const currentProjects = (Array.isArray(f.currentProjectProgress) ? f.currentProjectProgress : []).map(p => {
        const projT = templateLoader.getProject(p.projectTemplateName);
        const cost = projT?.researchCost || 5000;
        const acc = p.accumulatedResearch || 0;
        return {
          projectId: p.projectTemplateName,
          displayName: projT?.friendlyName || p.projectTemplateName,
          accumulatedResearch: Math.round(acc),
          totalCost: cost,
          percent: Math.min(100, Math.round((acc / cost) * 1000) / 10)
        };
      });

      const fShipDesigns = (Array.isArray(f.shipDesigns) ? f.shipDesigns : []).map(d => ({
        ...d,
        factionId,
        factionName: f.displayName
      }));

      factions.push({
        ID: factionId,
        displayName: f.displayName,
        templateName: f.templateName,
        color: this.getFactionColor(f.displayName),
        resources: this.roundResourceMap(f.resources),
        monthlyIncome,
        monthlyExpense,
        monthlyNet,
        financials: {
          monthlyIncome,
          monthlyExpense,
          monthlyNet,
          monthlyFlowSource: 'last 30 days of the save transaction ledger',
          isRecurringEstimate: false,
          projectedMonthlyIncome,
          projectedMonthlyIncomeSource: 'cachedYearlyRevenue / 12',
          recent30Days: recent30DayFlow
        },
        assessedAlienHateOfMe: f.assessedAlienHateOfMe ?? 0,
        controlPointsCount: fCPs.length,
        nationsCount: fNations.length,
        totalGdp,
        totalPopulation: totalPop,
        totalBoost,
        totalResearch,
        habsCount: fHabs.length,
        fleetsCount: fFleets.length,
        shipsCount: fShipsCount,
        combatPower: fCombatPower,
        combatPowerAvailable: fFleets.some(fl => fl.combatPowerAvailable),
        councilorsCount: fCouncilors.length,
        powerScore: {
          overall: overallPower,
          earthEconomy: earthEconomyScore,
          earthPolitics: earthPoliticsScore,
          research: researchPowerScore,
          spaceEconomy: spaceEconomyScore,
          fleet: fleetPowerScore,
          military: militaryPowerScore,
          isEstimate: true,
          weights: scoreWeights
        },
        completedProjects,
        currentProjects,
        availableProjectsCount: availableProjects.length,
        availableProjectNames: availableProjects,
        missionControlUsage: Number.isFinite(Number(f.missionControlUsage)) ? Number(f.missionControlUsage) : null,
        // Mission Control capacity is useful context, but it is deliberately
        // kept separate from missionControlUsage because only used MC affects
        // the alien minimum-hate floor.
        missionControlCapacity: fNations.length
          ? fNations.reduce((sum, nation) => sum + (Number(nation.missionControl) || 0), 0)
          : null,
        shipyardCount: shipyardCountByFaction.get(factionId) || 0,
        shipyardQueueCount: shipyardQueues.filter(queue => queue.factionId === factionId).length,
        shipDesigns: fShipDesigns
      });
    }

    const allShipDesigns = [];
    for (const f of rawFactions) {
      const factionId = f.ID?.value;
      if (!factionId) continue;
      const rawDesigns = Array.isArray(f.shipDesigns) ? f.shipDesigns : [];
      for (const d of rawDesigns) {
        allShipDesigns.push({
          ...d,
          factionId,
          factionName: f.displayName
        });
      }
    }

    // Active Xenoforming and Alien Facilities
    const activeXenoforming = [];
    for (const x of rawXenoforming) {
      if ((x.xenoformingLevel || 0) > 0) {
        const regionId = x.region?.value;
        const reg = regionId ? regionsById.get(regionId) : null;
        activeXenoforming.push({
          id: x.ID?.value,
          regionId,
          regionName: reg?.displayName || 'Unknown Region',
          level: Math.round((x.xenoformingLevel || 0) * 10) / 10
        });
      }
    }

    const builtAlienFacilities = [];
    for (const af of rawAlienFacilities) {
      if (af.built || (af.currentHP || 0) > 0) {
        const regionId = af.region?.value;
        const reg = regionId ? regionsById.get(regionId) : null;
        builtAlienFacilities.push({
          id: af.ID?.value,
          regionId,
          regionName: reg?.displayName || 'Unknown Region',
          currentHP: af.currentHP || 100
        });
      }
    }

    // Seed a default target list for consumers that do not have an observer
    // context yet. The API filter recomputes this for the selected observer.
    const defaultObserverName = templateLoader.config.defaultObserverFaction || 'the Initiative';
    const defaultObserver = factions.find(f => f.displayName === defaultObserverName) || factions[0];
    const defaultPriorityTarget = defaultObserver
      ? opportunityScorer.selectPriorityTargetFaction(factions, nations, defaultObserver.ID)
      : null;
    const servantTargets = defaultObserver && defaultPriorityTarget
      ? opportunityScorer.evaluateCampaignTargets(
        nations,
        controlPointsByNationId,
        defaultObserver.ID,
        defaultPriorityTarget.id,
        defaultPriorityTarget.name
      )
      : [];

    // Key Tech Matrix (Selected strategic projects across all factions)
    const keyProjects = [
      'Project_TheirSignatures',
      'Project_TheirMethods',
      'Project_TheirOperations',
      'Project_TheirMovements',
      'Project_AlienAdministrationTransitionTeam',
      'Project_BurnerDrive',
      'Project_FleetCombatants',
      'Project_ShipsoftheLine',
      'Project_TitanicSpacecraft',
      'Project_CoilCannon',
      'Project_RailCannonMk2',
      'Project_PointDefenseIonBattery',
      'Project_PhasedArrayLasers',
      'Project_ProtiumConverterTorch'
    ];

    const techMatrix = keyProjects.map(projId => {
      const projTemplate = templateLoader.getProject(projId);
      const row = {
        projectId: projId,
        displayName: projTemplate?.friendlyName || projId,
        category: projTemplate?.projectCategory || 'Special',
        effects: projTemplate?.effects || [],
        factions: {}
      };

      for (const f of factions) {
        const rawF = rawFactions.find(rf => rf.ID?.value === f.ID);
        const finished = (rawF?.finishedProjectNames || []).includes(projId);
        const current = (rawF?.currentProjectProgress || []).some(cp => cp.projectTemplateName === projId);
        const available = (rawF?.availableProjectNames || []).includes(projId);

        let status = 'locked';
        if (finished) status = 'completed';
        else if (current) status = 'researching';
        else if (available) status = 'available';

        row.factions[f.ID] = {
          factionName: f.displayName,
          status
        };
      }
      return row;
    });

    return {
      metadata: {
        fileName: saveData.fileName,
        fileSizeBytes: saveData.fileSizeBytes,
        lastModified: saveData.lastModified,
        gameTimeString: saveData.gameTimeString,
        difficulty: saveData.difficulty,
        campaignStartYear: saveData.campaignStartYear
      },
      factions,
      factionRelationships,
      nations,
      councilors,
      fleets,
      habs,
      habSites,
      habModules,
      shipyardStations,
      shipyardQueues,
      shipDesigns: allShipDesigns,
      resourceTransfers,
      globalResearch: {
        finishedTechsNames,
        activeSlots: activeGlobalSlots
      },
      factionIntelligence,
      activeXenoforming,
      builtAlienFacilities,
      servantTargets,
      priorityTargetFaction: defaultPriorityTarget,
      spaceDetection: {
        saturnOrbitDistanceAU,
        skywatchRule: templateLoader.config.intelligenceRules?.spaceAssets?.innerSystemDescription || null,
        deepSystemSkywatchRule: templateLoader.config.intelligenceRules?.spaceAssets?.deepSystemDescription || null
      },
      techMatrix,
      shipHullStats: this.buildShipHullStats(),
      techTree: this.buildTechTree(saveData, finishedTechsNames, activeGlobalSlots, factions)
    };
  }

  // Per-hull Mission Control cost, construction tier and base build time,
  // read from the installed game templates. Mission Control is the sole input
  // to the alien minimum-hate floor, so a flat per-design guess makes any
  // "what does this fleet do to my hate" projection wrong. Exposed on the
  // snapshot because shared/intelResources.mjs must stay free of runtime
  // (fs-backed) imports so the hosted worker can import it too.
  // Attribute modifiers granted by councilor traits, from the game templates.
  // The augmentation/implant lines are the significant ones (ExecutiveAI +3
  // Administration, CognitiveEnhancer +3 Science). Conditional and overriding
  // mods are carried through with flags so the consumer can report them as
  // unresolved rather than applying them blindly.
  buildTraitStatMods() {
    const mods = {};
    for (const trait of templateLoader.templates.traits.values()) {
      const name = trait.dataName || trait.friendlyName;
      if (!name) continue;
      const entries = (Array.isArray(trait.statMods) ? trait.statMods : [])
        .filter(mod => mod && mod.stat)
        .map(mod => ({
          stat: mod.stat,
          value: Number(mod.strValue) || 0,
          operation: mod.operation || 'Additive',
          conditional: Boolean(mod.condition)
        }));
      if (entries.length > 0) mods[name] = entries;
    }
    return mods;
  }

  buildShipHullStats() {
    const stats = {};
    for (const hull of templateLoader.templates.shipHulls.values()) {
      const name = hull.dataName;
      if (!name) continue;
      stats[name] = {
        missionControl: hull.missionControl ?? null,
        constructionTier: hull.consTier ?? null,
        baseConstructionTimeDays: hull.baseConstructionTime_days ?? null,
        noseHardpoints: hull.noseHardpoints ?? null,
        hullHardpoints: hull.hullHardpoints ?? null,
        structuralIntegrity: hull.structuralIntegrity ?? null,
        requiredProjectName: hull.requiredProjectName || null
      };
    }
    return stats;
  }

  // Builds the normalized tech dependency graph from game templates and the
  // save's research state. This is attached to every snapshot (raw and filtered)
  // so the local dashboard and the hosted worker can serve the tech-tree,
  // tech-path, tech-search, tech-milestones and research-queue endpoints from
  // the exact same graph. Enemy project status is resolved per-observer/mode at
  // projection time, not here.
  buildTechTree(saveData, finishedTechsNames, activeGlobalSlots, factions) {
    const effects = {};
    for (const [id, eff] of templateLoader.templates.effects) effects[id] = eff;

    const globalActive = activeGlobalSlots.map(slot => ({
      techId: slot.techId,
      accumulatedResearch: slot.accumulatedResearch,
      totalCost: slot.totalCost,
      contributors: slot.contributions
    }));

    const templatesAdapter = {
      allTechs: () => Array.from(templateLoader.templates.techs.values()),
      allProjects: () => Array.from(templateLoader.templates.projects.values()),
      componentsForProject: (projectId) =>
        templateLoader.getComponentsForRequiredProject(projectId)
    };

    const rawGraph = techGraph.buildTechGraph(templatesAdapter, {
      techs: templatesAdapter.allTechs(),
      projects: templatesAdapter.allProjects(),
      effects,
      componentByEffect: {}
    });

    // Per-faction status overlay is stored keyed by faction id so any observer
    // / mode combination can be projected later without rebuilding the graph.
    const factionStatus = {};
    for (const faction of factions) {
      factionStatus[faction.ID] = {
        completedProjects: faction.completedProjects,
        availableProjectNames: faction.availableProjectNames,
        currentProjects: faction.currentProjects.map(p => ({
          projectId: p.projectId,
          accumulatedResearch: p.accumulatedResearch,
          totalCost: p.totalCost
        }))
      };
    }

    return {
      nodes: rawGraph.nodes,
      categories: rawGraph.categories,
      unlockClasses: rawGraph.unlockClasses,
      finishedTechsNames,
      globalActive,
      factionStatus,
      counts: { techs: rawGraph.techs.length, projects: rawGraph.projects.length }
    };
  }

  roundNumber(value, decimals = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const factor = 10 ** decimals;
    return Math.round(number * factor) / factor;
  }

  firstNumericOrNull(...values) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  }

  roundResourceMap(resources = {}) {
    const names = [
      'Money', 'Influence', 'Operations', 'Research', 'Projects', 'Boost',
      'MissionControl', 'Water', 'Volatiles', 'Metals', 'NobleMetals',
      'Fissiles', 'Antimatter', 'Exotics'
    ];
    return Object.fromEntries(names.map(name => {
      const value = Number(resources?.[name] || 0);
      const decimals = ['Boost', 'Water', 'Volatiles', 'Metals', 'NobleMetals', 'Fissiles', 'Antimatter', 'Exotics'].includes(name)
        ? 2
        : 0;
      return [name, Number.isFinite(value) ? this.roundNumber(value, decimals) : 0];
    }));
  }

  scaleResourceMap(resources = {}, scale = 1) {
    const rounded = this.roundResourceMap(resources);
    return Object.fromEntries(Object.entries(rounded).map(([name, value]) => [
      name,
      this.roundNumber(Number(value) * scale, name === 'Money' || name === 'Influence' || name === 'Operations' || name === 'Research' || name === 'Projects' || name === 'MissionControl' ? 2 : 3)
    ]));
  }

  dateValueToIso(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1 ? null : parsed.toISOString();
    }
    if (typeof value !== 'object') return null;
    const year = Number(value.year);
    const month = Number(value.month);
    const day = Number(value.day);
    if (!Number.isFinite(year) || year <= 1 || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const parsed = new Date(Date.UTC(
      year,
      Math.max(0, month - 1),
      day,
      Number(value.hour) || 0,
      Number(value.minute) || 0,
      Number(value.second) || 0,
      Number(value.millisecond) || 0
    ));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  normalizeResourceCosts(value) {
    const costs = Array.isArray(value?.resourceCosts)
      ? value.resourceCosts
      : Array.isArray(value) ? value : [];
    return costs.map(cost => ({
      resource: cost?.resource || cost?.Resource || null,
      amount: this.firstNumericOrNull(cost?.value, cost?.Amount, cost?.amount)
    })).filter(cost => cost.resource && cost.amount !== null);
  }

  summarizeRecentTransactions(transactions, gameTimeString, days = 30) {
    const gameDate = gameTimeString ? new Date(gameTimeString) : null;
    const endMs = gameDate && !Number.isNaN(gameDate.getTime()) ? gameDate.getTime() : null;
    const startMs = endMs === null ? null : endMs - days * 86400000;
    const income = {};
    const expense = {};
    if (!transactions || typeof transactions !== 'object') {
      return { windowDays: days, income, expense, net: {}, source: 'save transaction ledger' };
    }
    for (const entries of Object.values(transactions)) {
      const list = Array.isArray(entries) ? entries : [];
      for (const entry of list) {
        const date = this.dateValueToIso(entry?.Date || entry?.date);
        const dateMs = date ? new Date(date).getTime() : null;
        if (startMs !== null && (dateMs === null || dateMs < startMs || dateMs > endMs)) continue;
        const resource = entry?.Resource || entry?.resource;
        const amount = Number(entry?.Amount ?? entry?.amount);
        if (!resource || !Number.isFinite(amount)) continue;
        const bucket = amount >= 0 ? income : expense;
        bucket[resource] = (bucket[resource] || 0) + Math.abs(amount);
      }
    }
    const resources = new Set([...Object.keys(income), ...Object.keys(expense)]);
    const net = {};
    for (const resource of resources) {
      net[resource] = (income[resource] || 0) - (expense[resource] || 0);
    }
    return {
      windowDays: days,
      income: this.scaleResourceMap(income, 1),
      expense: this.scaleResourceMap(expense, 1),
      net: this.scaleResourceMap(net, 1),
      source: 'save transaction ledger'
    };
  }

  moduleConstructionStatus(module) {
    if (module?.destroyed) return 'destroyed';
    if (module?.decommissioning) return 'decommissioning';
    if (module?.constructionCompleted) return 'operational';
    return 'building';
  }

  classifyHabModule(module, template) {
    const name = `${module?.templateName || ''} ${module?.displayName || ''} ${template?.friendlyName || ''}`;
    if (template?.mine === true || /mine|mining/i.test(name)) return 'mine';
    if (template?.allowsShipConstruction === true || template?.specialRules?.includes?.('Shipyard')) return 'shipyard';
    if (/defen[sc]|weapon|laser|missile|railgun|coilgun|plasma/i.test(name)) return 'defensive';
    if (/research|academy|science|laboratory/i.test(name)) return 'research';
    if (/construction|industrial|fabricator|constructionyard/i.test(name)) return 'construction';
    return 'support';
  }

  normalizeArmor(armor) {
    if (!armor || typeof armor !== 'object') return null;
    return Object.fromEntries(Object.entries(armor).map(([face, values]) => ({
      face,
      values
    })).filter(entry => entry.values && typeof entry.values === 'object')
      .map(entry => [entry.face, {
        current: this.firstNumericOrNull(entry.values.armorValue),
        maximum: this.firstNumericOrNull(entry.values.maxArmor),
        chippedPct: this.firstNumericOrNull(entry.values.chippedPct)
      }]));
  }

  medianArmor(armor) {
    if (!armor || typeof armor !== 'object') return null;
    const values = Object.values(armor)
      .map(face => Number(face?.armorValue))
      .filter(value => Number.isFinite(value));
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return this.roundNumber(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, 2);
  }

  resolveFleetDestination(trajectory, fleetsById, habsById, bodiesById, orbitsById) {
    if (!trajectory) return { type: 'stationary', id: null, name: null };
    const fleetId = trajectory.destinationFleet?.value || null;
    if (fleetId) {
      const fleet = fleetsById.get(fleetId);
      return { type: 'fleet', id: fleetId, name: fleet?.displayName || `Fleet ${fleetId}` };
    }
    const stationId = trajectory.destinationStation?.value || null;
    if (stationId) {
      const hab = habsById.get(stationId);
      return { type: 'hab', id: stationId, name: hab?.displayName || `Hab ${stationId}` };
    }
    const orbitId = trajectory.destinationOrbit?.value || trajectory.destination?.value || null;
    if (orbitId && orbitsById.has(orbitId)) {
      const orbit = orbitsById.get(orbitId);
      const bodyId = orbit.barycenter?.value || null;
      const body = bodyId ? bodiesById.get(bodyId) : null;
      return { type: 'orbit', id: orbitId, name: body ? `${body.displayName} orbit` : `Orbit ${orbitId}` };
    }
    return { type: 'transfer', id: null, name: 'In Transit' };
  }

  firstNumeric(...values) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return 0;
  }

  lastFiniteNumber(values) {
    if (!Array.isArray(values)) return 0;
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = Number(values[index]);
      if (Number.isFinite(value)) return value;
    }
    return 0;
  }

  readShipCombatPower(ship) {
    const candidates = [
      ship.combatPower,
      ship.strategicCombatValue,
      ship.spaceCombatValue,
      ship.combatValue
    ];
    const value = candidates.find(v => typeof v === 'number' && Number.isFinite(v));
    return value === undefined ? null : value;
  }

  registerShipModuleRefs(ship, refs) {
    const moduleArrays = ['noseWeapons', 'hullWeapons', 'utilityModules'];
    for (const field of moduleArrays) {
      for (const module of (Array.isArray(ship[field]) ? ship[field] : [])) {
        if (module?.$id && module.moduleTemplateName) {
          refs.set(String(module.$id), module);
        }
      }
    }
    for (const ammo of (Array.isArray(ship.ammo) ? ship.ammo : [])) {
      const key = ammo?.Key;
      if (key?.$id && key.moduleTemplateName) {
        refs.set(String(key.$id), key);
      }
    }
  }

  resolveShipModule(module, refs) {
    if (!module) return null;
    if (module.moduleTemplateName) return module;
    if (module.$ref) return refs.get(String(module.$ref)) || null;
    return null;
  }

  buildWeaponLoadout(ship, refs) {
    const counts = new Map();
    for (const field of ['noseWeapons', 'hullWeapons']) {
      for (const moduleRef of (Array.isArray(ship[field]) ? ship[field] : [])) {
        const module = this.resolveShipModule(moduleRef, refs);
        const moduleId = module?.moduleTemplateName;
        const template = moduleId ? templateLoader.getWeaponModule(moduleId) : null;
        if (!template) continue;

        const current = counts.get(template.role) || {
          role: template.role,
          category: template.category,
          count: 0,
          systems: []
        };
        current.count++;
        if (!current.systems.includes(template.displayName)) {
          current.systems.push(template.displayName);
        }
        counts.set(template.role, current);
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
  }

  summarizeWeaponCounts(counts) {
    return Array.from(counts.entries())
      .map(([role, count]) => ({ role, category: role, count, systems: [] }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
  }

  getDominantWeaponType(loadout) {
    if (!Array.isArray(loadout) || loadout.length === 0) return 'Unarmed / Unknown';
    const max = Math.max(...loadout.map(entry => entry.count));
    const leaders = loadout.filter(entry => entry.count === max).map(entry => entry.role);
    return leaders.length === 1 ? leaders[0] : 'Mixed';
  }

  formatWeaponSummary(loadout) {
    if (!Array.isArray(loadout) || loadout.length === 0) return 'No recognized weapons';
    return loadout.map(entry => `${entry.role} x${entry.count}`).join(' • ');
  }

  normalizeFactionIntelligence(faction) {
    const normalizeEntries = (entries) => (Array.isArray(entries) ? entries : [])
      .map(entry => ({
        id: entry?.Key?.value ?? entry?.Key ?? null,
        typeName: entry?.Key?.$type || null,
        value: entry?.Value ?? null
      }))
      .filter(entry => entry.id !== null);

    return {
      milestones: Array.isArray(faction.milestones) ? faction.milestones : [],
      objectiveNames: faction.objectiveNames && typeof faction.objectiveNames === 'object'
        ? faction.objectiveNames
        : {},
      knownAlienSiteRegionIds: normalizeEntries(faction.knownAlienSites)
        .filter(entry => !entry.typeName || entry.typeName.includes('TIRegionState'))
        .map(entry => entry.id),
      intel: normalizeEntries(faction.intel),
      highestIntel: normalizeEntries(faction.highestIntel),
      alienInvestigations: faction.alienInvestigations || []
    };
  }

  resolveOrbitBodyId(asset, bodiesById, orbitsById) {
    const barycenterRef = asset.barycenter?.value;
    if (barycenterRef && bodiesById.has(barycenterRef)) {
      return barycenterRef;
    }
    const orbitRef = asset.orbitState?.value;
    if (orbitRef && orbitsById.has(orbitRef)) {
      const orb = orbitsById.get(orbitRef);
      const bRef = orb.barycenter?.value;
      if (bRef && bodiesById.has(bRef)) {
        return bRef;
      }
    }
    return null;
  }

  resolveOrbitBody(asset, bodiesById, orbitsById) {
    const bodyId = this.resolveOrbitBodyId(asset, bodiesById, orbitsById);
    return bodyId && bodiesById.has(bodyId) ? bodiesById.get(bodyId).displayName : 'Earth Orbit';
  }

  resolveOrbitBodyDistanceAU(asset, bodiesById, orbitsById, bodyDistanceAUById) {
    const bodyId = this.resolveOrbitBodyId(asset, bodiesById, orbitsById);
    return bodyId ? (bodyDistanceAUById.get(bodyId) ?? null) : null;
  }

  getFactionColor(displayName) {
    const map = {
      'the Initiative': '#00e5ff',
      'the Resistance': '#2979ff',
      'Humanity First': '#ff1744',
      'the Academy': '#ffd600',
      'Project Exodus': '#ff9100',
      'the Protectorate': '#78909c',
      'the Servants': '#d500f9',
      'the Aliens': '#00e676'
    };
    return map[displayName] || '#b0bec5';
  }

  getCollection(gamestates, className) {
    const raw = gamestates[className];
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(i => (i && i.Value !== undefined ? i.Value : i));
    if (typeof raw === 'object') return Object.values(raw).map(i => (i && i.Value !== undefined ? i.Value : i));
    return [];
  }
}

module.exports = new SnapshotBuilder();
