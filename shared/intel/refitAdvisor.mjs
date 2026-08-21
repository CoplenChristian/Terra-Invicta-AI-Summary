// shared/intel/refitAdvisor.mjs
//
// Purpose: intel resource projection for the refit-advisor endpoint.

import { buildRefitAdvisor } from '../refitAdvisor.mjs';

/**
 * Projects the Refit Advisor resource from a filtered or raw snapshot.
 */
export function refitAdvisorResource(snapshot, options = {}) {
  const {
    observerId = 4712,
    mode = 'player',
    designId = null,
    limit = null,
    detail = 'summary'
  } = options;

  const result = buildRefitAdvisor(snapshot, { observerId, mode, designId });

  if (limit && Number.isFinite(Number(limit)) && Number(limit) > 0) {
    const lim = Number(limit);
    return {
      ...result,
      count: result.items.length,
      items: result.items.slice(0, lim),
      itemsShown: Math.min(lim, result.items.length),
      itemsOmittedCount: Math.max(0, result.items.length - lim)
    };
  }

  return {
    ...result,
    itemsShown: result.items.length,
    itemsOmittedCount: 0
  };
}
