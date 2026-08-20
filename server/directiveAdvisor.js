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
  'Defend Interests': 0
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

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
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
    return proxy('servants', 'the Servants');
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

  const spaceFragile = (ships.ownShips !== null && ships.ownShips < FRAGILE_OWN_SHIPS)
    || (
      ships.ownShips !== null
      && ships.alienShips !== null
      && ships.alienShips > 0
      && ships.ownShips < ships.alienShips * FRAGILE_OWN_VS_ALIEN
    );

  // Headroom, not just level. "How much hate can I still afford" is the
  // question a mission suggestion actually needs answered.
  const warHeadroom = actualAlienHate === null
    ? null
    : ALIEN_HATE_WAR_THRESHOLD - actualAlienHate;
  const totalWarHeadroom = actualAlienHate === null
    ? null
    : ALIEN_TOTAL_WAR_HATE - actualAlienHate;
  const totalWarActive = totalWarState === 'active';

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
    warExceeded,
    actualAlienHate,
    pips,
    warThreshold: ALIEN_HATE_WAR_THRESHOLD,
    warHeadroom,
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
        gdpTrillion: gdp / 1e12,
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
  detectAlienContact,
  classifyProxy,
  expectedAlienHate,
  assessCampaignPosture,
  findHumanNonProxyTarget,
  formatShipPosture,
  pickPrimaryDirective,
  countShips,
  pipCount
};
