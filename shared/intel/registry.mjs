// shared/intel/registry.mjs
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
  friendlyStrengthAtDestination,
  shipResourceRows,
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
import { deltaResource } from './delta.mjs';
import { mobilityResource } from './mobility.mjs';
import { bodyStatusResource, theatersResource } from './theaters.mjs';

const kebab = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// Built from the configured default so the published examples cannot drift
// away from the observer the endpoints actually default to.
const OMNISCIENT = `?observer=${DEFAULT_OBSERVER_FACTION_ID}&mode=omniscient`;
const OMNISCIENT_OWN = `${OMNISCIENT}&faction=${DEFAULT_OBSERVER_FACTION_ID}`;
const OMNISCIENT_ALIEN = `${OMNISCIENT}&faction=${ALIEN_FACTION_ID}`;
const OBSERVER_ONLY = `?observer=${DEFAULT_OBSERVER_FACTION_ID}`;

/** The plain `{ count, items }` envelope most list endpoints return. */
const rows = (items) => ({ count: items.length, items });

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
    project: (snapshot, { factionId, body }) =>
      rows(asArray(snapshot.fleets).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(fleetResourceRow))
  },
  {
    key: 'ships',
    example: OMNISCIENT_ALIEN,
    project: (snapshot, { factionId, body }) => rows(shipResourceRows(asArray(snapshot.fleets), factionId, body))
  },
  {
    key: 'research',
    example: OMNISCIENT,
    project: (snapshot) => {
      const research = researchResourceRows(snapshot);
      return { count: research.rows.length, items: research.rows, finishedGlobalProjects: research.finishedGlobalProjects };
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
    key: 'delta',
    example: OMNISCIENT,
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
    project: (snapshot, { fleetId, observerId }) => {
      const mob = mobilityResource(snapshot, fleetId, observerId);
      return { count: mob.transfers?.length || 0, items: mob.transfers || [], ...mob };
    }
  },
  {
    key: 'productionPlan',
    example: `${OMNISCIENT}&design=playerShipTemplate584&quantity=4`,
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
  { key: 'researchQueue', example: OMNISCIENT }
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

// Public discovery map shared by the local Express API and hosted worker.
// Keep these as path-only links so external analysis clients can discover the
// focused routes before adding observer/mode/faction filters themselves.
export const INTEL_ENDPOINT_INDEX = Object.freeze(
  Object.fromEntries(INTEL_ENDPOINTS.map(entry => [entry.key, `/api/intel/${entry.route}`]))
);

export const INTEL_ENDPOINT_EXAMPLES = Object.freeze(
  Object.fromEntries(INTEL_ENDPOINTS.map(entry => [entry.key, entry.example]))
);

// One pure projection dispatcher is shared by the local Express adapter and
// the hosted worker. The adapters are responsible only for request parsing,
// snapshot retrieval, and response envelopes; resource semantics live here.
export const buildResourceProjection = (snapshot, resource, {
  factionId = null,
  body = null,
  theater = null,
  limit = null,
  destination = null,
  fleetId = null,
  designId = null,
  quantity = 1,
  status = null,
  sort = null,
  previousSnapshot = null,
  mode = 'player',
  weights = null
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
    fleetId,
    designId,
    quantity,
    status,
    sort,
    previousSnapshot,
    mode,
    weights
  });
};
