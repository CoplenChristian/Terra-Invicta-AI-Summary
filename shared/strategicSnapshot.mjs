// shared/strategicSnapshot.mjs
//
// Reduces a full raw snapshot to `strategic_snapshot_v1`: a compact,
// self-contained document for trend and delta analysis.
//
// Design rules (see docs/strategic-history-and-war-room-plan.md):
//   * IDs and raw numbers only. Never presentation strings.
//   * No static template data -- no tech tree, component catalogs, or
//     mining-site deposits. Those do not change between saves and are the
//     worst thing to duplicate across history.
//   * Independently readable. No delta chains; diffs are computed on demand.
//   * Target < 100 KB uncompressed, hard ceiling 250 KB.
//
// Keep this file free of runtime-specific imports so the hosted worker can
// import it alongside the local server.

import { buildAlienHateEconomics } from './alienHateEconomics.mjs';

export const STRATEGIC_SNAPSHOT_SCHEMA = 'strategic_snapshot_v1';
export const STRATEGIC_SNAPSHOT_VERSION = 1;

export const DEFAULT_HISTORY_POLICY = Object.freeze({
  retention: 20,
  friendlyFleetDetail: true,
  friendlyShipLedger: true,
  hostileContactMinimumShips: 5,
  preserveHostileIfTargetingPlayer: true,
  preserveHostileIfSameTheater: true,
  preserveConstruction: true,
  preserveResearchQueues: true,
  preserveCouncilors: false,
  preserveNations: false,
  preserveShipComponents: false,
  preserveStaticTechTree: false
});

// Mine limit is granted by Effect_SpaceMineFreebies* on these techs/projects.
// Verified against the installed 1.0 templates: the seven mission techs total
// 36, and Project_GoldRush adds 6 for Project Exodus only, giving 42.
export const MINE_LIMIT_GRANTS = Object.freeze({
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

const RESOURCE_KEYS = Object.freeze([
  ['water', 'Water'],
  ['volatiles', 'Volatiles'],
  ['metals', 'Metals'],
  ['nobles', 'NobleMetals'],
  ['fissiles', 'Fissiles'],
  ['antimatter', 'Antimatter'],
  ['exotics', 'Exotics']
]);

const asArray = (value) => (Array.isArray(value) ? value : []);
// Number(null) is 0 and Number('') is 0, so a bare Number.isFinite guard would
// silently turn a redacted or absent field into a confident zero.
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value, places = 2) => {
  const n = num(value);
  if (n === null) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// Small, stable, dependency-free digest. Used only to detect that a completed
// set changed between snapshots -- not for security.
const digest = (values) => {
  const text = asArray(values).slice().sort().join('');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `fnv:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}:${asArray(values).length}`;
};

// snapshotBuilder emits weaponBreakdown as an array of role objects, each with
// an empty `systems` array -- ~260 bytes per fleet. Collapse to a flat count
// map (~40 bytes); the role totals are all history needs.
const compactWeaponMix = (breakdown) => {
  const mix = {};
  for (const entry of asArray(breakdown)) {
    const role = String(entry.role || entry.category || '').toLowerCase();
    if (!role) continue;
    const key = role === 'point defense' ? 'pd' : role.replace(/\s+/g, '');
    mix[key] = (mix[key] || 0) + (num(entry.count) ?? 0);
  }
  return Object.keys(mix).length > 0 ? mix : null;
};

const factionSummary = (faction) => {
  const row = {
    id: num(faction.ID),
    habs: num(faction.habsCount) ?? 0,
    fleets: num(faction.fleetsCount) ?? 0,
    ships: num(faction.shipsCount) ?? 0
  };
  // Earth-side metrics are meaningless for the aliens; omit rather than zero.
  if (num(faction.controlPointsCount)) row.cp = num(faction.controlPointsCount);
  if (num(faction.nationsCount)) row.nations = num(faction.nationsCount);
  if (num(faction.totalGdp)) row.gdp = Math.round(num(faction.totalGdp));
  if (num(faction.totalResearch)) row.research = Math.round(num(faction.totalResearch));
  return row;
};

const buildEconomy = (observer, habSites, completed) => {
  // Preserve unknown as null. Older snapshots predate some of these fields,
  // and rendering an absent value as 0 would read as a verified "none" -- the
  // trend line would claim we ran no mission control in 2029.
  const resources = {};
  for (const [outKey, saveKey] of RESOURCE_KEYS) {
    resources[outKey] = [
      round(observer.resources?.[saveKey], 1),
      round(observer.monthlyNet?.[saveKey], 1)
    ];
  }

  // Guard on presence, not truthiness: a module id of 0 is a valid id.
  const mineCount = habSites.filter(
    (site) => site.mineModuleId != null && Number(site.factionId) === Number(observer.ID)
  ).length;

  let mineLimit = 0;
  let limitResolved = false;
  for (const [id, grant] of Object.entries(MINE_LIMIT_GRANTS)) {
    if (completed.has(id)) {
      mineLimit += grant;
      limitResolved = true;
    }
  }

  const excess = limitResolved ? Math.max(0, mineCount - mineLimit) : 0;
  // Wiki Habs: MC penalty past the mine limit is Max(1, Floor(excess^2 / 2)).
  const minePenalty = excess > 0 ? Math.max(1, Math.floor((excess * excess) / 2)) : 0;

  const money = num(observer.resources?.Money);
  return {
    money: money === null ? null : Math.round(money),
    boost: round(observer.resources?.Boost, 1),
    mc: {
      used: num(observer.missionControlUsage),
      cap: num(observer.missionControlCapacity),
      minePenalty
    },
    mines: { count: mineCount, limit: limitResolved ? mineLimit : null },
    resources
  };
};

const buildAlienThreat = (raw, observer, campaignYear) => {
  const economics = buildAlienHateEconomics({
    observer,
    difficulty: raw.metadata?.difficulty,
    mode: 'omniscient'
  });

  const startYear = num(raw.metadata?.campaignStartYear);
  const yearsElapsed = startYear !== null && campaignYear !== null
    ? campaignYear - startYear
    : null;

  return {
    hate: round(economics.actualAlienHate, 2),
    minimumHate: round(economics.minimumAlienHate, 2),
    usedMC: economics.usedMissionControl,
    warThreshold: economics.warThreshold,
    concealment: economics.completedReductionProjectCount,
    mcWarFloor: economics.mcWarFloor === null ? null : Math.floor(economics.mcWarFloor),
    retaliationActive:
      economics.actualAlienHate === null
        ? null
        : economics.actualAlienHate >= economics.warThreshold,
    yearsElapsed
  };
};

const buildResearch = (raw, observer) => {
  const global = asArray(raw.globalResearch?.activeSlots).map((slot) => [
    slot.techId,
    Math.round(num(slot.accumulatedResearch) ?? 0),
    Math.round(num(slot.totalCost) ?? 0)
  ]);

  const projects = asArray(observer.currentProjects).map((p) => [
    p.projectId,
    Math.round(num(p.accumulatedResearch) ?? 0),
    Math.round(num(p.totalCost) ?? 0)
  ]);

  return {
    monthly: Math.round(num(observer.monthlyNet?.Research) ?? 0),
    global,
    projects,
    completedTechHash: digest(raw.globalResearch?.finishedTechsNames),
    completedProjectHash: digest(observer.completedProjects)
  };
};

// [ships, fleets, habs] per faction per body. Highest value-per-byte block in
// the format: twenty of these give a whole-campaign force trend for kilobytes.
const buildTheaters = (raw) => {
  const byBody = new Map();
  const bucket = (body, factionId) => {
    if (!body) return null;
    if (!byBody.has(body)) byBody.set(body, new Map());
    const factions = byBody.get(body);
    if (!factions.has(factionId)) factions.set(factionId, [0, 0, 0]);
    return factions.get(factionId);
  };

  for (const fleet of asArray(raw.fleets)) {
    const slot = bucket(fleet.orbitBody, Number(fleet.factionId));
    if (!slot) continue;
    slot[0] += num(fleet.shipsCount) ?? 0;
    slot[1] += 1;
  }
  for (const hab of asArray(raw.habs)) {
    const slot = bucket(hab.orbitBody, Number(hab.factionId));
    if (!slot) continue;
    slot[2] += 1;
  }

  return [...byBody.entries()]
    .map(([body, factions]) => ({
      body,
      f: Object.fromEntries([...factions.entries()].map(([id, t]) => [id, t]))
    }))
    .sort((a, b) => a.body.localeCompare(b.body));
};

const buildFriendlyFleets = (raw, observerId, policy) => {
  if (!policy.friendlyFleetDetail) return [];
  return asArray(raw.fleets)
    .filter((f) => Number(f.factionId) === Number(observerId))
    .map((fleet) => {
      const designs = new Map();
      for (const ship of asArray(fleet.ships)) {
        const key = ship.hullName || 'unknown';
        designs.set(key, (designs.get(key) || 0) + 1);
      }
      const row = {
        id: num(fleet.ID),
        body: fleet.orbitBody || null,
        ships: num(fleet.shipsCount) ?? 0,
        dv: round(fleet.lowestDeltaVKps, 1),
        cruiseMg: round(fleet.lowestCombatAccelerationMps2, 3),
        designs: [...designs.entries()]
      };
      if (fleet.mission) row.operation = fleet.mission;
      if (fleet.destination) row.destination = fleet.destination;
      if (fleet.arrivalDate) row.arrival = fleet.arrivalDate;
      return row;
    });
};

// [shipId, designId, fleetId] for living ships only. Absence between two
// snapshots already means loss, so an `alive` flag would be redundant.
const buildShipLedger = (raw, observerId, policy) => {
  if (!policy.friendlyShipLedger) return [];
  const ledger = [];
  for (const fleet of asArray(raw.fleets)) {
    if (Number(fleet.factionId) !== Number(observerId)) continue;
    for (const ship of asArray(fleet.ships)) {
      ledger.push([num(ship.id), ship.hullName || null, num(fleet.ID)]);
    }
  }
  return ledger;
};

const buildHostileContacts = (raw, observerId, policy) => {
  const ourBodies = new Set();
  for (const hab of asArray(raw.habs)) {
    if (Number(hab.factionId) === Number(observerId) && hab.orbitBody) ourBodies.add(hab.orbitBody);
  }
  for (const fleet of asArray(raw.fleets)) {
    if (Number(fleet.factionId) === Number(observerId) && fleet.orbitBody) ourBodies.add(fleet.orbitBody);
  }

  const ourHabIds = new Set(
    asArray(raw.habs)
      .filter((h) => Number(h.factionId) === Number(observerId))
      .map((h) => Number(h.ID))
  );

  return asArray(raw.fleets)
    .filter((fleet) => {
      if (Number(fleet.factionId) === Number(observerId)) return false;
      const ships = num(fleet.shipsCount) ?? 0;
      const targetsUs =
        policy.preserveHostileIfTargetingPlayer &&
        (ourHabIds.has(Number(fleet.destinationId)) || ourBodies.has(fleet.destination));
      const nearUs = policy.preserveHostileIfSameTheater && ourBodies.has(fleet.orbitBody);
      return targetsUs || nearUs || ships >= policy.hostileContactMinimumShips;
    })
    .map((fleet) => {
      const row = {
        id: num(fleet.ID),
        faction: num(fleet.factionId),
        ships: num(fleet.shipsCount) ?? 0,
        origin: fleet.orbitBody || null
      };
      if (fleet.destination) row.destination = fleet.destination;
      if (fleet.destinationType) row.targetType = fleet.destinationType;
      if (fleet.destinationId) row.targetId = num(fleet.destinationId);
      if (fleet.arrivalDate) row.arrival = fleet.arrivalDate;
      const mix = compactWeaponMix(fleet.weaponBreakdown);
      if (mix) row.weaponMix = mix;
      return row;
    });
};

const buildInfrastructure = (raw, observerId) => {
  const byHab = new Map();
  for (const hab of asArray(raw.habs)) {
    if (Number(hab.factionId) !== Number(observerId)) continue;
    byHab.set(Number(hab.ID), {
      id: Number(hab.ID),
      body: hab.orbitBody || null,
      tier: num(hab.tier) ?? 0,
      mine: 0,
      yards: 0,
      defense: 0,
      construction: 0,
      research: 0
    });
  }

  for (const module of asArray(raw.habModules)) {
    const entry = byHab.get(Number(module.habId));
    if (!entry || module.destroyed || module.constructionStatus !== 'operational') continue;
    const template = String(module.templateName || '');
    if (module.isShipyard) entry.yards += 1;
    if (/Mining/i.test(template)) entry.mine += 1;
    if (/Defense|Battery|Laser|Gun|Missile/i.test(template)) entry.defense += 1;
    if (/Construction|Shipyard|Spaceworks|Dock/i.test(template)) entry.construction += 1;
    if (/Lab|Research|Science/i.test(template)) entry.research += 1;
  }

  return [...byHab.values()];
};

const buildMines = (raw, observerId) =>
  asArray(raw.habSites)
    .filter((site) => site.mineModuleId != null && Number(site.factionId) === Number(observerId))
    .map((site) => [site.displayName, Number(site.factionId), num(site.mineTier) ?? 0]);

const buildConstruction = (raw, observerId, policy) => {
  if (!policy.preserveConstruction) return [];
  const rows = [];
  for (const queue of asArray(raw.shipyardQueues)) {
    if (Number(queue.factionId) !== Number(observerId)) continue;
    rows.push({
      id: `ship-${queue.id}`,
      type: 'ship',
      design: queue.design || queue.hull || null,
      location: queue.orbitBody || null,
      completion: queue.completionDate || null
    });
  }
  for (const module of asArray(raw.habModules)) {
    if (Number(module.factionId) !== Number(observerId)) continue;
    if (module.constructionCompleted || module.destroyed) continue;
    rows.push({
      id: `module-${module.id}`,
      type: 'module',
      template: module.templateName || null,
      location: module.orbitBody || null,
      completion: module.completionDate || null
    });
  }
  return rows;
};

// Only strategically meaningful transfers: our own movements, plus hostile
// traffic inbound to something of ours. Every other faction's shuttling is
// noise here and duplicates hostileContacts.
const buildTransfers = (raw, observerId) => {
  const ourBodies = new Set(
    asArray(raw.habs)
      .filter((h) => Number(h.factionId) === Number(observerId) && h.orbitBody)
      .map((h) => h.orbitBody)
  );
  const ourHabIds = new Set(
    asArray(raw.habs)
      .filter((h) => Number(h.factionId) === Number(observerId))
      .map((h) => Number(h.ID))
  );

  return asArray(raw.fleets)
    .filter((fleet) => {
      if (!fleet.destination || fleet.destination === fleet.orbitBody) return false;
      if (Number(fleet.factionId) === Number(observerId)) return true;
      return ourHabIds.has(Number(fleet.destinationId)) || ourBodies.has(fleet.destination);
    })
    .map((fleet) => {
      const row = {
        fleet: num(fleet.ID),
        faction: num(fleet.factionId),
        from: fleet.orbitBody || null,
        to: fleet.destination,
        ships: num(fleet.shipsCount) ?? 0,
        arrival: fleet.arrivalDate || null
      };
      if (fleet.destinationId) row.target = num(fleet.destinationId);
      if (Number(fleet.factionId) === Number(observerId)) row.ours = true;
      return row;
    });
};

/**
 * Derive material events by comparing against the previous compact snapshot.
 * Cheap to store and far more useful to an analyst than two raw numbers.
 */
export function deriveEvents(previous, current) {
  const events = [];
  if (!previous) return events;

  const prevShips = new Map(asArray(previous.ships).map(([id, design]) => [id, design]));
  const currShips = new Set(asArray(current.ships).map(([id]) => id));
  const lostByDesign = new Map();
  for (const [id, design] of prevShips.entries()) {
    if (!currShips.has(id)) {
      const key = design || 'unknown';
      lostByDesign.set(key, (lostByDesign.get(key) || 0) + 1);
    }
  }
  if (lostByDesign.size > 0) {
    events.push({
      type: 'ship_loss',
      faction: current.summary?.observerFactionId ?? null,
      count: [...lostByDesign.values()].reduce((a, b) => a + b, 0),
      designs: [...lostByDesign.entries()]
    });
  }

  const prevHabs = new Set(asArray(previous.infrastructure).map((h) => h.id));
  const currHabs = new Set(asArray(current.infrastructure).map((h) => h.id));
  for (const hab of asArray(previous.infrastructure)) {
    if (!currHabs.has(hab.id)) {
      events.push({ type: 'hab_lost', faction: current.summary?.observerFactionId ?? null, body: hab.body, id: hab.id });
    }
  }
  for (const hab of asArray(current.infrastructure)) {
    if (!prevHabs.has(hab.id)) {
      events.push({ type: 'hab_gained', body: hab.body, id: hab.id });
    }
  }

  const prevProjects = new Set(asArray(previous.research?.projects).map(([id]) => id));
  for (const [id] of asArray(current.research?.projects)) {
    // A project that was in progress and is no longer in progress completed.
    if (!prevProjects.has(id)) events.push({ type: 'project_started', id });
  }
  for (const id of prevProjects) {
    const stillActive = asArray(current.research?.projects).some(([pid]) => pid === id);
    if (!stillActive) events.push({ type: 'project_resolved', id });
  }

  if (previous.research?.completedProjectHash !== current.research?.completedProjectHash) {
    events.push({ type: 'completed_projects_changed' });
  }

  // Crossing the alien war threshold is the single most consequential discrete
  // state change in a campaign, so make it first-class rather than inferred.
  const from = previous.alienThreat?.hate;
  const to = current.alienThreat?.hate;
  const threshold = current.alienThreat?.warThreshold ?? 50;
  if (num(from) !== null && num(to) !== null) {
    if (from < threshold && to >= threshold) {
      events.push({ type: 'hate_threshold_crossed', from, to, threshold, direction: 'up' });
    } else if (from >= threshold && to < threshold) {
      events.push({ type: 'hate_threshold_crossed', from, to, threshold, direction: 'down' });
    }
  }

  return events;
}

/**
 * Build a `strategic_snapshot_v1` document from a raw snapshot.
 *
 * @param {object} raw           Raw snapshot from snapshotBuilder.buildRawSnapshot
 * @param {object} [opts]
 * @param {number} [opts.observerFactionId]
 * @param {string} [opts.campaignKey]
 * @param {object} [opts.policy]   Overrides for DEFAULT_HISTORY_POLICY
 * @param {object} [opts.previous] Previous compact snapshot, for event derivation
 */
export function buildStrategicSnapshot(raw, {
  observerFactionId = 4712,
  campaignKey = null,
  policy = {},
  previous = null
} = {}) {
  const merged = { ...DEFAULT_HISTORY_POLICY, ...policy };
  const factions = asArray(raw.factions);
  const observer = factions.find((f) => Number(f.ID) === Number(observerFactionId)) || {};

  const campaignDate = raw.metadata?.gameTimeString || null;
  const campaignYear = campaignDate ? num(String(campaignDate).match(/\/(\d{4})\b/)?.[1]) : null;

  const completed = new Set([
    ...asArray(raw.globalResearch?.finishedTechsNames),
    ...asArray(observer.completedProjects)
  ].map(String));

  const doc = {
    schema: STRATEGIC_SNAPSHOT_SCHEMA,
    meta: {
      campaignKey,
      saveFilename: raw.metadata?.fileName || null,
      saveLastModified: raw.metadata?.lastModified || null,
      campaignDate,
      difficulty: raw.metadata?.difficulty || null
    },
    summary: {
      observerFactionId: Number(observerFactionId),
      factions: factions.map(factionSummary)
    },
    economy: buildEconomy(observer, asArray(raw.habSites), completed),
    alienThreat: buildAlienThreat(raw, observer, campaignYear),
    research: merged.preserveResearchQueues ? buildResearch(raw, observer) : null,
    theaters: buildTheaters(raw),
    friendlyFleets: buildFriendlyFleets(raw, observerFactionId, merged),
    ships: buildShipLedger(raw, observerFactionId, merged),
    hostileContacts: buildHostileContacts(raw, observerFactionId, merged),
    infrastructure: buildInfrastructure(raw, observerFactionId),
    mines: buildMines(raw, observerFactionId),
    construction: buildConstruction(raw, observerFactionId, merged),
    transfers: buildTransfers(raw, observerFactionId),
    events: []
  };

  doc.events = deriveEvents(previous, doc);
  return doc;
}

export default { buildStrategicSnapshot, deriveEvents, STRATEGIC_SNAPSHOT_SCHEMA, DEFAULT_HISTORY_POLICY };
