// shared/intel/militaryValue.mjs
//
// Purpose: /api/intel/military-value — phase 2 of the research advisor, pricing
//   every unlock family the propulsion phase does not cover.
//
// `/api/intel/military-value` -- phase 2 of the research advisor.
//
// Phase 1 priced drives. This prices everything else the unlock index gates
// that a warship or a hab is built out of: the six weapon families, ship hulls,
// ship armour, power plants, radiators, heat sinks, batteries, utility modules
// and hab modules.
//
// It consumes phase 1 rather than repeating it:
//
//   shared/unlockIndex.mjs          which project (or tech) gates each item,
//                                   and everything else that gate unlocks
//   shared/researchAvailability.mjs the six availability states, read from the
//                                   save's own `availableProjectNames`
//   shared/militaryValue.mjs        the metrics, the formulae and the ranking
//
// and it does NOT do economic valuation (spec section 4), slot allocation
// (section 6) or the UI panel. Those are later phases.
//
// Everything is read from the snapshot at request time. The baseline is
// whatever the observer's ships and habs actually carry, the candidate set is
// whatever the baked component catalogue holds, and the armour ranking follows
// the observed threat mix. A turn-1 observer who flies nothing gets an honest
// empty baseline and a catalogue that is still fully described.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, round, sameId, toFiniteNumber as toFinite } from '../util.mjs';
import {
  AXIS_SETS,
  CLASS_KINDS,
  COMPONENT_CLASS_SPECS,
  MAGAZINE_BASIS_CODES,
  MILITARY_FORMULAE,
  MOUNT_HARDPOINTS,
  RATIO_UNAVAILABLE_CODES,
  WEAPON_CLASS_SPECS,
  WEAPON_ROLES,
  armorMetrics,
  batteryMetrics,
  bestOnAxis,
  hullMetrics,
  heatSinkMetrics,
  powerPlantMetrics,
  radiatorMetrics,
  rankArmorAxis,
  rankByAxis,
  ratioAgainst,
  ruleModuleMetrics,
  threatMix,
  weaponMetrics,
  weaponRole,
  MILITARY_CLASS_SPECS
} from '../militaryValue.mjs';
import {
  DELIVERY_BASIS_CODES,
  DELIVERY_FORMULAE,
  buildPointDefenseProfile
} from '../munitionDelivery.mjs';
import {
  AVAILABILITY_STATES,
  buildAvailabilityResolver,
  tallyAvailabilityStates
} from '../researchAvailability.mjs';
import {
  MEASURED_INCOME_BASIS,
  buildResearchCategoryBonuses,
  categoryBonusSummary,
  priceResearchDuration,
  researchDurationFields
} from '../researchCategoryBonus.mjs';
import { allocationPricingSummary, buildResearchAllocationPricing } from '../researchAllocationPricing.mjs';
import { buildItemGateMap, unlockIndexCensus, unlocksForGate } from '../unlockIndex.mjs';
import { findAlienFaction } from './common.mjs';

const DEFAULT_CANDIDATE_LIMIT = 8;
const MAX_CANDIDATE_LIMIT = 100;

/**
 * How many rows of a point-defence profile the response lists.
 *
 * The MODEL always uses every weapon and every faction it read; these caps
 * apply to the emitted listing only, so truncation can never change a number.
 * Both carry a `*TotalCount` and a `*OmittedCount` beside them -- a capped list
 * presented as the whole set is the same defect class as fabricating data.
 */
const PROFILE_WEAPON_LIMIT = 25;
const PROFILE_FACTION_LIMIT = 25;

/** The six weapon families, in the order the unlock index lists them. */
const WEAPON_FAMILIES = Object.freeze([
  'laser_weapon', 'magnetic_gun', 'gun', 'particle_weapon', 'plasma_weapon', 'missile'
]);

/** Every family this endpoint values, weapons first. */
const FAMILY_ORDER = Object.freeze([
  ...WEAPON_FAMILIES,
  'ship_hull', 'ship_armor', 'power_plant', 'radiator', 'heat_sink', 'battery',
  'utility_module', 'hab_module'
]);

const isWeaponFamily = (family) => WEAPON_FAMILIES.includes(family);

/** family -> metric builder. Weapons need their family; the rest do not. */
function metricsFor(family, id, stats, context = {}) {
  if (isWeaponFamily(family)) {
    return weaponMetrics(id, stats, family, { pointDefenseProfile: context.pointDefenseProfile ?? null });
  }
  switch (family) {
    case 'ship_hull': return hullMetrics(id, stats, context.armament);
    case 'ship_armor': return armorMetrics(id, stats);
    case 'power_plant': return powerPlantMetrics(id, stats);
    case 'radiator': return radiatorMetrics(id, stats);
    case 'heat_sink': return heatSinkMetrics(id, stats);
    case 'battery': return batteryMetrics(id, stats);
    case 'utility_module':
    case 'hab_module': return ruleModuleMetrics(id, stats, family);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// WHAT THE OBSERVER FIELDS
// ---------------------------------------------------------------------------

/**
 * `id -> family`, and `displayName -> {family, id}`, over the whole catalogue.
 *
 * A design's `moduleTemplateEntries` names a module without saying which family
 * it belongs to, and a ship's `weaponLoadout` names weapons by their DISPLAY
 * name only -- which is the only handle player mode leaves for a faction whose
 * designs are redacted.
 *
 * Both maps refuse to resolve an ambiguous key. On the installed 1.0 templates
 * no display name maps to two components and no id appears in two families, and
 * `tests/militaryValue.test.js` asserts that rather than assuming it. If a
 * future patch introduces a collision the entry is reported as ambiguous and
 * dropped, never resolved to whichever one happened to load last -- the
 * `"undefined"` dedupe collision in `server/engine/candidates` is what that
 * rule exists to prevent.
 */
function buildCatalogueIndex(componentStats) {
  const familyOfId = new Map();
  const ambiguousIds = new Set();
  const byDisplayName = new Map();
  const ambiguousNames = new Set();

  for (const family of FAMILY_ORDER) {
    const entries = componentStats?.[family];
    if (!entries || typeof entries !== 'object') continue;
    for (const [id, stats] of Object.entries(entries)) {
      if (familyOfId.has(id) && familyOfId.get(id) !== family) ambiguousIds.add(id);
      else familyOfId.set(id, family);
      const name = stats?.displayName;
      if (!name) continue;
      const existing = byDisplayName.get(name);
      if (existing && (existing.id !== id || existing.family !== family)) ambiguousNames.add(name);
      else byDisplayName.set(name, { family, id });
    }
  }
  for (const id of ambiguousIds) familyOfId.delete(id);
  for (const name of ambiguousNames) byDisplayName.delete(name);
  return { familyOfId, byDisplayName, ambiguousIds: [...ambiguousIds], ambiguousNames: [...ambiguousNames] };
}

/** Ships belonging to one faction, with their fleet attached. */
const shipsOfFaction = (snapshot, factionId) => asArray(snapshot?.fleets)
  .filter(fleet => sameId(fleet?.factionId, factionId))
  .flatMap(fleet => asArray(fleet.ships).map(ship => ({ ship, fleet })));

/**
 * Every component id a faction actually has in service, per family, with how
 * many hulls or habs carry it.
 *
 * Ships in service, not designs on file: a design nobody has built is not
 * something the observer fields, and the comparison baseline in section 0 is
 * what they fly.
 *
 * A ship whose design is redacted still contributes through its
 * `weaponLoadout` display names, which survive redaction. That degradation is
 * recorded in `basis` rather than being silently equivalent to the design path.
 */
function buildFieldedInventory(snapshot, factionId, index) {
  const designsById = new Map(asArray(snapshot?.shipDesigns)
    .map(design => [design?.dataName, design])
    .filter(([key]) => key));

  const counts = new Map(); // `${family}:${id}` -> count
  const bump = (family, id, by = 1) => {
    if (!family || !id) return;
    const key = `${family}:${id}`;
    counts.set(key, (counts.get(key) || 0) + by);
  };

  let shipsRead = 0;
  let shipsViaDesign = 0;
  let shipsViaLoadout = 0;
  const unresolved = [];

  for (const { ship } of shipsOfFaction(snapshot, factionId)) {
    shipsRead += 1;
    const design = ship?.hullName ? designsById.get(ship.hullName) || null : null;
    if (design) {
      shipsViaDesign += 1;
      if (design.hullName) bump('ship_hull', design.hullName);
      if (design.powerPlantName) bump('power_plant', design.powerPlantName);
      if (design.radiatorName) bump('radiator', design.radiatorName);
      for (const slot of ['noseArmor', 'lateralArmor', 'tailArmor']) {
        const material = design[slot]?.materialName;
        if (material) bump('ship_armor', material);
      }
      for (const key of ['noseWeaponTemplateEntries', 'hullWeaponTemplateEntries']) {
        for (const entry of asArray(design[key])) {
          const name = entry?.moduleName;
          // `Empty` is the game's padding marker for an unfilled hardpoint. It
          // is not a component and must not become a catalogue miss.
          if (!name || name === 'Empty') continue;
          const family = index.familyOfId.get(name);
          if (!family) { unresolved.push({ id: name, reason: 'named by a design but absent from the component catalogue' }); continue; }
          bump(family, name);
        }
      }
      for (const entry of asArray(design.moduleTemplateEntries)) {
        const name = entry?.moduleName;
        if (!name || name === 'Empty') continue;
        const family = index.familyOfId.get(name);
        if (!family) { unresolved.push({ id: name, reason: 'named by a design but absent from the component catalogue' }); continue; }
        bump(family, name);
      }
      continue;
    }

    // No design -- the redacted case. Weapon display names are all that is
    // left, and they are enough for an armament benchmark.
    const loadout = asArray(ship?.weaponLoadout);
    if (loadout.length === 0) {
      unresolved.push({ id: ship?.hullName ?? null, reason: 'ship has neither a visible design nor a weapon loadout in this mode' });
      continue;
    }
    shipsViaLoadout += 1;
    for (const group of loadout) {
      for (const system of asArray(group?.systems)) {
        const hit = index.byDisplayName.get(system);
        if (!hit) { unresolved.push({ id: system, reason: 'weapon display name does not match any component in the catalogue' }); continue; }
        bump(hit.family, hit.id);
      }
    }
  }

  // Hab modules are carried by habs, not ships, so they are read separately.
  for (const module of asArray(snapshot?.habModules)) {
    if (!sameId(module?.factionId, factionId)) continue;
    const templateName = module?.templateName;
    if (!templateName) continue;
    bump('hab_module', templateName);
  }

  const byFamily = {};
  for (const [key, count] of counts) {
    const separator = key.indexOf(':');
    const family = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!byFamily[family]) byFamily[family] = new Map();
    byFamily[family].set(id, count);
  }

  return {
    byFamily,
    shipsRead,
    basis: shipsRead === 0
      ? 'the faction has no hulls in service in this snapshot'
      : `${shipsViaDesign} of ${shipsRead} hulls read through their ship design (exact component ids)`
        + (shipsViaLoadout > 0
          ? `; ${shipsViaLoadout} through weapon display names only, because their designs are not visible in this mode`
          : ''),
    shipsViaDesign,
    shipsViaLoadout,
    // Deduplicated: a name that fails to resolve on 200 hulls is one finding.
    unresolved: [...new Map(unresolved.map(row => [`${row.id}`, row])).values()].slice(0, 25)
  };
}

// ---------------------------------------------------------------------------
// THE DEFENSIVE BATTERY A MUNITION HAS TO FLY THROUGH -- phase 5
// ---------------------------------------------------------------------------

/**
 * Both point-defence inventories, from ONE walk of `snapshot.fleets`.
 *
 *   observed-opposing  every faction whose id is not the observer's. There is
 *                      no hostility flag anywhere in the snapshot, so this is
 *                      stated as what it is -- "every faction other than the
 *                      observer" -- rather than dressed up as a threat set it
 *                      cannot actually narrow to.
 *   observer-own       the observer's own hulls, as a NAMED fallback reference
 *                      for a snapshot in which nothing else is visible. It
 *                      answers a different question ("what would my own fleet
 *                      do to this round"), and which one was used is reported.
 *
 * Mounts are identified by the game's own `defenseMode` flag, NOT by the
 * `point-defense` weapon role: the role additionally requires
 * `attackMode: false` and so covers only the 9 dedicated turrets, while
 * `defenseMode` is carried by 121 lasers, 23 particle weapons, 5 guns and 10
 * magnetic guns -- every dual-purpose battery that also shoots at missiles.
 *
 * The same design-then-`weaponLoadout` degradation `buildFieldedInventory`
 * uses, and it matters here more than anywhere else, because it is the ONLY
 * reason a player-mode observer can see an alien point-defence battery at all.
 */
function buildPointDefenseInventories(snapshot, observerId, index, componentStats) {
  const designsById = new Map(asArray(snapshot?.shipDesigns)
    .map(design => [design?.dataName, design])
    .filter(([key]) => key));

  const make = () => ({
    mounts: new Map(),
    hullsRead: 0,
    hullsViaDesign: 0,
    hullsViaWeaponLoadout: 0,
    factions: new Map()
  });
  const buckets = { 'observed-opposing': make(), 'observer-own': make() };

  const statsOf = (id) => {
    const family = index.familyOfId.get(id);
    if (!family) return null;
    const stats = componentStats?.[family]?.[id];
    return stats ? { family, stats } : null;
  };

  for (const fleet of asArray(snapshot?.fleets)) {
    const bucketKey = sameId(fleet?.factionId, observerId) ? 'observer-own' : 'observed-opposing';
    const bucket = buckets[bucketKey];
    // An unresolvable faction identity must never become a dedupe key: the
    // string "undefined" has twice collapsed a whole record set in this repo.
    const factionKey = fleet?.factionId === null || fleet?.factionId === undefined
      ? null
      : String(fleet.factionId);

    for (const ship of asArray(fleet?.ships)) {
      bucket.hullsRead += 1;
      if (factionKey !== null) {
        if (!bucket.factions.has(factionKey)) {
          bucket.factions.set(factionKey, {
            factionId: fleet.factionId,
            displayName: fleet?.factionName ?? null,
            hulls: 0,
            pointDefenseInstallations: 0
          });
        }
        bucket.factions.get(factionKey).hulls += 1;
      }

      const count = (id) => {
        const hit = statsOf(id);
        if (!hit || hit.stats.defenseMode !== true) return;
        bucket.mounts.set(id, (bucket.mounts.get(id) || 0) + 1);
        if (factionKey !== null) bucket.factions.get(factionKey).pointDefenseInstallations += 1;
      };

      const design = ship?.hullName ? designsById.get(ship.hullName) || null : null;
      if (design) {
        bucket.hullsViaDesign += 1;
        for (const key of ['noseWeaponTemplateEntries', 'hullWeaponTemplateEntries']) {
          for (const entry of asArray(design[key])) {
            const name = entry?.moduleName;
            // `Empty` is the game's padding marker for an unfilled hardpoint.
            if (!name || name === 'Empty') continue;
            count(name);
          }
        }
        continue;
      }

      const loadout = asArray(ship?.weaponLoadout);
      if (loadout.length === 0) continue;
      bucket.hullsViaWeaponLoadout += 1;
      for (const group of loadout) {
        for (const system of asArray(group?.systems)) {
          const hit = index.byDisplayName.get(system);
          if (!hit) continue;
          count(hit.id);
        }
      }
    }
  }

  const toProfile = (key, bucket) => buildPointDefenseProfile({
    key,
    hullsRead: bucket.hullsRead,
    factions: [...bucket.factions.values()]
      .sort((a, b) => b.pointDefenseInstallations - a.pointDefenseInstallations
        || String(a.factionId).localeCompare(String(b.factionId))),
    basis: bucket.hullsRead === 0
      ? (key === 'observer-own'
        ? 'the observer has no hulls in service in this snapshot'
        : 'no hull belonging to any other faction is visible in this snapshot')
      : `${bucket.hullsViaDesign} of ${bucket.hullsRead} hulls read through their ship design (exact component ids)`
        + (bucket.hullsViaWeaponLoadout > 0
          ? `; ${bucket.hullsViaWeaponLoadout} through weapon display names only, because their designs are not visible in this mode`
          : ''),
    mounts: [...bucket.mounts.entries()].map(([id, installations]) => {
      const hit = statsOf(id);
      // Cycle time is phase 2's OWN firing-cycle figure. Deriving a second one
      // here would leave two models of the same thing free to drift apart.
      const metrics = hit ? weaponMetrics(id, hit.stats, hit.family) : null;
      return {
        id,
        displayName: hit?.stats?.displayName || id,
        installations,
        engagementRangeKm: toFinite(hit?.stats?.targetingRangeKm),
        cycleSeconds: metrics?.cycleSeconds ?? null
      };
    })
  });

  return {
    profiles: {
      'observed-opposing': toProfile('observed-opposing', buckets['observed-opposing']),
      'observer-own': toProfile('observer-own', buckets['observer-own'])
    },
    paths: {
      'observed-opposing': {
        hullsViaDesign: buckets['observed-opposing'].hullsViaDesign,
        hullsViaWeaponLoadout: buckets['observed-opposing'].hullsViaWeaponLoadout
      },
      'observer-own': {
        hullsViaDesign: buckets['observer-own'].hullsViaDesign,
        hullsViaWeaponLoadout: buckets['observer-own'].hullsViaWeaponLoadout
      }
    }
  };
}

/**
 * Which of the two profiles every row in this response is measured against.
 *
 * ONE profile is used throughout, so every number in the response is
 * comparable, and the choice is NAMED rather than implied. Opposing first,
 * because "what would actually be shooting at this round" is the question;
 * the observer's own battery second, as a stated stand-in; and with neither
 * available the delivery block reports `pointDefense: null` with the reason,
 * never an undefended target.
 */
function selectDeliveryProfile(inventories, mode) {
  const opposing = inventories.profiles['observed-opposing'];
  const own = inventories.profiles['observer-own'];

  if (opposing.available === true) {
    return {
      profile: opposing,
      selected: 'observed-opposing',
      selectionBasis: 'measured against every faction other than the observer. There is no hostility '
        + 'flag in this snapshot, so this is literally "everyone else", not a threat set narrowed to '
        + 'the factions actually at war with the observer.'
    };
  }
  if (own.available === true) {
    return {
      profile: own,
      selected: 'observer-own',
      selectionBasis: 'no point-defence battery is observable on any other faction\'s hulls in this '
        + `${mode} snapshot, so the observer's OWN battery is used as a named stand-in. It answers a `
        + 'different question -- what the observer\'s fleet would do to this round -- and the figures '
        + 'should be read as that rather than as a measurement of the opposition.'
    };
  }
  return {
    profile: null,
    selected: null,
    selectionBasis: 'no hull carrying a weapon the game marks `defenseMode` is observable anywhere in '
      + 'this snapshot, so how much defensive fire a round would fly through is UNMEASURED. That is '
      + 'not the same as an undefended target, and no delivery figure is reported rather than a zero.'
  };
}

/** One profile, capped for the wire, with what the cap left out. */
function emitProfile(profile, paths) {
  const weapons = asArray(profile.weapons);
  const factions = asArray(profile.factions);
  return {
    profileKey: profile.profileKey,
    available: profile.available,
    reason: profile.reason,
    basis: profile.basis,
    hullsRead: profile.hullsRead,
    hullsViaDesign: paths?.hullsViaDesign ?? null,
    hullsViaWeaponLoadout: paths?.hullsViaWeaponLoadout ?? null,
    pointDefenseInstallations: profile.pointDefenseInstallations,
    distinctWeapons: profile.distinctWeapons,
    meanMountsPerHull: profile.meanMountsPerHull,
    maxEngagementRangeKm: profile.maxEngagementRangeKm,
    factionsTotalCount: factions.length,
    factionsOmittedCount: Math.max(0, factions.length - PROFILE_FACTION_LIMIT),
    factions: factions.slice(0, PROFILE_FACTION_LIMIT),
    weaponsTotalCount: weapons.length,
    weaponsOmittedCount: Math.max(0, weapons.length - PROFILE_WEAPON_LIMIT),
    weapons: weapons.slice(0, PROFILE_WEAPON_LIMIT)
  };
}

// ---------------------------------------------------------------------------
// RESEARCH
// ---------------------------------------------------------------------------

/**
 * The research state of the gate that unlocks one item, plus what else that
 * gate brings with it.
 *
 * `gateKind` is carried through unchanged from the unlock index. Fifteen
 * families are gated by a faction PROJECT and orgs by a global TECH; flattening
 * the two would mis-describe the gate, and only the project kind can be
 * resolved through `availableProjectNames`.
 */
function researchFor(snapshot, itemGateMap, resolver, family, id, monthlyResearch, categoryBonuses, allocationPricing) {
  const gate = itemGateMap.get(`${family}:${id}`) || null;
  if (!gate) {
    return {
      gateProjectId: null,
      gateKind: null,
      gateProjectName: null,
      // Its own state. Not `completed` -- that would claim the observer
      // finished a project that does not exist -- and not `unknown`, which
      // would hide that it costs no research. 33 of the 125 laser templates
      // and a handful of hulls, armours and reactors are in this state.
      state: AVAILABILITY_STATES.ungated,
      reason: 'this item names no research gate in the templates, so no project unlocks it and none needs to be researched. What makes it usable is whatever mounts it, not a project of its own.',
      researchCost: null,
      remainingResearchCost: null,
      // No research at all, so no duration and nothing to price one against.
      // `reason` above already says so in this row's own terms. Every duration
      // field is present and null rather than absent, so a consumer reading the
      // shape does not have to distinguish "missing key" from "no answer".
      ...researchDurationFields(null),
      missingPrerequisites: [],
      unlockChance: null,
      alsoUnlocks: null
    };
  }

  if (gate.gateKind !== 'project') {
    return {
      gateProjectId: gate.gateId,
      gateKind: gate.gateKind,
      gateProjectName: null,
      state: AVAILABILITY_STATES.unknown,
      reason: `this item is gated by a global tech (${gate.gateId}), not a faction project, so \`availableProjectNames\` cannot resolve its state`,
      researchCost: null,
      remainingResearchCost: null,
      // Gated by a global tech whose remaining cost this endpoint cannot
      // resolve, so there is no duration to price at all. No duration was
      // attempted, so there is no duration STATE either -- a state code here
      // would describe a figure this row does not have.
      ...researchDurationFields(null),
      missingPrerequisites: null,
      unlockChance: null,
      alsoUnlocks: null
    };
  }

  const availability = resolver.resolve(gate.gateId);
  // Priced through the allocation the gate project's own slot receives -- or,
  // when it is not in a slot, through a LABELLED assumed one with the fastest
  // case beside it. Its research category and node type both come from the
  // resolver, which reads them off the graph node, so neither is guessed here.
  const duration = priceResearchDuration({
    remainingCost: availability.remainingResearchCost,
    monthlyIncome: monthlyResearch,
    categoryBonuses,
    allocationPricing,
    itemId: gate.gateId,
    category: availability.category ?? null,
    type: availability.type ?? null
  });
  const unlocks = unlocksForGate(snapshot, gate.gateId);
  const families = {};
  let totalItems = 0;
  for (const [unlockFamily, items] of Object.entries(unlocks?.unlocks || {})) {
    families[unlockFamily] = asArray(items).length;
    totalItems += asArray(items).length;
  }

  return {
    gateProjectId: gate.gateId,
    gateKind: gate.gateKind,
    gateProjectName: availability.displayName,
    state: availability.state,
    reason: availability.reason,
    researchCost: availability.researchCost,
    remainingResearchCost: availability.remainingResearchCost,
    // Absent stays null, and there are now exactly two reasons for it: no
    // measured research income, or a slot carrying no pips at all -- which
    // receives nothing and therefore has no time to complete. "0 months" would
    // read as immediate and a large number would read as slow progress; both
    // are false of a slot receiving nothing.
    ...researchDurationFields(duration),
    missingPrerequisites: availability.missingPrerequisites,
    unlockChance: availability.unlockChance,
    // One project unlocks up to seven mount variants of the same weapon, so
    // the cost of a gate is shared across everything behind it.
    alsoUnlocks: totalItems > 0 ? { totalItems, families } : null
  };
}

// ---------------------------------------------------------------------------
// CLASSES
// ---------------------------------------------------------------------------

/** The comparison classes present in this catalogue, derived not hardcoded. */
function enumerateClasses(componentStats) {
  const classes = [];
  for (const family of FAMILY_ORDER) {
    const entries = componentStats?.[family];
    if (!entries || Object.keys(entries).length === 0) continue;
    if (!isWeaponFamily(family)) {
      const spec = COMPONENT_CLASS_SPECS[family];
      if (!spec) continue;
      classes.push({ classKey: family, family, role: null, spec });
      continue;
    }
    // A weapon family splits by role, and only the roles it actually contains
    // become classes -- no empty "point defence" block for a family that has
    // none, and no hardcoded list of which families have which roles.
    const roles = new Set();
    for (const stats of Object.values(entries)) {
      roles.add(weaponRole(stats));
    }
    for (const role of [WEAPON_ROLES.offensive, WEAPON_ROLES.pointDefense, WEAPON_ROLES.installation, WEAPON_ROLES.unknown]) {
      if (!roles.has(role)) continue;
      classes.push({
        classKey: `${family}:${role}`,
        family,
        role,
        spec: { ...WEAPON_CLASS_SPECS[role], axisSet: 'weapon', axes: MILITARY_CLASS_SPECS.weaponAxes, kind: CLASS_KINDS.ranked }
      });
    }
  }
  return classes;
}

/**
 * The best offensive weapon the observer fields for each hull side.
 *
 * This is what fills a candidate hull's hardpoints, held constant across every
 * hull so the throw-weight comparison isolates the hull rather than mixing in a
 * different weapon on each row.
 */
function buildFieldedArmament(fieldedWeaponRows) {
  const offensive = fieldedWeaponRows.filter(row => row.role === WEAPON_ROLES.offensive);
  const nose = bestOnAxis(offensive.filter(row => row.mountSide === 'nose'), 'outputPerHardpointMW');
  const hull = bestOnAxis(offensive.filter(row => row.mountSide === 'hull'), 'outputPerHardpointMW');
  return {
    nose,
    hull,
    basis: (nose || hull)
      ? 'the best output-per-hardpoint offensive weapon the observer already fields on each side, held constant across every hull'
      : null,
    reason: (nose || hull)
      ? null
      : 'the observer fields no offensive weapon with measurable output, so no hull can be filled and throw weight is unmeasurable'
  };
}

/** Builds one comparison class end to end. */
function buildClass({
  entry, componentStats, itemGateMap, resolver, snapshot, fielded, monthlyResearch, categoryBonuses,
  allocationPricing,
  armament, armorRanking, candidateLimit, bestFieldedHull, detail, pointDefenseProfile
}) {
  const { classKey, family, role, spec } = entry;
  const catalogue = componentStats[family] || {};
  const fieldedCounts = fielded.byFamily[family] || new Map();

  const rows = [];
  const notComparable = [];
  for (const [id, stats] of Object.entries(catalogue)) {
    if (isWeaponFamily(family) && weaponRole(stats) !== role) continue;
    const metrics = metricsFor(family, id, stats, { armament, pointDefenseProfile });
    if (!metrics) continue;
    rows.push({
      ...metrics,
      fieldedCount: fieldedCounts.get(id) ?? 0,
      isFielded: fieldedCounts.has(id),
      research: researchFor(snapshot, itemGateMap, resolver, family, id, monthlyResearch, categoryBonuses, allocationPricing)
    });
  }

  const fieldedRows = rows.filter(row => row.isFielded);

  // Ranking axis: fixed per class, except armour, whose primary axis follows
  // the measured threat mix rather than a preference of ours.
  const rankBy = family === 'ship_armor' ? armorRanking.rankBy : spec.rankBy;
  const floorAxis = family === 'ship_armor' ? armorRanking.floorAxis : spec.floorAxis;
  const axes = spec.axes || [];
  const axisByKey = new Map(axes.map(a => [a.key, a]));
  const direction = axisByKey.get(rankBy)?.direction || 'higher';
  const floorDirection = axisByKey.get(floorAxis)?.direction || 'higher';

  // The floor is what the observer already achieves, never a constant.
  const floorBest = floorAxis ? bestOnAxis(fieldedRows, floorAxis, floorDirection) : null;
  const floorValue = floorBest ? toFinite(floorBest[floorAxis]) : null;

  // Phase 5's second floor. Measured over the point-defence-TARGETABLE
  // munitions the observer fields, not over everything: a laser has no
  // delivery figure at all, and letting a class with no interceptable weapon
  // in service produce a floor would compare a missile against nothing.
  const deliveryFloorAxis = spec.deliveryFloorAxis ?? null;
  const deliveryFloorApplies = (row) => row?.deliveryApplies === true;
  const deliveryFloorBest = deliveryFloorAxis
    ? bestOnAxis(fieldedRows.filter(deliveryFloorApplies), deliveryFloorAxis, 'lower')
    : null;
  const deliveryFloorValue = deliveryFloorBest ? toFinite(deliveryFloorBest[deliveryFloorAxis]) : null;

  const { ranked, ranking } = rankByAxis(rows, {
    rankBy: spec.kind === CLASS_KINDS.rule ? null : rankBy,
    direction,
    floorAxis,
    floorDirection,
    floorValue,
    deliveryFloorAxis: spec.kind === CLASS_KINDS.rule ? null : deliveryFloorAxis,
    deliveryFloorDirection: 'lower',
    deliveryFloorValue,
    deliveryFloorApplies
  });

  // Per-axis best of what is fielded: the baseline every ratio is against.
  const fieldedBest = {};
  for (const a of axes) {
    const best = bestOnAxis(fieldedRows, a.key, a.direction);
    fieldedBest[a.key] = best
      ? { id: best.id, displayName: best.displayName, value: toFinite(best[a.key]) }
      : null;
  }

  const baselineRow = rankBy ? bestOnAxis(fieldedRows, rankBy, direction) : null;
  const withComparison = ranked.map(row => {
    const byAxis = {};
    for (const a of axes) {
      byAxis[a.key] = ratioAgainst(row[a.key], fieldedBest[a.key]?.value ?? null, a.direction);
    }
    const primary = rankBy ? byAxis[rankBy] : null;
    return {
      ...row,
      vsFielded: {
        // The basis is stated once per class on `fielded.baselineBasis`, not
        // repeated on every row.
        baselineId: baselineRow?.id ?? null,
        baselineDisplayName: baselineRow?.displayName ?? null,
        rankMetricMultiple: primary?.multiple ?? null,
        // Tri-state, exactly as phase 1: null means the comparison could not be
        // made, which is not the same as "no improvement".
        improvesRankMetric: primary?.improves ?? null,
        byAxis
      },
      // The trap the prompt names: a weapon that hits harder and is too heavy
      // for anything the observer can build.
      ...(isWeaponFamily(family) && bestFieldedHull
        ? {
          hullMassFraction: (toFinite(row.massTons) === null || toFinite(bestFieldedHull.massTons) === null)
            ? null
            : round(toFinite(row.massTons) / toFinite(bestFieldedHull.massTons), 4),
          hullMassFractionOf: bestFieldedHull.displayName
        }
        : {})
    };
  });

  for (const row of withComparison) {
    if (spec.kind === CLASS_KINDS.rule) continue;
    if (row.rankValue === null) {
      notComparable.push({
        id: row.id,
        displayName: row.displayName,
        axis: rankBy,
        // Never scored zero: a zero would rank it last and hide it.
        reason: row.throwWeightReason || row.damageUnavailableReason || row.hardpointReason
          || `no measurable value for ${rankBy} in this snapshot's templates`
      });
    }
  }

  // Same ranking, projected per availability state. `completed` matters most:
  // an item behind a finished project costs no research at all.
  const bestByState = spec.kind === CLASS_KINDS.rule ? null : {};
  if (bestByState) {
    for (const state of Object.values(AVAILABILITY_STATES)) {
      const best = withComparison.find(row => row.research.state === state && !row.isFielded && row.rankValue !== null);
      bestByState[state] = best
        ? {
          id: best.id,
          displayName: best.displayName,
          rankValue: best.rankValue,
          clearsFloor: best.clearsFloor,
          floorReason: best.floorReason,
          // Every axis this class declares travels with this row inside
          // `vsFielded.byAxis[axis].candidate`, which is populated whether or
          // not a baseline exists. Without them a headline rank value carries
          // no context -- a four-round antimatter torpedo and an unlimited
          // laser are not the same 3 GW.
          // Half-mount costs are inferred from the mount name rather than
          // verified against a design, so a top row resting on one says so.
          hardpointCostVerifiedInSave: best.hardpointCostVerifiedInSave ?? null,
          // Phase 5, carried BESIDE the damage figures and never folded into
          // them. `clearsDeliveryFloor` is tri-state: null means the floor
          // could not be evaluated for this row, which is not the same as
          // clearing it, and `deliveryFloorReason` says which of the four
          // cases this one is.
          clearsDeliveryFloor: best.clearsDeliveryFloor ?? null,
          deliveryFloorReason: best.deliveryFloorReason ?? null,
          deliveryShotsPerArrivingRound: best.deliveryShotsPerArrivingRound ?? null,
          deliveryFlightTimeS: best.deliveryFlightTimeS ?? null,
          deliveryTerminalSpeedKps: best.deliveryTerminalSpeedKps ?? null,
          deliveryProfileKey: best.delivery?.pointDefense?.profileKey ?? null,
          // The baseline the verdict was measured against, so a reader can see
          // the comparison rather than only its outcome.
          deliveryFloorValue,
          deliveryFloorBaselineDisplayName: deliveryFloorBest?.displayName ?? null,
          vsFielded: best.vsFielded,
          gateProjectId: best.research.gateProjectId,
          gateProjectName: best.research.gateProjectName,
          remainingResearchCost: best.research.remainingResearchCost,
          monthsAtCurrentIncome: best.research.monthsAtCurrentIncome,
          // Why that duration is what it is, and the second end of the range
          // when the allocation had to be assumed. Both travel because this is
          // the row research-ranking reads; dropping them here would print a
          // headline one-pip figure with no all-in beside it.
          monthsAtCurrentIncomeState: best.research.monthsAtCurrentIncomeState,
          monthsFastestAllocation: best.research.monthsFastestAllocation,
          monthsAreUpperBound: best.research.monthsAreUpperBound,
          categoryResearchBonus: best.research.categoryResearchBonus,
          flatRateMonths: best.research.flatRateMonths,
          unlockChance: best.research.unlockChance,
          alsoUnlocks: best.research.alsoUnlocks
        }
        // Explicit null so "none in this state" is distinguishable from "this
        // state was not considered".
        : null;
    }
  }

  // WHAT THE DELIVERY FLOOR PUSHED DOWN.
  //
  // A floor that silently removes a row from the top of a ranking is a
  // TRUNCATION, and truncation must announce itself. Without this block the
  // only visible effect of phase 5 on the live save is that the antimatter
  // torpedo is no longer where it was, with nothing saying why.
  //
  // Null -- not an empty block -- when the class declares no delivery floor, so
  // "this class does not use one" reads differently from "it uses one and
  // demoted nothing".
  let deliveryDemoted = null;
  if (deliveryFloorAxis !== null && spec.kind !== CLASS_KINDS.rule) {
    // Candidates only. A weapon the observer already flies is not something the
    // advisor is offering, and listing it here would mix "you fly something
    // worse than your own best" into an answer about what to research next --
    // a different question, and the one this block is not asking.
    //
    // Ordered by the DAMAGE axis descending, so the row a reader would
    // otherwise have seen at the top of its group is the first one named.
    const demoted = ranked
      .filter(row => row.clearsDeliveryFloor === false && !row.isFielded)
      .slice()
      .sort((a, b) => (toFinite(b.rankValue) ?? -Infinity) - (toFinite(a.rankValue) ?? -Infinity)
        || String(a.id).localeCompare(String(b.id)));
    deliveryDemoted = {
      count: demoted.length,
      basis: 'candidates ranked BELOW their damage because the point-defence fire each arriving round '
        + 'has to survive is measurably worse than the best point-defence-targetable munition the '
        + 'observer already fields. They are still listed and still carry their damage figure -- '
        + '"this hits harder and arrives alone" is the finding, not something to hide. Listed highest '
        + 'damage first, so the row a reader would otherwise have seen leading its group is named '
        + 'first. Weapons already in service are excluded: this answers what to research, not what is '
        + 'already flown.',
      itemsShown: Math.min(demoted.length, candidateLimit),
      itemsOmittedCount: Math.max(0, demoted.length - candidateLimit),
      items: demoted.slice(0, candidateLimit).map(row => ({
        id: row.id,
        displayName: row.displayName,
        rankValue: row.rankValue,
        shotsPerArrivingRound: row.deliveryShotsPerArrivingRound ?? null,
        floorValue: deliveryFloorValue,
        floorBaselineDisplayName: deliveryFloorBest?.displayName ?? null,
        // How much worse, in the same "greater than 1 is worse on a lower-is-
        // better axis" direction the ratio machinery already uses.
        multipleOfFloor: (deliveryFloorValue === null
          || !(deliveryFloorValue > 0)
          || toFinite(row.deliveryShotsPerArrivingRound) === null)
          ? null
          : round(toFinite(row.deliveryShotsPerArrivingRound) / deliveryFloorValue, 6),
        researchState: row.research?.state ?? null,
        gateProjectId: row.research?.gateProjectId ?? null,
        remainingResearchCost: row.research?.remainingResearchCost ?? null
      }))
    };
  }

  // Rule-grouped classes: compared WITHIN a rule, never across rules.
  let byRule = null;
  let unruled = null;
  let militaryFlagged = null;
  if (spec.kind === CLASS_KINDS.rule) {
    byRule = {};
    // An item with no rules joins no group, so without this it would be
    // absent from the summary view entirely -- a silent drop, which is the
    // failure mode this whole endpoint is written against. 43 of the 156 hab
    // modules are in this state, and for a hab module that almost always means
    // its value is income: economic valuation, spec section 4, a later phase.
    const unruledRows = withComparison.filter(row => asArray(row.rules).length === 0);
    unruled = {
      count: unruledRows.length,
      ids: unruledRows.map(row => row.id),
      note: unruledRows.length === 0
        ? null
        : 'these items carry no special rule, so there is nothing to compare them within. For hab modules that usually means their value is income, which is economic valuation and is not priced by this endpoint.'
    };
    // The one unambiguously military axis a hab module has, plus the mission
    // control it supplies -- both flags rather than scores, so they are
    // surfaced as a list and not folded into a ranking that does not exist.
    const flagged = withComparison.filter(row => row.spaceCombatModule === true || toFinite(row.missionControl) !== null);
    militaryFlagged = flagged.length === 0 ? null : {
      basis: 'items carrying the template\'s own `spaceCombatModule` flag or supplying mission control; these are flags and quantities, not a score, so they are listed rather than ranked',
      items: flagged
        .slice()
        .sort((a, b) => (toFinite(b.missionControl) ?? 0) - (toFinite(a.missionControl) ?? 0) || String(a.id).localeCompare(String(b.id)))
        .map(row => ({
          id: row.id,
          displayName: row.displayName,
          spaceCombatModule: row.spaceCombatModule === true,
          missionControl: row.missionControl,
          tier: row.tier,
          isFielded: row.isFielded,
          fieldedCount: row.fieldedCount,
          researchState: row.research.state,
          gateProjectId: row.research.gateProjectId,
          remainingResearchCost: row.research.remainingResearchCost,
          monthsAtCurrentIncome: row.research.monthsAtCurrentIncome,
          monthsAtCurrentIncomeState: row.research.monthsAtCurrentIncomeState,
          monthsFastestAllocation: row.research.monthsFastestAllocation,
          monthsAreUpperBound: row.research.monthsAreUpperBound,
          categoryResearchBonus: row.research.categoryResearchBonus,
          flatRateMonths: row.research.flatRateMonths
        }))
    };
    for (const row of withComparison) {
      for (const rule of asArray(row.rules)) {
        if (!byRule[rule]) byRule[rule] = { rule, fieldedBest: null, items: [] };
        byRule[rule].items.push(row);
      }
    }
    for (const group of Object.values(byRule)) {
      const fieldedInRule = group.items.filter(row => row.isFielded);
      group.itemsTotal = group.items.length;
      group.fieldedCount = fieldedInRule.length;

      // ONE BASELINE PER RULE SIGNATURE, not one per rule.
      //
      // The template carries a single `specialModuleValue` per module and never
      // says which of that module's rules the value belongs to, so a value may
      // only be divided by another value carrying the IDENTICAL rule set --
      // then the attribution ambiguity is the same on both sides and cancels.
      // See `ruleModuleMetrics` in shared/militaryValue.mjs for the measurement
      // that forced this: the RadHardened group holds 14 valued members across
      // 8 rule sets, and comparing across them made a Cyclotron's 20 particle-
      // beam power bonus read as 40x a Magazine's 0.5 capacity multiplier.
      const fieldedBestBySignature = new Map();
      for (const row of fieldedInRule) {
        if (!row.ruleSignature) continue;
        const held = fieldedBestBySignature.get(row.ruleSignature);
        const value = toFinite(row.ruleValue);
        if (value === null) continue;
        if (!held || value > toFinite(held.ruleValue)) fieldedBestBySignature.set(row.ruleSignature, row);
      }
      const signaturesFielded = [...fieldedBestBySignature.keys()].sort();
      group.attribution = {
        comparableWithin: 'rule signature',
        basis: 'the template states one specialModuleValue per module across ALL of its rules and never '
          + 'says which rule owns it, so a value is only divided by another value carrying the identical '
          + 'rule set. An identical rule set also means identical applicability, so the two items really '
          + 'are substitutes.',
        // Counted over the members that CARRY a value, because that is the set
        // the attribution question is about: a rule spanning one such rule set
        // covers one quantity, and RadHardened's fourteen valued members span
        // eight. Members with no value cannot produce a ratio either way.
        signaturesInGroup: [...new Set(group.items
          .filter(row => toFinite(row.ruleValue) !== null)
          .map(row => row.ruleSignature)
          .filter(Boolean))].sort(),
        signaturesFielded,
        validatedAgainstGameOutput: false
      };
      // Retained for callers that only need to know whether the observer flies
      // anything in this group at all; the per-signature map above is what any
      // multiple is actually formed against.
      const overallBest = bestOnAxis(fieldedInRule, 'ruleValue');
      group.fieldedBest = overallBest
        ? {
          id: overallBest.id,
          displayName: overallBest.displayName,
          ruleValue: overallBest.ruleValue,
          ruleSignature: overallBest.ruleSignature,
          // A caller must not read this as the comparison baseline for every
          // row in the group; it is only the baseline for rows sharing its
          // signature, and saying so here is cheaper than a wrong assumption.
          isBaselineForSignatureOnly: true
        }
        : null;
      group.items = group.items
        .slice()
        .sort((a, b) => {
          const av = toFinite(a.ruleValue);
          const bv = toFinite(b.ruleValue);
          if ((av === null) !== (bv === null)) return av === null ? 1 : -1;
          if (av !== null && av !== bv) return bv - av;
          return String(a.id).localeCompare(String(b.id));
        })
        // A module with three rules appears in three groups. Repeating its
        // full research record each time cost 183 KB on the hab-module class
        // alone, so the group carries the summary and `candidates` carries the
        // whole record once.
        .map(row => {
          const baseline = row.ruleSignature ? fieldedBestBySignature.get(row.ruleSignature) ?? null : null;
          const comparison = ratioAgainst(row.ruleValue, baseline?.ruleValue ?? null, 'higher');
          return {
            id: row.id,
            displayName: row.displayName,
            ruleValue: row.ruleValue,
            ruleSignature: row.ruleSignature,
            massTons: row.massTons,
            isFielded: row.isFielded,
            fieldedCount: row.fieldedCount,
            vsFieldedInRule: {
              ...comparison,
              baselineId: baseline?.id ?? null,
              baselineDisplayName: baseline?.displayName ?? null,
              // Distinguishes "you fly nothing carrying this rule" from "you fly
              // things carrying this rule but none with this item's rule set" --
              // different facts, and the second is the one this gate introduced.
              unavailable: comparison.unavailable === 'no-fielded-baseline' && signaturesFielded.length > 0
                ? 'no-same-signature-baseline'
                : comparison.unavailable
            },
            researchState: row.research.state,
            gateProjectId: row.research.gateProjectId,
            remainingResearchCost: row.research.remainingResearchCost,
            monthsAtCurrentIncome: row.research.monthsAtCurrentIncome,
            monthsAtCurrentIncomeState: row.research.monthsAtCurrentIncomeState,
            monthsFastestAllocation: row.research.monthsFastestAllocation,
            monthsAreUpperBound: row.research.monthsAreUpperBound,
            categoryResearchBonus: row.research.categoryResearchBonus,
            flatRateMonths: row.research.flatRateMonths
          };
        });
      group.itemCount = group.itemsTotal;
      // Chosen from the WHOLE sorted group, before the limit is applied. Taking
      // it from the truncated list would silently answer "nothing to research
      // here" whenever the first N entries happened to be things already flown.
      //
      // Still the highest rule value, deliberately unchanged by the attribution
      // gate: the gate's job is to refuse a MULTIPLE it cannot form, not to
      // reorder what a group offers. Preferring a comparable sibling instead
      // would bury a 20-value candidate behind a 0.5-value one scoring 1.0x --
      // trading a missing number for a misleading offer. When the top candidate
      // has no same-signature baseline it is surfaced with a null multiple, and
      // the ranking carries it as not-comparable rather than scoring it.
      group.bestCandidate = group.items.find(row => !row.isFielded && toFinite(row.ruleValue) !== null) || null;
      group.items = group.items.slice(0, candidateLimit);
      group.itemsShown = group.items.length;
    }
  }

  // A rule-grouped class has no ranking metric, so the ranking fields on its
  // rows are all null by construction. Dropping them keeps the response from
  // asserting a comparison it explicitly declines to make.
  const candidates = withComparison
    .filter(row => !row.isFielded)
    .slice(0, candidateLimit)
    .map(row => {
      if (spec.kind !== CLASS_KINDS.rule) return row;
      const { rankMetric, rankValue, clearsFloor, floorReason, vsFielded, ...rest } = row;
      return rest;
    });

  return {
    classKey,
    family,
    role,
    kind: spec.kind,
    rankRationale: family === 'ship_armor'
      ? `${spec.rankRationale} ${armorRanking.reason}`
      : spec.rankRationale,
    // Names its set in the response's top-level `axisSets` table rather than
    // carrying a copy: seventeen classes share seven sets, and inlining the
    // descriptors cost 53 KB of repetition per request.
    axisSet: spec.axisSet,
    ranking,
    // A ranked class with no ranking is a real outcome, not an omission: with
    // no hostile armament observable, no armour channel can be shown to
    // dominate and the endpoint declines to order them rather than picking a
    // default. Saying so is the point.
    rankingUnavailableReason: (spec.kind !== CLASS_KINDS.rule && ranking === null)
      ? (family === 'ship_armor'
        ? armorRanking.reason
        : `this class declares no ranking axis: ${spec.rankRationale}`)
      : null,
    catalogueSize: rows.length,
    fielded: {
      count: fieldedRows.length,
      // Installations, not hulls: a design with three rail cannon in its nose
      // contributes three per ship that flies it. For a hull or a reactor,
      // where one design carries one, this IS the hull count.
      installationsInService: fieldedRows.reduce((sum, row) => sum + row.fieldedCount, 0),
      installationsBasis: 'the number of this item installed across the hulls and habs in service, counted per mount rather than per hull',
      items: fieldedRows
        .slice()
        .sort((a, b) => b.fieldedCount - a.fieldedCount || String(a.id).localeCompare(String(b.id)))
        .map(row => ({
          id: row.id,
          displayName: row.displayName,
          fieldedCount: row.fieldedCount,
          rankValue: row.rankValue,
          ...(rankBy ? { [rankBy]: row[rankBy] } : {})
        })),
      best: fieldedBest,
      baselineBasis: fieldedRows.length > 0
        ? 'every `vsFielded` multiple in this class is against the best item on that axis among what the observer currently fields'
        : 'the observer fields nothing in this class, so there is no baseline and every `vsFielded` multiple is null rather than 1',
      // A turn-1 observer fields nothing. That is an answer, not an error, and
      // it must not be reported as a zero baseline.
      note: fieldedRows.length === 0
        ? 'the observer fields nothing in this class, so there is no baseline; candidates below are ranked on their own measured axes and every comparison multiple is null'
        : null
    },
    candidateCount: withComparison.filter(row => !row.isFielded).length,
    candidatesShown: detail === 'full' ? candidates.length : 0,
    candidateStates: tallyAvailabilityStates(withComparison.map(row => ({ state: row.research.state }))),
    bestByState,
    // Null when this class declares no delivery floor, which is every class
    // except the five offensive weapon roles.
    deliveryDemoted,
    // `detail=summary` is the default for the same reason `/api/intel/fleets`
    // defaults to a manifest: the full seventeen-class listing is a 300 KB
    // response, and a caller cannot choose what to fetch if the small answer
    // is not the one they get by default. `bestByState` above is the summary's
    // actual content -- the top row per availability state, per class -- so the
    // default is a real answer rather than a pointer to one.
    candidates: detail === 'full' ? candidates : null,
    byRule: detail === 'full' ? byRule : null,
    // A rule-grouped class declines to rank ACROSS rules, but it can and must
    // still answer "what would I research for this rule". Without this the
    // summary view offers nothing actionable for utility and hab modules at
    // all, which is a different failure from refusing to invent an exchange
    // rate between them.
    ruleSummary: byRule
      ? Object.values(byRule)
        .map(group => ({
          rule: group.rule,
          itemCount: group.itemCount,
          fieldedCount: group.fieldedCount,
          fieldedBest: group.fieldedBest,
          // How many distinct rule sets this rule spans. One means every member
          // of the group carries the same scalar quantity; eight -- which is
          // what `RadHardened` spans -- means the rule name says nothing about
          // what the number counts.
          attribution: group.attribution,
          signatureCount: asArray(group.attribution?.signaturesInGroup).length,
          // Highest rule value not already fielded, with its research state.
          // Null where every item with a measurable value is already flown.
          bestCandidate: group.bestCandidate
        }))
        .sort((a, b) => b.itemCount - a.itemCount || String(a.rule).localeCompare(String(b.rule)))
      : null,
    unruled,
    militaryFlagged,
    notComparableCount: notComparable.length,
    notComparable: detail === 'full' ? notComparable : notComparable.slice(0, 3)
  };
}

// ---------------------------------------------------------------------------
// ALIEN BENCHMARK
// ---------------------------------------------------------------------------

/**
 * What the aliens field, degrading honestly by mode.
 *
 * Alien `shipDesigns` are redacted in player mode -- 0 rows against 82 in
 * omniscient -- but every observed alien hull still carries a `weaponLoadout`
 * naming its systems. That display-name join is exact and unambiguous on the
 * installed templates, so the armament benchmark survives redaction where the
 * design-level one does not, and the difference is stated in `basis` rather
 * than hidden behind an identical-looking answer.
 */
function buildAlienBenchmark(snapshot, index, componentStats, observerWeaponRows, mode, pointDefenseProfile) {
  const alien = findAlienFaction(snapshot);
  if (!alien) {
    return { available: false, reason: 'no alien faction is present in this snapshot', basis: null, threatMix: null };
  }
  const alienDesignCount = asArray(snapshot?.shipDesigns).filter(design => sameId(design?.factionId, alien.ID)).length;
  const inventory = buildFieldedInventory(snapshot, alien.ID, index);

  const rows = [];
  for (const family of WEAPON_FAMILIES) {
    const counts = inventory.byFamily[family];
    if (!counts) continue;
    for (const [id, count] of counts) {
      const stats = componentStats?.[family]?.[id];
      if (!stats) continue;
      rows.push({ ...weaponMetrics(id, stats, family, { pointDefenseProfile }), fieldedCount: count });
    }
  }

  const mix = threatMix(rows);
  const bestOffensive = bestOnAxis(rows.filter(row => row.role === WEAPON_ROLES.offensive), 'outputPerHardpointMW');
  const ownBest = bestOnAxis(observerWeaponRows.filter(row => row.role === WEAPON_ROLES.offensive), 'outputPerHardpointMW');

  return {
    available: rows.length > 0,
    reason: rows.length > 0 ? null : 'no alien armament is observable in this snapshot',
    mode,
    designAttributionAvailable: alienDesignCount > 0,
    alienDesignsVisible: alienDesignCount,
    basis: alienDesignCount > 0
      ? 'alien ship designs are visible in this mode, so armament is read from the designs themselves'
      : 'alien ship designs are redacted in this mode; armament is read from the weapon display names on observed hulls, which survive redaction',
    hullsRead: inventory.shipsRead,
    // Which path each hull was read through, so "designs are visible" is a
    // claim a caller can check rather than take on trust.
    hullsViaDesign: inventory.shipsViaDesign,
    hullsViaWeaponLoadout: inventory.shipsViaLoadout,
    distinctWeapons: rows.length,
    bestOffensive: bestOffensive
      ? {
        id: bestOffensive.id,
        displayName: bestOffensive.displayName,
        family: bestOffensive.family,
        outputPerHardpointMW: bestOffensive.outputPerHardpointMW,
        sustainedOutputMW: bestOffensive.sustainedOutputMW,
        statedRangeKm: bestOffensive.statedRangeKm
      }
      : null,
    observerBestOffensive: ownBest
      ? { id: ownBest.id, displayName: ownBest.displayName, outputPerHardpointMW: ownBest.outputPerHardpointMW }
      : null,
    gap: ratioAgainst(bestOffensive?.outputPerHardpointMW ?? null, ownBest?.outputPerHardpointMW ?? null, 'higher'),
    threatMix: mix,
    unresolved: inventory.unresolved
  };
}

// ---------------------------------------------------------------------------
// RESOURCE
// ---------------------------------------------------------------------------

/**
 * `/api/intel/military-value` -- phase 2 of the research advisor.
 */
export const militaryValueResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  mode = 'player',
  family = null,
  limit = null,
  detail = 'summary'
} = {}) => {
  const wantsFull = String(detail) === 'full';
  const requestedLimit = toFinite(limit);
  const candidateLimit = requestedLimit === null
    ? DEFAULT_CANDIDATE_LIMIT
    : Math.max(1, Math.min(MAX_CANDIDATE_LIMIT, Math.trunc(requestedLimit)));

  const componentStats = snapshot?.componentStats || null;
  const catalogueAvailable = Boolean(componentStats) && Object.keys(componentStats).length > 0;
  const census = unlockIndexCensus(snapshot);
  const resolver = buildAvailabilityResolver(snapshot, mode, observerId);
  const itemGateMap = buildItemGateMap(snapshot);

  const observerFaction = asArray(snapshot?.factions).find(entry => sameId(entry?.ID, observerId)) || null;
  const monthlyResearch = toFinite(observerFaction?.totalResearch);
  // Built once for the whole catalogue sweep: it walks every hab module and
  // councilor the observer holds, and hundreds of rows read from it.
  const categoryBonuses = buildResearchCategoryBonuses(snapshot, { observerId });
  // Built once for the same reason: it reads the observer's slot layout and
  // Projects figures, neither of which varies by row.
  const allocationPricing = buildResearchAllocationPricing(snapshot, { observerId });

  if (!catalogueAvailable) {
    return {
      resource: 'military-value',
      observerFactionId: observerId,
      intelMode: mode,
      formulae: MILITARY_FORMULAE,
      componentCatalogue: {
        available: false,
        reason: 'componentStats is not present on this snapshot; re-publish after upgrading',
        families: null
      },
      unlockIndex: census,
      research: {
        availabilityResolvable: resolver.available && resolver.availabilityKnown,
        availabilitySource: resolver.availabilitySource,
        availableProjectCount: resolver.availableProjectCount,
        reason: resolver.available ? null : resolver.reason,
        monthlyResearchIncome: monthlyResearch,
        monthlyResearchIncomeBasis: MEASURED_INCOME_BASIS,
        categoryBonuses: categoryBonusSummary(categoryBonuses),
        allocationPricing: allocationPricingSummary(allocationPricing, snapshot?.metadata?.researchCostScaling ?? null),
        states: Object.values(AVAILABILITY_STATES)
      },
      fielded: null,
      alienBenchmark: null,
      count: 0,
      items: []
    };
  }

  const index = buildCatalogueIndex(componentStats);
  const fielded = buildFieldedInventory(snapshot, observerId, index);

  // Phase 5. ONE walk of the fleets, two profiles, and one of them selected for
  // the whole response so every delivery figure in it is comparable.
  const pdInventories = buildPointDefenseInventories(snapshot, observerId, index, componentStats);
  const pdSelection = selectDeliveryProfile(pdInventories, mode);
  const pointDefenseProfile = pdSelection.profile;

  // The observer's own weapons, needed three times over: to fill candidate
  // hulls, to benchmark against the aliens, and to pick the armour axis.
  const observerWeaponRows = [];
  for (const weaponFamily of WEAPON_FAMILIES) {
    const counts = fielded.byFamily[weaponFamily];
    if (!counts) continue;
    for (const [id, count] of counts) {
      const stats = componentStats?.[weaponFamily]?.[id];
      if (!stats) continue;
      observerWeaponRows.push({ ...weaponMetrics(id, stats, weaponFamily, { pointDefenseProfile }), fieldedCount: count });
    }
  }
  const armament = buildFieldedArmament(observerWeaponRows);

  const bestFieldedHull = (() => {
    const counts = fielded.byFamily.ship_hull;
    if (!counts) return null;
    const rows = [...counts.keys()]
      .map(id => (componentStats.ship_hull?.[id] ? hullMetrics(id, componentStats.ship_hull[id], armament) : null))
      .filter(Boolean);
    return bestOnAxis(rows, 'massTons', 'higher');
  })();

  const alienBenchmark = buildAlienBenchmark(snapshot, index, componentStats, observerWeaponRows, mode, pointDefenseProfile);
  // Armour follows the measured threat: what the aliens shoot, weighted by
  // output. With nothing observable it declines to rank rather than defaulting.
  const armorRanking = rankArmorAxis(alienBenchmark.threatMix);

  const wanted = family ? String(family).trim().toLowerCase() : null;
  const classes = enumerateClasses(componentStats)
    .filter(entry => !wanted || entry.family === wanted || entry.classKey.toLowerCase() === wanted)
    .map(entry => buildClass({
      entry,
      componentStats,
      itemGateMap,
      resolver,
      snapshot,
      fielded,
      monthlyResearch,
      categoryBonuses,
      allocationPricing,
      armament,
      armorRanking,
      candidateLimit,
      bestFieldedHull,
      detail: wantsFull ? 'full' : 'summary',
      pointDefenseProfile
    }));

  const familyCounts = Object.fromEntries(FAMILY_ORDER
    .filter(name => componentStats[name])
    .map(name => [name, Object.keys(componentStats[name]).length]));

  return {
    resource: 'military-value',
    observerFactionId: observerId,
    intelMode: mode,
    detail: wantsFull ? 'full' : 'summary',
    // Merged, not replaced: phase 5's delivery formulae sit beside phase 2's
    // damage formulae in one table, because a reader checking a delivery figure
    // and a reader checking a damage figure look in the same place.
    formulae: { ...MILITARY_FORMULAE, ...DELIVERY_FORMULAE },
    // The axis descriptors, the ratio codes, the magazine codes and the
    // delivery codes, each stated ONCE. Every row that references one carries
    // the key, not the prose.
    axisSets: AXIS_SETS,
    codes: {
      ratioUnavailable: RATIO_UNAVAILABLE_CODES,
      magazineBasis: MAGAZINE_BASIS_CODES,
      deliveryBasis: DELIVERY_BASIS_CODES
    },
    method: {
      neverBlended: 'each class declares one ranking axis and a floor on the axis it trades against. The two are reported separately and are never summed into one score: phase 1 measured a single-scalar drive ranking recommending a 1,300x combat-acceleration downgrade, and the same trade exists between damage and mass, hardpoints and structure, and the two armour channels.',
      baseline: 'every comparison is against what this observer currently fields, read from the hulls and habs in service in this snapshot. No absolute scale and no threshold appears anywhere in this endpoint.',
      pointDefense: 'point defence is its own comparison class, never ranked against offensive armament.',
      absentStaysNull: 'an item missing a stat this class ranks on is listed under `notComparable` with the reason. It is never scored zero, which would rank it last and hide it.',
      deliveryNeverBlended: 'the delivery axes are reported BESIDE the damage axes and are never blended '
        + 'into them. Damage still leads the ranking, because it is the axis that decides the outcome of '
        + 'an engagement; delivery is a FLOOR, because it decides whether the outcome happens at all. No '
        + 'hit probability, survival chance or effectiveness score is computed anywhere -- the game '
        + 'publishes nothing to check one against, and a confident percentage resting on an unverified '
        + 'flight model is exactly what section 7 forbids. Only the measurable quantities are reported.'
    },
    // Phase 5. What every delivery figure in this response was measured
    // against, once, so a reader does not have to infer it from the rows.
    deliveryEnvironment: {
      available: pdSelection.profile !== null,
      reason: pdSelection.profile === null ? pdSelection.selectionBasis : null,
      selected: pdSelection.selected,
      selectionBasis: pdSelection.selectionBasis,
      profiles: {
        'observed-opposing': emitProfile(pdInventories.profiles['observed-opposing'], pdInventories.paths['observed-opposing']),
        'observer-own': emitProfile(pdInventories.profiles['observer-own'], pdInventories.paths['observer-own'])
      },
      assumptions: [
        'acceleration is held at the stated LAUNCH-mass value, so flight time is an upper bound and terminal speed a lower one. Both sides of any comparison are measured under the identical assumption, so the ordering is unaffected.',
        'the target is treated as stationary and the launching hull as at rest; the templates state no engagement geometry.',
        'the thrust ramp is read as linear from zero over `thrustRamp_s`; the templates do not state the ramp shape.',
        'a defending battery is assumed to distribute its fire evenly across the rounds in the envelope together, and a salvo launched at `intraSalvoCooldown_s` spacing is assumed to arrive essentially together.',
        '`mountsPerHull` is a MEAN over the hulls read in the profile, not a figure for any one hull.',
        'a hull read through `weaponLoadout` rather than through its design contributes one installation per DISTINCT system name in the group, because that is the shape the loadout carries; a hull mounting the same weapon several times is therefore under-counted on that path, which understates the defensive battery rather than overstating it.'
      ],
      validatedAgainstGameOutput: false
    },
    componentCatalogue: {
      available: true,
      reason: null,
      families: familyCounts,
      totalItems: Object.values(familyCounts).reduce((sum, value) => sum + value, 0),
      ambiguousIds: index.ambiguousIds,
      ambiguousDisplayNames: index.ambiguousNames
    },
    mounts: {
      table: MOUNT_HARDPOINTS,
      basis: 'validated: these costs reproduce the hardpoint fill of every ship design in the live save exactly, nose and hull independently. Mounts flagged `verifiedInSave: false` are used by no design in the save and their cost is read from the mount name.'
    },
    unlockIndex: census,
    research: {
      availabilityResolvable: resolver.available && resolver.availabilityKnown,
      availabilitySource: resolver.availabilitySource,
      availableProjectCount: resolver.availableProjectCount,
      reason: resolver.available
        ? (resolver.availabilityKnown ? null : 'the observer\'s available-project list is absent in this mode')
        : resolver.reason,
      monthlyResearchIncome: monthlyResearch,
      monthlyResearchIncomeBasis: MEASURED_INCOME_BASIS,
      // The observer's per-category research bonuses, with their sources, and
      // the model that says why no duration is divided by them.
      categoryBonuses: categoryBonusSummary(categoryBonuses),
      // The slot allocation every duration on this response is priced through,
      // plus the campaign research-cost basis its remaining costs are on.
      allocationPricing: allocationPricingSummary(allocationPricing, snapshot?.metadata?.researchCostScaling ?? null),
      states: Object.values(AVAILABILITY_STATES)
    },
    fielded: {
      shipsRead: fielded.shipsRead,
      basis: fielded.basis,
      shipsViaDesign: fielded.shipsViaDesign,
      shipsViaWeaponLoadout: fielded.shipsViaLoadout,
      armament: {
        nose: armament.nose ? { id: armament.nose.id, displayName: armament.nose.displayName, outputPerHardpointMW: armament.nose.outputPerHardpointMW } : null,
        hull: armament.hull ? { id: armament.hull.id, displayName: armament.hull.displayName, outputPerHardpointMW: armament.hull.outputPerHardpointMW } : null,
        basis: armament.basis,
        reason: armament.reason
      },
      largestHull: bestFieldedHull
        ? { id: bestFieldedHull.id, displayName: bestFieldedHull.displayName, massTons: bestFieldedHull.massTons }
        : null,
      unresolved: fielded.unresolved
    },
    alienBenchmark,
    armorRanking,
    filter: {
      family: wanted,
      candidateLimit,
      detail: wantsFull ? 'full' : 'summary',
      note: wantsFull
        ? null
        : 'summary detail: each class reports its fielded baseline, its per-state best candidate and its rule summary. Add `detail=full` for the ranked candidate list and the per-rule item lists, or `family=<name>` to narrow to one class.'
    },
    count: classes.length,
    items: classes
  };
};
