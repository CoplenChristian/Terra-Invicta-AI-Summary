// shared/intelResources.mjs
//
// Pure snapshot projection builders shared by the local Express server (loaded
// via require(esm)) and the hosted Cloudflare worker (ESM import). Keep this
// file free of any runtime-specific imports so it stays usable in both.

import { ALIEN_FACTION_ID, ALIEN_FACTION_DISPLAY_NAME } from './constants.mjs';
import { buildAlienHateEconomics, ALIEN_HATE_WAR_THRESHOLD } from './alienHateEconomics.mjs';

export const SUPPORTED_RESOURCES = new Set([
  'summary', 'factions', 'nations', 'councilors', 'habs', 'hab-sites',
  'mining', 'fleets', 'ships', 'research', 'capabilities', 'alien',
  'resources', 'hab-modules', 'shipyards', 'shipyard-queues', 'arrivals', 'transfers',
  'logistics', 'construction', 'ship-designs', 'theaters', 'infrastructure',
  'alien-threat', 'delta', 'mobility', 'production-plan', 'body-status',
  'mining-prospects'
]);

// Public discovery map shared by the local Express API and hosted worker.
// Keep these as path-only links so external analysis clients can discover the
// focused routes before adding observer/mode/faction filters themselves.
export const INTEL_ENDPOINT_INDEX = Object.freeze({
  summary: '/api/intel/summary',
  factions: '/api/intel/factions',
  nations: '/api/intel/nations',
  councilors: '/api/intel/councilors',
  habs: '/api/intel/habs',
  habSites: '/api/intel/hab-sites',
  mining: '/api/intel/mining',
  fleets: '/api/intel/fleets',
  ships: '/api/intel/ships',
  research: '/api/intel/research',
  capabilities: '/api/intel/capabilities',
  alien: '/api/intel/alien',
  resources: '/api/intel/resources',
  habModules: '/api/intel/hab-modules',
  shipyards: '/api/intel/shipyards',
  shipyardQueues: '/api/intel/shipyard-queues',
  arrivals: '/api/intel/arrivals',
  transfers: '/api/intel/transfers',
  logistics: '/api/intel/logistics',
  construction: '/api/intel/construction',
  shipDesigns: '/api/intel/ship-designs',
  theaters: '/api/intel/theaters',
  infrastructure: '/api/intel/infrastructure',
  alienThreat: '/api/intel/alien-threat',
  delta: '/api/intel/delta',
  mobility: '/api/intel/mobility',
  productionPlan: '/api/intel/production-plan',
  bodyStatus: '/api/intel/body-status',
  miningProspects: '/api/intel/mining-prospects',
  history: '/api/intel/history',
  strategicDelta: '/api/intel/strategic-delta',
  techTree: '/api/intel/tech-tree',
  techPath: '/api/intel/tech-path',
  techSearch: '/api/intel/tech-search',
  techMilestones: '/api/intel/tech-milestones',
  techMatrix: '/api/intel/tech-matrix',
  techOpportunities: '/api/intel/tech-opportunities',
  researchQueue: '/api/intel/research-queue'
});

export const INTEL_ENDPOINT_EXAMPLES = Object.freeze({
  summary: '?observer=4712&mode=omniscient',
  factions: '?observer=4712&mode=omniscient',
  nations: '?observer=4712&mode=omniscient&faction=4712',
  councilors: '?observer=4712&mode=omniscient&faction=4712',
  habs: '?observer=4712&mode=omniscient&faction=4712',
  habSites: '?observer=4712&mode=omniscient&body=Ceres',
  mining: '?observer=4712&mode=omniscient&body=Ceres&sort=water',
  fleets: '?observer=4712&mode=omniscient&faction=4717',
  ships: '?observer=4712&mode=omniscient&faction=4717',
  research: '?observer=4712&mode=omniscient',
  capabilities: '?observer=4712&mode=omniscient',
  alien: '?observer=4712&mode=omniscient',
  resources: '?observer=4712&mode=omniscient&faction=4712',
  habModules: '?observer=4712&mode=omniscient&faction=4712',
  shipyards: '?observer=4712&mode=omniscient&faction=4712',
  shipyardQueues: '?observer=4712&mode=omniscient&faction=4712',
  arrivals: '?observer=4712&mode=omniscient',
  transfers: '?observer=4712&mode=omniscient&destination=Mars',
  logistics: '?observer=4712&mode=omniscient',
  construction: '?observer=4712&mode=omniscient&faction=4712',
  shipDesigns: '?observer=4712&mode=omniscient&faction=4712',
  theaters: '?observer=4712&mode=omniscient',
  infrastructure: '?observer=4712&mode=omniscient&body=Mars',
  alienThreat: '?observer=4712&mode=omniscient',
  delta: '?observer=4712&mode=omniscient',
  mobility: '?observer=4712&mode=omniscient',
  productionPlan: '?observer=4712&mode=omniscient&design=playerShipTemplate584&quantity=4',
  bodyStatus: '?observer=4712&mode=omniscient&body=Mars',
  miningProspects: '?observer=4712&mode=omniscient&theater=belt&limit=10',
  history: '?limit=20',
  strategicDelta: '?observer=4712',
  techTree: '?observer=4712&mode=omniscient&category=all',
  techPath: '?observer=4712&mode=omniscient&target=Project_RailCannonMk3',
  techSearch: '?observer=4712&mode=omniscient&q=battlecruiser',
  techMilestones: '?observer=4712&mode=omniscient&category=ship_hull',
  techMatrix: '?observer=4712&mode=omniscient',
  techOpportunities: '?observer=4712&mode=omniscient',
  researchQueue: '?observer=4712&mode=omniscient'
});

export const asArray = (value) => (Array.isArray(value) ? value : []);

export const normalizeBody = (value) => String(value || '')
  .trim()
  .replace(/^\d+\s+/, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

export const factionMatches = (item, factionId) => {
  if (factionId === null || factionId === undefined) return true;
  const controlPointIds = asArray(item.controlPoints).map(cp => cp?.factionId);
  return [item.ID, item.id, item.factionId, item.executiveFactionId, ...controlPointIds]
    .some(id => Number(id) === Number(factionId));
};

export const bodyMatches = (item, body) => {
  if (!body) return true;
  const itemBody = item.orbitBody || item.parentBodyName || item.body || item.location;
  return normalizeBody(itemBody) === normalizeBody(body);
};

export const destinationMatches = (item, destination) => {
  if (!destination) return true;
  const target = item.destination || item.destinationId || item.orbitBody;
  return normalizeBody(target) === normalizeBody(destination);
};

export const rateMultiplier = (site) => {
  return String(site?.resourceRateUnit || '').toLowerCase().includes('month') ? 1 : 30;
};

export const normalizeCostObject = (cost) => {
  const result = { water: 0, volatiles: 0, metals: 0, nobles: 0, fissiles: 0, money: 0, boost: 0 };
  if (!cost) return result;
  if (Array.isArray(cost)) {
    for (const entry of cost) {
      const name = String(entry.resource || entry.name || '').toLowerCase();
      const amount = Number(entry.amount || entry.value || 0);
      if (name.includes('water')) result.water += amount;
      else if (name.includes('volatile')) result.volatiles += amount;
      else if (name.includes('noble')) result.nobles += amount;
      else if (name.includes('metal')) result.metals += amount;
      else if (name.includes('fissile')) result.fissiles += amount;
      else if (name.includes('money')) result.money += amount;
      else if (name.includes('boost')) result.boost += amount;
    }
  } else if (typeof cost === 'object') {
    for (const [k, v] of Object.entries(cost)) {
      const name = k.toLowerCase();
      const amount = Number(v) || 0;
      if (name.includes('water')) result.water += amount;
      else if (name.includes('volatile')) result.volatiles += amount;
      else if (name.includes('noble')) result.nobles += amount;
      else if (name.includes('metal')) result.metals += amount;
      else if (name.includes('fissile')) result.fissiles += amount;
      else if (name.includes('money')) result.money += amount;
      else if (name.includes('boost')) result.boost += amount;
    }
  }
  for (const k of Object.keys(result)) {
    result[k] = Number(result[k].toFixed(1));
  }
  return result;
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
  effectiveMonthlyOutput: Number((((site.water || 0) + (site.volatiles || 0) + (site.metals || 0) + (site.nobleMetals || 0) + (site.fissiles || 0)) * rateMultiplier(site)).toFixed(1)),
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

// =============================================================================
// NEW & ENHANCED STRATEGIC INTELLIGENCE PROJECTION BUILDERS
// =============================================================================

/**
 * 1. Logistics: Exposes the actual war economy, gross vs net resource flows,
 * committed queues, and production by body/site.
 */
export const logisticsResource = (snapshot, observerId = 4712) => {
  const factions = asArray(snapshot.factions);
  const observer = factions.find(f => Number(f.ID) === Number(observerId)) ||
                   factions.find(f => f.displayName === 'the Initiative') ||
                   factions[0] || {};
  const actualObsId = observer.ID || observerId;
  const stock = observer.resources || {};
  const sites = asArray(snapshot.habSites).filter(s => Number(s.factionId) === Number(actualObsId));

  const resourceKeys = [
    { key: 'Water', alias: 'water', label: 'Water' },
    { key: 'Volatiles', alias: 'volatiles', label: 'Volatiles' },
    { key: 'Metals', alias: 'metals', label: 'Metals' },
    { key: 'NobleMetals', alias: 'nobles', label: 'Noble metals' },
    { key: 'Fissiles', alias: 'fissiles', label: 'Fissiles' }
  ];

  // Upkeep from operational modules
  const ownModules = asArray(snapshot.habModules).filter(m => Number(m.factionId) === Number(actualObsId) && m.constructionCompleted && m.powered !== false);
  const upkeepByResource = { Water: 0, Volatiles: 0, Metals: 0, NobleMetals: 0, Fissiles: 0, Money: 0 };
  for (const mod of ownModules) {
    if (mod.resourceUpkeep) {
      for (const [k, v] of Object.entries(mod.resourceUpkeep)) {
        if (upkeepByResource[k] !== undefined) upkeepByResource[k] += Number(v) || 0;
      }
    }
  }

  // Committed resources in active build queues
  const committedByResource = { Water: 0, Volatiles: 0, Metals: 0, NobleMetals: 0, Fissiles: 0 };
  const ownQueues = asArray(snapshot.shipyardQueues).filter(q => Number(q.factionId) === Number(actualObsId) && q.constructionStatus !== 'operational');
  for (const q of ownQueues) {
    for (const cost of asArray(q.resourcesCost)) {
      const resName = cost.resource || cost.name;
      if (committedByResource[resName] !== undefined) {
        committedByResource[resName] += Number(cost.amount) || 0;
      }
    }
  }
  const ownBuildingModules = asArray(snapshot.habModules).filter(m => Number(m.factionId) === Number(actualObsId) && m.constructionStatus === 'building');
  for (const m of ownBuildingModules) {
    for (const cost of asArray(m.buildCost)) {
      const resName = cost.resource || cost.name;
      if (committedByResource[resName] !== undefined) {
        committedByResource[resName] += Number(cost.amount) || 0;
      }
    }
  }

  const productionByBody = {};
  const topSites = [];

  for (const s of sites) {
    const body = s.parentBodyName || 'Unknown';
    if (!productionByBody[body]) {
      productionByBody[body] = { water: 0, volatiles: 0, metals: 0, nobles: 0, fissiles: 0, sitesCount: 0 };
    }
    const mult = rateMultiplier(s);
    const w = (Number(s.water) || 0) * mult;
    const v = (Number(s.volatiles) || 0) * mult;
    const m = (Number(s.metals) || 0) * mult;
    const n = (Number(s.nobleMetals) || 0) * mult;
    const f = (Number(s.fissiles) || 0) * mult;

    productionByBody[body].water += w;
    productionByBody[body].volatiles += v;
    productionByBody[body].metals += m;
    productionByBody[body].nobles += n;
    productionByBody[body].fissiles += f;
    productionByBody[body].sitesCount += 1;

    if (s.mineModuleName && (w + v + m + n + f > 0)) {
      topSites.push({
        site: s.displayName,
        body,
        monthlyTotal: Number((w + v + m + n + f).toFixed(1)),
        yields: {
          water: Number(w.toFixed(1)),
          volatiles: Number(v.toFixed(1)),
          metals: Number(m.toFixed(1)),
          nobles: Number(n.toFixed(1)),
          fissiles: Number(f.toFixed(1))
        }
      });
    }
  }
  for (const body of Object.keys(productionByBody)) {
    for (const resKey of Object.keys(productionByBody[body])) {
      if (typeof productionByBody[body][resKey] === 'number') {
        productionByBody[body][resKey] = Number(productionByBody[body][resKey].toFixed(1));
      }
    }
  }
  topSites.sort((a, b) => b.monthlyTotal - a.monthlyTotal);

  const resources = resourceKeys.map(({ key, alias, label }) => {
    const stockpile = Number((Number(stock[key]) || 0).toFixed(1));
    const grossDaily = sites.filter(s => s.mineModuleName).reduce((sum, s) => sum + (Number(s[key.toLowerCase()] || s[alias] || (key === 'NobleMetals' ? s.nobleMetals : 0)) || 0), 0);
    const grossMonthly = Number((grossDaily * 30).toFixed(1));
    const upkeepMonthly = Number((-1 * (upkeepByResource[key] || 0)).toFixed(1));
    const netMonthly = Number((grossMonthly + upkeepMonthly).toFixed(1));
    const committed = Number((committedByResource[key] || 0).toFixed(1));
    const availableAfterQueues = Number(Math.max(0, stockpile - committed).toFixed(1));

    return {
      resource: alias,
      label,
      stockpile,
      grossMonthly,
      upkeepMonthly,
      netMonthly,
      committedConstruction: committed,
      availableAfterQueues
    };
  });

  return {
    money: observer.resources?.Money || 0,
    boost: Number((observer.resources?.Boost || 0).toFixed(1)),
    missionControl: {
      used: observer.missionControlUsage ?? 0,
      cap: observer.missionControlCapacity ?? 0,
      available: Math.max(0, (observer.missionControlCapacity || 0) - (observer.missionControlUsage || 0))
    },
    resources,
    spent30d: observer.financials?.recent30Days?.expense ?? observer.monthlyExpense ?? null,
    spent90d: observer.financials?.recent30Days?.expense ? Number((observer.financials.recent30Days.expense * 3).toFixed(1)) : null,
    productionByBody,
    topSites: topSites.slice(0, 10)
  };
};

/**
 * 2. Construction: Consolidates all ship, hab, and module build queues.
 */
export const constructionResource = (snapshot, factionId = null, body = null) => {
  const items = [];

  // Ships in shipyard queues
  asArray(snapshot.shipyardQueues).forEach(q => {
    if (!factionMatches(q, factionId) || !bodyMatches(q, body)) return;
    items.push({
      type: 'ship',
      faction: q.factionName,
      factionId: q.factionId,
      body: q.orbitBody,
      location: q.habName || q.shipyardName,
      design: q.design,
      module: null,
      startDate: q.startDate,
      completionDate: q.completionDate,
      daysRemaining: q.daysToCompletion,
      cost: normalizeCostObject(q.resourcesCost),
      mcCost: 1,
      shipyardTier: 2,
      constructionStatus: q.constructionStatus
    });
  });

  // Hab modules under construction
  asArray(snapshot.habModules).forEach(m => {
    if (!factionMatches(m, factionId) || !bodyMatches(m, body)) return;
    if (m.constructionStatus !== 'building') return;
    items.push({
      type: 'module',
      faction: m.factionName,
      factionId: m.factionId,
      body: m.orbitBody,
      location: m.habName,
      design: null,
      module: m.name || m.templateName,
      startDate: m.startBuildDate,
      completionDate: m.completionDate,
      daysRemaining: m.daysRemaining,
      cost: normalizeCostObject(m.buildCost),
      mcCost: 0,
      shipyardTier: m.habTier,
      constructionStatus: m.constructionStatus
    });
  });

  // Hab sites pending/building
  asArray(snapshot.habSites).forEach(s => {
    if (!factionMatches(s, factionId) || !bodyMatches(s, body)) return;
    if (s.constructionStatus !== 'building' && !s.pendingHab) return;
    items.push({
      type: 'hab',
      faction: s.factionName,
      factionId: s.factionId,
      body: s.parentBodyName,
      location: s.displayName,
      design: null,
      module: s.mineModuleName || 'Hab Base',
      startDate: s.startBuildDate,
      completionDate: s.completionDate,
      daysRemaining: s.daysRemaining,
      cost: s.buildCost ? normalizeCostObject(s.buildCost) : { water: 50, volatiles: 20, metals: 60, nobles: 10, fissiles: 0, money: 100, boost: 5 },
      isEstimatedCost: !s.buildCost,
      mcCost: 1,
      shipyardTier: s.habTier || 1,
      constructionStatus: s.constructionStatus
    });
  });

  items.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));
  return items;
};

/**
 * 3. Transfers: Fleet orbital transfers with origin, destination, arrival dates,
 * and days remaining.
 */
export const transfersResource = (snapshot, factionId = null, body = null, destination = null) => {
  const gameDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : null;
  const items = [];

  asArray(snapshot.fleets).forEach(f => {
    const isMoving = f.destination || f.arrivalDate || (f.currentOrders && String(f.currentOrders).toLowerCase().includes('transfer'));
    if (!isMoving) return;
    if (!factionMatches(f, factionId)) return;
    if (body && !bodyMatches(f, body)) return;
    if (destination && !destinationMatches(f, destination)) return;

    const arrivalDate = f.arrivalDate;
    let daysRemaining = null;
    if (arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
      const arr = new Date(arrivalDate);
      if (!Number.isNaN(arr.getTime())) {
        daysRemaining = Math.max(0, Math.round((arr - gameDate) / 86400000));
      }
    }

    items.push({
      faction: f.factionName,
      factionId: f.factionId,
      fleet: f.displayName,
      fleetId: f.ID,
      origin: f.orbitBody || 'Unknown',
      destination: f.destination || 'In Transit',
      destinationType: f.destinationType || null,
      departure: f.launchDate || f.departureDate || null,
      arrival: arrivalDate || null,
      daysRemaining,
      shipCount: f.shipsCount || (Array.isArray(f.ships) ? f.ships.length : 0),
      mission: f.mission || f.currentOrders || 'Transfer',
      combatPower: f.combatPower ?? null,
      dominantWeaponType: f.dominantWeaponType || null
    });
  });

  items.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));
  return items;
};

/**
 * 4. Ship Designs: Detailed designs with component IDs, combat power, weapons,
 * armor, propulsion, and build counts.
 */
export const shipDesignsResource = (snapshot, factionId = null) => {
  const designs = asArray(snapshot.shipDesigns || asArray(snapshot.factions).flatMap(f => f.shipDesigns || []));
  const ships = asArray(snapshot.ships || asArray(snapshot.fleets).flatMap(fl => fl.ships || []));
  const queues = asArray(snapshot.shipyardQueues);
  const hullStatsByName = snapshot.shipHullStats || {};

  return designs
    .filter(d => factionMatches(d, factionId))
    .map(d => {
      const designName = d._displayName || d.displayName || d.friendlyName || d.dataName;
      const designId = d.dataName || d.id;
      const existing = ships.filter(s => s.hullName === designId || s.hullName === d.hullName || s.displayName === designName || s.design === designId).length;
      const underConstruction = queues.filter(q => (q.design === designId || q.hull === designId) && factionMatches(q, factionId)).length;

      const noseWeapons = asArray(d.noseWeaponTemplateEntries).map(w => w.moduleName || w.name || w);
      const hullWeapons = asArray(d.hullWeaponTemplateEntries).map(w => w.moduleName || w.name || w);
      const launcherCount = [...noseWeapons, ...hullWeapons].filter(w => /missile|torpedo/i.test(String(w))).length;
      const pdCount = [...noseWeapons, ...hullWeapons].filter(w => /pointdefense|pd|laser.*turret.*small/i.test(String(w))).length;

      const componentIds = [
        d.hullName,
        d.driveName,
        d.powerPlantName,
        d.radiatorName,
        d.noseArmor?.materialName,
        ...noseWeapons,
        ...hullWeapons,
        ...asArray(d.moduleTemplateEntries).map(m => m.moduleName || m.name || m)
      ].filter(Boolean);

      const hullStats = hullStatsByName[d.hullName] || {};
      const hullStatsKnown = Boolean(hullStatsByName[d.hullName]);

      return {
        designId,
        displayName: designName,
        factionId: d.factionId,
        factionName: d.factionName,
        hull: d.hullName,
        role: d.role || 'Combatant',
        noseWeapons,
        hullWeapons,
        launcherCount,
        pointDefenseCount: pdCount,
        armor: {
          nose: d.noseArmor?.armorValue ?? 0,
          lateral: d.lateralArmor?.armorValue ?? 0,
          tail: d.tailArmor?.armorValue ?? 0,
          material: d.noseArmor?.materialName || 'CompositeArmor'
        },
        drive: {
          name: d.driveName || 'Unknown',
          exhaustVelocity: d.exhaustVelocity ?? null,
          thrust: d.thrust ?? null
        },
        reactor: d.powerPlantName || null,
        radiator: d.radiatorName || null,
        battery: d.batteryName || null,
        utilities: asArray(d.moduleTemplateEntries).map(m => m.moduleName || m.name || m),
        wetMassKg: d.wetMassKg || null,
        dryMassKg: d.dryMassKg || null,
        propellantTons: (d.propellantTanks || 0) * 10,
        deltaVKps: d.deltaVKps ?? null,
        cruiseAccelerationMps2: d.cruiseAccelerationMps2 ?? null,
        combatAccelerationMps2: d.combatAccelerationMps2 ?? null,
        turnRate: d.turnRate ?? null,
        constructionCost: normalizeCostObject(d.constructionCost || { water: 120, volatiles: 60, metals: 250, nobleMetals: 40, fissiles: 10 }),
        isEstimatedCost: !d.constructionCost,
        // Real per-hull values from the game templates where available.
        // Mission Control varies by hull (Escort 1 ... Lancer 4) and is the
        // only input to the alien hate floor, so never flatten it to 1.
        buildTimeDays: d.buildTimeDays ?? hullStats.baseConstructionTimeDays ?? null,
        missionControl: hullStats.missionControl ?? null,
        constructionTier: hullStats.constructionTier ?? null,
        hullStatsSource: hullStatsKnown ? 'game-template' : 'unavailable',
        numberExisting: existing,
        numberUnderConstruction: underConstruction,
        componentIds
      };
    });
};

/**
 * 5. Theaters: Synthesized body-by-body military posture and threat assessment.
 */
export const theatersResource = (snapshot, observerId = 4712) => {
  const bodies = ['Earth', 'Luna', 'Mars', 'Ceres', 'Vesta', 'Mercury', 'Venus', 'Ganymede', 'Callisto', 'Europa', 'Io', 'Titan'];
  const fleets = asArray(snapshot.fleets);
  const habs = asArray(snapshot.habs);
  const sites = asArray(snapshot.habSites);
  const queues = asArray(snapshot.shipyardQueues);
  const transfers = transfersResource(snapshot);

  const alienFaction = findAlienFaction(snapshot);
  const alienId = alienFaction?.ID;

  return bodies.map(bodyName => {
    const norm = normalizeBody(bodyName);
    const bodyFleets = fleets.filter(f => normalizeBody(f.orbitBody) === norm);
    const bodyHabs = habs.filter(h => normalizeBody(h.orbitBody) === norm);
    const bodySites = sites.filter(s => normalizeBody(s.parentBodyName) === norm);
    const bodyQueues = queues.filter(q => normalizeBody(q.orbitBody) === norm);

    const friendlyFleets = bodyFleets.filter(f => Number(f.factionId) === Number(observerId));
    const hostileFleets = bodyFleets.filter(f => Number(f.factionId) === Number(alienId) || (f.factionName && f.factionName.toLowerCase().includes('servant')));

    const friendlyShips = friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const hostileShips = hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const friendlyCP = friendlyFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0);
    const hostileCP = hostileFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0);

    const friendlyHabs = bodyHabs.filter(h => Number(h.factionId) === Number(observerId)).length;
    const friendlyYards = bodyHabs.filter(h => Number(h.factionId) === Number(observerId) && (h.isShipyard || h.shipyardCount > 0)).length;
    const friendlyMines = bodySites.filter(s => Number(s.factionId) === Number(observerId) && s.mineModuleName).length;

    // Incoming hostile transfers
    const incomingHostile = transfers.filter(t =>
      normalizeBody(t.destination) === norm &&
      (Number(t.factionId) === Number(alienId) || (t.faction && t.faction.toLowerCase().includes('servant')))
    );
    const incomingHostileShips = incomingHostile.reduce((sum, t) => sum + (t.shipCount || 0), 0);
    const nearestArrivalDays = incomingHostile.length > 0
      ? Math.min(...incomingHostile.map(t => t.daysRemaining ?? 999))
      : null;
    const nearestArrivalDate = incomingHostile.length > 0
      ? incomingHostile.sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999))[0].arrival
      : null;

    // Ships completing before threat arrival
    const completingBefore = nearestArrivalDays !== null
      ? bodyQueues.filter(q => Number(q.factionId) === Number(observerId) && (q.daysToCompletion ?? 999) <= nearestArrivalDays).length
      : bodyQueues.filter(q => Number(q.factionId) === Number(observerId)).length;

    let status = 'UNCONTESTED';
    if (incomingHostileShips > 0 && nearestArrivalDays !== null && nearestArrivalDays <= 120) {
      status = 'THREAT_IMMINENT';
    } else if (hostileShips > 0) {
      status = 'CONTESTED';
    } else if (friendlyShips > 0 || friendlyHabs > 0) {
      status = 'SECURE';
    }

    return {
      body: bodyName,
      status,
      friendly: {
        ships: friendlyShips,
        fleets: friendlyFleets.length,
        combatPower: friendlyCP,
        habs: friendlyHabs,
        shipyards: friendlyYards,
        mines: friendlyMines
      },
      hostile: {
        ships: hostileShips,
        fleets: hostileFleets.length,
        combatPower: hostileCP,
        factions: Array.from(new Set(hostileFleets.map(f => f.factionName).filter(Boolean)))
      },
      incoming: {
        hostileShips: incomingHostileShips,
        hostileFleets: incomingHostile.length,
        nearestArrivalDays,
        nearestArrivalDate
      },
      production: {
        shipsCompletingBeforeThreatArrival: completingBefore,
        totalQueuedShips: bodyQueues.filter(q => Number(q.factionId) === Number(observerId)).length
      }
    };
  });
};

/**
 * 6. Infrastructure: Deep hab module manifests, power balance, and capabilities.
 */
export const infrastructureResource = (snapshot, factionId = null, body = null) => {
  return asArray(snapshot.habs)
    .filter(h => factionMatches(h, factionId) && bodyMatches(h, body))
    .map(h => {
      const habModules = asArray(snapshot.habModules).filter(m => m.habId === h.ID);
      const operational = habModules.filter(m => m.constructionCompleted && !m.destroyed);

      const moduleSummary = {
        shipyards: operational.filter(m => m.isShipyard || /shipyard|spacedock/i.test(m.name || '')).length,
        layeredDefenseArrays: operational.filter(m => /layereddefense|lda/i.test(m.name || '')).length,
        pointDefense: operational.filter(m => /pointdefense|pd/i.test(m.name || '')).length,
        farms: operational.filter(m => /farm|hydroponic/i.test(m.name || '')).length,
        solar: operational.filter(m => /solar/i.test(m.name || '')).length,
        reactors: operational.filter(m => /reactor|fission|fusion/i.test(m.name || '')).length,
        mines: operational.filter(m => /mine/i.test(m.name || '')).length,
        labs: operational.filter(m => /lab|research/i.test(m.name || '')).length,
        constructionModules: operational.filter(m => /construction/i.test(m.name || '')).length
      };

      const strategicCapabilities = [];
      if (moduleSummary.shipyards > 0) strategicCapabilities.push('shipbuilding');
      if (moduleSummary.shipyards > 0 || moduleSummary.constructionModules > 0) strategicCapabilities.push('repair', 'refuel');
      if (moduleSummary.layeredDefenseArrays > 0 || moduleSummary.pointDefense > 0) strategicCapabilities.push('defense');
      if (moduleSummary.mines > 0) strategicCapabilities.push('mining');
      if (moduleSummary.labs > 0) strategicCapabilities.push('research');

      const site = asArray(snapshot.habSites).find(s => s.habId === h.ID);

      return {
        habId: h.ID,
        name: h.displayName,
        factionId: h.factionId,
        factionName: h.factionName,
        body: h.orbitBody,
        spaceTheaterKey: h.spaceTheaterKey,
        spaceTheaterName: h.spaceTheaterName,
        tier: h.tier || 1,
        type: h.habType || (site ? 'base' : 'station'),
        modules: moduleSummary,
        strategicCapabilities,
        power: {
          generated: 150 * Math.max(1, moduleSummary.reactors + moduleSummary.solar),
          required: 120,
          net: 30
        },
        crew: 50 * (h.tier || 1),
        missionControlUsage: 1 + (moduleSummary.mines > 0 ? 2 : 0) + (moduleSummary.shipyards > 0 ? 1 : 0),
        resourceUpkeep: {
          water: moduleSummary.farms > 0 ? -2 : 5,
          volatiles: 3,
          metals: 4,
          money: 15
        },
        mineOutput: site ? {
          water: Number(((Number(site.water) || 0) * 30).toFixed(1)),
          volatiles: Number(((Number(site.volatiles) || 0) * 30).toFixed(1)),
          metals: Number(((Number(site.metals) || 0) * 30).toFixed(1)),
          nobles: Number(((Number(site.nobleMetals) || 0) * 30).toFixed(1)),
          fissiles: Number(((Number(site.fissiles) || 0) * 30).toFixed(1))
        } : null,
        constructionStatus: h.inCombat ? 'in-combat' : 'operational'
      };
    });
};

/**
 * Mining prospects: ranks UNOWNED hab sites as expansion targets.
 *
 * Two percentiles are reported per resource, because "best of its type" and
 * "good in absolute terms" are different questions -- conflating them is what
 * produced the doctrine error of treating generic Common Carbonaceous sites
 * (shared by ~95 of 671 sites) as notable water/volatile producers.
 *
 * Scoring is scarcity-weighted, not raw yield: noble metals bind military
 * construction (17-38% of most component build costs, 0% for drives) and cap
 * far lower across the solar system than base metals, so an unweighted sum
 * would rank metal sites first and reproduce that same mistake.
 */
export const MINING_SCARCITY_WEIGHTS = Object.freeze({
  nobleMetals: 3.0,
  fissiles: 3.0,
  volatiles: 1.5,
  water: 1.0,
  metals: 1.0
});

const MINING_RESOURCE_KEYS = Object.freeze(['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles']);

const percentileOf = (value, population) => {
  if (!Number.isFinite(value) || population.length === 0) return null;
  const below = population.filter(v => v < value).length;
  const equal = population.filter(v => v === value).length;
  // Midpoint rank, so a value tied with many others lands mid-band rather than
  // at the top -- which is exactly the Fortuna/Zelinda case.
  return Math.round(((below + equal / 2) / population.length) * 100);
};

export const miningProspectsResource = (snapshot, {
  weights = null,
  limit = null,
  theater = null
} = {}) => {
  const effectiveWeights = weights || snapshot.miningScarcityWeights || MINING_SCARCITY_WEIGHTS;
  const sites = asArray(snapshot.habSites);
  const rate = (site, key) => {
    const value = Number(site[key]);
    return Number.isFinite(value) ? value : 0;
  };

  // Global population per resource, across every site in the system.
  const globalPop = {};
  for (const key of MINING_RESOURCE_KEYS) globalPop[key] = sites.map(s => rate(s, key));

  // Population per mining profile, so "best of its type" is answerable.
  const byProfile = new Map();
  for (const site of sites) {
    const profile = site.mineModuleTemplate || site.miningProfileName || 'unknown';
    if (!byProfile.has(profile)) byProfile.set(profile, []);
    byProfile.get(profile).push(site);
  }

  // Raw yield alone ranks the outer system first -- Haumea, Makemake, Varuna --
  // which is useless to a fleet that cannot get there. Theater is therefore a
  // first-class filter, not a display field.
  const wantTheater = theater === null || theater === undefined
    ? null
    : String(theater).toLowerCase();

  const unowned = sites.filter(site => {
    const unclaimed = site.factionId === null || site.factionId === undefined
      || String(site.factionName || '').toLowerCase() === 'unclaimed';
    if (!unclaimed || site.pendingHab) return false;
    if (wantTheater === null) return true;
    return String(site.spaceTheaterKey || '').toLowerCase() === wantTheater
      || String(site.spaceTheaterName || '').toLowerCase() === wantTheater;
  });

  const scored = unowned.map(site => {
    const profile = site.mineModuleTemplate || site.miningProfileName || 'unknown';
    const peers = byProfile.get(profile) || [];

    const resources = {};
    let score = 0;
    for (const key of MINING_RESOURCE_KEYS) {
      const value = rate(site, key);
      const weight = effectiveWeights[key] ?? 1;
      score += value * weight;
      resources[key] = {
        perDay: value,
        globalPercentile: percentileOf(value, globalPop[key]),
        profilePercentile: percentileOf(value, peers.map(p => rate(p, key)))
      };
    }

    return {
      siteId: site.ID,
      name: site.displayName,
      body: site.parentBodyName,
      theater: site.spaceTheaterName || site.spaceTheaterKey || null,
      miningProfile: profile === 'unknown' ? null : profile,
      profilePeerCount: peers.length,
      resources,
      scarcityScore: Number(score.toFixed(3))
    };
  }).sort((a, b) => b.scarcityScore - a.scarcityScore);

  const ranked = limit ? scored.slice(0, Number(limit)) : scored;

  return {
    weights: effectiveWeights,
    totalSites: sites.length,
    unownedSites: unowned.length,
    ranked,
    note: 'Unowned sites only. profilePercentile ranks a site against others sharing its mining profile; globalPercentile ranks it against every site in the system.'
  };
};

/**
 * 7. Alien Threat: Precise hate math, minimum-hate floor, and retaliation mechanics.
 */
export const alienThreatResource = (snapshot, observerId = 4712) => {
  const observer = asArray(snapshot.factions).find(f => Number(f.ID) === Number(observerId)) || {};
  const difficulty = snapshot.metadata?.difficulty || 'Normal';

  // Do NOT reimplement the hate floor here. buildAlienHateEconomics is the
  // single source of truth and is what the dashboard card renders: difficulty
  // multipliers are 0.05/0.30/0.60/1.00, and each completed concealment
  // project multiplies the floor by 0.8 (they compound, they do not add).
  // This resource reports raw save values; callers pass an already
  // intel-filtered snapshot, so read the actual hate rather than masking it.
  const economics = buildAlienHateEconomics({ observer, difficulty, mode: 'omniscient' });

  const round1 = (value) => (value === null ? null : Number(Number(value).toFixed(1)));
  const projectKey = (id) => {
    const bare = String(id).replace(/^Project_/, '');
    return bare.charAt(0).toLowerCase() + bare.slice(1);
  };

  const projects = { applicable: [], completed: [] };
  for (const project of economics.reductionProjects) {
    projects[projectKey(project.id)] = project.completed;
    if (project.applicable) projects.applicable.push(project.id);
    if (project.completed) projects.completed.push(project.id);
  }
  // Reduction is multiplicative: n projects leave 0.8^n of the floor standing.
  projects.concealmentMultiplier = economics.concealmentMultiplier;
  projects.totalReductionPercent = Math.round((1 - economics.concealmentMultiplier) * 100);

  const actualHate = economics.actualAlienHate;
  const atWar = actualHate === null ? null : actualHate >= ALIEN_HATE_WAR_THRESHOLD;

  // Fields the save parser does not currently produce. Emit null (unknown)
  // rather than 0, which would read as a verified "this never happened".
  const unknownIfAbsent = (value) => (value === undefined || value === null ? null : value);
  const investigations = observer.alienInvestigations;
  const alienInvestigationCount = Array.isArray(investigations)
    ? investigations.length
    : Number.isFinite(Number(investigations)) ? Number(investigations) : null;

  return {
    actualHate: round1(actualHate),
    usedMC: economics.usedMissionControl,
    difficulty,
    difficultyMultiplier: economics.difficultyMultiplier,
    projects,
    minimumHate: round1(economics.minimumAlienHate),
    ventableHate: round1(economics.hateAboveFloor),
    warThreshold: ALIEN_HATE_WAR_THRESHOLD,
    minimumHateMCThreshold: economics.mcWarFloor === null ? null : Math.floor(economics.mcWarFloor),
    calculation: economics.formula.text,
    // Hate above the floor is not automatically recoverable. The aliens only
    // vent hate when they destroy an asset AND all of the following hold.
    venting: {
      ventableHate: round1(economics.hateAboveFloor),
      guaranteed: false,
      conditions: [
        'Not at Total War with the aliens',
        'Asset not Trespassing (at/beyond Jupiter, or anywhere the aliens hold a hab, except Earth)',
        'Asset was actually targeted by the aliens (self-defence kills do not vent)'
      ],
      shipVentValue: 'hull Construction Tier',
      habModuleVentValue: 'ModuleTier^2 (+Tier if Mining Complex, +Tier if Construction Module), divided by 2/3/4/5 for Cinematic/Normal/Veteran/Brutal'
    },
    // Every hate modifier the game applies is scaled by a random 0.8-1.2,
    // so any delta derived from these values carries at least +/-20% error.
    hateModifierVariance: { min: 0.8, max: 1.2 },
    retaliation: {
      retaliationActive: atWar,
      retaliationReason: atWar === null
        ? 'UNAVAILABLE — alien hate not exposed in this snapshot'
        : atWar
          ? `Alien hate crossed the war threshold (${ALIEN_HATE_WAR_THRESHOLD})`
          : 'None',
      // Killing an alien councilor marks up to 3 space assets for death for
      // 5 years, independent of current hate. Assassinate triggers this only
      // on a normal success; Detain never triggers it.
      alienInvestigationCount,
      aliensRemoved: unknownIfAbsent(observer.aliensRemoved),
      factionAssassinations: unknownIfAbsent(observer.factionAssassinations),
      lastDateOfFixedAlienHate: unknownIfAbsent(observer.lastDateOfFixedAlienHate),
      unavailableFields: ['aliensRemoved', 'factionAssassinations', 'lastDateOfFixedAlienHate']
        .filter(field => observer[field] === undefined || observer[field] === null)
    }
  };
};

/**
 * 8. Delta: Turn-to-turn changes between snapshots.
 */
export const deltaResource = (snapshot, previousSnapshot, observerId = 4712) => {
  const currentObs = asArray(snapshot.factions).find(f => Number(f.ID) === Number(observerId)) || {};
  const currentAlien = findAlienFaction(snapshot) || {};
  const curDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : new Date();

  if (!previousSnapshot) {
    return {
      comparisonAvailable: false,
      gameDaysElapsed: null,
      previousDate: null,
      currentDate: snapshot.metadata?.gameTimeString || null,
      changes: null,
      events: ['Single-save context: no previous save comparison available.']
    };
  }

  const prevObs = asArray(previousSnapshot?.factions).find(f => Number(f.ID) === Number(observerId)) || {};
  const prevAlien = findAlienFaction(previousSnapshot || {}) || {};
  const prevDate = previousSnapshot?.metadata?.gameTimeString ? new Date(previousSnapshot.metadata.gameTimeString) : null;
  const gameDaysElapsed = prevDate && !Number.isNaN(prevDate.getTime())
    ? Math.max(0, Math.round((curDate - prevDate) / 86400000))
    : null;

  const curShips = currentObs.shipsCount ?? 0;
  const prevShips = prevObs.shipsCount ?? curShips;
  const curAlienShips = currentAlien.shipsCount ?? 0;
  const prevAlienShips = prevAlien.shipsCount ?? curAlienShips;
  const curHate = currentObs.assessedAlienHateOfMe ?? 0;
  const prevHate = prevObs.assessedAlienHateOfMe ?? curHate;

  const curRes = currentObs.resources || {};
  const prevRes = prevObs.resources || {};

  const events = [];
  if (curShips > prevShips) events.push(`Initiative commissioned ${curShips - prevShips} new ship(s)`);
  if (curAlienShips > prevAlienShips) events.push(`Aliens deployed ${curAlienShips - prevAlienShips} new ship(s)`);
  if (curHate > prevHate) events.push(`Alien hate increased by ${(curHate - prevHate).toFixed(1)}`);
  else if (curHate < prevHate) events.push(`Alien hate decreased by ${(prevHate - curHate).toFixed(1)}`);
  if (events.length === 0) events.push('Campaign operational status sustained without major strategic losses.');

  return {
    comparisonAvailable: true,
    gameDaysElapsed,
    previousDate: previousSnapshot?.metadata?.gameTimeString || null,
    currentDate: snapshot.metadata?.gameTimeString || null,
    changes: {
      initiativeShips: { from: prevShips, to: curShips, diff: curShips - prevShips },
      alienShips: { from: prevAlienShips, to: curAlienShips, diff: curAlienShips - prevAlienShips },
      alienHate: { from: Number(prevHate.toFixed(1)), to: Number(curHate.toFixed(1)), diff: Number((curHate - prevHate).toFixed(1)) },
      water: { from: prevRes.Water || 0, to: curRes.Water || 0, diff: (curRes.Water || 0) - (prevRes.Water || 0) },
      volatiles: { from: prevRes.Volatiles || 0, to: curRes.Volatiles || 0, diff: (curRes.Volatiles || 0) - (prevRes.Volatiles || 0) },
      metals: { from: prevRes.Metals || 0, to: curRes.Metals || 0, diff: (curRes.Metals || 0) - (prevRes.Metals || 0) },
      nobles: { from: prevRes.NobleMetals || 0, to: curRes.NobleMetals || 0, diff: (curRes.NobleMetals || 0) - (prevRes.NobleMetals || 0) },
      fissiles: { from: prevRes.Fissiles || 0, to: curRes.Fissiles || 0, diff: (curRes.Fissiles || 0) - (prevRes.Fissiles || 0) }
    },
    events
  };
};

/**
 * 9. Mining: Mining economy, sortable yields, and top colonization deposits.
 */
export const miningAnalysisResource = (snapshot, factionId = null, body = null, status = null, sort = null) => {
  let sites = asArray(snapshot.habSites).map(miningResourceRow);

  if (factionId !== null) sites = sites.filter(s => factionMatches(s, factionId));
  if (body) sites = sites.filter(s => bodyMatches(s, body));
  if (status === 'unclaimed') sites = sites.filter(s => !s.owner || s.owner === 'Unclaimed');

  if (sort === 'water') sites.sort((a, b) => b.water - a.water);
  else if (sort === 'volatiles') sites.sort((a, b) => b.volatiles - a.volatiles);
  else if (sort === 'metals') sites.sort((a, b) => b.metals - a.metals);
  else if (sort === 'nobles' || sort === 'nobleMetals') sites.sort((a, b) => b.nobles - a.nobles);
  else if (sort === 'fissiles') sites.sort((a, b) => b.fissiles - a.fissiles);

  const allSites = asArray(snapshot.habSites).map(miningResourceRow);
  const unclaimed = allSites.filter(s => !s.owner || s.owner === 'Unclaimed');

  const bestWater = [...unclaimed].sort((a, b) => b.water - a.water).slice(0, 5);
  const bestNobles = [...unclaimed].sort((a, b) => b.nobles - a.nobles).slice(0, 5);
  const bestFissiles = [...unclaimed].sort((a, b) => b.fissiles - a.fissiles).slice(0, 5);
  const ourBuildingMines = allSites.filter(s => s.owner === snapshot.observerFactionName && s.constructionStatus === 'building');

  return {
    items: sites,
    bestAvailableWaterSites: bestWater,
    bestAvailableNobleSites: bestNobles,
    bestAvailableFissileSites: bestFissiles,
    ourMinesUnderConstruction: ourBuildingMines
  };
};

/**
 * 10. Mobility: Fleet transfer feasibility and travel-time estimates.
 */
export const mobilityResource = (snapshot, fleetId, observerId = 4712) => {
  const fleet = asArray(snapshot.fleets).find(f => String(f.ID) === String(fleetId)) ||
                asArray(snapshot.fleets).find(f => Number(f.factionId) === Number(observerId)) ||
                asArray(snapshot.fleets)[0];

  if (!fleet) return { error: 'Fleet not found', items: [] };

  const currentBody = fleet.orbitBody || 'Earth';
  const fleetDv = fleet.lowestDeltaVKps || 25.0;
  const fleetAccel = fleet.lowestCombatAccelerationMps2 || 1.2;

  const destinations = [
    { name: 'Earth', baseDv: 6.5, baseDays: 75 },
    { name: 'Luna', baseDv: 2.1, baseDays: 5 },
    { name: 'Mars', baseDv: 9.8, baseDays: 160 },
    { name: 'Ceres', baseDv: 14.2, baseDays: 450 },
    { name: 'Vesta', baseDv: 13.5, baseDays: 420 },
    { name: 'Mercury', baseDv: 16.0, baseDays: 110 },
    { name: 'Venus', baseDv: 8.4, baseDays: 95 },
    { name: 'Ganymede', baseDv: 22.0, baseDays: 750 },
    { name: 'Callisto', baseDv: 21.0, baseDays: 730 },
    { name: 'Titan', baseDv: 28.0, baseDays: 1100 }
  ];

  const gameDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : new Date();

  const transferOptions = destinations
    .filter(d => normalizeBody(d.name) !== normalizeBody(currentBody))
    .map(d => {
      const dvRequired = Number(d.baseDv.toFixed(1));
      const travelDays = Math.round(d.baseDays / Math.max(0.5, Math.min(2.0, fleetAccel)));
      const arrivalDate = new Date(gameDate.getTime() + travelDays * 86400000).toISOString().split('T')[0];
      const feasible = fleetDv >= dvRequired;
      let warning = null;
      if (!feasible) warning = `insufficient delta-V (${fleetDv.toFixed(1)} km/s available vs ${dvRequired} required)`;
      else if (travelDays > 365) warning = 'strategically impractical — long transfer duration';

      return {
        destination: d.name,
        deltaVRequired: dvRequired,
        travelDays,
        propellantCostTons: Math.round(dvRequired * 12),
        arrivalDate,
        feasible,
        warning
      };
    });

  return {
    fleetId: fleet.ID,
    fleetName: fleet.displayName,
    currentLocation: currentBody,
    fleetDeltaVKps: fleetDv,
    fleetCombatAccelerationMps2: fleetAccel,
    isEstimate: true,
    transfers: transferOptions
  };
};

/**
 * 11. Production Plan: Deterministic procurement calculation.
 */
export const productionPlanResource = (snapshot, designId, quantity = 1, observerId = 4712) => {
  const observer = asArray(snapshot.factions).find(f => Number(f.ID) === Number(observerId)) || {};
  const designs = asArray(snapshot.shipDesigns || asArray(snapshot.factions).flatMap(f => f.shipDesigns || []));
  const design = designs.find(d => String(d.dataName || d.id || d._displayName || d.displayName).toLowerCase() === String(designId).toLowerCase()) ||
                 designs[0] || {
                   _displayName: 'Battlecruiser Standard',
                   dataName: designId || 'Battlecruiser_Standard',
                   hullName: 'Battlecruiser',
                   constructionCost: { water: 180, volatiles: 90, metals: 410, nobleMetals: 102, fissiles: 20 }
                 };

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const unitCost = normalizeCostObject(design.constructionCost || { water: 180, volatiles: 90, metals: 410, nobleMetals: 102, fissiles: 20 });
  const totalCost = {};
  for (const [k, v] of Object.entries(unitCost)) {
    totalCost[k] = Number(((Number(v) || 0) * qty).toFixed(1));
  }

  const stock = observer.resources || {};
  let canAffordNow = true;
  let maxAffordable = 999;
  let bottleneck = null;

  for (const [resKey, costVal] of Object.entries(unitCost)) {
    if (costVal <= 0) continue;
    const stockVal = Number(stock[resKey] || stock[resKey.charAt(0).toUpperCase() + resKey.slice(1)] || (resKey === 'nobles' ? stock.NobleMetals : 0) || 0);
    const affordable = Math.floor(stockVal / Math.max(1, costVal));
    if (affordable < maxAffordable) {
      maxAffordable = affordable;
      bottleneck = resKey;
    }
    if (stockVal < (totalCost[resKey] || 0)) {
      canAffordNow = false;
    }
  }

  const shipyards = asArray(snapshot.habModules).filter(m =>
    Number(m.factionId) === Number(observerId) && m.isShipyard && m.constructionCompleted && !m.destroyed
  );

  const buildTimeDays = design.buildTimeDays || 60;
  const numYards = Math.max(1, shipyards.length);
  const earliestCompletionDays = Math.ceil(qty / numYards) * buildTimeDays;

  const remainingStockpile = {};
  for (const [resKey, stockVal] of Object.entries(stock)) {
    const cost = totalCost[resKey] || totalCost[resKey.toLowerCase()] || (resKey === 'NobleMetals' ? totalCost.nobles : 0) || 0;
    remainingStockpile[resKey] = Math.max(0, Number((Number(stockVal) - cost).toFixed(1)));
  }

  return {
    designId: design.dataName || designId,
    designName: design._displayName || design.displayName || design.hullName,
    hull: design.hullName,
    requestedQuantity: qty,
    unitCost,
    totalCost,
    canAffordNow,
    maxAffordableNow: maxAffordable,
    bottleneckResource: bottleneck,
    availableShipyardsCount: shipyards.length,
    availableShipyards: shipyards.map(y => ({ hab: y.habName, body: y.orbitBody, tier: y.habTier || 2 })),
    earliestCompletionDays,
    expectedRemainingStockpile: remainingStockpile
  };
};

/**
 * 12. Body Status: Complete single-body briefing across all domains.
 */
export const bodyStatusResource = (snapshot, bodyName = 'Mars', observerId = 4712) => {
  const norm = normalizeBody(bodyName);
  const habs = asArray(snapshot.habs).filter(h => normalizeBody(h.orbitBody) === norm);
  const fleets = asArray(snapshot.fleets).filter(f => normalizeBody(f.orbitBody) === norm);
  const sites = asArray(snapshot.habSites).filter(s => normalizeBody(s.parentBodyName) === norm);
  const queues = asArray(snapshot.shipyardQueues).filter(q => normalizeBody(q.orbitBody) === norm);
  const allTransfers = transfersResource(snapshot);
  const incoming = allTransfers.filter(t => normalizeBody(t.destination) === norm);

  const friendlyFleets = fleets.filter(f => Number(f.factionId) === Number(observerId));
  const hostileFleets = fleets.filter(f => Number(f.factionId) !== Number(observerId) && f.factionName !== 'Neutral');

  return {
    body: bodyName,
    habsCount: habs.length,
    fleetsCount: fleets.length,
    miningSitesCount: sites.length,
    militaryBalance: {
      friendlyShips: friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0),
      friendlyCombatPower: friendlyFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0),
      hostileShips: hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0),
      hostileCombatPower: hostileFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0)
    },
    habs: habs.map(habResourceRow),
    fleets: fleets.map(fleetResourceRow),
    incomingTransfers: incoming,
    miningSites: sites.map(miningResourceRow),
    shipyardQueues: queues
  };
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
