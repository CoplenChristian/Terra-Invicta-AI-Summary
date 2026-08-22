/**
 * server/commentary/prng.js
 * Purpose: CommonJS barrel over the shared Mulberry32 PRNG used for strategic
 *   commentary simulations and phrasing.
 *
 * The implementation moved to `shared/prng.mjs` on 2026-08-22 so the hosted
 * Cloudflare worker can run the same seeded sweep. Per CLAUDE.md a split leaves
 * the original path as a barrel re-exporting the SAME function objects -- not
 * wrappers -- so reference-identity assertions hold and no caller changed.
 */

'use strict';

const { hashString, createPrng, samplePercentile } = require('../../shared/prng.mjs');

module.exports = {
  hashString,
  createPrng,
  samplePercentile
};
