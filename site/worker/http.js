/**
 * site/worker/http.js -- the hosted runtime's response shapes.
 *
 * Every JSON body the worker returns goes out through `jsonResponse`, so the
 * CORS policy, the no-store rule and the two hardening headers are decided once
 * rather than per route.
 *
 * Sibling module rather than a `shared/` one on purpose: these are Response
 * objects and header policy, which only the edge runtime has. Anything genuinely
 * shared with the Express server lives under `shared/` so both can import it.
 * `scripts/build_static_snapshot.js` copies every `site/worker/*.js` beside the
 * entry point, so a sibling import resolves in the deployed bundle exactly as it
 * does here.
 */

// This site deliberately publishes read-only Player / Enhanced / Omniscient
// intel, and CLAUDE.md documents /api/intel/* as the surface external analysis
// clients call cross-origin. A wildcard origin is therefore the intended policy
// and is NOT tightened here: an allowlist would silently break those documented
// readers. What is tightened is everything that does not serve them --
// credentials are never allowed (and are incompatible with '*' anyway), and the
// advertised request headers are narrowed to what the endpoints actually read.
// No route inspects Authorization, so advertising it only invited callers to
// send credentials to a public endpoint.
export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'access-control-max-age': '86400'
};

export const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      // Snapshot data is mutable: publishing a new save moves the campaign
      // pointer and every focused endpoint must observe that same pointer.
      // Edge/browser caching here can otherwise make /summary and /research
      // appear to come from different saves for up to a minute.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
};

export const htmlResponse = (markup) => new Response(markup, {
  status: 200,
  headers: {
    ...corsHeaders,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  }
});

export const markdownSnapshotResponse = (envelope) => new Response(
  `${envelope.markdown}\n`,
  {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      ...corsHeaders,
      'cache-control': 'no-store'
    }
  }
);
