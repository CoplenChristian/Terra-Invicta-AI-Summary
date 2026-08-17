const API = {
  staticOnly: false,

  async requestJson(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      throw new Error(`Request failed: ${res.status}`);
    }
    return await res.json();
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
    } catch {
      return API.getStaticSnapshot(observerId);
    }
  },

  async refresh(mode = 'player', observerId = 4712) {
    try {
      return await API.requestJson(`/api/refresh?mode=${encodeURIComponent(mode)}&observer=${encodeURIComponent(observerId)}`, {
        method: 'POST'
      });
    } catch {
      return API.getStaticSnapshot(observerId);
    }
  },

  async getExport(format = 'chatgpt', mode = 'player', observerId = 4712) {
    try {
      const payload = await API.requestJson(`/api/export?format=${encodeURIComponent(format)}&mode=${encodeURIComponent(mode)}&observer=${encodeURIComponent(observerId)}`);
      if (mode !== 'player' && payload.markdown?.includes('**Intelligence Mode:** PLAYER')) payload.staticOnly = true;
      return payload;
    } catch {
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
    } catch {
      API.staticOnly = true;
      const res = await fetch('/data/effects.json');
      return await res.json();
    }
  }
};
