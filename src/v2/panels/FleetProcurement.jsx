/**
 * src/v2/panels/FleetProcurement.jsx
 *
 * Purpose: the FLEET view — what is already unlocked but not in service, and the
 *   validated refit advisor card per fielded design.
 *
 * Migrated from `public/v2/js/components/fleet-procurement.js` on 2026-08-26.
 * Every formatter, row model and detail-panel fact lives in
 * `fleetProcurementUtils.mjs`; the notes that belong here are about markup.
 *
 * REGISTER DEFECT #4 IS FIXED, NOT PORTED. An armour material the panel cannot
 * price no longer scores a fabricated `1.0`. It renders a neutral "protection
 * ratio unmeasured" tag naming the material instead of a confident red
 * "15.2× behind". See the header of `fleetProcurementUtils.mjs`.
 *
 * REGISTER DEFECT #20 IS FIXED, NOT PORTED. A dead refit endpoint, an explicit
 * `success: false` answer and a measured-empty candidate list each render their
 * own affordance beside a procurement half that already reported its failures.
 * See `refitView` in `fleetProcurementUtils.mjs`.
 *
 * WHY FIGURES ARE SPLIT ONLY WHERE THEIR HOST CAN TAKE AN ELEMENT. Every
 * standalone figure and every figure inside a composed sentence routes through
 * <Value>, so its own input stamps `data-value-state`. `as` keeps the existing
 * host element when a register or inline sentence requires one; it adds no
 * wrapper node. The string-building utility uses the same primitive's exported
 * `resolveValue()` for titles and detail-panel facts. Joined prose such as the
 * procurement meta line remains one text node because its separators are not
 * figures.
 *
 * MUI owns layout and spacing below. The existing stylesheet continues to own
 * type, colour, borders and surfaces; the `sx` values mirror its current
 * geometry. `InlineSpanBox` takes back `display: inline` at the composed-value
 * host without `!important` because a stylesheet selector for a span may also
 * apply to a nested value in a future panel rule.
 *
 * WHY <TruncationNote> IS CONDITIONAL. The vanilla emitted the census line only
 * when something was actually omitted, and the live endpoint answers
 * `detail=full`, so `omittedCount` is zero on every real render. An
 * unconditional note would put "All entries shown." on screen where the reader
 * has never seen a line at all. Same call the research advisor made.
 */

import React from 'react';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { Value } from '../components/Value.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import initiativeTheme from '../theme.js';
import {
  NOTHING_UNFIELDED,
  NO_ENDPOINT_ANSWER,
  NO_REFIT_CANDIDATES,
  NO_REFIT_ENDPOINT_ANSWER,
  PROCUREMENT_UNAVAILABLE_HEADLINE,
  REFIT_FAILURE_ANSWER,
  REFIT_NOTICE,
  REFIT_UNAVAILABLE_HEADLINE,
  int,
  normalizePayload,
  num,
  openProcurementDetails,
  openRefitDetails,
  procurementRowModel,
  procurementTruncationText,
  procurementView,
  refitCardModel,
  sortRefitItems,
} from './fleetProcurementUtils.mjs';

/**
 * A figure with an explicit presence signal. `text` is already formatted by the
 * null-safe formatters, so `present` is the only thing deciding between the
 * figure and the absent label — there is no truthiness test on a value that
 * could legitimately be zero.
 */
function Fig({ text, present, ...rest }) {
  return <Value value={text} present={present} format={(raw) => String(raw)} {...rest} />;
}

const InlineSpanBox = (props) => (
  <Box component="span" {...props} sx={{ '&&': { display: 'inline' } }} />
);

const layout = {
  column: (gap) => ({ display: 'flex', flexDirection: 'column', gap }),
  header: (space) => ({
    display: 'flex',
    gap: space.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space.lg} ${space['2xl']}`,
  }),
  rowHead: (space) => ({
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  }),
  rowMeta: (space) => ({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xs,
  }),
  foot: (space) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.sm,
  }),
};

/** The badges after a procurement row's action. `title` never becomes a child. */
function RowTags({ notes }) {
  return notes.map((note) => (
    <React.Fragment key={note.key}>
      {' '}
      <span className={note.className} title={note.title}>{note.text}</span>
    </React.Fragment>
  ));
}

function ProcurementRow({ row }) {
  const model = procurementRowModel(row);
  return (
    <li className="ra-row fp-row">
      <Box
        className="ra-row__head"
        sx={(theme) => layout.rowHead(theme.initiative.space)}
      >
        <span className="ra-row__name fp-row__name" title={model.name.tooltip}>{model.name.lead}</span>
        <span className="ra-row__metric fp-row__metric" title={model.axisTitle}>
          <Fig text={model.multipleText} present={model.multiplePresent} />
          {' '}
          {model.axisLabel}
        </span>
      </Box>
      <Box
        className="ra-row__meta fp-row__meta"
        sx={(theme) => layout.rowMeta(theme.initiative.space)}
      >
        {model.metaText}
        <RowTags notes={model.notes} />
      </Box>
    </li>
  );
}

/**
 * The procurement half.
 *
 * Three states and they are not interchangeable: the endpoint did not answer,
 * the endpoint answered with nothing unfielded, and a ranked list. A blank card
 * is not one of them.
 */
function ProcurementCard({ payload, onFullBreakdown }) {
  const view = procurementView(payload);

  if (!view.available) {
    return (
      <Box className="fleet-procurement" sx={(theme) => layout.column(theme.initiative.space.md)}>
        <Box
          className="tech-card-header"
          sx={(theme) => layout.header(theme.initiative.space)}
        >
          <Box
            className="tech-card-title"
            sx={(theme) => ({ display: 'flex', minWidth: 0, gap: theme.initiative.space.md, alignItems: 'center' })}
          >
            FLEET PROCUREMENT
          </Box>
          <span>ALREADY UNLOCKED</span>
        </Box>
        <p className="research-advisor__empty">{PROCUREMENT_UNAVAILABLE_HEADLINE}</p>
        <p className="ra-census">{NO_ENDPOINT_ANSWER}</p>
      </Box>
    );
  }

  if (view.empty) {
    return (
      <Box className="fleet-procurement" sx={(theme) => layout.column(theme.initiative.space.md)}>
        <Box
          className="tech-card-header"
          sx={(theme) => layout.header(theme.initiative.space)}
        >
          <Box
            className="tech-card-title"
            sx={(theme) => ({ display: 'flex', minWidth: 0, gap: theme.initiative.space.md, alignItems: 'center' })}
          >
            FLEET PROCUREMENT
          </Box>
          <span><Fig text={int(view.count)} present={num(view.count) !== null} />{' UNFIELDED'}</span>
        </Box>
        <Box className="fp-body" sx={(theme) => layout.column(theme.initiative.space.md)}>
          <p className="ra-empty-group">{NOTHING_UNFIELDED}</p>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="fleet-procurement" sx={(theme) => layout.column(theme.initiative.space.md)}>
      <Box
        className="tech-card-header"
        sx={(theme) => layout.header(theme.initiative.space)}
      >
        <Box
          className="tech-card-title"
          sx={(theme) => ({ display: 'flex', minWidth: 0, gap: theme.initiative.space.md, alignItems: 'center' })}
        >
          FLEET PROCUREMENT
        </Box>
        <span>
          <Fig text={view.countText} present={num(view.count) !== null} />
          {' unfielded'}
        </span>
      </Box>
      <Box className="fp-body" sx={(theme) => layout.column(theme.initiative.space.md)}>
        <Box
          className="ra-procurement fp-procurement"
          sx={(theme) => ({
            ...layout.column('1px'),
            marginBottom: 0,
            padding: `${theme.initiative.space.md} ${theme.initiative.space.xl}`,
          })}
        >
          <Box
            className="ra-procurement__head fp-procurement__head"
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: theme.initiative.space.sm,
              paddingBottom: theme.initiative.space.xs,
            })}
          >
            <span>{view.label}</span>
            <small>
              <Fig text={view.countText} present={num(view.count) !== null} />
              {' unfielded'}
            </small>
          </Box>
          <Box
            component="ul"
            className="ra-group__list fp-group__list"
            sx={(theme) => ({
              ...layout.column(theme.initiative.space.xs),
              '& > .fp-row': { padding: '4px 0' },
            })}
          >
            {view.items.map((row, index) => (
              <ProcurementRow key={`${String(row.id || 'row')}-${index}`} row={row} />
            ))}
          </Box>
          {view.omittedCount > 0 ? (
            <TruncationNote
              className="ra-census"
              totalCount={view.count}
              omittedCount={view.omittedCount}
              shownCount={view.itemsShown}
              formatTruncated={procurementTruncationText}
            />
          ) : null}
        </Box>
      </Box>
      <Box className="ra-foot fp-foot" sx={(theme) => layout.foot(theme.initiative.space)}>
        <span>Zero research cost · ready for shipyard build or refit</span>
        <button
          type="button"
          className="init-btn ra-foot__btn"
          data-fleet-procurement-full=""
          onClick={onFullBreakdown}
        >
          Full breakdown
        </button>
      </Box>
    </Box>
  );
}

/** The four drive states, each its own sentence. `unknown-floor` is not a pass. */
function DriveBlock({ drive }) {
  if (drive.state === 'improved') {
    return (
      <Box
        className="fp-refit__drive"
        sx={(theme) => layout.column(theme.initiative.space['2xs'])}
      >
        <span className="fp-refit__label">Drive Refit:</span>
        <strong>{drive.recName}</strong>
        <span className="fp-refit__perf">
          {'ΔV: '}
          <Fig
            as={InlineSpanBox}
            text={drive.baseDeltaVText}
            present={num(drive.baseDeltaV) !== null}
          />
          {' → '}
          <Fig
            as={InlineSpanBox}
            text={drive.recDeltaVText}
            present={num(drive.recDeltaV) !== null}
          />
          {' km/s · Accel: '}
          <Fig
            as={InlineSpanBox}
            text={drive.baseAccelText}
            present={num(drive.baseAccel) !== null}
          />
          {' → '}
          <Fig
            as={InlineSpanBox}
            text={drive.recAccelText}
            present={num(drive.recAccel) !== null}
          />
          {' m/s²'}
        </span>
        {drive.dryMassCaveat ? (
          <small className="fp-refit__caveat" title={drive.dryMassCaveat}>constant-dry-mass caveat</small>
        ) : null}
      </Box>
    );
  }

  if (drive.state === 'already-fitted') {
    return (
      <Box
        className="fp-refit__drive fp-refit__drive--none"
        sx={(theme) => layout.column(theme.initiative.space['2xs'])}
      >
        <span className="fp-refit__label">Drive:</span>
        <span>{`Best available drive already fitted (${drive.fittedName}).`}</span>
      </Box>
    );
  }

  if (drive.state === 'fails-floor') {
    return (
      <Box
        className="fp-refit__drive fp-refit__drive--warn"
        sx={(theme) => layout.column(theme.initiative.space['2xs'])}
      >
        <span className="fp-refit__label">Drive:</span>
        <span>No available drive improves this design without unacceptable ΔV loss.</span>
        <Box
          className="fp-refit__rejected"
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: theme.initiative.space.sm,
            marginTop: '3px',
          })}
        >
          <span className="ra-tag ra-tag--warn">fails floor</span>
          <span className="fp-refit__rejected-name">{drive.rejectedName}</span>
          <small className="fp-refit__rejected-reason">{drive.floorReason}</small>
        </Box>
      </Box>
    );
  }

  if (drive.state === 'unknown-floor') {
    return (
      <Box
        className="fp-refit__drive fp-refit__drive--unknown"
        sx={(theme) => layout.column(theme.initiative.space['2xs'])}
      >
        <span className="fp-refit__label">Drive:</span>
        <span>Drive refit reach floor unknown (baseline metrics unmeasured)</span>
      </Box>
    );
  }

  return (
    <Box
      className="fp-refit__drive fp-refit__drive--none"
      sx={(theme) => layout.column(theme.initiative.space['2xs'])}
    >
      <span className="fp-refit__label">Drive:</span>
      <span>{`Fitted ${drive.fittedName} optimal under current role`}</span>
    </Box>
  );
}

function WeaponBlock({ weapons }) {
  if (!weapons.hasUpgrades) {
    return (
      <Box
        className="fp-refit__weapon"
        sx={(theme) => layout.column(theme.initiative.space['2xs'])}
      >
        <span className="fp-refit__label">Weapons:</span>
        <span>Current armament optimal</span>
      </Box>
    );
  }
  return (
    <Box
      className="fp-refit__weapon"
      sx={(theme) => layout.column(theme.initiative.space['2xs'])}
    >
      <span className="fp-refit__label">Weapons:</span>
      <span>
        <Fig text={weapons.countText} present={num(weapons.count) !== null} />
        {' hardpoint upgrade(s) fittable'}
      </span>
      <small className="fp-refit__impact" title="Weapon mass change makes ΔV impact unknown">perf impact unknown</small>
    </Box>
  );
}

/**
 * The armour row.
 *
 * `match` is a quiet confirmation with no alarm. `mismatch` renders the
 * transition always, and a severity badge only when one is warranted — red at
 * 2× or worse under a threat-weighted comparison, amber above parity, nothing
 * for an obsolete design or an unweighted comparison, and the explicit
 * unmeasured tag when the materials could not be priced (defect #4).
 */
function ArmorBlock({ armor }) {
  if (!armor) return null;

  if (armor.state === 'match') {
    return (
      <Box
        className="fp-refit__armor fp-refit__armor--optimal"
        sx={(theme) => layout.column(theme.initiative.space['2xs'])}
      >
        <span className="fp-refit__label">Armour:</span>
        <span>{`Best armour fitted (${armor.fittedName})`}</span>
        <small className="fp-refit__threat" title={armor.threatBasisTitle}>{armor.threatLabel}</small>
      </Box>
    );
  }

  return (
    <Box
      className="fp-refit__armor"
      sx={(theme) => layout.column(theme.initiative.space['2xs'])}
    >
      <span className="fp-refit__label">Armour:</span>
      <span>{`${armor.fittedName} → ${armor.recName}`}</span>
      {armor.badge ? (
        <Value
          className={armor.badge.className}
          title={armor.badge.title}
          value={armor.badge.text}
          present={armor.badge.measurable}
          absentLabel={armor.badge.text}
          format={(raw) => String(raw)}
        />
      ) : null}
      <small className="fp-refit__threat" title={armor.threatBasisTitle}>{armor.threatLabel}</small>
    </Box>
  );
}

/**
 * The thrust-scaling badge.
 *
 * The percentage is a figure of its own even though it sits inside the badge.
 * `InlineSpanBox` keeps the existing sentence joined while `<Value>` stamps
 * the factor's presence.
 */
function PowerBlock({ power }) {
  if (!power) return null;
  return (
    <Box
      className="fp-refit__power fp-refit__power--scaled"
      title={power.summary}
      sx={(theme) => ({ paddingTop: theme.initiative.space.xs })}
    >
      <span className="ra-tag ra-tag--warn">
        {'Power scaled to '}
        <Fig
          as={InlineSpanBox}
          text={power.percentText}
          present={num(power.factor) !== null}
        />
        {'% thrust'}
      </span>
    </Box>
  );
}

/**
 * One fielded design.
 *
 * Exported because the ported suite renders a single card in isolation — the
 * vanilla's `renderRefitDesignCard(design)` returned a string; the React bridge
 * takes `(root, design)` and mounts instead, which is the only signature change
 * in this migration.
 */
export function RefitDesignCard({ design, onDetails }) {
  const model = refitCardModel(design);
  const handle = onDetails || (() => openRefitDetails(design));

  return (
    <ThemeProvider theme={initiativeTheme}>
      <Box
        className={`fp-refit-card${model.isObsolete ? ' fp-refit-card--obsolete' : ''}`}
        data-design-id={model.designId ?? ''}
        sx={(theme) => ({
          display: 'flex',
          flexDirection: 'column',
          gap: theme.initiative.space.md,
          padding: `${theme.initiative.space.lg} ${theme.initiative.space.xl}`,
        })}
      >
      <Box
        className="fp-refit-card__head"
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: theme.initiative.space.md,
          paddingBottom: theme.initiative.space.sm,
        })}
      >
        <Box
          className="fp-refit-card__title"
          sx={(theme) => layout.column(theme.initiative.space['2xs'])}
        >
          <strong>{model.displayName}</strong>
          <small>{model.hull}</small>
        </Box>
        <div className="fp-refit-card__role">
          {model.isObsolete ? <span className="ra-tag ra-tag--warn">OBSOLETE</span> : null}
          <span className={model.role.className}>{model.role.text}</span>
        </div>
      </Box>
      <Box
        className="fp-refit-card__body"
        sx={(theme) => ({ ...layout.column(theme.initiative.space.sm), flexGrow: 1 })}
      >
        <DriveBlock drive={model.drive} />
        <WeaponBlock weapons={model.weapons} />
        <ArmorBlock armor={model.armor} />
        <PowerBlock power={model.power} />
      </Box>
      <Box
        className="fp-refit-card__foot"
        sx={(theme) => ({
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: theme.initiative.space.sm,
        })}
      >
        <button
          type="button"
          className="init-btn fp-refit-card__btn"
          data-refit-details={model.designId ?? ''}
          onClick={handle}
        >
          Refit details
        </button>
      </Box>
      </Box>
    </ThemeProvider>
  );
}

/** The refit half when the endpoint did not answer or reported a failure. */
function RefitUnavailableCard({ headline, detail }) {
  return (
    <Box
      className="tech-card init-view__span fp-refit-section"
      sx={(theme) => ({ marginTop: theme.initiative.space.xs })}
    >
      <Box
        className="tech-card-header"
        sx={(theme) => layout.header(theme.initiative.space)}
      >
        <Box
          className="tech-card-title"
          sx={(theme) => ({ display: 'flex', minWidth: 0, gap: theme.initiative.space.md, alignItems: 'center' })}
        >
          VALIDATED REFIT ADVISOR
        </Box>
        <span>FIELDED DESIGNS</span>
      </Box>
      <p className="research-advisor__empty">{headline}</p>
      <p className="ra-census">{detail}</p>
    </Box>
  );
}

/** The refit half when the endpoint answered with zero candidates. */
function RefitEmptyCard() {
  return (
    <Box
      className="tech-card init-view__span fp-refit-section"
      sx={(theme) => ({ marginTop: theme.initiative.space.xs })}
    >
      <Box
        className="tech-card-header"
        sx={(theme) => layout.header(theme.initiative.space)}
      >
        <Box
          className="tech-card-title"
          sx={(theme) => ({ display: 'flex', minWidth: 0, gap: theme.initiative.space.md, alignItems: 'center' })}
        >
          VALIDATED REFIT ADVISOR
        </Box>
        <span><Fig text={int(0)} present={num(0) !== null} />{' FLEET DESIGNS EVALUATED'}</span>
      </Box>
      <Box
        className="tech-card-body"
        sx={(theme) => ({ padding: theme.initiative.space['2xl'] })}
      >
        <p className="ra-empty-group">{NO_REFIT_CANDIDATES}</p>
      </Box>
    </Box>
  );
}

function RefitHalf({ refit }) {
  if (refit.state === 'unavailable' || refit.state === 'failed') {
    return <RefitUnavailableCard headline={refit.headline} detail={refit.detail} />;
  }
  if (refit.state === 'empty') {
    return <RefitEmptyCard />;
  }
  return <RefitSection refitItems={refit.refitItems} />;
}

/** The refit half when candidates are present. */
function RefitSection({ refitItems }) {
  const sorted = sortRefitItems(refitItems);
  return (
    <Box
      className="tech-card init-view__span fp-refit-section"
      sx={(theme) => ({ marginTop: theme.initiative.space.xs })}
    >
      <Box
        className="tech-card-header"
        sx={(theme) => layout.header(theme.initiative.space)}
      >
        <Box
          className="tech-card-title"
          sx={(theme) => ({ display: 'flex', minWidth: 0, gap: theme.initiative.space.md, alignItems: 'center' })}
        >
          VALIDATED REFIT ADVISOR
        </Box>
        <span>
          <Fig text={int(refitItems.length)} present={num(refitItems.length) !== null} />
          {' FLEET DESIGNS EVALUATED'}
        </span>
      </Box>
      <Box
        className="tech-card-body"
        sx={(theme) => ({ padding: theme.initiative.space['2xl'] })}
      >
        <Box
          className="fp-refit-notice"
          sx={(theme) => ({
            padding: `${theme.initiative.space.sm} ${theme.initiative.space.lg}`,
            marginBottom: theme.initiative.space.xl,
          })}
        >
          <span>{REFIT_NOTICE}</span>
        </Box>
        <Box
          className="fp-refit-grid"
          sx={(theme) => ({
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: theme.initiative.space.xl,
          })}
        >
          {sorted.map((design, index) => (
            <RefitDesignCard key={`${String(design.designId || 'design')}-${index}`} design={design} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export function FleetProcurement({ payload, refitPayload = null }) {
  const { procurementPayload, refit } = normalizePayload(payload, refitPayload);

  return (
    <ThemeProvider theme={initiativeTheme}>
      <Box
        className="fleet-dashboard-layout"
        sx={(theme) => layout.column(theme.initiative.space['2xl'])}
      >
        <ProcurementCard
          payload={procurementPayload}
          onFullBreakdown={() => openProcurementDetails(procurementPayload)}
        />
        <RefitHalf refit={refit} />
      </Box>
    </ThemeProvider>
  );
}

export default FleetProcurement;
