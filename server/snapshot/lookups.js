// server/snapshot/lookups.js
//
// Purpose: everything that turns the save's flat gamestates bag into the id
//   maps the domain reducers read, plus the reference-resolving accessors.
//
// Everything that turns the save's flat `gamestates` bag into the id maps the
// domain reducers read, plus the small accessors that resolve a reference back
// to a name, a colour, or an orbital position.
//
// The save stores cross-object references as `{ value: <id> }` and keys every
// object by `ID.value`, NOT by `id`. `obj.id` is undefined on every save
// object, and `${obj.id}` yields the string "undefined" in a template literal,
// which silently collides -- two shipped bugs came from exactly that. Every
// lookup in this file reads `ID?.value`.

const { METERS_PER_AU } = require('../../shared/util.mjs');
const {
  INITIATIVE_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME,
  ALIEN_FACTION_DISPLAY_NAME
} = require('../../shared/constants.mjs');

/**
 * Tolerance added to Saturn's orbital distance when deciding whether an asset
 * counts as inside Saturn orbit (the Skywatch capability boundary).
 *
 * Saturn's own distance moves along its orbit, so an asset parked at a Saturn
 * moon can read fractionally further out than the planet itself. A judgement
 * call in this repo, not a game constant -- it is here so the two call sites
 * cannot drift apart.
 */
const SATURN_ORBIT_TOLERANCE_AU = 0.25;

/**
 * Faction accent colours, keyed by the save's own display names.
 *
 * A presentation choice this repo makes, not a value read from the game. It
 * was buried inside the accessor as a re-created object literal, so it could
 * not be referenced or tested; the frontend keeps its own copy in
 * `public/js/app.js` (`getFactionColorByName`) and that pair is still
 * unlinked -- see the report accompanying this refactor.
 */
const FACTION_COLORS = Object.freeze({
  [INITIATIVE_DISPLAY_NAME]: '#00e5ff',
  'the Resistance': '#2979ff',
  'Humanity First': '#ff1744',
  'the Academy': '#ffd600',
  'Project Exodus': '#ff9100',
  'the Protectorate': '#78909c',
  [SERVANTS_DISPLAY_NAME]: '#d500f9',
  [ALIEN_FACTION_DISPLAY_NAME]: '#00e676'
});

const UNKNOWN_FACTION_COLOR = '#b0bec5';

function getFactionColor(displayName) {
  return FACTION_COLORS[displayName] || UNKNOWN_FACTION_COLOR;
}

function getCollection(gamestates, className) {
  const raw = gamestates[className];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(i => (i && i.Value !== undefined ? i.Value : i));
  if (typeof raw === 'object') return Object.values(raw).map(i => (i && i.Value !== undefined ? i.Value : i));
  return [];
}

/**
 * Owning faction's display name, from the id map built once per snapshot.
 *
 * Twelve call sites wrote this out by hand and they do NOT agree on the two
 * fallback strings -- an unowned control point is 'Neutral', an unclaimed
 * hab site is 'Unclaimed', a nation with no executive is 'None', a resource
 * transfer with an unknown counterparty is 'Unknown', and a hab module or an
 * unturned councilor with no owner is `null`. Passing them in keeps every
 * existing answer while removing the chance of a thirteenth copy inventing a
 * thirteenth spelling.
 *
 * Two sibling reads deliberately stay inline: the councilor reducer already
 * holds the fetched faction record for its own `isActiveCouncilor` check, so
 * routing through here would repeat the map lookup; and `homeRegionName`
 * reads the REGION map, which this faction-named helper does not describe.
 *
 * @param {Map}    factionsById
 * @param {*}      factionId
 * @param {string} unresolved Name for an id that is not in the map.
 * @param {*}      absent     Value for no faction id at all.
 */
function resolveFactionName(factionsById, factionId, unresolved, absent = unresolved) {
  if (!factionId) return absent;
  return factionsById.get(factionId)?.displayName || unresolved;
}

function resolveOrbitBodyId(asset, bodiesById, orbitsById) {
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

function resolveOrbitBody(asset, bodiesById, orbitsById) {
  const bodyId = resolveOrbitBodyId(asset, bodiesById, orbitsById);
  return bodyId && bodiesById.has(bodyId) ? bodiesById.get(bodyId).displayName : 'Earth Orbit';
}

function resolveOrbitBodyDistanceAU(asset, bodiesById, orbitsById, bodyDistanceAUById) {
  const bodyId = resolveOrbitBodyId(asset, bodiesById, orbitsById);
  return bodyId ? (bodyDistanceAUById.get(bodyId) ?? null) : null;
}

/**
 * Every raw collection the reducers need, pulled once from `gamestates`.
 *
 * Kept separate from `buildIdMaps` because the reducers below want both the
 * raw arrays (to iterate in save order) and the maps (to resolve references),
 * and re-reading `gamestates` per reducer would walk the save repeatedly.
 */
function readRawCollections(gamestates) {
  return {
    meta: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIMetadataState')[0] || {},
    rawFactions: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIFactionState'),
    rawNations: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TINationState'),
    rawControlPoints: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIControlPoint'),
    rawCouncilors: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TICouncilorState'),
    rawOrgs: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIOrgState'),
    rawHabs: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIHabState'),
    rawHabModules: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIHabModuleState'),
    rawHabSectors: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISectorState'),
    rawHabSites: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIHabSiteState'),
    rawFleets: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISpaceFleetState'),
    rawShips: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISpaceShipState'),
    rawSpaceBodies: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TISpaceBodyState'),
    rawOrbits: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIOrbitState'),
    rawRegions: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIRegionState'),
    rawAlienFacilities: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIRegionAlienFacilityState'),
    rawXenoforming: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIRegionXenoformingState'),
    rawGlobalResearch: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIGlobalResearchState'),
    // The campaign-start globals. Read for `controlPointMaintenanceFreebies`,
    // which is half the base control-point cap and exists nowhere else -- no
    // template carries a base cap at all (checked across all 60 template files
    // 2026-08-22; TIGlobalConfig.json is a 4.7 KB UI-canvas list).
    rawGlobalValues: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIGlobalValuesState'),
    // The game's own per-faction active-effect lists, keyed by effect context.
    // Authoritative for `ControlPointMaintenance` in a way a completed-project
    // sweep is not: the Aliens hold four such effects from none of the 32
    // projects that grant them (measured 2026-08-22).
    rawEffects: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIEffectsState'),
    rawMissions: getCollection(gamestates, 'PavonisInteractive.TerraInvicta.TIMissionState')
  };
}

/**
 * The reference indexes shared by every reducer, built in one pass.
 *
 * `registerShipModuleRefs` is injected rather than imported so this module
 * stays free of ship-domain knowledge; space.js owns the JSON.NET `$id`/`$ref`
 * rules for shared ship modules.
 */
function buildIdMaps(raw, { registerShipModuleRefs }) {
  const {
    rawFactions, rawNations, rawHabs, rawSpaceBodies, rawHabSectors, rawHabModules,
    rawFleets, rawOrbits, rawRegions, rawOrgs, rawMissions, rawShips
  } = raw;

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
    bodyDistanceAUById.set(b.ID.value, distanceMeters / METERS_PER_AU);
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
    registerShipModuleRefs(ship, shipModuleRefs);
  }

  return {
    factionsById,
    factionsByName,
    nationsById,
    habsById,
    bodiesById,
    habSectorsById,
    habModulesById,
    habModuleLocationById,
    fleetsById,
    bodyDistanceAUById,
    saturnOrbitDistanceAU,
    orbitsById,
    regionsById,
    orgsById,
    missionsById,
    shipsById,
    shipModuleRefs
  };
}

/**
 * Control points, indexed by id and grouped by nation.
 *
 * Separate from `buildIdMaps` because the rows here are already projected
 * output -- the nation reducer and the faction reducer both read them as
 * data, not as raw save records.
 */
function buildControlPoints(rawControlPoints, factionsById) {
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
        factionName: resolveFactionName(factionsById, factionId, 'Unknown', 'Neutral'),
        nationId,
        isExecutive,
        controlPointType: cp.controlPointType || 'Standard',
        benefits: cp.benefits || null,
        // A crackdown'd or abandoned control point keeps its share of the
        // nation's output but the owning faction stops receiving it, so the
        // resource split has to know the difference.
        benefitsDisabled: typeof cp.benefitsDisabled === 'boolean' ? cp.benefitsDisabled : null,
        // A crackdown'd control point also costs its owner NO control-point
        // maintenance (wiki Nations, "Cost of Control Points", raw wikitext read
        // 2026-08-22), so shared/controlPointCap.mjs needs to tell it apart from
        // a merely benefits-disabled one. The save stores an expiry date rather
        // than a flag; an ABSENT expiry is "not under crackdown", which is a
        // measurement, so this stays a boolean rather than a nullable one.
        crackdown: cp.crackdownExpiration !== null && cp.crackdownExpiration !== undefined,
        crackdownExpiration: cp.crackdownExpiration || null,
        // Defend Interests is stateful: keep the save's ward and expiry
        // so the directive engine can distinguish an actionable gap from a
        // holding that is already protected. The filter decides who may
        // see these fields in player mode.
        defended: typeof cp.defended === 'boolean' ? cp.defended : null,
        defendExpiration: cp.defendExpiration || null
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
  return { controlPointsById, controlPointsByNationId };
}

module.exports = {
  SATURN_ORBIT_TOLERANCE_AU,
  FACTION_COLORS,
  UNKNOWN_FACTION_COLOR,
  getFactionColor,
  getCollection,
  resolveFactionName,
  resolveOrbitBodyId,
  resolveOrbitBody,
  resolveOrbitBodyDistanceAU,
  readRawCollections,
  buildIdMaps,
  buildControlPoints
};
