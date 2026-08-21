/**
 * site/worker/assets.js -- static asset delivery for the hosted runtime.
 * Purpose: static asset delivery — the Sites ASSETS binding first, then the
 *   embedded static-assets bundle fallback.
 *
 * Two sources, in order: the Sites `ASSETS` binding when the deployment mounts
 * one, and the generated `static-assets.js` bundle when it does not. The
 * embedded fallback is what keeps the dashboard shell reachable on deployments
 * where the binding is absent, so it is not dead code.
 */

import { staticAssets } from './static-assets.js';

const mimeTypeFor = (pathname) => {
  const lowerPath = pathname.toLowerCase();
  if (lowerPath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lowerPath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lowerPath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (lowerPath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lowerPath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
};

const embeddedAsset = (pathname) => {
  const key = pathname.replace(/^\/+/, '') || 'index.html';
  const candidates = [
    key,
    key.endsWith('/') ? `${key}index.html` : `${key}/index.html`
  ];
  const assetKey = candidates.find(candidate => staticAssets[candidate] !== undefined);
  const embedded = assetKey === undefined ? undefined : staticAssets[assetKey];
  if (embedded === undefined) return null;

  const body = embedded && typeof embedded === 'object' && embedded.encoding === 'base64'
    ? Uint8Array.from(atob(embedded.data), character => character.charCodeAt(0))
    : embedded;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': mimeTypeFor(assetKey),
      'cache-control': assetKey === 'index.html' ? 'no-cache' : 'public, max-age=300'
    }
  });
};

// Only headers a static asset lookup can actually act on are forwarded.
// Passing the whole inbound header set handed the assets binding the caller's
// cookie, authorization and x-forwarded-* headers, none of which it needs and
// any of which could end up in an upstream cache key or log line.
const ASSET_REQUEST_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'if-none-match', 'if-modified-since', 'range'];

const assetRequestHeaders = (request) => {
  const headers = new Headers();
  for (const name of ASSET_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

export const asset = async (env, request, pathname) => {
  const url = new URL(request.url);
  const assetPath = pathname === '/v2' ? '/v2/index.html' : pathname;
  url.pathname = assetPath;

  if (env?.ASSETS?.fetch) {
    const response = await env.ASSETS.fetch(new Request(url.toString(), {
      method: 'GET',
      headers: assetRequestHeaders(request)
    }));
    if (response.status !== 404) return response;
  }

  return embeddedAsset(assetPath) || new Response('Not found', { status: 404 });
};

/** Static Player Intel fallback file for an observer, used when Supabase is absent. */
export const observerFile = (observerId, suffix) => {
  return `/data/${suffix}-player-${observerId}.json`;
};

export { ASSET_REQUEST_HEADERS, embeddedAsset, mimeTypeFor };
