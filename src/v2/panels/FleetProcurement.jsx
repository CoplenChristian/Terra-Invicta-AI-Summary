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
 * WHY THE SEVERITY BADGE HOLDS A BARE TEXT NODE. `.fp-refit__armor` is
 * `display: flex; flex-direction: column` (public/v2/css/21-fleet-procurement.css:139)
 * and `.ra-row__meta` is `display: flex` with a 4px gap
 * (public/v2/css/20-research-advisor.css:280), so each direct child is its own
 * flex item. Wrapping a badge's text in <Value> would nest an inline span inside
 * the badge — harmless — but splitting the meta line's joined string into
 * per-figure spans would turn every separator into its own flex item and change
 * the rendered line. The null discipline is not weakened by that: a badge is
 * only rendered when its figure exists, which is a stronger presence signal than
 * <Value> carries, and the absent case has its own affordance rather than an
 * empty one. Standalone figures — the header count, the procurement multiple,
 * the weapon-hardpoint count, the power scaling percentage — do route through
 * <Value>.
 *
 * WHY <TruncationNote> IS CONDITIONAL. The vanilla emitted the census line only
 * when something was actually omitted, and the live endpoint answers
 * `detail=full`, so `omittedCount` is zero on every real render. An
 * unconditional note would put "All entries shown." on screen where the reader
 * has never seen a line at all. Same call the research advisor made.
 */

import React from 'react';
import { Value } from '../components/Value.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import {
  NOTHING_UNFIELDED,
  NO_ENDPOINT_ANSWER,
  PROCUREMENT_UNAVAILABLE_HEADLINE,
  REFIT_NOTICE,
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
      <div className="ra-row__head">
        <span className="ra-row__name fp-row__name" title={model.name.tooltip}>{model.name.lead}</span>
        <span className="ra-row__metric fp-row__metric" title={model.axisTitle}>
          <Fig text={model.multipleText} present={model.multiplePresent} />
          {' '}
          {model.axisLabel}
        </span>
      </div>
      <div className="ra-row__meta fp-row__meta">
        {model.metaText}
        <RowTags notes={model.notes} />
      </div>
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
      <div className="fleet-procurement">
        <div className="tech-card-header">
          <div className="tech-card-title">FLEET PROCUREMENT</div>
          <span>ALREADY UNLOCKED</span>
        </div>
        <p className="research-advisor__empty">{PROCUREMENT_UNAVAILABLE_HEADLINE}</p>
        <p className="ra-census">{NO_ENDPOINT_ANSWER}</p>
      </div>
    );
  }

  if (view.empty) {
    return (
      <div className="fleet-procurement">
        <div className="tech-card-header">
          <div className="tech-card-title">FLEET PROCUREMENT</div>
          <span>0 UNFIELDED</span>
        </div>
        <div className="fp-body">
          <p className="ra-empty-group">{NOTHING_UNFIELDED}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fleet-procurement">
      <div className="tech-card-header">
        <div className="tech-card-title">FLEET PROCUREMENT</div>
        <span>
          <Fig text={view.countText} present={num(view.count) !== null} />
          {' unfielded'}
        </span>
      </div>
      <div className="fp-body">
        <div className="ra-procurement fp-procurement">
          <div className="ra-procurement__head fp-procurement__head">
            <span>{view.label}</span>
            <small>
              <Fig text={view.countText} present={num(view.count) !== null} />
              {' unfielded'}
            </small>
          </div>
          <ul className="ra-group__list fp-group__list">
            {view.items.map((row, index) => (
              <ProcurementRow key={`${String(row.id || 'row')}-${index}`} row={row} />
            ))}
          </ul>
          {view.omittedCount > 0 ? (
            <TruncationNote
              className="ra-census"
              totalCount={view.count}
              omittedCount={view.omittedCount}
              shownCount={view.itemsShown}
              formatTruncated={procurementTruncationText}
            />
          ) : null}
        </div>
      </div>
      <div className="ra-foot fp-foot">
        <span>Zero research cost · ready for shipyard build or refit</span>
        <button
          type="button"
          className="init-btn ra-foot__btn"
          data-fleet-procurement-full=""
          onClick={onFullBreakdown}
        >
          Full breakdown
        </button>
      </div>
    </div>
  );
}

/** The four drive states, each its own sentence. `unknown-floor` is not a pass. */
function DriveBlock({ drive }) {
  if (drive.state === 'improved') {
    return (
      <div className="fp-refit__drive">
        <span className="fp-refit__label">Drive Refit:</span>
        <strong>{drive.recName}</strong>
        <span className="fp-refit__perf">
          {`ΔV: ${drive.baseDeltaVText} → ${drive.recDeltaVText} km/s · Accel: ${drive.baseAccelText} → ${drive.recAccelText} m/s²`}
        </span>
        {drive.dryMassCaveat ? (
          <small className="fp-refit__caveat" title={drive.dryMassCaveat}>constant-dry-mass caveat</small>
        ) : null}
      </div>
    );
  }

  if (drive.state === 'already-fitted') {
    return (
      <div className="fp-refit__drive fp-refit__drive--none">
        <span className="fp-refit__label">Drive:</span>
        <span>{`Best available drive already fitted (${drive.fittedName}).`}</span>
      </div>
    );
  }

  if (drive.state === 'fails-floor') {
    return (
      <div className="fp-refit__drive fp-refit__drive--warn">
        <span className="fp-refit__label">Drive:</span>
        <span>No available drive improves this design without unacceptable ΔV loss.</span>
        <div className="fp-refit__rejected">
          <span className="ra-tag ra-tag--warn">fails floor</span>
          <span className="fp-refit__rejected-name">{drive.rejectedName}</span>
          <small className="fp-refit__rejected-reason">{drive.floorReason}</small>
        </div>
      </div>
    );
  }

  if (drive.state === 'unknown-floor') {
    return (
      <div className="fp-refit__drive fp-refit__drive--unknown">
        <span className="fp-refit__label">Drive:</span>
        <span>Drive refit reach floor unknown (baseline metrics unmeasured)</span>
      </div>
    );
  }

  return (
    <div className="fp-refit__drive fp-refit__drive--none">
      <span className="fp-refit__label">Drive:</span>
      <span>{`Fitted ${drive.fittedName} optimal under current role`}</span>
    </div>
  );
}

function WeaponBlock({ weapons }) {
  if (!weapons.hasUpgrades) {
    return (
      <div className="fp-refit__weapon">
        <span className="fp-refit__label">Weapons:</span>
        <span>Current armament optimal</span>
      </div>
    );
  }
  return (
    <div className="fp-refit__weapon">
      <span className="fp-refit__label">Weapons:</span>
      <span>
        <Fig text={weapons.countText} present={num(weapons.count) !== null} />
        {' hardpoint upgrade(s) fittable'}
      </span>
      <small className="fp-refit__impact" title="Weapon mass change makes ΔV impact unknown">perf impact unknown</small>
    </div>
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
      <div className="fp-refit__armor fp-refit__armor--optimal">
        <span className="fp-refit__label">Armour:</span>
        <span>{`Best armour fitted (${armor.fittedName})`}</span>
        <small className="fp-refit__threat" title={armor.threatBasisTitle}>{armor.threatLabel}</small>
      </div>
    );
  }

  return (
    <div className="fp-refit__armor">
      <span className="fp-refit__label">Armour:</span>
      <span>{`${armor.fittedName} → ${armor.recName}`}</span>
      {armor.badge ? (
        <span className={armor.badge.className} title={armor.badge.title}>{armor.badge.text}</span>
      ) : null}
      <small className="fp-refit__threat" title={armor.threatBasisTitle}>{armor.threatLabel}</small>
    </div>
  );
}

/**
 * The thrust-scaling badge.
 *
 * One text node, like the severity badges: `powerModel` only returns a model
 * when the scaling factor is a number below 1.0, so the percentage cannot be
 * absent here. Splitting it around a <Value> would also put a space between the
 * figure and its own "%" sign.
 */
function PowerBlock({ power }) {
  if (!power) return null;
  return (
    <div className="fp-refit__power fp-refit__power--scaled" title={power.summary}>
      <span className="ra-tag ra-tag--warn">{`Power scaled to ${power.percentText}% thrust`}</span>
    </div>
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
    <div
      className={`fp-refit-card${model.isObsolete ? ' fp-refit-card--obsolete' : ''}`}
      data-design-id={model.designId ?? ''}
    >
      <div className="fp-refit-card__head">
        <div className="fp-refit-card__title">
          <strong>{model.displayName}</strong>
          <small>{model.hull}</small>
        </div>
        <div className="fp-refit-card__role">
          {model.isObsolete ? <span className="ra-tag ra-tag--warn">OBSOLETE</span> : null}
          <span className={model.role.className}>{model.role.text}</span>
        </div>
      </div>
      <div className="fp-refit-card__body">
        <DriveBlock drive={model.drive} />
        <WeaponBlock weapons={model.weapons} />
        <ArmorBlock armor={model.armor} />
        <PowerBlock power={model.power} />
      </div>
      <div className="fp-refit-card__foot">
        <button
          type="button"
          className="init-btn fp-refit-card__btn"
          data-refit-details={model.designId ?? ''}
          onClick={handle}
        >
          Refit details
        </button>
      </div>
    </div>
  );
}

/**
 * The refit half.
 *
 * NOT FIXED HERE, AND NOT NEW: when the refit endpoint does not answer, this
 * half renders NOTHING — no unavailable affordance, unlike the procurement half
 * beside it. An unreachable endpoint is then indistinguishable from a faction
 * with no designs. Carried across because parity is this migration's
 * requirement; reported rather than silently changed.
 */
function RefitSection({ refitItems }) {
  const sorted = sortRefitItems(refitItems);
  return (
    <div className="tech-card init-view__span fp-refit-section">
      <div className="tech-card-header">
        <div className="tech-card-title">VALIDATED REFIT ADVISOR</div>
        <span>
          <Fig text={int(refitItems.length)} present={num(refitItems.length) !== null} />
          {' FLEET DESIGNS EVALUATED'}
        </span>
      </div>
      <div className="tech-card-body">
        <div className="fp-refit-notice">
          <span>{REFIT_NOTICE}</span>
        </div>
        <div className="fp-refit-grid">
          {sorted.map((design, index) => (
            <RefitDesignCard key={`${String(design.designId || 'design')}-${index}`} design={design} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function FleetProcurement({ payload, refitPayload = null }) {
  const { procurementPayload, refitItems, refitsRenderable } = normalizePayload(payload, refitPayload);

  return (
    <div className="fleet-dashboard-layout">
      <ProcurementCard
        payload={procurementPayload}
        onFullBreakdown={() => openProcurementDetails(procurementPayload)}
      />
      {refitsRenderable ? <RefitSection refitItems={refitItems} /> : null}
    </div>
  );
}

export default FleetProcurement;
