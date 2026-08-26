/**
 * src/v2/panels/FactionIntel.jsx
 *
 * Purpose: the faction dossier overlay — a scan-first two-pane decision surface
 *   over one selected faction's observer-relative intelligence (RECORDS view).
 *
 * COMPONENT DIRECTION
 * THESIS: Make faction intelligence a scan-first decision surface, not a second dashboard.
 * OWN-WORLD: Quiet command-console structure, hard data labels, and faction accents supplied by the save.
 * STORY: The observer can select one faction, see only the current filtered truth, and leave with a next move.
 * FIRST VIEWPORT: Roster on the left; selected faction identity, visibility, metrics, and action plan on the right.
 * FORM: A two-pane dossier with native buttons and a faction-intel-select event for handoff.
 *
 * SELECTION LIVES OUTSIDE REACT, DELIBERATELY.
 *   `mission-control.js` calls `window.FactionIntelScreen.render(...)` and then
 *   `controller.select(id)` on the very next line. `root.render()` is
 *   asynchronous, so a ref-based imperative handle would still be empty at that
 *   point. The controller therefore owns the selected key in a plain object and
 *   the component subscribes to it — `select()` and `getSelectedId()` are
 *   correct synchronously, before React has committed anything.
 */

import React from 'react';
import { Value } from '../components/Value.jsx';
import {
  UNKNOWN_RELATIONSHIP,
  UNKNOWN_VALUE,
  accentColor,
  buildContext,
  buildFactionIntel,
  chooseInitialKey,
  councilorRowFields,
  councilorVisibility,
  deriveActions,
  factionLogoHtml,
  formatPower,
  getEntryKey,
  getFactionCouncilors,
  getFactionId,
  getFactionName,
  getRelationship,
  headerCycleDate,
  normalizeVisibility,
  powerMetrics,
  relationshipMetrics,
  sameId,
  visibilityForPower,
} from './factionIntelUtils.js';

const ROSTER_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

// ---------------------------------------------------------------------------
// Controller — the imperative half of the contract
// ---------------------------------------------------------------------------

/** The no-op controller returned when there is nothing to mount into. */
export function createEmptyController() {
  return {
    context: null,
    entries: [],
    subscribe: () => () => {},
    getVersion: () => 0,
    isDestroyed: () => true,
    getSelectedKey: () => null,
    setContainer: () => {},
    setUnmount: () => {},
    select: () => false,
    getSelectedFaction: () => null,
    getSelectedId: () => null,
    destroy: () => {},
  };
}

/**
 * Reads the snapshot once and owns the selected faction. `container` may be
 * supplied later via `setContainer` — the harness renders the panel
 * declaratively and hands the wrapper element back for event dispatch.
 */
export function createFactionIntelController(options = {}) {
  const context = buildContext(options.snapshot, options.briefing, options.observerId);
  const entries = context.factions.map((faction, index) => ({
    key: getEntryKey(faction, index),
    faction,
  }));

  let container = options.container || null;
  let onUnmount = null;
  let version = 0;
  const listeners = new Set();
  const state = {
    selectedKey: chooseInitialKey(context.factions, context.observerId),
    destroyed: false,
  };

  function emit() {
    version += 1;
    listeners.forEach((listener) => listener());
  }

  function findEntry(key) {
    if (key === null || key === undefined) return null;
    const wanted = String(key);
    return entries.find((entry) => entry.key === wanted) || null;
  }

  function notifySelection(faction) {
    const target = container;
    if (!target) return;

    const detail = {
      faction,
      factionId: getFactionId(faction),
      observerId: context.observerId,
      snapshot: context.data,
      briefing: context.briefing,
    };

    if (typeof target.onFactionIntelSelect === 'function') {
      target.onFactionIntelSelect(detail);
    }

    if (typeof target.dispatchEvent !== 'function') return;
    const documentRef = target.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const view = documentRef && documentRef.defaultView;
    let event = null;
    if (view && typeof view.CustomEvent === 'function') {
      event = new view.CustomEvent('faction-intel-select', { detail, bubbles: true });
    } else if (documentRef && typeof documentRef.createEvent === 'function') {
      event = documentRef.createEvent('CustomEvent');
      event.initCustomEvent('faction-intel-select', true, false, detail);
    }
    if (event) target.dispatchEvent(event);
  }

  function selectFaction(key, emitEvent) {
    if (state.destroyed) return false;
    const entry = findEntry(key);
    if (!entry) return false;

    state.selectedKey = entry.key;
    emit();
    if (emitEvent !== false) notifySelection(entry.faction);
    return true;
  }

  function getSelectedFaction() {
    const entry = findEntry(state.selectedKey);
    return entry ? entry.faction : null;
  }

  return {
    context,
    entries,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
    isDestroyed: () => state.destroyed,
    getSelectedKey: () => state.selectedKey,

    /** The element selection events are dispatched on. */
    setContainer(element) {
      container = element || null;
    },
    /** How this controller tears its own React root down, when it owns one. */
    setUnmount(fn) {
      onUnmount = typeof fn === 'function' ? fn : null;
    },

    select(key) {
      return selectFaction(key, true);
    },
    selectSilently(key) {
      return selectFaction(key, false);
    },
    getSelectedFaction,
    getSelectedId() {
      const faction = getSelectedFaction();
      return faction ? getFactionId(faction) : null;
    },

    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      // Unmount first: React removes its subscriber during teardown, so the
      // trailing emit reaches no listener that is mid-unmount.
      if (onUnmount) {
        const teardown = onUnmount;
        onUnmount = null;
        teardown();
      }
      emit();
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * A metric cell. `metricValue()` upstream has already resolved absence into the
 * explicit 'UNAVAILABLE' token, so presence is always true here and `Value`
 * classifies the token — the rendered text is the token either way, but the
 * cell now carries a machine-readable data-value-state.
 */
function MetricValue({ text }) {
  const value = String(text === undefined || text === null ? UNKNOWN_VALUE : text);
  const className = value.length > 10
    ? 'faction-intel-metric-value faction-intel-metric-value--text'
    : 'faction-intel-metric-value';
  return (
    <strong className={className}>
      <Value present value={value} format={String} />
    </strong>
  );
}

function VisibilityTag({ label, visibility }) {
  return (
    <span className="faction-intel-visibility-tag">
      <span className="faction-intel-visibility-label">{label}</span>
      <strong className="faction-intel-visibility-value">{normalizeVisibility(visibility)}</strong>
    </span>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="faction-intel-meta-item">
      <span className="faction-intel-meta-label">{label}</span>
      <strong className="faction-intel-meta-value">{value}</strong>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="faction-intel-empty">
      <strong className="faction-intel-empty-title">No intelligence to display</strong>
      <p className="faction-intel-empty-text">{text}</p>
    </div>
  );
}

function Note({ label, text }) {
  return (
    <p className="faction-intel-note">
      <strong className="faction-intel-note-label">{`${label}:`}</strong>
      {` ${String(text)}`}
    </p>
  );
}

/**
 * The faction accent swatch. A logo, when the shared bundle can supply one,
 * replaces the flat colour fill rather than sitting on top of it.
 */
function FactionMark({ faction, className, logoClassName }) {
  const accent = accentColor(faction && faction.color);
  const logoHtml = factionLogoHtml(faction, logoClassName);
  const style = {};
  if (accent) {
    style.backgroundColor = accent;
    style['--faction-intel-accent'] = accent;
  }
  if (logoHtml) style.backgroundColor = 'transparent';

  const props = {
    className: logoHtml ? `${className} has-faction-logo` : className,
    'aria-hidden': 'true',
    style: Object.keys(style).length ? style : undefined,
  };
  if (logoHtml) props.dangerouslySetInnerHTML = { __html: logoHtml };

  return <span {...props} />;
}

function MetricGroup({ title, metrics, visibility }) {
  return (
    <section className="faction-intel-metric-group">
      <div className="faction-intel-metric-heading">
        <h4 className="faction-intel-metric-title">{title}</h4>
        <VisibilityTag label="VISIBILITY" visibility={visibility} />
      </div>
      <div className="faction-intel-metric-grid">
        {metrics.map((metric, index) => (
          <div className="faction-intel-metric" key={`${metric.label}-${index}`}>
            <span className="faction-intel-metric-label">{metric.label}</span>
            <MetricValue text={metric.value} />
            {metric.note ? (
              <span className="faction-intel-metric-note">{metric.note}</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Header({ context }) {
  const cycle = headerCycleDate(context);
  return (
    <header className="faction-intel-header">
      <div className="faction-intel-header-copy">
        <h2 className="faction-intel-title">Faction intelligence</h2>
        <p className="faction-intel-description">
          Observer-relative telemetry from the supplied current snapshot.
        </p>
      </div>
      <div className="faction-intel-header-meta">
        <MetaItem label="VIEW" value={context.mode} />
        <MetaItem label="OBSERVER" value={getFactionName(context.observer) || UNKNOWN_RELATIONSHIP} />
        <MetaItem label="FACTIONS" value={String(context.factions.length)} />
        {cycle ? <MetaItem label="CYCLE" value={cycle} /> : null}
      </div>
    </header>
  );
}

function Roster({ controller, context, entries, selectedKey }) {
  const listRef = React.useRef(null);

  const handleKeyDown = (event) => {
    const list = listRef.current;
    if (!list) return;
    const buttons = Array.from(list.querySelectorAll('button[data-faction-intel-key]'));
    if (!buttons.length || !ROSTER_KEYS.includes(event.key)) return;
    event.preventDefault();

    let currentIndex = buttons.indexOf(document.activeElement);
    if (event.key === 'Home') currentIndex = 0;
    else if (event.key === 'End') currentIndex = buttons.length - 1;
    else if (event.key === 'ArrowDown') {
      currentIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
    } else {
      currentIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
    }
    buttons[currentIndex].focus();
  };

  return (
    <aside className="faction-intel-roster" aria-label="Faction roster">
      <div className="faction-intel-roster-heading">
        <h3 className="faction-intel-section-title">Faction roster</h3>
        <span className="faction-intel-roster-count">
          {`${context.factions.length}${context.factions.length === 1 ? ' entry' : ' entries'}`}
        </span>
      </div>
      <div
        className="faction-intel-roster-list"
        role="listbox"
        aria-label="Select a faction"
        ref={listRef}
        onKeyDown={handleKeyDown}
      >
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          return (
            <button
              key={entry.key}
              type="button"
              role="option"
              aria-selected={selected ? 'true' : 'false'}
              data-faction-intel-key={entry.key}
              className={selected
                ? 'faction-intel-faction faction-intel-faction--selected'
                : 'faction-intel-faction'}
              onClick={() => controller.select(entry.key)}
            >
              <FactionMark
                faction={entry.faction}
                className="faction-intel-faction-swatch"
                logoClassName="faction-logo faction-logo--roster"
              />
              <span className="faction-intel-faction-copy">
                <strong className="faction-intel-faction-name">{getFactionName(entry.faction)}</strong>
                <span className="faction-intel-faction-relation">
                  {getRelationship(context, entry.faction).value}
                </span>
              </span>
              <span className="faction-intel-faction-power">{`POWER ${formatPower(entry.faction)}`}</span>
            </button>
          );
        })}
        {entries.length ? null : <EmptyState text="No selectable factions were supplied." />}
      </div>
    </aside>
  );
}

function CouncilorRow({ councilor }) {
  const fields = councilorRowFields(councilor);
  return (
    <article className="faction-intel-councilor">
      <div className="faction-intel-councilor-main">
        <strong className="faction-intel-councilor-name">{fields.name}</strong>
        <span className="faction-intel-councilor-profession">{fields.profession}</span>
        <span className="faction-intel-councilor-location">{`LOCATION / ${fields.location}`}</span>
      </div>
      <div className="faction-intel-councilor-side">
        <span className="faction-intel-councilor-skill">{fields.skill}</span>
        <span className="faction-intel-councilor-mission">{fields.mission}</span>
        <span className="faction-intel-councilor-status">{fields.status}</span>
      </div>
    </article>
  );
}

function CouncilSection({ context, faction, councilors }) {
  const visibility = councilorVisibility(context, faction, councilors);
  return (
    <section className="faction-intel-council">
      <div className="faction-intel-council-heading">
        <h4 className="faction-intel-section-title">Councilor roster</h4>
        <span className="faction-intel-council-count">{`${councilors.length} visible`}</span>
      </div>
      <div className="faction-intel-council-subhead">
        <span className="faction-intel-meta-label">COUNCIL INTELLIGENCE</span>
        <strong className="faction-intel-council-visibility">{normalizeVisibility(visibility)}</strong>
      </div>
      <div className="faction-intel-council-list">
        {councilors.length ? (
          councilors.map((councilor, index) => (
            <CouncilorRow key={councilor.ID ?? councilor.id ?? `councilor-${index}`} councilor={councilor} />
          ))
        ) : (
          <EmptyState text="No councilors are visible for this faction in the current intelligence mode." />
        )}
      </div>
    </section>
  );
}

function ActionPlan({ context, faction, intel }) {
  const actions = deriveActions(context, faction, intel);
  return (
    <section className="faction-intel-plan">
      <div className="faction-intel-plan-heading">
        <h4 className="faction-intel-plan-title">Plan of action</h4>
        <span className="faction-intel-plan-label">DERIVED FROM CURRENT DATA</span>
      </div>
      <ol className="faction-intel-plan-list">
        {actions.map((action, index) => (
          <li className="faction-intel-plan-item" key={`${index}-${action}`}>{action}</li>
        ))}
      </ol>
    </section>
  );
}

function Detail({ context, faction }) {
  if (!faction) return <EmptyState text="No faction is selected." />;

  const intel = buildFactionIntel(context, faction);
  const councilors = getFactionCouncilors(context, faction);
  const isObserver = sameId(getFactionId(faction), context.observerId);
  const { relationship, hate, earth, space, research } = intel;

  const notes = [];
  if (faction.visibilityNote) notes.push(['Visibility note', faction.visibilityNote]);
  if (hate.note) notes.push(['Alien-hate access', hate.note]);
  if (!notes.length) {
    notes.push(['Data discipline', 'Values below are limited to fields present in the supplied snapshot.']);
  }

  return (
    <div className="faction-intel-detail-content">
      <header className="faction-intel-identity">
        <FactionMark
          faction={faction}
          className="faction-intel-identity-mark"
          logoClassName="faction-logo faction-logo--identity"
        />
        <div className="faction-intel-identity-copy">
          <h3 className="faction-intel-identity-name">{getFactionName(faction)}</h3>
          <p className="faction-intel-identity-relation">
            {`Observer-relative relationship: ${relationship.value}`}
          </p>
        </div>
      </header>

      <div className="faction-intel-visibility">
        <VisibilityTag label="RELATION" visibility={relationship.visibility} />
        {isObserver ? null : (
          <>
            <VisibilityTag label="HATE OF US" visibility={relationship.theirsVisibility} />
            <VisibilityTag label="OUR HATE" visibility={relationship.oursVisibility} />
          </>
        )}
        <VisibilityTag label="ALIEN HATE" visibility={hate.visibility} />
        <VisibilityTag label="EARTH" visibility={earth.visibility} />
        <VisibilityTag label="SPACE" visibility={space.visibility} />
        <VisibilityTag label="RESEARCH" visibility={research.visibility} />
      </div>

      <div className="faction-intel-metrics">
        {isObserver ? null : (
          <MetricGroup
            title="Relationship posture"
            metrics={relationshipMetrics(relationship)}
            visibility={relationship.visibility}
          />
        )}
        <MetricGroup
          title="Power"
          metrics={powerMetrics(faction)}
          visibility={visibilityForPower(context, faction)}
        />
        <MetricGroup title="Earth footprint" metrics={earth.metrics} visibility={earth.visibility} />
        <MetricGroup title="Space posture" metrics={space.metrics} visibility={space.visibility} />
        <MetricGroup title="Research posture" metrics={research.metrics} visibility={research.visibility} />
      </div>

      <CouncilSection context={context} faction={faction} councilors={councilors} />

      <div className="faction-intel-notes">
        {notes.map(([label, text]) => (
          <Note key={label} label={label} text={text} />
        ))}
      </div>

      <ActionPlan context={context} faction={faction} intel={intel} />
    </div>
  );
}

/**
 * The dossier. Either drive it with a `controller` (the production bridge and
 * the browser harness both do) or hand it `snapshot` / `briefing` /
 * `observerId` and let it own one.
 */
export function FactionIntel({ controller: externalController, snapshot, briefing, observerId }) {
  const ownController = React.useMemo(
    () => (externalController
      ? null
      : createFactionIntelController({ snapshot, briefing, observerId })),
    [externalController, snapshot, briefing, observerId],
  );
  const controller = externalController || ownController;

  const subscribe = React.useCallback((listener) => controller.subscribe(listener), [controller]);
  const getVersion = React.useCallback(() => controller.getVersion(), [controller]);
  React.useSyncExternalStore(subscribe, getVersion, getVersion);

  if (controller.isDestroyed()) return null;

  const { context, entries } = controller;
  const selectedKey = controller.getSelectedKey();
  const selectedEntry = selectedKey === null
    ? null
    : entries.find((entry) => entry.key === selectedKey) || null;

  return (
    <div className="faction-intel-shell" data-faction-intel-component="true">
      <Header context={context} />
      <div className="faction-intel-layout">
        <Roster
          controller={controller}
          context={context}
          entries={entries}
          selectedKey={selectedKey}
        />
        <section
          className="faction-intel-detail"
          aria-live="polite"
          aria-label="Selected faction intelligence"
        >
          {selectedKey === null
            ? <EmptyState text="No faction data is present in the current snapshot." />
            : (selectedEntry ? <Detail context={context} faction={selectedEntry.faction} /> : null)}
        </section>
      </div>
    </div>
  );
}
