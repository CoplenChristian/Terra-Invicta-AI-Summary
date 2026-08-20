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
 * - Operator: actions against the Servants feed alien hate at 1/4 of the
 *   hate those Servants take; Protectorate at 1/8. There is no named share
 *   field in the game JSON, so those fractions are campaign knowledge.
 * - TIMissionTemplate.json success slot (index 4): Crackdown 2, Purge 5,
 *   Sabotage Facilities 3, Public Campaign 0, Defend Interests 0.
 */

const { ALIEN_HATE_WAR_THRESHOLD } = require('./alienHateEconomics');

const PROXY_ALIEN_HATE_SHARE = Object.freeze({
  servants: 0.25,
  protectorate: 0.125
});

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

function classifyProxy(faction = {}) {
  const template = String(faction.templateName || '').trim().toLowerCase();
  const name = String(faction.displayName || faction.name || '').trim().toLowerCase();

  if (template === 'submitcouncil' || /\bservants?\b/.test(name)) {
    return {
      kind: 'servants',
      share: PROXY_ALIEN_HATE_SHARE.servants,
      label: 'the Servants',
      shareLabel: '1/4 of the hate the Servants take'
    };
  }
  if (template === 'appeasecouncil' || /protectorate/.test(name)) {
    return {
      kind: 'protectorate',
      share: PROXY_ALIEN_HATE_SHARE.protectorate,
      label: 'the Protectorate',
      shareLabel: '1/8 of the hate the Protectorate takes'
    };
  }
  if (template === 'aliencouncil' || /^the aliens$/.test(name) || name === 'aliens') {
    return { kind: 'aliens', share: 1, label: 'the Aliens', shareLabel: 'full mission hate' };
  }
  return { kind: 'human', share: 0, label: faction.displayName || 'a human faction', shareLabel: 'no proxy alien-hate share' };
}

function expectedAlienHate(missionType, proxy = classifyProxy()) {
  const key = String(missionType || '').trim();
  const successHate = Object.prototype.hasOwnProperty.call(MISSION_SUCCESS_HATE, key)
    ? MISSION_SUCCESS_HATE[key]
    : null;
  const share = toFiniteNumber(proxy.share) ?? 0;
  const feedsProxyHate = share > 0 && share < 1 && PROXY_OFFENSIVE_MISSIONS.has(key);

  if (successHate === 0 || share === 0) {
    return {
      applicable: false,
      feedsProxyHate: false,
      missionSuccessHate: successHate,
      share,
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
      expectedMid: null,
      expectedLow: null,
      expectedHigh: null,
      label: feedsProxyHate
        ? `proxy share applies (${proxy.shareLabel}; ±20%)`
        : 'UNAVAILABLE',
      note: 'Success-slot hate for this mission is not in the local table; do not invent a number.'
    };
  }

  const mid = successHate * share;
  const low = mid * (1 - HATE_DELTA_VARIANCE);
  const high = mid * (1 + HATE_DELTA_VARIANCE);
  return {
    applicable: true,
    feedsProxyHate: feedsProxyHate || (share === 1 && successHate > 0),
    missionSuccessHate: successHate,
    share,
    expectedMid: mid,
    expectedLow: low,
    expectedHigh: high,
    label: `~${low.toFixed(1)}–${high.toFixed(1)} to aliens (±20%)`,
    note: `${key} success hate ${successHate} × ${proxy.shareLabel}. Game then multiplies every hate modifier by 0.8–1.2.`
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
  const alienFromFleets = aliens && Array.isArray(fleets)
    ? fleets
      .filter((fleet) => sameId(fleet.factionId, aliens.ID))
      .reduce((sum, fleet) => sum + (toFiniteNumber(fleet.shipsCount) || 0), 0)
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
  const actualAlienHate = toFiniteNumber(economics.actualAlienHate)
    ?? toFiniteNumber(observer.assessedAlienHateOfMe);
  const pips = toFiniteNumber(observerHate.pips)
    ?? pipCount(observerHate.visibleEstimate)
    ?? pipCount(economics.visibleHateEstimate);
  const warExceeded = economics.currentWarStatus === 'WAR THRESHOLD EXCEEDED'
    || (actualAlienHate !== null && actualAlienHate >= ALIEN_HATE_WAR_THRESHOLD)
    || (pips !== null && pips >= HATE_HOT_PIPS);
  const totalWarState = economics.totalWar?.state || null;
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

  const escalateLate = Boolean(hateElevated && spaceFragile);
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
  if (escalateLate) {
    reasons.push('doctrine: escalate late — do not feed proxy hate while the fleet cannot absorb retaliation');
  }

  return {
    escalateLate,
    hateHot,
    hateElevated,
    spaceFragile,
    warExceeded,
    actualAlienHate,
    pips,
    warThreshold: ALIEN_HATE_WAR_THRESHOLD,
    totalWarState,
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
  HATE_DELTA_VARIANCE,
  MISSION_SUCCESS_HATE,
  PROXY_OFFENSIVE_MISSIONS,
  FRAGILE_OWN_SHIPS,
  classifyProxy,
  expectedAlienHate,
  assessCampaignPosture,
  findHumanNonProxyTarget,
  formatShipPosture,
  pickPrimaryDirective,
  countShips,
  pipCount
};
