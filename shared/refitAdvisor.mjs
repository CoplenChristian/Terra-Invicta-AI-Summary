// shared/refitAdvisor.mjs
//
// Purpose: evaluates validated refit recommendations (drive, weapons, armour) for observer-flown ship designs.
//
// ---------------------------------------------------------------------------
// A VALIDATED REFIT ADVISOR (Part B of docs/fleet-procurement-spec.md)
// ---------------------------------------------------------------------------
//
// Recommends refits against designs the observer faction already flies:
//   1. Drive swap: uses `refitOntoDrive` and `rankRefits` from shared/propulsion.mjs,
//      holding dry mass and tankage at measured values, with `dryMassCaveat` visible.
//   2. Reactor class: checks compatibility (requiredPowerPlant === powerPlantClass || 'Any_General').
//   3. Power: reports plant output vs required draw as information (with thrust-scaling factor),
//      never as a pass/fail veto.
//   4. Weapons: swaps weapons within existing hardpoints costed by `mountCost`.
//   5. Armour: recommends material from specialties[] via `armorMetrics`, weighted by
//      observed alien threat or explicitly marked unweighted.
//   6. Composed mass and heat: explicitly report 'unknown'.
//   7. Non-composability: drive figures assume current weapons and armour; combined swaps
//      render performance as unknown.
//
// Availability rule: strictly completed OR ungated (AVAILABILITY_STATES.ungated).
// Roles: inferred via `inferDesignRole`, never from the save's uninterpreted `role` tag.
// ---------------------------------------------------------------------------

import { asArray, round, toFiniteNumber as toFinite, sameId } from './util.mjs';
import {
  refitOntoDrive,
  rankRefits,
  inferDesignRole,
  DESIGN_ROLES
} from './propulsion.mjs';
import { mountCost } from './militaryValue.mjs';
import { buildItemGateMap } from './unlockIndex.mjs';

/**
 * Checks if a component is available to fit (completed research project OR ungated from game start).
 */
export function isCompletedOrUngated(
  family,
  itemId,
  requiredProjectName,
  completedProjects = new Set(),
  itemGateMap = null,
  projectGating = {}
) {
  // If an itemGateMap is provided and has an entry for this family:itemId, look up gate
  if (family && itemId && itemGateMap && itemGateMap.size > 0) {
    const gate = itemGateMap.get(`${family}:${itemId}`);
    if (!gate) {
      return { available: true, state: 'ungated', reason: null };
    }
    const gateId = gate.gateId;
    const completed = completedProjects instanceof Set
      ? completedProjects.has(gateId)
      : asArray(completedProjects).includes(gateId);

    if (completed) {
      return { available: true, state: 'completed', reason: null };
    }

    const gating = projectGating?.[gateId];
    if (gating?.factionPrereq) {
      return {
        available: false,
        state: 'faction-restricted',
        reason: `Restricted to faction ${gating.factionPrereq}`
      };
    }

    return {
      available: false,
      state: 'unresearched',
      reason: `Requires ${gate.gateKind || 'project'} ${gateId} (not completed)`
    };
  }

  // Fallback to direct requiredProjectName check
  if (!requiredProjectName) {
    return { available: true, state: 'ungated', reason: null };
  }

  const completed = completedProjects instanceof Set
    ? completedProjects.has(requiredProjectName)
    : asArray(completedProjects).includes(requiredProjectName);

  if (completed) {
    return { available: true, state: 'completed', reason: null };
  }

  const gating = projectGating?.[requiredProjectName];
  if (gating?.factionPrereq) {
    return {
      available: false,
      state: 'faction-restricted',
      reason: `Restricted to faction ${gating.factionPrereq}`
    };
  }

  return {
    available: false,
    state: 'unresearched',
    reason: `Requires project ${requiredProjectName} (not completed)`
  };
}

/**
 * Validates drive-to-reactor compatibility.
 * A drive's requiredPowerPlant must equal the reactor's powerPlantClass, or be 'Any_General'.
 */
export function evaluateReactorClass(candidateDrive, powerPlantStats) {
  if (!candidateDrive) {
    return { verdict: 'unknown', reason: 'No candidate drive specified', matchedClass: null };
  }

  const reqClass = candidateDrive.requiredPowerPlant || candidateDrive.ReqPowerPlant || null;
  if (!reqClass) {
    return { verdict: 'unknown', reason: 'Drive does not state a requiredPowerPlant class', matchedClass: null };
  }

  if (reqClass === 'Any_General') {
    return { verdict: 'pass', reason: 'Drive accepts Any_General reactor class', matchedClass: 'Any_General' };
  }

  if (!powerPlantStats || !powerPlantStats.powerPlantClass) {
    return {
      verdict: 'unknown',
      reason: `Drive requires '${reqClass}', but fitted reactor powerPlantClass is unrecorded`,
      matchedClass: null
    };
  }

  const fittedClass = powerPlantStats.powerPlantClass;
  if (reqClass === fittedClass) {
    return {
      verdict: 'pass',
      reason: `Drive required class '${reqClass}' matches fitted reactor class '${fittedClass}'`,
      matchedClass: fittedClass
    };
  }

  return {
    verdict: 'fail',
    reason: `Drive requires reactor class '${reqClass}' but fitted reactor is '${fittedClass}'`,
    matchedClass: fittedClass
  };
}

/**
 * Evaluates the power budget informatively.
 * The game does not veto an underpowered ship — it scales thrust by min(1.0, plantOutput / reqPower).
 */
export function evaluatePowerBudget(candidateDrive, fittedPowerPlant, fittedWeapons = []) {
  const plantOutputGW = toFinite(fittedPowerPlant?.maxOutputGW);
  const driveDrawGW = toFinite(candidateDrive?.reqPowerGW);

  // Calculate beam weapon draw for weapons with shotPowerMJ
  let weaponDrawGW = 0;
  let weaponDrawCount = 0;
  for (const w of fittedWeapons) {
    const shotPower = toFinite(w?.shotPowerMJ);
    const cooldown = toFinite(w?.cooldownS);
    const eff = toFinite(w?.efficiency) ?? 1.0;
    if (shotPower !== null && cooldown !== null && cooldown > 0 && eff > 0) {
      weaponDrawGW += (shotPower / cooldown / eff) / 1000;
      weaponDrawCount++;
    }
  }

  const totalRequiredDrawGW = driveDrawGW !== null ? round(driveDrawGW + weaponDrawGW, 4) : null;
  let thrustScalingFactor = null;
  let summary = null;

  if (plantOutputGW !== null && driveDrawGW !== null) {
    if (driveDrawGW <= 0) {
      thrustScalingFactor = 1.0;
      summary = 'Drive draws zero reactor power (e.g. chemical/nuclear pulse)';
    } else if (plantOutputGW >= driveDrawGW) {
      thrustScalingFactor = 1.0;
      summary = `Plant output (${plantOutputGW} GW) fully covers drive draw (${driveDrawGW} GW)`;
    } else {
      thrustScalingFactor = round(plantOutputGW / driveDrawGW, 4);
      summary = `Under-powered: plant output (${plantOutputGW} GW) covers only ${round(thrustScalingFactor * 100, 1)}% of drive draw (${driveDrawGW} GW). Thrust is scaled to ${thrustScalingFactor}×.`;
    }
  } else {
    summary = 'Power draw or reactor output is unmeasured on this fitting';
  }

  return {
    informational: true,
    plantOutputGW,
    driveDrawGW,
    weaponDrawGW: weaponDrawCount > 0 ? round(weaponDrawGW, 4) : null,
    totalRequiredDrawGW,
    thrustScalingFactor,
    summary
  };
}

/**
 * Checks potential weapon swaps strictly within existing hardpoint mounts.
 */
export function evaluateWeaponUpgrades(
  design,
  componentStats,
  completedProjects,
  itemGateMap,
  projectGating
) {
  const upgrades = [];
  const allWeaponTemplates = [];

  const weaponFamilies = ['laser_weapon', 'magnetic_gun', 'gun', 'particle_weapon', 'plasma_weapon', 'missile'];
  for (const fam of weaponFamilies) {
    const familyMap = componentStats?.[fam] || {};
    for (const [id, stats] of Object.entries(familyMap)) {
      if (stats && !stats.disabled) {
        allWeaponTemplates.push({ id, family: fam, ...stats });
      }
    }
  }

  const hardpointSlots = [
    ...(asArray(design.noseWeaponTemplateEntries).map(entry => ({ side: 'nose', slot: entry.slot, moduleName: entry.moduleName }))),
    ...(asArray(design.hullWeaponTemplateEntries).map(entry => ({ side: 'hull', slot: entry.slot, moduleName: entry.moduleName })))
  ];

  const getWeaponPower = (w) => {
    if (!w) return null;
    if (w.statedDamageMJ != null && Number.isFinite(w.statedDamageMJ)) return w.statedDamageMJ;
    if (w.shotPowerMJ != null && Number.isFinite(w.shotPowerMJ)) return w.shotPowerMJ;
    return null;
  };

  for (const slotEntry of hardpointSlots) {
    const fittedName = slotEntry.moduleName;
    if (!fittedName || fittedName === 'Empty') continue;

    // Find fitted weapon stats
    const fittedStats = allWeaponTemplates.find(w => w.id === fittedName);
    const fittedMount = mountCost(fittedStats?.mount);
    const hardpoints = fittedMount.hardpoints ?? 1;

    // Find available candidates matching slot side and hardpoint budget
    const candidates = allWeaponTemplates.filter(cand => {
      if (cand.id === fittedName) return false;
      const candMount = mountCost(cand.mount);
      if (candMount.side !== slotEntry.side) return false;
      if (candMount.hardpoints === null || candMount.hardpoints > hardpoints) return false;

      const avail = isCompletedOrUngated(
        cand.family,
        cand.id,
        cand.requiredProjectName,
        completedProjects,
        itemGateMap,
        projectGating
      );
      return avail.available;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => (getWeaponPower(b) ?? 0) - (getWeaponPower(a) ?? 0));

      const best = candidates[0];
      const fittedPwr = getWeaponPower(fittedStats);
      const bestPwr = getWeaponPower(best);

      if (bestPwr !== null && (fittedPwr === null || bestPwr > fittedPwr)) {
        upgrades.push({
          slot: slotEntry.side,
          slotIndex: slotEntry.slot,
          fittedWeapon: fittedStats?.displayName || fittedName,
          fittedMount: fittedStats?.mount || null,
          recommendedWeapon: best.displayName || best.id,
          recommendedId: best.id,
          recommendedMount: best.mount,
          hardpointsUsed: mountCost(best.mount).hardpoints,
          hardpointLimit: hardpoints,
          hardpointVerdict: 'pass',
          performanceImpact: 'unknown',
          rationale: fittedPwr !== null
            ? `Replaces ${fittedStats?.displayName || fittedName} (${round(fittedPwr, 1)} MJ) with ${best.displayName || best.id} (${round(bestPwr, 1)} MJ)`
            : `Fitted weapon has no damage stat; ${best.displayName || best.id} offers ${round(bestPwr, 1)} MJ output`
        });
      }
    }
  }

  return upgrades;
}

/**
 * Recommends armour material based on observed alien weapon profile.
 */
export function evaluateArmorRecommendation(
  design,
  componentStats,
  ships,
  completedProjects,
  itemGateMap,
  projectGating,
  factions = []
) {
  const armors = Object.entries(componentStats?.ship_armor || {})
    .filter(([_, stats]) => stats && !stats.disabled)
    .map(([id, stats]) => ({ id, ...stats }));

  const fittableArmors = armors.filter(a => {
    const avail = isCompletedOrUngated(
      'ship_armor',
      a.id,
      a.requiredProjectName,
      completedProjects,
      itemGateMap,
      projectGating
    );
    return avail.available;
  });

  // Identify alien faction
  const alienFaction = asArray(factions).find(f =>
    f.templateName === 'Aliens' || f.templateName === 'AlienCouncil' || f.isAlien || sameId(f.ID || f.id, 4717)
  );
  const alienFactionId = alienFaction?.ID || alienFaction?.id || 4717;

  // Calculate observed threat profile from alien ships
  let alienBeamCount = 0;
  let alienKineticCount = 0;

  for (const ship of asArray(ships)) {
    if (sameId(ship.factionId, alienFactionId) || sameId(ship.fleetFactionId, alienFactionId) || ship.isAlien) {
      for (const weapon of asArray(ship.weaponLoadout)) {
        const category = String(weapon.category || '').toLowerCase();
        const role = String(weapon.role || '').toLowerCase();
        const name = String(weapon.name || weapon.displayName || '').toLowerCase();
        const count = toFinite(weapon.count) ?? 1;

        if (
          category.includes('laser') ||
          category.includes('particle') ||
          category.includes('beam') ||
          role.includes('laser') ||
          role.includes('beam') ||
          name.includes('laser') ||
          name.includes('particle')
        ) {
          alienBeamCount += count;
        } else {
          alienKineticCount += count;
        }
      }
    }
  }

  const totalThreatWeapons = alienBeamCount + alienKineticCount;
  const isWeighted = totalThreatWeapons > 0;
  const xRayWeight = isWeighted ? round(alienBeamCount / totalThreatWeapons, 3) : 0.5;
  const baryonicWeight = isWeighted ? round(alienKineticCount / totalThreatWeapons, 3) : 0.5;

  const scoredArmors = fittableArmors.map(armor => {
    const specialties = asArray(armor.specialties);
    const getSpec = (name) => {
      const hit = specialties.find(s => Array.isArray(s) ? s[0] === name : s.specialty === name);
      return hit ? (Array.isArray(hit) ? toFinite(hit[1]) : toFinite(hit.value)) : null;
    };

    const xRayRes = getSpec('XRayResistance') ?? 1.0;
    const baryonicRes = getSpec('BaryonicResistance') ?? 1.0;
    const score = round(xRayWeight * xRayRes + baryonicWeight * baryonicRes, 3);

    return {
      id: armor.id,
      displayName: armor.displayName || armor.id,
      score,
      xRayResistance: xRayRes,
      baryonicResistance: baryonicRes,
      densityKgM3: toFinite(armor.densityKgM3),
      maxArmorValue: toFinite(armor.maxArmorValue)
    };
  });

  scoredArmors.sort((a, b) => b.score - a.score);
  const best = scoredArmors[0] || null;

  return {
    weighted: isWeighted,
    threatBasis: isWeighted
      ? `Weighted against observed alien fleet weapon mix (${Math.round(xRayWeight * 100)}% energy/X-ray, ${Math.round(baryonicWeight * 100)}% kinetic/baryonic)`
      : 'unweighted (no alien weapon loadout observable in this snapshot)',
    currentArmor: design.noseArmor?.materialName || design.armorTemplateName || null,
    recommendedMaterial: best?.displayName || best?.id || null,
    recommendedMaterialId: best?.id || null,
    xRayResistance: best?.xRayResistance || null,
    baryonicResistance: best?.baryonicResistance || null,
    performanceImpact: 'unknown',
    notes: 'Armour material choice does not alter fittable hull slots; mass changes make overall performance impact unknown.'
  };
}

/**
 * Builds the complete Refit Advisor projection for the observer faction.
 */
export function buildRefitAdvisor(snapshot, options = {}) {
  const {
    observerId = 4712,
    mode = 'player',
    designId = null
  } = options;

  const rawDesigns = asArray(snapshot.designs || snapshot.shipDesigns || asArray(snapshot.factions).flatMap(f => f.shipDesigns || []));
  const designs = rawDesigns.filter(d => {
    const dFaction = d.factionId ?? snapshot.observerFactionId;
    if (d.factionId !== undefined && !sameId(d.factionId, observerId)) return false;
    const dId = d.dataName || d.ID || d.id;
    if (designId && dId !== designId) return false;
    return true;
  });

  const ships = asArray(
    snapshot.ships || asArray(snapshot.fleets).flatMap(fl => (fl.ships || []).map(sh => ({ factionId: fl.factionId, ...sh })))
  );
  const driveStats = snapshot.driveStats || {};
  const componentStats = snapshot.componentStats || {};
  const propellantModules = snapshot.propellantModules || {};
  const itemGateMap = buildItemGateMap(snapshot);

  const observerFaction = asArray(snapshot.factions).find(f => sameId(f.id ?? f.ID, observerId));
  const completedProjects = new Set([
    ...asArray(snapshot.completedProjects),
    ...asArray(observerFaction?.completedProjects),
    ...asArray(snapshot.techTree?.completedProjects)
  ]);
  const projectGating = snapshot.projectGating || {};

  const results = [];

  for (const design of designs) {
    const dId = design.dataName || design.ID || design.id;
    const dName = design._displayName || design.displayName || design.friendlyName || design.name || dId;
    const exemplarShip = ships.find(s => s.designId === dId || s.hullName === dId || s.displayName === dName) || null;
    const roleInfo = inferDesignRole(design, exemplarShip);

    const fittedDriveName = design.driveTemplateName || design.driveName;
    const fittedDrive = driveStats[fittedDriveName] || null;
    const fittedPowerPlantName = design.powerPlantTemplateName || design.powerPlantName;
    const fittedPowerPlant = componentStats?.power_plant?.[fittedPowerPlantName] || null;
    const hullName = design.hullTemplateName || design.hullName;

    // Baseline metrics from fitted ship
    const dryMassKg = toFinite(
      exemplarShip?.dryMassKg ??
      (exemplarShip?.currentMassKg != null && exemplarShip?.propellantTons != null
        ? exemplarShip.currentMassKg - exemplarShip.propellantTons * 1000
        : exemplarShip?.currentMassKg ?? exemplarShip?.massKg)
    );
    const fullWetMassKg = toFinite(exemplarShip?.fullWetMassKg ?? exemplarShip?.currentMassKg ?? exemplarShip?.wetMassKg);

    const baseline = {
      hull: hullName || null,
      drive: {
        driveId: fittedDriveName,
        displayName: fittedDrive?.displayName || fittedDriveName,
        flatMassTons: toFinite(fittedDrive?.flatMass_tons)
      },
      mass: {
        dryMassKg,
        fullWetMassKg
      },
      deltaVKps: toFinite(exemplarShip?.currentMaxDeltaVKps ?? exemplarShip?.currentDeltaVKps),
      combatAccelerationMps2: toFinite(exemplarShip?.combatAccelerationMps2),
      cruiseAccelerationMps2: toFinite(exemplarShip?.cruiseAccelerationMps2)
    };

    // 1. Evaluate Candidate Drive Refits
    const candidateDrives = Object.entries(driveStats)
      .filter(([_, d]) => d && !d.disabled)
      .map(([id, d]) => ({ id, ...d }));

    const fittableDriveRefits = [];
    for (const candDrive of candidateDrives) {
      const avail = isCompletedOrUngated(
        'drive',
        candDrive.id,
        candDrive.requiredProjectName,
        completedProjects,
        itemGateMap,
        projectGating
      );
      if (!avail.available) continue;

      const reactorCheck = evaluateReactorClass(candDrive, fittedPowerPlant);
      if (reactorCheck.verdict === 'fail') continue;

      const powerInfo = evaluatePowerBudget(candDrive, fittedPowerPlant);
      const refit = refitOntoDrive({
        baseline,
        design,
        candidateDriveId: candDrive.id,
        candidateDrive: candDrive,
        propellantModules
      });

      if (refit.computable) {
        fittableDriveRefits.push({
          ...refit,
          reactorClassVerdict: reactorCheck.verdict,
          reactorClassReason: reactorCheck.reason,
          power: powerInfo,
          assumesCurrentFitting: true,
          basisNote: 'Drive ΔV and acceleration figures assume current weapon and armour fitting. Any weapon or armour modification changes dry mass and invalidates these figures.'
        });
      }
    }

    // Rank candidate drives by inferred role
    const rankedDrives = rankRefits(fittableDriveRefits, {
      role: roleInfo.role,
      deltaVFloorKps: baseline.deltaVKps,
      accelerationFloorMps2: baseline.combatAccelerationMps2
    });

    const topDriveRefit = rankedDrives.ranked?.[0] || null;

    // 2. Evaluate Weapon Upgrades
    const weaponUpgrades = evaluateWeaponUpgrades(
      design,
      componentStats,
      completedProjects,
      itemGateMap,
      projectGating
    );

    // 3. Evaluate Armour Recommendation
    const armorRecommendation = evaluateArmorRecommendation(
      design,
      componentStats,
      ships,
      completedProjects,
      itemGateMap,
      projectGating,
      snapshot.factions
    );

    const baselineReactorCheck = evaluateReactorClass(fittedDrive, fittedPowerPlant);

    results.push({
      designId: dId,
      displayName: dName,
      hull: hullName,
      role: roleInfo.role,
      roleBasis: roleInfo.basis,
      roleTagFromSave: roleInfo.roleTagFromSave,
      baseline,
      recommendations: {
        drive: topDriveRefit,
        weapons: weaponUpgrades,
        armor: armorRecommendation
      },
      budgets: {
        hardpoints: {
          verdict: 'pass',
          upgradesCount: weaponUpgrades.length
        },
        reactorClass: {
          verdict: topDriveRefit ? topDriveRefit.reactorClassVerdict : baselineReactorCheck.verdict,
          matchedClass: topDriveRefit ? topDriveRefit.reactorClassReason : baselineReactorCheck.reason
        },
        power: topDriveRefit?.power || evaluatePowerBudget(fittedDrive, fittedPowerPlant),
        composedMass: {
          verdict: 'unknown',
          reason: 'Component-sum mass model is not pinned against fitted ships; mass remains unknown.'
        },
        heat: {
          verdict: 'unknown',
          reason: 'Drive waste heat and radiator surface area models are unpinned.'
        }
      },
      nonComposabilityNotice: 'Drive ΔV and acceleration figures assume current weapon and armour fitting. Combining drive swap with weapon or armour changes yields an unknown mass and unknown performance.'
    });
  }

  return {
    count: results.length,
    items: results,
    observerId,
    mode,
    disclaimer: 'Refit recommendations hold the existing hull and evaluate drive, weapon and armour options. Swaps are not combinable into a single computed mass or performance figure.'
  };
}
