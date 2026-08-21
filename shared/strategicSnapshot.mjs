// shared/strategicSnapshot.mjs
//
// Purpose: reduce a full raw snapshot to a compact strategic_snapshot_v1
//   document for trend and delta analysis.
//
// Reduces a full raw snapshot to `strategic_snapshot_v1`: a compact,
// self-contained document for trend and delta analysis.
//
// Design rules (see docs/archive/strategic-history-and-war-room-plan.md):
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
import { deriveStructuredEvents } from './strategicDelta.mjs';
import { DEFAULT_OBSERVER_FACTION_ID } from './constants.mjs';
import { asArray, toFiniteNumber as num, round, sameId, resolveObserverFaction } from './util.mjs';

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

// Hab-module capability families, verified against the installed 1.0 templates
// at TerraInvicta_Data/StreamingAssets/Templates/TIHabModuleTemplate.json
// (file mtime 2026-08-14, read 2026-08-20).
//
// The two families are DISJOINT in 1.0 -- zero overlap across all 156 module
// templates -- so counting a shipyard as a construction module too was a
// miscategorisation, not a deliberate dual count:
//
//   * exactly 6 templates carry `allowsShipConstruction: true`
//     (SpaceDock/Shipyard/Spaceworks + the three alien equivalents). These
//     build SHIPS. ConstructionModule has `allowsShipConstruction: false`.
//   * exactly 6 templates carry a `CanFoundTierNHabs` special rule
//     (ConstructionModule/Nanofactory/NanofacturingComplex + alien
//     equivalents). These found HABS and speed module construction.
//
// The old /Construction|Shipyard|Spaceworks|Dock/ name regex was wrong in both
// directions: it double-counted every shipyard as construction, and it missed
// Nanofactory / NanofacturingComplex / AlienAssembler entirely -- so a hab
// whose construction capacity came from a tier-2 or tier-3 module reported
// `construction: 0`. On the live save that inflated the observer's
// construction count from 1 to 12.
export const SHIP_CONSTRUCTION_MODULES = Object.freeze([
  'SpaceDock', 'Shipyard', 'Spaceworks',
  'AlienSpacedock', 'AlienShipyard', 'AlienSpaceworks'
]);

export const HAB_CONSTRUCTION_MODULES = Object.freeze([
  'ConstructionModule', 'Nanofactory', 'NanofacturingComplex',
  'AlienAssembler', 'AlienNanofactory', 'AlienNanofacturingComplex'
]);

const SHIP_CONSTRUCTION_SET = new Set(SHIP_CONSTRUCTION_MODULES.map(n => n.toLowerCase()));
const HAB_CONSTRUCTION_SET = new Set(HAB_CONSTRUCTION_MODULES.map(n => n.toLowerCase()));

// Fallback for module names a future patch may add. Deliberately excludes the
// shipyard vocabulary so an unrecognised yard cannot leak back into the
// construction bucket.
const HAB_CONSTRUCTION_PATTERN = /Construction|Nanofact|Assembler/i;

const RESOURCE_KEYS = Object.freeze([
  ['water', 'Water'],
  ['volatiles', 'Volatiles'],
  ['metals', 'Metals'],
  ['nobles', 'NobleMetals'],
  ['fissiles', 'Fissiles'],
  ['antimatter', 'Antimatter'],
  ['exotics', 'Exotics']
]);

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
  // Absent stays null. A faction row published by an older parser, or one whose
  // counts were redacted, must not report a confident "0 ships" -- the delta
  // would then narrate a fleet that vanished and never existed.
  const row = {
    id: num(faction.ID),
    habs: num(faction.habsCount),
    fleets: num(faction.fleetsCount),
    ships: num(faction.shipsCount)
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
    (site) => site.mineModuleId != null && sameId(site.factionId, observer.ID)
  ).length;

  let mineLimit = 0;
  let limitResolved = false;
  for (const [id, grant] of Object.entries(MINE_LIMIT_GRANTS)) {
    if (completed.has(id)) {
      mineLimit += grant;
      limitResolved = true;
    }
  }

  // Wiki Habs: MC penalty past the mine limit is Max(1, Floor(excess^2 / 2)).
  //
  // An unresolved limit is NOT a zero penalty. When no mine-limit grant could
  // be read (an older snapshot, or a missing globalResearch block) while mines
  // are standing, the penalty is unknown and must say so; reporting 0 would
  // claim a verified "no mission-control penalty" that was never measured.
  // Zero mines is the one case that is answerable without the limit.
  let minePenalty = null;
  if (mineCount === 0) {
    minePenalty = 0;
  } else if (limitResolved) {
    const excess = Math.max(0, mineCount - mineLimit);
    minePenalty = excess > 0 ? Math.max(1, Math.floor((excess * excess) / 2)) : 0;
  }

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
  // TIMetadataState does not carry a campaign start year, so snapshotBuilder
  // reports the measured field as null and offers `assumedCampaignStartYear`
  // separately as an explicitly labelled assumption. Total war needs the
  // elapsed-years gate, so use the assumption when there is no measurement --
  // but carry `yearsElapsedAssumed` alongside it, so a reader can tell a
  // measured campaign age from a presumed one rather than being handed a
  // confident number. Without this the state would be permanently
  // 'unavailable' and the most consequential event in a campaign would never
  // announce itself.
  const measuredStartYear = num(raw.metadata?.campaignStartYear);
  const assumedStartYear = num(raw.metadata?.assumedCampaignStartYear);
  const startYear = measuredStartYear ?? assumedStartYear;
  const yearsElapsed = startYear !== null && campaignYear !== null
    ? campaignYear - startYear
    : null;
  const yearsElapsedAssumed = yearsElapsed !== null && measuredStartYear === null;

  // yearsElapsed must be supplied here: total war needs BOTH the campaign-year
  // gate and 200 hate, and buildTotalWarState reports 'unavailable' without it.
  // Omitting it is what left `alienThreat.totalWar` absent from every published
  // snapshot, which in turn made the delta's total-war narration unreachable.
  const economics = buildAlienHateEconomics({
    observer,
    difficulty: raw.metadata?.difficulty,
    mode: 'omniscient',
    yearsElapsed
  });

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
    yearsElapsed,
    yearsElapsedAssumed,
    // Total war is a distinct, far more consequential state than crossing the
    // hate-50 war threshold, and it is what strategicDelta reads to decide
    // whether to announce a declaration. Carrying the state string rather than
    // a boolean preserves the difference between "not at total war" and
    // "cannot tell" (hate redacted after the year gate opened).
    totalWar: {
      state: economics.totalWar.state,
      hateThreshold: economics.totalWar.hateThreshold,
      yearsThreshold: economics.totalWar.yearsThreshold,
      yearsRemaining: economics.totalWar.yearsRemaining,
      hateRemaining: round(economics.totalWar.hateRemaining, 2),
      yearsElapsedAssumed
    }
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

  // The completed-project ledger, sorted for a stable diff. The hashes alone
  // could only say THAT the set changed, never WHICH projects finished, so the
  // delta's "projects completed this period" list was permanently empty --
  // nothing in the codebase ever produced the `completedSincePrior` it read.
  //
  // Storing the ids costs ~4 KB on the live save (140 projects) against a
  // 100 KB target, and unlike a since-prior list it is exact for ANY pair of
  // retained snapshots rather than only adjacent ones. Absent stays absent:
  // when the raw save has no completed-project array, the field is null so the
  // delta reports "unknown" instead of "nothing was completed".
  const completedProjects = Array.isArray(observer.completedProjects)
    ? [...new Set(observer.completedProjects.map(String))].sort()
    : null;

  const monthlyResearch = num(observer.monthlyNet?.Research);

  return {
    monthly: monthlyResearch === null ? null : Math.round(monthlyResearch),
    global,
    projects,
    completedProjects,
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
    .filter((f) => sameId(f.factionId, observerId))
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
    if (!sameId(fleet.factionId, observerId)) continue;
    for (const ship of asArray(fleet.ships)) {
      ledger.push([num(ship.id), ship.hullName || null, num(fleet.ID)]);
    }
  }
  return ledger;
};

const buildHostileContacts = (raw, observerId, policy) => {
  const ourBodies = new Set();
  for (const hab of asArray(raw.habs)) {
    if (sameId(hab.factionId, observerId) && hab.orbitBody) ourBodies.add(hab.orbitBody);
  }
  for (const fleet of asArray(raw.fleets)) {
    if (sameId(fleet.factionId, observerId) && fleet.orbitBody) ourBodies.add(fleet.orbitBody);
  }

  const ourHabIds = new Set(
    asArray(raw.habs)
      .filter((h) => sameId(h.factionId, observerId))
      .map((h) => Number(h.ID))
  );

  return asArray(raw.fleets)
    .filter((fleet) => {
      if (sameId(fleet.factionId, observerId)) return false;
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
    if (!sameId(hab.factionId, observerId)) continue;
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
    const key = template.toLowerCase();
    // Ship construction and hab construction are separate capabilities in the
    // 1.0 templates (see SHIP_CONSTRUCTION_MODULES above), so a module counts
    // toward exactly one of `yards` and `construction`.
    const isYard = module.isShipyard === true || SHIP_CONSTRUCTION_SET.has(key);
    if (isYard) entry.yards += 1;
    if (/Mining/i.test(template)) entry.mine += 1;
    if (/Defense|Battery|Laser|Gun|Missile/i.test(template)) entry.defense += 1;
    if (!isYard && (HAB_CONSTRUCTION_SET.has(key) || HAB_CONSTRUCTION_PATTERN.test(template))) {
      entry.construction += 1;
    }
    if (/Lab|Research|Science/i.test(template)) entry.research += 1;
  }

  return [...byHab.values()];
};

const buildMines = (raw, observerId) =>
  asArray(raw.habSites)
    .filter((site) => site.mineModuleId != null && sameId(site.factionId, observerId))
    .map((site) => [site.displayName, Number(site.factionId), num(site.mineTier) ?? 0]);

const buildConstruction = (raw, observerId, policy) => {
  if (!policy.preserveConstruction) return [];
  const rows = [];
  for (const queue of asArray(raw.shipyardQueues)) {
    if (!sameId(queue.factionId, observerId)) continue;
    rows.push({
      id: `ship-${queue.id}`,
      type: 'ship',
      design: queue.design || queue.hull || null,
      location: queue.orbitBody || null,
      completion: queue.completionDate || null
    });
  }
  for (const module of asArray(raw.habModules)) {
    if (!sameId(module.factionId, observerId)) continue;
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
      .filter((h) => sameId(h.factionId, observerId) && h.orbitBody)
      .map((h) => h.orbitBody)
  );
  const ourHabIds = new Set(
    asArray(raw.habs)
      .filter((h) => sameId(h.factionId, observerId))
      .map((h) => Number(h.ID))
  );

  return asArray(raw.fleets)
    .filter((fleet) => {
      if (!fleet.destination || fleet.destination === fleet.orbitBody) return false;
      if (sameId(fleet.factionId, observerId)) return true;
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
      if (sameId(fleet.factionId, observerId)) row.ours = true;
      return row;
    });
};

/**
 * Derive material events by comparing against the previous compact snapshot.
 * Cheap to store and far more useful to an analyst than two raw numbers.
 *
 * This used to be a second, independent implementation of the same diff that
 * strategicDelta already performed -- ship losses, hab changes, project
 * transitions, completed-set comparison and hate-threshold crossing were all
 * written twice. The two copies had already drifted apart, which is how the
 * total-war and completed-project signals ended up dead on the delta side.
 * There is now one diff; this entry point only chooses the structured-object
 * rendering of it, while `buildStrategicDelta` chooses the narration strings.
 */
export function deriveEvents(previous, current) {
  return deriveStructuredEvents(previous, current);
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
  observerFactionId = DEFAULT_OBSERVER_FACTION_ID,
  campaignKey = null,
  policy = {},
  previous = null
} = {}) {
  const merged = { ...DEFAULT_HISTORY_POLICY, ...policy };
  const factions = asArray(raw.factions);
  // No name or first-faction fallback here by design: a compact history
  // document that silently described a different faction would poison every
  // delta computed against it.
  const observer = resolveObserverFaction(factions, observerFactionId) || {};

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
      difficulty: raw.metadata?.difficulty || null,
      // Carried beside the raw word, never instead of it: a history row that
      // records "Normal" for a campaign running four rates at 200% is the same
      // record as a stock campaign's, and nothing downstream could tell them
      // apart. Rows written before the settings were baked have no label and
      // read back as the bare difficulty, exactly as before.
      difficultyLabel: raw.metadata?.difficultyLabel || raw.metadata?.difficulty || null
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
