// shared/intel/shipDesigner.mjs
//
// Purpose: /api/intel/ship-designer — expose the catalogue and compose one
//   selected component set through the pure ship-design calculator.

import { buildShipComponentCatalogue } from '../shipComponentCatalogue.mjs';
import { calculateShipDesign } from '../shipDesignCalculation.mjs';

const queryValue = value => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  return candidate;
};

const parseWeaponQuery = value => {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.flatMap(entry => parseWeaponQuery(entry) || []);
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return parseWeaponQuery(JSON.parse(raw));
    } catch {
      // Keep the raw id below; the calculator will name an unknown selection
      // instead of silently dropping a malformed query value.
    }
  }
  const match = raw.match(/^(.+?)(?:[:=](\d+))?$/);
  return {
    component: match?.[1] || raw,
    count: match?.[2] === undefined ? 1 : Number(match[2])
  };
};

const rowsFor = (catalogue, family) => catalogue?.families?.[family]?.items || [];

/**
 * Resolve a query id to a catalogue row without hiding an unknown selection.
 * The calculator will preserve the unknown id and attach its normal reason;
 * returning a made-up row here would turn an absent stat into a number.
 */
const selectedRow = (catalogue, family, value) => {
  const id = queryValue(value);
  if (id === null) return null;
  const rows = rowsFor(catalogue, family);
  const found = rows.find(row => row.id === id);
  if (found) return found;
  if (family === 'drives') {
    const variant = rows.find(row => Array.isArray(row.variantIds) && row.variantIds.includes(id));
    if (variant) return variant;
  }
  return id;
};

const driveVariantCount = (catalogue, driveId) => {
  const id = queryValue(driveId);
  if (id === null) return null;
  const row = rowsFor(catalogue, 'drives')
    .find(candidate => candidate.id === id || candidate.variantIds?.includes(id));
  const variant = row?.variants?.find(candidate => candidate.id === id);
  if (variant?.thrusters !== undefined) return variant.thrusters;
  const match = String(id).match(/x([1-6])$/i);
  return match ? Number(match[1]) : null;
};

const campaignSettingsFor = (snapshot, supplied) => supplied
  || snapshot?.metadata?.campaignSettings
  || snapshot?.campaignSettings
  || null;

/**
 * Build the catalogue once, then feed its actual rows to the calculator. The
 * route's ids remain query-shaped at the edge; this function is the one place
 * that knows a drive variant id (VASIMRx4) belongs to the VASIMR base row plus
 * a four-thruster selection.
 */
export function shipDesignerResource(snapshot, options = {}) {
  const {
    observerId = snapshot?.observerFactionId || 4712,
    mode = 'player',
    hull = null,
    drive = null,
    thrusters = null,
    reactor = null,
    radiator = null,
    armour = null,
    nose = null,
    lateral = null,
    tail = null,
    tanks = null,
    weapons = null,
    campaignSettings = null
  } = options;

  const catalogue = buildShipComponentCatalogue(snapshot, { mode, observerId });
  const selectedDrive = selectedRow(catalogue, 'drives', drive);
  const explicitThrusters = queryValue(thrusters);
  const thrusterCount = explicitThrusters === null
    ? driveVariantCount(catalogue, drive)
    : explicitThrusters;
  const selectedArmour = selectedRow(catalogue, 'armour', armour);
  const selectedWeapons = parseWeaponQuery(weapons);

  const calculation = calculateShipDesign({
    catalogue,
    hull: selectedRow(catalogue, 'hulls', hull),
    drive: selectedDrive,
    thrusterCount,
    reactor: selectedRow(catalogue, 'reactors', reactor),
    radiator: selectedRow(catalogue, 'radiators', radiator),
    armour: selectedArmour,
    nosePoints: queryValue(nose),
    lateralPoints: queryValue(lateral),
    tailPoints: queryValue(tail),
    propellantTanks: queryValue(tanks) === null ? null : { count: queryValue(tanks) },
    weapons: selectedWeapons,
    campaignSettings: campaignSettingsFor(snapshot, campaignSettings)
  });

  return {
    count: null,
    items: [],
    catalogue,
    selection: {
      hull: queryValue(hull),
      drive: queryValue(drive),
      thrusters: thrusterCount,
      reactor: queryValue(reactor),
      radiator: queryValue(radiator),
      armour: queryValue(armour),
      nose: queryValue(nose),
      lateral: queryValue(lateral),
      tail: queryValue(tail),
      tanks: queryValue(tanks),
      weapons: selectedWeapons
    },
    ...calculation
  };
}
