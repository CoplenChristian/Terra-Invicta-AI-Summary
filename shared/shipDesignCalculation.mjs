// shared/shipDesignCalculation.mjs
//
// Purpose: compose one chosen ship design into its performance, mass, power,
//   heat, resource bill, crew and shipyard build-time readout.

// This module is deliberately a calculator, not a catalogue or an endpoint.
// Callers pass the selected component records (or catalogue rows) in; no
// filesystem or runtime state is read here. That keeps the calculation pure
// and lets the local server and a future worker use the same arithmetic.

import * as campaignSettingsModel from './campaignSettings.mjs';
import { parseCatalogueNumber } from './shipComponentCatalogue.mjs';
import {
  accelerationMps2,
  deltaVKps,
  effectiveExhaustVelocity
} from './propulsion.mjs';
import {
  estimateShipBuildDays,
  shipBuildDaysFromSnapshot
} from './shipBuildTime.mjs';
import { asArray } from './util.mjs';

/** The resource vector used by the ship construction bill. */
export const SHIP_DESIGN_MATERIALS = Object.freeze([
  'water',
  'volatiles',
  'metals',
  'nobleMetals',
  'fissiles',
  'exotics',
  'antimatter'
]);

/**
 * The cost rate is a named constant because it is corroborated, not measured
 * in-game. Keeping the evidence beside the value makes a later correction a
 * one-line change rather than a search for scattered `0.1` literals.
 */
export const RESOURCE_COST_RATE_UNITS_PER_TON = 0.1;
export const RESOURCE_COST_RATE = Object.freeze({
  value: RESOURCE_COST_RATE_UNITS_PER_TON,
  units: 'resource units per metric ton',
  status: 'corroborated twice; not directly measured in the in-game designer',
  sources: Object.freeze([
    'UICodex: each 100-ton propellant tank requires 10 units of its material mix',
    'official wiki, Radiator List: 4 tons of crew cost 0.2 water + 0.2 volatiles = 0.4 units'
  ])
});

/** Propellant tank mass, as stated by the codex. */
export const PROPELLANT_TANK_MASS_TONS = 100;

/** Crew mass and the separate flat crew bill. */
export const CREW_MASS_TONS = 4;
export const CREW_RESOURCE_COST_PER_PERSON = Object.freeze({
  water: 0.2,
  volatiles: 0.2,
  metals: 0,
  nobleMetals: 0,
  fissiles: 0,
  exotics: 0,
  antimatter: 0
});

/** The save setting's two possible armour-volume scales. */
export const ARMOUR_SCALE_MULTIPLIERS = Object.freeze({
  cinematic: Object.freeze({
    mode: 'cinematic',
    cinematicCombatRealismScale: true,
    nose: 1,
    tail: 1,
    side: 0.75
  }),
  realistic: Object.freeze({
    mode: 'realistic',
    cinematicCombatRealismScale: false,
    nose: 3,
    tail: 3,
    side: 0.5
  })
});

export const POWER_FORMULAE = Object.freeze({
  systems: 'systemsGW = 1.1 * (crew * 0.000005 + hullConstructionTier * 0.005 + sum(utilityMW) * 0.001)',
  weapons: 'weaponsGW = sum(nonSelfPoweredWeaponPowerPerShotGJ / min(cooldownS, intraSalvoCooldownS))',
  propulsion: 'propulsionGW = 0 if self-powered, otherwise thrustN * driveEV_kps * 0.5e-6 / driveEfficiency',
  plantSizing: 'plantSizingGW = max(propulsionGW, systemsGW)',
  thrustScaling: 'thrustScalingFactor = min(1, plantOutputGW / propulsionGW)'
});

export const HEAT_FORMULAE = Object.freeze({
  wasteHeat: 'wasteHeatGW = heatPowerGW * (1 - powerPlant.efficiency)',
  radiatorMass: 'radiatorMassKg = wasteHeatGW * 1e6 / radiator.specificPower_2s_KWkg',
  openCycle: 'open-cycle heatPowerGW = systemsGW + weaponsGW; drive propulsion heat leaves with propellant',
  closedCycle: 'closed-cycle heatPowerGW = systemsGW + weaponsGW + propulsionGW'
});

export const ARMOUR_FORMULAE = Object.freeze({
  plate: 'plateThicknessM = 20 / heatofVaporization_MJkg / density_kgm3 / 0.005',
  nose: 'noseVolumeM3 = plateThicknessM * nosePoints * pi * (hullWidthM / 2 + sideThicknessM)^2',
  tail: 'tailVolumeM3 = plateThicknessM * tailPoints * pi * (hullWidthM / 2 + sideThicknessM)^2',
  side: 'sideVolumeM3 = pi * hullLengthM * ((hullWidthM / 2 + sideThicknessM)^2 - (hullWidthM / 2)^2)',
  mass: 'armourMassKg = scaledVolumeM3 * density_kgm3'
});

const MATERIAL_MIX_ROUNDING_TOLERANCE = 0.005;
const KG_PER_TON = 1000;
const DRIVE_VARIANT_PATTERN = /^(.*)x([1-6])$/i;

const isRecord = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value);

const hasOwn = (record, key) => isRecord(record)
  && Object.prototype.hasOwnProperty.call(record, key);

const finite = (value) => parseCatalogueNumber(value);

const firstPresent = (record, aliases) => {
  for (const alias of aliases) {
    if (hasOwn(record, alias)) return { present: true, value: record[alias] };
  }
  return { present: false, value: undefined };
};

/** Read a field through the common catalogue-row wrappers without coercion. */
const rawField = (record, aliases) => {
  const layers = [
    record,
    record?.stats,
    record?.component,
    record?.item,
    record?.template
  ];
  for (const layer of layers) {
    const found = firstPresent(layer, aliases);
    if (found.present && found.value !== undefined) return found;
  }
  return { present: false, value: undefined };
};

const numberField = (record, aliases) => {
  const layers = [
    record,
    record?.stats,
    record?.component,
    record?.item,
    record?.template
  ];
  for (const layer of layers) {
    for (const alias of aliases) {
      if (!hasOwn(layer, alias) || layer[alias] === undefined) continue;
      const parsed = finite(layer[alias]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
};

const textField = (record, aliases) => {
  const layers = [
    record,
    record?.stats,
    record?.component,
    record?.item,
    record?.template
  ];
  for (const layer of layers) {
    for (const alias of aliases) {
      if (!hasOwn(layer, alias) || typeof layer[alias] !== 'string') continue;
      const value = layer[alias].trim();
      if (value !== '') return value;
    }
  }
  return null;
};

const booleanValue = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
};

const booleanField = (record, aliases) => {
  const found = rawField(record, aliases);
  return found.present ? booleanValue(found.value) : null;
};

const identityOf = (record) => {
  if (typeof record === 'string' && record.trim() !== '') return record.trim();
  if (!isRecord(record)) return null;
  for (const key of ['id', 'dataName', 'templateName', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
};

const displayNameOf = (record) => {
  const direct = textField(record, ['displayName', 'friendlyName', '_displayName']);
  return direct || identityOf(record);
};

const emptyMaterials = () => Object.fromEntries(
  SHIP_DESIGN_MATERIALS.map(material => [material, 0])
);

const addMaterials = (target, addition) => {
  for (const material of SHIP_DESIGN_MATERIALS) target[material] += addition[material];
  return target;
};

const scaleMaterials = (materials, factor) => Object.fromEntries(
  SHIP_DESIGN_MATERIALS.map(material => [material, materials[material] * factor])
);

const sumKnown = (values, reason) => {
  if (values.some(value => value === null)) return { value: null, reason };
  return { value: values.reduce((sum, value) => sum + value, 0), reason: null };
};

const maxKnown = (values, reason) => {
  if (values.some(value => value === null)) return { value: null, reason };
  return { value: Math.max(...values), reason: null };
};

const familyAliases = Object.freeze({
  drives: ['drives'],
  reactors: ['reactors', 'power_plant'],
  radiators: ['radiators', 'radiator'],
  hulls: ['hulls', 'ship_hull'],
  utilityModules: ['utilityModules', 'utility_module'],
  armour: ['armour', 'armor', 'ship_armor'],
  batteries: ['batteries', 'battery'],
  weapons: ['weapons', 'weapon', 'weaponTemplates']
});

const rowsForFamily = (source, family) => {
  if (!source || typeof source !== 'object') return [];
  const roots = [source, source.families, source.componentStats];
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    for (const key of familyAliases[family] || [family]) {
      const candidate = root[key];
      if (Array.isArray(candidate)) return candidate;
      if (isRecord(candidate)) {
        if (Array.isArray(candidate.items)) return candidate.items;
        return Object.entries(candidate).map(([id, stats]) => ({ id, stats }));
      }
    }
  }
  return [];
};

const mergeSelected = (catalogueRow, selected) => {
  if (!catalogueRow) return selected;
  if (!isRecord(selected)) return catalogueRow;
  return {
    ...catalogueRow,
    ...selected,
    stats: isRecord(catalogueRow.stats) || isRecord(selected.stats)
      ? { ...(catalogueRow.stats || {}), ...(selected.stats || {}) }
      : undefined
  };
};

const resolveSelection = (selection, family, source) => {
  if (selection === null || selection === undefined) return null;
  const id = identityOf(selection);
  const rows = rowsForFamily(source, family);
  const found = id
    ? rows.find(row => identityOf(row) === id)
    : null;
  if (typeof selection === 'string') return found || { id: selection };
  if (typeof selection === 'number') return found || { id: String(selection) };
  return mergeSelected(found, selection);
};

const driveVariantStats = (record) => asArray(record?.variants);

// Catalogue rows keep construction stats under `stats`; the established
// propulsion helper intentionally accepts the raw drive shape (`EV_kps` and
// `propellant` at the top level). Flatten only the selected drive copy so the
// helper is reused without teaching it a second row format.
const flattenDriveStats = (record) => isRecord(record) && isRecord(record.stats)
  ? { ...record, ...record.stats }
  : record;

const driveVariantCount = (record, explicitCount) => {
  const direct = explicitCount !== undefined ? finite(explicitCount) : null;
  if (direct !== null) return direct;
  const selected = numberField(record, ['thrusterCount', 'thrusters']);
  if (selected !== null) return selected;
  const id = identityOf(record);
  const match = id ? id.match(DRIVE_VARIANT_PATTERN) : null;
  return match ? finite(match[2]) : 1;
};

const validThrusterCount = (count) => Number.isInteger(count) && count >= 1 && count <= 6;

const linearlyScaleDrive = (record, count) => {
  const scaled = { ...record, thrusterCount: count };
  const fields = [
    ['thrust_N', ['thrust_N']],
    ['reqPowerGW', ['reqPowerGW', 'req power', 'req_power', 'reqPower']],
    ['thrustRatingGW', ['thrustRatingGW', 'thrustRating_GW']],
    ['flatMass_tons', ['flatMass_tons', 'flatMassTons']]
  ];
  for (const [canonical, aliases] of fields) {
    const value = numberField(record, aliases);
    scaled[canonical] = value === null ? null : value * count;
  }
  return scaled;
};

/**
 * Resolve a base drive plus a 1–6 thruster count.
 *
 * An explicit catalogue ladder wins. When only an x1/base record is supplied,
 * the owner's confirmed linear thruster mechanic is used and its basis is
 * reported. A supplied partial ladder is not extrapolated: a missing selected
 * variant is unknown rather than a fabricated row.
 */
const resolveDrive = (selection, explicitCount, source) => {
  const base = flattenDriveStats(resolveSelection(selection, 'drives', source));
  const count = driveVariantCount(base, explicitCount);
  if (!validThrusterCount(count)) {
    return {
      record: null,
      count,
      reason: 'thruster count must be an integer from 1 through 6'
    };
  }
  if (!base) return { record: null, count, reason: 'drive is not selected' };

  const variants = driveVariantStats(base);
  if (variants.length > 0) {
    const selected = variants.find(variant => {
      const variantCount = numberField(variant, ['thrusterCount', 'thrusters']);
      return variantCount === count;
    }) || variants.find(variant => {
      const id = identityOf(variant);
      const match = id ? id.match(DRIVE_VARIANT_PATTERN) : null;
      return match && finite(match[2]) === count;
    });
    if (!selected) {
      return {
        record: null,
        count,
        reason: `drive has no supplied x${count} variant; the partial ladder is not extrapolated`
      };
    }
    const record = flattenDriveStats({
      ...base,
      ...selected,
      stats: { ...(base.stats || {}), ...(selected.stats || {}) },
      thrusterCount: count
    });
    return { record, count, basis: 'catalogue-variant' };
  }

  const id = identityOf(base);
  const suffix = id?.match(DRIVE_VARIANT_PATTERN);
  if (suffix && finite(suffix[2]) !== count) {
    return {
      record: null,
      count,
      reason: `selected drive is x${suffix[2]}, not the requested x${count}, and no ladder was supplied`
    };
  }

  return {
    record: count === 1 || !suffix || finite(suffix[2]) === 1
      ? (count === 1 ? { ...base, thrusterCount: count } : linearlyScaleDrive(flattenDriveStats(base), count))
      : { ...base, thrusterCount: count },
    count,
    basis: count === 1 ? 'supplied-drive-record' : 'linear-thruster-mechanic'
  };
};

const componentLike = (value) => isRecord(value) && (
  hasOwn(value, 'id')
  || hasOwn(value, 'dataName')
  || hasOwn(value, 'massTons')
  || hasOwn(value, 'mass_tons')
  || hasOwn(value, 'mount')
  || hasOwn(value, 'powerRequirementMW')
  || hasOwn(value, 'powerRequirement_MW')
  || hasOwn(value, 'weightedBuildMaterials')
);

const selectionWrapperLike = (value) => isRecord(value) && (
  hasOwn(value, 'component')
  || hasOwn(value, 'item')
  || hasOwn(value, 'module')
  || hasOwn(value, 'weapon')
  || hasOwn(value, 'utility')
);

const listSourceEntries = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (componentLike(value) || selectionWrapperLike(value)) return [value];
  if (isRecord(value)) return Object.entries(value).map(([id, count]) => ({ component: id, count }));
  return [value];
};

const quantityFor = (wrapper, component) => {
  if (wrapper !== component) {
    const found = firstPresent(wrapper, ['count', 'quantity', 'amount', 'number']);
    if (found.present) return finite(found.value);
  }
  return 1;
};

const componentFor = (entry, family) => {
  if (!isRecord(entry)) return entry;
  for (const key of ['component', 'item', 'module', 'weapon', family === 'utilityModules' ? 'utility' : '']) {
    if (key && hasOwn(entry, key)) return entry[key];
  }
  return entry;
};

const normalizeComponentList = (value, family, source) => {
  const items = [];
  const issues = [];
  for (const wrapper of listSourceEntries(value)) {
    const component = componentFor(wrapper, family);
    const quantity = quantityFor(wrapper, component);
    if (quantity === null || !Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
      issues.push({ id: identityOf(component), reason: `${family} quantity must be a non-negative integer` });
      continue;
    }
    if (quantity === 0) continue;
    const resolved = resolveSelection(component, family, source);
    if (!resolved) {
      issues.push({ id: identityOf(component), reason: `${family} component is not selected` });
      continue;
    }
    items.push({
      component: resolved,
      quantity,
      family: textField(wrapper, ['family', 'templateFamily', 'weaponFamily', 'weaponType', 'type', 'classification'])
        || textField(resolved, ['family', 'templateFamily', 'weaponFamily', 'weaponType', 'type', 'classification'])
        || null
    });
  }
  return { items, issues };
};

const materialMapFrom = (record) => {
  const found = rawField(record, ['weightedBuildMaterials', 'materials', 'buildMaterials']);
  if (!found.present || !isRecord(found.value)) {
    return { available: false, values: null, sum: null, residual: null, reason: 'weighted build-material mix is not present' };
  }
  const values = {};
  for (const material of SHIP_DESIGN_MATERIALS) {
    // An omitted key is a measured zero in the template mix. An explicit null
    // is different: it says the component's share was not readable.
    values[material] = hasOwn(found.value, material) ? finite(found.value[material]) : 0;
    if (values[material] === null) {
      return {
        available: false,
        values: null,
        sum: null,
        residual: null,
        reason: `material share '${material}' is unparseable`
      };
    }
  }
  const sum = SHIP_DESIGN_MATERIALS.reduce((total, material) => total + values[material], 0);
  const residual = 1 - sum;
  const roundingResidual = Math.abs(residual) <= MATERIAL_MIX_ROUNDING_TOLERANCE;
  return {
    available: roundingResidual,
    values,
    sum,
    residual,
    roundingResidual: roundingResidual && residual !== 0,
    reason: roundingResidual
      ? null
      : `material mix sums to ${sum}; the known shortfall/overrun is not normalised`
  };
};

const materialMapFor = (record, override) => {
  if (override !== undefined) {
    if (!isRecord(override)) return { available: false, values: null, sum: null, residual: null, reason: 'propellant material mix is not an object' };
    return materialMapFrom({ weightedBuildMaterials: override });
  }
  return materialMapFrom(record);
};

const resolvePropellantTanks = (raw, drive) => {
  if (raw === null || raw === undefined) {
    return {
      count: null,
      massTons: null,
      materials: null,
      propellant: textField(drive, ['propellant']),
      reason: 'propellant tank count or mass is not supplied'
    };
  }
  const object = isRecord(raw) ? raw : null;
  const count = object
    ? numberField(object, ['count', 'tanks', 'quantity', 'number'])
    : finite(raw);
  if (count !== null && (!Number.isInteger(count) || count < 0)) {
    return { count, massTons: null, materials: null, propellant: textField(drive, ['propellant']), reason: 'propellant tank count must be a non-negative integer' };
  }
  const massFound = object ? rawField(object, ['massTons', 'mass_tons']) : { present: false, value: undefined };
  const massTons = massFound.present
    ? finite(massFound.value)
    : (count === null ? null : count * PROPELLANT_TANK_MASS_TONS);
  const mixFound = object
    ? rawField(object, ['weightedBuildMaterials', 'materials', 'perTankPropellantMaterials'])
    : { present: false, value: undefined };
  const driveMix = rawField(drive, ['perTankPropellantMaterials', 'perTankPropellantMaterial', 'propellantMaterials']);
  const materials = mixFound.present
    ? mixFound.value
    : (driveMix.present ? driveMix.value : null);
  return {
    count,
    massTons,
    materials,
    propellant: textField(object || drive, ['propellant']) || textField(drive, ['propellant']),
    reason: massTons === null ? 'propellant tank mass is not measurable' : null
  };
};

const scaleForMode = (mode) => {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : null;
  return normalized === 'cinematic'
    ? ARMOUR_SCALE_MULTIPLIERS.cinematic
    : (normalized === 'realistic' ? ARMOUR_SCALE_MULTIPLIERS.realistic : null);
};

const scaleResult = (value, source, overridden = false) => {
  const parsed = booleanValue(value);
  if (parsed === null) return null;
  const scale = parsed ? ARMOUR_SCALE_MULTIPLIERS.cinematic : ARMOUR_SCALE_MULTIPLIERS.realistic;
  return {
    available: true,
    value: parsed,
    mode: scale.mode,
    noseMultiplier: scale.nose,
    tailMultiplier: scale.tail,
    sideMultiplier: scale.side,
    source,
    overridden,
    reason: null
  };
};

const scaleFromMode = (mode, source, overridden = false) => {
  const scale = scaleForMode(mode);
  if (!scale) return null;
  return {
    available: true,
    value: scale.cinematicCombatRealismScale,
    mode: scale.mode,
    noseMultiplier: scale.nose,
    tailMultiplier: scale.tail,
    sideMultiplier: scale.side,
    source,
    overridden,
    reason: null
  };
};

const scaleValueInBlock = (block) => {
  if (!isRecord(block)) return { present: false, value: undefined };
  const direct = firstPresent(block, ['cinematicCombatRealismScale']);
  if (direct.present) {
    return {
      present: true,
      value: isRecord(direct.value) ? direct.value.value : direct.value
    };
  }
  const settings = block.settings;
  if (isRecord(settings)) {
    const setting = firstPresent(settings, ['cinematicCombatRealismScale']);
    if (setting.present) {
      return {
        present: true,
        value: isRecord(setting.value) ? setting.value.value : setting.value
      };
    }
  }
  return { present: false, value: undefined };
};

const globalScenarioCustomizationCandidates = (save) => {
  const candidates = [];
  const maps = [save?.gamestates, save?.rawSave?.gamestates];
  for (const gamestates of maps) {
    if (!isRecord(gamestates)) continue;
    for (const [stateName, rawRows] of Object.entries(gamestates)) {
      if (!/TIGlobalValuesState$/.test(stateName)) continue;
      const rows = Array.isArray(rawRows) ? rawRows : Object.values(rawRows || {});
      for (const row of rows) {
        const value = row?.Value ?? row;
        if (isRecord(value?.scenarioCustomizations)) candidates.push({ value: value.scenarioCustomizations, source: 'save:TIGlobalValuesState.scenarioCustomizations' });
        if (isRecord(value)) candidates.push({ value, source: 'save:TIGlobalValuesState' });
      }
    }
  }
  return candidates;
};

const campaignScaleCandidates = (input) => {
  const candidates = [];
  const add = (value, source) => {
    if (isRecord(value)) candidates.push({ value, source });
  };
  add(input?.campaignSettings, 'campaignSettings');
  add(input?.snapshot?.campaignSettings, 'snapshot.campaignSettings');
  add(input?.snapshot?.metadata?.campaignSettings, 'snapshot.metadata.campaignSettings');
  add(input?.save?.campaignSettings, 'save.campaignSettings');
  add(input?.rawSave?.campaignSettings, 'rawSave.campaignSettings');
  add(input?.scenarioCustomizations, 'scenarioCustomizations');
  add(input?.snapshot?.scenarioCustomizations, 'snapshot.scenarioCustomizations');
  add(input?.save?.scenarioCustomizations, 'save.scenarioCustomizations');
  add(input?.rawSave?.scenarioCustomizations, 'rawSave.scenarioCustomizations');
  return [...candidates, ...globalScenarioCustomizationCandidates(input?.save), ...globalScenarioCustomizationCandidates(input?.rawSave)];
};

const scaleFromCampaignSettings = (input) => {
  const moduleResolver = campaignSettingsModel.resolveCinematicCombatRealismScale;
  if (typeof moduleResolver === 'function') {
    for (const candidate of campaignScaleCandidates(input)) {
      try {
        const resolved = moduleResolver(candidate.value);
        const value = isRecord(resolved)
          ? (resolved.value ?? resolved.cinematicCombatRealismScale)
          : resolved;
        const fromResolver = scaleResult(value, 'shared/campaignSettings.mjs');
        if (fromResolver) return fromResolver;
      } catch {
        // A future settings adapter may reject a shape intended for another
        // caller. The raw paths below remain the explicit fallback.
      }
    }
  }
  for (const candidate of campaignScaleCandidates(input)) {
    const found = scaleValueInBlock(candidate.value);
    if (found.present) {
      const resolved = scaleResult(found.value, candidate.source);
      if (resolved) return resolved;
    }
  }
  return {
    available: false,
    value: null,
    mode: null,
    noseMultiplier: null,
    tailMultiplier: null,
    sideMultiplier: null,
    source: null,
    overridden: false,
    reason: 'cinematicCombatRealismScale was not read from campaign settings or the supplied save'
  };
};

/** Resolve the campaign scale, with a deliberate caller override path. */
export const resolveArmourScaling = (input = {}) => {
  const overrideMode = input.armourScaleMode
    ?? input.armorScaleMode
    ?? input.armourScaling?.mode
    ?? input.armorScaling?.mode;
  const fromMode = scaleFromMode(overrideMode, 'caller override', true);
  if (fromMode) return fromMode;

  const overrideFlag = input.armourScaleOverride
    ?? input.armorScaleOverride
    ?? input.armourScaling?.cinematicCombatRealismScale
    ?? input.armorScaling?.cinematicCombatRealismScale;
  const fromFlag = scaleResult(overrideFlag, 'caller override', true);
  if (fromFlag) return fromFlag;

  return scaleFromCampaignSettings(input);
};

const normalizedPoints = (value, label) => {
  const points = finite(value);
  if (points === null) return { value: null, reason: `${label} armour points are not readable` };
  if (points < 0) return { value: null, reason: `${label} armour points cannot be negative` };
  return { value: points, reason: null };
};

const armourScenario = ({ plate, density, width, length, nosePoints, lateralPoints, tailPoints, scale }) => {
  const sideThickness = plate * lateralPoints;
  const outerRadius = width / 2 + sideThickness;
  const innerRadius = width / 2;
  const rawNoseVolume = plate * nosePoints * Math.PI * outerRadius ** 2;
  const rawTailVolume = plate * tailPoints * Math.PI * outerRadius ** 2;
  const rawSideVolume = Math.PI * length * (outerRadius ** 2 - innerRadius ** 2);
  const noseVolume = rawNoseVolume * scale.nose;
  const tailVolume = rawTailVolume * scale.tail;
  const sideVolume = rawSideVolume * scale.side;
  const noseMassKg = noseVolume * density;
  const tailMassKg = tailVolume * density;
  const sideMassKg = sideVolume * density;
  return {
    mode: scale.mode,
    multipliers: {
      nose: scale.nose,
      tail: scale.tail,
      side: scale.side
    },
    volumesM3: {
      nose: noseVolume,
      tail: tailVolume,
      side: sideVolume,
      total: noseVolume + tailVolume + sideVolume
    },
    massesKg: {
      nose: noseMassKg,
      tail: tailMassKg,
      side: sideMassKg,
      total: noseMassKg + tailMassKg + sideMassKg
    },
    massTons: (noseMassKg + tailMassKg + sideMassKg) / KG_PER_TON
  };
};

const armourMassFor = ({ hull, material, nosePoints, lateralPoints, tailPoints, scaling }) => {
  const density = numberField(material, ['densityKgM3', 'density_kgm3']);
  const vaporization = numberField(material, ['heatOfVaporizationMJkg', 'heatofVaporization_MJkg']);
  const width = numberField(hull, ['widthM', 'width_m']);
  const length = numberField(hull, ['lengthM', 'length_m']);
  const points = {
    nose: normalizedPoints(nosePoints, 'nose'),
    lateral: normalizedPoints(lateralPoints, 'lateral'),
    tail: normalizedPoints(tailPoints, 'tail')
  };
  const missing = [
    density === null ? 'armour density is not readable' : null,
    vaporization === null ? 'armour heat of vaporization is not readable' : null,
    width === null ? 'hull width is not readable' : null,
    length === null ? 'hull length is not readable' : null,
    points.nose.reason,
    points.lateral.reason,
    points.tail.reason
  ].filter(Boolean);
  const base = {
    available: false,
    massKg: null,
    massTons: null,
    material: material ? { id: identityOf(material), displayName: displayNameOf(material) } : null,
    points: {
      nose: points.nose.value,
      lateral: points.lateral.value,
      tail: points.tail.value
    },
    plateThicknessM: null,
    thicknessM: { nose: null, lateral: null, tail: null },
    unscaledVolumesM3: null,
    scenarios: null,
    scaling,
    reason: missing.length > 0 ? missing[0] : null
  };
  if (missing.length > 0) return base;

  const plate = 20 / vaporization / density / 0.005;
  const scenarioInputs = {
    plate,
    density,
    width,
    length,
    nosePoints: points.nose.value,
    lateralPoints: points.lateral.value,
    tailPoints: points.tail.value
  };
  const unscaled = armourScenario({ ...scenarioInputs, scale: { mode: 'unscaled', nose: 1, tail: 1, side: 1 } });
  const scenarios = {
    cinematic: armourScenario({ ...scenarioInputs, scale: ARMOUR_SCALE_MULTIPLIERS.cinematic }),
    realistic: armourScenario({ ...scenarioInputs, scale: ARMOUR_SCALE_MULTIPLIERS.realistic })
  };
  const selected = scaling?.available === true
    ? scenarios[scaling.mode]
    : null;
  return {
    ...base,
    available: Boolean(selected),
    massKg: selected ? selected.massesKg.total : null,
    massTons: selected ? selected.massTons : null,
    plateThicknessM: plate,
    thicknessM: {
      nose: plate * points.nose.value,
      lateral: plate * points.lateral.value,
      tail: plate * points.tail.value
    },
    unscaledVolumesM3: {
      nose: unscaled.volumesM3.nose,
      tail: unscaled.volumesM3.tail,
      side: unscaled.volumesM3.side,
      total: unscaled.volumesM3.total
    },
    scenarios,
    reason: selected ? null : scaling?.reason || 'armour scaling mode is unknown, so armour mass is not resolved'
  };
};

/**
 * Public armour helper. The full composer calls the same implementation after
 * it has resolved the campaign setting and the selected facing values.
 */
export function calculateArmourMass({ hull, material, armour, nosePoints, lateralPoints, tailPoints, scaling } = {}) {
  const config = isRecord(armour) ? armour : null;
  const resolvedMaterial = material || config?.material || config?.materialRecord || config;
  const resolvedScaling = typeof scaling === 'string'
    ? scaleFromMode(scaling, 'caller supplied scale', true)
    : scaling;
  return armourMassFor({
    hull,
    material: resolvedMaterial,
    nosePoints: nosePoints ?? config?.nosePoints ?? config?.nose,
    lateralPoints: lateralPoints ?? config?.lateralPoints ?? config?.sidePoints ?? config?.lateral ?? config?.side,
    tailPoints: tailPoints ?? config?.tailPoints ?? config?.tail,
    scaling: resolvedScaling
  });
}

const utilityPropellantModules = (utilityItems, supplied) => {
  const modules = { ...(isRecord(supplied) ? supplied : {}) };
  for (const item of utilityItems) {
    const module = item.component;
    const id = identityOf(module);
    if (!id) continue;
    const rules = asArray(rawField(module, ['specialModuleRules', 'specialModuleRules']).value);
    const evMultiplier = numberField(module, ['evMultiplier', 'specialModuleValue']);
    const hasEvRule = rules.includes('EVMultiplier') || evMultiplier !== null;
    if (!hasEvRule || modules[id]) continue;
    modules[id] = {
      displayName: displayNameOf(module) || id,
      evMultiplier,
      requiresHydrogenPropellant: rules.includes('RequiresHydrogenPropellant')
    };
  }
  return modules;
};

const drivePower = (drive, effectiveEvKps) => {
  const stored = numberField(drive, ['reqPowerGW', 'req power', 'req_power', 'reqPower']);
  const thrustRating = numberField(drive, ['thrustRatingGW', 'thrustRating_GW']);
  const baseEv = numberField(drive, ['EV_kps']);
  const thrust = numberField(drive, ['thrust_N']);
  const efficiency = numberField(drive, ['efficiency']);
  const explicitSelfPowered = booleanField(drive, ['selfPowered', 'isSelfPowered']);
  const inferredSelfPowered = explicitSelfPowered !== null
    ? explicitSelfPowered
    : (stored === null ? null : stored === 0);
  let modelled = null;
  let modelReason = null;
  if (inferredSelfPowered === true) {
    modelled = 0;
  } else if (inferredSelfPowered === false) {
    if (thrust === null || baseEv === null || efficiency === null || efficiency <= 0) {
      modelReason = 'drive thrust, base EV or positive drive efficiency is not readable';
    } else {
      modelled = thrust * baseEv * 0.5e-6 / efficiency;
    }
  } else {
    modelReason = 'drive self-powered state is not readable and req power is absent';
  }
  const required = stored !== null ? stored : modelled;
  const source = stored !== null ? 'drive req power field' : (modelled !== null ? 'wiki propulsion-power formula' : null);
  const agreement = stored !== null && modelled !== null && stored !== 0
    ? { modelledGW: modelled, storedGW: stored, ratio: modelled / stored }
    : null;
  return {
    requiredGW: required,
    storedReqPowerGW: stored,
    modelledGW: modelled,
    thrustRatingGW: thrustRating,
    baseEvKps: baseEv,
    driveEfficiency: efficiency,
    selfPowered: inferredSelfPowered,
    source,
    agreement,
    formula: POWER_FORMULAE.propulsion,
    reason: required === null ? (modelReason || 'drive propulsion power is not measurable') : null,
    effectiveEvKps
  };
};

const selfPoweredWeaponState = (weapon, family) => {
  const explicit = booleanField(weapon, ['selfPowered', 'isSelfPowered']);
  if (explicit !== null) return { value: explicit, source: 'weapon record' };
  const normalized = typeof family === 'string'
    ? family.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : null;
  if (normalized === 'gun'
    || normalized === 'guns'
    || normalized === 'missile'
    || normalized === 'missiles'
    || normalized === 'magneticgun'
    || normalized === 'magnetic_gun'
    || normalized === 'magneticguns'
    || normalized === 'magnetic_guns'
    || normalized === 'railgun'
    || normalized === 'railguns') {
    return { value: true, source: 'game rule: naval guns and missiles are self-powered/no-heat weapons' };
  }
  if (['laser_weapon', 'particle_weapon', 'plasma_weapon', 'laser', 'particle', 'plasma'].includes(normalized)) {
    return { value: false, source: 'weapon family power rule' };
  }
  return { value: null, source: null };
};

const weaponPower = (item) => {
  const weapon = item.component;
  const family = item.family;
  const selfPowered = selfPoweredWeaponState(weapon, family);
  const base = {
    id: identityOf(weapon),
    displayName: displayNameOf(weapon),
    family,
    quantity: item.quantity,
    selfPowered: selfPowered.value,
    selfPoweredSource: selfPowered.source,
    powerPerShotGJ: null,
    intervalS: null,
    powerGW: null,
    reason: null
  };
  if (selfPowered.value === true) return { ...base, powerGW: 0, reason: null };
  if (selfPowered.value === null) return { ...base, reason: 'weapon self-powered state is not readable' };

  const powerPerShot = numberField(weapon, [
    'powerPerShotGJ',
    'powerPerShot_GJ',
    'powerUsedPerShotGJ',
    'powerUsedPerShot_GJ'
  ]);
  const shotPowerGJ = numberField(weapon, ['shotPowerGJ', 'shotPower_GJ']);
  const shotPowerMJ = numberField(weapon, ['shotPowerMJ', 'shotPower_MJ']);
  const chargingEnergyGJ = numberField(weapon, ['chargingEnergyGJ', 'chargingEnergy_GJ']);
  const chargingEnergyMJ = numberField(weapon, ['chargingEnergyMJ', 'chargingEnergy_MJ']);
  const perShot = powerPerShot !== null
    ? powerPerShot
    : (shotPowerGJ !== null
      ? shotPowerGJ
      : (shotPowerMJ !== null
        ? shotPowerMJ / 1000
        : (chargingEnergyGJ !== null ? chargingEnergyGJ : (chargingEnergyMJ !== null ? chargingEnergyMJ / 1000 : null))));
  const cooldown = numberField(weapon, ['cooldownS', 'cooldown_s']);
  const intraFound = rawField(weapon, ['intraSalvoCooldownS', 'intraSalvoCooldown_s']);
  const intra = intraFound.present ? finite(intraFound.value) : cooldown;
  const interval = cooldown === null || intra === null ? null : Math.min(cooldown, intra);
  if (perShot === null) return { ...base, reason: 'non-self-powered weapon power-per-shot is not measurable' };
  if (interval === null || interval <= 0) return { ...base, powerPerShotGJ: perShot, reason: 'weapon cooldown interval is not measurable or positive' };
  return {
    ...base,
    powerPerShotGJ: perShot,
    intervalS: interval,
    powerGW: item.quantity * perShot / interval,
    reason: null
  };
};

const readArmourMaterial = (input, source) => {
  const raw = input.armour ?? input.armor ?? input.armourMaterial ?? input.armorMaterial;
  if (isRecord(raw)) {
    const candidate = raw.material || raw.materialRecord || raw.component || raw.template;
    if (candidate) return resolveSelection(candidate, 'armour', source);
    if (numberField(raw, ['densityKgM3', 'density_kgm3']) !== null) return raw;
    const id = identityOf(raw);
    if (id) return resolveSelection(raw, 'armour', source);
  }
  if (typeof raw === 'string') return resolveSelection(raw, 'armour', source);
  const facing = input.noseArmor || input.noseArmour || input.lateralArmor || input.lateralArmour || input.tailArmor || input.tailArmour;
  const materialName = textField(facing, ['materialName', 'material', 'id', 'dataName']);
  return materialName ? resolveSelection(materialName, 'armour', source) : null;
};

const readArmourPoints = (input, rawArmour) => {
  const points = rawArmour && isRecord(rawArmour) ? rawArmour.points : null;
  const noseFacing = input.noseArmor || input.noseArmour;
  const lateralFacing = input.lateralArmor || input.lateralArmour || input.sideArmor || input.sideArmour;
  const tailFacing = input.tailArmor || input.tailArmour;
  const point = (directAliases, facing, nestedAliases) => {
    const direct = firstPresent(input, directAliases);
    if (direct.present) return direct.value;
    const fromArmour = firstPresent(rawArmour, nestedAliases);
    if (fromArmour.present) return fromArmour.value;
    const fromPoints = firstPresent(points, nestedAliases);
    if (fromPoints.present) return fromPoints.value;
    const fromFacing = firstPresent(facing, ['armorValue', 'armourValue', 'points', 'value']);
    return fromFacing.present ? fromFacing.value : undefined;
  };
  return {
    nose: point(['nosePoints', 'noseArmorPoints', 'noseArmourPoints'], noseFacing, ['nosePoints', 'nose']),
    lateral: point(['lateralPoints', 'sidePoints', 'lateralArmorPoints', 'lateralArmourPoints'], lateralFacing, ['lateralPoints', 'sidePoints', 'lateral', 'side']),
    tail: point(['tailPoints', 'tailArmorPoints', 'tailArmourPoints'], tailFacing, ['tailPoints', 'tail'])
  };
};

const hullBuildRecord = (hull) => ({
  name: identityOf(hull),
  baseConstructionTimeDays: numberField(hull, ['baseConstructionTimeDays', 'baseConstructionTime_days']),
  constructionTier: numberField(hull, ['constructionTier', 'consTier']),
  noShipyardBuild: booleanField(hull, ['noShipyardBuild'])
});

const buildTimeFor = (input, hull) => {
  const context = input.buildContext || input.build || {};
  const snapshot = input.snapshot || context.snapshot;
  const shipyard = input.shipyard || context.shipyard;
  const shipyardId = input.shipyardId || context.shipyardId;
  const factionModifier = input.factionModifier || context.factionModifier;
  if (!shipyard && snapshot && shipyardId) {
    return shipBuildDaysFromSnapshot(snapshot, {
      hullName: identityOf(hull),
      shipyardId,
      factionId: input.factionId || context.factionId || null,
      shipConstructionSpeed: input.shipConstructionSpeed || context.shipConstructionSpeed || null,
      effectNames: input.effectNames || context.effectNames || null
    });
  }
  return estimateShipBuildDays({
    hull: hullBuildRecord(hull),
    shipyard,
    factionModifier
  });
};

const componentMassEntry = ({ key, id, displayName, massTons, record, quantity = 1, kind = 'component', materials = undefined, wetOnly = false, reason = null }) => ({
  key,
  id: id === undefined ? identityOf(record) : id,
  displayName: displayName || displayNameOf(record),
  kind,
  quantity,
  massTons,
  massKg: massTons === null ? null : massTons * KG_PER_TON,
  wetOnly,
  materials: materials === undefined ? materialMapFrom(record) : materialMapFor(record, materials),
  reason
});

const entriesForList = (list, family, kind) => list.map((item, index) => componentMassEntry({
  key: `${kind}.${item.family || family}.${identityOf(item.component) || index}`,
  id: identityOf(item.component),
  displayName: displayNameOf(item.component),
  massTons: (() => {
    const mass = numberField(item.component, ['massTons', 'mass_tons', 'baseWeaponMassTons', 'baseWeaponMass_tons']);
    return mass === null ? null : mass * item.quantity;
  })(),
  record: item.component,
  quantity: item.quantity,
  kind,
  reason: numberField(item.component, ['massTons', 'mass_tons', 'baseWeaponMassTons', 'baseWeaponMass_tons']) === null
    ? `${kind} mass is not readable`
    : null
}));

const crewFor = (record, label) => {
  const crew = numberField(record, ['crew']);
  return crew === null ? { value: null, reason: `${label} crew is not readable` } : { value: crew, reason: null };
};

const costForEntry = (entry) => {
  if (entry.massTons === null) return { available: false, total: null, vector: null, reason: entry.reason || `${entry.key} mass is not readable`, mix: entry.materials };
  if (entry.massTons === 0) return { available: true, total: Object.freeze(emptyMaterials()), vector: emptyMaterials(), reason: null, mix: entry.materials };
  const mix = entry.materials;
  if (!mix?.available) return { available: false, total: null, vector: null, reason: `${entry.key}: ${mix?.reason || 'material mix is not readable'}`, mix };
  const vector = scaleMaterials(mix.values, entry.massTons * RESOURCE_COST_RATE_UNITS_PER_TON);
  return {
    available: true,
    total: vector,
    vector,
    reason: null,
    mix
  };
};

const crewCost = (crew) => {
  if (crew === null) return { available: false, total: null, reason: 'crew is not readable' };
  return {
    available: true,
    total: scaleMaterials(CREW_RESOURCE_COST_PER_PERSON, crew),
    reason: null
  };
};

const buildCost = (entries, crew) => {
  const costs = [];
  const total = emptyMaterials();
  const reasons = [];
  for (const entry of entries) {
    const cost = costForEntry(entry);
    costs.push({
      key: entry.key,
      id: entry.id,
      displayName: entry.displayName,
      massTons: entry.massTons,
      available: cost.available,
      cost: cost.total,
      mix: cost.mix,
      reason: cost.reason
    });
    if (cost.available) addMaterials(total, cost.vector);
    else reasons.push(cost.reason);
  }
  const people = crewCost(crew);
  costs.push({
    key: 'crew',
    id: null,
    displayName: 'Crew',
    massTons: crew === null ? null : crew * CREW_MASS_TONS,
    available: people.available,
    cost: people.total,
    mix: null,
    reason: people.reason
  });
  if (people.available) addMaterials(total, people.total);
  else reasons.push(people.reason);
  return {
    available: reasons.length === 0,
    total: reasons.length === 0 ? total : null,
    components: costs,
    reason: reasons.length === 0 ? null : [...new Set(reasons)].join('; '),
    rate: RESOURCE_COST_RATE,
    materials: SHIP_DESIGN_MATERIALS
  };
};

const componentCrewTotal = ({ hull, reactor, radiator, utilities, weapons, batteries }) => {
  const parts = [
    crewFor(hull, 'hull'),
    crewFor(reactor, 'reactor'),
    crewFor(radiator, 'radiator')
  ];
  const repeatedCrew = (items, kind) => {
    for (const item of items) {
      const reading = crewFor(item.component, `${kind} ${identityOf(item.component) || 'component'}`);
      parts.push(reading.value === null
        ? reading
        : { value: reading.value * item.quantity, reason: null });
    }
  };
  repeatedCrew(utilities, 'utility');
  repeatedCrew(weapons, 'weapon');
  repeatedCrew(batteries, 'battery');
  const total = sumKnown(parts.map(part => part.value), 'one or more selected component crew values are not readable');
  return {
    total: total.value,
    reason: total.reason,
    parts: parts.map(part => part.value)
  };
};

const utilityPower = (utilities) => {
  const values = utilities.map(item => {
    const power = numberField(item.component, ['powerRequirementMW', 'powerRequirement_MW']);
    return power === null ? null : power * item.quantity;
  });
  const result = sumKnown(values, 'one or more selected utility power requirements are not readable');
  return { mw: result.value, reason: result.reason };
};

const buildPower = ({ hull, drive, reactor, crew, utilities, weapons, effectiveEvKps }) => {
  const hullTier = numberField(hull, ['constructionTier', 'consTier']);
  const utility = utilityPower(utilities);
  const systems = crew === null || hullTier === null || utility.mw === null
    ? null
    : 1.1 * (crew * 0.000005 + hullTier * 0.005 + utility.mw * 0.001);
  const weaponRows = weapons.map(weaponPower);
  const weaponSum = sumKnown(weaponRows.map(row => row.powerGW), 'one or more selected weapon power requirements are not readable');
  const propulsion = drivePower(drive, effectiveEvKps);
  const plantSizing = maxKnown([propulsion.requiredGW, systems], 'propulsion or systems power is not readable');
  const maxOutput = numberField(reactor, ['maxOutputGW', 'maxOutput_GW']);
  const plantOutput = plantSizing.value === null || maxOutput === null
    ? null
    : Math.min(plantSizing.value, maxOutput);
  const reactorSpecificPower = numberField(reactor, ['specificPowerTGW', 'specificPower_tGW']);
  const reactorMassTons = plantOutput === null || reactorSpecificPower === null
    ? null
    : plantOutput * reactorSpecificPower;
  const totalPower = sumKnown([systems, weaponSum.value, propulsion.requiredGW], 'systems, weapons or propulsion power is not readable');
  const thrustScaling = propulsion.requiredGW === null
    ? { value: null, reason: propulsion.reason || 'propulsion power is not readable' }
    : (propulsion.requiredGW === 0
      ? { value: 1, reason: null }
      : (plantOutput === null
        ? { value: null, reason: 'reactor output is not readable' }
        : { value: Math.min(1, plantOutput / propulsion.requiredGW), reason: null }));
  const ratio = (numerator, denominator) => numerator === null || denominator === null || denominator <= 0 ? null : numerator / denominator;
  return {
    systemsGW: systems,
    systemsPowerMW: utility.mw,
    weaponsGW: weaponSum.value,
    weaponItems: weaponRows,
    propulsionGW: propulsion.requiredGW,
    propulsion: propulsion,
    totalGW: totalPower.value,
    totalReason: totalPower.reason,
    plantSizingGW: plantSizing.value,
    plantSizingReason: plantSizing.reason,
    reactorMaxOutputGW: maxOutput,
    plantOutputGW: plantOutput,
    plantOutputRatioToTotal: ratio(plantOutput, totalPower.value),
    propulsionPowerRatio: ratio(plantOutput, propulsion.requiredGW),
    thrustScalingFactor: thrustScaling.value,
    thrustScalingReason: thrustScaling.reason,
    underpowered: propulsion.requiredGW === null || plantOutput === null
      ? null
      : plantOutput < propulsion.requiredGW,
    reactorMassTons,
    reactorMassReason: reactorMassTons === null ? 'reactor output or specific power is not readable' : null,
    reactorEfficiency: numberField(reactor, ['efficiency']),
    formulae: POWER_FORMULAE
  };
};

const buildHeat = ({ drive, reactor, power, radiator }) => {
  const plantEfficiency = numberField(reactor, ['efficiency']);
  const openPower = sumKnown([power.systemsGW, power.weaponsGW], 'systems or weapons power is not readable');
  const closedPower = sumKnown([power.systemsGW, power.weaponsGW, power.propulsionGW], 'systems, weapons or propulsion power is not readable');
  const specificPower = numberField(radiator, ['specificPowerKWkg', 'specificPower_2s_KWkg']);
  const coolingRaw = textField(drive, ['cooling']);
  const cooling = coolingRaw ? coolingRaw.toLowerCase() : null;
  const waste = (heatPower) => plantEfficiency === null || heatPower === null
    ? null
    : heatPower * (1 - plantEfficiency);
  const radiatorMass = (wasteHeat) => specificPower === null || specificPower <= 0 || wasteHeat === null
    ? null
    : wasteHeat * 1e6 / specificPower;
  const scenarios = {};
  for (const [mode, heatPower] of [['Open', openPower.value], ['Closed', closedPower.value]]) {
    const wasteHeat = waste(heatPower);
    const massKg = radiatorMass(wasteHeat);
    scenarios[mode] = {
      cooling: mode,
      heatPowerGW: heatPower,
      wasteHeatGW: wasteHeat,
      radiatorMassKg: massKg,
      radiatorMassTons: massKg === null ? null : massKg / KG_PER_TON,
      reason: heatPower === null
        ? (mode === 'Open' ? openPower.reason : closedPower.reason)
        : (plantEfficiency === null ? 'power-plant efficiency is not readable' : (specificPower === null ? 'radiator specific power is not readable' : null))
    };
  }
  const selected = cooling === 'open'
    ? scenarios.Open
    : (cooling === 'closed' ? scenarios.Closed : null);
  const calcRange = cooling === 'calc';
  const rangeAvailable = scenarios.Open.radiatorMassTons !== null && scenarios.Closed.radiatorMassTons !== null;
  return {
    cooling: coolingRaw,
    coolingResolution: cooling === 'calc' ? 'unknown: both Open and Closed are reported' : coolingRaw,
    heatPowerGW: selected ? selected.heatPowerGW : null,
    wasteHeatGW: selected ? selected.wasteHeatGW : null,
    radiatorMassKg: selected ? selected.radiatorMassKg : null,
    radiatorMassTons: selected ? selected.radiatorMassTons : null,
    radiatorMassRangeTons: calcRange && rangeAvailable
      ? { Open: scenarios.Open.radiatorMassTons, Closed: scenarios.Closed.radiatorMassTons }
      : null,
    wasteHeatRangeGW: calcRange && scenarios.Open.wasteHeatGW !== null && scenarios.Closed.wasteHeatGW !== null
      ? { Open: scenarios.Open.wasteHeatGW, Closed: scenarios.Closed.wasteHeatGW }
      : null,
    scenarios,
    rangeLabel: calcRange ? 'Calc cooling: radiator requirement is a range across Open and Closed resolutions' : null,
    reason: selected
      ? selected.reason
      : (calcRange
        ? (rangeAvailable ? null : 'Calc cooling needs both Open and Closed heat resolutions, but one is unmeasured')
        : 'drive cooling is absent or is not one of Open, Closed or Calc'),
    formulae: HEAT_FORMULAE
  };
};

const sumMasses = (entries, reason) => sumKnown(entries.map(entry => entry.massTons), reason);

const buildMass = ({ hull, drive, reactor, radiator, armour, tanks, utilities, weapons, batteries, crew, power, heat }) => {
  const hullMass = numberField(hull, ['massTons', 'mass_tons']);
  const driveMass = numberField(drive, ['flatMass_tons', 'flatMassTons']);
  const tankEntry = componentMassEntry({
    key: 'propellantTanks',
    id: null,
    displayName: tanks.count === null ? 'Propellant tanks' : `${tanks.count} propellant tank(s)`,
    massTons: tanks.massTons,
    record: drive,
    quantity: tanks.count === null ? 1 : tanks.count,
    materials: tanks.materials,
    wetOnly: true,
    reason: tanks.reason
  });
  const entries = [
    componentMassEntry({ key: 'hull', record: hull, massTons: hullMass, reason: hullMass === null ? 'hull mass is not readable' : null }),
    componentMassEntry({ key: 'drive', record: drive, massTons: driveMass, reason: driveMass === null ? 'drive mass is not readable' : null }),
    componentMassEntry({ key: 'reactor', record: reactor, massTons: power.reactorMassTons, reason: power.reactorMassReason }),
    componentMassEntry({ key: 'radiator', record: radiator, massTons: heat.radiatorMassTons, reason: heat.reason }),
    componentMassEntry({ key: 'armour', record: armour.materialRecord, massTons: armour.massTons, reason: armour.reason }),
    ...entriesForList(utilities, 'utilityModules', 'utility'),
    ...entriesForList(weapons, 'weapons', 'weapon'),
    ...entriesForList(batteries, 'batteries', 'battery'),
    componentMassEntry({ key: 'crew', displayName: 'Crew', massTons: crew.total === null ? null : crew.total * CREW_MASS_TONS, quantity: crew.total === null ? 0 : crew.total, kind: 'crew', reason: crew.reason }),
    tankEntry
  ];
  const dryEntries = entries.filter(entry => !entry.wetOnly);
  const dry = sumMasses(dryEntries, 'one or more dry-mass components are not readable');
  const propellantMass = tanks.massTons;
  const wet = dry.value === null || propellantMass === null
    ? { value: null, reason: dry.value === null ? dry.reason : tanks.reason }
    : { value: dry.value + propellantMass, reason: null };
  const range = {};
  if (heat.radiatorMassRangeTons) {
    for (const [mode, radiatorMassTons] of Object.entries(heat.radiatorMassRangeTons)) {
      const alternativeEntries = entries.map(entry => entry.key === 'radiator' ? { ...entry, massTons: radiatorMassTons, massKg: radiatorMassTons * KG_PER_TON, reason: null } : entry);
      const dryAlternative = sumMasses(alternativeEntries.filter(entry => !entry.wetOnly), 'one or more dry-mass components are not readable');
      const wetAlternative = dryAlternative.value === null || propellantMass === null
        ? null
        : dryAlternative.value + propellantMass;
      range[mode] = {
        dryTons: dryAlternative.value,
        wetTons: wetAlternative,
        dryKg: dryAlternative.value === null ? null : dryAlternative.value * KG_PER_TON,
        wetKg: wetAlternative === null ? null : wetAlternative * KG_PER_TON
      };
    }
  }
  return {
    dryTons: dry.value,
    dryKg: dry.value === null ? null : dry.value * KG_PER_TON,
    wetTons: wet.value,
    wetKg: wet.value === null ? null : wet.value * KG_PER_TON,
    propellantTons: propellantMass,
    propellantKg: propellantMass === null ? null : propellantMass * KG_PER_TON,
    componentBreakdown: entries,
    range: Object.keys(range).length > 0 ? range : null,
    dryReason: dry.reason,
    wetReason: wet.reason,
    formula: 'dryMass = sum(hull, drive, reactor, radiator, armour, utilities, weapons, batteries, crew); wetMass = dryMass + propellant tank mass'
  };
};

const buildCostWithRadiator = ({ commonEntries, radiator, crew, radiatorMassTons }) => {
  const entries = commonEntries.map(entry => entry.key === 'radiator'
    ? { ...entry, massTons: radiatorMassTons, massKg: radiatorMassTons === null ? null : radiatorMassTons * KG_PER_TON, materials: materialMapFrom(radiator), reason: radiatorMassTons === null ? 'radiator mass is not resolved' : null }
    : entry);
  return buildCost(entries, crew.total);
};

const addReason = (map, key, reason) => {
  if (reason && !map[key]) map[key] = reason;
};

/**
 * Compose a selected combination into the server-side design readout.
 *
 * Required component records may be raw template-shaped objects or rows from
 * `buildShipComponentCatalogue`; list inputs accept either repeated records,
 * `{ component, count }` wrappers, or an `{ id: count }` map. Optional empty
 * utility/weapon/battery lists are a real zero. A missing required field is
 * kept as null and named under `reasons`.
 */
export function calculateShipDesign(input = {}) {
  const source = input.catalogue || input.snapshot || null;
  const hull = resolveSelection(input.hull, 'hulls', source);
  const driveResolution = resolveDrive(input.drive, input.thrusterCount, source);
  const drive = driveResolution.record;
  const reactor = resolveSelection(input.reactor || input.powerPlant, 'reactors', source);
  const radiator = resolveSelection(input.radiator, 'radiators', source);
  const armourRaw = input.armour ?? input.armor ?? input.armourMaterial ?? input.armorMaterial;
  const armourMaterial = readArmourMaterial(input, source);
  const armourPoints = readArmourPoints(input, isRecord(armourRaw) ? armourRaw : null);
  const scaling = resolveArmourScaling(input);
  const armour = armourMassFor({
    hull,
    material: armourMaterial,
    nosePoints: armourPoints.nose,
    lateralPoints: armourPoints.lateral,
    tailPoints: armourPoints.tail,
    scaling
  });
  const utilities = normalizeComponentList(input.utilityModules, 'utilityModules', source);
  const weapons = normalizeComponentList(input.weapons, 'weapons', source);
  const batteries = normalizeComponentList(input.batteries, 'batteries', source);
  const tanks = resolvePropellantTanks(input.propellantTanks, drive);

  const utilityModuleMap = utilityPropellantModules(utilities.items, input.propellantModules || input.snapshot?.propellantModules);
  const effectiveEv = drive
    ? effectiveExhaustVelocity(drive, {
      moduleTemplateEntries: utilities.items.map(item => ({ moduleName: identityOf(item.component) }))
    }, utilityModuleMap)
    : { baseEvKps: null, evKps: null, multiplier: null, appliedModules: [], inapplicableModules: [] };
  const crew = componentCrewTotal({
    hull,
    reactor,
    radiator,
    utilities: utilities.items,
    weapons: weapons.items,
    batteries: batteries.items
  });
  const power = buildPower({
    hull,
    drive,
    reactor,
    crew: crew.total,
    utilities: utilities.items,
    weapons: weapons.items,
    effectiveEvKps: effectiveEv.evKps
  });
  const heat = buildHeat({ drive, reactor, power, radiator });
  const mass = buildMass({
    hull,
    drive,
    reactor,
    radiator,
    armour: { ...armour, materialRecord: armourMaterial },
    tanks,
    utilities: utilities.items,
    weapons: weapons.items,
    batteries: batteries.items,
    crew,
    power,
    heat
  });

  const commonCostEntries = mass.componentBreakdown
    .filter(entry => entry.key !== 'crew' && entry.key !== 'radiator')
    .map(entry => {
      if (entry.key === 'armour') return { ...entry, materials: materialMapFrom(armourMaterial) };
      return entry;
    });
  commonCostEntries.push(componentMassEntry({
    key: 'radiator',
    record: radiator,
    massTons: heat.radiatorMassTons,
    materials: undefined,
    reason: heat.reason
  }));
  const cost = heat.radiatorMassTons !== null
    ? buildCost(commonCostEntries, crew.total)
    : {
      available: false,
      total: null,
      components: [],
      reason: heat.radiatorMassRangeTons
        ? 'radiator mass is a Calc-cooling range, so one total resource bill cannot be selected'
        : (heat.reason || 'radiator mass is not resolved'),
      rate: RESOURCE_COST_RATE,
      materials: SHIP_DESIGN_MATERIALS
    };
  if (heat.radiatorMassRangeTons) {
    const rangeCosts = {};
    for (const [mode, radiatorMassTons] of Object.entries(heat.radiatorMassRangeTons)) {
      const alternative = buildCostWithRadiator({
        commonEntries: commonCostEntries,
        radiator,
        crew,
        radiatorMassTons
      });
      rangeCosts[mode] = {
        available: alternative.available,
        total: alternative.total,
        reason: alternative.reason
      };
    }
    cost.range = rangeCosts;
    cost.rangeLabel = 'Calc cooling: cost range follows the Open/Closed radiator-mass range';
  }

  const performanceReason = (kind) => {
    if (mass.wetKg === null) return mass.wetReason || 'wet mass is not readable';
    if (kind === 'deltaV' && effectiveEv.evKps === null) return 'effective exhaust velocity is not readable';
    if (power.thrustScalingFactor === null) return power.thrustScalingReason || 'thrust scaling is not readable';
    if (numberField(drive, ['thrust_N']) === null) return 'drive thrust is not readable';
    return null;
  };
  const scaledThrust = power.thrustScalingFactor === null || numberField(drive, ['thrust_N']) === null
    ? null
    : numberField(drive, ['thrust_N']) * power.thrustScalingFactor;
  const deltaV = deltaVKps(effectiveEv.evKps, mass.wetKg, mass.dryKg);
  const cruise = accelerationMps2(scaledThrust, mass.wetKg, 1);
  const combat = accelerationMps2(scaledThrust, mass.wetKg, numberField(drive, ['thrustCap']));
  const performance = {
    cruiseAccelerationMps2: cruise,
    combatAccelerationMps2: combat,
    deltaVKps: deltaV,
    effectiveExhaustVelocityKps: effectiveEv.evKps,
    thrustN: numberField(drive, ['thrust_N']),
    scaledThrustN: scaledThrust,
    thrustCap: numberField(drive, ['thrustCap']),
    reasons: {
      cruiseAccelerationMps2: cruise === null ? performanceReason('cruise') : null,
      combatAccelerationMps2: combat === null ? (numberField(drive, ['thrustCap']) === null ? 'drive thrust cap is not readable' : performanceReason('combat')) : null,
      deltaVKps: deltaV === null ? performanceReason('deltaV') : null
    },
    formulae: {
      deltaV: 'deltaVKps = shared/propulsion.mjs deltaVKps(effectiveEV, wetMassKg, dryMassKg)',
      cruiseAcceleration: 'cruise = shared/propulsion.mjs accelerationMps2(scaledThrustN, wetMassKg, 1)',
      combatAcceleration: 'combat = shared/propulsion.mjs accelerationMps2(scaledThrustN, wetMassKg, thrustCap)'
    }
  };

  const compatibilityRequired = textField(drive, ['requiredPowerPlant']);
  const compatibilityActual = textField(reactor, ['powerPlantClass']);
  const compatibility = compatibilityRequired === null || compatibilityActual === null
    ? {
      status: 'unknown',
      compatible: null,
      requiredPowerPlantClass: compatibilityRequired,
      reactorPowerPlantClass: compatibilityActual,
      reason: 'drive required power-plant class or reactor class is not readable'
    }
    : {
      status: compatibilityRequired === 'Any_General' || compatibilityRequired === compatibilityActual ? 'compatible' : 'incompatible',
      compatible: compatibilityRequired === 'Any_General' || compatibilityRequired === compatibilityActual,
      requiredPowerPlantClass: compatibilityRequired,
      reactorPowerPlantClass: compatibilityActual,
      reason: compatibilityRequired === 'Any_General' || compatibilityRequired === compatibilityActual
        ? null
        : `drive requires ${compatibilityRequired}, selected reactor is ${compatibilityActual}`
    };

  const buildTime = buildTimeFor(input, hull);
  const reasons = {};
  addReason(reasons, 'cruiseAccelerationMps2', performance.reasons.cruiseAccelerationMps2);
  addReason(reasons, 'combatAccelerationMps2', performance.reasons.combatAccelerationMps2);
  addReason(reasons, 'deltaVKps', performance.reasons.deltaVKps);
  addReason(reasons, 'totalResourceCost', cost.reason);
  addReason(reasons, 'dryMassTons', mass.dryReason);
  addReason(reasons, 'wetMassTons', mass.wetReason);
  addReason(reasons, 'thrustScalingFactor', power.thrustScalingReason);
  addReason(reasons, 'wasteHeatGW', heat.reason);
  addReason(reasons, 'radiatorMassTons', heat.reason);
  addReason(reasons, 'crew', crew.reason);
  addReason(reasons, 'buildTimeDays', buildTime.available ? null : buildTime.reason);
  for (const issue of [...driveResolution.reason ? [{ reason: driveResolution.reason }] : [], ...utilities.issues, ...weapons.issues, ...batteries.issues]) {
    if (issue?.reason) reasons.components = reasons.components ? `${reasons.components}; ${issue.reason}` : issue.reason;
  }
  if (compatibility.reason) addReason(reasons, 'compatibility', compatibility.reason);

  const readout = {
    available: true,
    buildable: compatibility.compatible,
    status: compatibility.compatible === false
      ? 'incompatible'
      : (compatibility.compatible === null ? 'incomplete' : 'calculated'),
    reasons,
    compatibility,
    // The first four keys are intentionally top-level: they are the owner's
    // requested readout, not values hidden behind supporting detail panels.
    cruiseAccelerationMps2: cruise,
    combatAccelerationMps2: combat,
    deltaVKps: deltaV,
    totalResourceCost: cost.total,
    performance,
    mass,
    power,
    heat,
    radiator: {
      id: identityOf(radiator),
      displayName: displayNameOf(radiator),
      specificPowerKWkg: numberField(radiator, ['specificPowerKWkg', 'specificPower_2s_KWkg']),
      massKg: heat.radiatorMassKg,
      massTons: heat.radiatorMassTons,
      massRangeTons: heat.radiatorMassRangeTons,
      crew: numberField(radiator, ['crew']),
      reason: heat.reason
    },
    armour,
    crew: {
      total: crew.total,
      massTons: crew.total === null ? null : crew.total * CREW_MASS_TONS,
      massKg: crew.total === null ? null : crew.total * CREW_MASS_TONS * KG_PER_TON,
      resourceCostPerPerson: CREW_RESOURCE_COST_PER_PERSON,
      reason: crew.reason
    },
    thrustScalingFactor: power.thrustScalingFactor,
    wasteHeatGW: heat.wasteHeatGW,
    wasteHeatRangeGW: heat.wasteHeatRangeGW,
    radiatorMassKg: heat.radiatorMassKg,
    radiatorMassTons: heat.radiatorMassTons,
    radiatorMassRangeTons: heat.radiatorMassRangeTons,
    buildTime,
    buildTimeDays: buildTime.available ? buildTime.days : null,
    cost,
    inputs: {
      hull: { id: identityOf(hull), displayName: displayNameOf(hull) },
      drive: { id: identityOf(drive), displayName: displayNameOf(drive), thrusterCount: driveResolution.count, basis: driveResolution.basis || null },
      reactor: { id: identityOf(reactor), displayName: displayNameOf(reactor) },
      radiator: { id: identityOf(radiator), displayName: displayNameOf(radiator) },
      armour: { id: identityOf(armourMaterial), displayName: displayNameOf(armourMaterial), points: armour.points },
      propellantTanks: { count: tanks.count, massTons: tanks.massTons, propellant: tanks.propellant },
      utilityModules: utilities.items.map(item => ({ id: identityOf(item.component), quantity: item.quantity })),
      weapons: weapons.items.map(item => ({ id: identityOf(item.component), quantity: item.quantity })),
      batteries: batteries.items.map(item => ({ id: identityOf(item.component), quantity: item.quantity }))
    }
  };
  return readout;
}

// Noun/verb aliases are the same function object, as with the other shared
// calculation modules in this repository.
export const buildShipDesignCalculation = calculateShipDesign;
export const shipDesignCalculation = calculateShipDesign;
