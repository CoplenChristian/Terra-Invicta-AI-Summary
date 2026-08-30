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
  if (raw.includes(',')) {
    return raw.split(',').flatMap(entry => {
      const trimmed = entry.trim();
      // Preserve an empty list member as a rejected selection. It is a
      // malformed value, not an absent weapon.
      return trimmed === ''
        ? [{ component: '', count: 1 }]
        : (parseWeaponQuery(trimmed) || []);
    });
  }
  const match = raw.match(/^(.+?)(?:[:=](\d+))?$/);
  return {
    component: match?.[1] || raw,
    count: match?.[2] === undefined ? 1 : Number(match[2])
  };
};

const rowsFor = (catalogue, family) => catalogue?.families?.[family]?.items || [];

const idOf = value => {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of ['id', 'dataName', 'templateName', 'name']) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') return value[key].trim();
  }
  return null;
};

const selectionRejection = ({ parameter, family, id }) => ({
  parameter,
  value: id,
  id,
  reason: id
    ? `${parameter} id '${id}' is not in the ${family} catalogue`
    : `${parameter} id is missing from the ${family} catalogue`
});

/**
 * Resolve a query id to a catalogue row. Unknown ids stay absent and are
 * echoed as rejections; returning the raw id here would let the calculator
 * manufacture a component-shaped object around a value the catalogue never
 * supplied.
 */
const selectedRow = (catalogue, family, value, { parameter = family, rejected = null } = {}) => {
  const id = queryValue(value);
  if (id === null) return null;
  const rows = rowsFor(catalogue, family);
  const found = rows.find(row => String(row.id) === String(id));
  if (found) return found;
  if (family === 'drives') {
    const variant = rows.find(row => Array.isArray(row.variantIds)
      && row.variantIds.some(variantId => String(variantId) === String(id)));
    if (variant) return variant;
  }
  if (Array.isArray(rejected)) rejected.push(selectionRejection({ parameter, family, id: idOf(id) || String(id) }));
  return null;
};

const weaponEntryLike = value => value && typeof value === 'object' && !Array.isArray(value)
  && ['component', 'item', 'module', 'weapon'].some(key => Object.prototype.hasOwnProperty.call(value, key));

const weaponEntries = value => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(weaponEntries);
  if (weaponEntryLike(value) || idOf(value)) return [value];
  if (typeof value === 'object') return Object.entries(value)
    .map(([component, count]) => ({ component, count }));
  return [value];
};

const weaponComponent = entry => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  for (const key of ['component', 'item', 'module', 'weapon']) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) return entry[key];
  }
  return entry;
};

const weaponCount = entry => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  for (const key of ['count', 'quantity', 'amount', 'number']) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) return entry[key];
  }
  return undefined;
};

/**
 * Resolve every requested weapon against the actual catalogue. The accepted
 * list is the only list passed into the calculator; rejected ids are returned
 * separately so the API can echo the caller's value without inventing a row.
 */
const resolveWeaponSelections = (catalogue, value) => {
  const requested = parseWeaponQuery(value);
  const accepted = [];
  const rejected = [];
  const rows = rowsFor(catalogue, 'weapons');

  for (const entry of weaponEntries(requested)) {
    const component = weaponComponent(entry);
    const id = idOf(component);
    const found = id === null
      ? null
      : rows.find(row => String(row.id) === String(id));
    if (!found) {
      rejected.push(selectionRejection({ parameter: 'weapons', family: 'weapons', id }));
      continue;
    }
    const count = weaponCount(entry);
    const selected = { component: found };
    if (count !== undefined) selected.count = count;
    accepted.push(selected);
  }

  return { requested, accepted, rejected };
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
  const rejected = [];
  const selectedDrive = selectedRow(catalogue, 'drives', drive, { parameter: 'drive', rejected });
  const explicitThrusters = queryValue(thrusters);
  const thrusterCount = explicitThrusters === null
    ? driveVariantCount(catalogue, drive)
    : explicitThrusters;
  const selectedArmour = selectedRow(catalogue, 'armour', armour, { parameter: 'armour', rejected });
  const weaponSelection = resolveWeaponSelections(catalogue, weapons);
  rejected.push(...weaponSelection.rejected);

  const calculation = calculateShipDesign({
    catalogue,
    hull: selectedRow(catalogue, 'hulls', hull, { parameter: 'hull', rejected }),
    drive: selectedDrive,
    thrusterCount,
    reactor: selectedRow(catalogue, 'reactors', reactor, { parameter: 'reactor', rejected }),
    radiator: selectedRow(catalogue, 'radiators', radiator, { parameter: 'radiator', rejected }),
    armour: selectedArmour,
    nosePoints: queryValue(nose),
    lateralPoints: queryValue(lateral),
    tailPoints: queryValue(tail),
    propellantTanks: queryValue(tanks) === null ? null : { count: queryValue(tanks) },
    weapons: weaponSelection.accepted,
    selectionRejections: rejected,
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
      weapons: weaponSelection.requested
    },
    ...calculation,
    rejected
  };
}
