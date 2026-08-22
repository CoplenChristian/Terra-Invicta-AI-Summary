// server/snapshot/space.js
//
// Purpose: everything above the atmosphere — fleets and ships, habs, hab sites
//   and mines, hab modules, shipyard queues and stations, transfers.
//
// Everything above the atmosphere: fleets and their ships, habs, hab sites and
// their mines, hab modules, shipyard queues and stations, and the inter-faction
// resource transfers that ride on them.
//
// These reducers share a set of small readers (combat power, armour, weapon
// loadout, module construction status) which are exported alongside them
// because the same absence rules have to hold wherever they are called: a ship
// whose save record omits combat power contributes `null`, not 0, and a fleet
// made entirely of such ships reports `combatPowerAvailable: false` rather than
// a confident total of zero.

const templateLoader = require('../templateLoader');
const spaceTheater = require('../spaceTheater');
const { MS_PER_DAY } = require('../../shared/util.mjs');
const {
  roundNumber,
  firstNumericOrNull,
  dateValueToIso,
  normalizeResourceCosts
} = require('./numbers');
const {
  SATURN_ORBIT_TOLERANCE_AU,
  resolveFactionName,
  resolveOrbitBody,
  resolveOrbitBodyDistanceAU
} = require('./lookups');

// ---------------------------------------------------------------------------
// Ship readers
// ---------------------------------------------------------------------------

function readShipCombatPower(ship) {
  const candidates = [
    ship.combatPower,
    ship.strategicCombatValue,
    ship.spaceCombatValue,
    ship.combatValue
  ];
  const value = candidates.find(v => typeof v === 'number' && Number.isFinite(v));
  return value === undefined ? null : value;
}

function registerShipModuleRefs(ship, refs) {
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

function resolveShipModule(module, refs) {
  if (!module) return null;
  if (module.moduleTemplateName) return module;
  if (module.$ref) return refs.get(String(module.$ref)) || null;
  return null;
}

function buildWeaponLoadout(ship, refs) {
  const counts = new Map();
  for (const field of ['noseWeapons', 'hullWeapons']) {
    for (const moduleRef of (Array.isArray(ship[field]) ? ship[field] : [])) {
      const module = resolveShipModule(moduleRef, refs);
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

function summarizeWeaponCounts(counts) {
  return Array.from(counts.entries())
    .map(([role, count]) => ({ role, category: role, count, systems: [] }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}

function getDominantWeaponType(loadout) {
  if (!Array.isArray(loadout) || loadout.length === 0) return 'Unarmed / Unknown';
  const max = Math.max(...loadout.map(entry => entry.count));
  const leaders = loadout.filter(entry => entry.count === max).map(entry => entry.role);
  return leaders.length === 1 ? leaders[0] : 'Mixed';
}

function formatWeaponSummary(loadout) {
  if (!Array.isArray(loadout) || loadout.length === 0) return 'No recognized weapons';
  return loadout.map(entry => `${entry.role} x${entry.count}`).join(' • ');
}

function normalizeArmor(armor) {
  if (!armor || typeof armor !== 'object') return null;
  return Object.fromEntries(Object.entries(armor).map(([face, values]) => ({
    face,
    values
  })).filter(entry => entry.values && typeof entry.values === 'object')
    .map(entry => [entry.face, {
      current: firstNumericOrNull(entry.values.armorValue),
      maximum: firstNumericOrNull(entry.values.maxArmor),
      chippedPct: firstNumericOrNull(entry.values.chippedPct)
    }]));
}

function medianArmor(armor) {
  if (!armor || typeof armor !== 'object') return null;
  const values = Object.values(armor)
    .map(face => Number(face?.armorValue))
    .filter(value => Number.isFinite(value));
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return roundNumber(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, 2);
}

function resolveFleetDestination(trajectory, fleetsById, habsById, bodiesById, orbitsById) {
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

// ---------------------------------------------------------------------------
// Hab module readers
// ---------------------------------------------------------------------------

// Monthly research produced by one hab module, read from the installed
// TIHabModuleTemplate rather than hardcoded. Only the 36 science templates
// carry incomeResearch_month, so a template that exists without the key
// genuinely produces no research -- that is a measured zero. A template that
// could not be resolved at all is unmeasured and returns null, so the
// faction total reports null rather than silently dropping the module.
function habModuleResearchIncome(template) {
  if (!template) return null;
  const value = template.incomeResearch_month;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function moduleConstructionStatus(module) {
  if (module?.destroyed) return 'destroyed';
  if (module?.decommissioning) return 'decommissioning';
  if (module?.constructionCompleted) return 'operational';
  return 'building';
}

/**
 * Days until a module's completion date.
 *
 * Two reducers (hab sites and hab modules) computed this from the same three
 * inputs and had already drifted into different rounding expressions for the
 * same one-decimal result. `null` is the honest answer for a status that is
 * neither building nor operational, and for a building module whose dates do
 * not parse -- never 0, which would read as "finishing today".
 */
function daysRemainingForStatus(constructionStatus, gameDate, completionDate) {
  if (constructionStatus === 'operational') return 0;
  if (constructionStatus !== 'building') return null;
  const datesUsable = gameDate && !Number.isNaN(gameDate.getTime()) &&
    completionDate && !Number.isNaN(completionDate.getTime());
  if (!datesUsable) return null;
  return Math.max(0, roundNumber((completionDate - gameDate) / MS_PER_DAY, 1));
}

function classifyHabModule(module, template) {
  const name = `${module?.templateName || ''} ${module?.displayName || ''} ${template?.friendlyName || ''}`;
  if (template?.mine === true || /mine|mining/i.test(name)) return 'mine';
  if (template?.allowsShipConstruction === true || template?.specialRules?.includes?.('Shipyard')) return 'shipyard';
  if (/defen[sc]|weapon|laser|missile|railgun|coilgun|plasma/i.test(name)) return 'defensive';
  if (/research|academy|science|laboratory/i.test(name)) return 'research';
  if (/construction|industrial|fabricator|constructionyard/i.test(name)) return 'construction';
  return 'support';
}

// The five mined resource rates for one hab site, with absence preserved.
// Returns the rates plus `resourceRatesAvailable` (false when the save
// carried none of them) and `unmeasuredResourceRates` (the names that were
// absent), so a renderer can print "unavailable" instead of a confident 0.
function readSiteResourceRates(site) {
  const fields = [
    ['water', ['water_day', 'water', 'waterDailyRate']],
    ['volatiles', ['volatiles_day', 'volatiles', 'volatilesDailyRate']],
    ['metals', ['metals_day', 'metals', 'metalsDailyRate']],
    ['nobleMetals', ['nobles_day', 'nobleMetals', 'nobleMetalsDailyRate']],
    ['fissiles', ['fissiles_day', 'fissiles', 'fissilesDailyRate']]
  ];

  const rates = {};
  const unmeasured = [];
  for (const [key, aliases] of fields) {
    const value = firstNumericOrNull(...aliases.map(alias => site?.[alias]));
    rates[key] = value;
    if (value === null) unmeasured.push(key);
  }

  rates.unmeasuredResourceRates = unmeasured;
  rates.resourceRatesAvailable = unmeasured.length < fields.length;
  rates.resourceRatesComplete = unmeasured.length === 0;
  return rates;
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

function buildFleets(rawFleets, {
  factionsById,
  shipsById,
  shipModuleRefs,
  fleetsById,
  habsById,
  bodiesById,
  orbitsById,
  bodyDistanceAUById,
  saturnOrbitDistanceAU
}) {
  const fleets = [];
  for (const f of rawFleets) {
    const fleetId = f.ID?.value;
    if (!fleetId) continue;

    const factionId = f.faction?.value || null;
    const factionName = resolveFactionName(factionsById, factionId, 'Unknown');

    const shipRefs = Array.isArray(f.ships) ? f.ships : [];
    const shipList = [];
    let totalCombatPower = 0;
    let combatPowerAvailable = false;
    const fleetWeaponCounts = new Map();

    for (const sr of shipRefs) {
      const sId = sr.value || sr;
      const sObj = shipsById.get(sId);
      if (sObj) {
        const power = readShipCombatPower(sObj);
        if (power !== null) {
          totalCombatPower += power;
          combatPowerAvailable = true;
        }
        const weaponLoadout = buildWeaponLoadout(sObj, shipModuleRefs);
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
          dominantWeaponType: getDominantWeaponType(weaponLoadout),
          currentDeltaVKps: firstNumericOrNull(sObj.currentDeltaV_kps),
          currentMaxDeltaVKps: firstNumericOrNull(sObj.currentMaxDeltaV_kps),
          cruiseAccelerationMps2: firstNumericOrNull(sObj.cruiseAcceleration_mps2),
          combatAccelerationMps2: firstNumericOrNull(sObj.combatAcceleration_mps2),
          currentMassKg: firstNumericOrNull(sObj.currentMass_kg),
          missionControlConsumption: firstNumericOrNull(sObj.missionControlConsumption),
          propellantTons: firstNumericOrNull(sObj.propellant_tons),
          armor: normalizeArmor(sObj.armor),
          armorMedian: medianArmor(sObj.armor)
        });
      }
    }

    const orbitBody = resolveOrbitBody(f, bodiesById, orbitsById);
    const theater = spaceTheater.theaterForBody(orbitBody);
    const orbitBodyDistanceAU = resolveOrbitBodyDistanceAU(f, bodiesById, orbitsById, bodyDistanceAUById);
    const trajectory = f.trajectory || null;
    const fleetWeaponBreakdown = summarizeWeaponCounts(fleetWeaponCounts);
    const destination = resolveFleetDestination(trajectory, fleetsById, habsById, bodiesById, orbitsById);
    const arrivalDate = dateValueToIso(trajectory?.arrivalTime || null);
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
      dominantWeaponType: getDominantWeaponType(fleetWeaponBreakdown),
      weaponSummary: formatWeaponSummary(fleetWeaponBreakdown),
      orbitBody,
      spaceTheaterKey: theater.key,
      spaceTheaterName: theater.name,
      orbitBodyDistanceAU,
      insideSaturnOrbit: saturnOrbitDistanceAU !== null && orbitBodyDistanceAU !== null
        ? orbitBodyDistanceAU <= saturnOrbitDistanceAU + SATURN_ORBIT_TOLERANCE_AU
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
      armorMedian: shipArmorMedians.length ? roundNumber(shipArmorMedians.reduce((sum, value) => sum + value, 0) / shipArmorMedians.length, 2) : null,
      inCombat: !!f.inCombat
    });
  }
  return fleets;
}

function buildHabs(rawHabs, {
  factionsById,
  bodiesById,
  orbitsById,
  bodyDistanceAUById,
  saturnOrbitDistanceAU
}) {
  const habs = [];
  for (const h of rawHabs) {
    const habId = h.ID?.value;
    if (!habId) continue;

    const factionId = h.faction?.value || null;
    const factionName = resolveFactionName(factionsById, factionId, 'Unknown');
    const orbitBody = resolveOrbitBody(h, bodiesById, orbitsById);
    const theater = spaceTheater.theaterForBody(orbitBody);
    const orbitBodyDistanceAU = resolveOrbitBodyDistanceAU(h, bodiesById, orbitsById, bodyDistanceAUById);

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
        ? orbitBodyDistanceAU <= saturnOrbitDistanceAU + SATURN_ORBIT_TOLERANCE_AU
        : null,
      inEarthLEO: !!h.inEarthLEO,
      templateName: h.templateName || h.habSchematicTemplateName,
      inCombat: !!h.inCombat,
      underAssault: !!h.underAssault,
      underBombardment: !!h.underBombardment
    });
  }
  return habs;
}

function buildHabSites(rawHabSites, {
  rawHabs,
  factionsById,
  bodiesById,
  habSectorsById,
  habModulesById,
  gameTimeString
}) {
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
    const factionName = resolveFactionName(factionsById, factionId, 'Unclaimed');

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
    const gameDate = gameTimeString ? new Date(gameTimeString) : null;
    const moduleCompletion = completionDate ? new Date(completionDate) : null;

    // A site with no mine module at all is not "building" -- it has nothing
    // installed, or its hab has not been founded yet. Those two states are
    // this reducer's own; the four module states come from the shared
    // classifier the hab-module reducer uses.
    let constructionStatus;
    if (module) {
      constructionStatus = moduleConstructionStatus(module);
    } else {
      constructionStatus = hs.pendingHab ? 'pending-hab' : 'not-installed';
    }

    const daysRemaining = daysRemainingForStatus(constructionStatus, gameDate, moduleCompletion);

    // Join the site's mining profile from the game templates. The save omits
    // it on unclaimed sites, but it is what determines yields -- without it
    // an expansion-target ranking cannot tell a genuinely rich site from one
    // of the ~95 that share the generic Common Carbonaceous profile.
    const siteTemplate = templateLoader.templates.habSites.get(hs.templateName)
      || templateLoader.templates.habSites.get(hs.displayName)
      || null;

    const siteResourceRates = readSiteResourceRates(hs);

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
      // The game's own power flag for the mine module. A COMPLETED but
      // unpowered mine produces nothing, and `constructionStatus` above cannot
      // see that -- it is derived from `constructionCompleted` alone. Measured
      // 2026-08-22: two of the Servants' completed Settlement complexes read
      // `powered: false` on `ExitSave.gz`, and counting them breaks their
      // reconciliation against the game's own revenue by 4-5%.
      //
      // Carried as a strict boolean or null so `resolveMineModuleMultiplier`
      // can tell "powered, checked" from "power state not carried".
      mineModulePowered: typeof module?.powered === 'boolean' ? module.powered : null,
      constructionCompleted: module?.constructionCompleted ?? null,
      completionDate,
      startBuildDate: module?.startBuildDate || null,
      buildDurationDays: module?.baseBuildDuration_days ?? moduleTemplate?.buildTime_Days ?? null,
      daysRemaining,
      // Current saves store production as *_day. Keep legacy aliases as
      // fallbacks for older save formats.
      //
      // An absent rate is NOT a zero rate. A site the save has not measured
      // (an unsurveyed body, an older save format, a modded site) must not
      // be reported as barren -- that is the difference between "this rock
      // yields nothing" and "we have not looked". `unmeasuredResourceRates`
      // names which of the five were absent so a consumer can say so.
      ...siteResourceRates,
      resourceRateUnit: 'per day'
    });
  }
  return habSites;
}

/**
 * Hab module detail plus the two by-faction tallies the faction reducer needs.
 *
 * The save stores these as separate sector/module records, so they are joined
 * back to the owning hab before being exposed through the focused API.
 */
function buildHabModules(rawHabModules, {
  habs,
  habModuleLocationById,
  factionsById,
  gameTimeString
}) {
  const habModules = [];
  const shipyardCountByFaction = new Map();
  const habModuleRowsById = new Map();
  // Space research. Hab modules carry incomeResearch_month in the installed
  // templates, and it is a real slice of a faction's output that the Earth
  // nation sum knows nothing about. Aggregated here, at snapshot-build time,
  // for the same reason as shipHullStats and missionSpecs: the hosted worker
  // has no template directory, so anything template-derived must be baked on.
  const habResearchByFaction = new Map();
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
    const factionName = resolveFactionName(factionsById, factionId, 'Unknown', null);
    const constructionStatus = moduleConstructionStatus(module);
    const moduleType = classifyHabModule(module, template);
    const completionDate = dateValueToIso(module.completionDate);
    const startBuildDate = dateValueToIso(module.startBuildDate);
    const moduleCompletion = completionDate ? new Date(completionDate) : null;
    const gameDate = gameTimeString ? new Date(gameTimeString) : null;
    const daysRemaining = daysRemainingForStatus(constructionStatus, gameDate, moduleCompletion);
    const isShipyard = template?.allowsShipConstruction === true ||
      (Array.isArray(template?.specialRules) && template.specialRules.includes('Shipyard'));

    // A module still under construction produces nothing, so only operational
    // ones are counted. A module whose template cannot be resolved is
    // unmeasured, not zero -- it is tracked separately so the faction total
    // reports null rather than quietly losing that module's output.
    const researchIncomeMonth = habModuleResearchIncome(template);
    if (factionId) {
      if (!habResearchByFaction.has(factionId)) {
        habResearchByFaction.set(factionId, { monthly: 0, modules: 0, unresolvedModules: 0 });
      }
      const bucket = habResearchByFaction.get(factionId);
      if (researchIncomeMonth === null) {
        bucket.unresolvedModules += 1;
      } else if (researchIncomeMonth > 0 && constructionStatus === 'operational') {
        bucket.monthly += researchIncomeMonth;
        bucket.modules += 1;
      }
    }

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
      researchIncomeMonth,
      constructionStatus,
      constructionCompleted: module.constructionCompleted ?? null,
      powered: module.powered ?? null,
      destroyed: module.destroyed ?? false,
      decommissioning: module.decommissioning ?? false,
      completionDate,
      startBuildDate,
      buildDurationDays: module.baseBuildDuration_days ?? template?.buildTime_Days ?? null,
      daysRemaining,
      buildCost: normalizeResourceCosts(module.buildCost)
    };
    habModules.push(row);
    habModuleRowsById.set(moduleId, row);
    if (isShipyard && constructionStatus !== 'destroyed' && factionId) {
      shipyardCountByFaction.set(factionId, (shipyardCountByFaction.get(factionId) || 0) + 1);
    }
  }
  return { habModules, shipyardCountByFaction, habModuleRowsById, habResearchByFaction };
}

function buildShipyardQueues(rawFactions, { habModuleRowsById, factionsById }) {
  const shipyardQueues = [];
  for (const rawFaction of rawFactions) {
    const factionId = rawFaction.ID?.value;
    if (!factionId || !Array.isArray(rawFaction.nShipyardQueues)) continue;
    for (const queue of rawFaction.nShipyardQueues) {
      const shipyardId = queue?.Key?.value ?? queue?.Key ?? null;
      const shipyard = shipyardId ? habModuleRowsById.get(shipyardId) : null;
      const entries = Array.isArray(queue?.Value) ? queue.Value : [];
      entries.forEach((entry, index) => {
        const startDate = dateValueToIso(entry?.startDate);
        const daysToCompletion = firstNumericOrNull(entry?.daysToCompletion);
        const completionDate = startDate && daysToCompletion !== null
          ? new Date(new Date(startDate).getTime() + daysToCompletion * MS_PER_DAY).toISOString()
          : null;
        shipyardQueues.push({
          id: `${factionId}:${shipyardId || 'unknown'}:${index}`,
          factionId,
          factionName: resolveFactionName(factionsById, factionId, 'Unknown'),
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
          resourcesCost: normalizeResourceCosts(entry?.resourcesCost),
          resourcesRefund: normalizeResourceCosts(entry?.resourcesRefund),
          aiGoalId: entry?.AIFactionGoal?.value || null,
          aiGoalType: entry?.AIFactionGoal?.$type || null
        });
      });
    }
  }
  return shipyardQueues;
}

function buildResourceTransfers(rawFactions, { factionsById }) {
  const resourceTransfers = [];
  for (const rawFaction of rawFactions) {
    const sourceFactionId = rawFaction.ID?.value;
    const transferList = Array.isArray(rawFaction.dailyResourceTransfers)
      ? rawFaction.dailyResourceTransfers
      : [];
    transferList.forEach((entry, index) => {
      const targetFactionId = entry?.targetFaction?.value || null;
      const resource = entry?.transfer?.resource || null;
      const amountPerDay = firstNumericOrNull(entry?.transfer?.value);
      if (!sourceFactionId || !targetFactionId || !resource || amountPerDay === null) return;
      resourceTransfers.push({
        id: `${sourceFactionId}:${targetFactionId}:${resource}:${index}`,
        sourceFactionId,
        sourceFactionName: resolveFactionName(factionsById, sourceFactionId, 'Unknown'),
        targetFactionId,
        targetFactionName: resolveFactionName(factionsById, targetFactionId, 'Unknown'),
        resource,
        amountPerDay: roundNumber(amountPerDay, 3),
        expiry: dateValueToIso(entry?.expiry)
      });
    });
  }
  return resourceTransfers;
}

function buildShipyardStations(habModules, shipyardQueues) {
  return habModules
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
}

module.exports = {
  readShipCombatPower,
  registerShipModuleRefs,
  resolveShipModule,
  buildWeaponLoadout,
  summarizeWeaponCounts,
  getDominantWeaponType,
  formatWeaponSummary,
  normalizeArmor,
  medianArmor,
  resolveFleetDestination,
  habModuleResearchIncome,
  moduleConstructionStatus,
  daysRemainingForStatus,
  classifyHabModule,
  readSiteResourceRates,
  buildFleets,
  buildHabs,
  buildHabSites,
  buildHabModules,
  buildShipyardQueues,
  buildResourceTransfers,
  buildShipyardStations
};
