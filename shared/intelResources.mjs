// shared/intelResources.mjs
//
// Pure snapshot projection builders shared by the local Express server (loaded
// via require(esm)) and the hosted Cloudflare worker (ESM import). Keep this
// file free of any runtime-specific imports so it stays usable in both.

import {
  ALIEN_FACTION_ID,
  ALIEN_FACTION_DISPLAY_NAME,
  DEFAULT_OBSERVER_FACTION_ID,
  INITIATIVE_DISPLAY_NAME
} from './constants.mjs';
import { buildAlienHateEconomics, ALIEN_HATE_WAR_THRESHOLD } from './alienHateEconomics.mjs';
import {
  asArray,
  toFiniteNumber as toFinite,
  sameId,
  resolveObserverFaction,
  MS_PER_DAY
} from './util.mjs';

// Re-exported so existing importers of these names keep working. The
// definitions themselves moved to shared/util.mjs, where they are shared with
// strategicSnapshot / strategicDelta / techGraph / councilorAttributes and the
// server modules instead of being copied into each.
export { asArray, toFinite, sameId };

// ---------------------------------------------------------------------------
// One endpoint registry, three derived views.
//
// SUPPORTED_RESOURCES, INTEL_ENDPOINT_INDEX and the dispatcher below used to be
// three separately hand-maintained lists of the same endpoints, and they had
// already drifted: `mining-expansion` reached the dispatcher and the discovery
// index but never the examples map. Everything is now derived from this table,
// so adding a row is the only edit an endpoint needs.
//
//   key       camelCase discovery-index key.
//   route     REST path segment; ALSO the dispatcher's resource name.
//             Derived from `key`, so the two can no longer disagree.
//   projected true when buildResourceProjection in this file answers it.
//             false for endpoints the adapters serve themselves (history,
//             strategic-delta, the tech-graph family).
//   example   query string shown by the discovery index.
// ---------------------------------------------------------------------------
const kebab = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// Built from the configured default so the published examples cannot drift
// away from the observer the endpoints actually default to.
const OMNISCIENT = `?observer=${DEFAULT_OBSERVER_FACTION_ID}&mode=omniscient`;
const OMNISCIENT_OWN = `${OMNISCIENT}&faction=${DEFAULT_OBSERVER_FACTION_ID}`;
const OMNISCIENT_ALIEN = `${OMNISCIENT}&faction=${ALIEN_FACTION_ID}`;
const OBSERVER_ONLY = `?observer=${DEFAULT_OBSERVER_FACTION_ID}`;

const INTEL_ENDPOINTS = Object.freeze([
  { key: 'summary', projected: true, example: OMNISCIENT },
  { key: 'factions', projected: true, example: OMNISCIENT },
  { key: 'nations', projected: true, example: OMNISCIENT_OWN },
  { key: 'councilors', projected: true, example: OMNISCIENT_OWN },
  { key: 'habs', projected: true, example: OMNISCIENT_OWN },
  { key: 'habSites', projected: true, example: `${OMNISCIENT}&body=Ceres` },
  { key: 'mining', projected: true, example: `${OMNISCIENT}&body=Ceres&sort=water` },
  { key: 'fleets', projected: true, example: OMNISCIENT_ALIEN },
  { key: 'ships', projected: true, example: OMNISCIENT_ALIEN },
  { key: 'research', projected: true, example: OMNISCIENT },
  { key: 'capabilities', projected: true, example: OMNISCIENT },
  { key: 'alien', projected: true, example: OMNISCIENT },
  { key: 'resources', projected: true, example: OMNISCIENT_OWN },
  { key: 'habModules', projected: true, example: OMNISCIENT_OWN },
  { key: 'shipyards', projected: true, example: OMNISCIENT_OWN },
  { key: 'shipyardQueues', projected: true, example: OMNISCIENT_OWN },
  { key: 'arrivals', projected: true, example: OMNISCIENT },
  { key: 'transfers', projected: true, example: `${OMNISCIENT}&destination=Mars` },
  { key: 'logistics', projected: true, example: OMNISCIENT },
  { key: 'construction', projected: true, example: OMNISCIENT_OWN },
  { key: 'shipDesigns', projected: true, example: OMNISCIENT_OWN },
  { key: 'theaters', projected: true, example: OMNISCIENT },
  { key: 'infrastructure', projected: true, example: `${OMNISCIENT}&body=Mars` },
  { key: 'alienThreat', projected: true, example: OMNISCIENT },
  { key: 'delta', projected: true, example: OMNISCIENT },
  { key: 'mobility', projected: true, example: `${OMNISCIENT}&fleet=<fleetId>` },
  { key: 'productionPlan', projected: true, example: `${OMNISCIENT}&design=playerShipTemplate584&quantity=4` },
  { key: 'bodyStatus', projected: true, example: `${OMNISCIENT}&body=Mars` },
  { key: 'miningProspects', projected: true, example: `${OMNISCIENT}&theater=belt&limit=10` },
  { key: 'miningExpansion', projected: true, example: `${OMNISCIENT}&theater=belt&limit=10` },
  { key: 'history', projected: false, example: '?limit=20' },
  { key: 'strategicDelta', projected: false, example: OBSERVER_ONLY },
  { key: 'techTree', projected: false, example: `${OMNISCIENT}&category=all` },
  { key: 'techPath', projected: false, example: `${OMNISCIENT}&target=Project_RailCannonMk3` },
  { key: 'techSearch', projected: false, example: `${OMNISCIENT}&q=battlecruiser` },
  { key: 'techMilestones', projected: false, example: `${OMNISCIENT}&category=ship_hull` },
  { key: 'techMatrix', projected: false, example: OMNISCIENT },
  { key: 'techOpportunities', projected: false, example: OMNISCIENT },
  { key: 'researchQueue', projected: false, example: OMNISCIENT }
].map(entry => Object.freeze({ ...entry, route: kebab(entry.key) })));

/** Resource names `buildResourceProjection` understands. */
export const SUPPORTED_RESOURCES = new Set(
  INTEL_ENDPOINTS.filter(entry => entry.projected).map(entry => entry.route)
);

// Public discovery map shared by the local Express API and hosted worker.
// Keep these as path-only links so external analysis clients can discover the
// focused routes before adding observer/mode/faction filters themselves.
export const INTEL_ENDPOINT_INDEX = Object.freeze(
  Object.fromEntries(INTEL_ENDPOINTS.map(entry => [entry.key, `/api/intel/${entry.route}`]))
);

export const INTEL_ENDPOINT_EXAMPLES = Object.freeze(
  Object.fromEntries(INTEL_ENDPOINTS.map(entry => [entry.key, entry.example]))
);

/**
 * The one mining/economy resource table for this file.
 *
 * The same five resources previously appeared as three separate inline tables
 * plus a bare key array, under three different spellings of noble metals:
 *   key     -- the hab-site rate field   (`site.nobleMetals`)
 *   saveKey -- the faction stockpile key (`faction.resources.NobleMetals`)
 *   alias   -- the reported output name  (`nobles`)
 * Reading one spelling out of a structure that uses another returns undefined,
 * which then coerces to 0 -- a silent, confident, wrong answer.
 */
export const MINING_RESOURCES = Object.freeze([
  Object.freeze({ key: 'water', saveKey: 'Water', alias: 'water', label: 'Water' }),
  Object.freeze({ key: 'volatiles', saveKey: 'Volatiles', alias: 'volatiles', label: 'Volatiles' }),
  Object.freeze({ key: 'metals', saveKey: 'Metals', alias: 'metals', label: 'Metals' }),
  Object.freeze({ key: 'nobleMetals', saveKey: 'NobleMetals', alias: 'nobles', label: 'Noble metals' }),
  Object.freeze({ key: 'fissiles', saveKey: 'Fissiles', alias: 'fissiles', label: 'Fissiles' })
]);

/**
 * A fresh accumulator keyed by the save's own stockpile spelling, in table
 * order. Written out twice as a literal before, which is how a resource key
 * gets added to one accumulator and forgotten in the other.
 */
const zeroedBySaveKey = () => Object.fromEntries(MINING_RESOURCES.map(({ saveKey }) => [saveKey, 0]));

export const normalizeBody = (value) => String(value || '')
  .trim()
  .replace(/^\d+\s+/, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

export const factionMatches = (item, factionId) => {
  if (factionId === null || factionId === undefined) return true;
  const controlPointIds = asArray(item.controlPoints).map(cp => cp?.factionId);
  // `item.id` is read alongside `item.ID` only because a few projections
  // re-emit their rows with a lowercased key before this predicate sees them.
  // The save itself carries `ID`; nothing here may rely on `id` existing.
  return [item.ID, item.id, item.factionId, item.executiveFactionId, ...controlPointIds]
    .some(id => sameId(id, factionId));
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
  // `?? 0` here reported a confident "this site yields no water" for a site
  // whose rate the snapshot simply does not carry. Absent stays null; the
  // caller can tell an unmeasured rate from a genuinely barren one.
  water: toFinite(site.water),
  volatiles: toFinite(site.volatiles),
  metals: toFinite(site.metals),
  nobleMetals: toFinite(site.nobleMetals),
  fissiles: toFinite(site.fissiles),
  resourceRatesMeasured: MINING_RESOURCES.every(({ key }) => toFinite(site[key]) !== null),
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

// Total monthly yield across the five mined resources.
//
// A site with no measured rates at all is UNMEASURED, not a zero producer:
// `(site.water || 0) + ...` used to report a confident 0 t/month for a site
// whose rates were simply absent from the snapshot, which is indistinguishable
// in the output from a genuinely barren site. Partial coverage is summed but
// labelled, so a caller can tell a complete reading from a partial one.
export const siteMonthlyOutput = (site) => {
  const measured = MINING_RESOURCES
    .map(({ key }) => toFinite(site?.[key]))
    .filter(value => value !== null);
  if (measured.length === 0) {
    return { total: null, measuredResources: 0, complete: false };
  }
  const total = measured.reduce((sum, value) => sum + value, 0) * rateMultiplier(site);
  return {
    total: Number(total.toFixed(1)),
    measuredResources: measured.length,
    complete: measured.length === MINING_RESOURCES.length
  };
};

export const miningResourceRow = (site) => {
  const output = siteMonthlyOutput(site);
  return {
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
  // Per-resource columns follow the same rule as effectiveMonthlyOutput:
  // absent stays null. `?? 0` printed `water: 0, metals: 0` for a site whose
  // rates were never measured, which is indistinguishable in the output from
  // a site that was measured and found barren.
  water: toFinite(site.water),
  volatiles: toFinite(site.volatiles),
  metals: toFinite(site.metals),
  nobles: toFinite(site.nobleMetals),
  fissiles: toFinite(site.fissiles),
  effectiveMonthlyOutput: output.total,
  effectiveMonthlyOutputMeasured: output.complete,
  measuredResourceCount: output.measuredResources,
  resourceRateUnit: site.resourceRateUnit,
  mineTier: site.mineTier,
  mineModule: site.mineModuleTemplate,
  constructionStatus: site.constructionStatus,
  daysRemaining: site.daysRemaining,
  completionDate: site.completionDate,
  buildDurationDays: site.buildDurationDays
  };
};

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
    sameId(other.factionId, observerFactionId) && normalizeBody(other.orbitBody) === destinationBody
  );
  const currentShips = friendlyFleets.reduce((sum, other) => sum + (Number(other.shipsCount) || 0), 0);
  const combatValues = friendlyFleets
    .map(other => other.combatPower)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const completingShips = asArray(snapshot.shipyardQueues).filter(queue =>
    sameId(queue.factionId, observerFactionId) && normalizeBody(queue.orbitBody) === destinationBody
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
  return factions.find(faction => sameId(faction.ID, ALIEN_FACTION_ID) || faction.displayName === ALIEN_FACTION_DISPLAY_NAME) || null;
};

// =============================================================================
// NEW & ENHANCED STRATEGIC INTELLIGENCE PROJECTION BUILDERS
// =============================================================================

/**
 * 1. Logistics: Exposes the actual war economy, gross vs net resource flows,
 * committed queues, and production by body/site.
 */
export const logisticsResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const factions = asArray(snapshot.factions);
  const observer = resolveObserverFaction(factions, observerId, {
    fallbackDisplayName: INITIATIVE_DISPLAY_NAME,
    fallbackToFirst: true
  }) || {};
  const actualObsId = observer.ID || observerId;
  const stock = observer.resources || {};
  const sites = asArray(snapshot.habSites).filter(s => sameId(s.factionId, actualObsId));

  // The one MINING_RESOURCES table, read here through its stockpile spelling.
  // `saveKeyLower` reproduces the lookup order this reducer has always used on
  // a hab site: the lower-cased stockpile key first (matches water / volatiles
  // / metals / fissiles verbatim), then the reported alias, then the site's own
  // rate field -- which is the only spelling that resolves noble metals.
  const resourceKeys = MINING_RESOURCES.map(({ key, saveKey, alias, label }) => ({
    key: saveKey,
    saveKeyLower: saveKey.toLowerCase(),
    siteKey: key,
    alias,
    label
  }));

  // Upkeep from operational modules
  const ownModules = asArray(snapshot.habModules).filter(m => sameId(m.factionId, actualObsId) && m.constructionCompleted && m.powered !== false);
  const upkeepByResource = { ...zeroedBySaveKey(), Money: 0 };
  for (const mod of ownModules) {
    if (mod.resourceUpkeep) {
      for (const [k, v] of Object.entries(mod.resourceUpkeep)) {
        if (upkeepByResource[k] !== undefined) upkeepByResource[k] += Number(v) || 0;
      }
    }
  }

  // Committed resources in active build queues
  const committedByResource = zeroedBySaveKey();
  const ownQueues = asArray(snapshot.shipyardQueues).filter(q => sameId(q.factionId, actualObsId) && q.constructionStatus !== 'operational');
  for (const q of ownQueues) {
    for (const cost of asArray(q.resourcesCost)) {
      const resName = cost.resource || cost.name;
      if (committedByResource[resName] !== undefined) {
        committedByResource[resName] += Number(cost.amount) || 0;
      }
    }
  }
  const ownBuildingModules = asArray(snapshot.habModules).filter(m => sameId(m.factionId, actualObsId) && m.constructionStatus === 'building');
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
      productionByBody[body] = {
        ...Object.fromEntries(MINING_RESOURCES.map(({ alias }) => [alias, 0])),
        sitesCount: 0
      };
    }
    const mult = rateMultiplier(s);
    // Reads each rate through the site's own spelling (`nobleMetals`) and
    // reports it under the output alias (`nobles`). The `|| 0` coercion is the
    // one this reducer has always applied to a gross-production roll-up; only
    // the hand-written five-name table is gone.
    const yields = MINING_RESOURCES.map(({ key, alias }) => ({
      alias,
      value: (Number(s[key]) || 0) * mult
    }));
    const monthlyTotal = yields.reduce((sum, entry) => sum + entry.value, 0);

    for (const { alias, value } of yields) productionByBody[body][alias] += value;
    productionByBody[body].sitesCount += 1;

    if (s.mineModuleName && monthlyTotal > 0) {
      topSites.push({
        site: s.displayName,
        body,
        monthlyTotal: Number(monthlyTotal.toFixed(1)),
        yields: Object.fromEntries(
          yields.map(({ alias, value }) => [alias, Number(value.toFixed(1))])
        )
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

  const resources = resourceKeys.map(({ key, saveKeyLower, siteKey, alias, label }) => {
    const stockpile = Number((Number(stock[key]) || 0).toFixed(1));
    const grossDaily = sites.filter(s => s.mineModuleName)
      .reduce((sum, s) => sum + (Number(s[saveKeyLower] || s[alias] || s[siteKey]) || 0), 0);
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
        daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
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
        // Never fabricate the bill of materials. The save records a design as a
        // component list, not a resource cost, so `d.constructionCost` is
        // absent for every design on a real save -- and the old fallback then
        // quoted the SAME invented 120/60/250/40/10 for a Gunship and a
        // Dreadnought alike, flagged only as "estimated", which it was not:
        // it was a constant. An honest null is the only defensible answer.
        constructionCost: d.constructionCost ? normalizeCostObject(d.constructionCost) : null,
        constructionCostAvailable: Boolean(d.constructionCost),
        isEstimatedCost: false,
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
export const theatersResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
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

    const friendlyFleets = bodyFleets.filter(f => sameId(f.factionId, observerId));
    const hostileFleets = bodyFleets.filter(f => sameId(f.factionId, alienId) || (f.factionName && f.factionName.toLowerCase().includes('servant')));

    const friendlyShips = friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const hostileShips = hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const friendlyCP = friendlyFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0);
    const hostileCP = hostileFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0);

    const friendlyHabs = bodyHabs.filter(h => sameId(h.factionId, observerId)).length;
    const friendlyYards = bodyHabs.filter(h => sameId(h.factionId, observerId) && (h.isShipyard || h.shipyardCount > 0)).length;
    const friendlyMines = bodySites.filter(s => sameId(s.factionId, observerId) && s.mineModuleName).length;

    // Incoming hostile transfers
    const incomingHostile = transfers.filter(t =>
      normalizeBody(t.destination) === norm &&
      (sameId(t.factionId, alienId) || (t.faction && t.faction.toLowerCase().includes('servant')))
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
      ? bodyQueues.filter(q => sameId(q.factionId, observerId) && (q.daysToCompletion ?? 999) <= nearestArrivalDays).length
      : bodyQueues.filter(q => sameId(q.factionId, observerId)).length;

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
        totalQueuedShips: bodyQueues.filter(q => sameId(q.factionId, observerId)).length
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
      const habModules = asArray(snapshot.habModules).filter(m => sameId(m.habId, h.ID));
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

      const site = asArray(snapshot.habSites).find(s => sameId(s.habId, h.ID));

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
        // `Number(site.water) || 0` turned an absent rate into a confident
        // "0 t/month mined here". Absent stays null, and `measured` says
        // whether all five rates were readable.
        mineOutput: site ? {
          ...Object.fromEntries(MINING_RESOURCES.map(({ key, alias }) => {
            const rate = toFinite(site[key]);
            return [alias, rate === null ? null : Number((rate * 30).toFixed(1))];
          })),
          measured: MINING_RESOURCES.every(({ key }) => toFinite(site[key]) !== null)
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

// Derived from the one MINING_RESOURCES table so the site-rate field names can
// never drift from the stockpile keys they are compared against.
const MINING_RESOURCE_KEYS = Object.freeze(MINING_RESOURCES.map(r => r.key));

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
export const EXPANSION_THEATER_ACCESSIBILITY = Object.freeze({
  sol: 1.0,
  mars: 0.9,
  inner: 0.85,
  belt: 0.75,
  jupiter: 0.5,
  saturn: 0.35,
  outer: 0.2,
  unassigned: 0.1
});

export const EXPANSION_MISSION_TECH_NAMES = Object.freeze({
  MissiontotheMoon: 'Mission to the Moon',
  MissiontoMars: 'Mission to Mars',
  MissiontotheInnerPlanets: 'Mission to the Inner Planets',
  MissiontoVenus: 'Mission to Venus',
  MissiontotheAsteroids: 'Mission to the Asteroids',
  MissiontoJupiter: 'Mission to Jupiter',
  MissiontoSaturn: 'Mission to Saturn',
  MissiontotheOuterPlanets: 'Mission to the Outer Planets'
});

export const EXPANSION_MINE_LIMIT_GRANTS = Object.freeze({
  MissiontotheMoon: 3,
  MissiontotheInnerPlanets: 3,
  MissiontoMars: 6,
  MissiontotheAsteroids: 6,
  MissiontoJupiter: 6,
  MissiontoSaturn: 6,
  MissiontotheOuterPlanets: 6,
  FutureTechSpaceScience: 1,
  Project_GoldRush: 6
});

/**
 * Destination mission tech required to reach a body, with the evidence that
 * produced the answer. `source` matters: the last branch is a HEURISTIC --
 * every body the theater table does not name (the ~100 numbered main-belt
 * asteroids in a live save, e.g. "18 Melpomene") falls through to
 * MissiontotheAsteroids. That is right for a main-belt rock and wrong for
 * anything else that lands there, so it is labelled rather than silently
 * presented as a template-derived fact.
 */
export const resolveBodyDestinationTech = (bodyName, spaceTheaterKey) => {
  const normalized = String(bodyName || '').trim().toLowerCase();
  if (normalized === 'luna' || normalized === 'moon') return { tech: 'MissiontotheMoon', source: 'body name' };
  if (normalized === 'mercury') return { tech: 'MissiontotheInnerPlanets', source: 'body name' };
  if (normalized === 'venus') return { tech: 'MissiontoVenus', source: 'body name' };
  if (normalized === 'mars' || normalized === 'phobos' || normalized === 'deimos') {
    return { tech: 'MissiontoMars', source: 'body name' };
  }

  const theater = String(spaceTheaterKey || '').toLowerCase();
  if (theater === 'sol') return { tech: 'MissiontotheMoon', source: 'space theater' };
  if (theater === 'mars') return { tech: 'MissiontoMars', source: 'space theater' };
  if (theater === 'inner') {
    return {
      tech: normalized.includes('venus') ? 'MissiontoVenus' : 'MissiontotheInnerPlanets',
      source: 'space theater'
    };
  }
  if (theater === 'jupiter') return { tech: 'MissiontoJupiter', source: 'space theater' };
  if (theater === 'saturn') return { tech: 'MissiontoSaturn', source: 'space theater' };
  if (theater === 'outer') return { tech: 'MissiontotheOuterPlanets', source: 'space theater' };
  if (theater === 'belt') return { tech: 'MissiontotheAsteroids', source: 'space theater' };
  return { tech: 'MissiontotheAsteroids', source: 'assumed main belt (body not in the theater table)' };
};

export const evaluateSaturatingUtility = (sufficiency, target = 12, surplusDiscount = 0.05) => {
  if (sufficiency === null || !Number.isFinite(sufficiency) || sufficiency <= 0) return 0;
  if (sufficiency <= target) return sufficiency / target;
  return 1.0 + ((sufficiency - target) * surplusDiscount) / target;
};

/**
 * Mine capacity, the quadratic over-limit MC penalty, and its alien-hate cost.
 *
 * The hate terms depend on the difficulty multiplier (Cinematic 0.05 / Normal
 * 0.30 / Veteran 0.60 / Brutal 1.00). An absent difficulty makes them UNKNOWN,
 * not free: `?? 0.3` invented Normal here and could be wrong by 20x, and a
 * penalty reported as 0 tells the player an over-limit mine is costless.
 */
export const buildMiningCapacity = ({
  observer = {},
  completedProjects = [],
  completedTechs = [],
  difficulty = null,
  habSites = []
} = {}) => {
  const completedTechSet = new Set(asArray(completedTechs));
  const completedProjectSet = new Set(asArray(completedProjects));

  let mineLimit = 0;
  let hasMissionGrant = false;
  for (const [id, grant] of Object.entries(EXPANSION_MINE_LIMIT_GRANTS)) {
    if (completedTechSet.has(id) || completedProjectSet.has(id)) {
      mineLimit += grant;
      hasMissionGrant = true;
    }
  }

  const sites = asArray(habSites);
  const minesBuilt = sites.filter(site =>
    site.mineModuleId != null && sameId(site.factionId, observer.ID)
  ).length;

  const headroom = Math.max(0, mineLimit - minesBuilt);
  const overLimit = minesBuilt > mineLimit;
  const excess = Math.max(0, minesBuilt - mineLimit);
  // Wiki: MC penalty past the limit is Max(1, Floor(excess^2 / 2)).
  const penaltyMC = excess > 0 ? Math.max(1, Math.floor((excess * excess) / 2)) : 0;

  const hateEconomics = buildAlienHateEconomics({ observer, difficulty, mode: 'omniscient' });
  const difficultyMultiplier = toFinite(hateEconomics.difficultyMultiplier);
  const concealmentMultiplier = toFinite(hateEconomics.concealmentMultiplier);
  const baseMultiplier = toFinite(hateEconomics.baseMultiplier) ?? (
    difficultyMultiplier !== null && concealmentMultiplier !== null
      ? difficultyMultiplier * concealmentMultiplier
      : null
  );

  const penaltyHate = baseMultiplier === null
    ? null
    : (penaltyMC > 0 ? Number((penaltyMC * baseMultiplier).toFixed(2)) : 0);

  const nextExcess = Math.max(0, (minesBuilt + 1) - mineLimit);
  const nextPenaltyMC = nextExcess > 0 ? Math.max(1, Math.floor((nextExcess * nextExcess) / 2)) : 0;
  const marginalNextMinePenaltyMC = nextPenaltyMC - penaltyMC;
  const marginalNextMinePenaltyHate = baseMultiplier === null
    ? null
    : (marginalNextMinePenaltyMC > 0
      ? Number((marginalNextMinePenaltyMC * baseMultiplier).toFixed(2))
      : 0);

  const mcUsage = toFinite(observer.missionControlUsage);
  const mcWarFloor = toFinite(hateEconomics.mcWarFloor);
  const mcWarFloorDistance = (mcWarFloor !== null && mcUsage !== null)
    ? Math.max(0, Number((mcWarFloor - mcUsage).toFixed(1)))
    : null;

  return {
    minesBuilt,
    mineLimit: hasMissionGrant ? mineLimit : 0,
    headroom,
    overLimit,
    excess,
    penaltyMC,
    penaltyHate,
    marginalNextMinePenaltyMC,
    marginalNextMinePenaltyHate,
    mcWarFloorDistance,
    baseHateMultiplier: baseMultiplier,
    hateCostAvailable: baseMultiplier !== null,
    difficulty: hateEconomics.difficulty ?? null,
    difficultyMeasured: difficultyMultiplier !== null,
    difficultyMultiplier,
    concealmentMultiplier
  };
};

/**
 * Stock / income / net / consumption and the resulting runway per mined
 * resource. Every term is null when the save does not carry it, and `status`
 * distinguishes `unmeasured` and `consumption_unknown` from a real reading.
 */
export const buildMiningResourceRunways = (observer = {}) => {
  const stockMap = observer.resources || {};
  const incomeMap = observer.monthlyIncome || {};
  const netMap = observer.monthlyNet || {};
  const runways = {};

  for (const { key, saveKey } of MINING_RESOURCES) {
    const stock = toFinite(stockMap[saveKey]);
    const income = toFinite(incomeMap[saveKey]);
    const net = toFinite(netMap[saveKey]);

    const consumption = (income !== null && net !== null) ? Math.max(0, income - net) : null;

    let runwayMonths = null;
    let status = 'unknown';

    if (stock === null) {
      status = 'unmeasured';
    } else if (consumption === null) {
      status = 'consumption_unknown';
    } else if (consumption === 0) {
      if (stock > 0 || (net !== null && net >= 0)) {
        status = 'surplus / no net consumption';
        runwayMonths = null;
      } else {
        status = 'depleted';
        runwayMonths = 0;
      }
    } else {
      runwayMonths = Number((stock / consumption).toFixed(1));
      if (runwayMonths < 3) status = 'critical';
      else if (runwayMonths < 12) status = 'tight';
      else status = 'comfortable';
    }

    runways[key] = { key, saveKey, stock, income, net, consumption, runwayMonths, status };
  }

  return runways;
};

/**
 * Need-weighted saturating marginal utility for one unowned site.
 *
 * Two absent-vs-zero hazards live here and both have bitten before:
 *  - `Number.isFinite(Number(site.siteDensity))` is TRUE for null, so an
 *    explicitly-null density collapsed the whole site value to 0 while an
 *    absent one scored at full value. The 1.0 fallback is now applied
 *    deliberately and labelled as an assumption.
 *  - an absent daily rate coerced to a confident 0 t/day. It now reports
 *    unmeasured and is named in `unmeasuredResources`, so a partially scored
 *    site is distinguishable from a fully scored one.
 */
export const scoreMiningSiteCandidate = (site, runways, capacity, config = {}) => {
  const target = toFinite(config.targetRunwayMonths) ?? 12;
  const surplusDiscount = toFinite(config.surplusDiscount) ?? 0.05;
  const theaterKey = String(site.spaceTheaterKey || '').toLowerCase() || 'unassigned';
  const theaterAccessibility = EXPANSION_THEATER_ACCESSIBILITY[theaterKey]
    ?? EXPANSION_THEATER_ACCESSIBILITY.unassigned;

  const measuredDensity = toFinite(site.siteDensity);
  const siteDensity = measuredDensity ?? 1.0;

  let totalUtilityGain = 0;
  const resourceGains = {};
  const yields = {};
  const unmeasuredResources = [];

  for (const { key } of MINING_RESOURCES) {
    const dailyRate = toFinite(site[key]);
    if (dailyRate === null) {
      yields[key] = { daily: null, monthly: null, measured: false };
      unmeasuredResources.push(key);
      continue;
    }
    const monthlyYield = dailyRate * 30;
    yields[key] = {
      daily: Number(dailyRate.toFixed(3)),
      monthly: Number(monthlyYield.toFixed(1)),
      measured: true
    };

    const r = runways?.[key];
    // A measured consumption implies a measured net, but the net check stays
    // explicit so a future change to buildMiningResourceRunways cannot slip a
    // `?? 0` net back in -- that would read as "this faction burns nothing".
    if (!r || r.stock === null || r.consumption === null || (r.consumption > 0 && r.net === null)) {
      unmeasuredResources.push(key);
      continue;
    }

    let gain = 0;
    if (r.consumption > 0) {
      const suffBefore = Math.max(0, (r.stock + r.net * 12) / r.consumption);
      const suffAfter = Math.max(0, (r.stock + (r.net + monthlyYield) * 12) / r.consumption);
      gain = Math.max(0, evaluateSaturatingUtility(suffAfter, target, surplusDiscount)
        - evaluateSaturatingUtility(suffBefore, target, surplusDiscount));
    }

    resourceGains[key] = Number(gain.toFixed(4));
    totalUtilityGain += gain;
  }

  // A site where NOTHING could be evaluated -- no rate readable, or no runway
  // to weigh it against -- has an unknown value, not a value of zero. Zero
  // reads as "measured and worthless" and sorts it beside genuinely barren
  // rock. A PARTIAL evaluation still scores, on the part that was measured,
  // and carries `scoreInputsComplete: false`.
  const nothingEvaluated = unmeasuredResources.length >= MINING_RESOURCES.length;
  const siteValue = nothingEvaluated
    ? null
    : Number((totalUtilityGain * siteDensity * theaterAccessibility).toFixed(3));

  const mcCost = 1; // Outpost Mining Complex + Outpost Core base MC.
  const wouldExceedMineLimit = (toFinite(capacity?.headroom) ?? 0) <= 0;
  const baseMultiplier = toFinite(capacity?.baseHateMultiplier);
  const marginalPenaltyMC = toFinite(capacity?.marginalNextMinePenaltyMC) ?? 0;

  let hateCost = null;
  if (baseMultiplier !== null) {
    hateCost = wouldExceedMineLimit
      ? Number(((marginalPenaltyMC + mcCost) * baseMultiplier).toFixed(2))
      : Number((mcCost * baseMultiplier).toFixed(2));
  }

  const valuePerHate = (hateCost === null || siteValue === null)
    ? null
    : (hateCost > 0 ? Number((siteValue / hateCost).toFixed(3)) : siteValue);

  return {
    siteId: site.ID ?? null,
    displayName: site.displayName ?? null,
    parentBodyName: site.parentBodyName ?? null,
    spaceTheaterKey: theaterKey,
    spaceTheaterName: site.spaceTheaterName || site.parentBodyName || null,
    siteDensity,
    siteDensityMeasured: measuredDensity !== null,
    siteDensityAssumed: measuredDensity === null,
    siteDensitySource: measuredDensity === null
      ? 'assumed 1.0 (site template Density not resolved)'
      : 'site template Density',
    yields,
    resourceGains,
    unmeasuredResources,
    scoreInputsComplete: unmeasuredResources.length === 0,
    siteValue,
    siteValueMeasured: siteValue !== null,
    mcCost,
    hateCost,
    hateCostAvailable: hateCost !== null,
    wouldExceedMineLimit,
    valuePerHate,
    // Unowned sites have no mine under construction, so the save carries no
    // build duration for them. Null, never 0 -- "instant" would be a lie.
    buildTimeDays: toFinite(site.buildDurationDays)
  };
};

/**
 * Ordering: hate-free sites first, then value per unit of hate. A site whose
 * hate cost could NOT be evaluated sorts last on that key rather than being
 * compared as though it were free -- `null - number` coerces to 0 and would
 * otherwise rank an unassessable site alongside a costless one.
 */
export const compareMiningCandidates = (a, b) => {
  // Null never enters the arithmetic: `null - 5` is -5, which would rank an
  // unassessable site as though it were a measured zero.
  const byValue = (left, right) => {
    const lv = toFinite(left.siteValue);
    const rv = toFinite(right.siteValue);
    if (lv === null && rv === null) return 0;
    if (lv === null) return 1;
    if (rv === null) return -1;
    return rv - lv;
  };

  const aCostKnown = toFinite(a.hateCost) !== null;
  const bCostKnown = toFinite(b.hateCost) !== null;
  if (aCostKnown !== bCostKnown) return aCostKnown ? -1 : 1;
  if (!aCostKnown) return byValue(a, b);
  if (a.hateCost === 0 && b.hateCost === 0) return byValue(a, b);
  if (a.hateCost === 0) return -1;
  if (b.hateCost === 0) return 1;

  const aPer = toFinite(a.valuePerHate);
  const bPer = toFinite(b.valuePerHate);
  if (aPer === null && bPer !== null) return 1;
  if (bPer === null && aPer !== null) return -1;
  if (aPer !== null && bPer !== null && aPer !== bPer) return bPer - aPer;
  return byValue(a, b);
};

export const miningExpansionResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  limit = null,
  theater = null,
  targetRunwayMonths = 12,
  surplusDiscount = 0.05
} = {}) => {
  const factions = asArray(snapshot?.factions);
  const observer = resolveObserverFaction(factions, observerId, {
    // Substring, not exact: this board is reached with a bare 'initiative'
    // observer often enough that the looser match is the behaviour it has
    // always had. Kept distinct from logisticsResource's exact-name step
    // rather than silently unified.
    fallbackDisplayName: 'initiative',
    fallbackMatch: 'contains',
    fallbackToFirst: true
  }) || {};

  const completedProjects = asArray(observer.completedProjects || observer.finishedProjectNames);
  const completedTechs = asArray(snapshot?.techTree?.finishedTechsNames || snapshot?.globalResearch?.finishedTechNames);
  const completedTechSet = new Set(completedTechs);
  const completedProjectSet = new Set(completedProjects);

  // `|| 'Normal'` re-invented the difficulty the save did not carry, and with
  // it the entire alien-hate cost side of this board (the floor multiplier is
  // Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00). Absent stays
  // null and the hate terms report unavailable.
  const rawDifficulty = snapshot?.metadata?.difficulty;
  const difficulty = typeof rawDifficulty === 'string' && rawDifficulty.trim() !== ''
    ? rawDifficulty
    : null;
  const habSites = asArray(snapshot?.habSites);

  // 1. Capacity model (M1)
  const capacity = buildMiningCapacity({
    observer,
    completedProjects,
    completedTechs,
    difficulty,
    habSites
  });
  const { headroom, baseHateMultiplier: baseMultiplier } = capacity;

  // 2. Resource runways (M3)
  const resourceRunways = buildMiningResourceRunways(observer);

  // 3. Unowned site scoring & partitioning (M2 + M3)
  const hasOutpostMineTech = completedProjectSet.has('Project_OutpostMiningComplex') ||
                             completedProjectSet.has('Project_AutomatedMiningComplex') ||
                             completedTechSet.has('Project_OutpostMiningComplex');

  const wantTheater = theater ? String(theater).toLowerCase() : null;
  const unownedSites = habSites.filter(site => {
    const isUnclaimed = site.factionId === null || site.factionId === undefined ||
      String(site.factionName || '').toLowerCase() === 'unclaimed';
    if (!isUnclaimed || site.pendingHab) return false;
    if (wantTheater === null) return true;
    return String(site.spaceTheaterKey || '').toLowerCase() === wantTheater ||
           String(site.spaceTheaterName || '').toLowerCase() === wantTheater;
  });

  const available = [];
  const techGatedMap = new Map();
  const unreachableBodies = {};
  const unreachableMissingTechs = {};
  let totalUnreachableSites = 0;

  // `Math.max(0, null)` is 0, so folding an unassessable site into a group's
  // best value used to publish a confident 0 for it. Unmeasured sites are
  // counted separately and never move the best value.
  const addToGatedGroup = (techId, techLabel, candidate) => {
    if (!techGatedMap.has(techId)) {
      techGatedMap.set(techId, {
        missingTech: techId,
        missingTechName: techLabel,
        siteCount: 0,
        unmeasuredSiteCount: 0,
        bestSiteValue: null,
        sites: []
      });
    }
    const entry = techGatedMap.get(techId);
    entry.siteCount++;
    const value = toFinite(candidate.siteValue);
    if (value === null) {
      entry.unmeasuredSiteCount++;
    } else {
      entry.bestSiteValue = entry.bestSiteValue === null ? value : Math.max(entry.bestSiteValue, value);
    }
    entry.sites.push(candidate);
    return entry;
  };

  for (const site of unownedSites) {
    const destination = resolveBodyDestinationTech(
      site.parentBodyName,
      String(site.spaceTheaterKey || '').toLowerCase() || 'unassigned'
    );
    const destTech = destination.tech;
    const destTechName = EXPANSION_MISSION_TECH_NAMES[destTech] || destTech;
    const destTechCompleted = completedTechSet.has(destTech);

    const scored = scoreMiningSiteCandidate(site, resourceRunways, capacity, {
      targetRunwayMonths,
      surplusDiscount
    });
    const candidate = {
      ...scored,
      destinationTech: destTech,
      destinationTechName: destTechName,
      destinationTechSource: destination.source
    };

    if (destTechCompleted && hasOutpostMineTech) {
      available.push(candidate);
    } else if (!destTechCompleted) {
      addToGatedGroup(destTech, destTechName, candidate);

      unreachableBodies[site.parentBodyName] = (unreachableBodies[site.parentBodyName] || 0) + 1;
      unreachableMissingTechs[destTechName] = (unreachableMissingTechs[destTechName] || 0) + 1;
      totalUnreachableSites++;
    } else if (!hasOutpostMineTech) {
      addToGatedGroup('Project_OutpostMiningComplex', 'Outpost Mining Complex', candidate);
    }
  }

  available.sort(compareMiningCandidates);

  const rankedAvailable = limit ? available.slice(0, Number(limit)) : available;
  const assumedDestinationCount = [...available, ...Array.from(techGatedMap.values()).flatMap(e => e.sites)]
    .filter(c => c.destinationTechSource && c.destinationTechSource.startsWith('assumed')).length;

  const descByValue = (a, b) => {
    const av = toFinite(a);
    const bv = toFinite(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };
  const techGated = Array.from(techGatedMap.values()).map(entry => ({
    ...entry,
    sites: entry.sites.sort((a, b) => descByValue(a.siteValue, b.siteValue))
  })).sort((a, b) => descByValue(a.bestSiteValue, b.bestSiteValue));

  const unmeasuredAvailableCount = available.filter(c => c.siteValue === null).length;

  return {
    capacity,
    resourceRunways,
    available: rankedAvailable,
    availableTotalCount: available.length,
    availableOmittedCount: available.length - rankedAvailable.length,
    // Sites the runway model could not evaluate at all. Their siteValue is
    // null, not 0, so they are not silently ranked as worthless.
    availableUnmeasuredCount: unmeasuredAvailableCount,
    techGated,
    unreachable: {
      totalSites: totalUnreachableSites,
      byBody: unreachableBodies,
      missingTech: unreachableMissingTechs
    },
    assumptions: [
      `Target runway is ${targetRunwayMonths} months (heuristic).`,
      'Theater accessibility multipliers are heuristic based on transfer time and defensibility.',
      'Rankings prioritize hate-free expansion headroom before sorting by value per unit of alien hate.',
      capacity.hateCostAvailable
        ? `Alien-hate costs use the ${capacity.difficulty || 'measured'} floor multiplier ${capacity.baseHateMultiplier}.`
        : 'Alien-hate costs are UNAVAILABLE: the save carries no readable difficulty, and the floor multiplier '
          + '(Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00) is what converts Mission Control into hate.',
      assumedDestinationCount > 0
        ? `${assumedDestinationCount} site(s) sit on bodies the space-theater table does not name; their destination `
          + 'tech is ASSUMED to be Mission to the Asteroids (correct for a numbered main-belt rock, a guess otherwise).'
        : 'Every scored site resolved its destination tech from a named body or a classified space theater.'
    ]
  };
};

export const alienThreatResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID, { mode = null } = {}) => {
  const observer = resolveObserverFaction(snapshot.factions, observerId) || {};
  // `|| 'Normal'` here was not cosmetic: difficulty selects the hate floor
  // multiplier (0.05/0.30/0.60/1.00), so defaulting it publishes a wrong
  // minimum-hate figure as if it were measured. Absent stays null, and
  // buildAlienHateEconomics then reports the floor as UNAVAILABLE.
  const rawDifficulty = snapshot.metadata?.difficulty;
  const difficulty = typeof rawDifficulty === 'string' && rawDifficulty.trim() !== ''
    ? rawDifficulty
    : null;

  // ---------------------------------------------------------------------
  // Defence in depth on the raw alien hate.
  //
  // This used to read `observer.assessedAlienHateOfMe` through
  // buildAlienHateEconomics with a hard-coded `mode: 'omniscient'`, on the
  // stated assumption that callers hand in an already intel-filtered
  // snapshot. The assumption was false: intelligenceFilter stripped that raw
  // field from every faction EXCEPT the observer's own, so /api/intel/alien-
  // threat published the exact save value (49.6) in Player Intel mode -- the
  // documented, hosted, default-player endpoint -- while
  // `alienHateEconomics.actualAlienHate` from the same snapshot was null.
  //
  // So the mode rule is re-applied here rather than trusted:
  //   1. an explicitly requested player mode redacts, whatever the snapshot
  //      happens to carry;
  //   2. otherwise the filter's own structured `alienHate` object wins, since
  //      that is the mode-aware representation (`actual` is null when
  //      redacted) and it cannot disagree with itself;
  //   3. only a snapshot with neither signal -- a hand-built fixture, never a
  //      filtered one -- falls back to the raw field.
  // A value that is withheld is reported as null with a stated reason. It is
  // never replaced with an estimate, a floor, or a zero.
  // ---------------------------------------------------------------------
  const requestedMode = typeof mode === 'string' && mode.trim() !== '' ? mode.trim().toLowerCase() : null;
  const snapshotMode = typeof snapshot.mode === 'string' && snapshot.mode.trim() !== ''
    ? snapshot.mode.trim().toLowerCase()
    : (snapshot.isOmniscient === true ? 'omniscient' : null);
  const redactsRawHate = requestedMode === 'player' || snapshotMode === 'player';
  const structuredHate = observer.alienHate && typeof observer.alienHate === 'object'
    ? observer.alienHate
    : null;

  let actualHateStatus;
  let actualHateSource;
  let resolvedHate = null;
  if (redactsRawHate) {
    actualHateStatus = 'redacted';
    actualHateSource = 'redacted: Player Intel mode does not expose the save\'s raw alien hate; '
      + 'the player-legitimate reading is the visible estimate meter';
  } else if (structuredHate) {
    resolvedHate = toFinite(structuredHate.actual);
    actualHateStatus = resolvedHate === null ? 'unavailable' : 'available';
    actualHateSource = resolvedHate === null
      ? `unavailable: filtered snapshot reports alienHate.visibility='${structuredHate.visibility || 'unknown'}'`
      : `measured: filtered snapshot alienHate.actual (visibility='${structuredHate.visibility || 'unknown'}')`;
  } else {
    resolvedHate = toFinite(observer.assessedAlienHateOfMe);
    actualHateStatus = resolvedHate === null ? 'unavailable' : 'available';
    actualHateSource = resolvedHate === null
      ? 'unavailable: assessedAlienHateOfMe not present in this snapshot'
      : 'measured: raw save assessedAlienHateOfMe (unfiltered snapshot)';
  }

  // Do NOT reimplement the hate floor here. buildAlienHateEconomics is the
  // single source of truth and is what the dashboard card renders: difficulty
  // multipliers are 0.05/0.30/0.60/1.00, and each completed concealment
  // project multiplies the floor by 0.8 (they compound, they do not add).
  // It is handed the resolved hate rather than the observer object, so a raw
  // field that survives filtering cannot reach the derived figures either.
  const economics = buildAlienHateEconomics({
    observer: { ...observer, assessedAlienHateOfMe: resolvedHate },
    difficulty,
    mode: 'omniscient'
  });

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

  // What the player legitimately knows about alien hate is the in-game 5-pip
  // estimate meter, which the intelligence filter already builds on
  // `faction.alienHate`. Surfacing it here means redacting the float leaves the
  // endpoint with the real reading rather than a hole -- and it is a label, not
  // a number, so it cannot be mistaken for the value it replaces.
  const rawVisibleEstimate = structuredHate ? structuredHate.visibleEstimate : null;
  const visibleEstimate = typeof rawVisibleEstimate === 'string' &&
    rawVisibleEstimate.trim() !== '' &&
    rawVisibleEstimate !== 'UNKNOWN' &&
    rawVisibleEstimate !== 'UNAVAILABLE'
    ? rawVisibleEstimate
    : null;

  return {
    actualHate: round1(actualHate),
    // 'available' | 'redacted' | 'unavailable'. A withheld value is null with a
    // stated reason -- never a fabricated stand-in, and never a confident 0.
    actualHateStatus,
    actualHateSource,
    visibleEstimate,
    visibleEstimatePips: structuredHate ? toFinite(structuredHate.pips) : null,
    visibleEstimateMaxPips: structuredHate ? toFinite(structuredHate.maxPips) : null,
    usedMC: economics.usedMissionControl,
    difficulty,
    difficultyMeasured: difficulty !== null && economics.difficultyMultiplier !== null,
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
      // Null, never false. A threshold check that cannot be evaluated is
      // unknown; reporting it as "no retaliation" is the reassuring direction
      // to be wrong in and is exactly how the Total War veto went inert.
      retaliationActive: atWar,
      retaliationReason: atWar === null
        ? (actualHateStatus === 'redacted'
          ? 'UNKNOWN — alien hate is redacted in Player Intel mode, so the war threshold cannot be evaluated'
          : 'UNAVAILABLE — alien hate not exposed in this snapshot')
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
export const deltaResource = (snapshot, previousSnapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const currentObs = resolveObserverFaction(snapshot.factions, observerId) || {};
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

  const prevObs = resolveObserverFaction(previousSnapshot?.factions, observerId) || {};
  const prevAlien = findAlienFaction(previousSnapshot || {}) || {};
  const prevDate = previousSnapshot?.metadata?.gameTimeString ? new Date(previousSnapshot.metadata.gameTimeString) : null;
  const gameDaysElapsed = prevDate && !Number.isNaN(prevDate.getTime())
    ? Math.max(0, Math.round((curDate - prevDate) / MS_PER_DAY))
    : null;

  // Absent stays null on BOTH sides.
  //
  // `assessedAlienHateOfMe ?? 0` was the worst offender in this file: player
  // mode redacts that field, so every player-mode delta reported alien hate as
  // a confident 0 -- an unmeasured value rendered as "no threat at all", the
  // most dangerous direction to be wrong in. `shipsCount ?? 0` then paired a
  // fabricated 0 with `prev ?? cur`, so a missing previous count produced a
  // fabricated "no change" instead of an honest "cannot compare".
  const measure = (from, to) => {
    const a = toFinite(from);
    const b = toFinite(to);
    return {
      from: a === null ? null : Number(a.toFixed(1)),
      to: b === null ? null : Number(b.toFixed(1)),
      diff: a === null || b === null ? null : Number((b - a).toFixed(1)),
      available: a !== null && b !== null
    };
  };

  const curRes = currentObs.resources || {};
  const prevRes = prevObs.resources || {};

  const changes = {
    initiativeShips: measure(prevObs.shipsCount, currentObs.shipsCount),
    alienShips: measure(prevAlien.shipsCount, currentAlien.shipsCount),
    alienHate: measure(prevObs.assessedAlienHateOfMe, currentObs.assessedAlienHateOfMe)
  };
  for (const { saveKey, alias } of MINING_RESOURCES) {
    changes[alias] = measure(prevRes[saveKey], curRes[saveKey]);
  }

  const events = [];
  const ships = changes.initiativeShips;
  if (ships.diff !== null && ships.diff > 0) events.push(`Initiative commissioned ${ships.diff} new ship(s)`);
  else if (ships.diff !== null && ships.diff < 0) events.push(`Initiative lost ${Math.abs(ships.diff)} ship(s)`);

  const alienShips = changes.alienShips;
  if (alienShips.diff !== null && alienShips.diff > 0) events.push(`Aliens deployed ${alienShips.diff} new ship(s)`);

  const hate = changes.alienHate;
  if (hate.diff === null) {
    // Never fall through to "hate unchanged" -- an unevaluable check must say so.
    events.push('Alien hate change UNAVAILABLE — hate is not exposed in this intel mode.');
  } else if (hate.diff > 0) {
    events.push(`Alien hate increased by ${hate.diff.toFixed(1)}`);
  } else if (hate.diff < 0) {
    events.push(`Alien hate decreased by ${Math.abs(hate.diff).toFixed(1)}`);
  }

  if (events.length === 0) events.push('Campaign operational status sustained without major strategic losses.');

  return {
    comparisonAvailable: true,
    gameDaysElapsed,
    previousDate: previousSnapshot?.metadata?.gameTimeString || null,
    currentDate: snapshot.metadata?.gameTimeString || null,
    changes,
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
export const mobilityResource = (snapshot, fleetId, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const fleets = asArray(snapshot.fleets);

  // A fleet id that does not resolve is an ERROR, not an invitation to answer
  // about some other fleet. The previous fallback chain silently substituted
  // the first observer fleet -- and then the first fleet in the snapshot --
  // so `?fleet=<typo>` returned confident delta-V, travel times and arrival
  // dates for a fleet the caller had never heard of, labelled with that
  // fleet's own id so the substitution was invisible.
  if (fleetId === null || fleetId === undefined || String(fleetId).trim() === '') {
    return {
      error: 'A fleet id is required. Mobility is fleet-specific; there is no meaningful default.',
      requestedFleetId: null,
      fleetId: null,
      availableFleetIds: fleets
        .filter(f => sameId(f.factionId, observerId))
        .map(f => f.ID),
      transfers: [],
      items: []
    };
  }

  const fleet = fleets.find(f => sameId(f.ID, fleetId));
  if (!fleet) {
    return {
      error: `Fleet ${fleetId} not found in this snapshot.`,
      requestedFleetId: fleetId,
      fleetId: null,
      availableFleetIds: fleets
        .filter(f => sameId(f.factionId, observerId))
        .map(f => f.ID),
      transfers: [],
      items: []
    };
  }

  const currentBody = fleet.orbitBody || null;

  // Absent stays null. `fleet.lowestDeltaVKps || 25.0` invented a 25 km/s
  // budget for an unmeasured fleet, and the feasibility verdict below is a
  // direct comparison against it -- an unknown fleet would have been declared
  // capable of reaching Titan.
  const fleetDv = toFinite(fleet.lowestDeltaVKps);
  const fleetAccel = toFinite(fleet.lowestCombatAccelerationMps2);

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
    .filter(d => !currentBody || normalizeBody(d.name) !== normalizeBody(currentBody))
    .map(d => {
      const dvRequired = Number(d.baseDv.toFixed(1));
      // Travel time scales with acceleration; without it the duration is
      // unknown rather than "the book value".
      const travelDays = fleetAccel === null
        ? null
        : Math.round(d.baseDays / Math.max(0.5, Math.min(2.0, fleetAccel)));
      const arrivalDate = travelDays === null
        ? null
        : new Date(gameDate.getTime() + travelDays * MS_PER_DAY).toISOString().split('T')[0];

      // Tri-state: true / false / null. A check that cannot be evaluated must
      // report unknown, never fall through to "feasible".
      const feasible = fleetDv === null ? null : fleetDv >= dvRequired;
      let warning = null;
      if (feasible === null) {
        warning = 'delta-V UNAVAILABLE for this fleet — feasibility cannot be evaluated';
      } else if (!feasible) {
        warning = `insufficient delta-V (${fleetDv.toFixed(1)} km/s available vs ${dvRequired} required)`;
      } else if (travelDays !== null && travelDays > 365) {
        warning = 'strategically impractical — long transfer duration';
      }

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
    requestedFleetId: fleetId,
    fleetName: fleet.displayName,
    factionId: fleet.factionId,
    currentLocation: currentBody,
    fleetDeltaVKps: fleetDv,
    fleetCombatAccelerationMps2: fleetAccel,
    performanceMeasured: fleetDv !== null && fleetAccel !== null,
    isEstimate: true,
    transfers: transferOptions
  };
};

/**
 * 11. Production Plan: Deterministic procurement calculation.
 */
const designIdentifiers = (design) => [
  design?.dataName, design?.id, design?.ID, design?._displayName, design?.displayName, design?.friendlyName
].filter(value => value !== null && value !== undefined && value !== '').map(String);

const designLabel = (design) =>
  design?._displayName || design?.displayName || design?.friendlyName || design?.dataName || null;

/** The 5 resources a hull's construction cost is quoted in, in report spelling. */
const CONSTRUCTION_COST_KEYS = Object.freeze(MINING_RESOURCES.map(r => r.alias));

export const productionPlanResource = (snapshot, designId, quantity = 1, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const observer = resolveObserverFaction(snapshot.factions, observerId) || {};
  const designs = asArray(snapshot.shipDesigns).length > 0
    ? asArray(snapshot.shipDesigns)
    : asArray(snapshot.factions).flatMap(f => asArray(f.shipDesigns));

  const shipyards = asArray(snapshot.habModules).filter(m =>
    sameId(m.factionId, observerId) && m.isShipyard && m.constructionCompleted && !m.destroyed
  );
  const shipyardRows = shipyards.map(y => ({ hab: y.habName, body: y.orbitBody, tier: toFinite(y.habTier) }));

  const catalogue = () => designs.slice(0, 200).map(d => ({
    designId: d.dataName ?? null,
    designName: designLabel(d),
    hull: d.hullName ?? null
  }));

  // A design id that does not resolve is an ERROR.
  //
  // This endpoint previously fell back to `designs[0]`, and then -- if the
  // snapshot carried no designs at all -- to a hard-coded "Battlecruiser
  // Standard" whose invented cost table was stamped with the REQUESTED id. So
  // `?design=<anything>` returned a confident, authoritative-looking
  // procurement plan for a ship that does not exist, with no marker saying so,
  // from a documented external-analysis endpoint.
  if (designId === null || designId === undefined || String(designId).trim() === '') {
    return {
      error: 'A design id is required. Costs are design-specific; there is no meaningful default design.',
      requestedDesignId: null,
      designId: null,
      designAvailable: false,
      availableDesignCount: designs.length,
      availableDesigns: catalogue(),
      availableShipyardsCount: shipyards.length,
      availableShipyards: shipyardRows
    };
  }

  const wanted = String(designId).toLowerCase();
  const design = designs.find(d => designIdentifiers(d).some(value => value.toLowerCase() === wanted));

  if (!design) {
    return {
      error: `Ship design "${designId}" not found in this snapshot.`,
      requestedDesignId: designId,
      designId: null,
      designAvailable: false,
      availableDesignCount: designs.length,
      availableDesigns: catalogue(),
      availableShipyardsCount: shipyards.length,
      availableShipyards: shipyardRows
    };
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const stock = observer.resources || {};

  // Construction cost is NOT fabricated when the snapshot does not carry it.
  //
  // The save's ship-design records describe a hull, drive, reactor and module
  // list, not a resource bill; resolving the bill needs the game templates,
  // which this runtime-agnostic module deliberately cannot load. The previous
  // code papered over that with a fixed 180/90/410/102/20 table, so EVERY
  // production plan -- including ones for correctly-resolved designs -- quoted
  // the same invented cost and derived affordability, bottleneck and remaining
  // stockpile from it.
  const costAvailable = design.constructionCost !== null && design.constructionCost !== undefined;
  const unitCost = costAvailable ? normalizeCostObject(design.constructionCost) : null;

  let totalCost = null;
  let canAffordNow = null;
  let maxAffordable = null;
  let bottleneck = null;
  let remainingStockpile = null;

  if (costAvailable) {
    totalCost = {};
    for (const [k, v] of Object.entries(unitCost)) {
      totalCost[k] = Number(((toFinite(v) ?? 0) * qty).toFixed(1));
    }

    const stockFor = (alias) => {
      const entry = MINING_RESOURCES.find(r => r.alias === alias);
      const candidates = entry ? [entry.saveKey, entry.key, entry.alias] : [alias, alias.charAt(0).toUpperCase() + alias.slice(1)];
      for (const candidate of candidates) {
        const value = toFinite(stock[candidate]);
        if (value !== null) return value;
      }
      return null;
    };

    canAffordNow = true;
    for (const [alias, costVal] of Object.entries(unitCost)) {
      if (costVal <= 0) continue;
      const stockVal = stockFor(alias);
      if (stockVal === null) {
        // Unknown stock is not enough stock, and it is not zero stock either.
        canAffordNow = canAffordNow === false ? false : null;
        continue;
      }
      const affordable = Math.floor(stockVal / costVal);
      if (maxAffordable === null || affordable < maxAffordable) {
        maxAffordable = affordable;
        bottleneck = alias;
      }
      if (stockVal < (totalCost[alias] || 0)) canAffordNow = false;
    }

    remainingStockpile = {};
    for (const [saveKey, stockVal] of Object.entries(stock)) {
      const entry = MINING_RESOURCES.find(r => r.saveKey === saveKey || r.key === saveKey || r.alias === saveKey);
      const cost = entry ? (totalCost[entry.alias] ?? 0) : (totalCost[saveKey.toLowerCase()] ?? 0);
      const current = toFinite(stockVal);
      remainingStockpile[saveKey] = current === null ? null : Math.max(0, Number((current - cost).toFixed(1)));
    }
  }

  // Build time comes from the design when present, otherwise from the hull's
  // measured `baseConstructionTimeDays` in the game-template hull stats -- the
  // same source shipDesignsResource uses. A flat `|| 60` was a fabricated
  // schedule: real hulls range from 60 (Gunship) to far longer, so one constant
  // was wrong for every hull but one.
  const hullStats = (snapshot.shipHullStats || {})[design.hullName] || null;
  const buildTimeDays = toFinite(design.buildTimeDays) ?? toFinite(hullStats?.baseConstructionTimeDays);
  const buildTimeSource = buildTimeDays === null
    ? 'unavailable'
    : (toFinite(design.buildTimeDays) !== null ? 'design' : 'hull-template');
  const numYards = Math.max(1, shipyards.length);
  const earliestCompletionDays = buildTimeDays === null
    ? null
    : Math.ceil(qty / numYards) * buildTimeDays;

  const unavailableFields = [];
  if (!costAvailable) unavailableFields.push('unitCost', 'totalCost', 'canAffordNow', 'maxAffordableNow', 'bottleneckResource', 'expectedRemainingStockpile');
  if (buildTimeDays === null) unavailableFields.push('earliestCompletionDays');

  return {
    designId: design.dataName ?? designId,
    requestedDesignId: designId,
    designName: designLabel(design),
    hull: design.hullName ?? null,
    designAvailable: true,
    requestedQuantity: qty,
    costAvailable,
    costUnavailableReason: costAvailable
      ? null
      : 'This snapshot records ship designs as component lists, not resource bills. Construction cost is UNAVAILABLE rather than estimated.',
    costResourceKeys: CONSTRUCTION_COST_KEYS,
    unitCost,
    totalCost,
    canAffordNow,
    maxAffordableNow: maxAffordable,
    bottleneckResource: bottleneck,
    availableShipyardsCount: shipyards.length,
    availableShipyards: shipyardRows,
    buildTimeDays,
    buildTimeSource,
    missionControlPerShip: toFinite(hullStats?.missionControl),
    earliestCompletionDays,
    expectedRemainingStockpile: remainingStockpile,
    unavailableFields
  };
};

/**
 * 12. Body Status: Complete single-body briefing across all domains.
 */
export const bodyStatusResource = (snapshot, bodyName = 'Mars', observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const norm = normalizeBody(bodyName);
  const habs = asArray(snapshot.habs).filter(h => normalizeBody(h.orbitBody) === norm);
  const fleets = asArray(snapshot.fleets).filter(f => normalizeBody(f.orbitBody) === norm);
  const sites = asArray(snapshot.habSites).filter(s => normalizeBody(s.parentBodyName) === norm);
  const queues = asArray(snapshot.shipyardQueues).filter(q => normalizeBody(q.orbitBody) === norm);
  const allTransfers = transfersResource(snapshot);
  const incoming = allTransfers.filter(t => normalizeBody(t.destination) === norm);

  const friendlyFleets = fleets.filter(f => sameId(f.factionId, observerId));
  const hostileFleets = fleets.filter(f => !sameId(f.factionId, observerId) && f.factionName !== 'Neutral');

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
  // Numeric id equality, not ===: a string/number mismatch here would report
  // an alien order of battle of zero fleets and zero habs rather than failing.
  const alienFleets = alienFaction
    ? asArray(snapshot.fleets).filter(fleet => sameId(fleet.factionId, alienFaction.ID))
    : [];
  const alienHabs = alienFaction
    ? asArray(snapshot.habs).filter(hab => sameId(hab.factionId, alienFaction.ID))
    : [];
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
      councilors: alienFaction
        ? asArray(snapshot.councilors).filter(councilor => sameId(councilor.factionId, alienFaction.ID)).length
        : 0
    },
    capabilities: snapshot.capabilities,
    priorityTargetFaction: snapshot.priorityTargetFaction,
    alienHateEconomics: snapshot.alienHateEconomics ?? null
  };
};

// One pure projection dispatcher is shared by the local Express adapter and
// the hosted worker. The adapters are responsible only for request parsing,
// snapshot retrieval, and response envelopes; resource semantics live here.
export const buildResourceProjection = (snapshot, resource, {
  factionId = null,
  body = null,
  theater = null,
  limit = null,
  destination = null,
  fleetId = null,
  designId = null,
  quantity = 1,
  status = null,
  sort = null,
  previousSnapshot = null,
  mode = 'player',
  weights = null
} = {}) => {
  const observerId = snapshot.observerFactionId || DEFAULT_OBSERVER_FACTION_ID;
  if (resource === 'summary') return { count: null, items: [], ...summaryResource(snapshot) };
  if (resource === 'capabilities') {
    return {
      count: 0,
      items: [],
      capabilities: snapshot.capabilities || {},
      activeXenoforming: snapshot.activeXenoforming || [],
      builtAlienFacilities: snapshot.builtAlienFacilities || []
    };
  }
  if (resource === 'alien') {
    const alienFaction = findAlienFaction(snapshot);
    const alienId = alienFaction?.ID;
    // Numeric id equality: a string/number mismatch on `alienId` would return
    // an empty alien dossier that is indistinguishable from "no alien presence".
    const belongsToAliens = (item) => alienFaction != null && sameId(item.factionId, alienId);
    const fleets = asArray(snapshot.fleets).filter(fleet => belongsToAliens(fleet) && bodyMatches(fleet, body));
    const habs = asArray(snapshot.habs).filter(hab => belongsToAliens(hab) && bodyMatches(hab, body));
    const habSites = asArray(snapshot.habSites).filter(site => belongsToAliens(site) && bodyMatches(site, body));
    const councilors = asArray(snapshot.councilors).filter(belongsToAliens);
    return {
      count: councilors.length + fleets.length + habs.length + habSites.length,
      items: [],
      alienFactionResolved: alienFaction != null,
      faction: alienFaction ? factionResourceRow(alienFaction) : null,
      councilors: councilors.map(councilor => councilorResourceRow(councilor, mode)),
      fleets: fleets.map(fleetResourceRow),
      habs: habs.map(habResourceRow),
      habSites: habSites.map(habSiteResourceRow),
      activeXenoforming: snapshot.activeXenoforming || [],
      builtAlienFacilities: snapshot.builtAlienFacilities || []
    };
  }
  if (resource === 'logistics') {
    const log = logisticsResource(snapshot, observerId);
    return { count: log.resources.length, items: log.resources, ...log };
  }
  if (resource === 'construction') {
    const items = constructionResource(snapshot, factionId, body);
    return { count: items.length, items };
  }
  if (resource === 'transfers') {
    const items = transfersResource(snapshot, factionId, body, destination);
    return { count: items.length, items };
  }
  if (resource === 'ship-designs') {
    const items = shipDesignsResource(snapshot, factionId);
    return { count: items.length, items };
  }
  if (resource === 'theaters') {
    const items = theatersResource(snapshot, observerId);
    return { count: items.length, items };
  }
  if (resource === 'infrastructure') {
    const items = infrastructureResource(snapshot, factionId, body);
    return { count: items.length, items };
  }
  if (resource === 'alien-threat') {
    // The requested mode travels with the query, so the resource can re-apply
    // the redaction rule instead of trusting that the snapshot was scrubbed.
    return { count: null, items: [], ...alienThreatResource(snapshot, observerId, { mode }) };
  }
  if (resource === 'delta') {
    if (snapshot.changesSincePrevious) {
      return { count: null, items: [], ...snapshot.changesSincePrevious, source: 'published-comparison' };
    }
    return { count: null, items: [], ...deltaResource(snapshot, previousSnapshot, observerId) };
  }
  if (resource === 'mobility') {
    const mob = mobilityResource(snapshot, fleetId, observerId);
    return { count: mob.transfers?.length || 0, items: mob.transfers || [], ...mob };
  }
  if (resource === 'production-plan') {
    return { count: null, items: [], ...productionPlanResource(snapshot, designId, quantity, observerId) };
  }
  if (resource === 'mining-expansion') {
    const expansion = miningExpansionResource(snapshot, {
      observerId,
      theater: theater || body || null,
      limit
    });
    return { count: expansion.available.length, items: expansion.available, ...expansion };
  }
  if (resource === 'mining-prospects') {
    const prospects = miningProspectsResource(snapshot, {
      theater: theater || body || null,
      limit,
      weights
    });
    return { count: prospects.ranked.length, items: prospects.ranked, ...prospects };
  }
  if (resource === 'body-status') {
    return { count: null, items: [], ...bodyStatusResource(snapshot, body || 'Mars', observerId) };
  }

  let items = [];
  switch (resource) {
    case 'factions': items = asArray(snapshot.factions).filter(item => factionMatches(item, factionId)).map(factionResourceRow); break;
    case 'nations': items = asArray(snapshot.nations).filter(item => factionMatches(item, factionId)).map(nationResourceRow); break;
    case 'councilors': items = asArray(snapshot.councilors).filter(item => factionMatches(item, factionId)).map(item => councilorResourceRow(item, mode)); break;
    case 'habs': items = asArray(snapshot.habs).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habResourceRow); break;
    case 'hab-sites': items = asArray(snapshot.habSites).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habSiteResourceRow); break;
    case 'mining': {
      const mining = miningAnalysisResource(snapshot, factionId, body, status, sort);
      return { count: mining.items.length, ...mining };
    }
    case 'fleets': items = asArray(snapshot.fleets).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(fleetResourceRow); break;
    case 'ships': items = shipResourceRows(asArray(snapshot.fleets), factionId, body); break;
    case 'resources': items = asArray(snapshot.factions).filter(item => factionMatches(item, factionId)).map(factionResourceRow); break;
    case 'hab-modules': items = asArray(snapshot.habModules).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habModuleResourceRow); break;
    case 'shipyards': items = asArray(snapshot.shipyardStations).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(shipyardStationResourceRow); break;
    case 'shipyard-queues': items = asArray(snapshot.shipyardQueues).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(shipyardResourceRow); break;
    case 'arrivals': items = asArray(snapshot.fleets).filter(item => item.arrivalDate && factionMatches(item, factionId) && bodyMatches(item, body)).map(item => arrivalResourceRow(item, friendlyStrengthAtDestination(item, snapshot))); break;
    case 'research': {
      const research = researchResourceRows(snapshot);
      return { count: research.rows.length, items: research.rows, finishedGlobalProjects: research.finishedGlobalProjects };
    }
    default: break;
  }
  return { count: items.length, items };
};
