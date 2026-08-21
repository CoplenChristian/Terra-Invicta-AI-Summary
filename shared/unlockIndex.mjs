// shared/unlockIndex.mjs
//
// Read accessors over the baked unlock index (`snapshot.unlockIndex`, built by
// `server/snapshot/templates.js` at snapshot-build time).
//
// The index is pure template data: sixteen families of buildable things, each
// reverse-mapped to the research gate that unlocks it. No judgement, no
// campaign state -- which is exactly why it is the first thing built and why
// everything downstream can depend on it.
//
// The snapshot stores only the gate -> items direction. The items -> gate
// direction is rebuilt here, once per call, over 1,223 entries; publishing the
// same relation twice would have cost another ~110 KB on every Supabase row for
// a map that takes under a millisecond to invert.
//
// Like every module under `shared/`, this is plain ESM with NO Node built-ins
// and no imports outside `shared/`: the hosted Cloudflare worker cannot
// `require` CommonJS, and `scripts/build_static_snapshot.js` copies the whole
// of `shared/` beside the worker entry point at build time.

import { asArray } from './util.mjs';

/**
 * The reason an index is unusable, or null when it is usable.
 *
 * A snapshot published before the index existed carries no `unlockIndex` at
 * all. That is "not published", which is a different thing from "published and
 * empty" -- and both are different from "sixteen families, all zero". Callers
 * get to tell them apart instead of reading an empty object as a census.
 */
export const unlockIndexUnavailableReason = (snapshot) => {
  const index = snapshot?.unlockIndex;
  if (!index || typeof index !== 'object') {
    return 'unlockIndex is not present on this snapshot; re-publish after upgrading';
  }
  if (!index.gates || typeof index.gates !== 'object') {
    return 'unlockIndex carries no gate map';
  }
  return null;
};

/**
 * The family census: what was indexed, from which field, and how much of it.
 *
 * Returned verbatim from the bake rather than recounted here, so the numbers a
 * caller sees are the numbers that were written. `available: false` carries the
 * reason instead of zeroed counts.
 */
export const unlockIndexCensus = (snapshot) => {
  const unavailable = unlockIndexUnavailableReason(snapshot);
  if (unavailable) {
    return { available: false, reason: unavailable, families: null, totals: null, unresolved: null };
  }
  const index = snapshot.unlockIndex;
  return {
    available: true,
    reason: null,
    families: index.families || {},
    totals: index.totals || null,
    // Entries the bake could not key. Non-empty means the index is INCOMPLETE
    // and says by how much, rather than quietly being short.
    unresolved: asArray(index.unresolved)
  };
};

/** Everything one gate unlocks: `{ kind, unlocks: { family: [{id, displayName}] } }`. */
export const unlocksForGate = (snapshot, gateId) => {
  if (unlockIndexUnavailableReason(snapshot)) return null;
  if (!gateId || typeof gateId !== 'string') return null;
  return snapshot.unlockIndex.gates[gateId] || null;
};

/**
 * Inverts the index: `family:itemId` -> `{ gateId, gateKind, family, id, displayName }`.
 *
 * Keyed by family AND id because the two directions are not symmetric -- an id
 * is only unique within its family. A bare id key would let a hab module and a
 * drive that happened to share a dataName overwrite each other silently.
 */
export const buildItemGateMap = (snapshot) => {
  const map = new Map();
  if (unlockIndexUnavailableReason(snapshot)) return map;
  for (const [gateId, gate] of Object.entries(snapshot.unlockIndex.gates)) {
    for (const [family, items] of Object.entries(gate.unlocks || {})) {
      for (const item of asArray(items)) {
        if (!item?.id) continue;
        map.set(`${family}:${item.id}`, {
          gateId,
          gateKind: gate.kind,
          family,
          id: item.id,
          displayName: item.displayName || item.id
        });
      }
    }
  }
  return map;
};

/** The gate for one item, or null when the item is ungated or unknown. */
export const gateForItem = (snapshot, family, itemId) => {
  if (!family || !itemId) return null;
  return buildItemGateMap(snapshot).get(`${family}:${itemId}`) || null;
};

/** Every gate id that unlocks at least one entry in `family`. */
export const gatesForFamily = (snapshot, family) => {
  if (unlockIndexUnavailableReason(snapshot)) return [];
  return Object.entries(snapshot.unlockIndex.gates)
    .filter(([, gate]) => Array.isArray(gate.unlocks?.[family]) && gate.unlocks[family].length > 0)
    .map(([gateId, gate]) => ({ gateId, gateKind: gate.kind, items: gate.unlocks[family] }));
};
