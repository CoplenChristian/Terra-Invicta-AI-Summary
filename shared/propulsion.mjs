// shared/propulsion.mjs
//
// Purpose: the propulsion model — delta-V and acceleration per ship/design,
//   plus what-if refits onto drives the observer has never built.
//
// The propulsion model: delta-V, cruise and combat acceleration, per ship and
// per design, plus what-if refits onto drives the observer has never built.
//
// ---------------------------------------------------------------------------
// THE MODEL, AND HOW IT WAS VERIFIED
// ---------------------------------------------------------------------------
//
//   EV_effective = drive.EV_kps x product(EVMultiplier modules on the design
//                  whose propellant requirement the drive satisfies)
//   deltaV       = EV_effective x ln(wetMass / dryMass)
//   cruiseAccel  = thrust_N / wetMass
//   combatAccel  = thrust_N x drive.thrustCap / wetMass
//
// Checked on 2026-08-21 against the game's own `currentDeltaVKps`,
// `currentMaxDeltaVKps`, `cruiseAccelerationMps2` and `combatAccelerationMps2`
// for every ship in the live save that joins to a design:
//
//   observer (4712)      42 / 42  ships, all four columns, ratio 1.000000
//   all human factions  296 / 297 ships, ratio 1.000000 (the one exception is a
//                       damaged hull whose reported acceleration corresponds to
//                       no mass the save carries; its delta-V still matches)
//   aliens (4717)       delta-V matches 381 / 410; acceleration frequently does
//                       not. Alien hulls carry performance the design record
//                       does not explain, so alien rows are reported with the
//                       disagreement visible rather than with a modelled number
//                       presented as fact.
//
// The `EVMultiplier` term is not optional and is not in the original working
// notes. Without it the model reproduces delta-V for only the factions that
// happen to fly no hydrogen-tankage modules; five utility modules multiply
// effective exhaust velocity by 1.2 / 1.35 / 1.5 / 1.5 / 2.0 and all five
// require hydrogen propellant, so a refit that swaps a hydrogen drive for a
// non-hydrogen one LOSES the multiplier. That is a real and large effect, and
// getting it backwards would overstate a refit's reach by up to 2x.
//
// ---------------------------------------------------------------------------
// WHICH MASS
// ---------------------------------------------------------------------------
//
// The save reports its two families of figure against DIFFERENT masses, which
// is measurable on the three observer ships that are not at full tanks:
//
//   currentDeltaVKps            -> the ship's CURRENT mass
//   currentMaxDeltaVKps         -> the ship at FULL tanks
//   cruise/combatAccelerationMps2 -> the ship at FULL tanks (rated, not current)
//
// Using current mass for acceleration overstates a half-empty ship by up to
// 1.72x on this save. Rated figures are the comparable ones, so refits are
// computed at full tanks.
//
// Full-tank mass is derived from the save, never from a tons-per-tank constant:
// a ship already at full tanks IS its own full-tank mass, and for a partially
// fuelled one the rocket equation is inverted through the measured
// `currentMaxDeltaVKps`. Both paths are measurements. A ship where neither is
// possible reports `null` capacity and no refit, rather than a guess.
//
// Plain ESM, no Node built-ins, no imports outside `shared/` -- the hosted
// worker cannot `require` CommonJS.

import { asArray, round, toFiniteNumber as toFinite } from './util.mjs';

/** Every formula this module applies, in the wording the API reports. */
export const PROPULSION_FORMULAE = Object.freeze({
  effectiveExhaustVelocity:
    'EV_effective_kps = drive.EV_kps * product(module.evMultiplier for each EVMultiplier utility module whose propellant requirement the drive satisfies)',
  deltaV: 'deltaV_kps = EV_effective_kps * ln(wetMassKg / dryMassKg)',
  cruiseAcceleration: 'cruise_m_s2 = drive.thrust_N / wetMassKg',
  combatAcceleration: 'combat_m_s2 = drive.thrust_N * drive.thrustCap / wetMassKg',
  fullTankMassFromMaxDeltaV: 'fullWetMassKg = dryMassKg * exp(currentMaxDeltaVKps / EV_effective_kps)'
});

/**
 * Relative tolerance for calling the model and the save's own figure agreed.
 *
 * 0.5% is far looser than what the model actually achieves on human ships
 * (1e-6). It is deliberately loose so that agreement means "the same
 * calculation", not "the same rounding", and so a genuine divergence has to be
 * a real one before it is reported.
 */
export const MODEL_AGREEMENT_TOLERANCE = 0.005;

/** Kilograms in a tonne. The save quotes ship mass in kg and propellant in t. */
const KG_PER_TONNE = 1000;

/**
 * Effective exhaust velocity for a drive as fitted to a design.
 *
 * Absent stays null: a drive with no `EV_kps` yields `EV_kps: null`, never 0,
 * because `0 * ln(massRatio)` is a finite, confident, wrong zero km/s.
 *
 * Modules whose propellant requirement the drive does not satisfy are recorded
 * under `inapplicableModules` rather than dropped, so a refit can explain why
 * the reach it offers is lower than the tankage on the hull would suggest.
 */
export function effectiveExhaustVelocity(drive, design, propellantModules = {}) {
  const baseEv = toFinite(drive?.EV_kps);
  const applied = [];
  const inapplicable = [];

  for (const entry of asArray(design?.moduleTemplateEntries)) {
    const moduleName = entry?.moduleName;
    if (!moduleName) continue;
    const module = propellantModules?.[moduleName];
    if (!module) continue;
    const multiplier = toFinite(module.evMultiplier);
    const record = {
      id: moduleName,
      displayName: module.displayName || moduleName,
      evMultiplier: multiplier,
      requiresHydrogenPropellant: module.requiresHydrogenPropellant === true
    };
    // The gate is the drive's propellant, so the same module is applicable on
    // one refit and inert on the next. This is the term that makes a
    // high-EV non-hydrogen drive a worse trade than it first appears.
    if (record.requiresHydrogenPropellant && drive?.propellant !== 'Hydrogen') {
      inapplicable.push({ ...record, reason: `requires hydrogen propellant; this drive burns ${drive?.propellant || 'an unrecorded propellant'}` });
      continue;
    }
    if (multiplier === null) {
      inapplicable.push({ ...record, reason: 'module carries no measurable EV multiplier' });
      continue;
    }
    applied.push(record);
  }

  const multiplier = applied.reduce((product, module) => product * module.evMultiplier, 1);
  return {
    baseEvKps: baseEv,
    multiplier: round(multiplier, 4),
    evKps: baseEv === null ? null : round(baseEv * multiplier, 4),
    appliedModules: applied,
    inapplicableModules: inapplicable,
    formula: PROPULSION_FORMULAE.effectiveExhaustVelocity
  };
}

/**
 * The three masses a ship's performance is computed against.
 *
 * `dryMassKg` is measured (current mass less current propellant). `fullWetMassKg`
 * is measured two different ways depending on the ship's fuel state, and the way
 * used is reported in `fullTankBasis` so a caller never has to guess which.
 */
export function resolveShipMass(ship, { evKps = null } = {}) {
  const currentWetMassKg = toFinite(ship?.currentMassKg);
  const propellantTons = toFinite(ship?.propellantTons);
  const currentDeltaVKps = toFinite(ship?.currentDeltaVKps);
  const maxDeltaVKps = toFinite(ship?.currentMaxDeltaVKps);

  if (currentWetMassKg === null || propellantTons === null) {
    return {
      currentWetMassKg,
      propellantKg: propellantTons === null ? null : propellantTons * KG_PER_TONNE,
      dryMassKg: null,
      fullWetMassKg: null,
      fullTankBasis: null,
      measured: false,
      unmeasuredReason: currentWetMassKg === null
        ? 'ship carries no current mass in this snapshot'
        : 'ship carries no propellant load in this snapshot'
    };
  }

  const propellantKg = propellantTons * KG_PER_TONNE;
  const dryMassKg = currentWetMassKg - propellantKg;
  if (!(dryMassKg > 0)) {
    return {
      currentWetMassKg,
      propellantKg,
      dryMassKg: null,
      fullWetMassKg: null,
      fullTankBasis: null,
      measured: false,
      unmeasuredReason: 'propellant load is not less than total mass, so dry mass is not derivable'
    };
  }

  // Path 1 -- the ship is already at full tanks, so its current mass IS the
  // full-tank mass. No inversion, no constant, no assumption.
  const atFullTanks = currentDeltaVKps !== null && maxDeltaVKps !== null &&
    Math.abs(currentDeltaVKps - maxDeltaVKps) <= Math.abs(maxDeltaVKps) * 1e-4;
  if (atFullTanks) {
    return {
      currentWetMassKg,
      propellantKg,
      dryMassKg,
      fullWetMassKg: currentWetMassKg,
      fullTankBasis: 'ship is at full tanks (currentDeltaVKps equals currentMaxDeltaVKps), so current mass is full-tank mass',
      measured: true,
      unmeasuredReason: null
    };
  }

  // Path 2 -- invert the rocket equation through the save's own max delta-V.
  // Still a measurement: every input on the right-hand side is read, not chosen.
  if (maxDeltaVKps !== null && evKps !== null && evKps > 0) {
    const fullWetMassKg = dryMassKg * Math.exp(maxDeltaVKps / evKps);
    if (Number.isFinite(fullWetMassKg) && fullWetMassKg >= currentWetMassKg) {
      return {
        currentWetMassKg,
        propellantKg,
        dryMassKg,
        fullWetMassKg,
        fullTankBasis: PROPULSION_FORMULAE.fullTankMassFromMaxDeltaV,
        measured: true,
        unmeasuredReason: null
      };
    }
  }

  // Neither path available. Current-mass figures still stand; rated ones do not.
  return {
    currentWetMassKg,
    propellantKg,
    dryMassKg,
    fullWetMassKg: null,
    fullTankBasis: null,
    measured: true,
    unmeasuredReason: 'full-tank mass is not derivable: the ship is not at full tanks and its max delta-V or drive exhaust velocity is unmeasured'
  };
}

/** deltaV for a mass pair, or null when any input is unmeasured. */
export const deltaVKps = (evKps, wetMassKg, dryMassKg) => {
  const ev = toFinite(evKps);
  const wet = toFinite(wetMassKg);
  const dry = toFinite(dryMassKg);
  if (ev === null || wet === null || dry === null) return null;
  if (!(dry > 0) || !(wet >= dry)) return null;
  return ev * Math.log(wet / dry);
};

/** thrust / mass, or null when either is unmeasured. */
export const accelerationMps2 = (thrustN, massKg, thrustCap = 1) => {
  const thrust = toFinite(thrustN);
  const mass = toFinite(massKg);
  const cap = toFinite(thrustCap);
  if (thrust === null || mass === null || cap === null || !(mass > 0)) return null;
  return (thrust * cap) / mass;
};

/**
 * `modelled / measured`, plus the verdict.
 *
 * Tri-state on purpose. `agrees: null` means the comparison could not be made,
 * which is NOT the same as a disagreement and must never read as one -- a check
 * that cannot be evaluated says so rather than falling through to "fine".
 */
const compare = (modelled, measured) => {
  const a = toFinite(modelled);
  const b = toFinite(measured);
  if (a === null || b === null || b === 0) {
    return {
      modelled: a === null ? null : round(a, 6),
      measured: b,
      ratio: null,
      agrees: null,
      reason: a === null && b === null
        ? 'neither the model nor the save produced a figure'
        : (a === null ? 'the model could not produce a figure' : 'the save carries no figure to compare against')
    };
  }
  const ratio = a / b;
  return {
    modelled: round(a, 6),
    measured: b,
    ratio: round(ratio, 6),
    agrees: Math.abs(ratio - 1) <= MODEL_AGREEMENT_TOLERANCE,
    reason: null
  };
};

/**
 * Full propulsion record for one ship.
 *
 * Measured figures come straight from the save and are labelled `save`. Modelled
 * figures are computed and labelled `model`. They are kept in separate objects
 * so nothing downstream can present one as the other, and `agreement` reports
 * whether they match on this snapshot.
 *
 * A ship whose design or drive cannot be resolved is returned with
 * `resolved: false` and a reason -- never dropped. In player mode that is the
 * normal case for every faction but the observer: 682 of 698 ships in the live
 * save have no visible design, and their measured performance is still real.
 */
export function shipPropulsion({ ship, design, driveStats = {}, propellantModules = {} } = {}) {
  const measured = {
    source: 'save',
    deltaVKps: toFinite(ship?.currentDeltaVKps),
    maxDeltaVKps: toFinite(ship?.currentMaxDeltaVKps),
    cruiseAccelerationMps2: toFinite(ship?.cruiseAccelerationMps2),
    combatAccelerationMps2: toFinite(ship?.combatAccelerationMps2)
  };

  const base = {
    shipId: ship?.id ?? null,
    shipName: ship?.displayName || null,
    designId: ship?.hullName || null,
    measured
  };

  if (!design) {
    return {
      ...base,
      resolved: false,
      unresolvedReason: ship?.hullName
        ? `design '${ship.hullName}' is not present in this snapshot (enemy designs are redacted in player mode)`
        : 'ship carries no design reference',
      drive: null,
      mass: null,
      modelled: null,
      agreement: null
    };
  }

  const driveId = design.driveName || null;
  const drive = driveId ? driveStats?.[driveId] : null;
  if (!drive) {
    return {
      ...base,
      designId: design.dataName || base.designId,
      resolved: false,
      unresolvedReason: driveId
        ? `drive '${driveId}' is not present in the baked drive stats`
        : 'design names no drive',
      drive: null,
      mass: null,
      modelled: null,
      agreement: null
    };
  }

  const ev = effectiveExhaustVelocity(drive, design, propellantModules);
  const mass = resolveShipMass(ship, { evKps: ev.evKps });

  const modelled = {
    source: 'model',
    deltaVKps: round(deltaVKps(ev.evKps, mass.currentWetMassKg, mass.dryMassKg), 6),
    maxDeltaVKps: round(deltaVKps(ev.evKps, mass.fullWetMassKg, mass.dryMassKg), 6),
    cruiseAccelerationMps2: round(accelerationMps2(drive.thrust_N, mass.fullWetMassKg, 1), 8),
    combatAccelerationMps2: round(accelerationMps2(drive.thrust_N, mass.fullWetMassKg, drive.thrustCap), 8),
    formulae: PROPULSION_FORMULAE
  };

  const agreement = {
    deltaV: compare(modelled.deltaVKps, measured.deltaVKps),
    maxDeltaV: compare(modelled.maxDeltaVKps, measured.maxDeltaVKps),
    cruiseAcceleration: compare(modelled.cruiseAccelerationMps2, measured.cruiseAccelerationMps2),
    combatAcceleration: compare(modelled.combatAccelerationMps2, measured.combatAccelerationMps2)
  };
  const verdicts = Object.values(agreement).map(entry => entry.agrees).filter(value => value !== null);
  agreement.allAgree = verdicts.length === 0 ? null : verdicts.every(Boolean);
  agreement.comparedColumns = verdicts.length;
  agreement.tolerance = MODEL_AGREEMENT_TOLERANCE;

  return {
    ...base,
    designId: design.dataName || base.designId,
    resolved: true,
    unresolvedReason: null,
    drive: {
      id: driveId,
      displayName: drive.displayName || driveId,
      baseEvKps: ev.baseEvKps,
      effectiveEvKps: ev.evKps,
      evMultiplier: ev.multiplier,
      evMultiplierModules: ev.appliedModules,
      inapplicableEvModules: ev.inapplicableModules,
      thrustN: toFinite(drive.thrust_N),
      thrustCap: toFinite(drive.thrustCap),
      propellant: drive.propellant || null,
      classification: drive.driveClassification || null,
      flatMassTons: toFinite(drive.flatMass_tons),
      requiredProjectName: drive.requiredProjectName || null
    },
    mass,
    modelled,
    agreement
  };
}

/**
 * Rated performance for a candidate drive fitted to an existing hull.
 *
 * The refit holds the ship's dry mass and tank capacity constant and swaps only
 * the drive. That is exactly the comparison the game's own rated figures make,
 * and it is why the model can be trusted on drives the observer has never
 * built -- it reproduces the measured figures for the drive they DO fly.
 *
 * Two caveats travel with every row rather than being buried:
 *   - `dryMassCaveat` when the candidate's fixed drive mass differs from the
 *     fitted drive's, since constant dry mass then understates or overstates.
 *   - the EV multiplier is recomputed for the candidate, so a hydrogen-tankage
 *     module that boosts the current drive contributes nothing to a candidate
 *     that burns something else.
 */
export function refitOntoDrive({ baseline, design, candidateDriveId, candidateDrive, propellantModules = {} } = {}) {
  const row = {
    driveId: candidateDriveId || null,
    displayName: candidateDrive?.displayName || candidateDriveId || null,
    classification: candidateDrive?.driveClassification || null,
    propellant: candidateDrive?.propellant || null,
    requiredProjectName: candidateDrive?.requiredProjectName || null,
    disabled: candidateDrive?.disabled === true
  };

  if (!candidateDrive) {
    return { ...row, computable: false, reason: 'candidate drive is not present in the baked drive stats', deltaVKps: null, cruiseAccelerationMps2: null, combatAccelerationMps2: null };
  }
  const dryMassKg = toFinite(baseline?.mass?.dryMassKg);
  const fullWetMassKg = toFinite(baseline?.mass?.fullWetMassKg);
  if (dryMassKg === null || fullWetMassKg === null) {
    return {
      ...row,
      computable: false,
      reason: baseline?.mass?.unmeasuredReason || 'the fitted ship has no measurable dry or full-tank mass, so a refit cannot be evaluated',
      deltaVKps: null,
      cruiseAccelerationMps2: null,
      combatAccelerationMps2: null
    };
  }

  const ev = effectiveExhaustVelocity(candidateDrive, design, propellantModules);
  const fittedFlatMass = toFinite(baseline?.drive?.flatMassTons);
  const candidateFlatMass = toFinite(candidateDrive.flatMass_tons);
  const dryMassCaveat = (fittedFlatMass !== null && candidateFlatMass !== null && fittedFlatMass !== candidateFlatMass)
    ? `constant-dry-mass refit: this drive's fixed mass is ${candidateFlatMass} t against the fitted drive's ${fittedFlatMass} t, so the figures below do not account for the ${round(candidateFlatMass - fittedFlatMass, 2)} t difference`
    : null;

  return {
    ...row,
    computable: true,
    reason: null,
    baseEvKps: ev.baseEvKps,
    effectiveEvKps: ev.evKps,
    evMultiplier: ev.multiplier,
    evMultiplierModules: ev.appliedModules,
    inapplicableEvModules: ev.inapplicableModules,
    thrustN: toFinite(candidateDrive.thrust_N),
    thrustCap: toFinite(candidateDrive.thrustCap),
    deltaVKps: round(deltaVKps(ev.evKps, fullWetMassKg, dryMassKg), 4),
    cruiseAccelerationMps2: round(accelerationMps2(candidateDrive.thrust_N, fullWetMassKg, 1), 8),
    combatAccelerationMps2: round(accelerationMps2(candidateDrive.thrust_N, fullWetMassKg, candidateDrive.thrustCap), 8),
    dryMassCaveat,
    basis: 'rated performance at full tanks, dry mass and tank capacity held at the fitted ship\'s measured values'
  };
}

// ---------------------------------------------------------------------------
// ROLE
// ---------------------------------------------------------------------------
//
// Ranking drives on a single scalar produces actively harmful advice, so the
// ranking metric depends on what the hull is for. Measured on this save:
// refitting a warship from its fitted drive to the highest-EV project whose
// prerequisites are already met multiplies reach by 6.2x and divides combat
// acceleration by 1,300. A best-EV recommender surfaces that first.
//
// The role is therefore INFERRED and always stated. The inference is ours -- a
// judgement call, per the honesty rules -- and is kept separate from the
// design's own `role` tag, which is shipped data and is reported verbatim
// rather than being re-interpreted through a hardcoded list of role names.

export const DESIGN_ROLES = Object.freeze({
  warship: 'warship',
  transport: 'transport',
  unknown: 'unknown'
});

/** The save's own label for a self-defence fitting, in its own wording. */
const POINT_DEFENSE_ROLE = 'Point Defense';

/**
 * Warship or transport, from the design's filled weapon mounts.
 *
 * Armament is the measurable signal: a hull with offensive weapons fitted has to
 * be able to close or disengage, and a hull with none is being asked for reach.
 * A design that cannot be read at all is `unknown` -- never defaulted to either,
 * because the default would silently pick the ranking metric.
 *
 * Point defence does not count. It is a self-protection fitting present on
 * transports too, so counting it would rank every hull that can shoot down a
 * missile by combat acceleration and cost it the reach it exists for. The
 * classification comes from the save's own `weaponLoadout[].role`, which is why
 * a ship is preferred over the design's raw module list when one is available:
 * the design lists module names, and only the loadout says which are defensive.
 *
 * The design's own `role` tag is reported verbatim beside this and is NOT used
 * to decide anything. It is the AI's design intent, not the fitting -- on this
 * save two designs tagged `InnerSystemColonyShip` and `TroopCarrier` carry
 * laser cannon and missile bays. Reporting shipped data and our inference side
 * by side lets a reader see that; folding the tag into the inference would hide
 * it behind a hardcoded list of role names, which §0 forbids anyway.
 */
export function inferDesignRole(design, exemplarShip = null) {
  if (!design) {
    return {
      role: DESIGN_ROLES.unknown,
      basis: 'no design record, so no armament to read',
      offensiveMounts: null,
      pointDefenseMounts: null,
      inferred: true,
      roleTagFromSave: null
    };
  }

  const loadout = asArray(exemplarShip?.weaponLoadout);
  let offensiveMounts = null;
  let pointDefenseMounts = null;
  let basisSource = null;

  if (loadout.length > 0) {
    offensiveMounts = 0;
    pointDefenseMounts = 0;
    for (const group of loadout) {
      const count = toFinite(group?.count) ?? asArray(group?.systems).length;
      if (group?.role === POINT_DEFENSE_ROLE) pointDefenseMounts += count;
      else offensiveMounts += count;
    }
    basisSource = "the fitted ship's weapon loadout, which classifies point defence separately";
  } else {
    // No ship to read. The design's module list has no point-defence marker, so
    // the count is of ALL weapon mounts and the basis says so rather than
    // implying a distinction that was not made.
    const nose = asArray(design.noseWeaponTemplateEntries).filter(entry => entry?.moduleName).length;
    const hull = asArray(design.hullWeaponTemplateEntries).filter(entry => entry?.moduleName).length;
    offensiveMounts = nose + hull;
    basisSource = 'the design\'s fitted weapon mounts; no ship was available to separate point defence from offensive armament';
  }

  return {
    role: offensiveMounts > 0 ? DESIGN_ROLES.warship : DESIGN_ROLES.transport,
    basis: `${offensiveMounts} offensive weapon mount(s), from ${basisSource}`,
    offensiveMounts,
    pointDefenseMounts,
    // Flagged as OUR inference so it is never mistaken for shipped data.
    inferred: true,
    // Shipped data, passed through untouched and uninterpreted.
    roleTagFromSave: design.role || null
  };
}

/**
 * The ranking metric for a role, and the floor the other axis must clear.
 *
 * Never blended into one score: the two axes are in direct tension and the
 * exchange rate between them is not ours to invent.
 */
export const RANKING_BY_ROLE = Object.freeze({
  [DESIGN_ROLES.warship]: Object.freeze({
    rankBy: 'combatAccelerationMps2',
    rankByFormula: PROPULSION_FORMULAE.combatAcceleration,
    floorAxis: 'deltaVKps',
    rationale: 'combat acceleration decides whether an armed hull can close or disengage; delta-V is a floor, not the objective'
  }),
  [DESIGN_ROLES.transport]: Object.freeze({
    rankBy: 'deltaVKps',
    rankByFormula: PROPULSION_FORMULAE.deltaV,
    floorAxis: 'combatAccelerationMps2',
    rationale: 'delta-V is reach, which is what an unarmed hull is for; acceleration is a floor so it can still make transfer windows'
  })
});

/**
 * Orders refit rows by the role's metric, with the other axis as a stated floor.
 *
 * Rows that fall below the floor are RANKED LOWER but still listed and flagged,
 * because "this is faster but you lose the ability to get there" is the finding,
 * not something to hide. Rows the model could not compute sort last and carry
 * their reason; they are never treated as zero.
 */
export function rankRefits(refits, { role, deltaVFloorKps = null, accelerationFloorMps2 = null } = {}) {
  const ranking = RANKING_BY_ROLE[role];
  if (!ranking) {
    return {
      ranked: asArray(refits).map(refit => ({ ...refit, clearsFloor: null, floorReason: 'role is unknown, so no ranking metric applies' })),
      ranking: null
    };
  }
  const floorValue = ranking.floorAxis === 'deltaVKps' ? toFinite(deltaVFloorKps) : toFinite(accelerationFloorMps2);

  const scored = asArray(refits).map(refit => {
    const metric = toFinite(refit[ranking.rankBy]);
    const floorMetric = toFinite(refit[ranking.floorAxis]);
    let clearsFloor = null;
    let floorReason = null;
    if (floorValue === null) {
      floorReason = `no floor could be measured for ${ranking.floorAxis} on this design`;
    } else if (floorMetric === null) {
      floorReason = `${ranking.floorAxis} is not computable for this drive, so the floor cannot be evaluated`;
    } else {
      clearsFloor = floorMetric >= floorValue;
      floorReason = clearsFloor
        ? null
        : `${ranking.floorAxis} falls from ${round(floorValue, 4)} to ${round(floorMetric, 4)}`;
    }
    return { ...refit, rankMetric: ranking.rankBy, rankValue: metric, clearsFloor, floorReason };
  });

  scored.sort((a, b) => {
    // Uncomputable last, always -- an unknown is not a zero and must not be
    // ranked as one.
    const aComputable = a.rankValue !== null;
    const bComputable = b.rankValue !== null;
    if (aComputable !== bComputable) return aComputable ? -1 : 1;
    // Then rows that clear the floor, then by the role's own metric.
    const aClears = a.clearsFloor === false ? 1 : 0;
    const bClears = b.clearsFloor === false ? 1 : 0;
    if (aClears !== bClears) return aClears - bClears;
    if (!aComputable) return String(a.driveId || '').localeCompare(String(b.driveId || ''));
    if (b.rankValue !== a.rankValue) return b.rankValue - a.rankValue;
    return String(a.driveId || '').localeCompare(String(b.driveId || ''));
  });

  return {
    ranked: scored,
    ranking: {
      ...ranking,
      floorAxis: ranking.floorAxis,
      floorValue: round(floorValue, 6),
      floorBasis: floorValue === null
        ? 'not measurable from this design'
        : "the fitted design's own measured rated performance"
    }
  };
}
