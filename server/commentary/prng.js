/**
 * server/commentary/prng.js
 * Purpose: the deterministic Mulberry32 PRNG used for strategic commentary
 *   simulations and phrasing.
 *
 * Deterministic Mulberry32 PRNG for strategic commentary simulations and phrasing.
 *
 * Per CLAUDE.md and docs/archive/strategic-commentary-and-layout-plan.md:
 * - Seed from snapshotId, never the clock.
 * - Same save -> byte-identical output across refreshes.
 * - Math.random() is forbidden here.
 */

'use strict';

/**
 * 32-bit FNV-1a string hash to produce an unsigned 32-bit integer seed.
 */
function hashString(str) {
  if (typeof str !== 'string') {
    str = String(str ?? 'terra-invicta-commentary-seed');
  }
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 32-bit PRNG generator.
 * @param {string|number} seedInput
 */
function createPrng(seedInput) {
  let s = typeof seedInput === 'number'
    ? (seedInput >>> 0) || 1
    : hashString(seedInput);

  function nextUint32() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  function nextFloat() {
    return nextUint32() / 4294967296;
  }

  function nextInt(min, max) {
    if (min >= max) return min;
    const range = max - min + 1;
    return min + Math.floor(nextFloat() * range);
  }

  function choice(array) {
    if (!Array.isArray(array) || array.length === 0) return null;
    return array[Math.floor(nextFloat() * array.length)];
  }

  function shuffle(array) {
    if (!Array.isArray(array)) return [];
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(nextFloat() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  return {
    seed: s,
    nextUint32,
    nextFloat,
    nextInt,
    choice,
    shuffle
  };
}

/**
 * Sample a percentile value from a pre-sorted numeric array.
 * @param {number[]} sortedValues
 * @param {number} p Percentile between 0 and 1 (e.g. 0.2, 0.5, 0.8)
 */
function samplePercentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = p * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

module.exports = {
  hashString,
  createPrng,
  samplePercentile
};
