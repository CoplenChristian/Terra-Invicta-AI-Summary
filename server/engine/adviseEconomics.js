/**
 * server/engine/adviseEconomics.js
 * Purpose: pure calculations for the Advise mission on Nations and Habs.
 *
 * Implements pure calculations for the Advise mission on Nations and Habs.
 * Verified against Terra Invicta 1.0 wiki (Nations / Missions) and Notion Page 09.
 */

const { toFiniteNumber } = require('../../shared/util.mjs');
const { getCouncilorAttribute: extractAttr } = require('./odds');

function getCouncilorAttribute(councilor, attrName) {
  const val = extractAttr(councilor, attrName);
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function normalizeGDPInBillions(rawGdp) {
  const gdp = toFiniteNumber(rawGdp) ?? 0;
  if (gdp <= 0) return 0;
  // If raw GDP is in single dollars (> 1 million), convert to billions ($1B = 1e9)
  if (gdp > 1e6) {
    return gdp / 1e9;
  }
  return gdp;
}

/**
 * Computes base Investment Points (IP) for a nation before advisor bonuses.
 *
 * Wiki formula:
 *   base IP = (GDP in billions)^0.35 * (1 - max(unrest - 2, 0) / 10)
 *             - 0.5 * navies - 0.5 * idle_armies - 1.0 * other_armies
 *
 * DO NOT APPLY `nationalIPMultiplier` HERE. This was the one genuine candidate
 * among the custom-difficulty multipliers, because unlike the rest of the
 * dashboard this DERIVES a value rather than reading a measured one, and a
 * derived value cannot inherit a multiplier the save applies. It was therefore
 * tested directly against the save's own `baseInvestmentPoints_month` on
 * 2026-08-21 (docs/campaign-settings-spec.md; indexed in
 * shared/campaignSettings.mjs as CAMPAIGN_SETTING_VERDICTS), on a campaign
 * running national IP at 200%:
 *
 *   across 295 nations, median actual/computed = 1.000
 *   United Malay Nation 25.58 / 25.58, Brazil 19.08 / 19.08, Mexico 17.24 / 17.24
 *
 * The formula already produces the game's real IP. Multiplying here would
 * double a figure that currently matches the save exactly.
 */
function computeBaseIP(nation = {}) {
  const rawGdp = nation.gdp ?? nation.GDP;
  const gdpInBn = normalizeGDPInBillions(rawGdp);
  if (gdpInBn <= 0) return 0;

  const unrest = toFiniteNumber(nation.unrest) ?? 0;
  const navies = toFiniteNumber(nation.navies) ?? 0;

  let idleArmies = 0;
  let otherArmies = 0;

  if (Array.isArray(nation.armies)) {
    idleArmies = nation.armies.filter(a => a?.atHome && !a?.deployed).length;
    otherArmies = nation.armies.length - idleArmies;
  } else {
    const armiesCount = toFiniteNumber(nation.armiesCount ?? nation.armies) ?? 0;
    idleArmies = armiesCount;
    otherArmies = 0;
  }

  const gdpTerm = Math.pow(gdpInBn, 0.35);
  const unrestDrag = Math.max(0, unrest - 2) / 10;
  const unrestFactor = Math.max(0, 1 - unrestDrag);
  const armyNavyDrag = (0.5 * navies) + (0.5 * idleArmies) + (1.0 * otherArmies);

  const baseIP = Math.max(0, (gdpTerm * unrestFactor) - armyNavyDrag);
  return Number(baseIP.toFixed(2));
}

/**
 * Computes Advise bonuses applied to a Nation.
 *
 * Bonuses per turn:
 *   - Administration: +(Adm / n)% to IP production
 *   - Science: +(Sci / n)% to Research output
 *   - Command: +(Cmd / n) / 100 to Miltech growth
 */
function computeAdviseNationBonuses(councilor, nation = {}, n = 1) {
  const divisor = Math.max(1, Number(n) || 1);
  const adm = getCouncilorAttribute(councilor, 'Administration');
  const sci = getCouncilorAttribute(councilor, 'Science');
  const cmd = getCouncilorAttribute(councilor, 'Command');

  const baseIP = computeBaseIP(nation);
  const targetResearch = toFiniteNumber(nation.research ?? nation.monthlyResearch) ?? 0;

  const gainIP = (baseIP * (adm / divisor)) / 100;
  const gainResearch = (targetResearch * (sci / divisor)) / 100;
  const gainMiltech = (cmd / divisor) / 100;

  return {
    targetType: 'nation',
    targetName: nation.displayName || nation.name || 'Nation',
    baseIP,
    gainIP: Number(gainIP.toFixed(2)),
    gainResearch: Number(gainResearch.toFixed(1)),
    gainMiltech: Number(gainMiltech.toFixed(4)),
    divisor,
    effectiveAdm: adm,
    effectiveSci: sci,
    effectiveCmd: cmd
  };
}

/**
 * Computes Advise bonuses applied to a Hab.
 *
 * Bonuses per turn:
 *   - Administration: +(Adm / n)% to Money, Water, Volatiles, Metals, Nobles, Fissiles
 *   - Science: +(Sci / n)% to Research output
 *   - Command: +(Cmd / n)% to Marine Combat Value
 */
const HAB_OUTPUT_KEYS = Object.freeze(['money', 'water', 'volatiles', 'metals', 'nobleMetals', 'fissiles']);

function computeAdviseHabBonuses(councilor, hab = {}, n = 1) {
  const divisor = Math.max(1, Number(n) || 1);
  const adm = getCouncilorAttribute(councilor, 'Administration');
  const sci = getCouncilorAttribute(councilor, 'Science');
  const cmd = getCouncilorAttribute(councilor, 'Command');

  // `?? 0` across every input produced a full, confident bonus sheet of zeros
  // for a hab whose outputs the snapshot never carried -- which is what a
  // station with no mining site actually looks like. Absent stays null and is
  // named, so the caller can tell "advising this hab gains nothing" from
  // "we cannot price advising this hab".
  const measuredInputs = [];
  const unmeasuredInputs = [];

  const habResearch = toFiniteNumber(hab.research);
  if (habResearch === null) unmeasuredInputs.push('research'); else measuredInputs.push('research');
  const gainResearch = habResearch === null
    ? null
    : Number(((habResearch * (sci / divisor)) / 100).toFixed(1));

  const outputs = {};
  for (const res of HAB_OUTPUT_KEYS) {
    const raw = toFiniteNumber(hab[res]);
    if (raw === null) {
      outputs[res] = null;
      unmeasuredInputs.push(res);
      continue;
    }
    measuredInputs.push(res);
    outputs[res] = Number(((raw * (adm / divisor)) / 100).toFixed(2));
  }

  const marineCombat = toFiniteNumber(hab.marineCombatValue ?? hab.combatValue);
  if (marineCombat === null) unmeasuredInputs.push('marineCombat'); else measuredInputs.push('marineCombat');
  const gainCombat = marineCombat === null
    ? null
    : Number(((marineCombat * (cmd / divisor)) / 100).toFixed(2));

  return {
    targetType: 'hab',
    targetName: hab.displayName || hab.name || 'Hab',
    gainResearch,
    outputs,
    gainCombat,
    divisor,
    effectiveAdm: adm,
    effectiveSci: sci,
    effectiveCmd: cmd,
    measuredInputs,
    unmeasuredInputs,
    // False when NOTHING about this hab could be read. A partially measured
    // hab still scores, on the part that was measured.
    inputsMeasured: measuredInputs.length > 0
  };
}

/**
 * Evaluates composite per-turn and cycle score for an Advise assignment.
 */
function evaluateAdviseValue(bonuses, targetType = 'nation') {
  if (!bonuses) return { perTurnValue: 0, score: 0, measured: false };

  // A hab whose every input is absent has no value to report. The score floor
  // below is `Math.max(1.0, ...)`, so an all-null hab used to emerge with a
  // confident 1.0 directive score built from nothing at all.
  if (targetType === 'hab' && bonuses.inputsMeasured === false) {
    return {
      perTurnValue: null,
      score: null,
      measured: false,
      unmeasuredInputs: bonuses.unmeasuredInputs || [],
      unmeasuredReason: `This snapshot carries no resource, research or marine-combat output for `
        + `${bonuses.targetName || 'this hab'}, so the value of advising it cannot be priced.`
    };
  }

  const researchValue = toFiniteNumber(bonuses.gainResearch) ?? 0;
  let ipValue = 0;
  let miltechValue = 0;

  if (targetType === 'nation') {
    // 1 IP is roughly equivalent to 10-15 Research points in national priority output
    ipValue = (toFiniteNumber(bonuses.gainIP) ?? 0) * 12;
    // 0.1 miltech is equivalent to substantial military investment
    miltechValue = (toFiniteNumber(bonuses.gainMiltech) ?? 0) * 400;
  } else if (targetType === 'hab') {
    // Only the measured outputs are summed; a null output contributes nothing
    // and is already named in `unmeasuredInputs`.
    const outputSum = Object.values(bonuses.outputs || {})
      .map(value => toFiniteNumber(value))
      .filter(value => value !== null)
      .reduce((a, b) => a + b, 0);
    ipValue = outputSum * 5;
  }

  const perTurnValue = Number((researchValue + ipValue + miltechValue).toFixed(2));
  // Score calibrated to directive scale (3.0 - 9.0)
  const score = Math.max(1.0, Math.min(9.5, Number((perTurnValue / 28.0).toFixed(2))));

  return {
    perTurnValue,
    score,
    measured: true,
    // Present but incomplete: the score stands on the inputs that were read.
    unmeasuredInputs: bonuses.unmeasuredInputs || []
  };
}

module.exports = {
  computeBaseIP,
  computeAdviseNationBonuses,
  computeAdviseHabBonuses,
  evaluateAdviseValue,
  getCouncilorAttribute
};
