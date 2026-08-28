/**
 * src/v2/panels/BattlePanel.jsx
 *
 * Purpose: two-column battle planner shell — observer fleet vs picked opponent fleet,
 *   with per-side ship selection capped at BATTLE_SHIP_CAP_PER_SIDE and a full-width
 *   matchup verdict below.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Panel } from '../components/Panel.jsx';
import { FleetPicker } from './FleetPicker.jsx';
import { BattleSuggestion } from './BattleSuggestion.jsx';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';
import {
  factionsWithFleets,
  fleetById,
  fleetsForFaction,
} from './battlePanelUtils.mjs';

function readSnapshot(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.snapshot && typeof data.snapshot === 'object') return data.snapshot;
  if (data.rawSnapshot && typeof data.rawSnapshot === 'object') return data.rawSnapshot;
  if (Array.isArray(data.fleets)) return data;
  return null;
}

function readObserverId(data, snapshot) {
  if (data?.observer != null) return data.observer;
  if (data?.observerId != null) return data.observerId;
  return snapshot?.observerFactionId ?? 4712;
}

export function BattlePanel({ data }) {
  const snapshot = readSnapshot(data);
  const fleets = Array.isArray(snapshot?.fleets) ? snapshot.fleets : [];
  const observerId = readObserverId(data, snapshot);
  const observerFleets = fleetsForFaction(fleets, observerId);
  const opponentFactions = factionsWithFleets(fleets).filter(
    (faction) => String(faction.id) !== String(observerId),
  );

  const [leftFleetId, setLeftFleetId] = React.useState(null);
  const [leftSelectedShipIds, setLeftSelectedShipIds] = React.useState([]);
  const [rightFactionId, setRightFactionId] = React.useState(null);
  const [rightFleetId, setRightFleetId] = React.useState(null);
  const [rightSelectedShipIds, setRightSelectedShipIds] = React.useState([]);

  React.useEffect(() => {
    setLeftFleetId(null);
    setLeftSelectedShipIds([]);
  }, [observerId, fleets.length]);

  const handleLeftFleetChange = (nextFleetId) => {
    setLeftFleetId(nextFleetId);
    setLeftSelectedShipIds([]);
  };

  const handleRightFactionChange = (nextFactionId) => {
    setRightFactionId(nextFactionId);
    setRightFleetId(null);
    setRightSelectedShipIds([]);
  };

  const handleRightFleetChange = (nextFleetId) => {
    setRightFleetId(nextFleetId);
    setRightSelectedShipIds([]);
  };

  if (!snapshot) {
    return (
      <ThemeProvider theme={initiativeTheme}>
        <TwoColumnGrid>
          <TwoColumnGridItem span>
            <Panel title="BATTLE PLANNER" modifier="quiet">
              <Typography variant="metric" sx={{ color: 'text.secondary' }}>
                Fleet data was not loaded — the snapshot is unavailable.
              </Typography>
            </Panel>
          </TwoColumnGridItem>
        </TwoColumnGrid>
      </ThemeProvider>
    );
  }

  const observerName = observerFleets[0]?.factionName
    || snapshot.observerFactionName
    || 'Your faction';

  const opponentFleet = fleetById(fleets, rightFleetId);
  const opponentName = opponentFleet?.factionName
    || opponentFactions.find((f) => String(f.id) === String(rightFactionId))?.name
    || 'Opponent';

  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="battle-planner">
        <TwoColumnGridItem>
          <FleetPicker
            sideLabel={`${observerName} — your fleet`}
            fleets={fleets}
            shipDesigns={snapshot.shipDesigns}
            factionId={observerId}
            fleetId={leftFleetId}
            selectedShipIds={leftSelectedShipIds}
            onFleetChange={handleLeftFleetChange}
            onSelectedShipIdsChange={setLeftSelectedShipIds}
          />
        </TwoColumnGridItem>
        <TwoColumnGridItem>
          <FleetPicker
            sideLabel="Opponent"
            fleets={fleets}
            shipDesigns={snapshot.shipDesigns}
            factionOptions={opponentFactions}
            factionId={rightFactionId}
            fleetId={rightFleetId}
            selectedShipIds={rightSelectedShipIds}
            onFactionChange={handleRightFactionChange}
            onFleetChange={handleRightFleetChange}
            onSelectedShipIdsChange={setRightSelectedShipIds}
          />
        </TwoColumnGridItem>
        <TwoColumnGridItem span>
          <BattleSuggestion
            fleets={fleets}
            leftFleetId={leftFleetId}
            leftSelectedShipIds={leftSelectedShipIds}
            rightFleetId={rightFleetId}
            rightSelectedShipIds={rightSelectedShipIds}
            componentStats={snapshot.componentStats}
            observerLabel={observerName}
            opponentLabel={opponentName}
          />
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const battlePanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

function mountInto(container, element) {
  let root = battlePanelRoots.get(container);
  if (!root) {
    root = createRoot(container);
    battlePanelRoots.set(container, root);
  }
  root.render(element);
}

export function renderBattlePanel(container, data) {
  if (!container) return;
  mountInto(container, <BattlePanel data={data} />);
}

export default BattlePanel;
