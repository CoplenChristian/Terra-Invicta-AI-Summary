/**
 * src/v2/panels/ResearchAdvisor.jsx
 *
 * Purpose: the COMMAND-view research advisor — what to research next, in two
 *   parallel rankings that are never added together.
 *
 * Migrated from `public/v2/js/components/research-advisor.js` on 2026-08-26.
 * The three rendering rules that file was built around are stated in
 * `researchAdvisorUtils.mjs`; two structural notes belong here:
 *
 * RULE 2 IS STRUCTURAL NOW. Upstream `reason` prose reaches `title=` and never
 * `textContent`. Every row model keeps `title` and `text` as separate fields,
 * so there is no shape in which an upstream sentence — several of which contain
 * the word "null" as a technical term — can be handed to the DOM as visible
 * copy by accident.
 *
 * WHY THE META LINE IS ONE TEXT NODE. `.ra-row__meta` is `display: flex` with a
 * 4px gap (public/v2/css/20-research-advisor.css:280). The vanilla emitted the
 * cost, the duration and the roll note as ONE joined string, which the browser
 * wraps in a single anonymous flex item, with the `.ra-tag` badges as separate
 * items after it. Splitting that string into per-figure <Value> spans would turn
 * each figure AND each " · " separator into its own flex item with its own gap,
 * which changes the rendered line and the column-height balance
 * scripts/verify_research_tab_layout.js measures. The null discipline is not
 * weakened by that: `int()`, `months()` and `researchDuration()` each return the
 * em dash for an absent value and can never return a zero, which is the same
 * explicit-presence guarantee <Value> carries. Standalone figures — the metric
 * cell, the group count, the deficit numbers, the foot income — do route through
 * <Value>, where no flex line is affected.
 */

import React from 'react';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { Value } from '../components/Value.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import initiativeTheme from '../theme.js';
import {
  ACTIONABLE_GROUPS,
  BACKLOG_TITLE,
  DELIVERY_DEMOTED_TITLE,
  ECONOMIC_CAPTION_TITLE,
  MILITARY_AXIS_CAPTION_TITLE,
  NO_ECONOMIC_PRICE_TEXT,
  NO_INCOME_TEXT,
  ROWS_PER_GROUP,
  SLOT_TITLE,
  UNAVAILABLE,
  censusModel,
  deficitModel,
  deliveryDemotedModel,
  economicRowModel,
  economicView,
  footModel,
  groupOmissionText,
  int,
  militaryEmptyText,
  militaryRowModel,
  num,
  openFullRanking,
  queueModel,
  unavailableState,
  visibleGroups,
} from './researchAdvisorUtils.mjs';

/**
 * A figure with an explicit presence signal.
 *
 * `text` is already formatted by the null-safe formatters, so `present` is the
 * only thing that decides between the figure and the absent label — there is no
 * truthiness test on a value that could legitimately be zero.
 */
function Fig({ text, present, absentLabel = UNAVAILABLE, ...rest }) {
  return (
    <Value
      value={text}
      present={present}
      absentLabel={absentLabel}
      format={(raw) => String(raw)}
      {...rest}
    />
  );
}

// MUI owns the panel's geometry and spacing. These values mirror the existing
// research-advisor stylesheet exactly; its type, colour, borders and surfaces
// remain the visual authority. Box's default host keeps every semantic element
// in place, and `component` is used only where the existing host is not a div.
const layout = {
  deficit: { display: 'grid', gap: '1px', padding: '2px 6px' },
  deficitTop: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '3px 6px' },
  queue: (space) => ({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: `${space['2xs']} ${space.sm}`,
    padding: `${space['2xs']} ${space.sm}`,
  }),
  queueItems: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  tracks: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '4px 12px',
    alignItems: 'stretch',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
  },
  track: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, height: '100%' },
  trackHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px', paddingBottom: '1px' },
  groupLabel: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' },
  rowHead: (space) => ({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }),
  rowMeta: (space) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }),
  trackFoot: (space) => ({
    marginTop: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space['2xs'],
    paddingTop: space['2xs'],
  }),
};

/** The badges after a row's cost and duration. `title` never becomes a child. */
function RowTags({ notes }) {
  return notes.map((note) => (
    <React.Fragment key={note.key}>
      {' '}
      <span className={note.className} title={note.title}>{note.text}</span>
    </React.Fragment>
  ));
}

function MilitaryRow({ row }) {
  const model = militaryRowModel(row);
  return (
    <li className="ra-row">
      <Box className="ra-row__head" sx={(theme) => layout.rowHead(theme.initiative.space)}>
        <span className="ra-row__name" title={model.name.tooltip}>
          {model.name.lead}
          {model.name.sub ? (
            <>
              {' '}
              <span className="ra-row__sub">{model.name.sub}</span>
            </>
          ) : null}
        </span>
        <span className="ra-row__metric" title={model.axisTitle}>
          {model.isFirstInClass ? 'First of kind' : (
            <>
              <Fig text={model.multipleText} present={model.multiplePresent} />
              {' '}
              {model.axisLabel}
            </>
          )}
        </span>
      </Box>
      <Box
        className="ra-row__meta"
        title={model.metaTitle}
        sx={(theme) => layout.rowMeta(theme.initiative.space)}
      >
        {model.metaText}
        <RowTags notes={model.notes} />
      </Box>
    </li>
  );
}

function EconomicRow({ row }) {
  const model = economicRowModel(row);
  return (
    <li className="ra-row">
      <Box className="ra-row__head" sx={(theme) => layout.rowHead(theme.initiative.space)}>
        <span className="ra-row__name" title={model.id}>{model.displayName}</span>
        <span className="ra-row__metric" title={model.effectTitle}>
          <Fig text={model.quantityText} present={model.quantityPresent} />
        </span>
      </Box>
      <Box
        className="ra-row__meta"
        title={model.metaTitle}
        sx={(theme) => layout.rowMeta(theme.initiative.space)}
      >
        {model.metaText}
        <RowTags notes={model.notes} />
      </Box>
    </li>
  );
}

/**
 * The first `GROUPS_SHOWN` populated groups, separating Actionable (buildable
 * now, researchable now) from Aspirational — and the count of what the cap
 * removed, which register defect #5 was the absence of.
 */
function Groups({ groups, RowComponent, emptyText }) {
  const { populated, shown, omittedGroups } = visibleGroups(groups);
  if (shown.length === 0) {
    return <p className="ra-empty-group">{emptyText}</p>;
  }
  return (
    <>
      {shown.map((group, index) => (
        <div
          key={`${String(group.state || 'group')}-${index}`}
          className={`ra-group${ACTIONABLE_GROUPS.includes(group.state) ? ' is-actionable' : ' is-aspirational'}`}
        >
          <Box className="ra-group__label" sx={layout.groupLabel}>
            <span>{group.label || group.state || 'Unknown'}</span>
            <small>
              <Fig text={int(group.count)} present={num(group.count) !== null} />
              {' ranked'}
            </small>
          </Box>
          <Box component="ul" className="ra-group__list" sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {group.items.slice(0, ROWS_PER_GROUP).map((row, rowIndex) => (
              <RowComponent key={`${String(row.id || 'row')}-${rowIndex}`} row={row} />
            ))}
          </Box>
        </div>
      ))}
      {omittedGroups > 0 ? (
        <TruncationNote
          className="ra-census"
          totalCount={populated.length}
          omittedCount={omittedGroups}
          shownCount={shown.length}
          formatTruncated={({ shown: shownCount, omitted, total }) => groupOmissionText({
            shown: shownCount,
            total,
            omitted,
          })}
        />
      ) : null}
    </>
  );
}

function DeficitBanner({ payload }) {
  const model = deficitModel(payload);
  if (model.variant === 'is-gap') {
    return (
      <Box component="p" className="ra-deficit is-gap" title={model.title} sx={layout.deficit}>
        <Box component="span" className="ra-deficit__top" sx={layout.deficitTop}>
          <span className="ra-deficit__label">{model.label}</span>
          {' '}
          <strong>
            {model.axisLabel}
            {' '}
            <Fig text={model.gapText} present={model.gapPresent} />
          </strong>
        </Box>
        <span className="ra-deficit__detail">
          <Fig text={model.oursText} present={model.oursPresent} />
          {' ours vs '}
          <Fig text={model.theirsText} present={model.theirsPresent} />
          {' alien — research that moves it is ordered first.'}
          {' '}
          <em className="ra-deficit__judgement">Our inference from a measurement, not shipped data.</em>
        </span>
      </Box>
    );
  }

  return (
    <Box component="p" className={`ra-deficit ${model.variant}`} title={model.title} sx={layout.deficit}>
      <Box component="span" className="ra-deficit__top" sx={layout.deficitTop}>
        <span className="ra-deficit__label">{model.label}</span>
        {' '}
        <strong>{model.headline}</strong>
      </Box>
      <span className="ra-deficit__detail">{model.detail}</span>
    </Box>
  );
}

function Queue({ slots }) {
  const model = queueModel(slots);
  if (!model) return null;
  if (model.turnOne) {
    return (
      <Box className="ra-queue" sx={(theme) => layout.queue(theme.initiative.space)}>
        <span className="ra-queue__capacity">{model.capacityText}</span>
        <span className="ra-queue__items">{model.itemsText}</span>
      </Box>
    );
  }
  return (
    <Box className="ra-queue" title={SLOT_TITLE} sx={(theme) => layout.queue(theme.initiative.space)}>
      <span className={`ra-queue__capacity ${model.isFree ? 'is-free' : 'is-full'}`}>{model.capacityText}</span>
      <Box className="ra-queue__items" sx={layout.queueItems}>
        {model.emptyItemsText ? (
          <span className="ra-queue__item">{model.emptyItemsText}</span>
        ) : (
          <>
            {model.active.map((item, index) => (
              <React.Fragment key={item.key}>
                {index > 0 ? ' · ' : null}
                <span className="ra-queue__item">
                  {item.label}
                  {/* An unmeasured progress percent is left off rather than
                      printed as "(—%)": the project name alone claims nothing,
                      whereas a dash inside brackets reads as a progress figure
                      that failed to load. */}
                  <span className="ra-queue__item-val">{item.percentText}</span>
                </span>
              </React.Fragment>
            ))}
            {model.backlogs ? (
              <>
                {' · '}
                <span className="ra-tag" title={BACKLOG_TITLE}>backlogs active</span>
              </>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}

function Census({ model }) {
  return <p className="ra-census" title={model.title}>{model.text}</p>;
}

function Unavailable({ headline, detail }) {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <div className="research-advisor">
        <p className="research-advisor__empty">{headline}</p>
        {detail ? <p className="ra-census">{detail}</p> : null}
      </div>
    </ThemeProvider>
  );
}

export function ResearchAdvisor({ payload }) {
  const onOpenFullRanking = React.useCallback(() => {
    openFullRanking(payload);
  }, [payload]);

  const unavailable = unavailableState(payload);
  if (unavailable) {
    return <Unavailable headline={unavailable.headline} detail={unavailable.detail} />;
  }

  const economic = economicView(payload);
  const foot = footModel(payload);
  const militaryCensus = censusModel(
    payload.military.unrankable,
    `${int(payload.military.rankedCount)} of ${int(payload.military.candidatesConsidered)} ranked`,
  );
  const economicCensus = censusModel(
    payload.economic.unrankable,
    `${int(payload.economic.rankedCount)} of ${int(payload.economic.candidatesConsidered)} ranked`,
    economic.otherUnits.length > 0 ? `+${int(economic.otherUnits.length)} more units` : null,
    economic.otherUnits.length > 0
      ? `Also priced in ${economic.otherUnits.join(', ')}. Open the full ranking for those.`
      : null,
  );
  const demoted = deliveryDemotedModel(payload.military.deliveryDemoted);

  return (
    <ThemeProvider theme={initiativeTheme}>
      <div className="research-advisor">
      <DeficitBanner payload={payload} />
      <Queue slots={payload.slots} />
      <Box className="ra-tracks" sx={layout.tracks}>
        <Box component="section" className="ra-track" sx={layout.track}>
          <Box className="ra-track__head" sx={layout.trackHead}>
            <h4>MILITARY RESEARCH</h4>
            <small title={MILITARY_AXIS_CAPTION_TITLE}>× your best, per point</small>
          </Box>
          <Groups
            groups={payload.military.groups}
            RowComponent={MilitaryRow}
            emptyText={militaryEmptyText(payload)}
          />
          <Box className="ra-track__foot" sx={(theme) => layout.trackFoot(theme.initiative.space)}>
            <Census model={militaryCensus} />
            {demoted ? (
              <p className="ra-census" title={DELIVERY_DEMOTED_TITLE}>{demoted.text}</p>
            ) : null}
          </Box>
        </Box>
        <Box component="section" className="ra-track" sx={layout.track}>
          <Box className="ra-track__head" sx={layout.trackHead}>
            <h4>ECONOMIC</h4>
            <small title={ECONOMIC_CAPTION_TITLE}>{economic.caption}</small>
          </Box>
          <Groups
            groups={economic.leadUnit ? economic.leadUnit.groups : []}
            RowComponent={EconomicRow}
            emptyText={NO_ECONOMIC_PRICE_TEXT}
          />
          <Box className="ra-track__foot" sx={(theme) => layout.trackFoot(theme.initiative.space)}>
            <Census model={economicCensus} />
          </Box>
        </Box>
      </Box>
      <div className="ra-foot">
        <span title={foot.title}>
          <Fig text={foot.incomeLabel} present={foot.incomePresent} absentLabel={NO_INCOME_TEXT} />
          {foot.slotLabel ? ` · ${foot.slotLabel}` : ''}
        </span>
        <button
          type="button"
          className="init-btn ra-foot__btn"
          data-research-advisor-full=""
          onClick={onOpenFullRanking}
        >
          Full ranking
        </button>
      </div>
      </div>
    </ThemeProvider>
  );
}

export default ResearchAdvisor;
