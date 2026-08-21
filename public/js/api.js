const API = {
  staticOnly: false,
  // Set once the runtime probe has run. 'local'/'dev' -> live API present,
  // errors must surface. 'hosted'/'fallback' -> static assets are authoritative.
  runtimeEnvironment: null,
  publishToken: null,

  async requestJson(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      let detail = '';
      if (contentType.includes('application/json')) {
        const payload = await res.json().catch(() => null);
        detail = payload?.error || '';
      }
      const error = new Error(detail || `Request failed: ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return await res.json();
  },

  isStaticHosted() {
    return API.staticOnly || API.runtimeEnvironment === 'hosted' || API.runtimeEnvironment === 'fallback';
  },

  async getRuntime() {
    try {
      const runtime = await API.requestJson('/api/runtime');
      API.runtimeEnvironment = runtime.environment || 'hosted';
      API.publishToken = runtime.publishToken || null;
      return runtime;
    } catch {
      // A missing runtime endpoint means this is an older/static hosted build.
      // Fail closed so a publish control can never appear by accident.
      API.runtimeEnvironment = 'fallback';
      return {
        success: true,
        environment: 'hosted',
        canPublish: false,
        canRefresh: false,
        source: 'fallback'
      };
    }
  },

  async getStaticSnapshot(observerId = 4712) {
    API.staticOnly = true;
    const res = await fetch(`/data/snapshot-player-${encodeURIComponent(observerId)}.json`);
    if (!res.ok) throw new Error('Hosted snapshot is unavailable.');
    const payload = await res.json();
    payload.staticOnly = true;
    return payload;
  },

  async getSaves() {
    try {
      return await API.requestJson('/api/saves');
    } catch {
      return { success: true, saves: [], staticOnly: true };
    }
  },

  async getSnapshot(mode = 'player', observerId = 4712, saveName = null) {
    let url = `/api/snapshot?mode=${encodeURIComponent(mode)}&observer=${encodeURIComponent(observerId)}`;
    if (saveName) url += `&save=${encodeURIComponent(saveName)}`;
    try {
      const payload = await API.requestJson(url);
      if (payload.data?.mode === 'player' && mode !== 'player') payload.staticOnly = true;
      return payload;
    } catch (err) {
      // On a live local server a real error (e.g. 503 save-locked) must reach
      // the UI instead of being hidden by stale static data. Static fallback
      // is only for hosted builds that were never backed by the API.
      if (!API.isStaticHosted() && err.status !== 404) throw err;
      return API.getStaticSnapshot(observerId);
    }
  },

  async refresh(mode = 'player', observerId = 4712) {
    try {
      return await API.requestJson(`/api/refresh?mode=${encodeURIComponent(mode)}&observer=${encodeURIComponent(observerId)}`, {
        method: 'POST'
      });
    } catch (err) {
      if (!API.isStaticHosted() && err.status !== 404) throw err;
      return API.getStaticSnapshot(observerId);
    }
  },

  async publishLatest() {
    const headers = { Accept: 'application/json' };
    if (API.publishToken) headers['X-TI-Publish-Token'] = API.publishToken;
    return await API.requestJson('/api/publish', { method: 'POST', headers });
  },

  async getExport(format = 'chatgpt', mode = 'player', observerId = 4712) {
    try {
      const payload = await API.requestJson(`/api/export?format=${encodeURIComponent(format)}&mode=${encodeURIComponent(mode)}&observer=${encodeURIComponent(observerId)}`);
      if (mode !== 'player' && payload.markdown?.includes('**Intelligence Mode:** PLAYER')) payload.staticOnly = true;
      return payload;
    } catch (err) {
      if (!API.isStaticHosted() && err.status !== 404) throw err;
      API.staticOnly = true;
      const res = await fetch(`/data/export-${encodeURIComponent(format)}-player-${encodeURIComponent(observerId)}.json`);
      if (!res.ok) throw new Error('Hosted export is unavailable.');
      const payload = await res.json();
      payload.staticOnly = true;
      return payload;
    }
  },

  async getEffectsInfo() {
    try {
      return await API.requestJson('/api/templates/effects');
    } catch (err) {
      if (!API.isStaticHosted() && err.status !== 404) throw err;
      API.staticOnly = true;
      const res = await fetch('/data/effects.json');
      return await res.json();
    }
  }
};
