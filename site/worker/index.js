const asset = (env, request, pathname) => {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }));
};

const observerFile = (observerId, suffix) => {
  const safeObserverId = /^\d+$/.test(observerId || '') ? observerId : '4712';
  return `/data/${suffix}-player-${safeObserverId}.json`;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const observerId = url.searchParams.get('observer') || '4712';

    if (url.pathname === '/api/snapshot') {
      // Hosted deployments intentionally expose only the sanitized Player
      // Intel build. Local mode switching remains available on localhost.
      return asset(env, request, observerFile(observerId, 'snapshot'));
    }

    if (url.pathname === '/api/refresh') {
      return asset(env, request, observerFile(observerId, 'snapshot'));
    }

    if (url.pathname === '/api/export') {
      const format = url.searchParams.get('format') === 'full' ? 'export-full' : 'export-chatgpt';
      return asset(env, request, observerFile(observerId, format));
    }

    if (url.pathname === '/api/templates/effects') {
      return asset(env, request, '/data/effects.json');
    }

    if (url.pathname === '/api/saves') {
      return new Response(JSON.stringify({ success: true, saves: [], staticOnly: true }), {
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
