/**
 * src/v2/panels/FleetPicker.jsx
 *
 * Purpose: faction and fleet selectors with a capped ship checklist for the battle planner.
 */

import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { Value } from '../components/Value.jsx';
import {
  BATTLE_SHIP_AUTO_SELECT_COUNT,
  BATTLE_SHIP_CAP_ATTRIBUTION,
  BATTLE_SHIP_CAP_PER_SIDE,
  buildShipDesignLookup,
  deploymentSummary,
  fleetsForFaction,
  overCapNotice,
  presentCount,
  resolveShipDesignSubtitle,
  selectTopShips,
  selectionBlocked,
  shipId,
  toggleShipSelection,
} from './battlePanelUtils.mjs';

function fmtCount(n) {
  if (!presentCount(n)) return '—';
  return n.toLocaleString('en-US');
}

function fleetLabel(fleet) {
  const name = fleet?.displayName || 'Unnamed fleet';
  const body = fleet?.orbitBody ? ` · ${fleet.orbitBody}` : '';
  const count = presentCount(fleet?.shipsCount)
    ? ` · ${fleet.shipsCount} ship${fleet.shipsCount === 1 ? '' : 's'}`
    : '';
  return `${name}${body}${count}`;
}

function ShipSubtitle({ subtitle }) {
  const parts = [];
  if (subtitle.resolved) {
    if (subtitle.designName) {
      parts.push(
        <Typography key="design" component="span" variant="metric" sx={{ color: 'text.secondary' }}>
          {subtitle.designName}
        </Typography>,
      );
    }
    if (subtitle.hullClass) {
      parts.push(
        <Typography key="hull" component="span" variant="metric" sx={{ color: 'text.secondary' }}>
          {subtitle.hullClass}
        </Typography>,
      );
    }
  } else {
    parts.push(
      <Value
        key="design"
        as={Typography}
        variant="metric"
        sx={{ color: 'text.secondary' }}
        value={null}
        present={false}
        absentLabel="design not identified"
      />,
    );
  }
  if (subtitle.weaponType) {
    parts.push(
      <Typography key="weapon" component="span" variant="metric" sx={{ color: 'text.secondary' }}>
        {subtitle.weaponType}
      </Typography>,
    );
  }

  if (parts.length === 0) {
    return (
      <Value
        as={Typography}
        variant="metric"
        sx={{ color: 'text.secondary' }}
        value={null}
        present={false}
        absentLabel="design not identified"
      />
    );
  }

  return (
    <Typography component="span" variant="metric" sx={{ display: 'block', color: 'text.secondary' }}>
      {parts.map((part, index) => (
        <React.Fragment key={part.key}>
          {index > 0 ? ' · ' : null}
          {part}
        </React.Fragment>
      ))}
    </Typography>
  );
}

function ShipRow({ ship, designLookup, checked, disabled, onToggle }) {
  const id = shipId(ship);
  if (id == null) return null;
  const subtitle = resolveShipDesignSubtitle(ship, designLookup);
  return (
    <FormControlLabel
      sx={{
        alignItems: 'flex-start',
        mx: 0,
        py: 0.5,
        width: '100%',
        '& .MuiFormControlLabel-label': { width: '100%' },
      }}
      control={(
        <Checkbox
          size="small"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(id)}
          inputProps={{ 'aria-label': `Deploy ${ship.displayName || 'ship'}` }}
        />
      )}
      label={(
        <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
          <Typography component="span" variant="row" sx={{ display: 'block', color: 'text.primary' }}>
            {ship.displayName || 'Unnamed ship'}
          </Typography>
          <ShipSubtitle subtitle={subtitle} />
        </Box>
      )}
    />
  );
}

/**
 * @param {object} props
 * @param {string} props.sideLabel
 * @param {Array} props.fleets — full snapshot.fleets list
 * @param {Array} [props.factionOptions] — when set, renders a faction dropdown first
 * @param {string|number|null} props.factionId
 * @param {string|number|null} props.fleetId
 * @param {string[]} props.selectedShipIds
 * @param {(factionId: string|number|null) => void} [props.onFactionChange]
 * @param {(fleetId: string|number|null) => void} props.onFleetChange
 * @param {(shipIds: string[]) => void} props.onSelectedShipIdsChange
 * @param {Array} [props.shipDesigns] — snapshot ship designs for subtitle joins
 * @param {number} [props.cap]
 */
export function FleetPicker({
  sideLabel,
  fleets,
  factionOptions = null,
  factionId,
  fleetId,
  selectedShipIds,
  onFactionChange,
  onFleetChange,
  onSelectedShipIdsChange,
  shipDesigns = [],
  cap = BATTLE_SHIP_CAP_PER_SIDE,
}) {
  const theme = useTheme();
  const designLookup = React.useMemo(
    () => buildShipDesignLookup(shipDesigns),
    [shipDesigns],
  );
  const t = theme.initiative?.tokens ?? {};
  const showFactionPicker = Array.isArray(factionOptions);
  const scopedFleets = showFactionPicker
    ? fleetsForFaction(fleets, factionId)
    : fleetsForFaction(fleets, factionId);
  const selectedFleet = scopedFleets.find((fleet) => String(fleet.ID) === String(fleetId)) || null;
  const ships = Array.isArray(selectedFleet?.ships) ? selectedFleet.ships : [];
  const selectedCount = selectedShipIds.length;
  const atCap = selectionBlocked(selectedCount, cap);
  const summary = deploymentSummary({
    fleetShipCount: selectedFleet?.shipsCount ?? ships.length,
    selectedCount,
    cap,
  });
  const notice = overCapNotice(summary);

  const handleToggle = (id) => {
    onSelectedShipIdsChange(toggleShipSelection(selectedShipIds, id, cap));
  };

  const handleAutoSelect = () => {
    onSelectedShipIdsChange(selectTopShips(ships, BATTLE_SHIP_AUTO_SELECT_COUNT, cap));
  };

  const selectSx = {
    fontFamily: theme.typography.fontFamily,
    fontSize: t.fsRow || theme.typography.row?.fontSize,
    '& .MuiOutlinedInput-notchedOutline': { borderColor: t.line || theme.palette.divider },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: t.lineStrong || theme.palette.divider },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.accent || theme.palette.primary.main },
  };

  return (
    <Panel title={sideLabel} modifier="quiet" data-side={sideLabel}>
      {showFactionPicker ? (
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id={`${sideLabel}-faction-label`}>Faction</InputLabel>
          <Select
            labelId={`${sideLabel}-faction-label`}
            label="Faction"
            value={factionId == null ? '' : String(factionId)}
            onChange={(event) => {
              const next = event.target.value === '' ? null : event.target.value;
              onFactionChange?.(next);
            }}
            sx={selectSx}
          >
            <MenuItem value="">
              <em>Select a faction</em>
            </MenuItem>
            {factionOptions.map((faction) => (
              <MenuItem key={String(faction.id)} value={String(faction.id)}>
                {faction.name}
                {' '}
                (<Value value={faction.fleetCount} format={fmtCount} present={presentCount(faction.fleetCount)} />
                {' '}
                fleet{faction.fleetCount === 1 ? '' : 's'})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : null}

      <FormControl fullWidth size="small" sx={{ mb: 2 }} disabled={!factionId || scopedFleets.length === 0}>
        <InputLabel id={`${sideLabel}-fleet-label`}>Fleet</InputLabel>
        <Select
          labelId={`${sideLabel}-fleet-label`}
          label="Fleet"
          value={fleetId == null ? '' : String(fleetId)}
          onChange={(event) => {
            const next = event.target.value === '' ? null : event.target.value;
            onFleetChange(next);
          }}
          sx={selectSx}
        >
          <MenuItem value="">
            <em>Select a fleet</em>
          </MenuItem>
          {scopedFleets.map((fleet) => (
            <MenuItem key={String(fleet.ID)} value={String(fleet.ID)}>
              {fleetLabel(fleet)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {factionId && scopedFleets.length > 0 ? (
        <Button
          size="small"
          variant="outlined"
          disabled={!selectedFleet}
          onClick={handleAutoSelect}
          sx={{
            mb: 2,
            fontFamily: theme.typography.fontFamily,
            fontSize: t.fsRow || theme.typography.row?.fontSize,
            borderColor: t.line || theme.palette.divider,
            color: t.accent || theme.palette.primary.main,
            '&:hover': {
              borderColor: t.lineStrong || theme.palette.divider,
              backgroundColor: t.accentSoft || theme.palette.action.hover,
            },
            '&.Mui-disabled': {
              borderColor: t.line || theme.palette.divider,
              color: t.textDim || theme.palette.text.disabled,
            },
          }}
        >
          {`Select first ${BATTLE_SHIP_AUTO_SELECT_COUNT}`}
        </Button>
      ) : null}

      {!factionId && showFactionPicker ? (
        <Typography variant="metric" sx={{ color: 'text.secondary' }}>
          Choose a faction to list its fleets.
        </Typography>
      ) : null}

      {factionId && scopedFleets.length === 0 ? (
        <Typography variant="metric" sx={{ color: 'text.secondary' }}>
          No fleets are visible for this faction in the current intelligence mode.
        </Typography>
      ) : null}

      {factionId && scopedFleets.length > 0 && !selectedFleet ? (
        <Typography variant="metric" sx={{ color: 'text.secondary' }}>
          Choose a fleet to inspect its ships and mark deployers.
        </Typography>
      ) : null}

      {selectedFleet ? (
        <>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              alignItems: 'baseline',
              mb: 1.5,
              pb: 1.5,
              borderBottom: `1px solid ${t.line || theme.palette.divider}`,
            }}
          >
            <Typography variant="metric" sx={{ color: 'text.secondary', textTransform: 'uppercase' }}>
              Selected for battle
            </Typography>
            <Typography variant="section" sx={{ fontFamily: theme.typography.fontFamilyMono }}>
              <Value value={selectedCount} format={fmtCount} present />
              {' / '}
              <Value value={cap} format={fmtCount} present />
            </Typography>
            {atCap ? (
              <Typography variant="metric" sx={{ color: 'warning.main' }}>
                Cap reached — deselect a ship to choose another.
              </Typography>
            ) : null}
          </Box>

          <Typography variant="metric" sx={{ color: 'text.secondary', mb: 1.5 }}>
            {BATTLE_SHIP_CAP_ATTRIBUTION}
          </Typography>

          {notice ? (
            <Box
              sx={{
                mb: 2,
                p: 1.5,
                borderRadius: '3px',
                border: `1px solid ${t.line || theme.palette.divider}`,
                backgroundColor: t.surfaceInset || theme.palette.background.default,
              }}
              role="status"
            >
              <Typography variant="metric" sx={{ color: 'text.primary', lineHeight: 1.45 }}>
                {notice}
              </Typography>
            </Box>
          ) : null}

          <Box
            component="div"
            sx={{
              maxHeight: 520,
              overflowY: 'auto',
              pr: 0.5,
            }}
          >
            {ships.length > 0 ? ships.map((ship) => {
              const id = shipId(ship);
              if (id == null) return null;
              const checked = selectedShipIds.includes(id);
              return (
                <ShipRow
                  key={id}
                  ship={ship}
                  designLookup={designLookup}
                  checked={checked}
                  disabled={!checked && atCap}
                  onToggle={handleToggle}
                />
              );
            }) : (
              <Typography variant="metric" sx={{ color: 'text.secondary' }}>
                This fleet has no ship roster in the current snapshot.
              </Typography>
            )}
          </Box>
        </>
      ) : null}
    </Panel>
  );
}

export default FleetPicker;
