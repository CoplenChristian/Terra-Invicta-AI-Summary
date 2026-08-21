/**
 * site/worker/projections.js -- the hosted adapter over the two pure projection
 * registries.
 *
 * The projections themselves are shared with the local Express server
 * (`shared/intelResources.mjs`, `shared/techGraph.mjs`). What this module owns is
 * the hosted side of the contract: which path names a resource, how a query
 * string becomes projection options, and what the caller sees when one of those
 * options is malformed.
 *
 * The accept/reject decisions come from `shared/requestValidation.mjs`, the same
 * module `server/requestValidation.js` re-exports, so the two runtimes cannot
 * drift on what counts as a valid faction id, body filter or limit. The wording
 * of each rejection stays hosted-specific -- both wordings are published
 * contract and unifying them would change what an existing client reads back.
 */

import {
  SUPPORTED_RESOURCES,
  DETAIL_LEVELS,
  DETAIL_AWARE_RESOURCES,
  parseDetailLevel,
  buildResourceProjection
} from '../shared/intelResources.mjs';
import {
  buildTechTreeProjection,
  buildTechPathProjection,
  buildTechSearchProjection,
  buildTechMilestonesProjection,
  buildTechMatrixProjection,
  buildTechOpportunitiesProjection,
  buildResearchQueueProjection,
  CATEGORIES
} from '../shared/techGraph.mjs';
import {
  BODY_FILTER_MESSAGE,
  MINING_LIMIT_BOUNDS,
  exceedsBodyFilterLimits,
  isBoundedInteger,
  parsePositiveIntegerOrNull,
  usesQuantityAsLimit
} from '../shared/requestValidation.mjs';
import { DEFAULT_OBSERVER_FACTION_ID } from '../shared/constants.mjs';
import { jsonResponse } from './http.js';
import { resourceEnvelope, resultIdentity } from './envelopes.js';
import { positiveIntegerOr } from './runtimeDefaults.js';

export const productionPlanPaths = new Set(['/api/intel/production-plan', '/api/production-plan']);

export const TECH_RESOURCES = new Set([
  'tech-tree', 'tech-path', 'tech-search', 'tech-milestones',
  'tech-matrix', 'tech-opportunities', 'research-queue'
]);

const pathResource = (pathName) => {
  const direct = pathName.match(/^\/api\/([^/]+)$/);
  const grouped = pathName.match(/^\/api\/intel\/([^/]+)$/);
  return grouped?.[1] || direct?.[1];
};

export const intelResource = (pathName) => {
  const resource = pathResource(pathName);
  return SUPPORTED_RESOURCES.has(resource) ? resource : null;
};

export const techIntelResource = (pathName) => {
  const resource = pathResource(pathName);
  return resource && TECH_RESOURCES.has(resource) ? resource : null;
};

/**
 * Returns a rejection message, or null when the query is acceptable.
 *
 * `get('faction') || get('factionId')` means a present-but-empty `?faction=`
 * falls through to the alias and then to null, i.e. "absent". That is
 * long-standing hosted behaviour and matches what the local server does by a
 * different route; it is preserved deliberately rather than tightened here.
 */
export const validateResourceQuery = (url) => {
  const faction = url.searchParams.get('faction') || url.searchParams.get('factionId');
  if (faction !== null && parsePositiveIntegerOrNull(faction) === null) {
    return `Invalid faction filter '${faction}'. Use a positive numeric id.`;
  }
  const body = url.searchParams.get('body');
  const theater = url.searchParams.get('theater') || body;
  if ((body !== null && exceedsBodyFilterLimits(body)) ||
      (theater !== null && exceedsBodyFilterLimits(theater))) {
    return BODY_FILTER_MESSAGE;
  }
  const isMiningProspects = usesQuantityAsLimit(pathResource(url.pathname));
  const limit = url.searchParams.get('limit') || (isMiningProspects ? url.searchParams.get('quantity') : null);
  if (limit !== null && !isBoundedInteger(limit, MINING_LIMIT_BOUNDS)) {
    return `Invalid mining prospects limit. Use an integer from ${MINING_LIMIT_BOUNDS.min} to ${MINING_LIMIT_BOUNDS.max}.`;
  }
  const detail = url.searchParams.get('detail');
  if (detail !== null && parseDetailLevel(detail) === null) {
    return `Invalid detail level '${detail}'. Use ${DETAIL_LEVELS.join(' or ')}.`;
  }
  return null;
};

// The hosted adapter uses the same pure projection registry as the local
// Express server. It only supplies the Supabase row and response envelope.
export const buildIntelResource = (result, resource, url) => {
  const snapshot = result.snapshot || {};
  const factionId = parsePositiveIntegerOrNull(url.searchParams.get('faction') || url.searchParams.get('factionId'));
  const body = url.searchParams.get('body');
  const theater = url.searchParams.get('theater') || body;
  const rawLimit = url.searchParams.get('limit') || (usesQuantityAsLimit(resource) ? url.searchParams.get('quantity') : null);
  const limit = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : null;
  const destination = url.searchParams.get('destination');
  const fleetId = url.searchParams.get('fleet') || url.searchParams.get('fleetId');
  const designId = url.searchParams.get('design') || url.searchParams.get('designId') || url.searchParams.get('target');
  const quantity = parseInt(url.searchParams.get('quantity'), 10) || 1;
  const status = url.searchParams.get('status');
  const sort = url.searchParams.get('sort');
  // `validateResourceQuery` has already rejected a malformed value, so this
  // cannot silently fall back to the default for a caller who asked for `full`.
  const detail = parseDetailLevel(url.searchParams.get('detail'));
  const query = {
    faction: factionId,
    body: body || null,
    theater: theater || null,
    limit,
    destination: destination || null,
    fleet: fleetId || null,
    design: designId || null,
    quantity,
    status: status || null,
    sort: sort || null,
    ...(DETAIL_AWARE_RESOURCES.has(resource) ? { detail } : {})
  };
  const projection = buildResourceProjection(snapshot, resource, {
    factionId,
    body,
    theater,
    limit,
    destination,
    fleetId,
    designId,
    quantity,
    status,
    sort,
    detail,
    mode: result.mode || result.row?.visibility || 'player'
  });
  return resourceEnvelope(result, resource, projection.items, query, projection);
};

export const buildTechIntelResource = (result, resource, snapshot, url) => {
  const row = result.row;
  const identity = resultIdentity(result);
  const observerId = positiveIntegerOr(
    url.searchParams.get('observer') || row.observer_faction_id,
    DEFAULT_OBSERVER_FACTION_ID,
    'observer faction id'
  );
  const mode = result.mode || row.visibility || 'player';

  let projection;
  if (resource === 'tech-tree') {
    const category = String(url.searchParams.get('category') || 'all').toLowerCase();
    if (!CATEGORIES.has(category)) {
      return jsonResponse({ success: false, error: `Invalid category '${category}'.` }, 400);
    }
    const includeEffects = String(url.searchParams.get('includeEffects') ?? 'true') !== 'false';
    projection = buildTechTreeProjection(snapshot, mode, observerId, { category, includeEffects });
  } else if (resource === 'tech-path') {
    const rawTarget = url.searchParams.get('target');
    if (!rawTarget) {
      return jsonResponse({ success: false, error: 'Missing required query parameter: target.' }, 400);
    }
    const targets = rawTarget.split(',').map(t => t.trim()).filter(Boolean);
    projection = buildTechPathProjection(snapshot, mode, observerId, targets);
  } else if (resource === 'tech-search') {
    const query = url.searchParams.get('q') || '';
    if (!query) {
      return jsonResponse({ success: false, error: 'Missing required query parameter: q.' }, 400);
    }
    projection = buildTechSearchProjection(snapshot, mode, observerId, query);
  } else if (resource === 'tech-milestones') {
    const category = url.searchParams.get('category') ? String(url.searchParams.get('category')).toLowerCase() : null;
    projection = buildTechMilestonesProjection(snapshot, mode, observerId, category);
  } else if (resource === 'tech-matrix') {
    projection = buildTechMatrixProjection(snapshot, mode, observerId);
  } else if (resource === 'tech-opportunities') {
    projection = buildTechOpportunitiesProjection(snapshot, mode, observerId);
  } else {
    projection = buildResearchQueueProjection(snapshot, mode, observerId);
  }

  return {
    success: true,
    source: 'supabase',
    ...identity,
    difficulty: row.difficulty,
    observerFaction: { id: observerId, name: row.observer_faction_name || null },
    intelMode: mode,
    visibility: row.visibility || mode,
    ...projection
  };
};
