/**
 * Campaign-aware ranking for Mission Control action suggestions.
 *
 * Sources, kept separate on purpose:
 * - Notion 02: expand aggressively, interdict early, escalate late. Fleet
 *   count is not combat capability; the live question is whether we can
 *   survive the retaliation cycle.
 * - Notion 07: war meter 50 / 5 diamonds; every hate modifier × 0.8–1.2;
 *   never present a hate delta as an exact number.
 * - Notion 09: Defend Interests (not "Protect Interests"); Purge takes
 *   rival CPs; majors matter more than nation count.
 * - Official wiki, Diplomacy § "Pro-Alien Hate Sharing" (revision
 *   2026-08-11, i.e. post-1.0), read as raw wikitext because the section
 *   sits inside a {{SpoilerBox}} that never expands in the DOM. It gives
 *   the proxy shares below, and states that sharing applies ONLY to hate
 *   gained through action -- passive drift, hate lost to trade, and hate
 *   moved by a changing minimum/maximum are never shared.
 * - TIMissionTemplate.json success slot (index 4): Crackdown 2, Purge 5,
 *   Sabotage Facilities 3, Public Campaign 0, Defend Interests 0.
 * - Same wiki page: the alien war threshold is always 50, and Total War
 *   needs >=200 hate AND >=N years, after which venting is so restricted
 *   that the war is effectively permanent.
 */

const {
  ALIEN_HATE_WAR_THRESHOLD,
  ALIEN_TOTAL_WAR_HATE
} = require('./alienHateEconomics');
const { SERVANTS_DISPLAY_NAME } = require('../shared/constants.mjs');
const { toFiniteNumber, sameId, ONE_TRILLION } = require('../shared/util.mjs');

// Wiki, Diplomacy § Pro-Alien Hate Sharing:
//   Servants gain hate -> aliens gain that/4 when the Servants can contact
//   the aliens, and that/8 when they cannot.
//   Protectorate -> aliens gain that/10, and ONLY while the Protectorate can
//   contact the aliens; with no contact the aliens gain nothing at all.
//
// "Can contact" means the faction has researched Hydra Diplomacy, or has
// unlocked but not completed the Contact The Aliens objective. Both are
// faction projects, and a snapshot only ever exposes a handful of an enemy
// faction's completed projects (5 visible, against 131 for our own). Contact
// state is therefore normally UNKNOWN, so the share is carried as a range and
// only collapsed to a point when the save actually shows the project.
const PROXY_ALIEN_HATE_SHARE = Object.freeze({
  servants: Object.freeze({ contact: 0.25, noContact: 0.125 }),
  protectorate: Object.freeze({ contact: 0.1, noContact: 0 })
});

// Project that proves a proxy faction can talk to the aliens. Its absence
// proves nothing, because enemy project lists are intelligence-limited.
const ALIEN_CONTACT_PROJECT = 'Project_HydraDiplomacy';

const HATE_DELTA_VARIANCE = 0.2;

const MISSION_SUCCESS_HATE = Object.freeze({
  Crackdown: 2,
  Purge: 5,
  'Crackdown / Purge': 5,
  'Sabotage Facilities': 3,
  'Public Campaign': 0,
  'Defend Interests': 0,
  // Verified 0 in TIMissionTemplate (all six outcome slots). Listed explicitly
  // because a hold has to be able to NAME the work that stays available: an
  // Advise that reads as "hate UNAVAILABLE" cannot be recommended during a
  // hold, even though its hate is measurably nothing.
  Advise: 0
});

const PROXY_OFFENSIVE_MISSIONS = new Set([
  'Crackdown',
  'Purge',
  'Crackdown / Purge',
  'Sabotage Facilities',
  'Crackdown / Sabotage'
]);

const FRAGILE_OWN_SHIPS = 30;
const FRAGILE_OWN_VS_ALIEN = 0.2;
const HATE_ELEVATED_PIPS = 4;
const HATE_HOT_PIPS = 5;

// Cheapest hate-generating mission in the local template table, taken at the
// LOW end of the game's 0.8-1.2 roll on every applied hate modifier. This is
// the measured answer to "how little hate can I still afford before the next
// action crosses the war threshold" -- 0.44 of headroom does not survive a
// Crackdown whose worst case is +1.6.
const CHEAPEST_HATE_ACTION = Math.min(
  ...Object.values(MISSION_SUCCESS_HATE).filter((value) => value > 0)
);
const CHEAPEST_HATE_ACTION_LOW = CHEAPEST_HATE_ACTION * (1 - HATE_DELTA_VARIANCE);

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
const CAPABILITY_AXES = Object.freeze([
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
const DECISIVE_CAPABILITY_RATIO = 3;

// Hate at which Total War stops being a distant risk and starts being the
// thing to plan around. Anchored on the war threshold rather than picked:
// 200 - 50 = 150 leaves exactly one war-threshold of headroom, and Total War
// is the one hate transition that cannot be undone -- past it, venting is so
// restricted that the war is effectively permanent. That asymmetry is why
// this gate does not care how strong the fleet is.
const TOTAL_WAR_APPROACH_HATE = ALIEN_TOTAL_WAR_HATE - ALIEN_HATE_WAR_THRESHOLD;

// Total War needs BOTH >= ALIEN_TOTAL_WAR_HATE hate AND >= N elapsed campaign
// years (Normal 20, Veteran 10, Cinematic 25, Brutal 0, each divided by Alien
// Progression Speed). Hate is only half the precondition, so a proximity check
// that reads hate alone reports an emergency the rules say cannot happen yet:
// measured at campaign year 6 on Normal, hate 168 produced "32.0 hate from
// Total War ... effectively irreversible" while the gate was still 14 in-game
// years shut.
//
// How much lead time counts as "soon" is a judgement call, not a measured
// constant. Two campaign years is the window used here: short enough that hate
// added now is plausibly still on the books when the gate opens, long enough
// that the operator is warned before the gate rather than at it.
const TOTAL_WAR_GATE_HORIZON_YEARS = 2;

/**
 * Is the campaign-year half of the Total War precondition satisfied?
 *
 * Returns 'open' | 'closed' | 'unknown'. Read off buildTotalWarState's own
 * states rather than re-deriving the difficulty thresholds, so the two cannot
 * drift apart. 'unknown' is a real answer: with no campaign start year the
 * save cannot say how long the clock has run, and the hate-unknown states
 * ('armed_hate_unknown' / 'safe_hate_unknown') already carry a KNOWN gate with
 * an unknown hate, which is a different thing entirely.
 */
function classifyTotalWarYearGate(totalWarState) {
  switch (totalWarState) {
    case 'active':
    case 'armed':
    case 'armed_hate_unknown':
      return 'open';
    case 'pending':
    case 'safe':
    case 'safe_hate_unknown':
      return 'closed';
    default:
      // null, 'unavailable', or a state a newer build added. Never guess.
      return 'unknown';
  }
}

function formatCampaignYears(years) {
  if (years === null) return null;
  const rounded = Math.round(years * 10) / 10;
  return `${rounded.toFixed(1)} campaign year${rounded === 1 ? '' : 's'}`;
}

function pipCount(estimate) {
  const text = String(estimate || '');
  if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null;
  if (!/■|□/.test(text)) return null;
  return (text.match(/■/g) || []).length;
}

/**
 * Can this proxy faction contact the aliens?
 *
 * Returns true only on positive evidence. Absence of the project is NOT
 * evidence of absence: enemy project lists are intelligence-limited, so an
 * unseen Hydra Diplomacy means "unknown", never "no contact". Collapsing
 * unknown to false would understate every proxy hate estimate by half.
 */
function detectAlienContact(faction = {}) {
  const projects = Array.isArray(faction.completedProjects) ? faction.completedProjects : null;
  if (!projects) return null;
  const has = projects.some((entry) => {
    const id = typeof entry === 'string' ? entry : (entry?.projectId || entry?.displayName || '');
    return String(id) === ALIEN_CONTACT_PROJECT;
  });
  // Only a hit is conclusive, unless we are looking at our own faction, where
  // the project list is complete and a miss really does mean "not researched".
  if (has) return true;
  return faction.hasFullProjectVisibility === true ? false : null;
}

function shareRangeFor(kind, contact) {
  const band = PROXY_ALIEN_HATE_SHARE[kind];
  if (!band) return { min: 0, max: 0 };
  if (contact === true) return { min: band.contact, max: band.contact };
  if (contact === false) return { min: band.noContact, max: band.noContact };
  return { min: Math.min(band.contact, band.noContact), max: Math.max(band.contact, band.noContact) };
}

const asFraction = (value) => {
  if (value === 0) return '0';
  const denominator = Math.round(1 / value);
  return `1/${denominator}`;
};

/** Compact fraction band, e.g. "1/8–1/4" or "0–1/10". */
function shortShare(range) {
  const high = asFraction(range.max);
  if (range.min === range.max) return high;
  return `${asFraction(range.min)}–${high}`;
}

function describeShare(kind, label, contact, range) {
  const takes = `the hate ${label} take${kind === 'protectorate' ? 's' : ''}`;
  if (range.max === 0) {
    return `no alien-hate share (${label} cannot contact the aliens)`;
  }
  if (range.min === range.max) {
    return `${asFraction(range.max)} of ${takes}`;
  }
  // No parentheses here: this string is itself interpolated into parenthesised
  // directive statements, and nesting them reads badly.
  return `${shortShare(range)} of ${takes} — the wider figure applies only if `
    + 'they can contact the aliens, which is not observable from here';
}

function classifyProxy(faction = {}) {
  const template = String(faction.templateName || '').trim().toLowerCase();
  const name = String(faction.displayName || faction.name || '').trim().toLowerCase();

  const proxy = (kind, label) => {
    const contact = detectAlienContact(faction);
    const range = shareRangeFor(kind, contact);
    return {
      kind,
      label,
      alienContact: contact,
      shareMin: range.min,
      shareMax: range.max,
      // Point estimate for callers that need one; the midpoint of the band
      // when contact is unknown. Anything user-facing should use the band.
      share: (range.min + range.max) / 2,
      shareKnown: range.min === range.max,
      shareShort: shortShare(range),
      shareLabel: describeShare(kind, label, contact, range)
    };
  };

  if (template === 'submitcouncil' || /\bservants?\b/.test(name)) {
    return proxy('servants', SERVANTS_DISPLAY_NAME);
  }
  if (template === 'appeasecouncil' || /protectorate/.test(name)) {
    return proxy('protectorate', 'the Protectorate');
  }
  // The save calls this faction "the Aliens"; the template's friendlyName is
  // "Hydras". Match the template first so a localisation change cannot
  // silently drop the alien faction out of the fleet comparison.
  if (template === 'aliencouncil' || faction.isAlien === true || /^the aliens$/.test(name) || name === 'aliens' || name === 'hydras') {
    return {
      kind: 'aliens',
      label: 'the Aliens',
      alienContact: true,
      shareMin: 1,
      shareMax: 1,
      share: 1,
      shareKnown: true,
      shareShort: '1/1',
      shareLabel: 'full mission hate'
    };
  }
  return {
    kind: 'human',
    label: faction.displayName || 'a human faction',
    alienContact: null,
    shareMin: 0,
    shareMax: 0,
    share: 0,
    shareKnown: true,
    shareShort: '0',
    shareLabel: 'no proxy alien-hate share'
  };
}

function expectedAlienHate(missionType, proxy = classifyProxy()) {
  const key = String(missionType || '').trim();
  const successHate = Object.prototype.hasOwnProperty.call(MISSION_SUCCESS_HATE, key)
    ? MISSION_SUCCESS_HATE[key]
    : null;
  const shareMin = toFiniteNumber(proxy.shareMin) ?? 0;
  const shareMax = toFiniteNumber(proxy.shareMax) ?? 0;
  const share = toFiniteNumber(proxy.share) ?? 0;
  const feedsProxyHate = shareMax > 0 && shareMax < 1 && PROXY_OFFENSIVE_MISSIONS.has(key);

  if (successHate === 0 || shareMax === 0) {
    return {
      applicable: false,
      feedsProxyHate: false,
      missionSuccessHate: successHate,
      share,
      shareMin,
      shareMax,
      expectedMid: 0,
      expectedLow: 0,
      expectedHigh: 0,
      label: successHate === 0 ? 'none (template success hate is 0)' : 'none (no proxy share)',
      note: successHate === 0
        ? `${key || 'This mission'} has 0 success-slot hate in TIMissionTemplate.`
        : `${proxy.label} is not a proxy-hate target.`
    };
  }

  if (successHate === null) {
    return {
      applicable: feedsProxyHate,
      feedsProxyHate,
      missionSuccessHate: null,
      share,
      shareMin,
      shareMax,
      expectedMid: null,
      expectedLow: null,
      expectedHigh: null,
      label: feedsProxyHate
        ? `proxy share applies (${proxy.shareLabel}; ±20%)`
        : 'UNAVAILABLE',
      note: 'Success-slot hate for this mission is not in the local table; do not invent a number.'
    };
  }

  // Two independent uncertainties stack, and the band has to carry both:
  // whether the proxy can contact the aliens (which halves or zeroes the
  // share), and the game's 0.8-1.2 roll on every applied hate modifier.
  const mid = successHate * share;
  const low = successHate * shareMin * (1 - HATE_DELTA_VARIANCE);
  const high = successHate * shareMax * (1 + HATE_DELTA_VARIANCE);
  const spread = proxy.shareKnown
    ? '±20% roll'
    : `share ${proxy.shareShort} unknown, ±20% roll`;
  return {
    applicable: true,
    feedsProxyHate: feedsProxyHate || (shareMax === 1 && successHate > 0),
    missionSuccessHate: successHate,
    share,
    shareMin,
    shareMax,
    expectedMid: mid,
    expectedLow: low,
    expectedHigh: high,
    label: `~${low.toFixed(1)}–${high.toFixed(1)} to aliens (${spread})`,
    note: `${key} success hate ${successHate} × ${proxy.shareLabel}. `
      + 'The game then multiplies every applied hate modifier by 0.8–1.2. '
      + 'Sharing only applies to hate gained through action — passive drift, '
      + 'trade, and floor changes are never shared.'
  };
}

function countShips(observer = {}, factions = [], fleets = []) {
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
    const proxy = classifyProxy(faction);
    return proxy.kind === 'aliens';
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
function medianOf(values) {
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

function findAlienFaction(factions = []) {
  return (Array.isArray(factions) ? factions : [])
    .find((faction) => classifyProxy(faction).kind === 'aliens') || null;
}

/**
 * Median armour across a side's ships. Per-ship `armorMedian` first, because a
 * median of fleet-level medians throws away how many hulls each fleet holds;
 * the fleet-level field is the fallback for a snapshot that carries fleets
 * without their ship lists.
 */
function medianArmour(fleets) {
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
function medianDeltaV(fleets) {
  const fleetMedian = medianOf(fleets.map((fleet) => fleet.lowestDeltaVKps));
  if (fleetMedian !== null) return { value: fleetMedian, basis: 'fleet lowestDeltaVKps' };
  const perShip = fleets.flatMap((fleet) => (Array.isArray(fleet.ships) ? fleet.ships : [])
    .map((ship) => ship?.currentMaxDeltaVKps));
  const shipMedian = medianOf(perShip);
  if (shipMedian !== null) return { value: shipMedian, basis: 'per-ship currentMaxDeltaVKps' };
  return { value: null, basis: null };
}

function dominantWeaponOf(fleets) {
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
function summarizeFleetCapability({ observer = {}, factions = [], fleets = [], ships = null } = {}) {
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

function formatAxisValue(value, unit) {
  if (value === null || value === undefined) return 'UNAVAILABLE';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/**
 * How much room is left before an action starts (or deepens) the alien war.
 *
 *   'at-war'      - measured hate is at or past the threshold
 *   'on-the-line' - measured hate is below it, but by less than the cheapest
 *                   hate-generating mission's worst case, so any offensive
 *                   crosses it this cycle
 *   'saturated'   - hate is NOT measurable and the 5-diamond meter is full.
 *                   The meter tops out at >= 45 (pips = round(hate/10), capped
 *                   at 5), so this state cannot tell "at war" from "five points
 *                   short of war". It must never be rendered as either.
 *   'clear'       - measurably below, with room for at least one action
 *   'unknown'     - no hate signal at all
 */
function classifyWarPressure({ currentWarStatus, actualAlienHate, warHeadroom, pips } = {}) {
  if (currentWarStatus === 'WAR THRESHOLD EXCEEDED') return 'at-war';
  if (actualAlienHate !== null && actualAlienHate >= ALIEN_HATE_WAR_THRESHOLD) return 'at-war';
  if (actualAlienHate !== null) {
    return warHeadroom !== null && warHeadroom < CHEAPEST_HATE_ACTION_LOW ? 'on-the-line' : 'clear';
  }
  if (pips !== null && pips >= HATE_HOT_PIPS) return 'saturated';
  if (pips !== null) return 'clear';
  return 'unknown';
}

function assessCampaignPosture({
  alienHateEconomics = {},
  observer = {},
  observerHate = {},
  factions = [],
  fleets = []
} = {}) {
  const economics = alienHateEconomics || {};
  const ships = countShips(observer, factions, fleets);
  const actualAlienHate = toFiniteNumber(economics.actualAlienHate);
  const pips = toFiniteNumber(observerHate.pips)
    ?? pipCount(observerHate.visibleEstimate)
    ?? pipCount(economics.visibleHateEstimate);
  const warExceeded = economics.currentWarStatus === 'WAR THRESHOLD EXCEEDED'
    || (actualAlienHate !== null && actualAlienHate >= ALIEN_HATE_WAR_THRESHOLD)
    || (pips !== null && pips >= HATE_HOT_PIPS);
  const totalWar = economics.totalWar || {};
  const totalWarState = totalWar.state || null;
  // The other half of the Total War precondition. buildTotalWarState already
  // resolved difficulty and Alien Progression Speed into these two fields, so
  // read them rather than recomputing the thresholds here.
  const totalWarYearGate = classifyTotalWarYearGate(totalWarState);
  const totalWarYearsRemaining = toFiniteNumber(totalWar.yearsRemaining);
  const hateHot = warExceeded
    || totalWarState === 'pending'
    || totalWarState === 'active';
  const hateElevated = hateHot
    || (actualAlienHate !== null && actualAlienHate >= (HATE_ELEVATED_PIPS * 10))
    || (pips !== null && pips >= HATE_ELEVATED_PIPS);

  // Ship count alone was the old fragility test, and count alone is the wrong
  // question: 240 obsolete hulls lose to 20 modern ones. It is kept as an
  // absolute floor -- a force this small cannot absorb a retaliation cycle
  // whatever its quality -- and the comparative half of the judgement now comes
  // from the capability ratio, which reads delta-V and armour as well as count.
  const countFragile = (ships.ownShips !== null && ships.ownShips < FRAGILE_OWN_SHIPS)
    || (
      ships.ownShips !== null
      && ships.alienShips !== null
      && ships.alienShips > 0
      && ships.ownShips < ships.alienShips * FRAGILE_OWN_VS_ALIEN
    );
  const fleetCapability = summarizeFleetCapability({ observer, factions, fleets, ships });
  const spaceFragile = fleetCapability.canContest === false || countFragile;

  // Headroom, not just level. "How much hate can I still afford" is the
  // question a mission suggestion actually needs answered.
  const warHeadroom = actualAlienHate === null
    ? null
    : ALIEN_HATE_WAR_THRESHOLD - actualAlienHate;
  const totalWarHeadroom = actualAlienHate === null
    ? null
    : ALIEN_TOTAL_WAR_HATE - actualAlienHate;
  const totalWarActive = totalWarState === 'active';

  // Distance to the war threshold, in the three states it can actually be
  // known in. 'saturated' is the player-mode default, not an edge case.
  const warPressure = classifyWarPressure({
    currentWarStatus: economics.currentWarStatus,
    actualAlienHate,
    warHeadroom,
    pips
  });

  // Total War proximity is often UNOBSERVABLE, and saying so matters more than
  // guessing. In player mode the save's true hate is redacted and all we have
  // is the 5-diamond meter, which saturates at ">= 50" -- so at five diamonds
  // the real figure could be 51 or 199 and the meter reads the same. Treating
  // that as "clear of Total War" is the exact failure this codebase forbids:
  // an absent measurement rendered as a confident safe.
  const meterSaturated = pips !== null && pips >= HATE_HOT_PIPS;

  // A gate we can SEE is shut, and shut for longer than the horizon, turns
  // Total War from an emergency into a forecast. An unknown gate does not:
  // 'unknown' must not read as either open or shut, so it leaves the hold in
  // place -- an unmeasured precondition cannot clear an irreversible one.
  const gateDefersTotalWar = totalWarYearGate === 'closed'
    && totalWarYearsRemaining !== null
    && totalWarYearsRemaining > TOTAL_WAR_GATE_HORIZON_YEARS;
  const gateWaitText = formatCampaignYears(totalWarYearsRemaining);

  // Two bands, not one. Below 200 the year gate can demote an approach to a
  // forecast, because hate added now is still ventable before the gate opens.
  // At or past 200 -- 'pending' is exactly that state -- the hate half of the
  // precondition is already breached and the clock is running towards a fixed
  // date, so the gate changes the wording but never lifts the hold.
  const hateThresholdMet = totalWarState === 'pending'
    || (actualAlienHate !== null && actualAlienHate >= ALIEN_TOTAL_WAR_HATE);
  const hateInApproachBand = actualAlienHate !== null && actualAlienHate >= TOTAL_WAR_APPROACH_HATE;

  let totalWarProximity;
  if (totalWarActive) {
    totalWarProximity = 'active';
  } else if (hateThresholdMet || hateInApproachBand) {
    totalWarProximity = gateDefersTotalWar && !hateThresholdMet ? 'forecast' : 'near';
  } else if (actualAlienHate !== null) {
    totalWarProximity = 'clear';
  } else if (meterSaturated) {
    // >= 50 with no upper bound available.
    totalWarProximity = 'unknown';
  } else if (pips !== null) {
    // Below five diamonds means below 50, which is comfortably clear of 150.
    totalWarProximity = 'clear';
  } else {
    totalWarProximity = 'unknown';
  }
  const nearTotalWar = totalWarProximity === 'active' || totalWarProximity === 'near';

  // Each hold is independently sufficient, and each says why. The Total War
  // gate deliberately ignores fleet strength: a strong fleet changes whether
  // we survive the retaliation cycle, but it does not make crossing 200
  // reversible.
  const holds = [];
  const totalWarNotes = [];
  const hatePosition = hateThresholdMet
    ? `hate is already at or past the Total War line of ${ALIEN_TOTAL_WAR_HATE}`
    : totalWarHeadroom === null
      ? `within reach of Total War at ${ALIEN_TOTAL_WAR_HATE}`
      : `${totalWarHeadroom.toFixed(1)} hate from Total War at ${ALIEN_TOTAL_WAR_HATE}`;
  if (hateElevated && spaceFragile) {
    holds.push('the fleet cannot absorb the retaliation cycle at this hate level');
  }
  if (totalWarActive) {
    holds.push('already at Total War — venting is voided, so added hate has no route back out');
  } else if (nearTotalWar) {
    // The gate is open, about to open, or unobservable. Only the first makes
    // the transition available right now, so the wording has to say which --
    // an unqualified "irreversible" at year 6 of a 20-year gate is a claim the
    // rules contradict.
    const gateNote = totalWarYearGate === 'open'
      ? ', which is effectively irreversible — the campaign-year gate has already passed'
      : totalWarYearGate === 'closed' && gateWaitText !== null
        ? `, which becomes effectively irreversible when the campaign-year gate opens in ${gateWaitText}`
        : ', which is effectively irreversible — the campaign-year gate is not observable from this save';
    holds.push(`${hatePosition}${gateNote}`);
  } else if (totalWarProximity === 'forecast') {
    // Hate is in range but the gate is measurably years out, so this is a
    // forecast, not an emergency: hate added now can still be vented before
    // the gate opens. Holding proxy action on it would suppress a decade of
    // play, so it is recorded as a note rather than a hold.
    totalWarNotes.push(
      `Total War forecast, not imminent: ${hatePosition}, but the campaign-year gate does not `
      + `open for ${gateWaitText}`
    );
  } else if (totalWarProximity === 'unknown' && meterSaturated && !gateDefersTotalWar) {
    // Blind above the war threshold. The distance to an irreversible
    // transition is exactly what we cannot measure, so hold and say why
    // rather than reporting a headroom we do not have.
    holds.push(
      `alien hate is at or above ${ALIEN_HATE_WAR_THRESHOLD} and the estimate meter `
      + `saturates there — distance to Total War at ${ALIEN_TOTAL_WAR_HATE} is not observable `
      + 'from a player-mode save'
    );
  } else if (totalWarProximity === 'unknown' && meterSaturated) {
    // Same blindness, but the year gate is measurably shut, so the unmeasured
    // hate cannot produce Total War inside the horizon either way. Still say
    // what cannot be seen -- it just is not a reason to hold this cycle.
    totalWarNotes.push(
      `alien hate is at or above ${ALIEN_HATE_WAR_THRESHOLD} and the estimate meter saturates `
      + `there, so distance to Total War at ${ALIEN_TOTAL_WAR_HATE} is not observable; the `
      + `campaign-year gate does not open for ${gateWaitText}`
    );
  }
  const escalateLate = holds.length > 0;

  const reasons = [];
  if (actualAlienHate !== null) {
    reasons.push(`alien hate ${actualAlienHate.toFixed(1)} / ${ALIEN_HATE_WAR_THRESHOLD} war threshold`);
  } else if (pips !== null) {
    reasons.push(`game-visible hate ${pips}/5 diamonds`);
  } else {
    reasons.push('alien hate UNAVAILABLE');
  }
  if (ships.ownShips !== null) {
    const alienText = ships.alienShips === null ? 'alien ship count UNAVAILABLE' : `${ships.alienShips} visible alien ships`;
    reasons.push(`${ships.ownShips} own ships vs ${alienText}`);
  } else {
    reasons.push('own ship count UNAVAILABLE');
  }
  for (const hold of holds) {
    reasons.push(`doctrine: escalate late — ${hold}`);
  }
  // Notes are the things that did NOT justify a hold. They still get reported,
  // because a deferred Total War is a forecast the operator should see rather
  // than a fact that quietly disappeared.
  for (const note of totalWarNotes) {
    reasons.push(note);
  }

  return {
    escalateLate,
    holds,
    totalWarNotes,
    hateHot,
    hateElevated,
    spaceFragile,
    // The comparative half of spaceFragile, kept separately so a caller can see
    // WHICH axis is short rather than only that something is. `canContest` is
    // true | false | 'unknown' -- never a boolean.
    fleetCapability,
    countFragile,
    warExceeded,
    actualAlienHate,
    pips,
    warThreshold: ALIEN_HATE_WAR_THRESHOLD,
    warHeadroom,
    // 'at-war' | 'on-the-line' | 'saturated' | 'clear' | 'unknown'.
    warPressure,
    cheapestHateAction: CHEAPEST_HATE_ACTION,
    cheapestHateActionLow: CHEAPEST_HATE_ACTION_LOW,
    totalWarHateThreshold: ALIEN_TOTAL_WAR_HATE,
    totalWarHeadroom,
    nearTotalWar,
    // 'active' | 'near' | 'forecast' | 'clear' | 'unknown'. Never collapse
    // 'unknown' to 'clear': in player mode the meter saturates at the war
    // threshold, so being blind is the normal case rather than an edge case.
    // 'forecast' means the hate half of the precondition is met but the
    // campaign-year half is measurably years away -- distinct from 'near',
    // which is the transition being actually available.
    totalWarProximity,
    hateObservable: actualAlienHate !== null,
    totalWarState,
    // 'open' | 'closed' | 'unknown' -- the campaign-year half of the Total War
    // precondition, and how long is left on it when that is measurable.
    totalWarYearGate,
    totalWarYearsRemaining,
    ...ships,
    reasons
  };
}

function findHumanNonProxyTarget(nations = [], factions = [], observerId = null) {
  let best = null;
  for (const nation of Array.isArray(nations) ? nations : []) {
    const executiveId = nation.executiveFactionId;
    if (executiveId === null || executiveId === undefined) continue;
    if (sameId(executiveId, observerId)) continue;
    const faction = (Array.isArray(factions) ? factions : []).find((entry) => sameId(entry.ID, executiveId));
    const proxy = classifyProxy(faction || { displayName: nation.executiveFactionName });
    if (proxy.kind !== 'human' || proxy.share !== 0) continue;
    const gdp = toFiniteNumber(nation.GDP);
    if (gdp === null) continue;
    if (!best || gdp > best.gdp) {
      best = {
        nationName: nation.displayName,
        gdp,
        gdpTrillion: gdp / ONE_TRILLION,
        executiveFactionId: executiveId,
        executiveFactionName: faction?.displayName || nation.executiveFactionName,
        faction,
        proxy
      };
    }
  }
  return best;
}

function formatShipPosture(posture = {}) {
  const own = toFiniteNumber(posture.ownShips);
  const alien = toFiniteNumber(posture.alienShips);
  if (own === null) return 'own fleet size is UNAVAILABLE';
  if (alien === null) return `${own} own ships (alien count UNAVAILABLE)`;
  return `${own} own ships vs ${alien} visible alien ships`;
}

// ---------------------------------------------------------------------------
// Hold Ground
//
// A hold has always been a SUPPRESSION here: the engine could say "don't
// crackdown Japan", never "do this instead". When the vetoes fire hard the
// broad-actions panel degrades toward empty, and an empty panel reads as "no
// information" when the truth is a specific and correct posture.
//
// Holding is an action. The alien war ends when hate vents back below the war
// threshold, so declining to add hate is the mechanism that ends it. That
// deserves a directive with its own reasoning rather than a silence left
// behind by vetoes.
// ---------------------------------------------------------------------------

/** Success-slot hate per mission, from TIMissionTemplate, without the compound UI aliases. */
function hateGeneratingMissions() {
  return Object.entries(MISSION_SUCCESS_HATE)
    .filter(([name, hate]) => hate > 0 && !name.includes('/'))
    .map(([name, hate]) => ({
      missionType: name,
      successHate: hate,
      low: hate * (1 - HATE_DELTA_VARIANCE),
      high: hate * (1 + HATE_DELTA_VARIANCE)
    }))
    .sort((left, right) => left.successHate - right.successHate);
}

/** Missions whose template success-slot hate is exactly 0, so a hold cannot touch them. */
function zeroHateMissions() {
  return Object.entries(MISSION_SUCCESS_HATE)
    .filter(([, hate]) => hate === 0)
    .map(([name]) => name);
}

function formatDays(days) {
  if (days === null) return null;
  if (days < 1) return 'under a campaign day';
  const rounded = Math.round(days * 10) / 10;
  return `${rounded.toFixed(1)} campaign day${rounded === 1 ? '' : 's'}`;
}

/**
 * The affirmative posture directive: hold, and here is what holding consists of.
 *
 * Two independent halves, each with its own unknown state:
 *   1. war pressure -- at the threshold, one action from it, or blind above it
 *   2. fleet capability -- can we contest, cannot, or cannot tell
 *
 * It fires when the first half shows pressure AND the second is NOT `true`.
 * `canContest === true` is a reason NOT to hold: being able to fight is the
 * whole argument against holding, so the directive stands down. `'unknown'`
 * fires with the comparison named as unmade -- an unmeasurable check must never
 * fall through to "you're fine".
 *
 * @param {object}  posture              assessCampaignPosture output
 * @param {object}  alienHateEconomics   the computed economics block (floor, MC)
 * @param {object}  [hateTrend]          {delta, from, to, elapsedGameDays} -- ONLY
 *   pass this when the observer's true hate is legitimately observable
 *   (posture.hateObservable), or player mode inherits a redacted figure.
 * @param {object}  [deferredCounts]     missionType -> number of candidates the
 *   engine held back this cycle. Absent stays absent; never rendered as 0.
 */
function buildHoldGround({
  posture = {},
  alienHateEconomics = {},
  hateTrend = null,
  deferredCounts = null,
  observerName = null
} = {}) {
  const capability = posture.fleetCapability || summarizeFleetCapability({});
  const warPressure = posture.warPressure || 'unknown';
  const canContest = capability.canContest;
  const label = observerName || 'this faction';

  const pressureApplies = warPressure === 'at-war'
    || warPressure === 'on-the-line'
    || warPressure === 'saturated';

  if (!pressureApplies || canContest === true) {
    return {
      fires: false,
      warPressure,
      canContest,
      standDownReason: canContest === true
        ? `The fleet can contest an engagement, which is a reason not to hold. ${capability.verdictReason}`
        : warPressure === 'clear'
          ? `Alien hate is measurably clear of the ${ALIEN_HATE_WAR_THRESHOLD} war threshold with room for at least one hate-generating action.`
          : 'No alien-hate signal is available in this snapshot, so war pressure could not be evaluated.'
    };
  }

  const hate = toFiniteNumber(posture.actualAlienHate);
  const headroom = toFiniteNumber(posture.warHeadroom);
  const cheapestLow = toFiniteNumber(posture.cheapestHateActionLow) ?? CHEAPEST_HATE_ACTION_LOW;

  // --- war half, worded for what is actually known -------------------------
  let warLine;
  let warConfirmed;
  if (warPressure === 'at-war') {
    warConfirmed = true;
    warLine = hate === null
      ? `The snapshot reports the alien war threshold of ${ALIEN_HATE_WAR_THRESHOLD} as exceeded.`
      : `Alien hate is ${hate.toFixed(1)}, at or past the war threshold of ${ALIEN_HATE_WAR_THRESHOLD}: `
        + 'the aliens are hunting our assets until hate vents back below it.';
  } else if (warPressure === 'on-the-line') {
    warConfirmed = false;
    warLine = `Alien hate is ${hate === null ? 'UNAVAILABLE' : hate.toFixed(1)} against a war threshold of `
      + `${ALIEN_HATE_WAR_THRESHOLD}, leaving ${headroom === null ? 'an unmeasured margin' : `${headroom.toFixed(2)} of headroom`}. `
      + `The cheapest hate-generating mission in the template table adds at least ${cheapestLow.toFixed(1)} `
      + `after the game's 0.8–1.2 roll, so the next offensive starts the war rather than risking it.`;
  } else {
    // 'saturated' -- player mode. Never assert the war is confirmed here.
    warConfirmed = 'unknown';
    warLine = `The game-visible hate meter reads ${posture.pips ?? HATE_HOT_PIPS}/5 and saturates there: `
      + `five diamonds covers everything from 45 upward, so this intelligence picture cannot tell `
      + `"at war" from "five points short of war". The true figure is not observable in player mode. `
      + `Either way the next hate-generating action pushes toward or deeper past `
      + `${ALIEN_HATE_WAR_THRESHOLD}, and the recommendation is the same.`;
  }

  // --- capability half -----------------------------------------------------
  const dominant = capability.dominantDeficit;
  const capabilityLine = canContest === false
    ? `The fleet cannot contest an engagement: ${capability.verdictReason}`
    : `Whether the fleet could contest an engagement is UNKNOWN. ${capability.verdictReason}`;

  // --- what holding actually consists of -----------------------------------
  const recommendations = [];
  if (canContest === 'unknown') {
    recommendations.push({
      rank: recommendations.length + 1,
      kind: 'intelligence',
      label: 'Close the detection gap before anything else',
      detail: capability.alienFleetsVisible === 0
        ? 'No alien fleet is on the board. Alien fleets enter a player-mode snapshot only through a '
          + 'detection capability, so the fleet comparison has no denominator and cannot be made. '
          + 'Acquire or restore that capability — the sky is not empty, it is unobserved.'
        : capability.verdictReason
    });
  } else if (dominant) {
    recommendations.push({
      rank: recommendations.length + 1,
      kind: dominant.remedyKind,
      label: dominant.remedyKind === 'research'
        ? `Prioritise ${dominant.remedyLabel}`
        : `Prioritise ${dominant.remedyLabel}`,
      detail: `${dominant.label} is the widest measured gap — ${dominant.text}. At that gap ${dominant.deficitMeaning}.`
    });
    // When the widest gap is one production cannot fix this cycle, the next
    // research axis still belongs on the board -- but only if one was measured.
    const nextResearch = capability.rankedDeficits
      .find((axis) => axis.remedyKind === 'research' && axis.key !== dominant.key);
    if (dominant.remedyKind !== 'research' && nextResearch) {
      recommendations.push({
        rank: recommendations.length + 1,
        kind: 'research',
        label: `Then ${nextResearch.remedyLabel}`,
        detail: `${nextResearch.label}: ${nextResearch.text}.`
      });
    }
  }
  recommendations.push({
    rank: recommendations.length + 1,
    kind: 'advisory',
    label: 'Keep every councilor on Advise',
    detail: 'Advise has a template success-slot hate of 0, so it adds nothing to the meter and stays '
      + 'fully available during a hold. Economy and research output is the one thing a hold does not cost.'
  });
  recommendations.push({
    rank: recommendations.length + 1,
    kind: 'defense',
    label: 'Ward what retaliation targets',
    detail: 'Defend Interests also carries 0 success-slot hate. Warding executive and high-GDP control '
      + 'points protects the holdings an alien asset hunt goes after, at no cost to the meter.'
  });

  // --- what is being given up, and what it would have cost -----------------
  const headroomText = (entry) => {
    if (headroom === null) {
      return 'headroom to the war threshold is not measurable in this intelligence picture';
    }
    if (headroom <= 0) return 'the threshold is already crossed, so this only deepens the war';
    return entry.low >= headroom
      ? `consumes all ${headroom.toFixed(2)} of the remaining headroom and crosses the threshold`
      : `consumes up to ${Math.min(entry.high, headroom).toFixed(1)} of the ${headroom.toFixed(2)} remaining`;
  };
  const deferred = hateGeneratingMissions().map((entry) => {
    const held = deferredCounts && Object.prototype.hasOwnProperty.call(deferredCounts, entry.missionType)
      ? deferredCounts[entry.missionType]
      : null;
    return {
      missionType: entry.missionType,
      successHate: entry.successHate,
      hateBand: `+${entry.low.toFixed(1)}–${entry.high.toFixed(1)}`,
      headroomEffect: headroomText(entry),
      heldCandidates: held
    };
  });

  // --- the exit ------------------------------------------------------------
  const floor = toFiniteNumber(alienHateEconomics.minimumAlienHate);
  const usedMC = toFiniteNumber(alienHateEconomics.usedMissionControl);
  const floorNote = floor === null
    ? 'The minimum-hate floor created by used Mission Control is not measurable in this snapshot, '
      + 'so how far hate can vent is unknown.'
    : floor >= ALIEN_HATE_WAR_THRESHOLD
      ? `Venting cannot end this war at current Mission Control: the floor created by `
        + `${usedMC === null ? 'the MC in use' : `${usedMC} MC in use`} is ${floor.toFixed(1)}, at or above the `
        + `${ALIEN_HATE_WAR_THRESHOLD} threshold. Hate cannot fall below that floor while the MC stays committed.`
      : `Hate can vent to a floor of ${floor.toFixed(1)}, set by ${usedMC === null ? 'the MC in use' : `${usedMC} MC in use`}, `
        + `which is ${(ALIEN_HATE_WAR_THRESHOLD - floor).toFixed(1)} below the threshold — so venting can end the war `
        + 'without decommissioning Mission Control.';

  let trendText = null;
  let estimateText = null;
  if (hateTrend && toFiniteNumber(hateTrend.delta) !== null && toFiniteNumber(hateTrend.elapsedGameDays) !== null
    && toFiniteNumber(hateTrend.elapsedGameDays) > 0) {
    const delta = toFiniteNumber(hateTrend.delta);
    const days = toFiniteNumber(hateTrend.elapsedGameDays);
    const perDay = delta / days;
    trendText = `Measured against the previous save: hate moved ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} `
      + `over ${days.toFixed(1)} campaign days (${perDay >= 0 ? '+' : ''}${perDay.toFixed(3)}/day).`;
    if (perDay < 0 && hate !== null && hate > ALIEN_HATE_WAR_THRESHOLD) {
      estimateText = `At that rate hate reaches ${ALIEN_HATE_WAR_THRESHOLD} in about `
        + `${formatDays((hate - ALIEN_HATE_WAR_THRESHOLD) / -perDay)} — a straight-line projection of one `
        + 'interval, not a game-published rate.';
    } else if (perDay >= 0) {
      estimateText = 'Hate is not venting on that interval, so no return-below-threshold date can be '
        + 'projected. Venting requires the aliens to stop finding new reasons to add hate.';
    } else {
      estimateText = 'Hate is already below the threshold on the measured figure, so there is no '
        + 'return-below-threshold date to project.';
    }
  } else {
    trendText = posture.hateObservable === true
      ? 'No previous-save comparison is available, so the venting rate is not measurable.'
      : 'The venting rate is not measurable in player mode: the true hate figure is redacted, so no '
        + 'rate of change can be computed. No estimate is offered rather than a fabricated one.';
  }

  // --- assembled copy ------------------------------------------------------
  const headline = warPressure === 'at-war'
    ? `Hold ground — at war with the aliens and ${canContest === false ? 'the fleet cannot contest it' : 'the fleet comparison cannot be made'}`
    : warPressure === 'on-the-line'
      ? `Hold ground — ${headroom === null ? 'on' : `${headroom.toFixed(2)} hate from`} the alien war threshold, and `
        + `${canContest === false ? 'the fleet cannot contest a war' : 'the fleet comparison cannot be made'}`
      : `Hold ground — the alien hate meter is saturated and ${canContest === false ? 'the fleet cannot contest a war' : 'the fleet comparison cannot be made'}`;

  const action = canContest === 'unknown'
    ? 'Hold every hate-generating mission this cycle, resolve the alien detection gap, and keep '
      + 'councilors on the zero-hate Advise and Defend Interests axes.'
    : `Hold every hate-generating mission this cycle. Spend it on ${dominant ? dominant.remedyLabel : 'closing the capability gap'}, `
      + 'Advise, and warding own holdings — all of which cost 0 alien hate.';

  return {
    fires: true,
    warPressure,
    warConfirmed,
    canContest,
    headline,
    warLine,
    capabilityLine,
    statement: `${warLine} ${capabilityLine} Declining to add hate is what ends an alien war, so holding `
      + `is ${label}'s move this cycle, not the absence of one.`,
    action,
    comparison: {
      canContest,
      verdictReason: capability.verdictReason,
      decisiveRatio: capability.decisiveRatio,
      axes: capability.axes,
      excludedAxes: capability.excludedAxes,
      alienFleetsVisible: capability.alienFleetsVisible,
      ownFleetsVisible: capability.ownFleetsVisible,
      detectionSources: capability.detectionSources,
      ownDominantWeaponType: capability.ownDominantWeaponType,
      alienDominantWeaponType: capability.alienDominantWeaponType,
      combatPowerExcluded: capability.combatPowerExcluded
    },
    recommendations,
    zeroHateMissions: zeroHateMissions(),
    deferred,
    deferredNote: 'Success-slot hate from TIMissionTemplate, banded by the game\'s 0.8–1.2 roll on every '
      + 'applied modifier. Against a proxy faction only their share of it reaches the aliens; against an '
      + 'alien-facing target the whole figure does.',
    exit: {
      threshold: ALIEN_HATE_WAR_THRESHOLD,
      // The exit has to match what is actually known about whether the war has
      // started. Telling a player at 48.9 hate that "the war ends when hate
      // vents below 50" states a war they are not in; telling a player whose
      // meter is saturated that the war HAS started asserts what the meter
      // cannot show.
      condition: warConfirmed === true
        ? `The alien war ends when hate vents back below ${ALIEN_HATE_WAR_THRESHOLD}. `
          + 'Every hate-generating mission pushes that date further out.'
        : warConfirmed === false
          ? `The war has not started. It starts the moment hate crosses ${ALIEN_HATE_WAR_THRESHOLD}, and once `
            + 'started it ends only when hate vents back below that line — so the cheapest exit available '
            + 'right now is not crossing it.'
          : `Whether the war has started is not observable from here. If it has, it ends when hate vents `
            + `back below ${ALIEN_HATE_WAR_THRESHOLD}; if it has not, not crossing ${ALIEN_HATE_WAR_THRESHOLD} `
            + 'is what keeps it from starting. Both point at the same hold.',
      floor,
      floorNote,
      trendText,
      estimateText,
      ventingBlockedByTotalWar: alienHateEconomics.ventingBlockedByTotalWar === true
    }
  };
}

function pickPrimaryDirective(groups = {}) {
  const all = [
    ...(groups.geopolitical || []),
    ...(groups.council || []),
    ...(groups.space || []),
    ...(groups.research || [])
  ];
  if (!all.length) return null;
  const severityRank = { CRITICAL: 3, HIGH: 2, STANDARD: 1, WATCH: 0 };
  return [...all].sort((left, right) => {
    const rankDelta = (right.policyRank || 0) - (left.policyRank || 0);
    if (rankDelta !== 0) return rankDelta;
    const severityDelta = (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0);
    if (severityDelta !== 0) return severityDelta;
    return 0;
  })[0];
}

module.exports = {
  PROXY_ALIEN_HATE_SHARE,
  ALIEN_CONTACT_PROJECT,
  HATE_DELTA_VARIANCE,
  MISSION_SUCCESS_HATE,
  PROXY_OFFENSIVE_MISSIONS,
  FRAGILE_OWN_SHIPS,
  TOTAL_WAR_APPROACH_HATE,
  CAPABILITY_AXES,
  DECISIVE_CAPABILITY_RATIO,
  CHEAPEST_HATE_ACTION,
  CHEAPEST_HATE_ACTION_LOW,
  detectAlienContact,
  classifyProxy,
  expectedAlienHate,
  assessCampaignPosture,
  summarizeFleetCapability,
  classifyWarPressure,
  buildHoldGround,
  findHumanNonProxyTarget,
  formatShipPosture,
  pickPrimaryDirective,
  countShips,
  pipCount
};
