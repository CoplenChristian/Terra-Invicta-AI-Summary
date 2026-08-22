// tests/fixtures/renderHarness.js
//
// Purpose: the one render-sandbox harness for v2 component tests — the REAL
//   `escapeHtml` from the shipped shared bundle, and a `visibleText` that
//   decodes entities so "what a reader sees" is actually true.
//
// ---------------------------------------------------------------------------
// TWO SILENT HARNESS DEFECTS THIS EXISTS TO CLOSE
// ---------------------------------------------------------------------------
//
// Both were pre-existing, both were invisible until a research duration
// rendered under a month, and together they made every assertion about visible
// text weaker than it looked.
//
//   1. THE SANDBOX'S `escapeHtml` DID NOT ESCAPE. Every component opens with
//      `const escapeHtml = shared.escapeHtml || (value => String(value ?? ''))`.
//      A sandbox built as `{ window: {} }` leaves `MissionControlShared`
//      undefined, so the component took that fallback -- which is not an
//      escaper. Three other harnesses passed an explicit stub that also did not
//      escape (`s => s`, `String(value ?? '')`). In the browser the real one
//      runs, so the harness and the browser disagreed about the output.
//
//   2. `visibleText` STRIPPED TAGS WITHOUT DECODING ENTITIES. The panel prints
//      "<1 mo" for a duration under a month. Escaped, that is `&lt;1 mo`, which
//      a browser shows as "<1 mo" -- but the helper claimed the reader saw the
//      literal `&lt;1 mo`. UNescaped, the raw `<` opened what the tag-stripper
//      read as a tag and `<1 mo</div>` was removed whole, so the row's duration
//      vanished from what the test believed a reader sees and the next row's
//      text closed the gap.
//
// Combined, an assertion could fail on a defect that existed only in the test,
// or pass over text no reader would ever see. Neither had ever tripped because
// no fixture had carried a sub-month figure before the allocation-priced chain
// durations.
//
// `escapeHtml` here is the SHIPPED function, executed out of
// `public/v2/js/shared.js` rather than copied. A copy is a second thing to keep
// in step -- and the copy that used to live in `tests/researchRanking.test.js`
// is exactly the kind of drift this repo has been bitten by before.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const sharedBundlePath = path.join(repoRoot, 'public', 'v2', 'js', 'shared.js');

/**
 * `window.MissionControlShared`, produced by running the shipped bundle.
 *
 * `shared.js` is an IIFE taking `window`, so it needs nothing but a bare object
 * to attach itself to. Nothing in it touches `document` at load time.
 */
function loadMissionControlShared() {
  const source = fs.readFileSync(sharedBundlePath, 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: sharedBundlePath });
  const shared = sandbox.window.MissionControlShared;
  if (!shared || typeof shared.escapeHtml !== 'function') {
    throw new Error(
      `${sharedBundlePath} did not expose window.MissionControlShared.escapeHtml; `
      + 'every component test escapes through it, so a harness that silently fell back '
      + 'would diverge from the browser again.'
    );
  }
  return shared;
}

const MISSION_CONTROL_SHARED = loadMissionControlShared();

/** The shipped escaper. Not a copy -- see the header. */
const escapeHtml = MISSION_CONTROL_SHARED.escapeHtml;

// The five entities `escapeHtml` produces, reversed. `&amp;` is decoded LAST so
// an escaped literal ampersand (`&amp;lt;`) decodes to `&lt;` rather than to a
// `<` the panel never printed.
const ENTITY_DECODERS = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&#x27;/gi, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&']
];

/**
 * What a reader actually sees.
 *
 * Tags are stripped whole, so a `title` attribute can never mask a null that
 * reached the visible copy -- and equally, prose deliberately parked in a
 * tooltip is not counted against the panel. Entities are then decoded, which is
 * what makes the name true: a browser renders `&lt;1 mo` as "<1 mo", and a
 * helper that reports the entity is describing the markup, not the reader.
 *
 * Order matters. Decoding BEFORE stripping would turn `&lt;div&gt;` -- text a
 * panel might legitimately print -- into a tag the stripper then eats.
 */
function visibleText(html) {
  let text = String(html === null || html === undefined ? '' : html)
    .replace(/<[^>]*>/g, ' ');
  for (const [pattern, replacement] of ENTITY_DECODERS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A component sandbox carrying the real shared bundle.
 *
 * `extra` is merged last so a test can still supply `document`, `fetch` or a
 * stubbed sibling component; it may also override `window.MissionControlShared`
 * deliberately, which is a different thing from never having set it.
 */
function makeSandbox(extra = {}) {
  const { window: windowExtra = {}, ...rest } = extra;
  const sandbox = {
    window: { MissionControlShared: MISSION_CONTROL_SHARED, ...windowExtra },
    console,
    fetch: () => Promise.resolve(null),
    ...rest
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

/**
 * Runs a component file in a fresh sandbox and returns the sandbox.
 *
 * Deliberately returns the whole sandbox rather than one export: components
 * attach under different `window.*` names, and some tests read more than one.
 */
function runComponent(componentPath, extra = {}) {
  const source = fs.readFileSync(componentPath, 'utf8');
  const sandbox = makeSandbox(extra);
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: componentPath });
  return sandbox;
}

module.exports = {
  MISSION_CONTROL_SHARED,
  escapeHtml,
  visibleText,
  makeSandbox,
  runComponent,
  sharedBundlePath
};
