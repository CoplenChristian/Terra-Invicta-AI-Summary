// shared/intelResources.mjs
//
// Pure snapshot projection builders shared by the local Express server (loaded
// via require(esm)) and the hosted Cloudflare worker (ESM import). Keep this
// file free of any runtime-specific imports so it stays usable in both.

import { ALIEN_FACTION_ID, ALIEN_FACTION_DISPLAY_NAME } from './constants.mjs';

export const SUPPORTED_RESOURCES = new Set([
  'summary', 'factions', 'nations', 'councilors', 'habs', 'hab-sites',
  'mining', 'fleets', 'ships', 'research', 'capabilities', 'alien',
  'resources', 'hab-modules', 'shipyards', 'shipyard-queues', 'arrivals', 'transfers'
]);

export const asArray = (value) => (Array.isArray(value) ? value : []);

export const normalizeBody = (value) => String(value || '')
  .trim()
  .replace(/^\d+\s+/, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

export const factionMatches = (item, factionId) => {
  if (factionId === null) return true;
  const controlPointIds = asArray(item.controlPoints).map(cp => cp?.factionId);
  return [item.ID, item.id, item.factionId, item.executiveFactionId, ...controlPointIds]
    .some(id => Number(id) === factionId);
};

export const bodyMatches = (item, body) => {
  if (!body) return true;
  return normalizeBody(item.orbitBody || item.parentBodyName) === normalizeBody(body);
};

export const factionResourceRow = (faction) => ({
  id: faction.ID,
  name: faction.displayName,
  templateName: faction.templateName,
  controlPoints: faction.controlPointsCount ?? 0,
  nations: faction.nationsCount ?? 0,
  habs: faction.habsCount ?? 0,
  fleets: faction.fleetsCount ?? 0,
  ships: faction.shipsCount ?? 0,
  totalGdp: faction.totalGdp ?? 0,
  totalPopulation: faction.totalPopulation ?? 0,
  totalBoost: faction.totalBoost ?? 0,
  totalResearch: faction.totalResearch ?? 0,
  combatPower: faction.combatPower ?? null,
  combatPowerAvailable: faction.combatPowerAvailable ?? false,
  powerScore: faction.powerScore?.overall ?? null,
  missionControlUsage: faction.missionControlUsage ?? null,
  missionControlCapacity: faction.missionControlCapacity ?? null,
  shipyardCount: faction.shipyardCount ?? 0,
  shipyardQueueCount: faction.shipyardQueueCount ?? 0,
  resources: faction.resources || null,
  monthlyIncome: faction.monthlyIncome || null,
  monthlyExpense: faction.monthlyExpense ?? null,
  monthlyNet: faction.monthlyNet ?? null,
  financials: faction.financials || null,
  alienHate: faction.alienHate?.actual ?? faction.alienHate?.visibleEstimate ?? null,
  assessedAlienHateOfMe: faction.assessedAlienHateOfMe ?? null
});

export const nationResourceRow = (nation) => ({
  id: nation.ID,
  name: nation.displayName,
  templateName: nation.templateName,
  executiveFactionId: nation.executiveFactionId,
  executiveFactionName: nation.executiveFactionName,
  controlPoints: asArray(nation.controlPoints).map(cp => ({
    factionId: cp?.factionId,
    factionName: cp?.factionName,
    type: cp?.controlPointType || cp?.type,
    control: cp?.control
  })),
  gdp: nation.GDP ?? 0,
  population: nation.population ?? 0,
  boost: nation.boost ?? 0,
  missionControl: nation.missionControl ?? 0,
  militaryTechnology: nation.milTech ?? 0,
  unrest: nation.unrest ?? 0,
  cohesion: nation.cohesion ?? 0,
  democracy: nation.democracy ?? 0,
  research: nation.research ?? 0,
  nukes: nation.nukes ?? 0,
  armies: nation.armies ?? 0,
  regions: nation.regionsCount ?? 0
});

export const councilorResourceRow = (councilor, mode) => ({
  id: councilor.ID,
  name: councilor.displayName,
  personalName: councilor.personalName,
  familyName: councilor.familyName,
  factionId: councilor.factionId,
  factionName: councilor.factionName,
  agentForFactionId: councilor.agentForFactionId,
  agentForFactionName: councilor.agentForFactionName,
  type: councilor.typeTemplateName,
  isAlien: councilor.isAlien,
  isActiveCouncilor: councilor.isActiveCouncilor !== false,
  isIndependent: councilor.isIndependent === true,
  status: councilor.status,
  location: councilor.locationName,
  locationRegionId: councilor.locationRegionId,
  activeMission: councilor.activeMission,
  visibility: councilor.visibility,
  investigationConfidence: councilor.investigationConfidence,
  isOwnCouncilor: councilor.isOwnCouncilor ?? false,
  isTurnedMole: councilor.isTurnedMole ?? false,
  traits: councilor.traits,
  organizations: councilor.orgs,
  attributes: mode === 'omniscient' ? councilor.attributes : undefined,
  maskedAttributes: councilor.maskedAttributes
});

export const habResourceRow = (hab) => ({
  id: hab.ID,
  name: hab.displayName,
  factionId: hab.factionId,
  factionName: hab.factionName,
  templateName: hab.templateName,
  type: hab.habType,
  tier: hab.tier,
  orbitBody: hab.orbitBody,
  spaceTheaterKey: hab.spaceTheaterKey,
  spaceTheaterName: hab.spaceTheaterName,
  visibility: hab.visibility || null,
  distanceAU: hab.orbitBodyDistanceAU,
  inEarthLEO: hab.inEarthLEO ?? false,
  insideSaturnOrbit: hab.insideSaturnOrbit ?? false,
  inCombat: hab.inCombat ?? false,
  underAssault: hab.underAssault ?? false,
  underBombardment: hab.underBombardment ?? false
});

export const habSiteResourceRow = (site) => ({
  id: site.ID,
  name: site.displayName,
  factionId: site.factionId,
  factionName: site.factionName,
  habId: site.habId,
  bodyId: site.parentBodyId,
  bodyName: site.parentBodyName,
  spaceTheaterKey: site.spaceTheaterKey,
  spaceTheaterName: site.spaceTheaterName,
  visibility: site.visibility || null,
  water: site.water ?? 0,
  volatiles: site.volatiles ?? 0,
  metals: site.metals ?? 0,
  nobleMetals: site.nobleMetals ?? 0,
  fissiles: site.fissiles ?? 0,
  resourceRateUnit: site.resourceRateUnit,
  habName: site.habName,
  habTier: site.habTier,
  mineTier: site.mineTier,
  mineModuleTemplate: site.mineModuleTemplate,
  constructionStatus: site.constructionStatus,
  constructionCompleted: site.constructionCompleted,
  completionDate: site.completionDate,
  startBuildDate: site.startBuildDate,
  buildDurationDays: site.buildDurationDays,
  daysRemaining: site.daysRemaining
});

export const miningResourceRow = (site) => ({
  site: site.displayName,
  owner: site.factionName,
  siteId: site.ID,
  habId: site.habId,
  hab: site.habName,
  body: site.parentBodyName,
  bodyId: site.parentBodyId,
  spaceTheaterKey: site.spaceTheaterKey,
  spaceTheaterName: site.spaceTheaterName,
  visibility: site.visibility || null,
  water: site.water ?? 0,
  volatiles: site.volatiles ?? 0,
  metals: site.metals ?? 0,
  nobles: site.nobleMetals ?? 0,
  fissiles: site.fissiles ?? 0,
  resourceRateUnit: site.resourceRateUnit,
  mineTier: site.mineTier,
  mineModule: site.mineModuleTemplate,
  constructionStatus: site.constructionStatus,
  daysRemaining: site.daysRemaining,
  completionDate: site.completionDate,
  buildDurationDays: site.buildDurationDays
});

export const fleetResourceRow = (fleet) => ({
  id: fleet.ID,
  name: fleet.displayName,
  factionId: fleet.factionId,
  factionName: fleet.factionName,
  mission: fleet.mission,
  inCombat: fleet.inCombat ?? false,
  orbitBody: fleet.orbitBody,
  spaceTheaterKey: fleet.spaceTheaterKey,
  spaceTheaterName: fleet.spaceTheaterName,
  visibility: fleet.visibility || null,
  distanceAU: fleet.orbitBodyDistanceAU,
  destination: fleet.destination,
  arrivalDate: fleet.arrivalDate,
  ships: fleet.shipsCount ?? 0,
  combatPower: fleet.combatPower ?? null,
  combatPowerAvailable: fleet.combatPowerAvailable ?? false,
  combatPowerSource: fleet.combatPowerSource,
  dominantWeaponType: fleet.dominantWeaponType,
  weaponSummary: fleet.weaponSummary,
  weaponBreakdown: fleet.weaponBreakdown,
  shipManifest: asArray(fleet.ships).map(ship => shipResourceRow(ship, fleet)),
  lowestDeltaVKps: fleet.lowestDeltaVKps ?? null,
  lowestCombatAccelerationMps2: fleet.lowestCombatAccelerationMps2 ?? null,
  armorMedian: fleet.armorMedian ?? null,
  currentOrders: fleet.currentOrders || null,
  destinationType: fleet.destinationType || null,
  destinationId: fleet.destinationId || null,
  insideSaturnOrbit: fleet.insideSaturnOrbit ?? false
});

export const shipResourceRow = (ship, fleet) => ({
    id: ship.id,
    name: ship.displayName,
    hullName: ship.hullName,
    factionId: fleet.factionId,
    factionName: fleet.factionName,
    fleetId: fleet.ID,
    fleetName: fleet.displayName,
    mission: fleet.mission,
    orbitBody: fleet.orbitBody,
    spaceTheaterKey: fleet.spaceTheaterKey,
    spaceTheaterName: fleet.spaceTheaterName,
    visibility: fleet.visibility || null,
    distanceAU: fleet.orbitBodyDistanceAU,
    destination: fleet.destination,
    combatPower: ship.combatPower ?? null,
    combatPowerSource: ship.combatPowerSource,
    dominantWeaponType: ship.dominantWeaponType,
    weaponLoadout: ship.weaponLoadout,
    currentDeltaVKps: ship.currentDeltaVKps ?? null,
    currentMaxDeltaVKps: ship.currentMaxDeltaVKps ?? null,
    cruiseAccelerationMps2: ship.cruiseAccelerationMps2 ?? null,
    combatAccelerationMps2: ship.combatAccelerationMps2 ?? null,
    currentMassKg: ship.currentMassKg ?? null,
    missionControlConsumption: ship.missionControlConsumption ?? null,
    propellantTons: ship.propellantTons ?? null,
    armor: ship.armor || null,
    armorMedian: ship.armorMedian ?? null
});

export const shipResourceRows = (fleets, factionId, body) => fleets
  .filter(fleet => factionMatches(fleet, factionId) && bodyMatches(fleet, body))
  .flatMap(fleet => asArray(fleet.ships).map(ship => shipResourceRow(ship, fleet)));

export const habModuleResourceRow = (module) => ({
  id: module.id,
  name: module.name,
  templateName: module.templateName,
  moduleType: module.moduleType,
  factionId: module.factionId,
  factionName: module.factionName,
  habId: module.habId,
  habName: module.habName,
  habTier: module.habTier,
  sectorId: module.sectorId,
  sectorNumber: module.sectorNumber,
  orbitBody: module.orbitBody,
  spaceTheaterKey: module.spaceTheaterKey,
  spaceTheaterName: module.spaceTheaterName,
  isShipyard: module.isShipyard ?? false,
  constructionStatus: module.constructionStatus,
  constructionCompleted: module.constructionCompleted,
  powered: module.powered,
  destroyed: module.destroyed,
  decommissioning: module.decommissioning,
  completionDate: module.completionDate,
  startBuildDate: module.startBuildDate,
  buildDurationDays: module.buildDurationDays,
  daysRemaining: module.daysRemaining,
  buildCost: module.buildCost || []
});

export const shipyardResourceRow = (queue) => ({
  id: queue.id,
  factionId: queue.factionId,
  factionName: queue.factionName,
  shipyardId: queue.shipyardId,
  shipyardName: queue.shipyardName,
  habId: queue.habId,
  habName: queue.habName,
  orbitBody: queue.orbitBody,
  spaceTheaterKey: queue.spaceTheaterKey,
  spaceTheaterName: queue.spaceTheaterName,
  queuePosition: queue.queuePosition,
  design: queue.design,
  hull: queue.hull,
  isRefit: queue.isRefit,
  costPaid: queue.costPaid,
  constructionStatus: queue.constructionStatus,
  startDate: queue.startDate,
  completionDate: queue.completionDate,
  daysToCompletion: queue.daysToCompletion,
  resourcesCost: queue.resourcesCost || [],
  resourcesRefund: queue.resourcesRefund || [],
  aiGoalId: queue.aiGoalId,
  aiGoalType: queue.aiGoalType
});

export const shipyardStationResourceRow = (station) => ({
  id: station.id,
  name: station.name,
  templateName: station.templateName,
  factionId: station.factionId,
  factionName: station.factionName,
  habId: station.habId,
  habName: station.habName,
  habTier: station.habTier,
  orbitBody: station.orbitBody,
  spaceTheaterKey: station.spaceTheaterKey,
  spaceTheaterName: station.spaceTheaterName,
  constructionStatus: station.constructionStatus,
  powered: station.powered,
  queueCount: station.queueCount ?? 0,
  currentConstruction: station.currentConstruction ? shipyardResourceRow(station.currentConstruction) : null,
  queue: asArray(station.queue).map(shipyardResourceRow)
});

export const friendlyStrengthAtDestination = (fleet, snapshot) => {
  const destinationBody = normalizeBody(String(fleet.destination || '').replace(/\s+orbit$/i, ''));
  if (!destinationBody || destinationBody === normalizeBody('in transit')) return null;
  const observerFactionId = snapshot?.observerFactionId;
  if (observerFactionId === null || observerFactionId === undefined) return null;
  const friendlyFleets = asArray(snapshot.fleets).filter(other =>
    other.factionId === observerFactionId && normalizeBody(other.orbitBody) === destinationBody
  );
  const currentShips = friendlyFleets.reduce((sum, other) => sum + (Number(other.shipsCount) || 0), 0);
  const combatValues = friendlyFleets
    .map(other => other.combatPower)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const completingShips = asArray(snapshot.shipyardQueues).filter(queue =>
    queue.factionId === observerFactionId && normalizeBody(queue.orbitBody) === destinationBody
  ).length;
  return {
    currentShips,
    completingShips,
    expectedShips: currentShips + completingShips,
    currentCombatPower: combatValues.length ? combatValues.reduce((sum, value) => sum + value, 0) : null,
    combatPowerAvailable: combatValues.length > 0,
    source: 'current friendly assets plus save-backed shipyard queue',
    futureReinforcementSimulation: false
  };
};

export const arrivalResourceRow = (fleet, friendlyStrength = null) => ({
  fleetId: fleet.ID,
  fleetName: fleet.displayName,
  factionId: fleet.factionId,
  factionName: fleet.factionName,
  currentLocation: fleet.orbitBody,
  destination: fleet.destination,
  destinationType: fleet.destinationType,
  destinationId: fleet.destinationId,
  arrivalDate: fleet.arrivalDate,
  ships: fleet.shipsCount ?? 0,
  combatPower: fleet.combatPower ?? null,
  combatPowerAvailable: fleet.combatPowerAvailable ?? false,
  dominantWeaponType: fleet.dominantWeaponType,
  weaponBreakdown: fleet.weaponBreakdown,
  inCombat: fleet.inCombat ?? false,
  friendlyStrengthAtDestination: friendlyStrength
});

export const transferResourceRow = (transfer) => ({
  id: transfer.id,
  sourceFactionId: transfer.sourceFactionId,
  sourceFactionName: transfer.sourceFactionName,
  targetFactionId: transfer.targetFactionId,
  targetFactionName: transfer.targetFactionName,
  resource: transfer.resource,
  amountPerDay: transfer.amountPerDay,
  expiry: transfer.expiry
});

export const researchResourceRows = (snapshot) => {
  const globalResearch = snapshot.globalResearch || {};
  const slots = asArray(globalResearch.activeSlots).map(slot => ({
    type: 'global-slot',
    slotNumber: slot.slotNumber,
    projectId: slot.projectId || slot.techId,
    projectName: slot.displayName,
    dataName: slot.techId || slot.projectId,
    percent: slot.percent,
    accumulatedResearch: slot.accumulatedResearch,
    totalCost: slot.totalCost,
    leadFactionId: slot.leadFactionId,
    leadFactionName: slot.leadFactionName
  }));
  const factionProjects = asArray(snapshot.factions).flatMap(faction =>
    asArray(faction.currentProjects).map(project => ({
      type: 'faction-project',
      factionId: faction.ID,
      factionName: faction.displayName,
      projectId: project.projectId || project.ID,
      projectName: project.displayName,
      dataName: project.projectId || project.ID,
      percent: project.percent,
      accumulatedResearch: project.accumulatedResearch,
      totalCost: project.totalCost
    }))
  );
  return { rows: [...slots, ...factionProjects], finishedGlobalProjects: asArray(globalResearch.finishedTechsNames) };
};

export const findAlienFaction = (snapshot) => {
  const factions = asArray(snapshot.factions);
  return factions.find(faction => faction.ID === ALIEN_FACTION_ID || faction.displayName === ALIEN_FACTION_DISPLAY_NAME) || null;
};

export const summaryResource = (snapshot) => {
  const factions = asArray(snapshot.factions);
  const alienFaction = findAlienFaction(snapshot);
  const alienFleets = asArray(snapshot.fleets).filter(fleet => fleet.factionId === alienFaction?.ID);
  const alienHabs = asArray(snapshot.habs).filter(hab => hab.factionId === alienFaction?.ID);
  const fleetsByBody = {};
  for (const fleet of alienFleets) {
    const body = fleet.orbitBody || 'Deep Space';
    fleetsByBody[body] ||= { fleets: 0, ships: 0 };
    fleetsByBody[body].fleets += 1;
    fleetsByBody[body].ships += Number.isFinite(fleet.shipsCount) ? fleet.shipsCount : 0;
  }
  const weaponMix = {};
  for (const fleet of alienFleets) {
    const type = fleet.dominantWeaponType || 'Unknown';
    weaponMix[type] ||= { fleets: 0, ships: 0 };
    weaponMix[type].fleets += 1;
    weaponMix[type].ships += Number.isFinite(fleet.shipsCount) ? fleet.shipsCount : 0;
  }
  return {
    metadata: snapshot.metadata,
    factions: factions.map(factionResourceRow),
    alien: {
      factionId: alienFaction?.ID ?? null,
      factionName: alienFaction?.displayName ?? null,
      alienHate: alienFaction?.alienHate?.actual ?? alienFaction?.alienHate?.visibleEstimate ?? null,
      fleets: alienFleets.length,
      ships: alienFleets.reduce((total, fleet) => total + (Number.isFinite(fleet.shipsCount) ? fleet.shipsCount : 0), 0),
      habs: alienHabs.length,
      fleetsByBody,
      weaponMix,
      earthMarsHabs: alienHabs.filter(hab => /earth|mars/i.test(hab.orbitBody || '') || hab.inEarthLEO).length,
      councilors: asArray(snapshot.councilors).filter(councilor => councilor.factionId === alienFaction?.ID).length
    },
    capabilities: snapshot.capabilities,
    priorityTargetFaction: snapshot.priorityTargetFaction,
    alienHateEconomics: snapshot.alienHateEconomics ?? null
  };
};
