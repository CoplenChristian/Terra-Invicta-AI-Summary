// server/engine/campaignDate.js
//
// Campaign-date parsing and the Defend Interests ward status derived from it.
//
// Shared by the defense candidate generator (which needs to know whether a
// holding is already warded) and by anything else that has to compare a save
// date against the current campaign date. Kept apart from the generator
// because the three-state ward answer is the load-bearing part: an unevaluable
// ward is 'unknown', never 'active'.

/**
 * Accepts a Date, the save's `{year, month, day, ...}` object form, or a
 * parseable string. Returns null rather than an Invalid Date so callers can
 * ask "is this readable" with a single check.
 */
function parseCampaignDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && Number.isFinite(Number(value.year)) && Number.isFinite(Number(value.month)) && Number.isFinite(Number(value.day))) {
    const date = new Date(Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour) || 0,
      Number(value.minute) || 0,
      Number(value.second) || 0,
      Number(value.millisecond) || 0
    ));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Four outcomes, never collapsed to a boolean:
 *   'none'    - the control point is not warded (defended === false)
 *   'active'  - warded, and the ward's expiry is measurably in the future
 *   'expired' - warded, and the ward has measurably lapsed
 *   'unknown' - the ward cannot be evaluated from this snapshot
 *
 * The old boolean returned `!expiry || !now || expiry > now`, so an
 * unparseable campaign date made EVERY owned warded control point read as
 * actively defended -- and generateDefendInterestsCandidates skips a nation
 * whose CPs are all active, so the entire Defend Interests axis silently
 * disappeared. That is an absent measurement rendered as a confident "safe",
 * the failure mode this module exists to avoid. An unevaluable ward now
 * reports 'unknown' and the caller surfaces it as an unmet precondition
 * instead of treating the holding as protected.
 */
function defenseStatus(controlPoint, campaignDate) {
  if (controlPoint?.defended === false) return 'none';
  if (controlPoint?.defended !== true) return 'unknown';
  const expiry = parseCampaignDate(controlPoint.defendExpiration);
  if (!expiry) return 'unknown';
  const now = parseCampaignDate(campaignDate);
  if (!now) return 'unknown';
  return expiry.getTime() > now.getTime() ? 'active' : 'expired';
}

module.exports = { parseCampaignDate, defenseStatus };
