// shared/util.mjs
//
// The one home for the small helpers that had been copy-pasted across the
// repo: `asArray` existed five times, the presence-guarded numeric coercion
// eight times, `round` twice, and `sameId` four times under two different
// definitions. Copies drift silently -- `sameId` had already split into a
// numeric-aware version and a string-only version that disagree about
// `'4712 '` vs `4712` -- so they live here now and every caller imports.
//
// Deliberately plain ESM with NO Node built-ins and no imports outside
// `shared/`. The hosted Cloudflare worker cannot `require` CommonJS (that is
// why `server/requestValidation.js` is unusable there), and Node's
// `require(esm)` support lets the CommonJS server import this file unchanged.
// `scripts/build_static_snapshot.js` copies the whole of `shared/` beside the
// worker entry point at build time, so a new module here needs no build edit.
// `shared/apiSurface.mjs` is the established example of this pattern.

/** Anything that is not an array becomes an empty array, never null. */
export const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Absent stays null.
 *
 * `Number(null) === 0` and `Number('') === 0`, both finite, so a bare
 * `Number.isFinite` guard turns a missing or redacted field into a confident
 * zero. That is the single most-repeated bug class in this repo's history --
 * presence is checked before coercion.
 *
 * Returns null for absent/blank/unparseable input, a finite number otherwise.
 */
export const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The stricter sibling: only an actual number or a non-blank numeric string
 * counts as a measurement. `toFiniteNumber` accepts anything `Number()` can
 * coerce, so `true` becomes 1 and `[]` becomes 0 -- fine when the input is
 * known to be a numeric field, wrong when it is an arbitrary snapshot value
 * that may hold a boolean or an array. `server/briefingGenerator.js` reads
 * exactly that kind of field and has always used this stricter form; it is
 * named separately rather than merged so the difference stays deliberate.
 */
export const strictFiniteNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Round to `places` decimals, preserving null for an unmeasured input. */
export const round = (value, places = 2) => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  const factor = 10 ** places;
  return Math.round(parsed * factor) / factor;
};

/**
 * Entity id equality -- the ONE implementation.
 *
 * Snapshots reach this code from three sources: the local parser, JSON revived
 * from Supabase, and HTTP query strings. Ids arrive as numbers in some and
 * strings in others, so a strict `===` between a string and a number silently
 * yields an EMPTY result rather than an error -- the worst failure mode for an
 * intelligence feed, and one that has already shipped a bug (see
 * `server/engine/pairing.js`).
 *
 * Two rules, in order:
 *   1. If BOTH sides parse as finite numbers, compare numerically. This is
 *      what makes `4712` and `'4712'` the same control point.
 *   2. Otherwise compare as strings -- but an absent id is never equal to
 *      anything, including another absent id. `String(null) === String(null)`
 *      is true, which is how a dedupe key of `"undefined"` collapsed 303
 *      candidates down to 1. An unresolvable identity must not match.
 */
export const sameId = (left, right) => {
  const a = toFiniteNumber(left);
  const b = toFiniteNumber(right);
  if (a !== null && b !== null) return a === b;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
};

/**
 * Milliseconds in a day. Written out as `86400000` in ten places across five
 * files and both runtimes before this.
 */
export const MS_PER_DAY = 86400000;

/**
 * Metres in an astronomical unit (IAU 2012 definition, exact by convention).
 * The bare literal `149597870700` in a division carries no clue what it is.
 */
export const METERS_PER_AU = 149597870700;

/**
 * Dollars in a trillion. The save quotes every GDP figure in whole dollars and
 * three places report it in trillions -- `server/briefingGenerator.js` and
 * `server/exportGenerator.js` each declared their own `ONE_TRILLION`, and
 * `server/directiveAdvisor.js` divided by a bare `1e12`.
 *
 * Deliberately NOT applied to the SI-suffix ladder in `server/snapshotDelta.js`
 * (`1e12`/`1e9`/`1e6`/`1e3`): there the value is one rung of a magnitude scale,
 * not a currency unit, and naming a single rung would obscure the pattern.
 */
export const ONE_TRILLION = 1e12;

/**
 * Finds the observer faction in a faction list.
 *
 * Four near-identical fallback chains existed for this (`intelligenceFilter`,
 * `intelResources` twice, `briefingGenerator`, `strategicSnapshot`), each with
 * DIFFERENT matching: strict `===`, `Number(x) === Number(y)`, exact display
 * name, case-insensitive substring display name, and differing decisions about
 * whether to fall back to `factions[0]`.
 *
 * The chain is now explicit rather than accidental: a caller gets id matching
 * only, unless it opts in to a named-faction step and/or a first-faction step.
 * Silent fallback is no longer the default shape of the code.
 *
 * This resolver deliberately does NOT throw. The loud check belongs at the two
 * entry points that can still report a 404 to a caller --
 * `server/snapshotLoader.resolveObserverId` (CLI + programmatic API) and
 * `server/requestValidation.assertKnownObserver` (HTTP) -- both of which run
 * before any of these call sites. Throwing here as well would turn an
 * already-rejected request into an unhandled crash deep inside a projection.
 *
 * @param {Array}  factions
 * @param {*}      observerId                    Numeric or string faction id.
 * @param {Object} [options]
 * @param {string|null} [options.fallbackDisplayName] Faction name to try when
 *   the id does not match. Null disables the step.
 * @param {'exact'|'contains'} [options.fallbackMatch='exact'] How to compare
 *   that name. `'contains'` is case-insensitive substring.
 * @param {boolean} [options.fallbackToFirst=false] Return `factions[0]` when
 *   nothing else matched.
 * @returns {Object|null} The faction, or null when nothing matched.
 */
export function resolveObserverFaction(factions, observerId, {
  fallbackDisplayName = null,
  fallbackMatch = 'exact',
  fallbackToFirst = false
} = {}) {
  const list = asArray(factions);

  const byId = list.find(faction => sameId(faction?.ID, observerId));
  if (byId) return byId;

  if (fallbackDisplayName) {
    const wanted = String(fallbackDisplayName);
    const byName = fallbackMatch === 'contains'
      ? list.find(faction => String(faction?.displayName || '').toLowerCase().includes(wanted.toLowerCase()))
      : list.find(faction => faction?.displayName === wanted);
    if (byName) return byName;
  }

  return fallbackToFirst ? (list[0] ?? null) : null;
}
