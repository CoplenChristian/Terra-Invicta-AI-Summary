/**
 * src/v2/panels/BattleSuggestion.jsx
 *
 * Purpose: battle matchup verdict for the selected ships on each side — per-side
 *   composition, saturation both ways, and launcher-denominated change advice.
 *   Counting and joins delegate to shared/battleComposition.mjs.
 */

import React from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { Value } from '../components/Value.jsx';
import { presentCount } from './battlePanelUtils.mjs';
import {
  buildBattleMatchup,
  changeAdvice,
  formatCount,
  formatRatio,
  interceptionCaveatText,
  joinRatePercent,
  saturationHeadline,
  selectionPhase,
} from './battleSuggestionUtils.mjs';
import { PD_OVERWHELM_MULTIPLE } from '../../../shared/battleComposition.mjs';

function Metric({ label, value, present }) {
  return (
    <TableRow>
      <TableCell component="th" scope="row" sx={{ fontWeight: 500, color: 'text.secondary', width: '55%' }}>
        {label}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
        <Value as={Typography} component="span" variant="metric" value={value} format={formatCount} present={present} />
      </TableCell>
    </TableRow>
  );
}

function CompositionTable({ title, side, shipCount }) {
  const theme = useTheme();
  const t = theme.initiative?.tokens ?? {};
  const joinPct = joinRatePercent(side);
  const joinComplete = side?.complete === true;
  const unresolved = side?.join?.unresolvedSystems ?? [];

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="section" sx={{ mb: 1, color: 'text.primary' }}>
        {title}
        {' '}
        (
        <Value as={Typography} component="span" variant="section" value={shipCount} format={formatCount} present={presentCount(shipCount)} />
        {' '}
        ship{shipCount === 1 ? '' : 's'} selected)
      </Typography>

      {!side ? (
        <Typography variant="metric" sx={{ color: 'text.secondary' }}>
          Composition unavailable — no ships selected or weapon templates missing from the snapshot.
        </Typography>
      ) : (
        <>
          <Table size="small" sx={{ border: `1px solid ${t.line || theme.palette.divider}` }}>
            <TableBody>
              <Metric label="Point-defence mounts" value={side.pointDefenceMounts} present={presentCount(side.pointDefenceMounts)} />
              <Metric
                label="PD-targetable shots (missiles + kinetics)"
                value={side.pdTargetableShots}
                present={presentCount(side.pdTargetableShots)}
              />
              <Metric
                label="PD-immune weapons (laser / particle / plasma)"
                value={side.pdImmuneWeapons}
                present={presentCount(side.pdImmuneWeapons)}
              />
              <Metric label="Armour (median half-value cm)" value={side.armorMedian} present={presentCount(side.armorMedian)} />
            </TableBody>
          </Table>

          <Box sx={{ mt: 1.5 }}>
            <Typography variant="metric" sx={{ color: joinComplete ? 'text.secondary' : 'warning.main' }}>
              Weapon join:
              {' '}
              <Value
                as={Typography}
                component="span"
                variant="metric"
                value={joinPct}
                format={(v) => `${v}%`}
                present={presentCount(joinPct)}
              />
              {joinComplete ? ' — complete' : ' — incomplete; saturation will refuse until every system resolves'}
            </Typography>
            {!joinComplete && unresolved.length > 0 ? (
              <Typography variant="metric" sx={{ color: 'warning.main', mt: 0.5, lineHeight: 1.45 }}>
                Unresolved:
                {' '}
                {unresolved.slice(0, 8).join(', ')}
                {unresolved.length > 8 ? ` (+${unresolved.length - 8} more)` : ''}
              </Typography>
            ) : null}
          </Box>
        </>
      )}
    </Box>
  );
}

function SaturationBlock({
  directionLabel,
  verdict,
  attackerSide,
  attackerLabel,
  defenderLabel,
}) {
  const theme = useTheme();
  const t = theme.initiative?.tokens ?? {};
  const headline = saturationHeadline(verdict, { attackerLabel, defenderLabel });
  const advice = changeAdvice(verdict, attackerSide, { attackerLabel, defenderLabel });

  return (
    <Box
      sx={{
        mb: 2,
        p: 1.5,
        borderRadius: '3px',
        border: `1px solid ${t.line || theme.palette.divider}`,
        backgroundColor: t.surfaceInset || theme.palette.background.default,
      }}
      data-saturation-direction={directionLabel}
      data-saturation-refused={headline.refused ? 'true' : 'false'}
      data-saturation-saturated={headline.saturated == null ? 'unknown' : String(headline.saturated)}
    >
      <Typography variant="metric" sx={{ color: 'text.secondary', textTransform: 'uppercase', mb: 0.5 }}>
        {directionLabel}
      </Typography>
      <Typography variant="row" sx={{ color: 'text.primary', mb: 1, lineHeight: 1.45 }}>
        {headline.headline}
      </Typography>
      {headline.detail ? (
        <Typography variant="metric" sx={{ color: 'text.secondary', mb: 1, lineHeight: 1.45 }}>
          {headline.detail}
        </Typography>
      ) : null}

      {verdict && !verdict.refused ? (
        <Table size="small" sx={{ mb: 1 }}>
          <TableBody>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.25 }}>Targetable shots</TableCell>
              <TableCell align="right" sx={{ border: 0, py: 0.25, fontFamily: 'monospace' }}>
                <Value
                  as={Typography}
                  component="span"
                  variant="metric"
                  value={verdict.attackerPdTargetableShots}
                  format={formatCount}
                  present={presentCount(verdict.attackerPdTargetableShots)}
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.25 }}>Defender PD mounts</TableCell>
              <TableCell align="right" sx={{ border: 0, py: 0.25, fontFamily: 'monospace' }}>
                <Value
                  as={Typography}
                  component="span"
                  variant="metric"
                  value={verdict.defenderPdMounts}
                  format={formatCount}
                  present={presentCount(verdict.defenderPdMounts)}
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.25 }}>
                {`Required shots (${PD_OVERWHELM_MULTIPLE}× rule)`}
              </TableCell>
              <TableCell align="right" sx={{ border: 0, py: 0.25, fontFamily: 'monospace' }}>
                <Value
                  as={Typography}
                  component="span"
                  variant="metric"
                  value={verdict.interceptionCapacity}
                  format={formatCount}
                  present={presentCount(verdict.interceptionCapacity)}
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.25 }}>Ratio (shots ÷ required)</TableCell>
              <TableCell align="right" sx={{ border: 0, py: 0.25, fontFamily: 'monospace' }}>
                <Value
                  as={Typography}
                  component="span"
                  variant="metric"
                  value={verdict.ratio}
                  format={formatRatio}
                  present={presentCount(verdict.ratio)}
                  absentLabel={verdict.ratioUnavailableReason ? 'no screen' : '—'}
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.25 }}>PD-immune weapons (excluded)</TableCell>
              <TableCell align="right" sx={{ border: 0, py: 0.25, fontFamily: 'monospace' }}>
                <Value
                  as={Typography}
                  component="span"
                  variant="metric"
                  value={verdict.attackerPdImmuneWeapons}
                  format={formatCount}
                  present={presentCount(verdict.attackerPdImmuneWeapons)}
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ) : null}

      {advice.text ? (
        <Typography variant="metric" sx={{ color: 'text.primary', lineHeight: 1.45 }}>
          {advice.text}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * @param {object} props
 * @param {Array} props.fleets
 * @param {string|number|null} props.leftFleetId
 * @param {string[]} props.leftSelectedShipIds
 * @param {string|number|null} props.rightFleetId
 * @param {string[]} props.rightSelectedShipIds
 * @param {object|null} props.componentStats
 * @param {string} props.observerLabel
 * @param {string} [props.opponentLabel]
 */
export function BattleSuggestion({
  fleets,
  leftFleetId,
  leftSelectedShipIds,
  rightFleetId,
  rightSelectedShipIds,
  componentStats,
  observerLabel,
  opponentLabel = 'Opponent',
  span = false,
}) {
  const theme = useTheme();
  const t = theme.initiative?.tokens ?? {};

  const matchup = React.useMemo(() => buildBattleMatchup({
    fleets,
    leftFleetId,
    leftSelectedShipIds,
    rightFleetId,
    rightSelectedShipIds,
    componentStats,
  }), [
    fleets,
    leftFleetId,
    leftSelectedShipIds,
    rightFleetId,
    rightSelectedShipIds,
    componentStats,
  ]);

  const phase = selectionPhase(matchup.leftShips.length, matchup.rightShips.length);

  let body;
  if (!componentStats || Object.keys(componentStats).length === 0) {
    body = (
      <Typography variant="metric" sx={{ color: 'text.secondary' }}>
        Weapon templates are not present on this snapshot — re-publish after upgrading to compare salvos.
      </Typography>
    );
  } else if (phase === 'none') {
    body = (
      <Typography variant="metric" sx={{ color: 'text.secondary', lineHeight: 1.45 }}>
        Select ships on both sides to compare composition and whether each salvo overwhelms the other&apos;s point-defence screen.
        Choose a fleet, then tick up to 40 deployers per side.
      </Typography>
    );
  } else if (phase === 'one') {
    const showLeft = matchup.leftShips.length > 0;
    body = (
      <>
        <Typography variant="metric" sx={{ color: 'text.secondary', mb: 2, lineHeight: 1.45 }}>
          {showLeft
            ? 'Your selection is ready. Choose an opponent fleet and select their ships to run the saturation comparison.'
            : 'Opponent selected. Choose your fleet and select ships to run the saturation comparison.'}
        </Typography>
        <CompositionTable
          title={showLeft ? observerLabel : opponentLabel}
          side={showLeft ? matchup.left : matchup.right}
          shipCount={showLeft ? matchup.leftShips.length : matchup.rightShips.length}
        />
      </>
    );
  } else {
    body = (
      <>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
            mb: 2,
          }}
        >
          <CompositionTable
            title={observerLabel}
            side={matchup.left}
            shipCount={matchup.leftShips.length}
          />
          <CompositionTable
            title={opponentLabel}
            side={matchup.right}
            shipCount={matchup.rightShips.length}
          />
        </Box>

        <Typography variant="section" sx={{ mb: 1.5, color: 'text.primary' }}>
          Saturation
        </Typography>

        <SaturationBlock
          directionLabel="Your salvo vs their screen"
          verdict={matchup.yourSalvoVsTheirScreen}
          attackerSide={matchup.left}
          attackerLabel={observerLabel}
          defenderLabel={opponentLabel}
        />
        <SaturationBlock
          directionLabel="Their salvo vs your screen"
          verdict={matchup.theirSalvoVsYourScreen}
          attackerSide={matchup.right}
          attackerLabel={opponentLabel}
          defenderLabel={observerLabel}
        />

        <Box
          role="note"
          sx={{
            mt: 1,
            p: 1.5,
            borderRadius: '3px',
            border: `1px solid ${t.line || theme.palette.divider}`,
            backgroundColor: t.surfaceInset || theme.palette.background.default,
          }}
          data-interception-caveat="true"
        >
          <Typography variant="metric" sx={{ color: 'text.secondary', lineHeight: 1.45 }}>
            <strong>Interception assumption:</strong>
            {' '}
            {interceptionCaveatText()}
          </Typography>
        </Box>
      </>
    );
  }

  return (
    <Panel title="MATCHUP VERDICT" modifier="featured" span={span} data-primitive="battle-suggestion">
      {body}
    </Panel>
  );
}

export default BattleSuggestion;
