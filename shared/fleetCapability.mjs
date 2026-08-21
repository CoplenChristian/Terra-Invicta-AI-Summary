/**
 * Fleet capability: the measured comparison between the observer's force and
 * the aliens', and the dominant capability deficit that follows from it.
 *
 * EXTRACTED FROM server/directiveAdvisor.js, 2026-08-21, unchanged. It moved
 * here because two consumers now need the SAME answer and a second derivation
 * of "which axis is the gap" would be a second opinion, not a second caller:
 *
 *   - the Hold Ground directive (server/directiveAdvisor.js), which requires
 *     this module and re-exports it, so its callers and tests are unaffected;
 *   - /api/intel/research-ranking (shared/intel/researchRanking.mjs), whose
 *     military ordering puts the deficit-closing candidates first.
 *
 * The second consumer is why this is plain ESM with no Node built-ins: the
 * hosted Cloudflare worker cannot require CommonJS, and the intel projections
 * run there. server/directiveAdvisor.js already requires shared/util.mjs the
 * same way.
 */

import { toFiniteNumber, sameId } from './util.mjs';

/**
 * Capability axes for the "can this fleet contest an engagement" comparison,
 * in tie-break order.
 *
 * `combatPower` is deliberately absent: every fleet in every mode reports
 * `combatPowerSource: "not present in save"` and `combatPowerAvailable: false`,
 * so building on it would be building on nothing. Each axis below is read
 * straight off the snapshot and is populated for both sides in both modes.
 *
 * Delta-V leads because it is the only axis that decides whether a battle
 * happens at all: at a large enough gap the faster force picks every
 * engagement and disengages at will, so the slower force can neither force nor
 * refuse a fight. Armour decides who survives the fight that does happen.
 * Hull count is last -- it is real, but it is also the axis that most
 * overstates strength, which is why it was the wrong test on its own.
 */
export const CAPABILITY_AXES = Object.freeze([
  Object.freeze({
    key: 'deltaV',
    label: 'delta-V',
    unit: 'km/s',
    remedyKind: 'research',
    remedyLabel: 'drive and propulsion research',
    deficitMeaning: 'the aliens choose every engagement and disengage at will'
  }),
  Object.freeze({
    key: 'armor',
    label: 'armour',
    unit: 'cm',
    remedyKind: 'research',
    remedyLabel: 'armour and materials research',
    deficitMeaning: 'alien hulls survive our fire while ours do not survive theirs'
  }),
  Object.freeze({
    key: 'ships',
    label: 'hull count',
    unit: 'ships',
    remedyKind: 'production',
    remedyLabel: 'hull production and shipyard throughput',
    deficitMeaning: 'the aliens can trade hulls at a rate we cannot match'
  })
]);

// How lopsided a single axis has to be before the fleet is judged unable to
// contest. JUDGEMENT CALL, not a game constant -- the templates do not publish
// a "you lose" ratio. Three-to-one is the classic force-ratio rule of thumb for
// an attacker who is free to concentrate; it is recorded here rather than
// buried in a rule body so a future calibration pass touches one line. Because
// it applies per axis, a decisive deficit anywhere is enough: being out-ranged
// is not cancelled by having more hulls.
export const DECISIVE_CAPABILITY_RATIO = 3;

/**
 * Is this the alien faction?
 *
 * The save calls this faction "the Aliens"; the template's friendlyName is
 * "Hydras". Match the template first so a localisation change cannot silently
 * drop the alien faction out of the fleet comparison.
 *
 * This predicate is the one `classifyProxy` in server/directiveAdvisor.js
 * uses for its own alien branch, so the two cannot disagree about who the
 * aliens are.
 */
export function isAlienFaction(faction = {}) {
  const template = String(faction.templateName || '').trim().toLowerCase();
  const name = String(faction.displayName || faction.name || '').trim().toLowerCase();
  return template === 'aliencouncil'
    || faction.isAlien === true
    || /^the aliens$/.test(name)
    || name === 'aliens'
    || name === 'hydras';
}

export function countShips(observer = {}, factions = [], fleets = []) {
  const ownFromFleets = Array.isArray(fleets)
    ? fleets
      .filter((fleet) => sameId(fleet.factionId, observer.ID))
      .reduce((sum, fleet) => {
        const count = toFiniteNumber(fleet.shipsCount);
        if (count === null) return sum;
        return (sum === null ? 0 : sum) + count;
      }, null)
    : null;
  const ownShips = toFiniteNumber(observer.shipsCount) ?? ownFromFleets;
  const ownFleets = toFiniteNumber(observer.fleetsCount)
    ?? (Array.isArray(fleets)
      ? fleets.filter((fleet) => sameId(fleet.factionId, observer.ID)).length
      : null);

  const aliens = (Array.isArray(factions) ? factions : []).find((faction) => {
    return isAlienFaction(faction);
  });
  // Mirror the own-ship reduce: a fleet whose size we cannot read must not be
  // silently counted as zero, or an unscouted alien force reads as a weak one
  // and the fragility check quietly inverts.
  const alienFromFleets = aliens && Array.isArray(fleets)
    ? fleets
      .filter((fleet) => sameId(fleet.factionId, aliens.ID))
      .reduce((sum, fleet) => {
        const count = toFiniteNumber(fleet.shipsCount);
        if (count === null) return sum;
        return (sum === null ? 0 : sum) + count;
      }, null)
    : null;
  const alienShips = toFiniteNumber(aliens?.shipsCount)
    ?? (alienFromFleets !== null && alienFromFleets > 0 ? alienFromFleets : null);

  return {
    ownShips: toFiniteNumber(ownShips),
    ownFleets: toFiniteNumber(ownFleets),
    alienShips: toFiniteNumber(alienShips)
  };
}

/** Median of the finite entries, or null when nothing is measurable. */
export function medianOf(values) {
  const measured = (Array.isArray(values) ? values : [])
    .map(toFiniteNumber)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (measured.length === 0) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 === 1
    ? measured[middle]
    : (measured[middle - 1] + measured[middle]) / 2;
}

export function findAlienFaction(factions = []) {
  return (Array.isArray(factions) ? factions : [])
    .find((faction) => isAlienFaction(faction)) || null;
}

/**
 * Median armour across a side's ships. Per-ship `armorMedian` first, because a
 * median of fleet-level medians throws away how many hulls each fleet holds;
 * the fleet-level field is the fallback for a snapshot that carries fleets
 * without their ship lists.
 */
export function medianArmour(fleets) {
  const perShip = fleets.flatMap((fleet) => (Array.isArray(fleet.ships) ? fleet.ships : [])
    .map((ship) => ship?.armorMedian));
  const shipMedian = medianOf(perShip);
  if (shipMedian !== null) return { value: shipMedian, basis: 'per-ship armorMedian' };
  const fleetMedian = medianOf(fleets.map((fleet) => fleet.armorMedian));
  if (fleetMedian !== null) return { value: fleetMedian, basis: 'fleet-level armorMedian' };
  return { value: null, basis: null };
}

/**
 * Median delta-V across a side's fleets. `lowestDeltaVKps` is the fleet's own
 * binding constraint (a fleet moves at the pace of its slowest ship), which is
 * the figure that decides whether it can reach or refuse an engagement.
 */
export function medianDeltaV(fleets) {
  const fleetMedian = medianOf(fleets.map((fleet) => fleet.lowestDeltaVKps));
  if (fleetMedian !== null) return { value: fleetMedian, basis: 'fleet lowestDeltaVKps' };
  const perShip = fleets.flatMap((fleet) => (Array.isArray(fleet.ships) ? fleet.ships : [])
    .map((ship) => ship?.currentMaxDeltaVKps));
  const shipMedian = medianOf(perShip);
  if (shipMedian !== null) return { value: shipMedian, basis: 'per-ship currentMaxDeltaVKps' };
  return { value: null, basis: null };
}

export function dominantWeaponOf(fleets) {
  const counts = new Map();
  for (const fleet of fleets) {
    const type = fleet?.dominantWeaponType;
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
}

/**
 * Can this fleet contest an engagement with the aliens?
 *
 * Returns `true` | `false` | `'unknown'`, never a boolean that quietly folds
 * the third state into "fine". Three measured axes are compared; each is
 * skipped, with the exclusion named, when either side's figure is absent.
 *
 * THE FAILURE MODE THIS GUARDS: alien fleets reach a player-mode snapshot only
 * through a detection capability (the live save carries
 * `visibility: "Deep System Skywatch"` on every alien fleet). With no such
 * capability there are no alien fleets in the snapshot at all -- and an empty
 * sky because you cannot see is not an empty sky. Zero observed alien force
 * therefore resolves to 'unknown', never to "no threat". Reading it the other
 * way round would tell a blind player they are safe.
 */
export function summarizeFleetCapability({ observer = {}, factions = [], fleets = [], ships = null } = {}) {
  const counted = ships || countShips(observer, factions, fleets);
  const fleetList = Array.isArray(fleets) ? fleets : [];
  const fleetsProvided = Array.isArray(fleets);
  const alienFaction = findAlienFaction(factions);
  const ownFleets = fleetList.filter((fleet) => sameId(fleet.factionId, observer.ID));
  const alienFleets = alienFaction
    ? fleetList.filter((fleet) => sameId(fleet.factionId, alienFaction.ID))
    : [];

  // Which detection capability put those alien fleets on the board. Player mode
  // stamps it on each fleet; omniscient has nothing to attribute, so absent
  // here means "not applicable", not "no capability".
  const detectionSources = [...new Set(alienFleets
    .map((fleet) => fleet.visibility)
    .filter((value) => typeof value === 'string' && value.trim() !== ''))];

  const ownArmour = medianArmour(ownFleets);
  const alienArmour = medianArmour(alienFleets);
  const ownDeltaV = medianDeltaV(ownFleets);
  const alienDeltaV = medianDeltaV(alienFleets);

  const raw = {
    deltaV: { own: ownDeltaV.value, alien: alienDeltaV.value, basis: alienDeltaV.basis || ownDeltaV.basis },
    armor: { own: ownArmour.value, alien: alienArmour.value, basis: alienArmour.basis || ownArmour.basis },
    ships: { own: counted.ownShips, alien: counted.alienShips, basis: 'shipsCount' }
  };

  const axes = [];
  const excluded = [];
  for (const axis of CAPABILITY_AXES) {
    const { own, alien, basis } = raw[axis.key];
    if (own === null || alien === null) {
      excluded.push({
        key: axis.key,
        label: axis.label,
        reason: own === null && alien === null
          ? `${axis.label} is not measurable for either side in this snapshot`
          : own === null
            ? `our own ${axis.label} is not measurable in this snapshot`
            : `alien ${axis.label} is not measurable in this snapshot`
      });
      continue;
    }
    // A side with zero hulls has no ratio, but it is not "unmeasured" either --
    // it is the most decisive reading there is. Keep ratio null so nothing
    // downstream prints Infinity, and carry the verdict separately.
    const ownAbsent = own === 0;
    const ratio = ownAbsent || alien === 0 ? null : alien / own;
    const decisive = ownAbsent
      ? alien > 0
      : ratio !== null && ratio >= DECISIVE_CAPABILITY_RATIO;
    axes.push({
      key: axis.key,
      label: axis.label,
      unit: axis.unit,
      own,
      alien,
      ratio,
      decisive,
      basis,
      remedyKind: axis.remedyKind,
      remedyLabel: axis.remedyLabel,
      deficitMeaning: axis.deficitMeaning,
      text: ownAbsent
        ? `no own ${axis.label} at all against ${formatAxisValue(alien, axis.unit)} alien`
        : `${formatAxisValue(own, axis.unit)} ours vs ${formatAxisValue(alien, axis.unit)} alien`
        + (ratio === null ? '' : ` (${ratio.toFixed(1)}x)`)
    });
  }

  // Positive evidence that there is an alien force to compare against, from
  // either source: fleets we can actually see, or a faction-level ship count
  // the snapshot reports. Neither one present means the comparison had no
  // denominator, which is 'unknown'.
  const alienForceObserved = alienFleets.length > 0
    || (counted.alienShips !== null && counted.alienShips > 0);

  const decisiveAxes = axes.filter((axis) => axis.decisive);
  // Rank by measured ratio, largest gap first, so the recommendation follows
  // the evidence rather than a fixed opinion about which axis matters. A
  // no-hulls-at-all axis outranks any finite ratio.
  const rankedDeficits = [...decisiveAxes].sort((left, right) => {
    const leftRatio = left.ratio === null ? Infinity : left.ratio;
    const rightRatio = right.ratio === null ? Infinity : right.ratio;
    if (rightRatio !== leftRatio) return rightRatio - leftRatio;
    return CAPABILITY_AXES.findIndex((a) => a.key === left.key)
      - CAPABILITY_AXES.findIndex((a) => a.key === right.key);
  });

  let canContest;
  let verdictReason;
  if (!alienForceObserved) {
    canContest = 'unknown';
    verdictReason = fleetsProvided && alienFaction
      ? 'No alien fleet is visible in this snapshot. Alien fleets appear only through a '
        + 'detection capability, so zero sightings means the comparison could not be made — '
        + 'not that the sky is empty.'
      : 'This snapshot carries no observable alien force, so the fleet comparison could not be made.';
  } else if (axes.length === 0) {
    canContest = 'unknown';
    verdictReason = 'None of the capability axes could be read for both sides, so the fleet '
      + 'comparison could not be made.';
  } else if (rankedDeficits.length > 0) {
    canContest = false;
    const top = rankedDeficits[0];
    verdictReason = `Decisive deficit on ${rankedDeficits.map((axis) => axis.label).join(', ')}`
      + ` at or beyond ${DECISIVE_CAPABILITY_RATIO}x. Widest gap: ${top.label} — ${top.text}.`;
  } else {
    canContest = true;
    verdictReason = `No measured axis reaches the ${DECISIVE_CAPABILITY_RATIO}x decisive gap `
      + `(${axes.map((axis) => `${axis.label} ${axis.ratio === null ? 'n/a' : `${axis.ratio.toFixed(1)}x`}`).join(', ')}).`;
  }

  return {
    canContest,
    verdictReason,
    decisiveRatio: DECISIVE_CAPABILITY_RATIO,
    axes,
    excludedAxes: excluded,
    rankedDeficits,
    dominantDeficit: rankedDeficits[0] || null,
    alienForceObserved,
    ownFleetsVisible: fleetsProvided ? ownFleets.length : null,
    alienFleetsVisible: fleetsProvided ? alienFleets.length : null,
    detectionSources,
    ownDominantWeaponType: dominantWeaponOf(ownFleets),
    alienDominantWeaponType: dominantWeaponOf(alienFleets),
    // Recorded so a reader can see WHY combatPower is not in this comparison
    // rather than wondering whether it was forgotten.
    combatPowerExcluded: 'combatPower is absent from the save for every fleet in every mode '
      + '(combatPowerAvailable: false, combatPowerSource: "not present in save").'
  };
}

export function formatAxisValue(value, unit) {
  if (value === null || value === undefined) return 'UNAVAILABLE';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}
