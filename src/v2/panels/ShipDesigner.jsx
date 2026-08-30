/**
 * src/v2/panels/ShipDesigner.jsx
 *
 * Purpose: the DESIGNER view panels — component pickers (hull, drive, reactor,
 *   weapons), performance readout, mass/heat breakdown and seven-material cost
 *   against the faction stockpile, from /api/intel/ship-designer and
 *   /api/intel/resources.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import { Value } from '../components/Value.jsx';
import { DataTable } from '../components/DataTable.jsx';
import initiativeTheme from '../theme.js';
import {
  MATERIALS,
  MOUNT_IDS,
  WEAPON_FAMILY_LABELS,
  accel,
  affordabilityFor,
  clampThrusters,
  dec,
  defaultDesignerState,
  driveVariantId,
  filterReactors,
  filterWeaponsForPicker,
  formatMaterialCost,
  groupWeaponsByFamily,
  hardpointUsageLabel,
  int,
  massEntryLabel,
  mergeWeaponSelection,
  num,
  optionLabel,
  power,
  rangeLabel,
  reactorFilterCaption,
  removeWeaponFromSelection,
  selectionQuery,
  setWeaponCount,
  stockpileFromResourcesPayload,
  thrusterBounds,
} from './shipDesignerUtils.mjs';

// ---------------------------------------------------------------------------
// Module-level store — one object, many subscribers, like DriveExplorer.
// ---------------------------------------------------------------------------

const state = defaultDesignerState();
const listeners = new Set();
const sectionRoots = new Map();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function patchState(patch) {
  Object.assign(state, patch);
  notify();
}

function patchSelection(patch) {
  state.selection = { ...state.selection, ...patch };
  notify();
  queueRecalculate();
}

let recalculateTimer = null;
function queueRecalculate() {
  if (recalculateTimer) clearTimeout(recalculateTimer);
  recalculateTimer = setTimeout(() => {
    recalculateTimer = null;
    recalculateDesign();
  }, 180);
}

function useDesignerState() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => subscribe(() => setTick((tick) => tick + 1)), []);
  return state;
}

// ---------------------------------------------------------------------------
// Shared figure primitives
// ---------------------------------------------------------------------------

function Fig({
  value,
  reason,
  format,
  decimals,
  as: Host = Typography,
  variant = 'body2',
  className,
  ...rest
}) {
  const present = value !== null && value !== undefined;
  return (
    <Value
      as={Host}
      variant={variant}
      className={className}
      value={value}
      present={present}
      format={format}
      decimals={decimals}
      absentLabel={reason || undefined}
      {...rest}
    />
  );
}

function MetricRow({ label, value, reason, format, note, emphasize = false }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: theme.initiative.space.md,
        py: theme.initiative.space.xs,
      })}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right' }}>
        <Fig
          value={value}
          reason={reason}
          format={format}
          variant={emphasize ? 'h6' : 'body2'}
          sx={emphasize ? { fontWeight: 600 } : undefined}
        />
        {note ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {note}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function RangeMetric({ label, range, reason, formatter = dec }) {
  const text = rangeLabel(range, formatter);
  return (
    <MetricRow
      label={label}
      value={text}
      reason={!text ? reason : null}
      format={(raw) => String(raw)}
      note={text ? 'Calc cooling — both resolutions shown' : null}
    />
  );
}

function Picker({ label, value, onChange, children, disabled = false }) {
  return (
    <Box component="label" className="de-control" sx={{ minWidth: 0, maxWidth: '100%' }}>
      <span className="de-control__label">{label}</span>
      <Box
        component="select"
        className="de-select"
        value={value}
        disabled={disabled}
        sx={{ maxWidth: '100%' }}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </Box>
    </Box>
  );
}

function NumberInput({ label, value, min, max, onChange }) {
  return (
    <Box component="label" className="de-control de-control--threshold" sx={{ minWidth: 0, maxWidth: '100%' }}>
      <span className="de-control__label">{label}</span>
      <input
        className="de-select"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Box>
  );
}

function optionRows(rows, mode) {
  return rows.map((row) => {
    const locked = row.locked === true;
    return (
      <option key={row.id} value={row.id} disabled={locked}>
        {optionLabel(row, { mode })}
      </option>
    );
  });
}

function weaponOptionGroups(rows, mode) {
  const groups = groupWeaponsByFamily(rows);
  const familyKeys = [...groups.keys()].sort((left, right) => {
    const leftLabel = WEAPON_FAMILY_LABELS[left] || left;
    const rightLabel = WEAPON_FAMILY_LABELS[right] || right;
    return leftLabel.localeCompare(rightLabel);
  });
  return familyKeys.map((familyKey) => (
    <optgroup
      key={familyKey}
      label={WEAPON_FAMILY_LABELS[familyKey] || familyKey}
    >
      {optionRows(groups.get(familyKey), mode)}
    </optgroup>
  ));
}

// ---------------------------------------------------------------------------
// Panel sections
// ---------------------------------------------------------------------------

function ComponentsPanel() {
  const view = useDesignerState();
  const catalogue = view.payload?.catalogue;
  const families = catalogue?.families || {};
  const selection = view.selection;
  const hullRow = families.hulls?.items?.find((row) => row.id === selection.hull) || null;
  const driveRow = families.drives?.items?.find((row) => row.id === selection.drive) || null;
  const allReactors = families.reactors?.items || [];
  const reactors = filterReactors(allReactors, driveRow);
  const reactorCaption = reactorFilterCaption(allReactors, reactors, driveRow);
  const { min: thrMin, max: thrMax } = thrusterBounds(driveRow);
  const compatibility = view.payload?.compatibility;
  const compatReason = compatibility?.reason || view.payload?.reasons?.compatibility;
  const weaponCapacity = view.payload?.weaponCapacity;
  const hardpointLabel = hardpointUsageLabel(weaponCapacity, hullRow);
  const hardpointReason = view.payload?.reasons?.weaponCapacity
    || (weaponCapacity?.status === 'over-capacity' ? weaponCapacity.reason : null);

  const [weaponMountFilter, setWeaponMountFilter] = React.useState('');
  const [pendingWeaponId, setPendingWeaponId] = React.useState('');
  const [pendingWeaponCount, setPendingWeaponCount] = React.useState(1);

  const weaponCatalogue = families.weapons?.items || [];
  const pickerWeapons = filterWeaponsForPicker(weaponCatalogue, {
    mountSide: weaponMountFilter || null,
  });
  const selectedWeaponRows = selection.weapons.map((entry) => {
    const row = weaponCatalogue.find((candidate) => candidate.id === entry.id);
    return { entry, row };
  });

  if (view.loading && !catalogue) {
    return <div className="alien-hate-econ-empty">Loading component catalogue…</div>;
  }
  if (view.error && !catalogue) {
    return <div className="alien-hate-econ-empty">SHIP DESIGNER UNAVAILABLE — {view.error}</div>;
  }
  if (!catalogue?.available) {
    return (
      <div className="alien-hate-econ-empty">
        Component catalogue unavailable
        {catalogue?.availabilityReasons?.length ? ` — ${catalogue.availabilityReasons.join('; ')}` : ''}
      </div>
    );
  }

  return (
    <Box
      className="sd-components"
      sx={(theme) => ({
        display: 'grid',
        gap: theme.initiative.space.md,
        minWidth: 0,
        maxWidth: '100%',
      })}
    >
      <Box className="de-controls" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, minWidth: 0, maxWidth: '100%' }}>
        <Picker label="HULL" value={selection.hull} onChange={(value) => patchSelection({ hull: value })}>
          <option value="">— select hull —</option>
          {optionRows(families.hulls?.items || [], view.mode)}
        </Picker>
        <Picker label="DRIVE" value={selection.drive} onChange={(value) => {
          const nextDrive = families.drives?.items?.find((row) => row.id === value) || null;
          patchSelection({
            drive: value,
            thrusters: clampThrusters(selection.thrusters, nextDrive),
            reactor: '',
          });
        }}
        >
          <option value="">— select drive —</option>
          {optionRows(families.drives?.items || [], view.mode)}
        </Picker>
        <NumberInput
          label="THRUSTERS"
          value={selection.thrusters}
          min={thrMin}
          max={thrMax}
          onChange={(value) => patchSelection({ thrusters: clampThrusters(value, driveRow) })}
        />
        <Picker
          label="REACTOR"
          value={selection.reactor}
          onChange={(value) => patchSelection({ reactor: value })}
          disabled={!selection.drive}
        >
          <option value="">— select reactor —</option>
          {optionRows(reactors, view.mode)}
        </Picker>
        {reactorCaption ? (
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, maxWidth: '100%' }}>
            {reactorCaption}
          </Typography>
        ) : null}
        <Picker label="RADIATOR" value={selection.radiator} onChange={(value) => patchSelection({ radiator: value })}>
          <option value="">— select radiator —</option>
          {optionRows(families.radiators?.items || [], view.mode)}
        </Picker>
        <Picker label="ARMOUR" value={selection.armour} onChange={(value) => patchSelection({ armour: value })}>
          <option value="">— select armour —</option>
          {optionRows(families.armour?.items || [], view.mode)}
        </Picker>
      </Box>
      <Box className="de-controls" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, minWidth: 0, maxWidth: '100%' }}>
        <NumberInput
          label="NOSE PTS"
          value={selection.nose}
          min={0}
          max={99}
          onChange={(value) => patchSelection({ nose: Math.max(0, num(value) ?? 0) })}
        />
        <NumberInput
          label="SIDE PTS"
          value={selection.lateral}
          min={0}
          max={99}
          onChange={(value) => patchSelection({ lateral: Math.max(0, num(value) ?? 0) })}
        />
        <NumberInput
          label="TAIL PTS"
          value={selection.tail}
          min={0}
          max={99}
          onChange={(value) => patchSelection({ tail: Math.max(0, num(value) ?? 0) })}
        />
        <NumberInput
          label="TANKS"
          value={selection.tanks}
          min={0}
          max={999}
          onChange={(value) => patchSelection({ tanks: Math.max(0, num(value) ?? 0) })}
        />
      </Box>
      <Box
        className="sd-weapons"
        sx={(theme) => ({
          display: 'grid',
          gap: theme.initiative.space.sm,
          minWidth: 0,
          maxWidth: '100%',
        })}
      >
        <Typography variant="overline" color="text.secondary">
          Weapons
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Hardpoint capacity —
          {hardpointLabel ? (
            <Typography component="span" variant="caption" sx={{ ml: 0.5 }}>
              {hardpointLabel}
            </Typography>
          ) : (
            <Fig
              as="span"
              value={null}
              reason={hardpointReason || (hullRow ? 'weapon capacity is not calculated' : 'select a hull to read hardpoint limits')}
              variant="caption"
              sx={{ ml: 0.5 }}
            />
          )}
        </Typography>
        {weaponCapacity?.status === 'over-capacity' ? (
          <Typography variant="body2" color="warning.main">
            {weaponCapacity.reason || compatReason}
          </Typography>
        ) : null}
        <Box className="de-controls" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, minWidth: 0, maxWidth: '100%' }}>
          <Picker
            label="MOUNT FILTER"
            value={weaponMountFilter}
            onChange={(value) => {
              setWeaponMountFilter(value);
              setPendingWeaponId('');
            }}
          >
            <option value="">All hull & nose mounts</option>
            <option value="hull">Hull mounts only</option>
            <option value="nose">Nose mounts only</option>
          </Picker>
          <Picker
            label="WEAPON"
            value={pendingWeaponId}
            onChange={(value) => setPendingWeaponId(value)}
          >
            <option value="">— select weapon —</option>
            {weaponOptionGroups(pickerWeapons, view.mode)}
          </Picker>
          <NumberInput
            label="COUNT"
            value={pendingWeaponCount}
            min={1}
            max={99}
            onChange={(value) => setPendingWeaponCount(Math.max(1, num(value) ?? 1))}
          />
          <Box component="label" className="de-control" sx={{ minWidth: 0 }}>
            <span className="de-control__label">ADD</span>
            <Box
              component="button"
              type="button"
              className="de-select"
              disabled={!pendingWeaponId}
              sx={{ cursor: pendingWeaponId ? 'pointer' : 'not-allowed' }}
              onClick={() => {
                if (!pendingWeaponId) return;
                patchSelection({
                  weapons: mergeWeaponSelection(
                    selection.weapons,
                    pendingWeaponId,
                    pendingWeaponCount,
                  ),
                });
                setPendingWeaponId('');
                setPendingWeaponCount(1);
              }}
            >
              Add weapon
            </Box>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Weapons grouped by family; mount filter narrows the picker ({pickerWeapons.length} of {weaponCatalogue.length} shown).
        </Typography>
        {selectedWeaponRows.length > 0 ? (
          <Box
            component="ul"
            sx={{ m: 0, pl: 2.5, minWidth: 0, maxWidth: '100%' }}
          >
            {selectedWeaponRows.map(({ entry, row }) => (
              <Box
                component="li"
                key={entry.id}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1,
                  mb: 0.75,
                  minWidth: 0,
                  maxWidth: '100%',
                }}
              >
                <Typography variant="body2" sx={{ minWidth: 0, flex: '1 1 auto' }}>
                  {row?.displayName || entry.id}
                  {row?.mount ? ` (${row.mount})` : ''}
                </Typography>
                <NumberInput
                  label="×"
                  value={entry.count}
                  min={1}
                  max={99}
                  onChange={(value) => patchSelection({
                    weapons: setWeaponCount(selection.weapons, entry.id, value),
                  })}
                />
                <Box
                  component="button"
                  type="button"
                  className="de-select"
                  sx={{ cursor: 'pointer', flex: '0 0 auto' }}
                  onClick={() => patchSelection({
                    weapons: removeWeaponFromSelection(selection.weapons, entry.id),
                  })}
                >
                  Remove
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            No weapons selected.
          </Typography>
        )}
      </Box>
      {(compatibility?.status === 'incompatible'
        || compatibility?.status === 'unknown'
        || compatReason) ? (
        <Typography
          variant="body2"
          color={compatibility?.status === 'incompatible' ? 'warning.main' : 'text.secondary'}
        >
          {compatReason
            || (compatibility?.requiredPowerPlantClass && compatibility?.reactorPowerPlantClass
              ? `Drive requires ${compatibility.requiredPowerPlantClass}; selected reactor is ${compatibility.reactorPowerPlantClass}`
              : 'Component compatibility could not be verified')}
        </Typography>
      ) : null}
    </Box>
  );
}

function PerformancePanel() {
  const view = useDesignerState();
  const payload = view.payload;
  const reasons = payload?.reasons || {};

  if (view.loading && !payload?.catalogue) {
    return <div className="alien-hate-econ-empty">Loading performance readout…</div>;
  }

  return (
    <Box sx={(theme) => ({ display: 'grid', gap: theme.initiative.space.sm })}>
      <MetricRow
        label="Cruise acceleration (m/s²)"
        value={payload?.cruiseAccelerationMps2}
        reason={reasons.cruiseAccelerationMps2}
        format={accel}
        emphasize
      />
      <MetricRow
        label="Combat acceleration (m/s²)"
        value={payload?.combatAccelerationMps2}
        reason={reasons.combatAccelerationMps2}
        format={accel}
        emphasize
      />
      <MetricRow
        label="Delta-V (km/s)"
        value={payload?.deltaVKps}
        reason={reasons.deltaVKps}
        format={(value) => dec(value, 2)}
        emphasize
      />
      {payload?.inputs?.drive?.thrusterCount ? (
        <Typography variant="caption" color="text.secondary">
          Drive at ×{payload.inputs.drive.thrusterCount}
          {payload.inputs.drive.basis ? ` (${payload.inputs.drive.basis})` : ''}
        </Typography>
      ) : null}
    </Box>
  );
}

function MassHeatPanel() {
  const view = useDesignerState();
  const payload = view.payload;
  const reasons = payload?.reasons || {};
  const mass = payload?.mass;
  const powerBlock = payload?.power;

  if (view.loading && !payload?.catalogue) {
    return <div className="alien-hate-econ-empty">Loading mass and heat breakdown…</div>;
  }

  return (
    <Box
      sx={(theme) => ({
        display: 'grid',
        gap: theme.initiative.space.lg,
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      })}
    >
      <Box>
        <Typography variant="overline" color="text.secondary" gutterBottom>
          Mass budget (t)
        </Typography>
        <MetricRow label="Dry mass" value={mass?.dryTons} reason={reasons.dryMassTons} format={(v) => dec(v, 1)} />
        <MetricRow label="Wet mass" value={mass?.wetTons} reason={reasons.wetMassTons} format={(v) => dec(v, 1)} />
        <MetricRow label="Propellant" value={mass?.propellantTons} reason={mass?.wetReason} format={(v) => dec(v, 1)} />
        {mass?.range ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Calc cooling wet-mass range —
            {' '}
            Open
            {' '}
            <Fig value={mass.range.Open?.wetTons} format={(v) => dec(v, 1)} />
            {' '}
            · Closed
            {' '}
            <Fig value={mass.range.Closed?.wetTons} format={(v) => dec(v, 1)} />
          </Typography>
        ) : null}
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
          {(mass?.componentBreakdown || []).map((entry) => (
            <Box component="li" key={entry.key || entry.id || entry.displayName} sx={{ mb: 0.5 }}>
              <Typography variant="body2" component="span">
                {massEntryLabel(entry)}
                {': '}
                <Fig value={entry.massTons} reason={entry.reason} format={(v) => dec(v, 1)} />
                {entry.wetOnly ? ' (wet only)' : ''}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Box>
        <Typography variant="overline" color="text.secondary" gutterBottom>
          Power & heat
        </Typography>
        <MetricRow label="Systems power (GW)" value={powerBlock?.systemsGW} format={(v) => power(v)} />
        <MetricRow label="Propulsion demand (GW)" value={powerBlock?.propulsionGW} format={(v) => power(v)} />
        <MetricRow label="Plant output (GW)" value={powerBlock?.plantOutputGW} format={(v) => power(v)} />
        <MetricRow
          label="Thrust scaling"
          value={payload?.thrustScalingFactor}
          reason={reasons.thrustScalingFactor}
          format={(v) => dec(v, 3)}
          note={powerBlock?.underpowered ? 'Underpowered — thrust scales down' : null}
        />
        {payload?.wasteHeatRangeGW ? (
          <RangeMetric label="Waste heat (GW)" range={payload.wasteHeatRangeGW} reason={reasons.wasteHeatGW} formatter={power} />
        ) : (
          <MetricRow label="Waste heat (GW)" value={payload?.wasteHeatGW} reason={reasons.wasteHeatGW} format={(v) => power(v)} />
        )}
        {payload?.radiatorMassRangeTons ? (
          <RangeMetric
            label="Radiator mass (t)"
            range={payload.radiatorMassRangeTons}
            reason={reasons.radiatorMassTons}
            formatter={(v) => dec(v, 1)}
          />
        ) : (
          <MetricRow
            label="Radiator mass (t)"
            value={payload?.radiatorMassTons}
            reason={reasons.radiatorMassTons}
            format={(v) => dec(v, 1)}
          />
        )}
        <MetricRow label="Crew" value={payload?.crew?.total} reason={reasons.crew} format={int} />
      </Box>
    </Box>
  );
}

function CostPanel() {
  const view = useDesignerState();
  const payload = view.payload;
  const reasons = payload?.reasons || {};
  const costVector = payload?.totalResourceCost;
  const affordability = affordabilityFor(costVector, view.stockpile);

  if (view.loading && !payload?.catalogue) {
    return <div className="alien-hate-econ-empty">Loading resource cost…</div>;
  }

  const rows = MATERIALS.map((material) => {
    const need = costVector?.[material.key];
    const have = view.stockpile?.[material.key];
    const shortfall = affordability.shortfalls?.[material.key];
    return { material, need, have, shortfall };
  });

  return (
    <Box sx={(theme) => ({ display: 'grid', gap: theme.initiative.space.md, minWidth: 0, maxWidth: '100%' })}>
      <DataTable variant="intel-library">
        <thead>
          <tr>
            <th>Material</th>
            <th>Cost</th>
            <th>Stockpile</th>
            <th>Shortfall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ material, need, have, shortfall }) => (
            <tr key={material.key}>
              <td>{material.label}</td>
              <td><Fig value={need} reason={reasons.totalResourceCost} format={formatMaterialCost} /></td>
              <td><Fig value={have} reason={view.stockpileReason} format={formatMaterialCost} /></td>
              <td>
                <Fig
                  value={shortfall}
                  present={shortfall !== null && shortfall !== undefined}
                  format={formatMaterialCost}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'baseline' }}>
        <Typography variant="body2">
          Affordable ships:
          {' '}
          <Fig
            value={affordability.affordableCount}
            reason={affordability.reason || reasons.totalResourceCost}
            format={int}
          />
        </Typography>
        <Typography variant="body2">
          Build time (days):
          {' '}
          <Fig value={payload?.buildTimeDays} reason={reasons.buildTimeDays} format={int} />
        </Typography>
      </Box>

      {payload?.cost?.range ? (
        <Typography variant="caption" color="text.secondary">
          {payload.cost.rangeLabel || 'Calc cooling cost range'}
          {' — '}
          Open
          {' '}
          {MATERIALS.map((material, index) => (
            <React.Fragment key={`open-${material.key}`}>
              {index > 0 ? ', ' : ''}
              {material.label}
              {' '}
              <Fig value={payload.cost.range.Open?.total?.[material.key]} format={formatMaterialCost} />
            </React.Fragment>
          ))}
          {' · Closed '}
          {MATERIALS.map((material, index) => (
            <React.Fragment key={`closed-${material.key}`}>
              {index > 0 ? ', ' : ''}
              {material.label}
              {' '}
              <Fig value={payload.cost.range.Closed?.total?.[material.key]} format={formatMaterialCost} />
            </React.Fragment>
          ))}
        </Typography>
      ) : null}

      <Typography variant="caption" color="text.secondary">
        Boost and money can cover shortfalls at a per-shipyard toggle — conversion rate unmeasured.
      </Typography>
    </Box>
  );
}

const SECTION_COMPONENTS = Object.freeze({
  designerComponents: ComponentsPanel,
  designerPerformance: PerformancePanel,
  designerMassHeat: MassHeatPanel,
  designerCost: CostPanel,
});

function SectionHost({ mountId }) {
  const Component = SECTION_COMPONENTS[mountId];
  return (
    <ThemeProvider theme={initiativeTheme}>
      <Component />
    </ThemeProvider>
  );
}

function ensureSectionRoot(mountId) {
  const container = document.getElementById(mountId);
  if (!container) return null;
  if (!sectionRoots.has(mountId)) {
    sectionRoots.set(mountId, createRoot(container));
  }
  return sectionRoots.get(mountId);
}

function renderAllSections() {
  for (const mountId of MOUNT_IDS) {
    const root = ensureSectionRoot(mountId);
    if (root) root.render(<SectionHost mountId={mountId} />);
  }
}

// ---------------------------------------------------------------------------
// Fetch + strangler bridge
// ---------------------------------------------------------------------------

export async function fetchShipDesigner(observerId, mode, selection, catalogue) {
  const params = new URLSearchParams({
    observer: String(observerId),
    mode: String(mode),
  });
  const query = selectionQuery(selection, catalogue);
  for (const [key, value] of Object.entries(query)) {
    if (key === 'weapons' && Array.isArray(value)) {
      for (const entry of value) params.append('weapons', entry);
    } else {
      params.set(key, String(value));
    }
  }
  try {
    const response = await fetch(`/api/intel/ship-designer?${params.toString()}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn('[ShipDesigner] Failed to fetch ship designer data:', err);
    return null;
  }
}

export async function fetchFactionStockpile(observerId, mode) {
  const params = new URLSearchParams({
    observer: String(observerId),
    mode: String(mode),
    faction: String(observerId),
  });
  try {
    const response = await fetch(`/api/intel/resources?${params.toString()}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn('[ShipDesigner] Failed to fetch faction stockpile:', err);
    return null;
  }
}

async function recalculateDesign() {
  if (!state.observer || !state.mode) return;
  const catalogue = state.payload?.catalogue;
  if (!catalogue) return;
  patchState({ loading: true });
  const payload = await fetchShipDesigner(state.observer, state.mode, state.selection, catalogue);
  if (!payload?.success) {
    patchState({ loading: false, error: payload?.error || 'calculation failed' });
    return;
  }
  patchState({ payload, loading: false, error: null });
}

export async function loadShipDesigner(observerId, mode) {
  patchState({
    observer: observerId,
    mode,
    loading: true,
    error: null,
    payload: null,
    stockpile: null,
    stockpileReason: null,
  });
  renderAllSections();

  const [cataloguePayload, resourcesPayload] = await Promise.all([
    fetchShipDesigner(observerId, mode, state.selection, null),
    fetchFactionStockpile(observerId, mode),
  ]);

  if (!cataloguePayload?.success) {
    patchState({
      loading: false,
      error: cataloguePayload?.error || 'catalogue unavailable',
    });
    return null;
  }

  const { stockpile, reason } = stockpileFromResourcesPayload(resourcesPayload);
  patchState({
    payload: cataloguePayload,
    stockpile,
    stockpileReason: reason,
    loading: false,
    error: null,
  });

  if (selectionQuery(state.selection, cataloguePayload.catalogue).hull) {
    await recalculateDesign();
  }

  return cataloguePayload;
}

export function renderShipDesigner() {
  renderAllSections();
}

export const shipDesignerInternals = {
  state,
  patchSelection,
  patchState,
  subscribe,
  selectionQuery,
  affordabilityFor,
  driveVariantId,
  filterReactors,
  renderAllSections,
};

export default ComponentsPanel;
