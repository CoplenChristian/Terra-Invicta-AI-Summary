// shared/intel/production.mjs
//
// Purpose: ship designs and the procurement plan derived from them, refusing to
//   fabricate a bill of materials.
//
// Ship designs and the procurement plan derived from them. Both refuse to
// fabricate a bill of materials: the save records a design as a component
// list, not a resource cost, and every affordability figure downstream of an
// invented cost is itself invented.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, toFiniteNumber as toFinite, resolveObserverFaction, sameId } from '../util.mjs';
import { MINING_RESOURCES, factionMatches, normalizeCostObject } from './common.mjs';

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
