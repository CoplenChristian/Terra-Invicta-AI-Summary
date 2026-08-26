/**
 * src/v2/panels/detailPanelUtils.mjs
 *
 * Purpose: the page-wide inert bookkeeping, the focusable-node scan and the
 *   option-shaping rules behind the shared detail panel — every rule the dialog
 *   applies without React, so both the browser and a bare Node test read the
 *   same code.
 *
 * `.mjs` rather than `.js` deliberately: the repo is CommonJS by default, so a
 * `.js` file carrying `export` cannot be reached from `tests/*.test.js` at all.
 * Vite resolves `.mjs` identically.
 *
 * WHY syncPageInert LIVES HERE AND NOT IN THE COMPONENT
 * -----------------------------------------------------
 * It is not this dialog's own concern. It manages the `inert` attribute across
 * the TOPBAR, EVERY `.init-view` SECTION and `main` for the whole page, keyed on
 * THREE overlays — `#factionIntelScreen`, `#intelligenceLibraryScreen` and
 * `#mcDetailPanel`. The first two belong to components already migrated to
 * React; their overlay `<section>` ids were preserved precisely so this one
 * selector keeps resolving. `mission-control.js` calls it on every view change
 * and on every overlay toggle through `window.MissionControlDetailPanel`.
 *
 * Getting it wrong leaves background content reachable by keyboard while a modal
 * is open, or leaves the page permanently inert after one closes. Neither is
 * visible in a text diff, so `tests/v2Navigation.test.js` drives this function
 * directly against a fake document.
 *
 * Absent stays absent throughout: a caller-supplied value that is missing
 * renders as the caller's own text or not at all — never as 0 and never as a
 * fabricated default.
 */

/** The tones a section row's status chip may carry. Anything else is neutral. */
export const STATUS_TONES = ['ok', 'warn', 'block', 'unknown', 'neutral'];

/** The one selector for the three overlays whose open state drives page inert. */
export const OVERLAY_SELECTOR =
  '#factionIntelScreen:not([hidden]), #intelligenceLibraryScreen:not([hidden]), #mcDetailPanel:not([hidden])';

/** Focusable descendants, in document order. */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * An unrecognised tone is neutral, not a class name pasted into the DOM.
 * `indexOf` rather than `includes` so an absent tone lands on neutral too.
 */
export function resolveTone(statusTone) {
  return STATUS_TONES.indexOf(statusTone) === -1 ? 'neutral' : statusTone;
}

/**
 * The text a caller-supplied value renders as.
 *
 * The vanilla panel routed every value through an HTML escaper whose first act
 * was `String(value ?? '')`, so absence rendered as an empty cell rather than as
 * `null`, `undefined` or a confident 0. React escapes for us; this preserves the
 * coercion, which is the half that carried meaning. `0` and `false` are values a
 * caller chose and still render.
 */
export function text(value) {
  return String(value ?? '');
}

/**
 * Every focusable node inside the dialog, filtered to the ones a Tab press can
 * actually reach.
 *
 * `offsetParent !== null` is a VISIBILITY test, not a duplicate of `!hidden`: an
 * element inside a `display: none` ancestor still has `hidden === false` on
 * itself, and trapping focus onto it strands the keyboard. It is preserved
 * verbatim from the vanilla component for that reason.
 */
export function focusableIn(dialog) {
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
}

/**
 * Applies `inert` across the page for whichever of the three overlays is open.
 *
 * @param {Document|object} [doc] — the document to act on. Defaults to the
 *   ambient one; a caller that hands over something without `querySelector`
 *   (an Event, say) falls back to the ambient document rather than silently
 *   doing nothing.
 *
 * Two branches, both load-bearing:
 *   * `.init-view` sections exist — each is inert while an overlay is open and
 *     otherwise inert exactly when it is hidden, and `main` has inert REMOVED
 *     because the views inside it carry it instead.
 *   * no `.init-view` sections — there is nothing finer-grained to mark, so
 *     `main` itself is toggled.
 */
export function syncPageInert(doc) {
  const scope = doc && typeof doc.querySelector === 'function'
    ? doc
    : (typeof document !== 'undefined' ? document : null);
  if (!scope) return;

  const overlayOpen = Boolean(scope.querySelector(OVERLAY_SELECTOR));
  scope.querySelector('.init-topbar')?.toggleAttribute('inert', overlayOpen);
  const views = scope.querySelectorAll('.init-view');
  if (views.length > 0) {
    views.forEach((section) => {
      if (overlayOpen) {
        section.setAttribute('inert', '');
      } else {
        section.toggleAttribute('inert', section.hidden);
      }
    });
    scope.querySelector('main')?.removeAttribute('inert');
  } else {
    scope.querySelector('main')?.toggleAttribute('inert', overlayOpen);
  }
}

/** The facts list, as an array. A non-array `facts` is no facts, not a throw. */
export function normaliseFacts(facts) {
  return Array.isArray(facts) ? facts : [];
}

/**
 * The sections to render. Falsy entries are dropped; an EMPTY section is kept.
 *
 * A section that vanishes reads as "not applicable" when it means "none", so an
 * empty one still renders and says so in the caller's own words.
 */
export function normaliseSections(sections) {
  return Array.isArray(sections) ? sections.filter(Boolean) : [];
}

/** The rows of one section. */
export function normaliseRows(section) {
  return Array.isArray(section?.rows) ? section.rows : [];
}

/** A row with no label carries nothing to say, so it is dropped, not blanked. */
export function isRenderableRow(row) {
  return Boolean(row && row.label);
}

/** Caveat paragraphs: strings with content. A blank note is not a note. */
export function normaliseNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .filter((note) => typeof note === 'string' && note.trim().length > 0);
}

/** Buttons the caller supplied. One with no label has nothing to press. */
export function normaliseActions(actions) {
  return (Array.isArray(actions) ? actions : []).filter((action) => Boolean(action?.label));
}
