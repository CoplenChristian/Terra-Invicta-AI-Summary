// shared/munitionDelivery.mjs
//
// Phase 5 of the research advisor: DOES THE ROUND ARRIVE?
//
// Phase 2 prices a warhead. It never asks whether the warhead gets there, and
// on the live save that omission produces the loudest number in the whole
// endpoint: `AntimatterTorpedoLauncher` ranks at 6,687,502.98x a
// `CopperheadMissileBay` on sustained output per hardpoint. That figure is
// real. It is also a DAMAGE figure, and damage the point defence removes in
// flight is damage that never lands.
//
// So this module adds a delivery axis for the munitions the game itself marks
// `isPointDefenseTargetable`, reported BESIDE the damage axes and never blended
// into them, plus a delivery FLOOR that stops a munition leading a ranking on
// damage when its delivery is measurably worse than what the observer already
// fields. That is the direct analogue of phase 1 ranking warships on combat
// acceleration with delta-V as a floor: the primary axis decides the outcome,
// the floor decides whether the outcome happens at all.
//
// ---------------------------------------------------------------------------
// THE FINDING, AND THE DIRECTION OF THE SURPRISE
// ---------------------------------------------------------------------------
//
// Measured 2026-08-21 against the installed 1.0 templates and the live save's
// 656 non-observer hulls:
//
//                              launch  flight  terminal  rounds  PD shots  shots per
//                              range   time    speed     per     per       ARRIVING
//                              (km)    (s)     (km/s)    salvo   salvo     round
//   CopperheadMissileBay        800    230.6     3.68       8      31.55      3.943
//   AntimatterTorpedoLauncher  1000    206.7     9.79       1      14.28     14.278
//   HeavyRailCannonMk3          900    126.3     7.125      1      16.25     16.249
//
// The torpedo is FASTER, not slower: 206.7 s to cross 1,000 km against the
// Copperhead's 230.6 s to cross 800, and its terminal speed is 2.66x higher,
// because the Copperhead burns out after ~23 s and coasts 762 km at 3.68 km/s
// while the torpedo is still under thrust when it arrives. Every kinematic
// axis favours the torpedo.
//
// What sinks it is SATURATION. A Copperhead bay throws eight rounds per firing
// cycle and a torpedo launcher throws one, so the same defensive fire is split
// eight ways for the Copperhead and lands entirely on the torpedo -- 3.62x as
// much point-defence fire per arriving round (14.278 / 3.943). The trade is not
// speed against damage; it is concentration against dispersion, and nothing in
// phase 2's axes could have shown it.
//
// ---------------------------------------------------------------------------
// WHAT IS PINNED, AND WHAT IS MODELLED
// ---------------------------------------------------------------------------
//
// Two pins license the flight model, and both reproduce a figure the game
// itself publishes for 57 of 57 missile templates (within 0.5%, which is the
// templates' own rounding):
//
//   acceleration_g == "Rocket Thrust" / ammoMass_kg / 9.80665
//   deltaV_kps     == EV_kps * ln(ammoMass_kg / (ammoMass_kg - fuelMass_kg))
//
// plus `ammoMass_kg == fuelMass_kg + systemMass_kg + warheadMass_kg` exactly,
// also 57 of 57. Together they establish that `acceleration_g` is thrust at
// LAUNCH mass and that `deltaV_kps` is the round's own delta-V budget -- which
// is what makes "accelerate at the stated g until the budget runs out, then
// coast" the right shape for the flight rather than a guess.
//
// The pin INPUTS are not carried in the payload. They are asserted in
// `tests/munitionDelivery.test.js` against the installed templates, exactly as
// the 515-design mount pin is, because their job is to justify the model once
// rather than to travel with every request.
//
// EVERYTHING BUILT ON TOP OF THE PINS IS MODELLED and carries
// `validatedAgainstGameOutput: false`. The game publishes no flight time, no
// terminal speed and no interception figure, so there is nothing to check the
// envelope or the saturation division against. And there is deliberately NO HIT
// PROBABILITY here -- no percentage, no survival odds, no "effectiveness
// score". Those would be a confident number resting on an unverified model,
// which is the one thing section 7 of the spec forbids outright. The measurable
// quantities are reported and the reader draws the conclusion.
//
// Plain ESM, no Node built-ins, and it imports ONLY from `./util.mjs` -- not
// from `./militaryValue.mjs`, so the dependency stays one-directional and
// phase 2 consumes phase 5 rather than the two importing each other.

import { asArray, round, toFiniteNumber as toFinite } from './util.mjs';

/** Standard gravity, the constant `acceleration_g` is quoted against. */
const G0 = 9.80665;

/** How many bisection steps resolve a flight time that ends inside the burn. */
const BISECTION_STEPS = 200;

// ---------------------------------------------------------------------------
// FORMULAE
// ---------------------------------------------------------------------------

/**
 * Every formula this module applies, in the wording the API reports, each with
 * what substantiates it. Same shape and same contract as `MILITARY_FORMULAE`:
 * section 7 requires a derived metric to state its formula, and a claim that
 * cannot be traced is not usable.
 */
export const DELIVERY_FORMULAE = Object.freeze({
  accelerationPin: Object.freeze({
    formula: 'acceleration_g = "Rocket Thrust" / ammoMass_kg / 9.80665',
    basis: 'PIN. Reproduces the template\'s own `acceleration_g` for 57 of 57 missiles within 0.5%, '
      + 'which is the templates\' own rounding (measured 2026-08-21 against the installed 1.0 '
      + 'templates). Because the divisor is the FULL round mass rather than the burnout mass, this '
      + 'establishes that the stated acceleration is thrust at LAUNCH mass -- which is what licenses '
      + 'holding it constant through the flight and treating the result as a bound rather than a '
      + 'guess. Asserted in the tests against the installed templates; its inputs are not baked into '
      + 'the payload.',
    validatedAgainstGameOutput: true
  }),
  deltaVPin: Object.freeze({
    formula: 'deltaV_kps = EV_kps * ln(ammoMass_kg / (ammoMass_kg - fuelMass_kg))',
    basis: 'PIN. The rocket equation over the round\'s own propellant fraction. Reproduces the '
      + 'template\'s own `deltaV_kps` for 57 of 57 missiles within 0.5%, and '
      + '`ammoMass_kg == fuelMass_kg + systemMass_kg + warheadMass_kg` holds EXACTLY for 57 of 57 '
      + '(measured 2026-08-21). This establishes that `deltaV_kps` is the munition\'s own delta-V '
      + 'budget rather than a launch speed, which is what makes burnout a real event in the flight.',
    validatedAgainstGameOutput: true
  }),
  flightProfile: Object.freeze({
    formula: 'ramp 0<=t<=r: v = a*t^2/(2r), x = a*t^3/(6r); powered t>r: v = vRamp + a*(t-r), '
      + 'x = xRamp + vRamp*(t-r) + a*(t-r)^2/2; coast t>tBurn: v = deltaV constant. '
      + 'a = acceleration_g * 9.80665, r = thrustRamp_s, vRamp = a*r/2, xRamp = a*r^2/6, '
      + 'tBurn = sqrt(2*r*deltaV/a) when deltaV < vRamp, else r + (deltaV - vRamp)/a',
    basis: 'MODELLED. Three stated assumptions, none of which the templates confirm. (1) '
      + 'Acceleration is held at the stated LAUNCH-mass value; the real value rises as propellant '
      + 'burns, so `flightTimeS` is an UPPER bound and `terminalSpeedKps` a LOWER one. Both munitions '
      + 'in any comparison are measured under the identical assumption, so the ORDERING is unaffected '
      + 'even though the absolute figures are bounds. (2) The target is treated as stationary and the '
      + 'launching hull as at rest -- the templates state no engagement geometry at all. (3) The '
      + 'thrust ramp is read as linear from zero over `thrustRamp_s`; the templates do not state the '
      + 'ramp shape.',
    validatedAgainstGameOutput: false
  }),
  flightTime: Object.freeze({
    formula: 'flightTimeS = the t at which x(t) = targetingRange_km * 1000',
    basis: 'MODELLED. Solved in closed form past burnout, where the round coasts at constant speed, '
      + 'and by 200 deterministic bisection steps when the range is reached while still under thrust. '
      + 'Deterministic: the same stats always yield the same time, which section 7 requires.',
    validatedAgainstGameOutput: false
  }),
  constantVelocityFlight: Object.freeze({
    formula: 'flightTimeS = targetingRange_km * 1000 / (muzzleVelocity_kps * 1000); '
      + 'terminalSpeedKps = meanClosingSpeedKps = muzzleVelocity_kps',
    basis: 'An unguided slug neither accelerates nor manoeuvres. The 70 magnetic guns and the 4 '
      + 'point-defence-targetable guns carry a muzzle velocity and no acceleration, no delta-V and no '
      + 'rotation fields whatsoever -- that is a FACT about a slug, not a missing measurement, and it '
      + 'is reported with its own reason code rather than as an unmeasured null.',
    validatedAgainstGameOutput: false
  }),
  pointDefenseEnvelope: Object.freeze({
    formula: 'envelopeDepthM(type) = min(pdTargetingRange_km * 1000, launchRange_m); '
      + 'envelopeSeconds(type) = flightTimeS - timeToCover(launchRange_m - envelopeDepthM(type))',
    basis: 'MODELLED. A round is only shootable once it is inside that defending weapon\'s own reach, '
      + 'and never before it is launched -- which is what the `min` enforces: a 1,000 km point-defence '
      + 'laser cannot start engaging a round fired from 800 km before the round exists. The headline '
      + '`envelopeSeconds` uses the OUTERMOST observable point-defence range, so it is the total time '
      + 'the round spends under any fire at all.',
    validatedAgainstGameOutput: false
  }),
  pointDefenseSaturation: Object.freeze({
    formula: 'shotsFromType = mountsPerHull(type) * envelopeSeconds(type) / cycleSeconds(type); '
      + 'shotsPerSalvo = sum over types; shotsPerArrivingRound = shotsPerSalvo / roundsPerSalvo',
    basis: 'MODELLED, and this is the axis the floor is built on. It assumes a defending battery '
      + 'distributes its fire EVENLY across the rounds that are in the envelope together, and that a '
      + 'salvo launched at `intraSalvoCooldown_s` spacing arrives essentially together -- 1 s x 8 = 7 s '
      + 'of launch spread against a ~95 s shared envelope on the live save. `roundsPerSalvo` is the '
      + 'template\'s own `salvo_shots` where it states one and 1 otherwise, flagged as an assumption '
      + 'exactly as `shotsPerCycleAssumed` already is. `cycleSeconds` is phase 2\'s own firing-cycle '
      + 'figure, passed in rather than derived a second time. `mountsPerHull` is a MEAN over the hulls '
      + 'read in the profile, not a figure for any one hull.',
    validatedAgainstGameOutput: false
  }),
  agility: Object.freeze({
    formula: 'rampAngle = rotation_degps * turnRamp_s / 2; maneuverSlewTimeS = '
      + 'sqrt(2 * maneuver_angle * turnRamp_s / rotation_degps) when maneuver_angle <= rampAngle, '
      + 'else turnRamp_s / 2 + maneuver_angle / rotation_degps; '
      + 'maneuversPerFlight = flightTimeS / maneuverSlewTimeS',
    basis: 'MODELLED, and the INTERPRETATION IS UNVERIFIED. The templates state `rotation_degps`, '
      + '`turnRamp_s` and `maneuver_angle` and never say what `maneuver_angle` bounds -- whether it is '
      + 'a per-manoeuvre limit, a total authority, or something else. The three stated fields are '
      + 'reported verbatim; the derived slew time and manoeuvre count are carried beside them with '
      + 'this caveat attached, and agility is REPORTED ONLY. It is never the floor axis and never '
      + 'reorders anything.',
    validatedAgainstGameOutput: false
  }),
  mountsPerHull: Object.freeze({
    formula: 'mountsPerHull(type) = installations of that point-defence weapon / hulls read in the profile',
    basis: 'A MEAN over observed hulls, not a per-hull figure: one hull may carry six turrets and the '
      + 'next none. Point-defence weapons are identified by the game\'s own `defenseMode` flag -- 121 '
      + 'lasers, 23 particle weapons, 5 guns and 10 magnetic guns carry it, NOT only the 9 dedicated '
      + 'point-defence turrets -- rather than by the `point-defense` weapon ROLE, which additionally '
      + 'requires `attackMode: false` and so would miss every dual-purpose battery that also shoots '
      + 'back at missiles.',
    validatedAgainstGameOutput: false
  })
});

// ---------------------------------------------------------------------------
// AXES
// ---------------------------------------------------------------------------

// Deliberately a local copy of `shared/militaryValue.mjs`'s private helper
// rather than an import: this module must not depend on that one, or the two
// import each other. The DESCRIPTOR SHAPE is identical on purpose, because a
// consumer reads both lists through the same code path.
const axis = (key, label, formulaKey, direction, options = {}) => Object.freeze({
  key,
  label,
  direction,
  formula: DELIVERY_FORMULAE[formulaKey]?.formula ?? options.formula ?? null,
  basis: DELIVERY_FORMULAE[formulaKey]?.basis ?? options.basis ?? 'read verbatim from the template; no derivation',
  validatedAgainstGameOutput: DELIVERY_FORMULAE[formulaKey]?.validatedAgainstGameOutput ?? options.validatedAgainstGameOutput ?? true,
  stated: options.stated === true
});

const statedAxis = (key, label, direction, basis) =>
  axis(key, label, null, direction, { stated: true, formula: null, basis, validatedAgainstGameOutput: true });

/**
 * The delivery axes, reported beside the damage axes and never blended in.
 *
 * `shotsPerArrivingRound` leads because it is the one that answers the
 * question: how much defensive fire does ONE round that reaches the target have
 * to survive on the way in. Everything under it is the working.
 */
export const MUNITION_DELIVERY_AXES = Object.freeze([
  axis('shotsPerArrivingRound', 'point-defence shots absorbed per arriving round', 'pointDefenseSaturation', 'lower'),
  axis('shotsPerSalvo', 'point-defence shots absorbed per salvo', 'pointDefenseSaturation', 'lower'),
  axis('envelopeSeconds', 'seconds under point-defence fire', 'pointDefenseEnvelope', 'lower'),
  axis('flightTimeS', 'flight time to stated range (s)', 'flightTime', 'lower'),
  axis('terminalSpeedKps', 'speed on arrival (km/s)', 'flightProfile', 'higher'),
  axis('meanClosingSpeedKps', 'mean closing speed (km/s)', 'flightProfile', 'higher'),
  axis('accelerationG', 'acceleration at launch mass (g)', 'accelerationPin', 'higher'),
  axis('maneuverSlewTimeS', 'seconds to slew one stated manoeuvre', 'agility', 'lower'),
  axis('maneuversPerFlight', 'stated manoeuvres available over the flight', 'agility', 'higher'),
  statedAxis('rotationDegPerS', 'rotation rate (deg/s)', 'higher', 'the template\'s own `rotation_degps`'),
  statedAxis('maneuverAngleDeg', 'stated manoeuvre angle (deg)', 'higher', 'the template\'s own `maneuver_angle`; the templates do not say what it bounds'),
  statedAxis('launchRangeKm', 'launch range (km)', 'higher', 'the template\'s own `targetingRange_km`')
]);

/**
 * What each `basis` code on a delivery block means, stated once per response.
 *
 * The distinction that matters is between the two `applies: false` cases and a
 * genuine gap. A beam has no delivery axis because nothing can intercept it;
 * an unguided slug has no agility because it does not manoeuvre. Neither is an
 * unmeasured null, and a boolean would erase both.
 */
export const DELIVERY_BASIS_CODES = Object.freeze({
  accelerating: 'a guided, accelerating round: it burns at the stated launch-mass acceleration until its own delta-V budget is spent, then coasts. Flight time, terminal speed and agility are all modelled from stated template fields.',
  'constant-velocity': 'an unguided slug fired at a stated muzzle velocity: constant speed, no burnout, and no rotation fields in the template at all, because it does not manoeuvre.',
  'not-point-defence-targetable': 'the game does not mark this weapon `isPointDefenseTargetable`, so nothing can intercept it in flight and it has no delivery axis. Beams -- 125 lasers, 33 particle weapons, 16 plasma weapons -- are all in this state.',
  unmeasured: 'the template states no flight inputs for a round the game DOES mark interceptable, so its flight cannot be modelled. Reported as null and never as zero, which would read as an instantaneous, unstoppable arrival.'
});

// ---------------------------------------------------------------------------
// POINT-DEFENCE PROFILE
// ---------------------------------------------------------------------------

/**
 * The defensive battery a munition has to fly through, as a mean over the hulls
 * that were actually read.
 *
 * `mounts` are `{ id, displayName, installations, engagementRangeKm,
 * cycleSeconds }`. The cycle time is phase 2's own `weaponMetrics(...)
 * .cycleSeconds` and is passed in rather than derived here, so there is exactly
 * one firing-cycle model in the repo.
 *
 * `hullsRead === 0` yields `available: false` with the reason, NEVER a
 * `mountsPerHull` of zero: a zero would say "these hulls carry no point
 * defence", which is a measurement, when the truth is that no hull was read at
 * all. That distinction is the whole of §0's turn-1 requirement.
 */
export function buildPointDefenseProfile({
  key = null,
  mounts = [],
  hullsRead = null,
  factions = [],
  basis = null
} = {}) {
  const hulls = toFinite(hullsRead);
  const rows = asArray(mounts)
    .map(mount => {
      const installations = toFinite(mount?.installations);
      return {
        id: mount?.id ?? null,
        displayName: mount?.displayName || mount?.id || null,
        installations,
        // Absent stays null. A mount with no hull count behind it has no
        // meaningful mean, and 0 would understate the battery.
        mountsPerHull: (installations === null || hulls === null || !(hulls > 0))
          ? null
          : round(installations / hulls, 8),
        engagementRangeKm: toFinite(mount?.engagementRangeKm),
        cycleSeconds: toFinite(mount?.cycleSeconds),
        // Which of the three inputs is missing, so a weapon that contributes
        // nothing says why rather than silently vanishing from the sum.
        unusableReason: toFinite(mount?.engagementRangeKm) === null
          ? 'the template states no targeting range for this defensive weapon, so its engagement envelope is unmeasured'
          : (toFinite(mount?.cycleSeconds) === null || !(toFinite(mount?.cycleSeconds) > 0)
            ? 'this defensive weapon has no measurable firing cycle, so its rate of fire is unmeasured'
            : null)
      };
    })
    .sort((a, b) => (b.installations ?? 0) - (a.installations ?? 0) || String(a.id).localeCompare(String(b.id)));

  const installationTotal = rows.reduce((sum, row) => (row.installations === null ? sum : sum + row.installations), 0);
  const anyInstallations = rows.some(row => row.installations !== null);
  const ranges = rows.map(row => row.engagementRangeKm).filter(value => value !== null);

  const available = hulls !== null && hulls > 0 && rows.length > 0 && anyInstallations;

  return {
    profileKey: key,
    available,
    reason: available
      ? null
      : (hulls === null || !(hulls > 0)
        ? 'no hull was read for this profile in this snapshot, so there is no observable point defence to fly through. This is NOT the same as an undefended target.'
        : 'hulls were read for this profile but none of them carries a weapon the game marks `defenseMode`, so no point-defence battery is observable on them'),
    basis,
    hullsRead: hulls,
    pointDefenseInstallations: anyInstallations ? installationTotal : null,
    distinctWeapons: rows.length,
    meanMountsPerHull: (hulls === null || !(hulls > 0)) ? null : (round(installationTotal / hulls, 6) || 0),
    maxEngagementRangeKm: ranges.length === 0 ? null : Math.max(...ranges),
    factions: asArray(factions),
    weapons: rows
  };
}

// ---------------------------------------------------------------------------
// FLIGHT
// ---------------------------------------------------------------------------

/**
 * The kinematics of one round, or null when the template states no flight
 * inputs at all.
 *
 * Returns a solver rather than only numbers, because the envelope calculation
 * needs `timeToCover(distance)` at several ranges and re-deriving the profile
 * per point-defence type would be the same arithmetic four to twenty-four
 * times over.
 */
function solveFlight({ accelerationG, thrustRampS, deltaVKps, muzzleVelocityKps, targetingRangeKm }) {
  const rangeKm = toFinite(targetingRangeKm);
  if (rangeKm === null || !(rangeKm > 0)) return null;
  const R = rangeKm * 1000;

  const accG = toFinite(accelerationG);
  const dVKps = toFinite(deltaVKps);
  const muzzle = toFinite(muzzleVelocityKps);

  // An unguided slug: constant speed, no burnout, no agility. Reached only when
  // the acceleration or the delta-V is absent, so a template carrying both an
  // acceleration and a muzzle velocity is still read as the guided round it is.
  if (accG === null || dVKps === null) {
    if (muzzle === null || !(muzzle > 0)) return null;
    const v = muzzle * 1000;
    const flightTimeS = R / v;
    return {
      basis: 'constant-velocity',
      launchRangeM: R,
      flightTimeS,
      terminalSpeedKps: muzzle,
      meanClosingSpeedKps: muzzle,
      deltaVLimited: null,
      burnoutTimeS: null,
      burnoutRangeKm: null,
      timeToCover: (distance) => (distance <= 0 ? 0 : distance / v)
    };
  }

  const a = accG * G0;
  const r = toFinite(thrustRampS) ?? 0;
  const dV = dVKps * 1000;
  if (!(a > 0) || !(dV > 0)) return null;

  const vRamp = r > 0 ? (a * r) / 2 : 0;
  const xRamp = r > 0 ? (a * r * r) / 6 : 0;
  // Burnout inside the ramp is possible for a low-delta-V round on a long ramp,
  // and the powered-phase form would put it in the past if it were not checked.
  const burnsInsideRamp = r > 0 && dV < vRamp;
  const tBurn = burnsInsideRamp ? Math.sqrt((2 * r * dV) / a) : r + (dV - vRamp) / a;

  const distanceAt = (t) => {
    if (r > 0 && t <= r) return (a * t * t * t) / (6 * r);
    const u = t - r;
    return xRamp + vRamp * u + (a * u * u) / 2;
  };
  const speedAt = (t) => {
    if (r > 0 && t <= r) return (a * t * t) / (2 * r);
    return vRamp + a * (t - r);
  };

  const xBurn = distanceAt(tBurn);

  const timeToCover = (distance) => {
    if (distance <= 0) return 0;
    // Past burnout the round coasts, so the inverse is exact.
    if (distance >= xBurn) return tBurn + (distance - xBurn) / dV;
    // Inside the burn there is no closed form across the ramp/powered join, so
    // it is bisected. `distanceAt` is strictly increasing on [0, tBurn], and a
    // fixed step count keeps the answer deterministic for a given input --
    // section 7: same snapshot, same ranking.
    let lo = 0;
    let hi = tBurn;
    for (let step = 0; step < BISECTION_STEPS; step += 1) {
      const mid = (lo + hi) / 2;
      if (distanceAt(mid) < distance) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const flightTimeS = timeToCover(R);
  const terminalSpeedMps = flightTimeS >= tBurn ? dV : speedAt(flightTimeS);

  return {
    basis: 'accelerating',
    launchRangeM: R,
    flightTimeS,
    terminalSpeedKps: terminalSpeedMps / 1000,
    meanClosingSpeedKps: (R / 1000) / flightTimeS,
    // The round runs out of propellant before it arrives and coasts the rest of
    // the way. True for the Copperhead (38 km of burn, 762 km of coast), false
    // for the antimatter torpedo, which is still accelerating on impact.
    deltaVLimited: xBurn < R,
    burnoutTimeS: tBurn,
    burnoutRangeKm: xBurn / 1000,
    timeToCover
  };
}

/**
 * Slew time for one stated manoeuvre, and how many fit in the flight.
 *
 * MODELLED and the interpretation is OURS: the templates never say what
 * `maneuver_angle` bounds. Reported beside the three verbatim fields, never
 * ranked, and never the floor.
 */
function buildAgility(stats, flightTimeS) {
  const rotation = toFinite(stats?.rotationDegPerS);
  const turnRamp = toFinite(stats?.turnRampS);
  const angle = toFinite(stats?.maneuverAngleDeg);
  if (rotation === null || turnRamp === null || angle === null || !(rotation > 0)) return null;

  const rampAngle = (rotation * turnRamp) / 2;
  const slew = angle <= rampAngle
    ? Math.sqrt((2 * angle * turnRamp) / rotation)
    : turnRamp / 2 + angle / rotation;

  const flight = toFinite(flightTimeS);
  return {
    rotationDegPerS: rotation,
    turnRampS: turnRamp,
    maneuverAngleDeg: angle,
    maneuverSlewTimeS: round(slew, 4),
    maneuversPerFlight: (flight === null || !(slew > 0)) ? null : round(flight / slew, 3),
    // Carried on every agility block rather than stated once, because this one
    // is an interpretation of a field the templates leave undefined and a
    // reader who sees only the derived pair would not know that.
    interpretationUnverified: true
  };
}

// ---------------------------------------------------------------------------
// DELIVERY
// ---------------------------------------------------------------------------

/**
 * The delivery block for one munition against one point-defence profile.
 *
 * `applies: false` has THREE distinct causes and each carries its own reason,
 * because they are three different facts about the weapon and the repo's rule
 * is three states rather than two:
 *
 *   not point-defence targetable  a beam. Nothing can intercept it, so it has
 *                                 no delivery axis at all. Not a gap.
 *   no kinematic inputs           the game marks it interceptable and the
 *                                 template states neither an acceleration and
 *                                 delta-V nor a muzzle velocity. A real gap.
 *   no targeting range            the launch range the whole model measures
 *                                 against is absent. A different real gap.
 *
 * `profile` may be null -- an observer who can see no hulls at all. That yields
 * `pointDefense: null` with `pointDefenseUnavailableReason` naming what was and
 * was not observable, and NEVER an undefended target with a shot count of zero.
 */
export function munitionDelivery(stats, profile = null) {
  const empty = (reason) => ({
    applies: false,
    reason,
    basis: null,
    launchRangeKm: toFinite(stats?.targetingRangeKm),
    flightTimeS: null,
    terminalSpeedKps: null,
    meanClosingSpeedKps: null,
    accelerationG: toFinite(stats?.accelerationG),
    thrustRampS: toFinite(stats?.thrustRampS),
    deltaVKps: toFinite(stats?.missileDeltaVKps),
    deltaVLimited: null,
    burnoutTimeS: null,
    burnoutRangeKm: null,
    muzzleVelocityKps: toFinite(stats?.muzzleVelocityKps),
    roundsPerSalvo: null,
    roundsPerSalvoAssumed: null,
    agility: null,
    agilityReason: null,
    pointDefense: null,
    pointDefenseUnavailableReason: null
  });

  if (stats?.pointDefenseTargetable !== true) {
    return empty('this weapon is not point-defence targetable, so nothing can intercept it in flight and it has no delivery axis');
  }

  const rangeKm = toFinite(stats?.targetingRangeKm);
  if (rangeKm === null || !(rangeKm > 0)) {
    return empty('the template states no targeting range for this weapon, so there is no launch range to fly and its delivery cannot be modelled');
  }

  const flight = solveFlight({
    accelerationG: stats?.accelerationG,
    thrustRampS: stats?.thrustRampS,
    deltaVKps: stats?.missileDeltaVKps,
    muzzleVelocityKps: stats?.muzzleVelocityKps,
    targetingRangeKm: rangeKm
  });
  if (!flight) {
    return empty('the template states neither an acceleration and delta-V nor a muzzle velocity, so its flight cannot be modelled');
  }

  const salvo = toFinite(stats?.salvoShots);
  const roundsPerSalvo = salvo === null ? 1 : salvo;
  // The template's own `salvo_shots` when it has one; otherwise one round per
  // cycle, which is an ASSUMPTION flagged exactly as `shotsPerCycleAssumed`
  // already is rather than being indistinguishable from a stated 1.
  const roundsPerSalvoAssumed = salvo === null;

  const agility = flight.basis === 'accelerating' ? buildAgility(stats, flight.flightTimeS) : null;
  const agilityReason = agility !== null
    ? null
    : (flight.basis === 'constant-velocity'
      ? 'an unguided slug does not manoeuvre, and its template carries no rotation fields at all. This is a fact about the round, not a missing measurement.'
      : 'this round is guided but its template states no rotation rate, turn ramp or manoeuvre angle, so its agility is unmeasured');

  const pointDefense = buildEngagement(flight, profile, roundsPerSalvo);

  return {
    applies: true,
    reason: null,
    basis: flight.basis,
    launchRangeKm: rangeKm,
    flightTimeS: round(flight.flightTimeS, 4),
    terminalSpeedKps: round(flight.terminalSpeedKps, 6),
    meanClosingSpeedKps: round(flight.meanClosingSpeedKps, 6),
    accelerationG: toFinite(stats?.accelerationG),
    thrustRampS: toFinite(stats?.thrustRampS),
    deltaVKps: toFinite(stats?.missileDeltaVKps),
    deltaVLimited: flight.deltaVLimited,
    burnoutTimeS: round(flight.burnoutTimeS, 4),
    burnoutRangeKm: round(flight.burnoutRangeKm, 4),
    muzzleVelocityKps: toFinite(stats?.muzzleVelocityKps),
    roundsPerSalvo,
    roundsPerSalvoAssumed,
    agility,
    agilityReason,
    pointDefense: pointDefense.block,
    pointDefenseUnavailableReason: pointDefense.reason
  };
}

/** The envelope and saturation figures against one profile, or the reason there are none. */
function buildEngagement(flight, profile, roundsPerSalvo) {
  if (!profile) {
    return {
      block: null,
      reason: 'no point-defence profile was built for this snapshot, so how much defensive fire this '
        + 'round would fly through is unmeasured. That is NOT the same as an undefended target.'
    };
  }
  if (profile.available !== true) {
    return { block: null, reason: profile.reason };
  }

  const R = flight.launchRangeM;
  const usable = asArray(profile.weapons).filter(weapon => weapon.unusableReason === null
    && weapon.mountsPerHull !== null
    && weapon.engagementRangeKm !== null
    && weapon.cycleSeconds !== null
    && weapon.cycleSeconds > 0);

  if (usable.length === 0) {
    return {
      block: null,
      reason: 'point-defence weapons were observed on these hulls, but none of them states both a '
        + 'targeting range and a firing cycle, so no engagement envelope could be measured'
    };
  }

  const byWeapon = [];
  let shotsPerSalvo = 0;
  for (const weapon of usable) {
    // The round is only shootable once inside THIS weapon's reach, and never
    // before it is launched -- which is what the `min` does.
    const depthM = Math.min(weapon.engagementRangeKm * 1000, R);
    const seconds = flight.flightTimeS - flight.timeToCover(R - depthM);
    const shots = (weapon.mountsPerHull * seconds) / weapon.cycleSeconds;
    shotsPerSalvo += shots;
    // Only what is specific to THIS munition. The defending weapon's mount
    // count, engagement range and firing cycle are the same on every row and
    // are stated once in the response's `deliveryEnvironment.profiles[...]
    // .weapons`, keyed by this same id -- inlining them cost 119 KB of pure
    // repetition on a `detail=full` response, which is the same mistake the
    // axis descriptors were already moved out of the class rows to avoid.
    byWeapon.push({
      id: weapon.id,
      envelopeDepthKm: round(depthM / 1000, 3),
      envelopeSecondsInRange: round(seconds, 4),
      shotsPerSalvo: round(shots, 6)
    });
  }
  byWeapon.sort((a, b) => (b.shotsPerSalvo ?? 0) - (a.shotsPerSalvo ?? 0) || String(a.id).localeCompare(String(b.id)));

  // The headline: seconds inside the OUTERMOST observable point-defence reach.
  const outerM = Math.min((profile.maxEngagementRangeKm ?? 0) * 1000, R);
  const envelopeSeconds = flight.flightTimeS - flight.timeToCover(R - outerM);

  return {
    block: {
      profileKey: profile.profileKey ?? null,
      envelopeSeconds: round(envelopeSeconds, 4),
      envelopeDepthKm: round(outerM / 1000, 3),
      shotsPerSalvo: round(shotsPerSalvo, 6),
      // The floor axis. Division by `roundsPerSalvo`, which is >= 1 by
      // construction, so this can never be an unbounded ratio.
      shotsPerArrivingRound: round(shotsPerSalvo / roundsPerSalvo, 6),
      weaponsCounted: byWeapon.length,
      byWeapon
    },
    reason: null
  };
}
