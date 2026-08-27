// shared/intel/destinations.mjs
//
// Purpose: resolve a fleet's stated destination — a hab, an orbit or another
//   fleet — down to the body it actually sits at, so a body-keyed board can
//   match on the body instead of on the destination's literal name.
//
// WHY THIS EXISTS
// ---------------
// `shared/intel/theaters.mjs` answered "is a hostile fleet inbound to this
// body?" with `normalizeBody(transfer.destination) === body`. That is a literal
// name test, and a save's destinations are mostly NOT body names. Measured
// against the live save (CombatAutosave.gz, 12/18/2041) on 2026-08-26, of the
// 18 fleets in transit:
//
//   destinationType   count   example                   matches a body name?
//   fleet                 7   "Victor-771"              no
//   orbit                 6   "Triton orbit"            no
//   hab                   5   "Iron Fortress Station"   no
//
// All eighteen failed the literal test, so every theater reported
// `incoming.hostileShips: 0`. Those zeros were honest -- the filter did exactly
// what it said -- but they were also the only answer that filter could ever
// give, which is the more dangerous property.
//
// THREE RESOLUTIONS, AND WHAT EACH RESTS ON
//   hab    -- the destination hab's own `orbitBody`. "Antiochus Station" orbits
//             Earth; "Iron Fortress Station" orbits 16 Psyche.
//   orbit  -- the save's own "<Body> orbit" naming. "Triton orbit" -> Triton.
//   fleet  -- a rendezvous, which has a body only if the TARGET fleet's own
//             position has one. A target that is itself in transit is followed
//             up to FLEET_CHAIN_MAX_HOPS; a loop or an over-long chain is
//             reported unresolved rather than guessed at.
//
// WHAT IT REFUSES TO DO. A destination it cannot resolve comes back
// `resolved: false` with a `reason`, never as a body named after the raw
// string. That matters most in player mode, where the destination hab or fleet
// may simply not be in the observer's view: "not observed", "orbits nothing"
// and "arriving at a body called Canaveral Station" are three different claims
// and only the first two are ever true.
//
// Identity is never keyed on an absent or duplicated name either. Three fleets
// in the live save carry an empty `displayName` -- `String(undefined)` as a Map
// key is the collision that once collapsed 303 candidates to 1 -- and a name
// shared by two records resolves to `ambiguous`, not to whichever happened to
// be indexed first.
//
// Like every module under `shared/`, plain ESM with no Node built-ins, so the
// hosted Cloudflare worker can import it unchanged.

import { asArray, looksUnresolved, toFiniteNumber } from '../util.mjs';
import { normalizeBody } from './common.mjs';

/**
 * How a destination was resolved, in the reported payload's own wording.
 *
 * `unresolved` is a first-class outcome, not an error: a consumer must be able
 * to tell "this fleet is going to 16 Psyche" from "this fleet's destination is
 * not something this observer can see", and neither of those is a body.
 */
export const DESTINATION_RESOLUTION = Object.freeze({
  body: 'body',
  orbit: 'orbit-suffix',
  hab: 'hab',
  fleet: 'fleet',
  unresolved: 'unresolved'
});

/**
 * How far a fleet-to-fleet rendezvous chain is followed before it is called
 * unresolved.
 *
 * A judgement call, not a game rule. No chain longer than one hop exists in the
 * live save (all seven fleet-destination targets are `stationary`), so this is
 * a guard against a pathological save rather than a tuned parameter. An
 * over-long chain reports unresolved; it never reports the last body it
 * happened to touch.
 */
export const FLEET_CHAIN_MAX_HOPS = 4;

/**
 * The literal stand-in `transfersResource` (shared/intel/fleets.mjs) writes
 * when a moving fleet carries no destination at all. It is that projection's
 * word for "unknown", so reading it as a place name would invent a body called
 * "In Transit" and file a fleet as arriving there.
 */
const TRANSFER_DESTINATION_PLACEHOLDER = 'in transit';

const ORBIT_SUFFIX = /^(.*\S)\s+orbit$/i;

const idKey = (value) => {
  if (looksUnresolved(value)) return null;
  const numeric = toFiniteNumber(value);
  // Numeric normalisation so `4712` and `'4712'` land on one key, matching
  // `sameId`'s first rule. Anything non-numeric keys on its own string.
  return numeric === null ? String(value) : String(numeric);
};

const nameKey = (value) => (looksUnresolved(value) ? null : String(value).trim().toLowerCase());

const trimmed = (value) => String(value ?? '').trim();

const indexRecords = (records) => {
  const byId = new Map();
  const byName = new Map();
  for (const record of asArray(records)) {
    const id = idKey(record?.ID);
    if (id !== null && !byId.has(id)) byId.set(id, record);
    const name = nameKey(record?.displayName);
    if (name === null) continue;
    const seen = byName.get(name);
    // A repeated name is counted, not overwritten: the second record does not
    // silently win, and the lookup below refuses to pick between them.
    if (seen) seen.count += 1;
    else byName.set(name, { record, count: 1 });
  }
  return { byId, byName };
};

/**
 * The hab and fleet lookups a resolution needs, built once per snapshot.
 *
 * Built from the snapshot the caller was handed, so a player-mode board indexes
 * only what the observer can see and an unobservable destination correctly
 * fails to resolve instead of leaking a body name out of the omniscient set.
 */
export const buildDestinationIndex = (snapshot) => ({
  habs: indexRecords(snapshot?.habs),
  fleets: indexRecords(snapshot?.fleets)
});

const lookup = (index, id, name, label) => {
  const key = idKey(id);
  if (key !== null) {
    const hit = index?.byId?.get(key);
    if (hit) return { record: hit, matchedOn: 'id', reason: null };
  }
  const nkey = nameKey(name);
  if (nkey === null) {
    return { record: null, matchedOn: null, reason: `${label} destination carries neither a usable id nor a usable name` };
  }
  const entry = index?.byName?.get(nkey);
  if (!entry) {
    const idNote = key === null ? '' : ` (id ${key})`;
    return { record: null, matchedOn: null, reason: `${label} "${trimmed(name)}"${idNote} is not in the observed ${label} list` };
  }
  if (entry.count > 1) {
    return {
      record: null,
      matchedOn: null,
      reason: `${label} name "${trimmed(name)}" is shared by ${entry.count} records; which one was meant is not on record`
    };
  }
  return { record: entry.record, matchedOn: 'name', reason: null };
};

const unresolvedTo = (reason, via = []) => Object.freeze({
  resolved: false,
  body: null,
  normalizedBody: null,
  method: DESTINATION_RESOLUTION.unresolved,
  reason,
  via
});

const resolvedTo = (body, method, via) => {
  const label = trimmed(body);
  const normalized = normalizeBody(label);
  // `normalizeBody` strips a leading numeric prefix, so a body named only by a
  // number ("433") normalises to the empty string. An empty match key would
  // equal nothing and read as a clean resolution, so it is refused.
  if (!normalized) return unresolvedTo(`the resolved destination "${label}" does not normalise to a body name`, via);
  return Object.freeze({ resolved: true, body: label, normalizedBody: normalized, method, reason: null, via });
};

const stripOrbitSuffix = (value) => {
  const match = ORBIT_SUFFIX.exec(trimmed(value));
  return match ? match[1] : null;
};

/**
 * Resolve one `{ destination, destinationType, destinationId }` to a body.
 *
 * `state` is the recursion's own bookkeeping (`seenFleets`, `hops`, `via`) and
 * callers leave it alone.
 */
export const resolveDestinationBody = (descriptor, index, state) => {
  const seenFleets = state?.seenFleets ?? new Set();
  const hops = state?.hops ?? 0;
  const via = state?.via ?? [];

  const rawName = trimmed(descriptor?.destination);
  if (!rawName) return unresolvedTo('no destination on record', via);
  if (rawName.toLowerCase() === TRANSFER_DESTINATION_PLACEHOLDER) {
    return unresolvedTo('the transfers projection reports this destination as unknown ("In Transit")', via);
  }

  const type = trimmed(descriptor?.destinationType).toLowerCase();

  if (type === 'hab') {
    const found = lookup(index?.habs, descriptor?.destinationId, rawName, 'hab');
    if (!found.record) return unresolvedTo(found.reason, via);
    const hop = `hab "${trimmed(found.record.displayName) || rawName}" (matched on ${found.matchedOn})`;
    if (looksUnresolved(found.record.orbitBody)) {
      return unresolvedTo(`hab "${rawName}" carries no orbit body on record`, [...via, hop]);
    }
    return resolvedTo(found.record.orbitBody, DESTINATION_RESOLUTION.hab,
      [...via, `${hop} orbits ${trimmed(found.record.orbitBody)}`]);
  }

  if (type === 'fleet') {
    const found = lookup(index?.fleets, descriptor?.destinationId, rawName, 'fleet');
    if (!found.record) return unresolvedTo(found.reason, via);
    const target = found.record;
    const targetName = trimmed(target.displayName) || rawName;
    const targetKey = idKey(target.ID) ?? (nameKey(target.displayName) === null ? null : `name:${nameKey(target.displayName)}`);
    if (targetKey !== null && seenFleets.has(targetKey)) {
      return unresolvedTo(`the rendezvous chain loops back to fleet "${targetName}"`, via);
    }
    const hop = `fleet "${targetName}" (matched on ${found.matchedOn})`;
    const targetMoving = !looksUnresolved(target.destination) &&
      trimmed(target.destinationType).toLowerCase() !== 'stationary';
    if (targetMoving) {
      if (hops + 1 > FLEET_CHAIN_MAX_HOPS) {
        return unresolvedTo(`the rendezvous chain is longer than ${FLEET_CHAIN_MAX_HOPS} hops`,
          [...via, `${hop} is itself in transit`]);
      }
      const nextSeen = new Set(seenFleets);
      if (targetKey !== null) nextSeen.add(targetKey);
      return resolveDestinationBody(
        { destination: target.destination, destinationType: target.destinationType, destinationId: target.destinationId },
        index,
        { seenFleets: nextSeen, hops: hops + 1, via: [...via, `${hop} is itself in transit to ${trimmed(target.destination)}`] }
      );
    }
    if (looksUnresolved(target.orbitBody)) {
      return unresolvedTo(`fleet "${targetName}" has no orbit body on record`, [...via, hop]);
    }
    return resolvedTo(target.orbitBody, DESTINATION_RESOLUTION.fleet,
      [...via, `${hop} is at ${trimmed(target.orbitBody)}`]);
  }

  // `orbit`, `body`, `stationary`, an empty type, or a type this resolver does
  // not model. All of them fall back to reading the destination as a place
  // name -- the behaviour the theater board had before this module -- but an
  // unmodelled type says so in `via` rather than passing silently.
  const noted = (type && type !== 'orbit' && type !== 'body' && type !== 'stationary')
    ? [...via, `destinationType "${type}" is not one this resolver models; read as a body name`]
    : via;
  const stripped = stripOrbitSuffix(rawName);
  if (stripped) {
    return resolvedTo(stripped, DESTINATION_RESOLUTION.orbit, [...noted, `"${rawName}" names the orbit of ${stripped}`]);
  }
  return resolvedTo(rawName, DESTINATION_RESOLUTION.body, noted);
};

/**
 * Resolve one row of `transfersResource` to the body it is actually headed for.
 *
 * The transfers projection carries `destinationType` but NOT `destinationId`,
 * and `/api/intel/transfers` is not this change's payload to alter -- so the
 * originating fleet is looked up by `fleetId` to recover the id the save
 * actually stores, and the transfer row's own `destination` /
 * `destinationType` are the fallback when that fleet is not in view.
 *
 * The origin fleet seeds the cycle guard, so an A -> B -> A rendezvous is
 * reported as a loop rather than followed forever.
 */
export const resolveTransferDestination = (transfer, index) => {
  const originKey = idKey(transfer?.fleetId);
  const origin = originKey === null ? null : (index?.fleets?.byId?.get(originKey) ?? null);
  const seenFleets = new Set();
  if (originKey !== null) seenFleets.add(originKey);
  return resolveDestinationBody(
    {
      destination: origin?.destination ?? transfer?.destination,
      destinationType: origin?.destinationType ?? transfer?.destinationType,
      destinationId: origin?.destinationId ?? null
    },
    index,
    { seenFleets, hops: 0, via: [] }
  );
};
