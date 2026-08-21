/**
 * server/engine/odds.js
 * Purpose: the Terra Invicta wiki roll success curve and the documented
 *   modifier calculations.
 *
 * Implements the Terra Invicta Wiki Roll success curve and documented modifier calculations.
 *
 * Roll Formula:
 *   diff = offense - defense
 *   diff >= 0 :  chance = 1 - 0.5 * (0.775 ^ diff)
 *   diff <  0 :  chance =     0.5 * (0.775 ^ |diff|)
 */

// Campaign-typical attribute medians measured from omniscient enemy rosters.
// Used when player mode masks an enemy councilor's defender stat.
const CAMPAIGN_ATTRIBUTE_MEDIANS = Object.freeze({
  Loyalty: 11,
  Administration: 14,
  Security: 8,
  Espionage: 7,
  Science: 4,
  Command: 5,
  Persuasion: 10,
  Investigation: 8
});

function calculateRollChance(diff) {
  if (diff === null || diff === undefined || typeof diff !== 'number' || Number.isNaN(diff)) {
    return null;
  }
  const d = Math.max(-40, Math.min(40, diff));
  if (d >= 0) {
    return 1 - 0.5 * Math.pow(0.775, d);
  }
  return 0.5 * Math.pow(0.775, Math.abs(d));
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * The shape returned when the roll cannot be computed at all.
 *
 * A roll needs an attack attribute and a base difficulty, and both live in the
 * TIMissionTemplate. Snapshots published before `missionSpecs` existed carry
 * neither -- and those are the snapshots the hosted site still serves. Filling
 * the missing halves with `Persuasion` and `0` produced a number that reads as
 * measured and is not: uncontested Defend Interests came back "99.9% via a
 * Persuasion roll" when it has no roll, and Purge was scored off Persuasion
 * when its real attack attribute is Espionage. Absent stays null.
 *
 * `automatic` is null rather than false for the same reason: whether the
 * mission is contested is itself a template fact we do not have here.
 */
function oddsUnavailable(basis) {
  return {
    chance: null,
    point: null,
    band: null,
    automatic: null,
    diff: null,
    offense: null,
    defense: null,
    assumed: false,
    available: false,
    basis,
    unmodeledModifiers: []
  };
}

function getCouncilorAttribute(councilor, attrName) {
  if (!councilor || !attrName) return null;

  // 1. resolvedAttributes.effective (includes traits + org bonuses)
  const effective = councilor.resolvedAttributes?.effective?.[attrName];
  if (typeof effective === 'number' && Number.isFinite(effective)) return effective;

  // 2. resolvedAttributes flat map
  const resolved = councilor.resolvedAttributes?.[attrName];
  if (typeof resolved === 'number' && Number.isFinite(resolved)) return resolved;

  // 3. raw attributes object
  const raw = councilor.attributes?.[attrName];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;

  // 4. direct property on councilor object
  const direct = councilor[attrName] ?? councilor[attrName.toLowerCase()];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  return null;
}

function computeMissionOdds(candidate, councilor, world = {}) {
  const spec = candidate?.missionSpec || null;

  // `contested === false` is read off the template; `isAutomatic` is the same
  // template fact already resolved by a generator. Neither is inferred from
  // the spec's absence.
  const isAutomatic = spec?.contested === false || candidate?.isAutomatic === true;

  if (isAutomatic) {
    return {
      chance: 1.0,
      point: 100,
      band: [100, 100],
      automatic: true,
      diff: 0,
      assumed: false,
      available: true,
      basis: '100% (Automatic)',
      unmodeledModifiers: []
    };
  }

  const missionName = spec?.friendlyName || spec?.dataName
    || candidate?.friendlyName || candidate?.missionType || 'this mission';

  const attackAttr = spec?.attack || candidate?.attackAttribute || null;
  const baseDifficulty = firstFiniteNumber(spec?.baseDifficulty, candidate?.baseDifficulty);

  if (!attackAttr || baseDifficulty === null) {
    return oddsUnavailable(spec
      ? `mission rules incomplete -- TIMissionTemplate for ${missionName} names no attack attribute`
      : `mission rules unavailable -- TIMissionTemplate for ${missionName} not in this snapshot`);
  }

  const defendAttr = spec?.defend || candidate?.defendAttribute || null;

  const offense = getCouncilorAttribute(councilor, attackAttr);
  if (offense === null) {
    return oddsUnavailable(`councilor ${attackAttr} not in this snapshot`);
  }

  let defense = baseDifficulty;
  let assumed = false;
  const target = candidate?.target || {};

  // 1. Defending councilor attribute (exact check for non-null; 0 is a valid measured stat)
  if (defendAttr) {
    const targetCouncilor = target?.councilor || target;
    const targetVal = getCouncilorAttribute(targetCouncilor, defendAttr);
    if (targetVal !== null) {
      defense += targetVal;
    } else {
      // Attribute masked in player mode -> use campaign-calibrated median
      const median = CAMPAIGN_ATTRIBUTE_MEDIANS[defendAttr] || 10;
      defense += median;
      assumed = true;
    }
  }

  // 2. TargetNationGDP modifier: (GDP in Billions) ^ (1/3)
  // Look for gdpBn in candidate value, target, or world nation record
  let gdpBn = candidate?.value?.gdpBn ?? (typeof target?.gdpBn === 'number' ? target.gdpBn : null);
  if (gdpBn === null || gdpBn === undefined) {
    const rawGdp = typeof target?.GDP === 'number' ? target.GDP : (typeof target?.gdp === 'number' ? target.gdp : null);
    if (rawGdp !== null) {
      // If rawGdp > 1e6 it is in raw currency units -> convert to Billions
      gdpBn = rawGdp > 1e6 ? rawGdp / 1e9 : rawGdp;
    }
  }

  if (typeof gdpBn === 'number' && gdpBn > 0) {
    const gdpDefenseMod = Math.pow(gdpBn, 0.33333334);
    if (spec?.dataName === 'GainInfluence' || spec?.friendlyName === 'Control Nation' ||
        spec?.dataName === 'Propaganda' || spec?.friendlyName === 'Public Campaign') {
      defense += gdpDefenseMod;
    }
  }

  const unmodeledModifiers = ['PublicOpinion', 'Democracy', 'AdjacentAllies'];

  const diff = offense - defense;
  const chance = calculateRollChance(diff);

  if (chance === null) {
    return oddsUnavailable(`indeterminate roll -- ${attackAttr} vs ${defendAttr || 'flat difficulty'} did not resolve to a number`);
  }

  const point = Math.round(chance * 100);

  // Computed band accounting for ±2 variance in unmodeled situational modifiers (§4a.5)
  const lowChance = calculateRollChance(diff - 2);
  const highChance = calculateRollChance(diff + 2);
  const band = [
    Math.max(1, Math.min(99, Math.round(lowChance * 100))),
    Math.max(1, Math.min(99, Math.round(highChance * 100)))
  ];

  let basis = `${attackAttr} ${offense} vs diff ${diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}`;
  if (assumed && defendAttr) {
    basis += ` (assumed median ${defendAttr} ${CAMPAIGN_ATTRIBUTE_MEDIANS[defendAttr] || 10})`;
  }

  return {
    chance,
    point,
    band,
    automatic: false,
    diff,
    offense,
    defense,
    assumed,
    available: true,
    basis,
    unmodeledModifiers
  };
}

module.exports = {
  CAMPAIGN_ATTRIBUTE_MEDIANS,
  calculateRollChance,
  computeMissionOdds,
  getCouncilorAttribute,
  oddsUnavailable
};
