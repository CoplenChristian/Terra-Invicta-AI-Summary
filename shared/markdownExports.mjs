// shared/markdownExports.mjs
//
// Shared markdown export renderers for model-facing interfaces:
//   * /latest-snapshot.md  (macro campaign state, ~14 KB)
//   * /latest-threats.md   (immediate danger within 365 days, < 10 KB)
//   * /latest-war-room.md  (operational military/economic brief, 20-30 KB)
//
// Design principles (see docs/markdown-export-plan.md):
//   1. Consumes the filtered snapshot DIRECTLY, never the stripped /api/intel projections.
//   2. Pure ESM with no Node built-ins -- runnable in Express and Cloudflare Worker.
//   3. Deterministic: same snapshot -> byte-identical markdown.
//   4. Absence-preserving: unmeasured values render as UNAVAILABLE, never 0.
//   5. No fabricated fallbacks: interception state is explicitly UNAVAILABLE.
//   6. Human-readable design rollups: joins ship.hullName against shipDesigns.
//   7. Hostile filtering with explicit omitted count.
//   8. Zero-detection coverage vs no-threats distinction.

import {
  ALIEN_FACTION_ID,
  INITIATIVE_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME,
  ALIEN_FACTION_DISPLAY_NAME
} from './constants.mjs';
import {
  asArray,
  toFiniteNumber as num,
  sameId,
  round,
  MS_PER_DAY,
  ONE_TRILLION,
  resolveObserverFaction
} from './util.mjs';
import {
  SHIP_CONSTRUCTION_MODULES,
  HAB_CONSTRUCTION_MODULES
} from './strategicSnapshot.mjs';

// Absence-preserving formatting helpers
export const isMeasured = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export const fixedOr = (value, decimals, fallback = 'UNAVAILABLE') =>
  (isMeasured(value) ? Number(value).toFixed(decimals) : fallback);

export const localeOr = (value, fallback = 'UNAVAILABLE') =>
  (isMeasured(value) ? Number(value).toLocaleString() : fallback);

export const normalizeBody = (body) =>
  String(body || '').trim().replace(/\s+orbit$/i, '').toLowerCase();

/**
 * Builds a lookup map from ship design template ID (e.g. 'playerShipTemplate584')
 * to { displayName, hullClass, combatValue } from snapshot.shipDesigns.
 */
export function buildDesignLookup(shipDesigns) {
  const lookup = new Map();
  for (const d of asArray(shipDesigns)) {
    if (!d || !d.dataName) continue;
    const name = d._displayName || d.displayName || d.friendlyName || d.hullName || d.dataName;
    const hullClass = d.hullName || 'Ship';
    const cv = isMeasured(d._unnormalizedCombatValue) ? Number(d._unnormalizedCombatValue) : null;
    lookup.set(d.dataName, {
      dataName: d.dataName,
      displayName: name,
      hullClass,
      combatValue: cv
    });
  }
  return lookup;
}

/**
 * Aggregates hab modules for each hab ID into capability totals:
 * { mines, shipyards, construction, defense, research, powerOperational }
 */
export function buildHabModuleAggregates(habModules) {
  const shipSet = new Set(SHIP_CONSTRUCTION_MODULES.map(s => s.toLowerCase()));
  const habSet = new Set(HAB_CONSTRUCTION_MODULES.map(s => s.toLowerCase()));
  const habConstructionPattern = /Construction|Nanofact|Assembler/i;

  const agg = new Map();
  for (const m of asArray(habModules)) {
    if (!m || m.destroyed) continue;
    const habId = Number(m.habId);
    if (!habId && habId !== 0) continue;

    if (!agg.has(habId)) {
      agg.set(habId, {
        mines: 0,
        shipyards: 0,
        construction: 0,
        defense: 0,
        research: 0,
        operational: 0,
        underConstruction: 0
      });
    }
    const entry = agg.get(habId);
    const isOperational = m.constructionStatus === 'operational' || m.constructionCompleted === true;

    if (isOperational) {
      entry.operational += 1;
      const template = String(m.templateName || '');
      const key = template.toLowerCase();
      const isYard = m.isShipyard === true || shipSet.has(key);

      if (isYard) entry.shipyards += 1;
      if (/Mining/i.test(template)) entry.mines += 1;
      if (/Defense|Battery|Laser|Gun|Missile|Array/i.test(template)) entry.defense += 1;
      if (!isYard && (habSet.has(key) || habConstructionPattern.test(template))) {
        entry.construction += 1;
      }
      if (/Lab|Research|Science/i.test(template)) entry.research += 1;
    } else {
      entry.underConstruction += 1;
    }
  }
  return agg;
}

/**
 * Summarizes weapon systems and calculates total Point Defense counts.
 */
export function extractWeaponAndPdSummary(fleetOrShip) {
  let weaponSummary = fleetOrShip.weaponSummary || null;
  let pdCount = 0;
  const roleCounts = new Map();

  const breakdown = fleetOrShip.weaponBreakdown || fleetOrShip.weaponLoadout || [];
  if (Array.isArray(breakdown) && breakdown.length > 0) {
    for (const entry of breakdown) {
      const role = entry.role || entry.category || 'Unknown';
      const count = Number(entry.count) || (Array.isArray(entry.systems) ? entry.systems.length : 1);
      if (/Point\s*Defense/i.test(role)) {
        pdCount += count;
      }
      roleCounts.set(role, (roleCounts.get(role) || 0) + count);
    }
    if (!weaponSummary && roleCounts.size > 0) {
      weaponSummary = [...roleCounts.entries()]
        .map(([role, count]) => `${role} x${count}`)
        .join(' • ');
    }
  }

  // Fallback to searching ships array if weaponBreakdown was empty
  if (pdCount === 0 && Array.isArray(fleetOrShip.ships)) {
    for (const ship of fleetOrShip.ships) {
      const loadout = ship.weaponLoadout || [];
      for (const entry of loadout) {
        if (/Point\s*Defense/i.test(entry.role || entry.category || '')) {
          pdCount += (Number(entry.count) || 1);
        }
      }
    }
  }

  return {
    summary: weaponSummary || 'No weapon summary available',
    pdCount,
    dominantWeapon: fleetOrShip.dominantWeaponType || null
  };
}

/**
 * Formats a friendly fleet's compact design rollup:
 *   - 6× Patapsco (Escort)
 *   - 3× Xingu (Monitor)
 */
export function formatFleetDesignRollup(fleet, designLookup) {
  const ships = asArray(fleet.ships);
  if (ships.length === 0) return ['  - (No ship manifest available)'];

  const designCounts = new Map();
  for (const ship of ships) {
    const rawHull = ship.hullName || 'Unknown';
    const info = designLookup.get(rawHull);
    const key = info ? `${info.displayName} (${info.hullClass})` : rawHull;
    designCounts.set(key, (designCounts.get(key) || 0) + 1);
  }

  return [...designCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `  - ${count}× ${name}`);
}

/**
 * Determines whether a faction is genuinely hostile (Aliens, priority target / Servants, or at war).
 */
export function isGenuinelyHostileFaction(factionId, factionName, filteredSnapshot) {
  const observerId = filteredSnapshot?.observerFactionId;
  if (sameId(factionId, observerId)) return false;

  if (sameId(factionId, ALIEN_FACTION_ID) || factionName === ALIEN_FACTION_DISPLAY_NAME) {
    return true;
  }

  const priorityId = filteredSnapshot?.priorityTargetFaction?.id;
  const priorityName = filteredSnapshot?.priorityTargetFaction?.name;
  if (priorityId && sameId(factionId, priorityId)) return true;
  if (priorityName && factionName === priorityName) return true;
  if (factionName === SERVANTS_DISPLAY_NAME) return true;

  const fObj = asArray(filteredSnapshot?.factions).find(f => sameId(f.ID, factionId));
  if (fObj && (fObj.isAlien || fObj.atWarWithObserver || fObj.isEnemy || fObj.atWar)) return true;

  return false;
}

/**
 * Evaluates whether a hostile fleet meets the war-room relevance criteria:
 *   1. Targeting observer hab directly (regardless of ship count)
 *   2. Inbound transfer to observer orbit/theater arriving within 365 days
 *   3. Co-located at the same specific orbit/station with an observer asset AND shipsCount >= 5 (Sol excluded)
 *   4. Major combat fleet (shipsCount >= 10)
 *
 * Returns { isRelevant: boolean, reasons: string[], daysRemaining: number|null }
 */
export function evaluateHostileRelevance(fleet, ourHabIds, ourOrbits, gameDate) {
  const reasons = [];
  const ships = num(fleet.shipsCount) ?? (Array.isArray(fleet.ships) ? fleet.ships.length : 0);

  const destId = num(fleet.destinationId);
  const isTargetingOurHab = destId !== null && ourHabIds.has(destId);

  const destOrbit = normalizeBody(fleet.destination);
  let daysRemaining = null;
  if (fleet.arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
    const arr = new Date(fleet.arrivalDate);
    if (!Number.isNaN(arr.getTime())) {
      daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
    }
  }

  const isInboundToOurTheater = (isTargetingOurHab || (destOrbit && ourOrbits.has(destOrbit))) &&
    daysRemaining !== null && daysRemaining <= 365;

  if (isTargetingOurHab) {
    reasons.push('targeting observer hab');
  } else if (isInboundToOurTheater) {
    reasons.push(`inbound transfer to observer theater (${daysRemaining}d)`);
  }

  const curOrbit = normalizeBody(fleet.orbitBody);
  const isCoLocated = curOrbit && ourOrbits.has(curOrbit) && curOrbit !== 'sol' && curOrbit !== 'deep space';

  if (isCoLocated && ships >= 5) {
    reasons.push(`co-located in observer orbit (${fleet.orbitBody}, ${ships} ships)`);
  }

  if (ships >= 10 && reasons.length === 0) {
    reasons.push(`major combat fleet (${ships} ships)`);
  }

  return {
    isRelevant: reasons.length > 0,
    reasons,
    daysRemaining
  };
}

// ---------------------------------------------------------------------------
// 1. /latest-threats.md  (< 10 KB)
// ---------------------------------------------------------------------------

export function renderThreatsMarkdown(filteredSnapshot, options = {}) {
  const meta = filteredSnapshot.metadata || {};
  const observerId = filteredSnapshot.observerFactionId;
  const observer = resolveObserverFaction(filteredSnapshot.factions, observerId, {
    fallbackToFirst: true
  });
  const observerName = observer?.displayName || INITIATIVE_DISPLAY_NAME;
  const mode = (filteredSnapshot.mode || 'player').toUpperCase();
  const gameDate = meta.gameTimeString ? new Date(meta.gameTimeString) : null;

  const designLookup = buildDesignLookup(filteredSnapshot.shipDesigns);
  const habModulesAgg = buildHabModuleAggregates(filteredSnapshot.habModules);

  const ourHabs = asArray(filteredSnapshot.habs).filter(h => sameId(h.factionId, observerId));
  const ourHabIds = new Set(ourHabs.map(h => Number(h.ID)));
  const ourHabMap = new Map(ourHabs.map(h => [Number(h.ID), h]));
  const ourFleets = asArray(filteredSnapshot.fleets).filter(f => sameId(f.factionId, observerId));

  const ourOrbits = new Set([
    ...ourHabs.map(h => normalizeBody(h.orbitBody)).filter(Boolean),
    ...ourFleets.map(f => normalizeBody(f.orbitBody)).filter(Boolean)
  ]);
  ourOrbits.delete('sol');
  ourOrbits.delete('deep space');

  // Genuinely hostile inbound transfers <= 365 days
  const hostiles = asArray(filteredSnapshot.fleets).filter(f =>
    isGenuinelyHostileFaction(f.factionId, f.factionName, filteredSnapshot)
  );
  const inboundThreats = [];

  for (const f of hostiles) {
    if (!f.arrivalDate && !f.destination) continue;
    const destOrbit = normalizeBody(f.destination);
    const destId = num(f.destinationId);
    const targetsOurHab = destId !== null && ourHabIds.has(destId);
    const targetsOurOrbit = destOrbit && ourOrbits.has(destOrbit);

    if (!targetsOurHab && !targetsOurOrbit) continue;

    let daysRemaining = null;
    if (f.arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
      const arr = new Date(f.arrivalDate);
      if (!Number.isNaN(arr.getTime())) {
        daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
      }
    }

    if (daysRemaining !== null && daysRemaining > 365) continue;

    inboundThreats.push({
      fleet: f,
      daysRemaining: daysRemaining ?? 9999,
      targetHab: targetsOurHab ? ourHabMap.get(destId) : null,
      destBody: destOrbit
    });
  }

  // Sort strictly by time-to-impact (arrival ascending)
  inboundThreats.sort((a, b) => a.daysRemaining - b.daysRemaining);

  const lines = [];
  lines.push(`# TI Tactical Threat Assessment`);
  lines.push(``);
  lines.push(`**Date:** ${meta.gameTimeString || 'Unknown'}`);
  lines.push(`**Observer Faction:** ${observerName}`);
  lines.push(`**Intelligence Mode:** ${mode}`);

  // Detection coverage assessment
  const hasVisibleHostiles = hostiles.length > 0;
  const alienStage = filteredSnapshot.alienIntelligenceStage;
  const deepSkywatch = filteredSnapshot.capabilities?.deepSkywatch || alienStage?.operations?.active;
  let detectionLabel = 'Active Deep System Skywatch';
  if (!deepSkywatch && !hasVisibleHostiles) {
    detectionLabel = 'NO DETECTION COVERAGE — Skywatch inactive; unobserved space may contain undetected forces';
  } else if (hasVisibleHostiles) {
    detectionLabel = hostiles[0].visibility || 'Active Deep System Skywatch';
  }
  lines.push(`**Detection Status:** ${detectionLabel}`);
  lines.push(``);

  lines.push(`## Immediate Inbound Threats (≤ 365 Days)`);
  lines.push(``);

  if (inboundThreats.length === 0) {
    if (!hasVisibleHostiles && !deepSkywatch) {
      lines.push(`> **NO DETECTION COVERAGE**`);
      lines.push(`> No space surveillance capability active. Zero observed hostile transfers does not indicate absence of threats.`);
    } else {
      lines.push(`*No hostile transfers inbound to observer assets detected within 365 days under active detection coverage.*`);
    }
    lines.push(``);
  } else {
    for (const item of inboundThreats) {
      const f = item.fleet;
      const days = item.daysRemaining < 9999 ? `${item.daysRemaining} days` : 'ETA Unknown';
      const arrivalFormatted = f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown date';
      const hostileWeapons = extractWeaponAndPdSummary(f);

      lines.push(`### ⚠️ ${f.displayName} (${f.factionName || 'Hostile'}) — ETA: ${arrivalFormatted} (${days})`);
      lines.push(`- **Inbound Force:** ${f.shipsCount ?? 'Unknown'} ships | Dominant Weapon: ${hostileWeapons.dominantWeapon || 'Unknown'}`);
      lines.push(`- **Weapon Loadout:** ${hostileWeapons.summary} (${hostileWeapons.pdCount} Point Defense systems)`);
      lines.push(`- **Trajectory:** ${f.orbitBody || 'Deep Space'} → ${f.destination || 'Observer Asset'} (Target: ${item.targetHab?.displayName || f.destination || 'Station/Orbit'})`);
      lines.push(`- **Interception / Pursuit State:** UNAVAILABLE (Game save format does not track interception orders)`);

      // Defending forces stationed at destination
      const defendingFleets = ourFleets.filter(other => normalizeBody(other.orbitBody) === item.destBody);
      const defendingShipCount = defendingFleets.reduce((sum, other) => sum + (Number(other.shipsCount) || 0), 0);
      let defendingPdTotal = 0;
      for (const dFleet of defendingFleets) {
        const dWeapons = extractWeaponAndPdSummary(dFleet);
        defendingPdTotal += dWeapons.pdCount;
      }

      // Construction completing before arrival at destination
      const completingQueues = asArray(filteredSnapshot.shipyardQueues).filter(q => {
        if (!sameId(q.factionId, observerId)) return false;
        if (normalizeBody(q.orbitBody) !== item.destBody) return false;
        if (!q.completionDate || !f.arrivalDate) return true;
        return new Date(q.completionDate) <= new Date(f.arrivalDate);
      });

      lines.push(`- **Defending Forces at Destination:** ${defendingShipCount} friendly ships stationed at ${item.destBody || 'destination'} (${defendingPdTotal} Point Defense systems)`);
      if (completingQueues.length > 0) {
        const queueDesigns = completingQueues.map(q => {
          const info = designLookup.get(q.design || q.hull);
          return info ? info.displayName : (q.design || q.hull || 'Ship');
        });
        lines.push(`- **Reinforcements Completing Before ETA:** ${completingQueues.length} ship(s) (${queueDesigns.join(', ')})`);
      } else {
        lines.push(`- **Reinforcements Completing Before ETA:** None queued at destination`);
      }

      // Hab defenses at destination if specific hab is targeted
      if (item.targetHab) {
        const habAgg = habModulesAgg.get(Number(item.targetHab.ID));
        if (habAgg) {
          lines.push(`- **Target Hab Defense Modules:** ${habAgg.defense} defense array(s) | ${habAgg.shipyards} shipyard(s)`);
        }
      }
      lines.push(``);
    }
  }

  // Theaters & Assets at Immediate Risk
  lines.push(`## Theaters & Assets at Immediate Risk`);
  lines.push(``);

  const bodiesAtRisk = new Set(inboundThreats.map(t => t.destBody).filter(Boolean));
  // Add orbits where genuine hostile fleets are currently co-located with friendly assets (excluding sol)
  for (const h of hostiles) {
    const b = normalizeBody(h.orbitBody);
    const ships = num(h.shipsCount) ?? (Array.isArray(h.ships) ? h.ships.length : 0);
    if (b && ourOrbits.has(b) && b !== 'sol' && b !== 'deep space' && ships >= 5) {
      bodiesAtRisk.add(b);
    }
  }

  if (bodiesAtRisk.size === 0) {
    lines.push(`*No observer theater currently has co-located or inbound hostile fleets.*`);
  } else {
    for (const bodyKey of bodiesAtRisk) {
      const bodyHabs = ourHabs.filter(h => normalizeBody(h.orbitBody) === bodyKey);
      const bodyFleets = ourFleets.filter(f => normalizeBody(f.orbitBody) === bodyKey);
      const bodyHostiles = hostiles.filter(h => normalizeBody(h.orbitBody) === bodyKey);
      const bodyInbound = inboundThreats.filter(t => t.destBody === bodyKey);

      const capitalizedBody = bodyHabs[0]?.orbitBody || bodyFleets[0]?.orbitBody || bodyKey;
      lines.push(`### ${capitalizedBody}`);
      lines.push(`- **Friendly Assets:** ${bodyHabs.length} hab(s), ${bodyFleets.reduce((s, f) => s + (Number(f.shipsCount) || 0), 0)} ships`);
      lines.push(`- **Hostile Contacts Present:** ${bodyHostiles.length} fleet(s) (${bodyHostiles.reduce((s, f) => s + (Number(f.shipsCount) || 0), 0)} ships)`);
      lines.push(`- **Hostile Transfers Inbound:** ${bodyInbound.length} fleet(s)`);
      for (const h of bodyHabs) {
        const agg = habModulesAgg.get(Number(h.ID));
        lines.push(`  - **${h.displayName}** (Tier ${h.tier || 1} ${h.habType || 'Hab'}): ${agg?.defense || 0} Defenses | ${agg?.shipyards || 0} Shipyards | ${agg?.mines || 0} Mines`);
      }
      lines.push(``);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2. /latest-war-room.md  (20-30 KB)
// ---------------------------------------------------------------------------

export function renderWarRoomMarkdown(filteredSnapshot, options = {}) {
  const meta = filteredSnapshot.metadata || {};
  const observerId = filteredSnapshot.observerFactionId;
  const observer = resolveObserverFaction(filteredSnapshot.factions, observerId, {
    fallbackToFirst: true
  });
  const observerName = observer?.displayName || INITIATIVE_DISPLAY_NAME;
  const mode = (filteredSnapshot.mode || 'player').toUpperCase();
  const gameDate = meta.gameTimeString ? new Date(meta.gameTimeString) : null;

  const designLookup = buildDesignLookup(filteredSnapshot.shipDesigns);
  const habModulesAgg = buildHabModuleAggregates(filteredSnapshot.habModules);

  const ourHabs = asArray(filteredSnapshot.habs).filter(h => sameId(h.factionId, observerId));
  const ourHabIds = new Set(ourHabs.map(h => Number(h.ID)));
  const ourFleets = asArray(filteredSnapshot.fleets).filter(f => sameId(f.factionId, observerId));
  const ourOrbits = new Set([
    ...ourHabs.map(h => normalizeBody(h.orbitBody)).filter(Boolean),
    ...ourFleets.map(f => normalizeBody(f.orbitBody)).filter(Boolean)
  ]);
  ourOrbits.delete('sol');
  ourOrbits.delete('deep space');

  const lines = [];
  lines.push(`# TI Strategic War Room Briefing`);
  lines.push(``);
  lines.push(`**Date:** ${meta.gameTimeString || 'Unknown'}`);
  lines.push(`**Observer Faction:** ${observerName}`);
  lines.push(`**Intelligence Mode:** ${mode}`);
  lines.push(`**Difficulty:** ${meta.difficulty || 'Normal'}`);
  lines.push(``);

  // -------------------------------------------------------------------------
  // SECTION 1: ALIEN THREAT & HATE ECONOMICS
  // -------------------------------------------------------------------------
  lines.push(`## 1. Alien Threat Posture & Hate Economics`);
  lines.push(``);

  const economics = filteredSnapshot.alienHateEconomics;
  if (!economics || !economics.applicable) {
    lines.push(`- Alien hate economics not applicable to ${observerName}.`);
  } else {
    const actualHate = isMeasured(economics.actualAlienHate)
      ? Number(economics.actualAlienHate).toFixed(2)
      : (economics.visibleHateEstimate || 'UNAVAILABLE');
    const actualLabel = isMeasured(economics.actualAlienHate)
      ? 'Raw-save actual hate'
      : (economics.visibleHateEstimate ? 'Game-visible hate estimate' : 'Actual hate');

    lines.push(`- **${actualLabel}:** ${actualHate}`);
    lines.push(`- **Minimum Alien Hate Floor:** ${fixedOr(economics.minimumAlienHate, 2)}`);
    lines.push(`- **Hate Above Floor:** ${fixedOr(economics.hateAboveFloor, 2)}`);
    lines.push(`- **War Threshold:** ${fixedOr(economics.warThreshold, 2)} (crossing triggers retaliation / war footing)`);
    lines.push(`- **Headroom to 50-Hate War Floor:** ${fixedOr(economics.minimumHateHeadroom, 2)}`);
    lines.push(`- **Mission Control Used:** ${fixedOr(economics.usedMissionControl, 0)} / ${fixedOr(economics.missionControlCapacity, 0)} capacity`);
    lines.push(`- **MC Threshold for 50-Hate Floor:** ${fixedOr(economics.mcWarFloor, 1)} used MC`);
    lines.push(`- **Current War Footing:** ${economics.currentWarStatus || 'UNAVAILABLE'}`);
    lines.push(`- **Hate Formula:** \`${economics.formula?.text || 'UNAVAILABLE'}\``);

    // Venting and Total War
    if (economics.totalWar) {
      lines.push(`- **Total War Proximity:** State: ${economics.totalWar.state?.toUpperCase() || 'SAFE'} | Hate Distance: ${fixedOr(economics.totalWar.hateRemaining, 1)} | Year Distance: ${fixedOr(economics.totalWar.yearsRemaining, 1)} yrs`);
    }
    if (economics.venting) {
      lines.push(`- **Hate Venting Eligibility:** ${economics.venting.status?.toUpperCase() || 'UNAVAILABLE'} (Guaranteed: ${economics.venting.guaranteed ? 'YES' : 'NO'})`);
      if (Array.isArray(economics.venting.conditions)) {
        for (const cond of economics.venting.conditions) {
          lines.push(`  - Condition: ${cond}`);
        }
      }
    }
  }
  lines.push(``);

  // -------------------------------------------------------------------------
  // SECTION 2: FRIENDLY FLEETS
  // -------------------------------------------------------------------------
  lines.push(`## 2. Friendly Fleets (${ourFleets.length} fleets, ${ourFleets.reduce((s, f) => s + (Number(f.shipsCount) || 0), 0)} ships)`);
  lines.push(``);
  lines.push(`*Note: Fleet interception and pursuit state is UNAVAILABLE in the save format.*`);
  lines.push(``);

  if (ourFleets.length === 0) {
    lines.push(`*No friendly warships currently in service.*`);
    lines.push(``);
  } else {
    for (const f of ourFleets) {
      const weapons = extractWeaponAndPdSummary(f);
      const missionDesc = f.destination
        ? `Transfer to ${f.destination} (ETA: ${f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown'})`
        : (f.mission || 'Stationary / Patrol');

      lines.push(`### ${f.displayName} (${f.shipsCount ?? 0} ships | ${f.orbitBody || 'Deep Space'} | ${missionDesc})`);
      lines.push(`- **Propulsion:** Lowest ΔV: ${fixedOr(f.lowestDeltaVKps, 1, 'UNAVAILABLE')} kps | Combat Accel: ${fixedOr(f.lowestCombatAccelerationMps2, 3, 'UNAVAILABLE')} m/s² | Interception State: UNAVAILABLE`);
      lines.push(`- **Weapons & Defense:** ${weapons.summary} (${weapons.pdCount} Point Defense systems)`);
      lines.push(`- **Ship Manifest & Design Rollup:**`);
      const rollups = formatFleetDesignRollup(f, designLookup);
      for (const line of rollups) {
        lines.push(line);
      }
      lines.push(``);
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 3: HOSTILE RELEVANT FLEETS
  // -------------------------------------------------------------------------
  lines.push(`## 3. Hostile Relevant Fleets`);
  lines.push(``);

  const allHostiles = asArray(filteredSnapshot.fleets).filter(f =>
    isGenuinelyHostileFaction(f.factionId, f.factionName, filteredSnapshot)
  );
  const relevantHostiles = [];
  let omittedCount = 0;

  for (const f of allHostiles) {
    const rel = evaluateHostileRelevance(f, ourHabIds, ourOrbits, gameDate);
    if (rel.isRelevant) {
      relevantHostiles.push({ fleet: f, rel });
    } else {
      omittedCount += 1;
    }
  }

  if (allHostiles.length === 0) {
    lines.push(`> **No hostile fleets detected.**`);
    lines.push(`> (Detection coverage: ${filteredSnapshot.capabilities?.deepSkywatch ? 'Deep System Skywatch active' : 'No surveillance coverage active — unobserved space is not empty'}).`);
    lines.push(``);
  } else if (relevantHostiles.length === 0) {
    lines.push(`*All ${allHostiles.length} observed hostile fleets are below the relevance threshold (< 5 ships, not targeting observer assets, not sharing theater, arrival > 365 days).*`);
    lines.push(``);
  } else {
    for (const item of relevantHostiles) {
      const f = item.fleet;
      const weapons = extractWeaponAndPdSummary(f);
      const missionDesc = f.destination
        ? `Transfer to ${f.destination} (ETA: ${f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown'})`
        : (f.mission || 'Stationary / Patrol');

      lines.push(`- **${f.displayName}** (${f.shipsCount ?? 0} ships | ${f.factionName || 'Hostile'} | ${f.orbitBody || 'Deep Space'}) — ${missionDesc} [${item.rel.reasons.join('; ')}]`);
      lines.push(`  - Weapons: ${weapons.dominantWeapon || 'Unknown'} (${weapons.summary} | ${weapons.pdCount} PD) | Armor: ${fixedOr(f.armorMedian, 1, 'UNAVAILABLE')} cm | ΔV: ${fixedOr(f.lowestDeltaVKps, 1, 'UNAVAILABLE')} kps, Accel: ${fixedOr(f.lowestCombatAccelerationMps2, 2, 'UNAVAILABLE')} m/s²`);
    }
  }

  if (omittedCount > 0) {
    lines.push(`*${omittedCount} hostile fleets omitted (below relevance threshold: < 5 ships, not targeting observer assets, not sharing theater, arrival > 365 days).*`);
    lines.push(``);
  }

  // -------------------------------------------------------------------------
  // SECTION 4: INCOMING THREATS & TRANSFERS
  // -------------------------------------------------------------------------
  lines.push(`## 4. Incoming Threats & Transfers`);
  lines.push(``);

  const inboundList = [];
  for (const f of allHostiles) {
    if (!f.arrivalDate && !f.destination) continue;
    const destOrbit = normalizeBody(f.destination);
    const destId = num(f.destinationId);
    const targetsOurHab = destId !== null && ourHabIds.has(destId);
    const targetsOurOrbit = destOrbit && ourOrbits.has(destOrbit);

    if (targetsOurHab || targetsOurOrbit) {
      let daysRemaining = null;
      if (f.arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
        const arr = new Date(f.arrivalDate);
        if (!Number.isNaN(arr.getTime())) {
          daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
        }
      }
      if (daysRemaining === null || daysRemaining <= 365) {
        inboundList.push({
          fleet: f,
          daysRemaining: daysRemaining ?? 9999,
          targetsOurHab: targetsOurHab ? ourHabMap.get(destId) : null,
          destBody: destOrbit
        });
      }
    }
  }

  inboundList.sort((a, b) => a.daysRemaining - b.daysRemaining);

  if (inboundList.length === 0) {
    lines.push(`*No hostile transfers currently inbound to observer assets.*`);
  } else {
    for (const item of inboundList) {
      const f = item.fleet;
      const days = item.daysRemaining < 9999 ? `${item.daysRemaining} days` : 'ETA Unknown';
      const arrivalDate = f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown date';
      const weapons = extractWeaponAndPdSummary(f);
      const targetLabel = item.targetsOurHab?.displayName || f.destination || 'Observer Asset';

      lines.push(`- **${f.displayName}** (${f.shipsCount ?? 0} ships) → Target: **${targetLabel}** | ETA: ${arrivalDate} (${days}) | Force: ${weapons.summary}`);
    }
  }
  lines.push(``);

  // -------------------------------------------------------------------------
  // SECTION 5: SHIPYARDS & FLEET CONSTRUCTION
  // -------------------------------------------------------------------------
  lines.push(`## 5. Shipyards & Fleet Construction`);
  lines.push(``);

  const friendlyStations = asArray(filteredSnapshot.shipyardStations).filter(s => sameId(s.factionId, observerId));
  const friendlyQueues = asArray(filteredSnapshot.shipyardQueues).filter(q => sameId(q.factionId, observerId));
  const friendlyModules = asArray(filteredSnapshot.habModules).filter(m =>
    sameId(m.factionId, observerId) && !m.constructionCompleted && !m.destroyed
  );

  lines.push(`### Active Shipyard Stations (${friendlyStations.length} stations)`);
  if (friendlyStations.length === 0) {
    lines.push(`*No active shipyard stations owned by ${observerName}.*`);
  } else {
    for (const s of friendlyStations) {
      lines.push(`- **${s.name || s.displayName}** (${s.orbitBody || 'Orbit'} | Tier ${s.tier || 1}): ${s.shipyardModulesCount ?? s.shipyardsCount ?? 1} Yard(s) | Active Builds: ${asArray(s.queue).length}`);
    }
  }
  lines.push(``);

  lines.push(`### Ship Construction Queues (${friendlyQueues.length} ship(s) building)`);
  if (friendlyQueues.length === 0) {
    lines.push(`*No warships currently under construction.*`);
  } else {
    for (const q of friendlyQueues) {
      const designInfo = designLookup.get(q.design || q.hull);
      const designName = designInfo ? `${designInfo.displayName} (${designInfo.hullClass})` : (q.design || q.hull || 'Warship');
      const compDate = q.completionDate ? q.completionDate.split('T')[0] : 'Unknown date';
      lines.push(`- **${designName}** at ${q.orbitBody || 'Station'} — Ready: ${compDate} (Queue ID: ${q.id || 'N/A'})`);
    }
  }
  lines.push(``);

  if (friendlyModules.length > 0) {
    lines.push(`### Hab Modules Under Construction (${friendlyModules.length} module(s))`);
    for (const m of friendlyModules.slice(0, 10)) {
      const compDate = m.completionDate ? m.completionDate.split('T')[0] : 'In progress';
      lines.push(`- **${m.templateName || m.name}** at ${m.habName || m.orbitBody || 'Hab'} — Ready: ${compDate}`);
    }
    if (friendlyModules.length > 10) {
      lines.push(`- *...and ${friendlyModules.length - 10} additional modules building.*`);
    }
    lines.push(``);
  }

  // -------------------------------------------------------------------------
  // SECTION 6: KEY HABS & INFRASTRUCTURE
  // -------------------------------------------------------------------------
  lines.push(`## 6. Key Habs & Space Infrastructure (${ourHabs.length} habs)`);
  lines.push(``);

  if (ourHabs.length === 0) {
    lines.push(`*No habs or surface bases owned by ${observerName}.*`);
  } else {
    const habsByBody = new Map();
    for (const h of ourHabs) {
      const b = h.orbitBody || 'Deep Space';
      if (!habsByBody.has(b)) habsByBody.set(b, []);
      habsByBody.get(b).push(h);
    }

    for (const [bodyName, habList] of habsByBody.entries()) {
      lines.push(`### ${bodyName} (${habList.length} habs)`);
      for (const h of habList) {
        const agg = habModulesAgg.get(Number(h.ID)) || {
          mines: 0,
          shipyards: 0,
          construction: 0,
          defense: 0,
          research: 0
        };
        const statusFlags = [];
        if (h.inCombat) statusFlags.push('IN COMBAT');
        if (h.underAssault) statusFlags.push('UNDER ASSAULT');
        if (h.underBombardment) statusFlags.push('UNDER BOMBARDMENT');
        const flagText = statusFlags.length ? ` **[${statusFlags.join(', ')}]**` : '';

        lines.push(`- **${h.displayName}** (Tier ${h.tier || 1} ${h.habType || 'Hab'})${flagText}: ${agg.mines} Mine(s) | ${agg.shipyards} Shipyard(s) | ${agg.construction} Construction | ${agg.defense} Defense(s) | ${agg.research} Lab(s)`);
      }
      lines.push(``);
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 7: LOGISTICS & WAR ECONOMY
  // -------------------------------------------------------------------------
  lines.push(`## 7. Logistics & War Economy`);
  lines.push(``);

  const res = observer?.resources || {};
  const net = observer?.monthlyNet || {};

  const resourceEntries = [
    ['Water', res.Water, net.Water, 'tons'],
    ['Volatiles', res.Volatiles, net.Volatiles, 'tons'],
    ['Metals', res.Metals, net.Metals, 'tons'],
    ['Noble Metals', res.NobleMetals, net.NobleMetals, 'tons'],
    ['Fissiles', res.Fissiles, net.Fissiles, 'tons'],
    ['Antimatter', res.Antimatter, net.Antimatter, 'mg'],
    ['Exotics', res.Exotics, net.Exotics, 'tons'],
    ['Money', res.Money, net.Money, '$'],
    ['Boost', res.Boost, net.Boost, 'boost/mo'],
    ['Research', res.Research, net.Research, 'RP/mo']
  ];

  lines.push(`| Resource | Stockpile | Monthly Net | Runway / Burn |`);
  lines.push(`| :--- | :--- | :--- | :--- |`);

  for (const [name, stockVal, netVal] of resourceEntries) {
    const stockStr = isMeasured(stockVal) ? Number(stockVal).toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'UNAVAILABLE';
    const netNum = Number(netVal);
    const netStr = isMeasured(netVal) ? `${netNum >= 0 ? '+' : ''}${netNum.toFixed(1)}/mo` : 'UNAVAILABLE';

    let runway = 'Stable / Growing';
    if (isMeasured(stockVal) && isMeasured(netVal) && netNum < 0) {
      const months = Math.max(0, Math.floor(Number(stockVal) / Math.abs(netNum)));
      runway = `⚠️ Deficit: ${months} mo runway`;
    } else if (!isMeasured(stockVal) || !isMeasured(netVal)) {
      runway = 'UNKNOWN';
    }

    lines.push(`| **${name}** | ${stockStr} | ${netStr} | ${runway} |`);
  }
  lines.push(``);

  // -------------------------------------------------------------------------
  // SECTION 8: ACTIVE RESEARCH & PROJECTS
  // -------------------------------------------------------------------------
  lines.push(`## 8. Active Research & Technology Projects`);
  lines.push(``);

  lines.push(`### Global Research Slots`);
  const globalSlots = asArray(filteredSnapshot.globalResearch?.activeSlots);
  if (globalSlots.length === 0) {
    lines.push(`*No global research slots tracked.*`);
  } else {
    for (const slot of globalSlots) {
      const pct = isMeasured(slot.percent) ? `${slot.percent}%` : 'UNKNOWN%';
      lines.push(`- **Slot ${slot.slotNumber ?? '•'}: ${slot.displayName || slot.techId}** — ${pct} (${localeOr(slot.accumulatedResearch)} / ${localeOr(slot.totalCost)} RP) | Leading: ${slot.leadFactionName || 'Unknown'} (${localeOr(slot.leadContribution)})`);
    }
  }
  lines.push(``);

  lines.push(`### Observer Projects (${observerName})`);
  const currentProjects = asArray(observer?.currentProjects);
  if (currentProjects.length === 0) {
    lines.push(`*No faction engineering projects currently active.*`);
  } else {
    for (const cp of currentProjects) {
      const pct = isMeasured(cp.percent) ? `${cp.percent}%` : 'UNKNOWN%';
      const cost = isMeasured(cp.totalCost) ? localeOr(cp.totalCost) : 'UNKNOWN';
      lines.push(`- **${cp.displayName || cp.projectId}** — ${pct} (${localeOr(cp.accumulatedResearch)} / ${cost} RP)`);
    }
  }
  lines.push(``);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. /latest-snapshot.md  (~14 KB, Macro State - Byte-Identical with exportGenerator)
// ---------------------------------------------------------------------------

export function renderCompactSnapshotMarkdown(filteredData) {
  const meta = filteredData.metadata;
  const observer = resolveObserverFaction(filteredData.factions, filteredData.observerFactionId, {
    fallbackToFirst: true
  });
  const isPlayer = filteredData.mode === 'player';

  const lines = [];
  lines.push(`# TI Strategic Snapshot`);
  lines.push(``);
  lines.push(`**Date:** ${meta.gameTimeString || 'Unknown'}`);
  lines.push(`**Observer Faction:** ${observer?.displayName || INITIATIVE_DISPLAY_NAME}`);
  lines.push(`**Intelligence Mode:** ${filteredData.mode.toUpperCase()}`);

  const hateInfo = observer?.alienHate;
  if (hateInfo) {
    if (hateInfo.visibility === 'unavailable') {
      lines.push(`**Assessed Alien Threat:** UNAVAILABLE (Requires Alien Operations research)`);
    } else if (hateInfo.visibility === 'estimated') {
      lines.push(`**Assessed Alien Threat:** ${hateInfo.visibleEstimate} (Game-visible estimate)`);
    } else {
      // `!== null` alone let an *undefined* actual through to .toFixed and
      // threw. Probe for a finite number, and fall back to whatever visible
      // estimate exists rather than crashing the whole export.
      lines.push(`**Alien Hate (Raw Save):** ${isMeasured(hateInfo.actual)
        ? Number(hateInfo.actual).toFixed(2)
        : (hateInfo.visibleEstimate || 'UNAVAILABLE')}`);
    }
  }
  lines.push(``);

  const economics = filteredData.alienHateEconomics;
  if (economics) {
    lines.push(`## Alien Hate Economics`);
    if (!economics.applicable) {
      lines.push(`- **Minimum-hate floor:** NOT APPLICABLE to ${observer?.displayName || 'this faction'}.`);
    } else {
      const actualHate = isMeasured(economics.actualAlienHate)
        ? Number(economics.actualAlienHate).toFixed(2)
        : economics.visibleHateEstimate || 'UNAVAILABLE';
      const actualLabel = isMeasured(economics.actualAlienHate)
        ? 'Raw-save actual hate'
        : economics.visibleHateEstimate
          ? 'Game-visible hate estimate'
          : 'Actual hate';
      lines.push(`- **${actualLabel}:** ${actualHate}`);
      lines.push(`- **Minimum hate floor:** ${fixedOr(economics.minimumAlienHate, 2)}`);
      lines.push(`- **Hate above floor:** ${fixedOr(economics.hateAboveFloor, 2)}`);
      lines.push(`- **War threshold:** ${fixedOr(economics.warThreshold, 2)}`);
      lines.push(`- **Minimum-hate headroom:** ${fixedOr(economics.minimumHateHeadroom, 2)}`);
      lines.push(`- **Mission Control used:** ${fixedOr(economics.usedMissionControl, 0)}`);
      lines.push(`- **Mission Control capacity:** ${fixedOr(economics.missionControlCapacity, 0)} (context only; capacity does not affect hate)`);
      lines.push(`- **MC threshold for a 50-hate floor:** ${fixedOr(economics.mcWarFloor, 1)} used MC`);
      lines.push(`- **Minimum floor status:** ${economics.minimumFloorStatus}`);
      lines.push(`- **Current hate status:** ${economics.currentWarStatus}`);
      lines.push(`- **Calculation:** \`${economics.formula?.text || 'UNAVAILABLE'}\``);
      for (const project of economics.reductionProjects || []) {
        if (!project.applicable) continue;
        lines.push(`- **${project.label}:** ${project.completed ? 'COMPLETED (×0.80)' : 'NOT COMPLETED'}`);
      }
    }
    lines.push(``);
  }

  // 1. Faction Balance
  lines.push(`## Faction Balance`);
  lines.push(``);
  for (const f of filteredData.factions) {
    // GDP gets the same treatment as research on the next line: an
    // unmeasured economy printed "$0.0T", which reads as a collapsed state
    // rather than an unknown one.
    const gdpT = isMeasured(f.totalGdp)
      ? `$${(Number(f.totalGdp) / ONE_TRILLION).toFixed(1)}T GDP`
      : 'UNAVAILABLE GDP';
    // Research output can legitimately be unmeasured. Printing "0.0k" for a
    // null reads as a faction with no research programme at all.
    const research = typeof f.totalResearch === 'number' && Number.isFinite(f.totalResearch)
      ? `${(f.totalResearch / 1e3).toFixed(1)}k Research/mo`
      : 'UNAVAILABLE Research/mo';
    const score = isMeasured(f.powerScore?.overall) ? `${f.powerScore.overall}/100` : 'UNKNOWN';
    const fleetPower = f.combatPowerAvailable ? f.combatPower : 'UNAVAILABLE';
    lines.push(`- **${f.displayName}**: ${f.controlPointsCount} CPs | ${gdpT} | ${f.habsCount ?? 'UNKNOWN'} Habs | ${f.shipsCount ?? 'UNKNOWN'} Ships (${fleetPower} Fleet Power) | ${research} | Dashboard Power Estimate: ${score}`);
  }
  lines.push(``);

  // 2. Strategic Servant / Hostile Holdings
  const priorityFactionName = filteredData.priorityTargetFaction?.name || SERVANTS_DISPLAY_NAME;
  lines.push(`## Strategic Enemy Holdings (Priority Targets: ${priorityFactionName})`);
  lines.push(``);
  const topTargets = (filteredData.servantTargets || []).slice(0, 8);
  if (topTargets.length > 0) {
    for (const t of topTargets) {
      const targetCPs = t.targetCPCount ?? t.servantCPCount ?? 0;
      const targetGdp = isMeasured(t.gdpTrillion) ? `$${t.gdpTrillion}T GDP` : 'GDP UNAVAILABLE';
      lines.push(`- **${t.nationName}** (Target Score: ${t.score}/100) — ${targetGdp}, ${targetCPs}/${t.totalCPCount} ${t.targetFactionName || priorityFactionName} CPs${t.nukes > 0 ? `, ${t.nukes} Nukes` : ''} [${t.reasons.join('; ')}]`);
    }
  } else {
    lines.push(`- No major hostile holdings currently identified.`);
  }
  lines.push(``);

  // 3. Technology
  lines.push(`## Technology`);
  lines.push(``);
  lines.push(`### Global Research Slots:`);
  for (const slot of filteredData.globalResearch.activeSlots) {
    // An unresolved tech template leaves totalCost -- and therefore percent
    // -- genuinely unknown. Say so instead of printing "null%" or throwing
    // on .toLocaleString().
    const pct = isMeasured(slot.percent) ? `${slot.percent}%` : 'UNKNOWN%';
    lines.push(`- **Slot ${slot.slotNumber}: ${slot.displayName}** — ${pct} (${localeOr(slot.accumulatedResearch)} / ${localeOr(slot.totalCost)}) | Leading: ${slot.leadFactionName} (${localeOr(slot.leadContribution)})`);
  }
  lines.push(``);

  lines.push(`### Observer Projects (${observer?.displayName}):`);
  if (observer?.currentProjects?.length > 0) {
    for (const cp of observer.currentProjects) {
      const pct = isMeasured(cp.percent) ? `${cp.percent}%` : 'UNKNOWN%';
      const cost = isMeasured(cp.totalCost) ? cp.totalCost : 'UNKNOWN';
      lines.push(`- Researching: **${cp.displayName}** (${pct} - ${cp.accumulatedResearch}/${cost})`);
    }
  } else {
    lines.push(`- No active faction project research tracked.`);
  }
  lines.push(``);

  // 4. Alien Intelligence
  lines.push(`## Alien Intelligence`);
  lines.push(``);
  const alienStage = filteredData.alienIntelligenceStage;
  if (alienStage) {
    lines.push(`- **Abductions Detection:** ${alienStage.abductions.status}`);
    lines.push(`- **Alien Contacts Detection:** ${alienStage.contacts.status}`);
    lines.push(`- **Alien Operations Tracking:** ${alienStage.operations.status}`);
    const detected = alienStage.operatives.active ? (alienStage.operatives.detectedCount ?? 0) : 'UNAVAILABLE';
    lines.push(`- **Direct Operative Detection (Alien Movements):** ${alienStage.operatives.status} (${detected} detected)`);
  }

  const alienCouncilors = filteredData.councilors.filter(c => c.isAlien);
  if (alienCouncilors.length > 0) {
    lines.push(`\n**Detected Alien Operatives:**`);
    for (const ac of alienCouncilors) {
      lines.push(`- **${ac.displayName}** | Location: ${ac.locationName} | Status: ${ac.status}`);
    }
  } else {
    lines.push(`\n*No alien councilors currently detected.*`);
  }
  lines.push(``);

  // 5. Space Balance & Fleets
  lines.push(`## Space Balance & Fleets`);
  lines.push(``);
  const bodyFleets = new Map();
  for (const fl of filteredData.fleets) {
    const b = fl.orbitBody || 'Deep Space';
    if (!bodyFleets.has(b)) bodyFleets.set(b, []);
    bodyFleets.get(b).push(fl);
  }

  for (const [body, flList] of bodyFleets.entries()) {
    const summary = [];
    const fMap = new Map();
    for (const fl of flList) {
      if (!fMap.has(fl.factionName)) {
        fMap.set(fl.factionName, { ships: 0, shipsUnknown: false, power: 0, powerKnown: false, powerUnknown: false });
      }
      const obj = fMap.get(fl.factionName);
      // A fleet whose ship count or combat power the save omits is counted
      // as unknown rather than silently added as zero, so a partial total is
      // never presented as a complete one.
      if (Number.isFinite(fl.shipsCount)) obj.ships += fl.shipsCount; else obj.shipsUnknown = true;
      if (Number.isFinite(fl.combatPower)) { obj.power += fl.combatPower; obj.powerKnown = true; } else obj.powerUnknown = true;
    }
    for (const [fname, st] of fMap.entries()) {
      const loadouts = flList.filter(fl => fl.factionName === fname && fl.weaponSummary).map(fl => fl.weaponSummary);
      // A measured zero is reported as 0; only a genuinely absent reading is
      // called unavailable, and a partly-measured total says so.
      const powerLabel = st.powerKnown
        ? (st.powerUnknown ? `${st.power}+ (partial)` : st.power)
        : 'unavailable';
      const shipLabel = st.shipsUnknown ? `${st.ships}+ (partial)` : st.ships;
      summary.push(`${fname}: ${shipLabel} ships (${powerLabel} power${loadouts.length ? `; ${loadouts.join(', ')}` : ''})`);
    }
    lines.push(`- **${body}**: ${summary.join(' | ')}`);
  }

  return lines.join('\n');
}

export function renderFullMarkdownReport(filteredData) {
  const compact = renderCompactSnapshotMarkdown(filteredData);
  const lines = [compact, ''];

  lines.push(`---`);
  lines.push(`## Full Tech Matrix Snapshot`);
  lines.push(``);
  lines.push(`| Project | ${filteredData.factions.map(f => f.displayName.replace('the ', '')).join(' | ')} |`);
  lines.push(`| :--- | ${filteredData.factions.map(() => ':---:').join(' | ')} |`);

  for (const row of filteredData.techMatrix) {
    const cols = [row.displayName];
    for (const f of filteredData.factions) {
      const st = row.factions[f.ID]?.status || 'unknown';
      let badge = '—';
      if (st === 'completed') badge = '✓';
      else if (st === 'researching') badge = '◐';
      else if (st === 'available') badge = '○';
      else if (st === 'unknown') badge = '?';
      cols.push(badge);
    }
    lines.push(`| ${cols.join(' | ')} |`);
  }

  return lines.join('\n');
}

export default {
  renderThreatsMarkdown,
  renderWarRoomMarkdown,
  renderCompactSnapshotMarkdown,
  renderFullMarkdownReport,
  buildDesignLookup,
  buildHabModuleAggregates,
  evaluateHostileRelevance,
  extractWeaponAndPdSummary,
  formatFleetDesignRollup
};
