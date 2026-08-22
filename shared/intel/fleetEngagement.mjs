// shared/intel/fleetEngagement.mjs
//
// Purpose: intel resource projection for the per-fleet engagement-estimate
//   endpoint.
//
// Truncation announces itself: `count` is what was emitted, `fleetsTotalCount`
// is the true total and `fleetsOmittedCount` reconciles them, so a capped list
// can never be read as the whole set.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { DEFAULT_ENGAGEMENT_ROWS, buildFleetEngagement } from '../fleetEngagement.mjs';

/**
 * Projects the per-fleet engagement estimates from a filtered snapshot.
 */
export function fleetEngagementResource(snapshot, options = {}) {
  const {
    observerId = DEFAULT_OBSERVER_FACTION_ID,
    mode = 'player',
    limit = null
  } = options;

  const result = buildFleetEngagement(snapshot, {
    observerId,
    mode,
    limit: limit === null || limit === undefined ? DEFAULT_ENGAGEMENT_ROWS : limit
  });

  return {
    count: result.items.length,
    ...result
  };
}
