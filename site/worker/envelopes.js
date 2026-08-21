/**
 * site/worker/envelopes.js -- the response envelopes wrapped around a Supabase
 * result.
 * Purpose: the response envelopes wrapped around a Supabase result, including
 *   the identity envelope clients use to tell which save they are reading.
 *
 * `resultIdentity` is the one that matters: every hosted data response carries
 * it so an external client can tell which save it is reading and whether that
 * save is still the campaign's active one. It is duplicated INSIDE itself
 * (top-level fields plus a nested `activeSnapshot`) because both spellings are
 * published wire format; that shape is preserved exactly, not tidied.
 */

import { selectExportMarkdown } from '../shared/apiSurface.mjs';

export const resultIdentity = (result) => {
  const row = result.row || {};
  const snapshot = result.snapshot || {};
  const activeSnapshot = result.activeSnapshot || {};
  const canonicalTimestamp = (value) => {
    const parsed = new Date(value || '');
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : (value || null);
  };
  return {
    snapshotId: activeSnapshot.snapshotId || snapshot.snapshotId || row.snapshot?.snapshotId || null,
    saveHash: activeSnapshot.saveHash || snapshot.saveHash || row.snapshot?.saveHash || null,
    saveModifiedAt: canonicalTimestamp(activeSnapshot.saveModifiedAt || row.save_last_modified),
    saveFilename: activeSnapshot.saveFilename || row.save_filename || null,
    campaignDate: activeSnapshot.campaignDate || row.game_time || null,
    generatedAt: canonicalTimestamp(activeSnapshot.generatedAt || snapshot.generatedAt || row.generated_at),
    isLatestSnapshot: result.isLatestSnapshot === true,
    activeSnapshot: {
      snapshotId: activeSnapshot.snapshotId || snapshot.snapshotId || row.snapshot?.snapshotId || null,
      saveHash: activeSnapshot.saveHash || snapshot.saveHash || row.snapshot?.saveHash || null,
      saveModifiedAt: canonicalTimestamp(activeSnapshot.saveModifiedAt || row.save_last_modified),
      saveFilename: activeSnapshot.saveFilename || row.save_filename || null,
      campaignDate: activeSnapshot.campaignDate || row.game_time || null,
      generatedAt: canonicalTimestamp(activeSnapshot.generatedAt || snapshot.generatedAt || row.generated_at),
      isLatestSnapshot: result.isLatestSnapshot === true
    }
  };
};

export const snapshotEnvelope = (result, format = 'compact') => {
  const row = result.row;
  const markdown = selectExportMarkdown(result.chatgptExport, format);

  return {
    success: true,
    source: 'supabase',
    ...resultIdentity(result),
    difficulty: row.difficulty,
    campaignStartYear: row.campaign_start_year,
    observerFaction: {
      id: row.observer_faction_id,
      name: row.observer_faction_name
    },
    intelMode: result.mode || row.visibility || 'player',
    visibility: row.visibility || result.mode || 'player',
    snapshot: result.snapshot,
    markdown,
    snapshotId: result.snapshot?.snapshotId || row.snapshot?.snapshotId || null,
    saveHash: result.snapshot?.saveHash || row.snapshot?.saveHash || null
  };
};

/**
 * `count` is null-preserving on purpose: a projection that could not be built
 * reports null rather than a confident 0, which would read as "measured, and
 * there are none".
 */
export const resourceEnvelope = (result, resource, items, query = {}, extra = {}) => {
  const row = result.row;
  return {
    success: true,
    source: 'supabase',
    resource,
    ...resultIdentity(result),
    difficulty: row.difficulty,
    observerFaction: {
      id: row.observer_faction_id,
      name: row.observer_faction_name
    },
    intelMode: result.mode || row.visibility || 'player',
    visibility: row.visibility || result.mode || 'player',
    query,
    count: items === null ? null : (Array.isArray(items) ? items.length : 0),
    items: Array.isArray(items) ? items : [],
    ...extra
  };
};
