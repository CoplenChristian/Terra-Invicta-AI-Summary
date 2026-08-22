// shared/intel/registry.mjs
//
// Purpose: the ONE endpoint table from which route, discovery index, example
//   and dispatch are all derived.
//
// ---------------------------------------------------------------------------
// ONE endpoint table. Four derived views. No hand-maintained parallel lists.
//
// The 2026-08-20 code review flagged three separately hand-maintained lists of
// the same endpoints -- `SUPPORTED_RESOURCES`, `INTEL_ENDPOINT_INDEX`, and the
// dispatcher's if/switch chain -- which had already drifted: `mining-expansion`
// reached the dispatcher and the discovery index but never the examples map.
// The first two were folded into a table; the dispatcher was the one that got
// away, because a `switch` cannot be derived from data.
//
// It is derived now. Each row carries its own `project` function, so:
//
//   route      derived from `key`, so path and dispatch name cannot disagree
//   projected  derived from `typeof project === 'function'`
//   SUPPORTED_RESOURCES  = the routes that have a handler
//   dispatch             = that handler
//
// A projected endpoint with no handler is now unrepresentable rather than
// merely discouraged: it would not be in SUPPORTED_RESOURCES either, so the
// two cannot go out of sync. Adding an endpoint is one row.
//
//   key       camelCase discovery-index key.
//   route     REST path segment; ALSO the dispatcher's resource name.
//   project   (snapshot, ctx) => projection, for endpoints this file answers.
//             Omitted for endpoints the adapters serve themselves (history,
//             strategic-delta, the tech-graph family).
//   example   query string shown by the discovery index.
// ---------------------------------------------------------------------------

import {
  ALIEN_FACTION_ID,
  DEFAULT_OBSERVER_FACTION_ID
} from '../constants.mjs';
import { asArray, sameId } from '../util.mjs';
import { bodyMatches, factionMatches, findAlienFaction } from './common.mjs';
import {
  councilorResourceRow,
  factionResourceRow,
  nationResourceRow,
  researchResourceRows,
  summaryResource
} from './factions.mjs';
import {
  habModuleResourceRow,
  habResourceRow,
  habSiteResourceRow,
  infrastructureResource
} from './habs.mjs';
import {
  arrivalResourceRow,
  fleetResourceRow,
  fleetSummaryProjection,
  friendlyStrengthAtDestination,
  shipResourceRows,
  shipSummaryProjection,
  transfersResource
} from './fleets.mjs';
import {
  constructionResource,
  shipyardResourceRow,
  shipyardStationResourceRow
} from './construction.mjs';
import { productionPlanResource, shipDesignsResource } from './production.mjs';
import { logisticsResource } from './logistics.mjs';
import { miningAnalysisResource, miningProspectsResource } from './mining.mjs';
import { miningExpansionResource } from './miningExpansion.mjs';
import { alienThreatResource } from './alienThreat.mjs';
import { fleetEngagementResource } from './fleetEngagement.mjs';
import { propulsionResource } from './propulsion.mjs';
import { driveExplorerResource } from './driveExplorer.mjs';
import { militaryValueResource } from './militaryValue.mjs';
import { economicValueResource } from './economicValue.mjs';
import { researchRankingResource } from './researchRanking.mjs';
import { buildResearchCategoryBonuses, categoryBonusSummary } from '../researchCategoryBonus.mjs';
import { deltaResource } from './delta.mjs';
import { mobilityResource } from './mobility.mjs';
import { bodyStatusResource, theatersResource } from './theaters.mjs';
import { refitAdvisorResource } from './refitAdvisor.mjs';

const kebab = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// Built from the configured default so the published examples cannot drift
// away from the observer the endpoints actually default to.
const OMNISCIENT = `?observer=${DEFAULT_OBSERVER_FACTION_ID}&mode=omniscient`;
const OMNISCIENT_OWN = `${OMNISCIENT}&faction=${DEFAULT_OBSERVER_FACTION_ID}`;
const OMNISCIENT_ALIEN = `${OMNISCIENT}&faction=${ALIEN_FACTION_ID}`;
const OBSERVER_ONLY = `?observer=${DEFAULT_OBSERVER_FACTION_ID}`;

/** The plain `{ count, items }` envelope most list endpoints return. */
const rows = (items) => ({ count: items.length, items });

// ---------------------------------------------------------------------------
// detail=summary|full
//
// Only `fleets` and `ships` honour it; every other endpoint ignores it, and
// `DETAIL_AWARE_RESOURCES` is what lets a caller (and the discovery index) tell
// the difference instead of guessing that a parameter did something.
// ---------------------------------------------------------------------------

export const DETAIL_LEVELS = Object.freeze(['summary', 'full']);
export const DEFAULT_DETAIL_LEVEL = 'summary';

/** The accept/reject decision, shared so local and hosted cannot drift. */
export const isDetailLevel = (value) => DETAIL_LEVELS.includes(String(value));

/**
 * Absent -> the small default. Present-but-invalid -> null, so each adapter can
 * reject it in its own wording rather than silently answering a different
 * question than the caller asked.
 */
export const parseDetailLevel = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_DETAIL_LEVEL;
  return isDetailLevel(value) ? String(value) : null;
};

const INTEL_ENDPOINTS = Object.freeze([
  {
    key: 'summary',
    example: OMNISCIENT,
    project: (snapshot) => ({ count: null, items: [], ...summaryResource(snapshot) })
  },
  {
    key: 'factions',
    example: OMNISCIENT,
    project: (snapshot, { factionId }) =>
      rows(asArray(snapshot.factions).filter(item => factionMatches(item, factionId)).map(factionResourceRow))
  },
  {
    key: 'nations',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId }) =>
      rows(asArray(snapshot.nations).filter(item => factionMatches(item, factionId)).map(nationResourceRow))
  },
  {
    key: 'councilors',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId, mode }) =>
      rows(asArray(snapshot.councilors).filter(item => factionMatches(item, factionId)).map(item => councilorResourceRow(item, mode)))
  },
  {
    key: 'habs',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.habs).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habResourceRow))
  },
  {
    key: 'habSites',
    example: `${OMNISCIENT}&body=Ceres`,
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.habSites).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habSiteResourceRow))
  },
  {
    key: 'mining',
    example: `${OMNISCIENT}&body=Ceres&sort=water`,
    project: (snapshot, { factionId, body, status, sort }) => {
      const mining = miningAnalysisResource(snapshot, factionId, body, status, sort);
      return { count: mining.items.length, ...mining };
    }
  },
  {
    key: 'fleets',
    example: OMNISCIENT_ALIEN,
    detail: true,
    project: (snapshot, { factionId, body, detail }) => {
      const matching = asArray(snapshot.fleets).filter(item => factionMatches(item, factionId) && bodyMatches(item, body));
      if (detail === 'full') return { ...rows(matching.map(fleetResourceRow)), detail: 'full' };
      return fleetSummaryProjection(matching);
    }
  },
  {
    key: 'ships',
    example: OMNISCIENT_ALIEN,
    detail: true,
    project: (snapshot, { factionId, body, detail }) => {
      if (detail === 'full') return { ...rows(shipResourceRows(asArray(snapshot.fleets), factionId, body)), detail: 'full' };
      return shipSummaryProjection(snapshot.fleets, factionId, body);
    }
  },
  {
    key: 'research',
    example: OMNISCIENT,
    project: (snapshot, { observerId }) => {
      const research = researchResourceRows(snapshot);
      return {
        count: research.rows.length,
        items: research.rows,
        finishedGlobalProjects: research.finishedGlobalProjects,
        // The observer's per-category research bonuses, with every contributing
        // source named. This is the natural home for them: an agent asking
        // "what is the observer researching and how fast" gets both from one
        // call, and the largest single contributor -- alien-activity
        // investigations -- is in no template, so it cannot be reconstructed
        // from anything else on this surface.
        categoryBonuses: categoryBonusSummary(
          buildResearchCategoryBonuses(snapshot, { observerId })
        )
      };
    }
  },
  {
    key: 'capabilities',
    example: OMNISCIENT,
    project: (snapshot) => ({
      count: 0,
      items: [],
      capabilities: snapshot.capabilities || {},
      activeXenoforming: snapshot.activeXenoforming || [],
      builtAlienFacilities: snapshot.builtAlienFacilities || []
    })
  },
  {
    key: 'alien',
    example: OMNISCIENT,
    project: (snapshot, { body, mode }) => {
      const alienFaction = findAlienFaction(snapshot);
      const alienId = alienFaction?.ID;
      // Numeric id equality: a string/number mismatch on `alienId` would return
      // an empty alien dossier that is indistinguishable from "no alien presence".
      const belongsToAliens = (item) => alienFaction != null && sameId(item.factionId, alienId);
      const fleets = asArray(snapshot.fleets).filter(fleet => belongsToAliens(fleet) && bodyMatches(fleet, body));
      const habs = asArray(snapshot.habs).filter(hab => belongsToAliens(hab) && bodyMatches(hab, body));
      const habSites = asArray(snapshot.habSites).filter(site => belongsToAliens(site) && bodyMatches(site, body));
      const councilors = asArray(snapshot.councilors).filter(belongsToAliens);
      return {
        count: councilors.length + fleets.length + habs.length + habSites.length,
        items: [],
        alienFactionResolved: alienFaction != null,
        faction: alienFaction ? factionResourceRow(alienFaction) : null,
        councilors: councilors.map(councilor => councilorResourceRow(councilor, mode)),
        fleets: fleets.map(fleetResourceRow),
        habs: habs.map(habResourceRow),
        habSites: habSites.map(habSiteResourceRow),
        activeXenoforming: snapshot.activeXenoforming || [],
        builtAlienFacilities: snapshot.builtAlienFacilities || []
      };
    }
  },
  {
    key: 'resources',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId }) =>
      rows(asArray(snapshot.factions).filter(item => factionMatches(item, factionId)).map(factionResourceRow))
  },
  {
    key: 'habModules',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.habModules).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habModuleResourceRow))
  },
  {
    key: 'shipyards',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.shipyardStations).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(shipyardStationResourceRow))
  },
  {
    key: 'shipyardQueues',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.shipyardQueues).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(shipyardResourceRow))
  },
  {
    key: 'arrivals',
    example: OMNISCIENT,
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.fleets)
        .filter(item => item.arrivalDate && factionMatches(item, factionId) && bodyMatches(item, body))
        .map(item => arrivalResourceRow(item, friendlyStrengthAtDestination(item, snapshot))))
  },
  {
    key: 'transfers',
    example: `${OMNISCIENT}&destination=Mars`,
    project: (snapshot, { factionId, body, destination }) =>
      rows(transfersResource(snapshot, factionId, body, destination))
  },
  {
    key: 'logistics',
    example: OMNISCIENT,
    project: (snapshot, { observerId }) => {
      const log = logisticsResource(snapshot, observerId);
      return { count: log.resources.length, items: log.resources, ...log };
    }
  },
  {
    key: 'construction',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId, body }) => rows(constructionResource(snapshot, factionId, body))
  },
  {
    key: 'shipDesigns',
    example: OMNISCIENT_OWN,
    project: (snapshot, { factionId }) => rows(shipDesignsResource(snapshot, factionId))
  },
  {
    key: 'theaters',
    example: OMNISCIENT,
    project: (snapshot, { observerId }) => rows(theatersResource(snapshot, observerId))
  },
  {
    key: 'infrastructure',
    example: `${OMNISCIENT}&body=Mars`,
    project: (snapshot, { factionId, body }) => rows(infrastructureResource(snapshot, factionId, body))
  },
  {
    key: 'alienThreat',
    example: OMNISCIENT,
    // The requested mode travels with the query, so the resource can re-apply
    // the redaction rule instead of trusting that the snapshot was scrubbed.
    project: (snapshot, { observerId, mode }) =>
      ({ count: null, items: [], ...alienThreatResource(snapshot, observerId, { mode }) })
  },
  {
    key: 'fleetEngagement',
    example: `${OMNISCIENT}&limit=12`,
    // Per-fleet, reachability-gated hull requirements. Ranked and truncated
    // because 57 rows is not advice; `fleetsTotalCount` / `fleetsOmittedCount`
    // reconcile the cap, and every row is an ESTIMATE, never a measurement.
    project: (snapshot, { observerId, mode, limit }) =>
      fleetEngagementResource(snapshot, { observerId, mode, limit })
  },
  {
    key: 'delta',
    example: OMNISCIENT,
    unsizable: 'size depends on the previous snapshot, which the index does not load',
    project: (snapshot, { observerId, previousSnapshot }) => {
      if (snapshot.changesSincePrevious) {
        return { count: null, items: [], ...snapshot.changesSincePrevious, source: 'published-comparison' };
      }
      return { count: null, items: [], ...deltaResource(snapshot, previousSnapshot, observerId) };
    }
  },
  {
    key: 'mobility',
    example: `${OMNISCIENT}&fleet=<fleetId>`,
    unsizable: 'requires ?fleet=<fleetId>; an unfiltered size would not describe a real request',
    project: (snapshot, { fleetId, observerId }) => {
      const mob = mobilityResource(snapshot, fleetId, observerId);
      return { count: mob.transfers?.length || 0, items: mob.transfers || [], ...mob };
    }
  },
  {
    key: 'productionPlan',
    example: `${OMNISCIENT}&design=playerShipTemplate584&quantity=4`,
    unsizable: 'requires ?design=<designId>; an unfiltered size would not describe a real request',
    project: (snapshot, { designId, quantity, observerId }) =>
      ({ count: null, items: [], ...productionPlanResource(snapshot, designId, quantity, observerId) })
  },
  {
    key: 'bodyStatus',
    example: `${OMNISCIENT}&body=Mars`,
    project: (snapshot, { body, observerId }) =>
      ({ count: null, items: [], ...bodyStatusResource(snapshot, body || 'Mars', observerId) })
  },
  {
    key: 'miningProspects',
    example: `${OMNISCIENT}&theater=belt&limit=10`,
    project: (snapshot, { theater, body, limit, weights }) => {
      const prospects = miningProspectsResource(snapshot, {
        theater: theater || body || null,
        limit,
        weights
      });
      return { count: prospects.ranked.length, items: prospects.ranked, ...prospects };
    }
  },
  {
    key: 'propulsion',
    example: `${OMNISCIENT}&limit=8`,
    project: (snapshot, { observerId, mode, designId, limit }) =>
      propulsionResource(snapshot, { observerId, mode, designId, limit })
  },
  {
    key: 'driveExplorer',
    example: `${OMNISCIENT}&sort=delta-v&status=fittable&limit=25`,
    // Detail-aware for the same reason `military-value` is: the full listing is
    // one row per drive in the whole 541-entry catalogue, and a discovery
    // client cannot choose what to fetch if the big payload is the default.
    // `design` selects the hull, `status` narrows to one availability bucket or
    // state, `family` to one drive classification, and `sort` reorders.
    detail: true,
    // Honours the minimum-threshold filters on its measured columns. Flagged
    // here for the same reason `detail` is: the adapters echo a parameter only
    // where it did something, so the echo never implies a filter that was
    // ignored. `THRESHOLD_AWARE_RESOURCES` is derived from this flag.
    thresholds: true,
    project: (snapshot, { observerId, mode, designId, limit, sort, status, family, thresholds, detail }) =>
      driveExplorerResource(snapshot, { observerId, mode, designId, limit, sort, status, family, thresholds, detail })
  },
  {
    key: 'militaryValue',
    example: `${OMNISCIENT}&family=laser_weapon&detail=full&limit=8`,
    // Detail-aware for the same reason `fleets` and `ships` are: the full
    // seventeen-class candidate listing is a 300 KB response, and a discovery
    // client cannot choose what to fetch if the big payload is the default.
    detail: true,
    project: (snapshot, { observerId, mode, family, limit, detail }) =>
      militaryValueResource(snapshot, { observerId, mode, family, limit, detail })
  },
  {
    key: 'economicValue',
    example: `${OMNISCIENT}&status=researchable-now&detail=full&limit=25`,
    // Detail-aware for the same reason `military-value` is: the full listing
    // carries a per-effect row for every uncompleted node that carries an
    // effect, which is an order of magnitude larger than the summary.
    // `family` narrows to one effect context and `status` to one availability
    // state; both are already parsed by each runtime adapter.
    detail: true,
    project: (snapshot, { observerId, mode, family, status, limit, detail }) =>
      economicValueResource(snapshot, { observerId, mode, family, status, limit, detail })
  },
  {
    key: 'researchRanking',
    example: `${OMNISCIENT}&limit=5`,
    // Detail-aware like the three phases it composes: the default is the head
    // of each availability group, and `detail=full` is every row of every group
    // plus every candidate that could not be ranked.
    detail: true,
    project: (snapshot, { observerId, mode, limit, detail }) =>
      researchRankingResource(snapshot, { observerId, mode, limit, detail })
  },
  {
    key: 'miningExpansion',
    example: `${OMNISCIENT}&theater=belt&limit=10`,
    project: (snapshot, { observerId, theater, body, limit }) => {
      const expansion = miningExpansionResource(snapshot, {
        observerId,
        theater: theater || body || null,
        limit
      });
      return { count: expansion.available.length, items: expansion.available, ...expansion };
    }
  },
  {
    key: 'refitAdvisor',
    example: OMNISCIENT_OWN,
    project: (snapshot, { observerId, mode, designId, limit }) =>
      refitAdvisorResource(snapshot, { observerId, mode, designId, limit })
  },
  // Served by the adapters themselves, not by buildResourceProjection: history
  // and strategic-delta need snapshot storage, and the tech-graph family needs
  // shared/techGraph.mjs plus a published techTree payload.
  { key: 'history', example: '?limit=20' },
  { key: 'strategicDelta', example: OBSERVER_ONLY },
  { key: 'techTree', example: `${OMNISCIENT}&category=all` },
  { key: 'techPath', example: `${OMNISCIENT}&target=Project_RailCannonMk3` },
  { key: 'techSearch', example: `${OMNISCIENT}&q=battlecruiser` },
  { key: 'techMilestones', example: `${OMNISCIENT}&category=ship_hull` },
  { key: 'techMatrix', example: OMNISCIENT },
  { key: 'techOpportunities', example: OMNISCIENT },
  { key: 'researchQueue', example: OMNISCIENT },
  { key: 'latestThreats', path: '/latest-threats.md', example: OBSERVER_ONLY },
  { key: 'latestWarRoom', path: '/latest-war-room.md', example: OBSERVER_ONLY },
  { key: 'latestSnapshot', path: '/latest-snapshot.md', example: OBSERVER_ONLY }
].map(entry => Object.freeze({
  ...entry,
  route: kebab(entry.key),
  projected: typeof entry.project === 'function'
})));

/**
 * Route -> handler. The dispatcher IS this map; there is no second list of
 * resource names to keep in step with it.
 */
const PROJECTION_BY_ROUTE = new Map(
  INTEL_ENDPOINTS.filter(entry => entry.projected).map(entry => [entry.route, entry.project])
);

/** Resource names `buildResourceProjection` understands. */
export const SUPPORTED_RESOURCES = new Set(PROJECTION_BY_ROUTE.keys());

/**
 * Routes that honour `?detail=`, derived from the table's own `detail: true`
 * rather than listed a second time -- the same reason the dispatcher is derived.
 */
export const DETAIL_AWARE_RESOURCES = Object.freeze(
  new Set(INTEL_ENDPOINTS.filter(entry => entry.detail === true).map(entry => entry.route))
);

/**
 * Routes that honour the minimum-threshold filters, derived from the table's own
 * `thresholds: true` for the same reason.
 *
 * Both adapters echo `minDeltaV` and its siblings only for these routes, so the
 * echo cannot imply that a parameter did something on an endpoint that ignored
 * it -- the rule `DETAIL_AWARE_RESOURCES` already exists to enforce for `detail`.
 */
export const THRESHOLD_AWARE_RESOURCES = Object.freeze(
  new Set(INTEL_ENDPOINTS.filter(entry => entry.thresholds === true).map(entry => entry.route))
);

// Public discovery map shared by the local Express API and hosted worker.
// Keep these as path-only links so external analysis clients can discover the
// focused routes before adding observer/mode/faction filters themselves.
export const INTEL_ENDPOINT_INDEX = Object.freeze(
  Object.fromEntries(INTEL_ENDPOINTS.map(entry => [entry.key, entry.path || `/api/intel/${entry.route}`]))
);

export const INTEL_ENDPOINT_EXAMPLES = Object.freeze(
  Object.fromEntries(INTEL_ENDPOINTS.map(entry => [entry.key, entry.example]))
);

// ---------------------------------------------------------------------------
// Response sizes for the discovery index.
//
// `/api/intel` is documented as how an external analysis client discovers the
// route surface, and it pointed at a 909 KB endpoint with no indication that it
// was three orders of magnitude larger than `runtime`. A model-facing client
// cannot choose what to fetch without knowing that.
//
// Every number here is MEASURED -- each projection is run against the snapshot
// the runtime already holds and the result is stringified -- never estimated
// from a row count. An endpoint whose size cannot be measured honestly (it needs
// a required parameter, it needs a second snapshot, or an adapter answers it
// rather than this registry) is OMITTED from the map with its reason recorded
// separately, because a plausible-looking invented byte count is worse than a
// gap the client can see.
// ---------------------------------------------------------------------------

const byteLength = (text) => {
  // `TextEncoder` is available in both Node and the Cloudflare worker; the
  // `.length` fallback under-counts multi-byte characters, so it is only ever
  // reached if a runtime has neither, and the result stays labelled `bytes`.
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return text.length;
};

/**
 * Measures every projected endpoint against `snapshot`, with no filters.
 *
 * No filters is deliberate: the discovery index lists the routes without
 * filters, so the measured size is the size of the request the index actually
 * describes -- and therefore the worst case, which is the useful warning.
 *
 * @returns {{ sizes: Object, unavailable: Object, basis: Object }}
 */
export const measureIntelEndpointSizes = (snapshot, { mode = 'player' } = {}) => {
  const sizes = {};
  const unavailable = {};
  for (const entry of INTEL_ENDPOINTS) {
    if (!entry.projected) {
      unavailable[entry.key] = 'served by the runtime adapter, not by the shared projection registry';
      continue;
    }
    if (entry.unsizable) {
      unavailable[entry.key] = entry.unsizable;
      continue;
    }
    try {
      const projection = buildResourceProjection(snapshot, entry.route, { mode });
      const bytes = byteLength(JSON.stringify(projection));
      const measurement = { bytes, items: Array.isArray(projection?.items) ? projection.items.length : null };
      if (DETAIL_AWARE_RESOURCES.has(entry.route)) {
        measurement.detail = DEFAULT_DETAIL_LEVEL;
        measurement.fullBytes = byteLength(JSON.stringify(
          buildResourceProjection(snapshot, entry.route, { mode, detail: 'full' })
        ));
      }
      sizes[entry.key] = measurement;
    } catch (err) {
      // A projection that throws has no honest size. Say so; do not guess.
      unavailable[entry.key] = `projection failed: ${err.message}`;
    }
  }
  return {
    sizes,
    unavailable,
    basis: {
      measurement: 'measured',
      // Deliberately precise about WHAT was measured: this is the projection
      // payload, not the whole HTTP body. Each runtime wraps it in an identity
      // envelope of roughly 1 KB, so the wire response is a little larger. A
      // description that overstated its own scope would be the same defect
      // class as an estimated number presented as a measurement.
      description: 'Uncompressed bytes of the projection payload for this endpoint with no filters, measured against the snapshot named below. The response envelope adds roughly 1 KB on the wire.',
      mode,
      snapshotId: snapshot?.snapshotId ?? null,
      saveFilename: snapshot?.metadata?.fileName ?? null,
      campaignDate: snapshot?.metadata?.gameTimeString ?? null,
      note: 'A faction or body filter reduces these. Endpoints listed under `unavailable` have no honest measurement and are omitted rather than estimated.'
    }
  };
};

// One pure projection dispatcher is shared by the local Express adapter and
// the hosted worker. The adapters are responsible only for request parsing,
// snapshot retrieval, and response envelopes; resource semantics live here.
export const buildResourceProjection = (snapshot, resource, {
  factionId = null,
  body = null,
  theater = null,
  limit = null,
  destination = null,
  // The unlock family (`laser_weapon`, `ship_hull`, ...) or a weapon class key
  // (`laser_weapon:point-defense`) that `military-value` narrows to, and the
  // effect context (`SpaceMiningBonus`, ...) that `economic-value` narrows to.
  family = null,
  fleetId = null,
  designId = null,
  quantity = 1,
  status = null,
  sort = null,
  // The minimum-threshold filters, RAW as the query string carried them. The
  // shared parser inside the projection decides what a valid minimum is, so the
  // local route and the hosted worker cannot drift on it.
  thresholds = null,
  previousSnapshot = null,
  mode = 'player',
  weights = null,
  detail = DEFAULT_DETAIL_LEVEL
} = {}) => {
  const observerId = snapshot.observerFactionId || DEFAULT_OBSERVER_FACTION_ID;
  const project = PROJECTION_BY_ROUTE.get(resource);
  // An unrecognised resource yields an empty projection, exactly as the former
  // switch statement's `default:` branch did. The HTTP adapters reject unknown
  // routes against SUPPORTED_RESOURCES before reaching this point.
  if (!project) return { count: 0, items: [] };
  return project(snapshot, {
    observerId,
    factionId,
    body,
    theater,
    limit,
    destination,
    family,
    fleetId,
    designId,
    quantity,
    status,
    sort,
    thresholds,
    previousSnapshot,
    mode,
    weights,
    detail
  });
};
