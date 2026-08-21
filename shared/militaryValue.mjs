// shared/militaryValue.mjs
//
// Military valuation for the fourteen unlock families phase 1 did not cover:
// the six weapon families, ship hulls, ship armour, power plants, radiators,
// heat sinks, batteries, utility modules and hab modules.
//
// Phase 1 (`shared/propulsion.mjs`) handled drives and set the shape this
// follows: derived metrics stated beside their formula, compared against what
// the observer ACTUALLY FIELDS rather than an absolute scale, availability read
// from the save's own list through `shared/researchAvailability.mjs`, and the
// research gate resolved through the baked `unlockIndex` rather than a second
// mapping built here.
//
// ---------------------------------------------------------------------------
// NEVER ONE SCORE
// ---------------------------------------------------------------------------
//
// Phase 1's key finding was that a single scalar produces actively harmful
// advice: the highest-EV drive whose prerequisites were already met was a
// 1,300x combat-acceleration downgrade. The same trap is everywhere here.
//
//   - a weapon with more damage per shot that is too heavy for the hull,
//   - a hull with more hardpoints and worse structural integrity,
//   - armour that stops lasers and is transparent to railguns,
//   - point defence, which is a SEPARATE axis and not a weaker attack.
//
// So every comparison class declares a primary ranking axis, a FLOOR on the
// axis it trades against, and reports both. Nothing is blended, and the
// rationale for the choice of primary travels with the ranking.
//
// ---------------------------------------------------------------------------
// WHAT IS VALIDATED, AND WHAT IS NOT
// ---------------------------------------------------------------------------
//
// Two of the derivations below reproduce a figure the game itself publishes,
// which is the same standard phase 1 held delta-V to:
//
//   kinetic damage      0.5 * warheadMass_kg * muzzleVelocity_kps^2 reproduces
//                       `damage_MJ` for all 7 guns that carry it and
//                       `expectedDamage_MJ` for all 16 plasma weapons, ratio
//                       1.000000 (measured 2026-08-21 against the installed 1.0
//                       templates).
//   mount hardpoint cost  the per-mount hardpoint costs below reproduce the
//                       hardpoint fill of all 515 ship designs in the live save
//                       EXACTLY, nose and hull independently, with `Empty`
//                       padding entries costing nothing.
//
// Everything else is derived from stated template fields and is NOT pinned to
// any figure the game reports, because the game reports none. Those axes carry
// `validatedAgainstGameOutput: false` so a reader can tell the two apart --
// section 7 requires template-derived facts and judgement calls to be visually
// distinct, and silently presenting an unvalidated derivation beside a
// validated one would erase that distinction.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, round, toFiniteNumber as toFinite } from './util.mjs';
import { MUNITION_DELIVERY_AXES, munitionDelivery } from './munitionDelivery.mjs';

// ---------------------------------------------------------------------------
// MOUNTS
// ---------------------------------------------------------------------------

/**
 * What one mount costs in hardpoints, and which side of the hull it fits.
 *
 * VALIDATED. Summing these over each design's `noseWeaponTemplateEntries` and
 * `hullWeaponTemplateEntries` reproduces the hull template's `noseHardpoints`
 * and `hullHardpoints` for all 515 ship designs in the live save, nose and hull
 * independently. Perturbing any single cost breaks it (setting
 * `ThreeNoseAngle` to 2 drops the match to 397 of 515), so the check is not
 * vacuous.
 *
 * `verifiedInSave: false` marks the two mounts no design in the save uses.
 * Their cost is read from the mount's own name and is an inference, not a
 * measurement, and it is labelled as one rather than being quietly folded in
 * with the seven that were checked.
 *
 * `installation` mounts are hab and region defences. They consume no ship
 * hardpoint because they are not fitted to ships, so `hardpoints` is null and
 * they form their own comparison class instead of being ranked against ship
 * weapons on an axis that does not apply to them.
 */
export const MOUNT_HARDPOINTS = Object.freeze({
  OneNose: { side: 'nose', hardpoints: 1, verifiedInSave: true },
  TwoNoseVert: { side: 'nose', hardpoints: 2, verifiedInSave: true },
  ThreeNoseAngle: { side: 'nose', hardpoints: 3, verifiedInSave: true },
  FourNose: { side: 'nose', hardpoints: 4, verifiedInSave: true },
  HalfNose: { side: 'nose', hardpoints: 0.5, verifiedInSave: false },
  OneHull: { side: 'hull', hardpoints: 1, verifiedInSave: true },
  TwoHullHoriz: { side: 'hull', hardpoints: 2, verifiedInSave: true },
  FourHull: { side: 'hull', hardpoints: 4, verifiedInSave: true },
  HalfHull: { side: 'hull', hardpoints: 0.5, verifiedInSave: false },
  RegionDefense: { side: 'installation', hardpoints: null, verifiedInSave: true },
  T1BaseDefense: { side: 'installation', hardpoints: null, verifiedInSave: true },
  T2BaseDefense: { side: 'installation', hardpoints: null, verifiedInSave: true },
  T3BaseDefense: { side: 'installation', hardpoints: null, verifiedInSave: true }
});

/** The mount's hardpoint cost, or a stated reason it has none. */
export function mountCost(mount) {
  if (!mount || typeof mount !== 'string') {
    return { side: null, hardpoints: null, verifiedInSave: null, reason: 'the template names no mount' };
  }
  const entry = MOUNT_HARDPOINTS[mount];
  if (!entry) {
    // Unknown is not zero and not free. An unrecognised mount makes the
    // per-hardpoint axis unevaluable, and saying so beats guessing a cost.
    return { side: null, hardpoints: null, verifiedInSave: null, reason: `mount '${mount}' is not in the validated mount table, so its hardpoint cost is unknown` };
  }
  return { ...entry, reason: entry.hardpoints === null ? `'${mount}' is an installation mount and consumes no ship hardpoint` : null };
}

// ---------------------------------------------------------------------------
// ROLES
// ---------------------------------------------------------------------------

export const WEAPON_ROLES = Object.freeze({
  offensive: 'offensive',
  pointDefense: 'point-defense',
  installation: 'installation-defense',
  unknown: 'unknown'
});

/**
 * Offensive armament, point defence, or an installation gun.
 *
 * Structural, from `attackMode` / `defenseMode`, not from the weapon's name.
 * On the installed 1.0 templates the two agree exactly -- every entry the
 * template loader's name test calls point defence is also the set with
 * `attackMode: false, defenseMode: true` (4 lasers and 5 particle weapons) --
 * so the structural test is used and the name test is not needed.
 *
 * The distinction is load-bearing rather than cosmetic: point defence is a
 * self-protection fitting carried by transports too, and ranking it on the same
 * axis as offensive armament is what phase 1's role inference already refuses
 * to do for drives.
 */
export function weaponRole(stats) {
  if (!stats) return WEAPON_ROLES.unknown;
  if (mountCost(stats.mount).side === 'installation') return WEAPON_ROLES.installation;
  if (stats.attackMode === true) return WEAPON_ROLES.offensive;
  if (stats.defenseMode === true) return WEAPON_ROLES.pointDefense;
  return WEAPON_ROLES.unknown;
}

// ---------------------------------------------------------------------------
// FORMULAE
// ---------------------------------------------------------------------------

/**
 * Every formula this module applies, in the wording the API reports, each with
 * what substantiates it. Section 7: a claim that cannot be traced is not usable.
 */
export const MILITARY_FORMULAE = Object.freeze({
  beamDamage: Object.freeze({
    formula: 'damagePerShotMJ = shotPower_MJ',
    basis: 'stated outright by the laser and particle-weapon templates; no derivation',
    validatedAgainstGameOutput: true
  }),
  kineticDamage: Object.freeze({
    formula: 'damagePerShotMJ = 0.5 * warheadMass_kg * muzzleVelocity_kps^2',
    basis: 'the projectile\'s kinetic energy. Reproduces the game\'s own figure exactly (ratio 1.000000) for every template that ships one: `damage_MJ` on all 7 guns that carry it and `expectedDamage_MJ` on all 16 plasma weapons. Magnetic guns carry the same two inputs and no shipped figure, so the formula is applied to them by extension and the extension is stated rather than hidden.',
    validatedAgainstGameOutput: true
  }),
  missileDamage: Object.freeze({
    formula: 'damagePerShotMJ = flatDamage_MJ',
    basis: 'stated by 26 of 57 missile templates (Explosive, Nuclear, ShapedNuclear, Antimatter warheads). The remaining 31 (Fragmentation, Penetrator) state no damage figure and no inputs that yield one, so they report null and are surfaced as not-comparable rather than scored zero.',
    validatedAgainstGameOutput: true
  }),
  firingCycle: Object.freeze({
    formula: 'cycleSeconds = cooldown_s + (shotsPerCycle - 1) * intraSalvoCooldown_s, where shotsPerCycle = salvo_shots when the template states one and 1 otherwise',
    basis: 'the salvo plays out and THEN the weapon cools down. The 30 mm autocannon fires 10 shots at 0.5 s spacing -- 4.5 s of salvo -- against a 4 s `cooldown_s`, so the cooldown cannot be the whole cycle. For a weapon with no salvo fields this reduces exactly to `cooldown_s`. The ordering of salvo and cooldown is an inference from that arithmetic, not a figure the templates state.',
    validatedAgainstGameOutput: false
  }),
  sustainedOutput: Object.freeze({
    formula: 'sustainedOutputMW = damagePerShotMJ * shotsPerCycle / cycleSeconds',
    basis: 'megajoules per second is megawatts. Magazine depth is deliberately NOT folded in: it limits a battle, not a rate, and blending the two would hide which constraint bites.',
    validatedAgainstGameOutput: false
  }),
  outputPerTon: Object.freeze({
    formula: 'outputPerTonMWPerTon = sustainedOutputMW / baseWeaponMass_tons',
    basis: 'mass is the cost a weapon charges the hull that carries it. Null where the template states no mass -- 37 lasers, all of them hab or region defences.',
    validatedAgainstGameOutput: false
  }),
  magazineDuration: Object.freeze({
    formula: 'sustainedOutputDurationS = magazine * cycleSeconds / shotsPerCycle',
    basis: 'how long the sustained rate can actually be held before the magazine is empty. Reported because the rate alone is misleading for a deep-strike weapon: the antimatter torpedo launcher carries four rounds, so its 3.2 GW sustained figure lasts 28 seconds. Beam weapons carry no magazine field at all -- they are power-limited rather than ammunition-limited -- and report null with that stated, which is a different thing from an unmeasured magazine.',
    validatedAgainstGameOutput: false
  }),
  magazineEnergy: Object.freeze({
    formula: 'magazineEnergyMJ = damagePerShotMJ * magazine',
    basis: 'the total energy the weapon can deliver before it needs resupply. Null for beam weapons, which have no magazine to exhaust.',
    validatedAgainstGameOutput: false
  }),
  outputPerHardpoint: Object.freeze({
    formula: 'outputPerHardpointMW = sustainedOutputMW / mountHardpointCost',
    basis: 'hardpoints are the scarce resource. Validated: the per-mount costs reproduce the hardpoint fill of all 515 ship designs in the live save exactly, nose and hull independently, and perturbing one cost breaks the match.',
    validatedAgainstGameOutput: true
  }),
  beamSpread: Object.freeze({
    formula: 'spotRadiusAtStatedRangeM = (beam_quality * wavelength_nm * 1e-9 / (pi * mirrorRadius_cm * 0.01) + jitter_Rad) * targetingRange_km * 1000',
    basis: 'MODELLED. Gaussian far-field divergence with beam_quality read as M-squared, plus the stated pointing jitter. The game publishes no beam-spread figure, so this is NOT validated against anything and is deliberately excluded from every ranking. Stated range is reported separately and IS the template\'s own number.',
    validatedAgainstGameOutput: false
  }),
  hullThrowWeight: Object.freeze({
    formula: 'throwWeightMW = noseHardpoints * bestNoseOutputPerHardpointMW + hullHardpoints * bestHullOutputPerHardpointMW',
    basis: 'the hull\'s offensive output when filled with the best-per-hardpoint offensive weapon the observer already fields on each side. Armament is held constant across every hull so the comparison isolates the hull. Null when the observer fields no offensive weapon for a side, because there is then nothing to fill it with.',
    validatedAgainstGameOutput: false
  }),
  structuralIntegrityPerKiloton: Object.freeze({
    formula: 'structuralIntegrityPerKiloton = structuralIntegrity / (mass_tons / 1000)',
    basis: 'the survivability a hull buys per unit of mass. Reported as the FLOOR against throw weight, because a hull with more hardpoints and less structure is the trade this axis exists to expose.',
    validatedAgainstGameOutput: false
  }),
  armorResistance: Object.freeze({
    formula: 'xRayResistance / baryonicResistance = the template\'s own `specialties[].value` for `XRayResistance` and `BaryonicResistance`',
    basis: 'stated by all 12 armour templates. Higher is better, and the two channels are separate numbers that are never averaged: Boron Carbide rates 1.00 X-ray against 0.62 baryonic while Silicon Carbide rates 0.72 against 4.61, so an armour that stops lasers can be transparent to railguns.',
    validatedAgainstGameOutput: true
  }),
  armorArealMassRejected: Object.freeze({
    formula: 'REJECTED: arealMassPerHalvingKgPerM2 = halfValue_cm / 100 * density_kgm3',
    basis: 'TRIED AND DROPPED, recorded here rather than silently omitted. Reading `baryonicHalfValue_cm` as a half-value layer and pricing it per unit area gives Steel (589 kg/m^2) and Titanium (506) as the most mass-efficient baryonic armours in the game and Nanotube (2,673) as one of the worst -- the exact reverse of the shipped `BaryonicResistance` ratings, which run Steel 1.00, Titanium 1.11, Nanotube 19.78, Adamantane 31.02. Two readings of the same fields cannot both be right, and the one the game itself publishes wins. The half-value figures are still reported verbatim as stated fields; no derivation is built on them.',
    validatedAgainstGameOutput: false
  }),
  powerPlantOutputPerTon: Object.freeze({
    formula: 'outputPerTonGWPerTon = 1 / specificPower_tGW',
    basis: 'the template states tonnes per gigawatt; this inverts it so the axis reads "more is better" like every other output axis.',
    validatedAgainstGameOutput: false
  }),
  powerPlantWasteHeat: Object.freeze({
    formula: 'wasteHeatAtMaxOutputGW = maxOutput_GW * (1 - efficiency)',
    basis: 'the heat the radiators have to reject. Reported as the floor against output per tonne, because a denser reactor that dumps more heat moves the cost to the radiator rather than removing it.',
    validatedAgainstGameOutput: false
  }),
  radiatorRejection: Object.freeze({
    formula: 'heatRejectionPerTonMWPerTon = specificPower_2s_KWkg',
    basis: 'kilowatts per kilogram and megawatts per tonne are the same ratio, so the template\'s figure is already the per-tonne one; it is renamed, not converted.',
    validatedAgainstGameOutput: false
  }),
  heatSinkCapacity: Object.freeze({
    formula: 'heatCapacityPerTonGJPerTon = heatCapacity_GJ / mass_tons',
    basis: 'stated fields only.',
    validatedAgainstGameOutput: false
  }),
  batteryEnergy: Object.freeze({
    formula: 'energyPerTonGJPerTon = energyCapacity_GJ / mass_tons',
    basis: 'stated fields only.',
    validatedAgainstGameOutput: false
  })
});

// ---------------------------------------------------------------------------
// AXES
// ---------------------------------------------------------------------------

const axis = (key, label, formulaKey, direction, options = {}) => Object.freeze({
  key,
  label,
  direction,
  formula: MILITARY_FORMULAE[formulaKey]?.formula ?? options.formula ?? null,
  basis: MILITARY_FORMULAE[formulaKey]?.basis ?? options.basis ?? 'read verbatim from the template; no derivation',
  validatedAgainstGameOutput: MILITARY_FORMULAE[formulaKey]?.validatedAgainstGameOutput ?? options.validatedAgainstGameOutput ?? true,
  stated: options.stated === true
});

const statedAxis = (key, label, direction, basis) =>
  axis(key, label, null, direction, { stated: true, formula: null, basis, validatedAgainstGameOutput: true });

const WEAPON_AXES = Object.freeze([
  axis('outputPerHardpointMW', 'sustained output per hardpoint (MW)', 'outputPerHardpoint', 'higher'),
  axis('outputPerTonMWPerTon', 'sustained output per tonne (MW/t)', 'outputPerTon', 'higher'),
  axis('sustainedOutputMW', 'sustained output (MW)', 'sustainedOutput', 'higher'),
  axis('damagePerShotMJ', 'damage per shot (MJ)', 'kineticDamage', 'higher'),
  axis('magazineEnergyMJ', 'total magazine energy (MJ)', 'magazineEnergy', 'higher'),
  axis('sustainedOutputDurationS', 'seconds the sustained rate can be held', 'magazineDuration', 'higher'),
  // LOWER is better, and it has to be declared here for that to be true of the
  // floor as well. Point defence uses this as its floor axis, and without the
  // declaration the direction defaulted to `higher` -- which reported a turret
  // that fires twice as fast as the observer's as moving "the wrong way".
  axis('cycleSeconds', 'seconds per firing cycle', 'firingCycle', 'lower'),
  statedAxis('statedRangeKm', 'stated targeting range (km)', 'higher', 'the template\'s own `targetingRange_km`'),
  statedAxis('massTons', 'weapon mass (t)', 'lower', 'the template\'s own `baseWeaponMass_tons`'),
  statedAxis('crew', 'crew required', 'lower', 'the template\'s own `crew`')
]);

const HULL_AXES = Object.freeze([
  axis('throwWeightMW', 'throw weight (MW)', 'hullThrowWeight', 'higher'),
  axis('structuralIntegrityPerKiloton', 'structural integrity per kilotonne', 'structuralIntegrityPerKiloton', 'higher'),
  statedAxis('structuralIntegrity', 'structural integrity', 'higher', 'the template\'s own `structuralIntegrity`'),
  statedAxis('totalHardpoints', 'hardpoints (nose + hull)', 'higher', 'the template\'s own `noseHardpoints` + `hullHardpoints`'),
  statedAxis('internalModules', 'internal module slots', 'higher', 'the template\'s own `internalModules`, which equals the hull\'s Utility slot count on all 28 hulls'),
  statedAxis('missionControl', 'mission control cost', 'lower', 'the template\'s own `missionControl`; a standing cost, not a one-off'),
  statedAxis('baseConstructionTimeDays', 'build time (days)', 'lower', 'the template\'s own `baseConstructionTime_days`'),
  statedAxis('massTons', 'hull mass (t)', 'lower', 'the template\'s own `mass_tons`')
]);

const ARMOR_AXES = Object.freeze([
  axis('xRayResistance', 'X-ray resistance', 'armorResistance', 'higher'),
  axis('baryonicResistance', 'baryonic resistance', 'armorResistance', 'higher'),
  statedAxis('heatOfVaporizationMJkg', 'heat of vaporization (MJ/kg)', 'higher', 'the template\'s own `heatofVaporization_MJkg`'),
  statedAxis('densityKgM3', 'density (kg/m^3)', 'lower', 'the template\'s own `density_kgm3`')
]);

const POWER_PLANT_AXES = Object.freeze([
  axis('outputPerTonGWPerTon', 'output per tonne (GW/t)', 'powerPlantOutputPerTon', 'higher'),
  axis('wasteHeatAtMaxOutputGW', 'waste heat at max output (GW)', 'powerPlantWasteHeat', 'lower'),
  statedAxis('maxOutputGW', 'max output (GW)', 'higher', 'the template\'s own `maxOutput_GW`'),
  statedAxis('efficiency', 'efficiency', 'higher', 'the template\'s own `efficiency`')
]);

const RADIATOR_AXES = Object.freeze([
  axis('heatRejectionPerTonMWPerTon', 'heat rejection per tonne (MW/t)', 'radiatorRejection', 'higher'),
  statedAxis('vulnerability', 'combat vulnerability', 'lower', 'the template\'s own `vulnerability`'),
  statedAxis('operatingTempK', 'operating temperature (K)', 'higher', 'the template\'s own `operatingTemp_K`'),
  statedAxis('emissivity', 'emissivity', 'higher', 'the template\'s own `emissivity`')
]);

const HEAT_SINK_AXES = Object.freeze([
  axis('heatCapacityPerTonGJPerTon', 'heat capacity per tonne (GJ/t)', 'heatSinkCapacity', 'higher'),
  statedAxis('heatCapacityGJ', 'heat capacity (GJ)', 'higher', 'the template\'s own `heatCapacity_GJ`'),
  statedAxis('massTons', 'mass (t)', 'lower', 'the template\'s own `mass_tons`')
]);

const BATTERY_AXES = Object.freeze([
  axis('energyPerTonGJPerTon', 'stored energy per tonne (GJ/t)', 'batteryEnergy', 'higher'),
  statedAxis('rechargeRateGJs', 'recharge rate (GJ/s)', 'higher', 'the template\'s own `rechargeRate_GJs`'),
  statedAxis('energyCapacityGJ', 'stored energy (GJ)', 'higher', 'the template\'s own `energyCapacity_GJ`'),
  statedAxis('hp', 'hit points', 'higher', 'the template\'s own `hp`')
]);

// ---------------------------------------------------------------------------
// METRICS
// ---------------------------------------------------------------------------

/** value / mass, or null when either is unmeasured. Never a zero for absent. */
const perUnit = (numerator, denominator) => {
  const top = toFinite(numerator);
  const bottom = toFinite(denominator);
  if (top === null || bottom === null || !(bottom > 0)) return null;
  return top / bottom;
};

/**
 * Damage per shot, the basis it came from, and the agreement where the template
 * ships its own figure.
 *
 * `agreement` is tri-state exactly as phase 1's is: null means the comparison
 * could not be made, which is NOT a disagreement and must never read as one.
 */
export function weaponDamage(stats, family) {
  const stated = toFinite(stats?.statedDamageMJ);
  const shotPower = toFinite(stats?.shotPowerMJ);
  const warheadKg = toFinite(stats?.warheadMassKg);
  const muzzleKps = toFinite(stats?.muzzleVelocityKps);

  // Kinetic families: derive, then check against the shipped figure when there
  // is one. This is the pinning that makes the derivation trustworthy on the
  // family that ships no figure at all.
  const kinetic = (warheadKg !== null && muzzleKps !== null)
    ? 0.5 * warheadKg * muzzleKps * muzzleKps
    : null;

  // `formulaKey` points into the response's `formulae` table so the wording is
  // stated once rather than repeated on every row; `unavailableReason` carries
  // prose ONLY when there is no number, which is the case a reader has to be
  // told about in words.
  if (family === 'laser_weapon' || family === 'particle_weapon') {
    return {
      damagePerShotMJ: shotPower,
      formulaKey: 'beamDamage',
      unavailableReason: shotPower === null
        ? 'the template states no shot power, so damage per shot is unmeasured'
        : null,
      agreement: null
    };
  }

  if (family === 'gun' || family === 'magnetic_gun' || family === 'plasma_weapon') {
    const agreement = (kinetic !== null && stated !== null && stated !== 0)
      ? { modelled: round(kinetic, 6), stated, statedField: stats?.statedDamageField ?? null, ratio: round(kinetic / stated, 6), agrees: Math.abs(kinetic / stated - 1) <= 1e-6 }
      : null;
    return {
      damagePerShotMJ: kinetic,
      formulaKey: 'kineticDamage',
      unavailableReason: kinetic === null
        ? 'the template states neither a warhead mass nor a muzzle velocity, so kinetic energy is not derivable'
        : null,
      agreement
    };
  }

  if (family === 'missile') {
    return {
      damagePerShotMJ: stated,
      formulaKey: 'missileDamage',
      unavailableReason: stated === null
        ? `this ${stats?.warheadClass || 'unclassified'} warhead states no damage figure and no inputs that yield one, so its damage is unmeasured`
        : null,
      agreement: null
    };
  }

  return {
    damagePerShotMJ: null,
    formulaKey: null,
    unavailableReason: `family '${family}' has no damage model in this module`,
    agreement: null
  };
}

/**
 * The full derived metric set for one weapon.
 *
 * `options.pointDefenseProfile` is phase 5's defensive battery, and it is
 * OPTIONAL: every three-argument caller keeps working unchanged and gets a
 * delivery block whose `pointDefense` is null with the reason attached, rather
 * than one that quietly claims an undefended sky.
 */
export function weaponMetrics(id, stats, family, options = {}) {
  const damage = weaponDamage(stats, family);
  const cooldown = toFinite(stats?.cooldownS);
  const salvo = toFinite(stats?.salvoShots);
  const intra = toFinite(stats?.intraSalvoCooldownS);
  const shotsPerCycle = salvo === null ? 1 : salvo;
  // The template's own `salvo_shots` when it has one; otherwise one shot per
  // cooldown, which is an ASSUMPTION and is flagged as one rather than being
  // indistinguishable from a stated 1.
  const shotsPerCycleAssumed = salvo === null;
  // `intra ?? 0` never fires with a real salvo: `salvo_shots` and
  // `intraSalvoCooldown_s` co-occur on all 104 templates that carry either and
  // on none that carry only one (verified 2026-08-21 against the installed 1.0
  // templates), so the fallback only ever multiplies by zero.
  const cycleSeconds = cooldown === null
    ? null
    : cooldown + (shotsPerCycle - 1) * (intra ?? 0);

  const sustainedOutputMW = (damage.damagePerShotMJ === null || cycleSeconds === null || !(cycleSeconds > 0))
    ? null
    : (damage.damagePerShotMJ * shotsPerCycle) / cycleSeconds;

  // A rate with no duration beside it is how a four-round antimatter torpedo
  // launcher reads as six million times the observer's best weapon. Beam
  // weapons genuinely have no magazine -- that is a fact about them, not a
  // missing measurement, and the basis says which.
  const magazine = toFinite(stats?.magazine);
  const beamFamily = family === 'laser_weapon' || family === 'particle_weapon';
  const sustainedOutputDurationS = (magazine === null || cycleSeconds === null || !(shotsPerCycle > 0))
    ? null
    : (magazine * cycleSeconds) / shotsPerCycle;
  // A short code, expanded once per response by MAGAZINE_BASIS_CODES. The
  // distinction that matters is `not-ammunition-limited` (a fact about beam
  // weapons) versus `unmeasured` (a gap), and a boolean would erase it.
  const magazineBasis = magazine !== null
    ? 'stated'
    : (beamFamily ? 'not-ammunition-limited' : 'unmeasured');

  const mount = mountCost(stats?.mount);
  const outputPerHardpointMW = mount.hardpoints === null
    ? null
    : perUnit(sustainedOutputMW, mount.hardpoints);

  // Modelled, unvalidated, and never ranked. Reported so a reader can see that
  // a 60 cm mirror and a 720 cm mirror do not have the same reach at the same
  // stated range -- but the stated range is what the ranking uses.
  const beamQuality = toFinite(stats?.beamQuality);
  const wavelengthNm = toFinite(stats?.wavelengthNm);
  const mirrorRadiusCm = toFinite(stats?.mirrorRadiusCm);
  const jitterRad = toFinite(stats?.jitterRad);
  const rangeKm = toFinite(stats?.targetingRangeKm);
  const divergenceRad = (beamQuality === null || wavelengthNm === null || mirrorRadiusCm === null || !(mirrorRadiusCm > 0))
    ? null
    : (beamQuality * wavelengthNm * 1e-9) / (Math.PI * mirrorRadiusCm * 0.01);
  // The formula and its caveats are stated ONCE in the response's `formulae`
  // table under this key, not repeated on every row.
  const beamSpread = divergenceRad === null
    ? null
    : {
      formulaKey: 'beamSpread',
      divergenceHalfAngleRad: round(divergenceRad, 12),
      jitterRad,
      spotRadiusAtStatedRangeM: rangeKm === null ? null : round((divergenceRad + (jitterRad ?? 0)) * rangeKm * 1000, 3),
      usedForRanking: false
    };

  // Phase 5. Reported BESIDE the damage axes and never blended into them: the
  // whole point is that a round can win every damage axis and still be the one
  // the defensive battery removes, which is only visible if the two stay apart.
  const delivery = munitionDelivery(stats, options?.pointDefenseProfile ?? null);

  return {
    id,
    displayName: stats?.displayName || id,
    family,
    role: weaponRole(stats),
    mount: stats?.mount ?? null,
    mountSide: mount.side,
    hardpointCost: mount.hardpoints,
    hardpointCostVerifiedInSave: mount.verifiedInSave,
    hardpointReason: mount.reason,
    damagePerShotMJ: round(damage.damagePerShotMJ, 6),
    damageFormulaKey: damage.formulaKey,
    damageUnavailableReason: damage.unavailableReason,
    damageAgreement: damage.agreement,
    shotsPerCycle,
    shotsPerCycleAssumed,
    cycleSeconds: round(cycleSeconds, 6),
    cycleSecondsModelled: shotsPerCycle > 1,
    sustainedOutputMW: round(sustainedOutputMW, 6),
    outputPerTonMWPerTon: round(perUnit(sustainedOutputMW, stats?.massTons), 6),
    outputPerHardpointMW: round(outputPerHardpointMW, 6),
    magazineShots: magazine,
    magazineBasis,
    sustainedOutputDurationS: round(sustainedOutputDurationS, 4),
    magazineEnergyMJ: (magazine === null || damage.damagePerShotMJ === null)
      ? null
      : round(magazine * damage.damagePerShotMJ, 6),
    statedRangeKm: rangeKm,
    doublingRangeKm: toFinite(stats?.doublingRangeKm),
    massTons: toFinite(stats?.massTons),
    crew: toFinite(stats?.crew),
    efficiency: toFinite(stats?.efficiency),
    bombardmentValue: toFinite(stats?.bombardmentValue),
    pointDefenseTargetable: stats?.pointDefenseTargetable === true,
    warheadClass: stats?.warheadClass ?? null,
    missileDeltaVKps: toFinite(stats?.missileDeltaVKps),
    // Carried through so `threatMix` can use a particle weapon's OWN channel
    // split rather than assuming one from its family.
    xRayFraction: toFinite(stats?.xRayFraction),
    baryonFraction: toFinite(stats?.baryonFraction),
    beamSpread,
    delivery,
    // Flattened out of `delivery` so `bestOnAxis` and `rankByAxis` can read the
    // floor axis by key like every other axis, without either of them learning
    // the shape of a delivery block.
    deliveryApplies: delivery.applies === true,
    deliveryShotsPerArrivingRound: delivery.pointDefense?.shotsPerArrivingRound ?? null,
    deliveryFlightTimeS: delivery.flightTimeS,
    deliveryTerminalSpeedKps: delivery.terminalSpeedKps,
    disabled: stats?.disabled === true
  };
}

/**
 * Hull metrics. `armament` supplies the best output-per-hardpoint the observer
 * already fields on each side, so throw weight isolates the hull.
 */
export function hullMetrics(id, stats, armament = {}) {
  const nose = toFinite(stats?.noseHardpoints);
  const hull = toFinite(stats?.hullHardpoints);
  const massTons = toFinite(stats?.massTons);
  const structuralIntegrity = toFinite(stats?.structuralIntegrity);

  const noseBest = toFinite(armament?.nose?.outputPerHardpointMW);
  const hullBest = toFinite(armament?.hull?.outputPerHardpointMW);

  // A side with hardpoints but no weapon to fill them makes throw weight
  // unmeasurable, not zero -- a zero would rank a Titan below a Gunship.
  let throwWeightMW = null;
  let throwWeightReason = null;
  if (nose === null || hull === null) {
    throwWeightReason = 'the hull template states no hardpoint count';
  } else if ((nose > 0 && noseBest === null) || (hull > 0 && hullBest === null)) {
    throwWeightReason = armament?.reason
      || 'the observer fields no offensive weapon for one of this hull\'s sides, so there is nothing to fill it with';
  } else {
    throwWeightMW = nose * (noseBest ?? 0) + hull * (hullBest ?? 0);
  }

  return {
    id,
    displayName: stats?.displayName || id,
    family: 'ship_hull',
    noseHardpoints: nose,
    hullHardpoints: hull,
    totalHardpoints: nose === null || hull === null ? null : nose + hull,
    throwWeightMW: round(throwWeightMW, 6),
    throwWeightReason,
    throwWeightArmament: {
      nose: armament?.nose ? { id: armament.nose.id, displayName: armament.nose.displayName, outputPerHardpointMW: armament.nose.outputPerHardpointMW } : null,
      hull: armament?.hull ? { id: armament.hull.id, displayName: armament.hull.displayName, outputPerHardpointMW: armament.hull.outputPerHardpointMW } : null,
      basis: armament?.basis || null
    },
    structuralIntegrity,
    structuralIntegrityPerKiloton: round(perUnit(structuralIntegrity, massTons === null ? null : massTons / 1000), 6),
    internalModules: toFinite(stats?.internalModules),
    missionControl: toFinite(stats?.missionControl),
    baseConstructionTimeDays: toFinite(stats?.baseConstructionTimeDays),
    consTier: toFinite(stats?.consTier),
    maxOfficers: toFinite(stats?.maxOfficers),
    crew: toFinite(stats?.crew),
    monthlyIncomeMoney: toFinite(stats?.monthlyIncomeMoney),
    massTons,
    alien: stats?.alien === true,
    noShipyardBuild: stats?.noShipyardBuild === true,
    disabled: stats?.disabled === true
  };
}

/**
 * Armour, ranked on the game's OWN resistance ratings.
 *
 * The half-value layers and density are reported verbatim because they are
 * stated fields, but nothing is derived from them -- see
 * `MILITARY_FORMULAE.armorArealMassRejected` for the derivation that was tried
 * and dropped when it inverted the shipped ordering.
 */
export function armorMetrics(id, stats) {
  const specialties = asArray(stats?.specialties)
    .map(([name, value]) => ({ specialty: name, value: toFinite(value) }));
  const rating = (name) => {
    const hit = specialties.find(entry => entry.specialty === name);
    return hit ? hit.value : null;
  };
  return {
    id,
    displayName: stats?.displayName || id,
    family: 'ship_armor',
    xRayResistance: rating('XRayResistance'),
    baryonicResistance: rating('BaryonicResistance'),
    xRayHalfValueCm: toFinite(stats?.xRayHalfValueCm),
    baryonicHalfValueCm: toFinite(stats?.baryonicHalfValueCm),
    densityKgM3: toFinite(stats?.densityKgM3),
    heatOfVaporizationMJkg: toFinite(stats?.heatOfVaporizationMJkg),
    specialties,
    disabled: stats?.disabled === true
  };
}

export function powerPlantMetrics(id, stats) {
  const specific = toFinite(stats?.specificPowerTGW);
  const maxOutput = toFinite(stats?.maxOutputGW);
  const efficiency = toFinite(stats?.efficiency);
  return {
    id,
    displayName: stats?.displayName || id,
    family: 'power_plant',
    maxOutputGW: maxOutput,
    specificPowerTGW: specific,
    outputPerTonGWPerTon: specific === null || !(specific > 0) ? null : round(1 / specific, 8),
    impliedMassTons: specific === null || maxOutput === null ? null : round(specific * maxOutput, 4),
    efficiency,
    wasteHeatFraction: efficiency === null ? null : round(1 - efficiency, 6),
    wasteHeatAtMaxOutputGW: (efficiency === null || maxOutput === null) ? null : round(maxOutput * (1 - efficiency), 6),
    powerPlantClass: stats?.powerPlantClass ?? null,
    crew: toFinite(stats?.crew),
    disabled: stats?.disabled === true
  };
}

export function radiatorMetrics(id, stats) {
  return {
    id,
    displayName: stats?.displayName || id,
    family: 'radiator',
    heatRejectionPerTonMWPerTon: toFinite(stats?.specificPowerKWkg),
    specificMassKgM2: toFinite(stats?.specificMassKgM2),
    operatingTempK: toFinite(stats?.operatingTempK),
    emissivity: toFinite(stats?.emissivity),
    vulnerability: toFinite(stats?.vulnerability),
    radiatorType: stats?.radiatorType ?? null,
    crew: toFinite(stats?.crew),
    disabled: stats?.disabled === true
  };
}

export function heatSinkMetrics(id, stats) {
  const capacity = toFinite(stats?.heatCapacityGJ);
  const massTons = toFinite(stats?.massTons);
  return {
    id,
    displayName: stats?.displayName || id,
    family: 'heat_sink',
    heatCapacityGJ: capacity,
    massTons,
    heatCapacityPerTonGJPerTon: round(perUnit(capacity, massTons), 6),
    crew: toFinite(stats?.crew),
    disabled: stats?.disabled === true
  };
}

export function batteryMetrics(id, stats) {
  const energy = toFinite(stats?.energyCapacityGJ);
  const massTons = toFinite(stats?.massTons);
  return {
    id,
    displayName: stats?.displayName || id,
    family: 'battery',
    energyCapacityGJ: energy,
    massTons,
    energyPerTonGJPerTon: round(perUnit(energy, massTons), 6),
    rechargeRateGJs: toFinite(stats?.rechargeRateGJs),
    hp: toFinite(stats?.hp),
    crew: toFinite(stats?.crew),
    disabled: stats?.disabled === true
  };
}

/**
 * The module's rule set as one canonical key, or null when it carries none.
 *
 * Sorted so `[Magazine, RadHardened]` and `[RadHardened, Magazine]` produce the
 * same key, and joined with a separator no rule name contains. This is the
 * comparison key for a rule value -- see `ruleModuleMetrics` for why the rule
 * alone is not enough.
 */
export function ruleSignatureOf(rules) {
  const list = asArray(rules).map(rule => String(rule).trim()).filter(rule => rule !== '');
  return list.length === 0 ? null : [...list].sort().join(' + ');
}

/**
 * Utility and hab modules: no scalar, only rules.
 *
 * 45 distinct special rules across 58 utility modules and 100+ across the hab
 * modules. There is no exchange rate between an EV multiplier and a targeting
 * computer, and inventing one would be exactly the blended score this module
 * exists to refuse. So these carry their rule list and their rule value, and
 * the comparison happens WITHIN a rule.
 *
 * THE ATTRIBUTION PROBLEM, measured 2026-08-21. The template ships **one**
 * `specialModuleValue` per module and a **list** of `specialModuleRules`, and
 * never says which rule the value belongs to. Cyclotron carries
 * `[ParticleBeamPowerBonus, RadHardened]` with value 20; Magazine carries
 * `[Magazine, RadHardened]` with value 0.5. Grouped by `RadHardened` -- a
 * boolean hardening tag that has no numeric meaning at all -- those two compare
 * as 40x, which is a particle-beam power bonus divided by a magazine capacity
 * multiplier. The RadHardened group holds 14 valued members across **8**
 * distinct rule sets whose values are thrust multipliers, EV multipliers,
 * magazine multipliers, armour fractions and troop counts.
 *
 * `ruleSignature` is the fix: a value may only be compared against another
 * value carrying the IDENTICAL rule set. Then whichever rule owns the scalar in
 * one item owns it in the other, so the attribution ambiguity is the same on
 * both sides and cancels in the ratio -- and an identical rule set also means
 * identical applicability, so the two really are substitutes (a 1.3x thrust
 * multiplier that requires a nuclear drive is not an upgrade over a 1.1x that
 * requires a fusion drive if the ship flies fusion). Everything else reports
 * no multiple with the reason, and is never scored.
 */
export function ruleModuleMetrics(id, stats, family) {
  const rules = family === 'hab_module' ? asArray(stats?.specialRules) : asArray(stats?.specialModuleRules);
  const value = family === 'hab_module' ? toFinite(stats?.specialRulesValue) : toFinite(stats?.specialModuleValue);
  return {
    id,
    displayName: stats?.displayName || id,
    family,
    rules,
    ruleSignature: ruleSignatureOf(rules),
    ruleValue: value,
    massTons: toFinite(stats?.massTons) ?? toFinite(stats?.baseMassTons),
    powerRequirementMW: toFinite(stats?.powerRequirementMW),
    power: toFinite(stats?.power),
    crew: toFinite(stats?.crew),
    minConsTier: toFinite(stats?.minConsTier),
    tier: toFinite(stats?.tier),
    missionControl: toFinite(stats?.missionControl),
    spaceCombatModule: stats?.spaceCombatModule === true,
    buildTimeDays: toFinite(stats?.buildTimeDays),
    habType: stats?.habType ?? null,
    disabled: stats?.disabled === true
  };
}

// ---------------------------------------------------------------------------
// COMPARISON CLASSES
// ---------------------------------------------------------------------------

/**
 * The unit of comparison. Weapons split by role because point defence is a
 * separate axis; everything else is one class per family.
 *
 * `rankBy` names the primary axis and `floorAxis` the one it trades against.
 * `rankRationale` says WHY, because the choice determines the whole ordering
 * and section 7 requires our judgement calls to be visible as ours.
 */
export const CLASS_KINDS = Object.freeze({ ranked: 'ranked', rule: 'rule-grouped' });

export const WEAPON_CLASS_SPECS = Object.freeze({
  [WEAPON_ROLES.offensive]: Object.freeze({
    rankBy: 'outputPerHardpointMW',
    floorAxis: 'outputPerTonMWPerTon',
    rankRationale: 'hardpoints are the scarce resource on a hull, so output per hardpoint is what an extra weapon buys. Output per tonne is the floor: a weapon that hits harder per hardpoint and worse per tonne is paying for it in propellant and structure, which is the same trade phase 1 found between delta-V and thrust.',
    // Phase 5, and ONLY on the offensive role: point defence is not itself
    // interceptable and an installation gun fires from a hab that is not going
    // anywhere, so neither has a delivery axis to floor.
    deliveryFloorAxis: 'deliveryShotsPerArrivingRound',
    deliveryFloorRationale: 'damage still LEADS, because it is the axis that decides the outcome of an '
      + 'engagement. Delivery is the FLOOR, because it decides whether the outcome happens at all: a '
      + 'round the defending battery removes in flight delivers none of its stated damage. This is the '
      + 'direct analogue of phase 1 ranking warships on combat acceleration with delta-V as the floor '
      + '-- the fastest warship in the game is useless if it cannot reach the fight. The floor applies '
      + 'only to munitions the game itself marks `isPointDefenseTargetable`; a beam has no delivery '
      + 'axis and is never demoted by one.'
  }),
  [WEAPON_ROLES.pointDefense]: Object.freeze({
    rankBy: 'outputPerHardpointMW',
    floorAxis: 'cycleSeconds',
    rankRationale: 'point defence is ranked ONLY against other point defence. It is a separate axis, not a weaker attack: a transport carries it too, and ranking it beside offensive armament would either flatter it or bury it. Cycle time is the floor because an interceptor that hits hard and slowly intercepts less.'
  }),
  [WEAPON_ROLES.installation]: Object.freeze({
    rankBy: 'sustainedOutputMW',
    floorAxis: null,
    rankRationale: 'hab and region defences occupy no ship hardpoint and state no mass, so neither per-hardpoint nor per-tonne applies. They are ranked on raw sustained output and kept in their own class rather than compared against ship weapons on axes that do not exist for them.'
  }),
  [WEAPON_ROLES.unknown]: Object.freeze({
    rankBy: null,
    floorAxis: null,
    rankRationale: 'this weapon states neither attack nor defence mode, so its role -- and therefore its ranking axis -- cannot be determined from the template.'
  })
});

/** Axis list and ranking rule for a non-weapon family. */
export const COMPONENT_CLASS_SPECS = Object.freeze({
  ship_hull: {
    axisSet: 'ship_hull',
    axes: HULL_AXES,
    kind: CLASS_KINDS.ranked,
    rankBy: 'throwWeightMW',
    floorAxis: 'structuralIntegrityPerKiloton',
    rankRationale: 'throw weight is what a hull is for, and structural integrity per kilotonne is the floor: more hardpoints on less structure is the exact trade that makes a bigger hull a worse one. Mission control and build time are standing costs and are reported as their own axes rather than folded into the ranking.'
  },
  ship_armor: {
    axisSet: 'ship_armor',
    axes: ARMOR_AXES,
    kind: CLASS_KINDS.ranked,
    rankBy: null, // chosen from the OBSERVED threat mix; see rankArmorAxis
    floorAxis: null,
    rankRationale: 'set from the observed threat mix rather than fixed, because which channel matters is a measurement, not a preference.'
  },
  power_plant: {
    axisSet: 'power_plant',
    axes: POWER_PLANT_AXES,
    kind: CLASS_KINDS.ranked,
    rankBy: 'outputPerTonGWPerTon',
    floorAxis: 'wasteHeatAtMaxOutputGW',
    rankRationale: 'output per tonne is the reactor\'s contribution; waste heat at full output is the floor, because a denser reactor that dumps more heat has moved the mass to the radiator rather than removed it.'
  },
  radiator: {
    axisSet: 'radiator',
    axes: RADIATOR_AXES,
    kind: CLASS_KINDS.ranked,
    rankBy: 'heatRejectionPerTonMWPerTon',
    floorAxis: 'vulnerability',
    rankRationale: 'heat rejected per tonne is the radiator\'s job; combat vulnerability is the floor, because the best radiator in the game is worthless if the first salvo removes it.'
  },
  heat_sink: {
    axisSet: 'heat_sink',
    axes: HEAT_SINK_AXES,
    kind: CLASS_KINDS.ranked,
    rankBy: 'heatCapacityPerTonGJPerTon',
    floorAxis: null,
    rankRationale: 'heat sinks state only capacity and mass, so there is one axis and no trade to expose.'
  },
  battery: {
    axisSet: 'battery',
    axes: BATTERY_AXES,
    kind: CLASS_KINDS.ranked,
    rankBy: 'energyPerTonGJPerTon',
    floorAxis: 'rechargeRateGJs',
    rankRationale: 'stored energy per tonne is the capacity that fires the guns; recharge rate is the floor, because a big battery that refills slowly fires once.'
  },
  utility_module: {
    axisSet: 'none',
    axes: Object.freeze([]),
    kind: CLASS_KINDS.rule,
    rankBy: null,
    floorAxis: null,
    rankRationale: 'utility modules share no axis. 45 distinct special rules across 58 modules, and there is no exchange rate between an exhaust-velocity multiplier and a targeting computer. They are compared WITHIN a rule against what the observer already fields, and never across rules.'
  },
  hab_module: {
    axisSet: 'none',
    axes: Object.freeze([]),
    kind: CLASS_KINDS.rule,
    rankBy: null,
    floorAxis: null,
    rankRationale: 'hab-module value is overwhelmingly ECONOMIC -- income, mining and research -- which is spec section 4 and a later phase. The military content is the space-combat modules and the mission control a module supplies, so those are reported and the rest is compared within a shared special rule. No income figure is valued here, because valuing it against nothing is how a benefit gets scored as a confident zero.'
  }
});

// ---------------------------------------------------------------------------
// RANKING
// ---------------------------------------------------------------------------

/**
 * `candidate / baseline`, direction-aware, tri-state.
 *
 * On a `lower`-is-better axis the multiple is inverted so that "greater than 1"
 * always means "better than what you field", whichever way the axis runs. The
 * raw ratio travels alongside so nothing is hidden by the normalisation.
 *
 * `improves: null` means the comparison could not be made. That is NOT "no
 * improvement" and must never render as one.
 */
export function ratioAgainst(candidateValue, baselineValue, direction = 'higher') {
  const candidate = toFinite(candidateValue);
  const baseline = toFinite(baselineValue);
  if (candidate === null || baseline === null || baseline === 0) {
    return {
      candidate,
      baseline,
      multiple: null,
      improves: null,
      // Short codes rather than prose: this object appears once per axis per
      // row, and the wording that explains each code is stated once at the
      // class level. `unmeasured` is deliberately never `false`.
      unavailable: candidate === null && baseline === null
        ? 'neither-measured'
        : (candidate === null ? 'candidate-unmeasured' : 'no-fielded-baseline')
    };
  }
  const rawRatio = candidate / baseline;
  const multiple = direction === 'lower' ? baseline / candidate : rawRatio;
  if (!Number.isFinite(multiple)) {
    // A cost of exactly zero on a lower-is-better axis -- the STO Fighter's
    // zero mission control against a Battlecruiser's three. The improvement is
    // real and unambiguous; the ratio is not a number. Emitting
    // `multiple: null` beside `unavailable: null` claimed a figure that was not
    // there, so the code says which of the two this is.
    return {
      candidate,
      baseline,
      multiple: null,
      improves: (direction === 'lower' && candidate === 0 && baseline > 0) ? true : null,
      unavailable: 'ratio-unbounded'
    };
  }
  return {
    candidate,
    baseline,
    multiple: round(multiple, 6),
    improves: multiple > 1,
    // Only where it differs from `multiple`, i.e. on a lower-is-better axis
    // where the multiple is inverted so that ">1 means better" holds
    // everywhere. Omitted elsewhere rather than repeated.
    ...(direction === 'lower' ? { rawRatio: round(rawRatio, 6) } : {}),
    unavailable: null
  };
}

/** What each `unavailable` code on a ratio means, stated once per response. */
export const RATIO_UNAVAILABLE_CODES = Object.freeze({
  'neither-measured': 'neither the candidate nor the fielded baseline has a measured value on this axis',
  'candidate-unmeasured': 'the candidate has no measured value on this axis; it is NOT zero',
  'no-fielded-baseline': 'the observer fields nothing with a measured value on this axis, so there is no baseline to compare against',
  'ratio-unbounded': 'both sides are measured but the ratio between them is not a finite number, which happens when a cost axis reaches exactly zero. `improves` still carries the direction where it is unambiguous.'
});

/**
 * Orders rows by one axis, with the tensioned axis as a stated floor and -- for
 * the classes that declare one -- a second, DELIVERY floor.
 *
 * Same three rules as phase 1's `rankRefits`, and for the same reasons:
 *   1. rows the model could not compute sort LAST and keep their reason. An
 *      unknown is not a zero and must not be ranked as one.
 *   2. rows below the floor are ranked lower but still listed and flagged --
 *      "this hits harder and you cannot carry it" is the finding, not something
 *      to hide.
 *   3. ties break on id, so the same snapshot always yields the same order.
 *
 * The delivery floor (phase 5) is the same machinery pointed at a second axis,
 * with one addition: it does not apply to every row. A beam is not
 * point-defence targetable, so there is nothing to intercept and nothing to
 * floor, and `deliveryFloorApplies` is the predicate that says so per row.
 *
 * When no delivery floor is configured every new field is null and the ordering
 * is byte-identical to what it was before phase 5 existed.
 */
export function rankByAxis(rows, {
  rankBy = null,
  direction = 'higher',
  floorAxis = null,
  floorDirection = 'higher',
  floorValue = null,
  deliveryFloorAxis = null,
  deliveryFloorDirection = 'lower',
  deliveryFloorValue = null,
  deliveryFloorApplies = null
} = {}) {
  const list = asArray(rows);
  if (!rankBy) {
    return {
      ranked: [...list]
        .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
        .map(row => ({
          ...row,
          rankMetric: null,
          rankValue: null,
          clearsFloor: null,
          floorReason: 'this class has no single ranking metric',
          clearsDeliveryFloor: null,
          deliveryFloorReason: 'this class has no single ranking metric, so no floor of any kind is applied to it'
        })),
      ranking: null
    };
  }

  const floor = toFinite(floorValue);
  const deliveryFloor = toFinite(deliveryFloorValue);
  const appliesTo = typeof deliveryFloorApplies === 'function' ? deliveryFloorApplies : null;

  const scored = list.map(row => {
    const rankValue = toFinite(row[rankBy]);
    const floorMetric = floorAxis === null ? null : toFinite(row[floorAxis]);
    let clearsFloor = null;
    let floorReason = null;
    if (floorAxis === null) {
      floorReason = 'this class declares no floor axis';
    } else if (floor === null) {
      floorReason = `no floor could be measured for ${floorAxis} from what the observer fields`;
    } else if (floorMetric === null) {
      floorReason = `${floorAxis} is not measurable for this item, so the floor cannot be evaluated`;
    } else {
      clearsFloor = floorDirection === 'lower' ? floorMetric <= floor : floorMetric >= floor;
      floorReason = clearsFloor
        ? null
        : `${floorAxis} moves from ${round(floor, 6)} to ${round(floorMetric, 6)}, the wrong way`;
    }

    // FOUR distinct outcomes, each with its own reason string, because they are
    // four different facts and collapsing any two of them into "unknown" is the
    // failure this repo keeps re-fixing.
    let clearsDeliveryFloor = null;
    let deliveryFloorReason = null;
    const deliveryMetric = deliveryFloorAxis === null ? null : toFinite(row[deliveryFloorAxis]);
    if (deliveryFloorAxis === null) {
      deliveryFloorReason = 'this class declares no delivery floor';
    } else if (appliesTo !== null && appliesTo(row) !== true) {
      deliveryFloorReason = 'this weapon is not point-defence targetable, so the delivery floor does not apply to it';
    } else if (deliveryFloor === null) {
      deliveryFloorReason = 'the observer fields no point-defence-targetable munition with a measurable delivery figure, so no floor could be measured';
    } else if (deliveryMetric === null) {
      deliveryFloorReason = 'delivery is not measurable for this item, so the floor cannot be evaluated';
    } else {
      clearsDeliveryFloor = deliveryFloorDirection === 'lower'
        ? deliveryMetric <= deliveryFloor
        : deliveryMetric >= deliveryFloor;
      deliveryFloorReason = clearsDeliveryFloor
        ? null
        : `${deliveryFloorAxis} moves from ${round(deliveryFloor, 6)} to ${round(deliveryMetric, 6)}, the wrong way`;
    }

    return { ...row, rankMetric: rankBy, rankValue, clearsFloor, floorReason, clearsDeliveryFloor, deliveryFloorReason };
  });

  scored.sort((a, b) => {
    const aComputable = a.rankValue !== null;
    const bComputable = b.rankValue !== null;
    if (aComputable !== bComputable) return aComputable ? -1 : 1;
    // ONLY A MEASURED `false` DEMOTES. A floor that could not be evaluated --
    // because the row is a beam, because the observer fields no comparable
    // munition, or because the item states no flight inputs -- leaves the row
    // exactly where its rank value puts it.
    //
    // That is not "unknown falls through to safe". Unknown carries its own
    // reason string on the row and gets its OWN badge in the panel, distinct
    // from the one a passing row gets, so it never READS as clearing. Burying
    // every munition in the catalogue whenever the sky happens to be unobserved
    // would be the opposite error: a snapshot with no visible hostile hull
    // would silently reorder the entire ranking on the strength of a
    // measurement nobody made.
    const aBelow = (a.clearsFloor === false || a.clearsDeliveryFloor === false) ? 1 : 0;
    const bBelow = (b.clearsFloor === false || b.clearsDeliveryFloor === false) ? 1 : 0;
    if (aBelow !== bBelow) return aBelow - bBelow;
    if (!aComputable) return String(a.id || '').localeCompare(String(b.id || ''));
    if (a.rankValue !== b.rankValue) {
      return direction === 'lower' ? a.rankValue - b.rankValue : b.rankValue - a.rankValue;
    }
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  return {
    ranked: scored,
    ranking: {
      rankBy,
      direction,
      floorAxis,
      floorDirection,
      floorValue: round(floor, 6),
      floorBasis: floor === null
        ? 'not measurable from what the observer currently fields'
        : 'the best value among the items the observer currently fields',
      // Explicit null rather than an omitted key, so a consumer can tell "this
      // class declares no delivery floor" from "this build predates phase 5".
      deliveryFloor: deliveryFloorAxis === null ? null : {
        axis: deliveryFloorAxis,
        direction: deliveryFloorDirection,
        value: round(deliveryFloor, 6),
        basis: deliveryFloor === null
          ? 'not measurable from the point-defence-targetable munitions the observer currently fields'
          : 'the best value among the point-defence-targetable munitions the observer currently fields',
        appliesTo: 'rows the game marks `isPointDefenseTargetable`; every other row reports a null verdict with its own reason',
        rationale: 'damage leads because it decides the outcome; delivery is the floor because it decides whether the outcome happens at all.'
      }
    }
  };
}

/** The best row on one axis among a set, or null when nothing measured it. */
export function bestOnAxis(rows, axisKey, direction = 'higher') {
  let best = null;
  for (const row of asArray(rows)) {
    const value = toFinite(row?.[axisKey]);
    if (value === null) continue;
    if (best === null) { best = row; continue; }
    const current = toFinite(best[axisKey]);
    if (direction === 'lower' ? value < current : value > current) best = row;
  }
  return best;
}

// ---------------------------------------------------------------------------
// THREAT MIX -- which armour axis the measured threat loads
// ---------------------------------------------------------------------------

/**
 * Splits observed hostile armament into the X-ray and baryonic damage channels.
 *
 * Lasers deliver photons and load the X-ray channel; guns, magnetic guns,
 * plasma and missiles deliver matter and load the baryonic one. Particle
 * weapons carry their OWN `xRayFraction` / `baryonFraction` in the template and
 * those are used verbatim rather than assumed -- the point-defence E-beamer is
 * 90% X-ray, which no family-level rule would have got right.
 *
 * Returns `dominant: null` when nothing hostile is observable, so the armour
 * ranking says it has no basis instead of defaulting to a channel.
 */
export function threatMix(weaponMetricRows) {
  let xRay = 0;
  let baryonic = 0;
  let counted = 0;
  const unclassified = [];
  for (const row of asArray(weaponMetricRows)) {
    if (!row || row.role !== WEAPON_ROLES.offensive) continue;
    const weight = toFinite(row.sustainedOutputMW);
    if (weight === null || weight <= 0) {
      unclassified.push({ id: row?.id ?? null, reason: 'no measurable sustained output to weight this weapon by' });
      continue;
    }
    const xFraction = toFinite(row.xRayFraction);
    const bFraction = toFinite(row.baryonFraction);
    if (xFraction !== null || bFraction !== null) {
      xRay += weight * (xFraction ?? 0);
      baryonic += weight * (bFraction ?? 0);
      counted += 1;
      continue;
    }
    if (row.family === 'laser_weapon') { xRay += weight; counted += 1; continue; }
    if (row.family === 'gun' || row.family === 'magnetic_gun' || row.family === 'plasma_weapon' || row.family === 'missile') {
      baryonic += weight; counted += 1; continue;
    }
    unclassified.push({ id: row?.id ?? null, reason: `family '${row.family}' has no damage-channel mapping` });
  }
  const total = xRay + baryonic;
  return {
    weaponsCounted: counted,
    xRayOutputMW: round(xRay, 6),
    baryonicOutputMW: round(baryonic, 6),
    xRayShare: total > 0 ? round(xRay / total, 4) : null,
    baryonicShare: total > 0 ? round(baryonic / total, 4) : null,
    dominant: total > 0 ? (xRay >= baryonic ? 'xRay' : 'baryonic') : null,
    unclassified,
    basis: 'observed hostile offensive armament, weighted by each weapon\'s modelled sustained output. Lasers load the X-ray channel, matter weapons the baryonic one, and particle weapons use their own stated `xRayFraction` / `baryonFraction`.',
    inferred: true
  };
}

/** Which armour axis a measured threat mix selects, with the reason stated. */
export function rankArmorAxis(mix) {
  if (!mix || mix.dominant === null) {
    return {
      rankBy: null,
      floorAxis: null,
      reason: 'no hostile armament is observable in this snapshot, so neither armour channel can be shown to dominate. Both axes are reported and neither is ranked above the other.'
    };
  }
  const dominantIsXRay = mix.dominant === 'xRay';
  return {
    rankBy: dominantIsXRay ? 'xRayResistance' : 'baryonicResistance',
    floorAxis: dominantIsXRay ? 'baryonicResistance' : 'xRayResistance',
    reason: `${Math.round((dominantIsXRay ? mix.xRayShare : mix.baryonicShare) * 100)}% of observed hostile offensive output is ${dominantIsXRay ? 'X-ray' : 'baryonic'}, so armour is ranked on that channel with the other as the floor. This ordering is our inference from a measurement, not shipped data, and it moves when the observed threat moves.`
  };
}

/** What each `magazineBasis` code means, stated once per response. */
export const MAGAZINE_BASIS_CODES = Object.freeze({
  stated: 'the template\'s own `magazine`',
  'not-ammunition-limited': 'beam weapons carry no magazine in the templates; they are power-limited rather than ammunition-limited, so there is no duration to exhaust. This is a fact about the weapon, not a missing measurement.',
  unmeasured: 'the template states no magazine, so how long this weapon can sustain its rate is unmeasured'
});

/**
 * The distinct axis sets, emitted ONCE per response.
 *
 * Each class names its set rather than carrying a copy. The axis descriptors
 * run to about 3.3 KB apiece and seventeen classes share seven sets, so
 * inlining them cost 53 KB of pure repetition on every request.
 *
 * `munition_delivery` is phase 5's set and is deliberately NOT named by any
 * class. It is a second, parallel description of the offensive weapon rows --
 * reported beside the damage axes, never merged into `weapon` -- so a consumer
 * that wants the delivery descriptors reads them by name and a consumer that
 * ranks on `weapon` cannot pick one up by accident.
 */
export const AXIS_SETS = Object.freeze({
  weapon: WEAPON_AXES,
  ship_hull: HULL_AXES,
  ship_armor: ARMOR_AXES,
  power_plant: POWER_PLANT_AXES,
  radiator: RADIATOR_AXES,
  heat_sink: HEAT_SINK_AXES,
  battery: BATTERY_AXES,
  munition_delivery: MUNITION_DELIVERY_AXES,
  none: Object.freeze([])
});

/** Every class spec, for a caller that wants the table without a snapshot. */
export const MILITARY_CLASS_SPECS = Object.freeze({
  weaponAxes: WEAPON_AXES,
  weaponRoles: WEAPON_CLASS_SPECS,
  components: COMPONENT_CLASS_SPECS,
  axisSets: AXIS_SETS
});
