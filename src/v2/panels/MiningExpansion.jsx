/**
 * src/v2/panels/MiningExpansion.jsx
 *
 * Purpose: render the mining expansion board in React with explicit presence
 * signals for every nullable read, measured/estimated registers, and announced
 * row caps.
 */

import React from 'react';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { DataTable } from '../components/DataTable.jsx';
import { Estimated } from '../components/Estimated.jsx';
import { Measured } from '../components/Measured.jsx';
import { ABSENT_LABEL, Value, resolveValue } from '../components/Value.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import { parseNumeric } from '../components/parseNumeric.js';
import initiativeTheme from '../theme.js';

const RESOURCE_LABELS = [
  ['water', 'W'],
  ['volatiles', 'V'],
  ['metals', 'M'],
  ['nobleMetals', 'N'],
  ['fissiles', 'F'],
];

const CANDIDATE_ROW_LIMIT = 8;
const UPGRADE_ROW_LIMIT = 5;

const CANDIDATE_COLUMNS = [
  { key: 'site', label: 'Site & Body' },
  { key: 'yields', label: 'Resource Yields' },
  { key: 'utility', label: 'Utility Value' },
  { key: 'cost', label: 'Cost' },
];

const UPGRADE_COLUMNS = [
  { key: 'site', label: 'Site & Body' },
  { key: 'multiplier', label: 'Multiplier' },
  { key: 'gain', label: 'Monthly Gain' },
  { key: 'cost', label: 'Cost' },
];

function numberOrNull(value) {
  return parseNumeric(value);
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function safeText(value, fallback) {
  return hasText(value) ? String(value) : fallback;
}

function fixedText(value, decimals = 1) {
  const parsed = numberOrNull(value);
  return resolveValue({
    value: parsed,
    present: parsed !== null,
    format: (raw) => raw.toFixed(decimals),
  }).text;
}

function integerText(value) {
  const parsed = numberOrNull(value);
  return resolveValue({
    value: parsed,
    present: parsed !== null,
    format: (raw) => String(Math.round(raw)),
  }).text;
}

function NumericValue({
  value,
  format = (parsed) => String(parsed),
  absentLabel = ABSENT_LABEL,
  ...rest
}) {
  const parsed = numberOrNull(value);
  return (
    <Value
      value={value}
      present={parsed !== null}
      absentLabel={absentLabel}
      format={() => format(parsed)}
      {...rest}
    />
  );
}

function TextValue({ value, absentLabel = ABSENT_LABEL, ...rest }) {
  return (
    <Value
      value={value}
      present={hasText(value)}
      absentLabel={absentLabel}
      format={(raw) => String(raw)}
      {...rest}
    />
  );
}

const layout = {
  board: (space) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: space.xl,
  }),
  statusbar: (space) => ({
    display: 'flex',
    gap: space.xl,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '2px 0 11px',
    '@media (max-width: 520px)': {
      flexDirection: 'column',
      gap: space.md,
    },
  }),
  unavailableBanner: (space) => ({
    marginBottom: space.md,
    padding: `${space.sm} ${space.md}`,
  }),
  runways: (space) => ({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: `${space.sm} ${space.md}`,
    padding: `${space.md} ${space.lg}`,
  }),
  basis: (space) => ({
    margin: `${space.sm} 0 ${space['2xs']}`,
    padding: `${space.xs} ${space.sm}`,
  }),
  sectionTitle: (space) => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: `${space.xs} 0 ${space['2xs']}`,
  }),
  upgrades: (space) => ({
    margin: `${space.md} 0 ${space.lg}`,
  }),
  upgradesNote: (space) => ({
    padding: `${space.xs} ${space.sm}`,
  }),
  upgradesBlocked: (space) => ({
    display: 'block',
    marginTop: '3px',
  }),
  gatedTitle: (space) => ({
    marginTop: space.sm,
  }),
  gatedGrid: (space) => ({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: space.md,
  }),
  gatedItem: (space) => ({
    padding: `${space.md} ${space.lg}`,
  }),
  gatedHeader: (space) => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  }),
  gatedMeta: () => ({
    display: 'flex',
    justifyContent: 'space-between',
  }),
  unreachable: (space) => ({
    padding: `${space.sm} ${space.md}`,
  }),
};

function CapacityStatus({ capacity }) {
  const minesBuilt = numberOrNull(capacity.minesBuilt);
  const mineLimit = numberOrNull(capacity.mineLimit);
  const headroom = numberOrNull(capacity.headroom);
  const penaltyMc = numberOrNull(capacity.penaltyMC);
  const penaltyHate = numberOrNull(capacity.penaltyHate);
  const marginalMc = numberOrNull(capacity.marginalNextMinePenaltyMC);
  const marginalHate = numberOrNull(capacity.marginalNextMinePenaltyHate);
  const hateAvailable = capacity.hateCostAvailable !== false
    && numberOrNull(capacity.baseHateMultiplier) !== null;

  const countText = `${integerText(minesBuilt)} / ${integerText(mineLimit)} MINES`;

  if (capacity.overLimit === true) {
    const label = `OVER LIMIT (+${integerText(penaltyMc)} MC${hateAvailable
      ? ` / +${fixedText(penaltyHate, 1)} HATE`
      : ' / HATE UNAVAILABLE'})`;
    const note = `Quadratic penalty active. Next mine costs +${integerText(marginalMc)} MC${hateAvailable
      ? ` (+${fixedText(marginalHate, 1)} hate).`
      : ' (hate cost unavailable: the save carries no readable difficulty).'}`;
    const labelPresent = penaltyMc !== null && (!hateAvailable || penaltyHate !== null);
    const notePresent = marginalMc !== null && (!hateAvailable || marginalHate !== null);
    return {
      tone: 'is-danger',
      label: <TextValue value={labelPresent ? label : null} absentLabel={label} />,
      note: <TextValue value={notePresent ? note : null} absentLabel={note} />,
    };
  }

  if (headroom === null || minesBuilt === null || mineLimit === null) {
    const label = `${countText} (CAPACITY UNMEASURED)`;
    return {
      tone: 'is-warning',
      label: <TextValue value={null} absentLabel={label} />,
      note: (
        <TextValue
          value={null}
          absentLabel="Mine headroom could not be computed from this snapshot, so the quadratic MC penalty distance is unknown."
        />
      ),
    };
  }

  if (headroom <= 2) {
    return {
      tone: 'is-warning',
      label: <TextValue value={`${countText} (CAPACITY TIGHT)`} />,
      note: (
        <TextValue
          value={`Only ${integerText(headroom)} mine slot(s) left before penalty. Next mission tech unlocks +3 to +6.`}
        />
      ),
    };
  }

  return {
    tone: 'is-safe',
    label: <TextValue value={countText} />,
    note: <TextValue value={`${integerText(headroom)} mine(s) headroom remaining before quadratic MC penalty.`} />,
  };
}

function RunwayPill({ runway, runwayKey }) {
  const record = runway && typeof runway === 'object' ? runway : {};
  const key = hasText(record.key)
    ? String(record.key)
    : (hasText(runwayKey) ? String(runwayKey) : null);
  if (!key) return null;

  const label = key.charAt(0).toUpperCase() + key.slice(1);
  const status = safeText(record.status, 'unknown');
  const months = numberOrNull(record.runwayMonths);

  let value;
  let title = `${label}: ${status}`;
  if (months !== null) {
    value = (
      <NumericValue
        value={months}
        format={(n) => `${n}mo`}
        data-nullable-input={`runway.${key}.runwayMonths`}
      />
    );
  } else if (status.includes('surplus')) {
    value = <TextValue value="Surplus" />;
  } else if (status === 'unmeasured' || status === 'consumption_unknown' || status === 'unknown') {
    value = (
      <TextValue
        value={null}
        absentLabel="Unmeasured"
        data-nullable-input={`runway.${key}.runwayMonths`}
      />
    );
    title = status === 'consumption_unknown'
      ? `${label}: stockpile read, but monthly consumption is not in this snapshot`
      : `${label}: no stockpile reading in this snapshot`;
  } else {
    value = <TextValue value={null} data-nullable-input={`runway.${key}.runwayMonths`} />;
  }

  let badgeClass = 'is-neutral';
  if (status === 'critical' || status === 'depleted') badgeClass = 'is-danger';
  else if (status === 'tight') badgeClass = 'is-warning';
  else if (status === 'comfortable' || status.includes('surplus')) badgeClass = 'is-safe';

  return (
    <span className={`mining-runway-pill ${badgeClass}`} title={title}>
      <strong><TextValue value={`${label}:`} /></strong>{' '}
      {value}
    </span>
  );
}

function yieldState(yields) {
  if (!yields || typeof yields !== 'object') {
    return {
      productive: [],
      unmeasured: RESOURCE_LABELS.map(([key]) => key),
      allUnavailable: true,
    };
  }

  const productive = [];
  const unmeasured = [];
  for (const [key, label] of RESOURCE_LABELS) {
    const entry = yields[key];
    const monthly = numberOrNull(entry?.monthly);
    if (monthly === null || entry?.measured === false) {
      unmeasured.push(key);
    } else if (monthly > 0) {
      productive.push({ key, label, monthly });
    }
  }

  return {
    productive,
    unmeasured,
    allUnavailable: unmeasured.length === RESOURCE_LABELS.length,
  };
}

function YieldReadout({ yields, inputPrefix = 'yield' }) {
  const state = yieldState(yields);
  const title = state.unmeasured.length
    ? `Unmeasured in this snapshot: ${state.unmeasured.join(', ')}`
    : undefined;

  let content;
  if (state.productive.length > 0) {
    content = state.productive.map((entry, index) => (
      <React.Fragment key={entry.key}>
        {index > 0 ? ' · ' : ''}
        {entry.label}:{' '}
        <NumericValue
          value={entry.monthly}
          format={(n) => `+${n.toFixed(1)}`}
          data-nullable-input={`${inputPrefix}.${entry.key}.monthly`}
        />
      </React.Fragment>
    ));
  } else if (state.allUnavailable) {
    content = (
      <TextValue
        value={null}
        absentLabel={yields ? 'YIELDS UNMEASURED' : 'YIELDS UNAVAILABLE'}
        data-nullable-input={`${inputPrefix}.all`}
      />
    );
  } else {
    content = <NumericValue value={0} format={() => 'No measured yield'} />;
  }

  return (
    <Measured
      register="mining"
      as="div"
      className={`mining-yields-text${state.unmeasured.length ? ' is-partial' : ''}`}
      title={title}
    >
      {content}
    </Measured>
  );
}

function ModuleBand({ band, capability }) {
  const range = capability?.projectedMultiplierRange;
  const low = band?.projectedRangeAvailable === false ? null : numberOrNull(range?.low);
  const high = band?.projectedRangeAvailable === false ? null : numberOrNull(range?.high);

  if (!band || low === null || high === null) {
    const why = capability?.available === true
      ? 'The observer has completed no mine-complex project, so there is no tier it could build here.'
      : safeText(
        capability?.unavailableReason,
        'The observer\'s buildable mine tiers are unresolved, so no band can be stated.',
      );
    return (
      <Estimated
        register="mining"
        as="small"
        className="mining-module-band is-unavailable"
        title={why}
      >
        <TextValue
          value={null}
          absentLabel={`Mine module multiplier: UNKNOWN ${ABSENT_LABEL} not in the score`}
        />
      </Estimated>
    );
  }

  const lowLabel = safeText(range?.lowLabel ?? range?.lowModule, 'unresolved tier');
  const highLabel = safeText(range?.highLabel ?? range?.highModule, 'unresolved tier');
  const title = 'ESTIMATE, not a measurement. This site has no mine, so its module multiplier depends on '
    + `which complex gets built: ${lowLabel} ×${low} to ${highLabel} ×${high}. It is deliberately NOT in `
    + 'the utility score — the score saturates, so a uniform assumed multiplier reorders the board rather than scaling it.';

  return (
    <Estimated register="mining" as="small" className="mining-module-band" title={title}>
      <span className="mining-est__tag">EST</span>{' '}
      <TextValue value={`×${low}–×${high} once mined`} />
    </Estimated>
  );
}

function CandidateRow({ candidate, capability, rowIndex }) {
  const c = candidate || {};
  const hateCost = numberOrNull(c.hateCost);
  const yieldInfo = yieldState(c.yields);
  const density = numberOrNull(c.siteDensity);
  const densityAssumed = c.siteDensityAssumed === true || c.siteDensityMeasured === false;
  const value = numberOrNull(c.siteValue);
  const valueMeasured = value !== null;
  const partial = valueMeasured && c.scoreInputsComplete === false;
  const buildDays = numberOrNull(c.buildTimeDays);
  const theater = hasText(c.spaceTheaterKey) ? String(c.spaceTheaterKey).toUpperCase() : null;
  const assumedDestination = typeof c.destinationTechSource === 'string'
    && c.destinationTechSource.startsWith('assumed');

  const valueTitle = !valueMeasured
    ? 'Not scoreable: none of the five mined resources could be evaluated against a measured runway.'
    : partial
      ? `Partial score: ${(Array.isArray(c.unmeasuredResources)
        ? c.unmeasuredResources.filter(hasText).join(', ')
        : '') || 'some resources'} could not be evaluated.`
      : 'Net saturating utility across the five mined resources.';

  let hateBadge;
  if (hateCost === null) {
    hateBadge = (
        <NumericValue
          value={c.hateCost}
          absentLabel="HATE UNKNOWN"
          className="mining-tag mining-tag--unknown"
          title="The alien-hate cost could not be evaluated: the save carries no readable difficulty, and the floor multiplier is what converts Mission Control into hate."
          data-nullable-input="candidate.hateCost"
        />
    );
  } else if (hateCost === 0) {
    hateBadge = (
      <NumericValue
        value={hateCost}
        format={() => 'FREE'}
        className="mining-tag mining-tag--free"
        data-nullable-input="candidate.hateCost"
      />
    );
  } else {
    hateBadge = (
      <NumericValue
        value={hateCost}
        format={(n) => `+${n.toFixed(2)} hate`}
        className="mining-tag mining-tag--hate"
        data-nullable-input="candidate.hateCost"
      />
    );
  }

  const costTitle = buildDays === null
    ? 'Build duration is not recorded for an unowned site — it only exists once a mine is queued.'
    : 'Recorded build duration for this site.';

  return (
    <tr
      className="mining-candidate-row"
      data-site-id={hasText(c.siteId) ? String(c.siteId) : undefined}
    >
      <td className="mining-site-cell">
        <strong className="mining-site-name">
          <TextValue value={c.displayName} absentLabel="Unnamed site" />
        </strong>
        <small className="mining-site-body">
          <TextValue value={c.parentBodyName} absentLabel="Unknown body" />{' '}
          <TextValue value={theater ? `(${theater})` : null} absentLabel="(UNASSIGNED)" />
          {assumedDestination ? (
            <>{' '}<span className="mining-assumed-flag" title="This body is not in the space-theater table, so its destination tech is assumed to be Mission to the Asteroids.">assumed reach</span></>
          ) : null}
        </small>
      </td>
      <td className="mining-yields-cell">
        <YieldReadout yields={c.yields} inputPrefix="candidate.yields" />
        <ModuleBand band={c.moduleMultiplier} capability={capability} />
        <small
          className={`mining-density${densityAssumed ? ' is-assumed' : ''}`}
          title={densityAssumed
            ? safeText(c.siteDensitySource, 'Assumed 1.0 — the site template density could not be resolved.')
            : undefined}
        >
          Density:{' '}
          <NumericValue
            value={density}
            format={(n) => `${n.toFixed(2)}x`}
            data-nullable-input="candidate.siteDensity"
          />
          {densityAssumed ? ' (assumed)' : null}
        </small>
      </td>
      <td className="mining-value-cell">
        <strong
          className={`mining-value-score${valueMeasured ? '' : ' is-unmeasured'}`}
          title={valueTitle}
        >
          <NumericValue
            value={value}
            format={(n) => `${n.toFixed(2)}${partial ? '*' : ''}`}
            data-nullable-input="candidate.siteValue"
          />
        </strong>
        <small className="mining-value-label">
          {!valueMeasured ? 'not scoreable' : (partial ? 'partial utility' : 'net utility')}
        </small>
      </td>
      <td className="mining-cost-cell">
        <div>{hateBadge}</div>
        <small className="mining-mc-cost" title={costTitle}>
          <NumericValue
            value={c.mcCost}
            format={(n) => `${Math.round(n)} MC`}
            data-nullable-input="candidate.mcCost"
          />{' · '}
          <NumericValue
            value={c.buildTimeDays}
            absentLabel="build n/a"
            format={(n) => `${Math.round(n)}d`}
            data-nullable-input="buildTimeDays"
          />
        </small>
      </td>
    </tr>
  );
}

function ResourceGainList({ gains, emptyLabel, inputPrefix = 'gain' }) {
  const entries = [];
  for (const [key, label] of RESOURCE_LABELS) {
    const value = gains && Object.prototype.hasOwnProperty.call(gains, key)
      ? numberOrNull(gains[key])
      : null;
    if (value === null || value > 0) entries.push({ key, label, value });
  }

  if (entries.length === 0) {
    return <NumericValue value={0} format={() => emptyLabel} data-nullable-input={`${inputPrefix}.empty`} />;
  }

  return entries.map((entry, index) => (
    <React.Fragment key={entry.key}>
      {index > 0 ? ' · ' : ''}
      {entry.label}:{' '}
      <NumericValue
        value={entry.value}
        format={(n) => `+${n.toFixed(1)}`}
        data-nullable-input={`${inputPrefix}.${entry.key}`}
      />
    </React.Fragment>
  ));
}

function UpgradeRow({ opportunity, rowIndex }) {
  const item = opportunity || {};
  return (
    <tr className="mining-upgrade-row">
      <td className="mining-site-cell">
        <strong className="mining-site-name">
          <TextValue value={item.displayName} absentLabel="Unnamed site" />
        </strong>
        <small className="mining-site-body">
          <TextValue value={item.parentBodyName} absentLabel="Unknown body" />
        </small>
      </td>
      <td className="mining-upgrade-step">
        <Measured register="mining">
          <NumericValue
            value={item.currentMultiplier}
            format={(n) => `×${n.toFixed(2)}`}
            data-nullable-input="upgrade.currentMultiplier"
          />
          {' → '}
          <NumericValue
            value={item.nextMultiplier}
            format={(n) => `×${n.toFixed(2)}`}
            data-nullable-input="upgrade.nextMultiplier"
          />
        </Measured>
      </td>
      <td className="mining-yields-cell">
        <Measured register="mining">
          <ResourceGainList
            gains={item.monthlyGain}
            emptyLabel="No measured gain"
            inputPrefix="upgrade.monthlyGain"
          />
        </Measured>
      </td>
      <td className="mining-cost-cell">
        <NumericValue
          value={0}
          format={() => '0 MINE SLOTS'}
          className="mining-tag mining-tag--free"
          data-nullable-input="upgrade.mineSlots"
        />
      </td>
    </tr>
  );
}

function blockedUpgradeNotes(counts) {
  const specs = [
    ['noUpgradePath', 'at their template ceiling (nothing upgrades from that module)', 'template ceiling'],
    ['notResearched', 'awaiting the successor project', 'successor-project research'],
    ['notOperational', 'not operational yet', 'operational status'],
    ['unknownModule', 'carrying an unrecognised module', 'unrecognised modules'],
  ];
  const notes = [];
  const unknown = [];
  for (const [key, suffix, unknownLabel] of specs) {
    const value = numberOrNull(counts?.[key]);
    if (value === null) unknown.push(unknownLabel);
    else if (value > 0) notes.push({ key, value, suffix });
  }
  return { notes, unknown };
}

function MineUpgrades({ upgrades, capacity }) {
  if (!upgrades || typeof upgrades !== 'object') {
    return (
      <Box
        className="mining-upgrades mining-upgrades--unavailable"
        sx={(theme) => layout.upgrades(theme.initiative.space)}
      >
        <Box
          component="div"
          className="mining-section-title"
          sx={(theme) => layout.sectionTitle(theme.initiative.space)}
        ><span>MINE UPGRADES</span></Box>
        <Box
          component="div"
          className="mining-upgrades-note"
          sx={(theme) => layout.upgradesNote(theme.initiative.space)}
        >
          <TextValue
            value={null}
            absentLabel={`MINE UPGRADES NOT REPORTED ${ABSENT_LABEL} upgrade opportunities are unavailable.`}
          />
        </Box>
      </Box>
    );
  }

  if (upgrades.totalMonthlyGainMeasured !== true) {
    return (
      <Box
        className="mining-upgrades mining-upgrades--unavailable"
        sx={(theme) => layout.upgrades(theme.initiative.space)}
      >
        <Box
          component="div"
          className="mining-section-title"
          sx={(theme) => layout.sectionTitle(theme.initiative.space)}
        ><span>MINE UPGRADES</span></Box>
        <Box
          component="div"
          className="mining-upgrades-note"
          sx={(theme) => layout.upgradesNote(theme.initiative.space)}
        >
          <TextValue
            value={null}
            absentLabel={`UPGRADE HEADROOM UNRESOLVED ${ABSENT_LABEL} the observer's buildable mine tiers could not be read, so whether any mine can be upgraded is unknown, not “none”.`}
          />
        </Box>
      </Box>
    );
  }

  const counts = upgrades.counts || {};
  const available = numberOrNull(counts.available);
  const opportunitiesReported = Array.isArray(upgrades.opportunities);
  const rows = (opportunitiesReported ? upgrades.opportunities : [])
    .filter((item) => item && item.state === 'available')
    .slice(0, UPGRADE_ROW_LIMIT);
  const headroom = numberOrNull(capacity?.headroom);
  const blocked = blockedUpgradeNotes(counts);
  const omitted = available === null ? null : Math.max(0, available - rows.length);

  return (
    <Box
      className="mining-upgrades"
      sx={(theme) => layout.upgrades(theme.initiative.space)}
    >
      <Box
        component="div"
        className="mining-section-title"
        sx={(theme) => layout.sectionTitle(theme.initiative.space)}
      >
        <span>
          MINE UPGRADES —{' '}
          <NumericValue
            value={available}
            absentLabel="COUNT UNAVAILABLE"
            format={(n) => `${Math.round(n)} AVAILABLE`}
          />
        </span>
        <small>Measured: the observer&apos;s own operational mines</small>
      </Box>
      <Box
        component="div"
        className="mining-upgrades-note"
        sx={(theme) => layout.upgradesNote(theme.initiative.space)}
      >
        Upgrading multiplies a site already held and costs{' '}
        <NumericValue
          as="strong"
          value={0}
          format={() => '0'}
          data-nullable-input="upgrade.mineSlotCost"
        />{' '}
        against the mine limit
        {headroom === null ? (
          <TextValue
            value={null}
            absentLabel="; remaining headroom for a new claim is unavailable"
          />
        ) : (
          <>, where a new claim costs one of the <NumericValue value={headroom} format={(n) => String(Math.round(n))} /> remaining</>
        )}.
        {' '}Total measured gain:{' '}
        <Measured register="mining" as="strong">
          <ResourceGainList gains={upgrades.totalMonthlyGain} emptyLabel="none" />
        </Measured>{' '}
        per month.
      </Box>
      {!opportunitiesReported ? (
        <Box
          component="div"
          className="mining-upgrades-note"
          sx={(theme) => layout.upgradesNote(theme.initiative.space)}
        >
          <TextValue
            value={null}
            absentLabel={`Upgrade opportunity rows unavailable ${ABSENT_LABEL} the list may be incomplete.`}
          />
        </Box>
      ) : rows.length > 0 ? (
        <>
          <DataTable variant="mining" subVariant="upgrades" columns={UPGRADE_COLUMNS}>
            <tbody>
              {rows.map((row, index) => (
                <UpgradeRow
                  key={hasText(row.siteId) ? String(row.siteId) : `upgrade-${index}`}
                  opportunity={row}
                  rowIndex={index}
                />
              ))}
            </tbody>
          </DataTable>
          {(omitted === null || omitted > 0) ? (
            <TruncationNote
              className="mining-upgrades-blocked"
              totalCount={available}
              omittedCount={omitted}
              shownCount={rows.length}
              unknownLabel="Upgrade total not read — list may be incomplete."
              formatTruncated={({ shown, total }) => (
                `Top ${shown} of ${total} available upgrades shown.`
              )}
            />
          ) : null}
        </>
      ) : (
        <Box
          component="div"
          className="mining-upgrades-note"
          sx={(theme) => layout.upgradesNote(theme.initiative.space)}
        >No mine has a researched upgrade available.</Box>
      )}
      {blocked.notes.length > 0 ? (
        <Box
          component="small"
          className="mining-upgrades-blocked"
          sx={(theme) => layout.upgradesBlocked(theme.initiative.space)}
        >
          Excluded:{' '}
          {blocked.notes.map((entry, index) => (
            <React.Fragment key={entry.key}>
              {index > 0 ? '; ' : ''}
              <NumericValue value={entry.value} format={(n) => String(Math.round(n))} />{' '}
              {entry.suffix}
            </React.Fragment>
          ))}.
        </Box>
      ) : null}
      {blocked.unknown.length > 0 ? (
        <Box
          component="small"
          className="mining-upgrades-blocked"
          sx={(theme) => layout.upgradesBlocked(theme.initiative.space)}
        >
          <TextValue
            value={null}
            absentLabel={`Excluded counts unavailable for: ${blocked.unknown.join('; ')}.`}
          />
        </Box>
      ) : null}
    </Box>
  );
}

function MiningTechBonusNote({ bonus }) {
  if (!bonus) {
    return (
      <TextValue
        value={null}
        absentLabel={`MINE TECH BONUSES NOT REPORTED by this snapshot ${ABSENT_LABEL} yields are raw deposit rates.`}
      />
    );
  }
  if (bonus.available !== true) {
    return (
      <TextValue
        value={null}
        absentLabel={`MINE TECH BONUSES UNRESOLVED ${ABSENT_LABEL} yields are raw deposit rates and are a lower bound, not a measured “no bonus”.`}
      />
    );
  }

  if (!Array.isArray(bonus.boostedResources)) {
    return (
      <TextValue
        value={null}
        absentLabel={`MINE TECH BONUS RESOURCE LIST UNAVAILABLE ${ABSENT_LABEL} yields cannot be labelled as adjusted or measured-none.`}
      />
    );
  }

  const boosted = bonus.boostedResources;
  if (boosted.length === 0) {
    return <TextValue value="No completed project raises mine output, so yields carry no tech multiplier." />;
  }

  return (
    <>
      Yields include completed-project mine bonuses:{' '}
      {boosted.map((key, index) => {
        const multiplier = numberOrNull(bonus.byResource?.[key]?.multiplier);
        const grants = bonus.byResource?.[key]?.grants;
        const grantValues = Array.isArray(grants) ? grants : [];
        const sourceText = grantValues.length > 0
          ? grantValues.map((grant) => safeText(grant, '(unnamed grant)')).join(' + ')
          : 'source not named';
        const multiplierText = resolveValue({
          value: multiplier,
          present: multiplier !== null,
          format: (raw) => String(raw),
        }).text;
        const clause = `${safeText(key, 'unnamed resource')} ×${multiplierText} (${sourceText})`;
        const clausePresent = hasText(key)
          && multiplier !== null
          && Array.isArray(grants)
          && grantValues.every(hasText);
        const punctuatedClause = `${clause}${index < boosted.length - 1 ? ',' : '.'}`;
        return (
          <React.Fragment key={`${safeText(key, 'resource')}-${index}`}>
            <TextValue
              value={clausePresent ? punctuatedClause : null}
              absentLabel={punctuatedClause}
            />
            {index < boosted.length - 1 ? ' ' : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SpaceBonusSources({ sources }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return <TextValue value={null} absentLabel="source not named" />;
  }

  return sources.map((source, index) => (
    <React.Fragment key={`${safeText(source?.name, 'unnamed')}-${index}`}>
      {index > 0 ? ', ' : ''}
      <TextValue
        value={source?.name}
        absentLabel="(unnamed source)"
        data-nullable-input="spaceMiningBonus.sources[].name"
      />{' '}
      <NumericValue
        value={source?.value}
        absentLabel="bonus unavailable"
        format={(n) => `+${Math.round(n * 100)}%`}
      />
    </React.Fragment>
  ));
}

function SpaceMiningBonusNote({ bonus }) {
  if (!bonus) {
    return (
      <>
        {' '}<TextValue
          value={null}
          absentLabel={`FACTION-WIDE SPACE-MINING BONUS NOT REPORTED by this snapshot ${ABSENT_LABEL} yields omit it.`}
        />
      </>
    );
  }
  if (bonus.available !== true) {
    return (
      <>
        {' '}<TextValue
          value={null}
          absentLabel={`FACTION-WIDE SPACE-MINING BONUS UNRESOLVED ${ABSENT_LABEL} yields omit it and are a lower bound, not a measured “no bonus”.`}
        />
      </>
    );
  }

  const total = numberOrNull(bonus.additiveTotal);
  if (total === null) {
    return (
      <>
        {' '}<NumericValue
          value={bonus.additiveTotal}
          absentLabel={`FACTION-WIDE SPACE-MINING BONUS UNREADABLE ${ABSENT_LABEL} yields omit it.`}
        />
      </>
    );
  }
  if (total === 0) {
    return <TextValue value=" No active org or effect raises mine output faction-wide (measured, not assumed)." />;
  }

  return (
    <>
      {' '}They also include the faction-wide space-mining bonus of{' '}
      <NumericValue value={total} format={(n) => `+${Math.round(n * 100)}%`} />{' '}
      (<SpaceBonusSources sources={bonus.sources} />), which is additive and applied after the multipliers above.
    </>
  );
}

function YieldBasis({ miningBonus, spaceBonus }) {
  return (
    <Box
      className="mining-yield-basis"
      sx={(theme) => layout.basis(theme.initiative.space)}
    >
      <MiningTechBonusNote bonus={miningBonus} />
      <SpaceMiningBonusNote bonus={spaceBonus} />
    </Box>
  );
}

function ModuleBasis({ capability }) {
  const range = capability?.projectedMultiplierRange;
  const low = numberOrNull(range?.low);
  const high = numberOrNull(range?.high);

  let content;
  if (!capability) {
    content = (
      <TextValue
        value={null}
        absentLabel={`MINE MODULE MULTIPLIER NOT REPORTED by this snapshot ${ABSENT_LABEL} yields are deposit rates with no module term, and the score excludes it.`}
      />
    );
  } else if (low === null || high === null) {
    const why = capability.available === true
      ? 'the observer has completed no mine-complex project, so there is no tier it could build.'
      : safeText(capability.unavailableReason, 'the observer\'s buildable tiers are unresolved.');
    content = (
      <TextValue
        value={null}
        absentLabel={`Mine module multiplier: UNKNOWN ${ABSENT_LABEL} ${why} It is excluded from the utility score either way.`}
      />
    );
  } else {
    const lowLabel = safeText(range?.lowLabel ?? range?.lowModule, 'unresolved tier');
    const highLabel = safeText(range?.highLabel ?? range?.highModule, 'unresolved tier');
    content = (
      <TextValue
        value={`ESTIMATE — a built mine multiplies these deposit rates by ×${low} to ×${high} (${lowLabel} to ${highLabel}, the tiers the observer has researched). It is deliberately NOT in the utility score: every site here is unowned, so the tier is a decision rather than a reading, and the score saturates — a uniform assumed multiplier reorders this board rather than scaling it.`}
      />
    );
  }

  return (
    <Box
      className="mining-yield-basis"
      sx={(theme) => layout.basis(theme.initiative.space)}
    >
      <Estimated register="mining">{content}</Estimated>
    </Box>
  );
}

function AvailableSection({ available, availableReported, totalAvailable, capability }) {
  const shown = available.slice(0, CANDIDATE_ROW_LIMIT);
  const omitted = !availableReported || totalAvailable === null
    ? null
    : Math.max(0, totalAvailable - shown.length);

  return (
    <>
      <Box
        component="div"
        className="mining-section-title"
        sx={(theme) => layout.sectionTitle(theme.initiative.space)}
      >
        <span>
          AVAILABLE EXPANSION SITES{' '}
          <NumericValue
            value={totalAvailable}
            absentLabel="(site count unavailable)"
            format={(n) => `(${Math.round(n)})`}
          />
        </span>
        <TruncationNote
          className="mining-section-truncation"
          totalCount={omitted !== null && omitted > 0 ? totalAvailable : null}
          omittedCount={omitted}
          shownCount={shown.length}
          unknownLabel="Total unavailable; ranked by saturating utility per unit of alien hate"
          allShownLabel="Ranked by saturating utility per unit of alien hate"
          formatTruncated={({ shown: shownCount, total }) => (
            `Top ${shownCount} of ${total}, ranked by saturating utility per unit of alien hate`
          )}
        />
      </Box>

      <DataTable variant="mining" columns={CANDIDATE_COLUMNS}>
        <tbody>
          {!availableReported ? (
            <tr>
              <td colSpan="4" className="mining-empty-cell">
                <TextValue
                  value={null}
                  absentLabel="Expansion site rows unavailable in this snapshot."
                />
              </td>
            </tr>
          ) : shown.length > 0 ? shown.map((candidate, index) => (
            <CandidateRow
              key={hasText(candidate?.siteId) ? String(candidate.siteId) : `candidate-${index}`}
              candidate={candidate}
              capability={capability}
              rowIndex={index}
            />
          )) : (
            <tr>
              <td colSpan="4" className="mining-empty-cell">
                No unowned reachable sites available in current theater.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
    </>
  );
}

function TechGatedSection({ groups, groupsReported }) {
  if (!groupsReported) {
    return (
      <Box
        component="div"
        className="mining-section-title mining-section-title--gated"
        sx={(theme) => ({
          ...layout.sectionTitle(theme.initiative.space),
          ...layout.gatedTitle(theme.initiative.space),
        })}
      >
        <span>
          TECH-GATED OPPORTUNITIES{' '}
          <TextValue value={null} absentLabel="(site count unavailable)" />
        </span>
        <small>
          <TextValue value={null} absentLabel="Opportunity groups unavailable" />
        </small>
      </Box>
    );
  }
  if (groups.length === 0) return null;
  const counts = groups.map((group) => numberOrNull(group?.siteCount));
  const total = counts.some((count) => count === null)
    ? null
    : counts.reduce((sum, count) => sum + count, 0);

  return (
    <>
      <Box
        component="div"
        className="mining-section-title mining-section-title--gated"
        sx={(theme) => ({
          ...layout.sectionTitle(theme.initiative.space),
          ...layout.gatedTitle(theme.initiative.space),
        })}
      >
        <span>
          TECH-GATED OPPORTUNITIES{' '}
          <NumericValue
            value={total}
            absentLabel="(site count unavailable)"
            format={(n) => `(${Math.round(n)} sites)`}
          />
        </span>
        <small>Requires destination or mine module research</small>
      </Box>
      <Box
        component="div"
        className="mining-gated-grid"
        sx={(theme) => layout.gatedGrid(theme.initiative.space)}
      >
        {groups.slice(0, 4).map((group, index) => {
          const unmeasured = numberOrNull(group?.unmeasuredSiteCount);
          return (
            <Box
              component="div"
              className="mining-gated-item"
              sx={(theme) => layout.gatedItem(theme.initiative.space)}
              key={safeText(group?.missingTech, `gated-${index}`)}
            >
              <Box
                component="div"
                className="mining-gated-header"
                sx={(theme) => layout.gatedHeader(theme.initiative.space)}
              >
                <strong className="mining-gated-tech">
                  <TextValue
                    value={group?.missingTechName ?? group?.missingTech}
                    absentLabel="Unknown tech"
                  />
                </strong>
                <span className="mining-gated-count">
                  <NumericValue
                    value={group?.siteCount}
                    absentLabel="site count unavailable"
                    format={(n) => `${Math.round(n)} sites`}
                  />
                </span>
              </Box>
              <Box
                component="div"
                className="mining-gated-meta"
                sx={(theme) => layout.gatedMeta(theme.initiative.space)}
              >
                <span>
                  Top site value:{' '}
                  <strong>
                    <NumericValue value={group?.bestSiteValue} format={(n) => n.toFixed(2)} />
                  </strong>
                </span>
                <small className="mining-gated-sub">
                  {unmeasured === null ? (
                    <NumericValue value={group?.unmeasuredSiteCount} absentLabel="unscored count unavailable" />
                  ) : unmeasured > 0 ? (
                    <NumericValue value={unmeasured} format={(n) => `${Math.round(n)} unscored`} />
                  ) : (
                    'Research argument'
                  )}
                </small>
              </Box>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

function UnreachableSummary({ total }) {
  const parsed = numberOrNull(total);
  if (parsed === null) {
    return (
      <Box
        component="div"
        className="mining-unreachable-summary"
        sx={(theme) => layout.unreachable(theme.initiative.space)}
      >
        <small>
          <NumericValue value={total} absentLabel="Unreachable site count unavailable." />
        </small>
      </Box>
    );
  }
  if (parsed === 0) {
    return (
      <Box
        component="div"
        className="mining-unreachable-summary"
        sx={(theme) => layout.unreachable(theme.initiative.space)}
      >
        <small>No outer system / unprobed sites are currently unreachable.</small>
      </Box>
    );
  }
  return (
    <Box
      component="div"
      className="mining-unreachable-summary"
      sx={(theme) => layout.unreachable(theme.initiative.space)}
    >
      <small>
        <NumericValue value={parsed} format={(n) => String(Math.round(n))} />{' '}
        outer system / unprobed sites currently unreachable without deep system mission projects.
      </small>
    </Box>
  );
}

export function MiningExpansion({ data }) {
  const expansion = data?.miningExpansion || data;
  const capacity = expansion?.capacity;

  if (!capacity) {
    return (
      <ThemeProvider theme={initiativeTheme}>
        <Box component="div" className="alien-hate-econ-empty">
          MINING EXPANSION DATA UNAVAILABLE
        </Box>
      </ThemeProvider>
    );
  }

  const availableReported = Array.isArray(expansion.available);
  const available = availableReported ? expansion.available : [];
  const techGatedReported = Array.isArray(expansion.techGated);
  const techGated = techGatedReported ? expansion.techGated : [];
  const runwaysReported = expansion.resourceRunways
    && typeof expansion.resourceRunways === 'object';
  const runways = runwaysReported
    ? expansion.resourceRunways
    : {};
  const capability = expansion.mineModuleCapability || null;
  const totalAvailable = numberOrNull(expansion.availableTotalCount);
  const warFloorDistance = numberOrNull(capacity.mcWarFloorDistance);
  const hateAvailable = capacity.hateCostAvailable !== false
    && numberOrNull(capacity.baseHateMultiplier) !== null;
  const status = CapacityStatus({ capacity });

  return (
    <ThemeProvider theme={initiativeTheme}>
      <Box
        component="div"
        className="mining-expansion-board"
        data-testid="mining-expansion-board"
        sx={(theme) => layout.board(theme.initiative.space)}
      >
      <Box
        component="div"
        className="alien-hate-econ-statusbar"
        sx={(theme) => layout.statusbar(theme.initiative.space)}
      >
        <div>
          <span className="alien-hate-econ-eyebrow">MINING CAPACITY</span>
          <strong className={`alien-hate-econ-status ${status.tone}`}>{status.label}</strong>
        </div>
        <div className="alien-hate-econ-sub">{status.note}</div>
      </Box>

      {!hateAvailable ? (
        <Box
          component="div"
          className="mining-unavailable-banner"
          sx={(theme) => layout.unavailableBanner(theme.initiative.space)}
          title="Difficulty selects the alien minimum-hate floor multiplier (Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00)."
        >
          ALIEN-HATE COSTS UNAVAILABLE — this snapshot carries no readable difficulty, so mine hate cost cannot be priced.
        </Box>
      ) : null}

      <Box
        component="div"
        className="mining-runways-bar"
        sx={(theme) => layout.runways(theme.initiative.space)}
      >
        <span className="mining-runways-label">RUNWAYS:</span>
        {!runwaysReported ? (
          <span className="mining-runway-pill is-neutral">
            <TextValue value={null} absentLabel="Runway data unavailable" />
          </span>
        ) : Object.keys(runways).length > 0
          ? Object.entries(runways).map(([runwayKey, runway], index) => (
            <RunwayPill
              key={safeText(runway?.key ?? runwayKey, `runway-${index}`)}
              runway={runway}
              runwayKey={runwayKey}
            />
          ))
          : <span className="mining-runway-pill is-neutral">No runway data</span>}
        {warFloorDistance !== null ? (
          <span className="mining-war-floor-pill">
            War Floor:{' '}
            <strong>
              <NumericValue value={warFloorDistance} format={(n) => `${n.toFixed(1)} MC`} />
            </strong>{' '}
            away
          </span>
        ) : (
          <span
            className="mining-war-floor-pill is-unknown"
            title="Needs both used Mission Control and the difficulty multiplier."
          >
            War Floor: <strong><NumericValue value={capacity.mcWarFloorDistance} absentLabel="unavailable" /></strong>
          </span>
        )}
      </Box>

      <YieldBasis
        miningBonus={expansion.miningTechBonus}
        spaceBonus={expansion.spaceMiningBonus}
      />
      <ModuleBasis capability={capability} />

      <MineUpgrades upgrades={expansion.mineUpgrades} capacity={capacity} />

      <AvailableSection
        available={available}
        availableReported={availableReported}
        totalAvailable={totalAvailable}
        capability={capability}
      />

      <TechGatedSection groups={techGated} groupsReported={techGatedReported} />
      <UnreachableSummary total={expansion.unreachable?.totalSites} />
      </Box>
    </ThemeProvider>
  );
}
