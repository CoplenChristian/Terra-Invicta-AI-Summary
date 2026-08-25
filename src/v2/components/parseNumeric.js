/**
 * src/v2/components/parseNumeric.js
 *
 * Purpose: shared numeric parse for <Value> — null/undefined/'' are absent, not
 * zero. Plain .js so bare Node unit tests import the same code the component
 * ships, instead of copying it.
 */

export function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}