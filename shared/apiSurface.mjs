/**
 * Shared API surface helpers.
 *
 * The local Express server and the hosted Cloudflare worker both publish the
 * same `/api/intel` directory page and both pick an export markdown variant
 * from the same stored `{ compact, full }` object. Those two pieces used to be
 * written out twice -- once per runtime -- so every added route had to be
 * edited in both places and the two copies drifted.
 *
 * This module is deliberately plain ESM with no Node built-ins: the worker
 * cannot `require` CommonJS, and `server/requestValidation.js` is unusable
 * there for exactly that reason. Node's `require(esm)` support lets the
 * CommonJS server import it unchanged, and `scripts/build_static_snapshot.js`
 * copies `shared/` beside the worker entry point at build time.
 */

// config/defaults.json carries the same value for the local runtime. The
// worker has no filesystem access to that file, so the default lives here as
// the single cross-runtime constant.
export const DEFAULT_CAMPAIGN_KEY = 'initiative';

export const INTEL_API_TITLE = 'Terra Invicta Strategic Intelligence API';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Builds the machine-readable endpoint directory payload.
 *
 * @param {Object} options
 * @param {string} options.source - Runtime label ('local' or 'hosted-worker').
 * @param {Object} options.endpoints - INTEL_ENDPOINT_INDEX.
 * @param {Object} options.examples - INTEL_ENDPOINT_EXAMPLES.
 * @param {number} options.defaultObserverFactionId - Observer id used in examples.
 */
export function buildIntelApiIndex({ source, endpoints, examples, defaultObserverFactionId }) {
  return {
    success: true,
    source,
    name: INTEL_API_TITLE,
    endpoints,
    examples,
    query: {
      observer: `Observer faction ID, e.g. ${defaultObserverFactionId}`,
      mode: 'player | enhanced | omniscient',
      faction: 'Optional faction ID filter',
      body: 'Optional body filter',
      theater: 'Mining-prospects theater filter (body is accepted as a legacy alias)',
      limit: 'Mining-prospects result limit from 1 to 100'
    }
  };
}

/**
 * Renders the human-readable directory page for the payload above.
 * Both runtimes serve this byte-for-byte identical markup.
 */
export function renderIntelApiIndexHtml(payload, { defaultObserverFactionId }) {
  const fallbackQuery = `?observer=${defaultObserverFactionId}&mode=omniscient`;
  const links = Object.entries(payload.endpoints || {}).map(([name, endpoint]) => {
    const query = payload.examples?.[name] || fallbackQuery;
    const href = escapeHtml(`${endpoint}${query}`);
    return `<li><span>${escapeHtml(name)}</span><a href="${href}">${href}</a></li>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="index,follow">
<title>${INTEL_API_TITLE}</title></head><body>
<main><h1>${INTEL_API_TITLE}</h1>
<p>Machine-readable endpoint directory. Add or change observer, mode, faction, body, and other filters as needed.</p>
<p><a href="/api/intel?format=json">JSON index</a> · <a href="/v2/">Command Center</a></p>
<ul>${links}</ul></main></body></html>`;
}

/**
 * Chooses the requested export markdown variant from a stored export object,
 * falling back to the other variant when the requested one is missing.
 *
 * This is a behaviour-preserving extraction of the identical expression that
 * was written out in three places (hosted worker twice, Supabase adapter once).
 * It keeps the existing empty-string result for a snapshot that carries no
 * export at all so the published wire format does not change; `/latest-snapshot.md`
 * renders that result directly and would otherwise emit a literal "null".
 * Use `hasExportMarkdown` when a caller needs to tell absent from empty.
 */
export function selectExportMarkdown(exportObject, format = 'compact') {
  const stored = exportObject && typeof exportObject === 'object' ? exportObject : {};
  return format === 'full'
    ? (stored.full || stored.compact || '')
    : (stored.compact || stored.full || '');
}

/** True only when the stored export object actually carries a markdown body. */
export function hasExportMarkdown(exportObject) {
  const stored = exportObject && typeof exportObject === 'object' ? exportObject : {};
  return Boolean(
    (typeof stored.compact === 'string' && stored.compact.length > 0) ||
    (typeof stored.full === 'string' && stored.full.length > 0)
  );
}

/**
 * Resolves the public read key for Supabase.
 *
 * `SUPABASE_PUBLISHABLE_KEY` is the documented name (see CLAUDE.md). The older
 * `SUPABASE_ANON_KEY` names the same public anon key and is still accepted, but
 * the precedence is now explicit and the deprecated spelling is reported.
 *
 * Only the variable *name* is ever surfaced; the key value is never returned in
 * the diagnostic fields and must never be logged. The service role key is
 * deliberately not consulted here -- it is local-only and must never reach a
 * read path shared with worker code.
 */
export function resolveSupabaseReadKey(env = {}) {
  const publishable = env.SUPABASE_PUBLISHABLE_KEY;
  if (typeof publishable === 'string' && publishable.length > 0) {
    return { key: publishable, source: 'SUPABASE_PUBLISHABLE_KEY', deprecated: false };
  }
  const anon = env.SUPABASE_ANON_KEY;
  if (typeof anon === 'string' && anon.length > 0) {
    return { key: anon, source: 'SUPABASE_ANON_KEY', deprecated: true };
  }
  return { key: null, source: null, deprecated: false };
}
