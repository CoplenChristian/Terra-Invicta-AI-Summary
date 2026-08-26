/**
 * src/v2/panels/DetailPanel.jsx
 *
 * Purpose: the shared detail surface every clickable Mission Control module
 *   opens — facts, grouped list sections, caveat notes and actions in ONE
 *   dialog, plus the imperative open/close controller that
 *   `window.MissionControlDetailPanel` is.
 *
 * ONE MODAL, NOT ONE PER CALLER. Alongside the label/value `facts` list it
 * renders two optional blocks so a caller with a LIST to show does not need a
 * second dialog:
 *
 *   sections  ordered groups of rows -- { title, caption, rows[], empty }
 *             where a row is { label, sublabel, status, statusTone, meta }
 *   notes     caveat paragraphs under everything, for the things a figure
 *             cannot say about itself
 *
 * FIVE CALLERS, ONE API. `mission-control.js`, `fleet-procurement.js`,
 * `DirectiveBoard.jsx`, `DriveExplorer.jsx` and `researchAdvisorUtils.mjs` all
 * reach `window.MissionControlDetailPanel.open(options)` and none of them was
 * changed by this migration. `{ open, close, syncPageInert }` is the whole
 * surface and its shape is a contract.
 *
 * WHY THE SHELL IS IMPERATIVE
 * ---------------------------
 * `#mcDetailPanel` is created on first open and appended to `document.body`, and
 * its `hidden` / `inert` / `aria-hidden` attributes are set by hand — exactly as
 * the vanilla component did, and exactly as the two sibling overlays'
 * `<section>` shells in `public/v2/index.html` are driven by `mission-control.js`.
 * Three things depend on that:
 *
 *   * `syncPageInert` keys on `#mcDetailPanel:not([hidden])`;
 *   * `scripts/verify_drive_path_modal.js` waits on `#mcDetailPanel[hidden]`;
 *   * `open()` is SYNCHRONOUS for its callers — it moves focus into the dialog
 *     before returning, so the render is committed with `flushSync` rather than
 *     left to React's scheduler.
 *
 * Nothing here interpolates raw HTML: React escapes every caller-supplied
 * string, and an absent value renders as the caller's own text or not at all --
 * never as 0.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  focusableIn,
  isRenderableRow,
  normaliseActions,
  normaliseFacts,
  normaliseNotes,
  normaliseRows,
  normaliseSections,
  resolveTone,
  syncPageInert,
  text,
} from './detailPanelUtils.mjs';

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

/**
 * THE `{' '}` SEPARATORS BELOW ARE LOAD-BEARING — do not tidy them away.
 *
 * The vanilla component built this markup from template literals, so every
 * element was separated by a newline and an indent. Those whitespace text nodes
 * never rendered — a whitespace-only anonymous item is not laid out in a flex or
 * grid container, and these are all flex, grid or block contexts — but they DID
 * separate the text, and `scripts/verify_drive_path_modal.js` reads the dialog's
 * whole `textContent` and asserts no `\bnull\b`, `\bundefined\b` or `\bNaN\b`
 * reaches the reader. JSX drops whitespace between elements, which would glue
 * `LABEL` to `null` and hand that word-boundary check a false pass.
 *
 * They are placed exactly where the vanilla template had them, and deliberately
 * NOT between the action buttons or the notes, where the vanilla had none.
 */

/** One row inside a section. Absent parts are omitted, never defaulted. */
function SectionRow({ row }) {
  if (!isRenderableRow(row)) return null;
  const tone = resolveTone(row.statusTone);
  return (
    <li className="detail-panel__row">
      <div className="detail-panel__row-main">
        <span className="detail-panel__row-label">{text(row.label)}</span>{' '}
        {row.sublabel ? <span className="detail-panel__row-sub">{text(row.sublabel)}</span> : null}
      </div>{' '}
      <div className="detail-panel__row-side">
        {row.status
          ? <span className={`detail-panel__status detail-panel__status--${tone}`}>{text(row.status)}</span>
          : null}{' '}
        {row.meta ? <span className="detail-panel__row-meta">{text(row.meta)}</span> : null}
      </div>{' '}
    </li>
  );
}

/**
 * One grouped section.
 *
 * An empty section still renders, saying so in the caller's own words: a section
 * that vanishes reads as "not applicable" when it means "none".
 */
function SectionBlock({ section }) {
  const rows = normaliseRows(section);
  return (
    <section className="detail-panel__section">
      <div className="detail-panel__section-head">
        <h3 className="detail-panel__section-title">{text(section.title || '')}</h3>{' '}
        {section.caption
          ? <span className="detail-panel__section-caption">{text(section.caption)}</span>
          : null}
      </div>{' '}
      {rows.length > 0
        ? (
          <ul className="detail-panel__rows">
            {rows.map((row, index) => <SectionRow key={index} row={row} />)}
          </ul>
        )
        : <div className="detail-panel__empty">{text(section.empty || 'None.')}</div>}{' '}
    </section>
  );
}

/**
 * The dialog itself. Rendered INTO `#mcDetailPanel`, which the controller owns —
 * this component deliberately does not render that section, because its
 * open/closed attributes are read by selectors outside React.
 *
 * @param {object} props
 * @param {object} [props.options] — the caller's option bag, verbatim.
 * @param {Function} props.onClose — closes the panel; also what an action button
 *   calls first, before the caller's own `onClick`.
 */
export function DetailPanel({ options, onClose }) {
  const opts = options || {};
  const facts = normaliseFacts(opts.facts);
  const sections = normaliseSections(opts.sections);
  const notes = normaliseNotes(opts.notes);
  const actions = normaliseActions(opts.actions);

  return (
    <>
      <div className="detail-panel__backdrop" data-detail-close="" onClick={onClose} />
      <div
        className="detail-panel__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detailPanelTitle"
      >
        <header className="detail-panel__header">
          <div>
            <div id="detailPanelEyebrow" className="detail-panel__eyebrow">
              {text(opts.eyebrow || 'DETAIL')}
            </div>
            <h2 id="detailPanelTitle">{text(opts.title || 'Operational detail')}</h2>
          </div>
          <button className="init-btn" type="button" data-detail-close="" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="detail-panel__body">
          <p id="detailPanelSummary" className="detail-panel__summary">{text(opts.summary || '')}</p>{' '}
          <dl id="detailPanelFacts" className="detail-panel__facts">
            {facts.map((fact, index) => (
              <div className="detail-panel__fact" key={index}>
                <dt>{text(fact.label)}</dt>{' '}
                <dd>{text(fact.value)}</dd>{' '}
              </div>
            ))}
          </dl>{' '}
          <div
            id="detailPanelSections"
            className="detail-panel__sections"
            hidden={sections.length === 0}
          >
            {sections.map((section, index) => <SectionBlock key={index} section={section} />)}
          </div>{' '}
          <div
            id="detailPanelNotes"
            className="detail-panel__notes"
            hidden={notes.length === 0}
          >
            {notes.map((note, index) => <p className="detail-panel__note" key={index}>{note}</p>)}
          </div>{' '}
          <div id="detailPanelActions" className="detail-panel__actions">
            {actions.map((action, index) => (
              <button
                key={index}
                type="button"
                className={action.primary ? 'init-btn init-btn-cyan' : 'init-btn'}
                onClick={() => {
                  // Close first, then the caller's handler: the vanilla order,
                  // and the one an `onClick` that opens a SECOND panel needs.
                  if (action.close !== false) onClose();
                  if (typeof action.onClick === 'function') action.onClick();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The imperative controller — window.MissionControlDetailPanel
// ---------------------------------------------------------------------------

let lastTrigger = null;
let panelRoot = null;

function setPanelOpen(panel, open) {
  panel.hidden = !open;
  panel.toggleAttribute('inert', !open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.classList.toggle('detail-panel-open', open);
  syncPageInert(document);
}

/**
 * Escape closes; Tab wraps at the ends of the dialog's own focusable nodes.
 *
 * Bound to the document once, when the panel is first created, and inert while
 * the panel is hidden — the vanilla behaviour, kept because the two sibling
 * overlays install their own document-level traps the same way.
 */
function handleKeydown(event) {
  const panel = document.getElementById('mcDetailPanel');
  if (!panel || panel.hidden) return;
  if (event.key === 'Escape') {
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = panel.querySelector('[role="dialog"]');
  const nodes = focusableIn(dialog);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The `#mcDetailPanel` shell, created on first open and then reused. */
function ensurePanel() {
  let panel = document.getElementById('mcDetailPanel');
  if (panel) return panel;

  panel = document.createElement('section');
  panel.id = 'mcDetailPanel';
  panel.className = 'detail-panel';
  panel.hidden = true;
  panel.setAttribute('inert', '');
  panel.setAttribute('aria-hidden', 'true');
  document.body.appendChild(panel);

  document.addEventListener('keydown', handleKeydown);
  return panel;
}

/**
 * Opens the shared dialog on `options`.
 *
 * Synchronous by contract: the render is committed with `flushSync` so the
 * close button exists to be focused before this returns, and so
 * `#mcDetailPanel:not([hidden])` is true for `syncPageInert` in the same tick.
 */
export function open(options = {}) {
  const panel = ensurePanel();
  lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!panelRoot) panelRoot = createRoot(panel);
  flushSync(() => {
    panelRoot.render(<DetailPanel options={options} onClose={close} />);
  });
  setPanelOpen(panel, true);
  // A re-open must not inherit the previous caller's scroll position.
  const body = panel.querySelector('.detail-panel__body');
  if (body) body.scrollTop = 0;
  const closeButton = panel.querySelector('button[data-detail-close]');
  (closeButton || panel.querySelector('[data-detail-close]')).focus();
}

/**
 * Closes the dialog and returns focus to whatever opened it.
 *
 * The rendered content is deliberately LEFT in place: a closed panel keeps what
 * it last said, which is what the vanilla component did and what
 * `scripts/verify_drive_path_modal.js` reads back after pressing Close.
 */
export function close() {
  const panel = document.getElementById('mcDetailPanel');
  if (!panel) return;
  setPanelOpen(panel, false);
  if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  lastTrigger = null;
}

export { syncPageInert };

/** Test seam: lets a harness scene drop the shell between scenarios. */
export const detailPanelInternals = {
  reset() {
    const panel = document.getElementById('mcDetailPanel');
    if (panelRoot) {
      panelRoot.unmount();
      panelRoot = null;
    }
    if (panel) panel.remove();
    document.removeEventListener('keydown', handleKeydown);
    document.body.classList.remove('detail-panel-open');
    lastTrigger = null;
    syncPageInert(document);
  },
  getLastTrigger: () => lastTrigger,
};
