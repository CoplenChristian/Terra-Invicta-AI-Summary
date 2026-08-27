// shared/shipBuildTime.mjs
//
// Purpose: days-to-build for a ship design at a specific shipyard — the hull's
//   base time scaled by the yard's tier gap, the campaign's ship-construction
//   speed setting and the faction's research effects, refusing rather than
//   defaulting when any of those is unreadable.
//
// WHY THIS EXISTS
// ---------------
// `docs/cross-aware-advisor-spec.md` needs one number nobody computed:
// "build X before they arrive" is a race between `arrivals.arrivalDate` (a
// reading) and days-to-build (this file). Both clocks must be known or the
// recommendation is not made -- an unknown build time makes the comparison
// unevaluable, and the honest output is "cannot advise: build time unknown",
// never zero, never "fast", never the arrival date.
//
// WHERE THE FORMULA COMES FROM
// ----------------------------
// Not inferred from field names. Three independent sources, all read
// 2026-08-26, and they agree:
//
//   1. THE GAME CODE. `Assembly-CSharp.dll` (Terra Invicta 1.0, installed
//      build), decompiled with ilspycmd 11.0. `TIShipHullTemplate`:
//
//        public float constructionTime_Days(TIHabModuleState shipyard)
//        {
//            float num = baseConstructionTime_days
//                      * shipyard.moduleTemplate.ShipyardConstructionSpeedModifier(this)
//                      * TIGlobalValuesState.GetShipConstructionTimeSettingsModifier(shipyard.ref_faction);
//            return num + TIEffectsState.SumEffectsModifiers(Context.ShipConstructionTime, shipyard.ref_faction, num);
//        }
//
//      `TIHabModuleTemplate.ShipyardConstructionSpeedModifier(hull)`:
//
//        int num = tier - hullTemplate.consTier;
//        if (num > 0) return Mathf.Pow(constructionTimeModifier, num);
//        if (num < 0) return Mathf.Pow(TemplateManager.global.smallShipyardPenaltyPowerPerTier, -num);
//        return 1f;
//
//      `TIGlobalValuesState.GetShipConstructionTimeSettingsModifier(faction)`
//      returns `1 / scenarioCustomizations.shipConstructionSpeed{Player,
//      HumanAI,Alien}` chosen by whether the faction is the active player, the
//      aliens, or a human AI. `TIEffectsState.SumEffectsModifiers` walks the
//      faction's effects for the context in order, seeded at `num`, and returns
//      `running - num`; every shipped `ShipConstructionTime` effect is
//      `Multiplicative`, so `num + delta` is `num x product(values)`.
//      `TIGlobalConfig.smallShipyardPenaltyPowerPerTier = 1.5f` (a field
//      default -- `TIGlobalConfig.json` does not override it).
//
//   2. THE OFFICIAL WIKI, read as raw wikitext via the MediaWiki API.
//      https://wiki.hoodedhorse.com/Terra_Invicta/Spaceships, "Construction",
//      revision timestamp 2026-05-07T19:37:58Z. Same three branches, and
//      "This construction time is then divided by (100% + Ship Building Speed
//      Bonus)".
//
//   3. THE INSTALLED TEMPLATES at
//      TerraInvicta_Data/StreamingAssets/Templates -- `TIShipHullTemplate.json`
//      (`baseConstructionTime_days`, `consTier`, `noShipyardBuild`) and
//      `TIHabModuleTemplate.json` (`tier`, `constructionTimeModifier`,
//      `allowsShipConstruction`). NOTE the field names the spec guessed do not
//      exist: the file is `TIShipHullTemplate.json` not
//      `TISpaceShipHullTemplate.json`, the flag is `noShipyardBuild` not
//      `noBuild`, and `constructionTimeModifier` lives on the SHIPYARD MODULE,
//      not on the hull.
//
// CROSS-CHECKED AGAINST THE LIVE SAVE, 2026-08-26 (CombatAutosave.gz,
// 12/18/2041). `ShipConstructionQueueItem.daysToCompletion` is initialised to
// `resourcesCost.completionTime_days` and counted down, so an entry that has
// not been paid for (`costPaid: false`) still states its FULL duration. All
// **14 of 14** such rows across five factions reproduce to floating-point
// exactness -- worst absolute error 7.1e-15 days. See
// `tests/shipBuildTime.test.js` for the pinned cases.
//
// WHAT THIS NUMBER DELIBERATELY EXCLUDES
// --------------------------------------
// The figure is construction time at the yard WITH MATERIALS ON HAND. Two
// terms sit outside it and are named in `excludes` rather than folded in:
//
//   * EARTH DELIVERY. `TISpaceShipTemplate.earthResourceConstructionCost` sets
//     `constructionTime_Days(shipyard) + GenericTransferTime_d(faction, Earth,
//     shipyard)` when the build is paid for by substituting boost/money for
//     missing space resources. On the live save 15 of 55 in-progress rows sit
//     above the pure construction figure, which is what that term looks like.
//     The wiki says the same thing in words: "This may increase build time as
//     materials are delivered from Earth."
//   * QUEUE WAIT. Yards build SERIALLY: at most one entry per yard is ever
//     paid, and unpaid entries hold their duration frozen (measured 2026-08-22,
//     recorded in `server/commentary/simulation.js`). A hull queued behind
//     another waits for it. This module answers for one hull at one yard, not
//     for a queue position.
//
// Nothing here reads the filesystem: the module runs unchanged in Node, in the
// Cloudflare Worker and in tests.

import { asArray, round, sameId, toFiniteNumber } from './util.mjs';
import { ALIEN_FACTION_DISPLAY_NAME } from './constants.mjs';

/**
 * Source citation, carried on every result so a reader can check the claim
 * without going back to the commit that added it.
 */
export const SHIP_BUILD_TIME_SOURCES = Object.freeze({
  gameCode: Object.freeze({
    assembly: 'Assembly-CSharp.dll',
    types: Object.freeze([
      'TIShipHullTemplate.constructionTime_Days(TIHabModuleState)',
      'TIHabModuleTemplate.ShipyardConstructionSpeedModifier(TIShipHullTemplate)',
      'TIGlobalValuesState.GetShipConstructionTimeSettingsModifier(TIFactionState)',
      'TIEffectsState.SumEffectsModifiers(Context.ShipConstructionTime, ...)',
      'TIGlobalConfig.smallShipyardPenaltyPowerPerTier'
    ]),
    readOn: '2026-08-26'
  }),
  wiki: Object.freeze({
    url: 'https://wiki.hoodedhorse.com/Terra_Invicta/Spaceships',
    section: 'Construction',
    revision: '2026-05-07T19:37:58Z',
    readOn: '2026-08-26'
  }),
  templates: Object.freeze({
    files: Object.freeze(['TIShipHullTemplate.json', 'TIHabModuleTemplate.json', 'TIEffectTemplate.json']),
    readOn: '2026-08-26'
  }),
  liveCrossCheck: Object.freeze({
    save: 'CombatAutosave.gz',
    campaignDate: '12/18/2041',
    rowsReproduced: 14,
    rowsTested: 14,
    worstAbsoluteErrorDays: 7.1e-15,
    readOn: '2026-08-26'
  })
});

/**
 * The penalty base for building a hull too large for its yard.
 *
 * `TIGlobalConfig.smallShipyardPenaltyPowerPerTier = 1.5f`. It is a FIELD
 * DEFAULT -- `TIGlobalConfig.json` carries no override, so a save cannot move
 * it -- and the wiki states the same 1.5. Raised to the tier shortfall, so a
 * Dreadnought (consTier 3) at a Space Dock (tier 1) takes 1.5^2 = 2.25x its
 * base time before any other modifier.
 */
export const SMALL_SHIPYARD_PENALTY_POWER_PER_TIER = 1.5;

/**
 * Every hab module that can build a ship, with the two numbers that matter.
 *
 * From `TIHabModuleTemplate.json`, filtered on `allowsShipConstruction: true`
 * -- exactly these six, read 2026-08-26. Baked as a constant rather than read
 * at runtime because this module also runs in the Cloudflare Worker, which has
 * no filesystem. A yard whose `templateName` is not in this table is REFUSED,
 * not assumed to be tier 1 at 1.0: a mod or a patch that adds a seventh yard
 * must surface as "unknown yard", never as a confident wrong number.
 */
export const SHIP_CONSTRUCTION_MODULES = Object.freeze({
  SpaceDock: Object.freeze({ tier: 1, constructionTimeModifier: 1, alien: false }),
  Shipyard: Object.freeze({ tier: 2, constructionTimeModifier: 0.8, alien: false }),
  Spaceworks: Object.freeze({ tier: 3, constructionTimeModifier: 0.6, alien: false }),
  AlienSpacedock: Object.freeze({ tier: 1, constructionTimeModifier: 1, alien: true }),
  AlienShipyard: Object.freeze({ tier: 2, constructionTimeModifier: 0.75, alien: true }),
  AlienSpaceworks: Object.freeze({ tier: 3, constructionTimeModifier: 0.5, alien: true })
});

/**
 * The four `ShipConstructionTime` effects and their multipliers.
 *
 * `TIEffectTemplate.json`, read 2026-08-26: these are the ONLY effects whose
 * `contexts` include `ShipConstructionTime`, and all four are
 * `operation: "Multiplicative"` and `stackable: true`.
 *
 * Granted by `Project_RapidShipbuilding` and `Project_AlienAdvancedMasterProject`
 * (x0.8), `Project_TheirRobotics` (x0.95) and three narrative events (x0.9875).
 * A NAME NOT IN THIS TABLE MAKES THE PRODUCT UNKNOWN -- see
 * `shipConstructionEffectsMultiplier`, which refuses rather than skipping it.
 */
export const SHIP_CONSTRUCTION_TIME_EFFECTS = Object.freeze({
  Effect_ShipConstructionTimeReduction: 0.8,
  Effect_ShipConstructionTimeReduction10: 0.9,
  Effect_ShipConstructionTimeReduction5: 0.95,
  Effect_ShipConstructionTimeReductionMinor: 0.9875
});

/**
 * Hulls the game will not let a shipyard build.
 *
 * `TIShipHullTemplate.json` `noShipyardBuild: true`, read 2026-08-26 -- exactly
 * these two, both `simpleHull` strike craft carried by other ships. They are
 * EXCLUDED, never scored: `noShipyardConstructionTime_Days` is a different code
 * path with no yard in it, so a days-to-build for a yard is meaningless here.
 *
 * A caller that knows the flag from data should pass `noShipyardBuild`
 * explicitly on the hull; this list is the fallback, and it is a template
 * reading with a date rather than a guess.
 */
export const NO_SHIPYARD_BUILD_HULLS = Object.freeze(['STOFighter', 'SalamanderGunship']);

/** Reasons a build time cannot be produced. Stable strings; consumers may switch on them. */
export const SHIP_BUILD_REFUSALS = Object.freeze({
  hullUnknown: 'hull-unknown',
  hullBaseTimeUnmeasured: 'hull-base-construction-time-unmeasured',
  hullTierUnmeasured: 'hull-construction-tier-unmeasured',
  hullNotShipyardBuildable: 'hull-not-shipyard-buildable',
  shipyardUnknown: 'shipyard-unknown',
  shipyardNotConstructionModule: 'shipyard-not-a-ship-construction-module',
  shipyardTierUnmeasured: 'shipyard-tier-unmeasured',
  shipyardModifierUnmeasured: 'shipyard-construction-time-modifier-unmeasured',
  factionModifierUnmeasured: 'faction-build-modifier-unmeasured',
  designUnknown: 'design-unknown',
  arrivalUnmeasured: 'days-until-arrival-unmeasured',
  buildDaysUnmeasured: 'build-days-unmeasured'
});

/** Terms this figure deliberately leaves out; named so a consumer can say so. */
export const SHIP_BUILD_EXCLUDED_TERMS = Object.freeze([
  Object.freeze({
    term: 'earth-materials-delivery',
    detail: 'Paying with substituted boost/money adds GenericTransferTime_d(faction, Earth, shipyard) '
      + 'to the construction time (TISpaceShipTemplate.earthResourceConstructionCost). Not modelled here.'
  }),
  Object.freeze({
    term: 'queue-wait',
    detail: 'A yard builds serially, so a hull queued behind another waits for it. This is one hull at one yard.'
  })
]);

const finite = toFiniteNumber;

/**
 * Picks which of the three `shipConstructionSpeed` buckets applies to a faction.
 *
 * The snapshot carries all three readings -- `Player`, `HumanAI`, `Alien` --
 * because the game's `TIGlobalValuesState.GetShipConstructionTimeSettingsModifier`
 * chooses by faction scope. This resolves the scope the same way the game does:
 * the faction the player is playing uses `Player`, the alien faction uses
 * `Alien`, everyone else is `HumanAI`.
 *
 * A plain number (the caller-supplied `shipConstructionSpeed` argument, or a
 * snapshot that pre-resolved the bucket) passes through unchanged. An absent
 * bucket key stays null -- `Number(null) === 0` and `1/0` is Infinity, so an
 * unread speed must reach the formula as null and refuse, never as a confident
 * number.
 *
 * `TIMetadataState.playerFactionName` and the faction's own `displayName` do
 * not always agree letter-for-letter (`"The Initiative"` vs `"the Initiative"`
 * on the live save), so the player match is case- and whitespace-insensitive.
 */
export const resolveShipConstructionSpeed = (raw, snapshot, factionRow) => {
  if (typeof raw === 'number') return raw;
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const metadata = snapshot?.metadata ?? snapshot ?? null;
  const playerName = metadata?.playerFactionName ?? null;
  const name = factionRow?.displayName ?? null;
  const norm = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
  let scope = 'HumanAI';
  if (name !== null && playerName !== null && norm(name) === norm(playerName)) {
    scope = 'Player';
  } else if (name !== null && name === ALIEN_FACTION_DISPLAY_NAME) {
    scope = 'Alien';
  }
  return finite(raw[scope]);
};

/**
 * The yard's tier factor for this hull -- the whole of the game's
 * `ShipyardConstructionSpeedModifier`.
 *
 * `tierGap = shipyardTier - hullConstructionTier`. Positive means the yard is
 * oversized and the hull comes out faster (`ctm ^ gap`); negative means the
 * hull is too big for the yard and it comes out slower (`1.5 ^ -gap`); zero is
 * `1`. Note the ASYMMETRY: the speed-up base is the yard's own modifier, the
 * slow-down base is a single global constant shared by every yard.
 *
 * Refuses on an unmeasured tier or modifier. `Number(null) === 0` would turn
 * an unread tier into "tier 0", which reads as a maximal penalty -- a wrong
 * number pointing the wrong way for a build-or-retreat call.
 */
export const shipyardTierFactor = ({ shipyardTier, constructionTimeModifier, hullConstructionTier } = {}) => {
  const yardTier = finite(shipyardTier);
  const hullTier = finite(hullConstructionTier);
  const modifier = finite(constructionTimeModifier);
  if (yardTier === null) {
    return { available: false, factor: null, tierGap: null, reason: SHIP_BUILD_REFUSALS.shipyardTierUnmeasured };
  }
  if (hullTier === null) {
    return { available: false, factor: null, tierGap: null, reason: SHIP_BUILD_REFUSALS.hullTierUnmeasured };
  }
  const tierGap = yardTier - hullTier;
  if (tierGap === 0) {
    return { available: true, factor: 1, tierGap, basis: 'tier-match', reason: null };
  }
  if (tierGap < 0) {
    return {
      available: true,
      factor: SMALL_SHIPYARD_PENALTY_POWER_PER_TIER ** -tierGap,
      tierGap,
      basis: 'undersized-yard-penalty',
      reason: null
    };
  }
  // Only the speed-up branch needs the yard's own modifier, so an unmeasured
  // modifier is only fatal here -- it cannot silently become a penalty above.
  if (modifier === null) {
    return { available: false, factor: null, tierGap, reason: SHIP_BUILD_REFUSALS.shipyardModifierUnmeasured };
  }
  return { available: true, factor: modifier ** tierGap, tierGap, basis: 'oversized-yard-bonus', reason: null };
};

/**
 * The product of a faction's `ShipConstructionTime` effects.
 *
 * `null` effect list means "not read" and yields unavailable. An EMPTY list is
 * a genuine reading of "this faction holds none", which is x1.0 -- the two must
 * not collapse into each other, which is why `effectNames` being absent and
 * being `[]` take different branches.
 *
 * An unrecognised effect name makes the product UNKNOWN rather than being
 * skipped: skipping it would silently overstate the build time by whatever that
 * effect was worth.
 */
export const shipConstructionEffectsMultiplier = (effectNames) => {
  if (effectNames === null || effectNames === undefined) {
    return { available: false, value: null, applied: null, unrecognised: null, reason: 'ship-construction-effects-not-read' };
  }
  const names = asArray(effectNames);
  const unrecognised = names.filter(name => !Object.prototype.hasOwnProperty.call(SHIP_CONSTRUCTION_TIME_EFFECTS, name));
  if (unrecognised.length > 0) {
    return {
      available: false,
      value: null,
      applied: null,
      unrecognised: Object.freeze(unrecognised.slice()),
      reason: 'ship-construction-effect-not-in-table'
    };
  }
  const value = names.reduce((product, name) => product * SHIP_CONSTRUCTION_TIME_EFFECTS[name], 1);
  return {
    available: true,
    value,
    applied: Object.freeze(names.map(name => Object.freeze({ effect: name, multiplier: SHIP_CONSTRUCTION_TIME_EFFECTS[name] }))),
    unrecognised: Object.freeze([]),
    reason: null
  };
};

/**
 * The faction-wide multiplier: campaign speed setting x research effects.
 *
 * `shipConstructionSpeed` is the raw
 * `TIGlobalValuesState.scenarioCustomizations.shipConstructionSpeed{Player,
 * HumanAI,Alien}` for whichever scope this faction falls in; the game divides
 * by it, so the multiplier it contributes is `1 / speed`. It is a CAMPAIGN
 * SETTING, not a research bonus, and it is NOT safely defaulted to 1: the live
 * campaign runs it at 2, so assuming 1 would double every build estimate.
 *
 * A non-positive speed is rejected rather than divided by -- `1/0` is Infinity
 * and would report a build that never finishes.
 */
export const factionShipBuildModifier = ({ shipConstructionSpeed, effectNames } = {}) => {
  const speed = finite(shipConstructionSpeed);
  const effects = shipConstructionEffectsMultiplier(effectNames);
  if (speed === null) {
    return {
      available: false,
      value: null,
      settingsMultiplier: null,
      shipConstructionSpeed: null,
      effects,
      basis: null,
      reason: 'ship-construction-speed-setting-not-read'
    };
  }
  if (speed <= 0) {
    return {
      available: false,
      value: null,
      settingsMultiplier: null,
      shipConstructionSpeed: speed,
      effects,
      basis: null,
      reason: 'ship-construction-speed-setting-not-positive'
    };
  }
  const settingsMultiplier = 1 / speed;
  if (!effects.available) {
    return {
      available: false,
      value: null,
      settingsMultiplier,
      shipConstructionSpeed: speed,
      effects,
      basis: null,
      reason: effects.reason
    };
  }
  return {
    available: true,
    value: settingsMultiplier * effects.value,
    settingsMultiplier,
    shipConstructionSpeed: speed,
    effects,
    basis: 'settings-and-effects',
    reason: null
  };
};

/**
 * How far two solved multipliers may differ and still be the same reading.
 *
 * NOT a fudge factor, and the size is argued rather than picked. Two things
 * bound it from either side:
 *
 *   * FROM BELOW, a row can be contaminated upward. `daysToCompletion` is reset
 *     by `UpdateResourcesCost` when the pay method changes, and the
 *     Earth-substituted method adds a delivery term, so a queued entry at an
 *     Earth-orbit yard can sit slightly above the pure construction time. Seen
 *     on the committed omniscient fixture: the Protectorate's four waiting
 *     entries solve to 0.400000, 0.400000, 0.400000 and 0.400079 -- the odd one
 *     is 0.0237 days (34 minutes) long, which is what a short transfer looks
 *     like. Contamination is always ADDITIVE, never subtractive.
 *   * FROM ABOVE, two genuinely different multipliers cannot be closer than the
 *     smallest `ShipConstructionTime` effect, `...ReductionMinor` at x0.9875 --
 *     a 1.25% step. A 0.1% window is more than twelve times narrower than the
 *     smallest real difference, so it cannot merge two distinct factions'
 *     answers.
 */
export const CALIBRATION_RELATIVE_TOLERANCE = 1e-3;

/**
 * The same multiplier, SOLVED from the faction's own waiting queue entries.
 *
 * The save states the full duration on every entry that has not been paid for,
 * and this module already knows the template half of the arithmetic exactly, so
 * `observedDays / (baseTime x yardFactor)` recovers the faction multiplier as a
 * MEASUREMENT rather than an assumption. That matters because the snapshot does
 * not currently carry either input to `factionShipBuildModifier`.
 *
 * Rows that disagree by more than `CALIBRATION_RELATIVE_TOLERANCE` return
 * unavailable with the spread -- never an average, because the mean of two
 * contradictory readings is a fabricated third one. Rows that agree are
 * reported at their MINIMUM, not their mean: every term this module excludes
 * adds days rather than removing them, so the smallest solved value is the least
 * contaminated one. The spread ships beside it either way.
 */
export const calibrateFactionShipBuildModifier = ({ rows, tolerance = CALIBRATION_RELATIVE_TOLERANCE } = {}) => {
  const usable = [];
  const skipped = [];
  for (const row of asArray(rows)) {
    const observed = finite(row?.observedDays);
    const base = finite(row?.baseConstructionTimeDays);
    const gap = shipyardTierFactor({
      shipyardTier: row?.shipyardTier,
      constructionTimeModifier: row?.constructionTimeModifier,
      hullConstructionTier: row?.hullConstructionTier
    });
    if (observed === null || base === null || base <= 0 || !gap.available || gap.factor === 0) {
      skipped.push({ id: row?.id ?? null, reason: gap.available ? 'unmeasured-input' : gap.reason });
      continue;
    }
    usable.push({ id: row?.id ?? null, solved: observed / (base * gap.factor), observedDays: observed });
  }
  if (usable.length === 0) {
    return {
      available: false,
      value: null,
      rowsUsed: 0,
      rowsSkipped: skipped.length,
      skipped: Object.freeze(skipped),
      spread: null,
      basis: null,
      reason: 'no-full-duration-queue-rows-for-faction'
    };
  }
  const values = usable.map(row => row.solved);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Relative, so the window scales with the multiplier rather than meaning
  // something different at 0.4 than at 0.99. `min` is positive here: every
  // contributing row had a positive base time and a non-zero yard factor.
  if ((max - min) / min > tolerance) {
    return {
      available: false,
      value: null,
      rowsUsed: usable.length,
      rowsSkipped: skipped.length,
      skipped: Object.freeze(skipped),
      spread: Object.freeze({ min, max, relative: (max - min) / min }),
      basis: null,
      reason: 'calibration-rows-disagree'
    };
  }
  return {
    available: true,
    value: min,
    rowsUsed: usable.length,
    rowsSkipped: skipped.length,
    skipped: Object.freeze(skipped),
    spread: Object.freeze({ min, max, relative: (max - min) / min }),
    basis: 'calibrated-from-queue',
    reason: null
  };
};

/**
 * The template-grounded half of the answer, published only alongside a refusal
 * caused by the faction modifier and NEVER as `days`.
 *
 * `base x yardFactor` is fully known whenever the hull and the yard resolve --
 * both halves are template readings. What is missing in that case is the
 * campaign speed setting and the research effects, and both only ever REDUCE
 * the time, so the template figure is a stated upper bound and not a guess.
 *
 * It sits under its own key with its own caveat so a reader can see how far off
 * the real number might be, while `available: false` and `days: null` keep it
 * out of any comparison. Folding it into `days` would be the "confident default
 * for an unmeasured value" this whole module exists to avoid: on the live
 * campaign the modifier is 0.38, so the unmodified figure is 2.6x too long.
 */
const unmodifiedProjection = (baseDays, yardFactor) => {
  const base = finite(baseDays);
  const factor = finite(yardFactor);
  if (base === null || factor === null) return null;
  return Object.freeze({
    days: Math.ceil(base * factor),
    daysExact: base * factor,
    caveat: 'UNMODIFIED: the campaign ship-construction-speed setting and the faction\'s '
      + 'ShipConstructionTime research effects were not read. Both only reduce the time, so '
      + 'this is an upper bound, not the build time. Do not race an arrival against it.'
  });
};

const refusal = (reason, inputs, unmodified = null) => Object.freeze({
  available: false,
  days: null,
  daysExact: null,
  reason,
  inputs: Object.freeze(inputs),
  yardFactor: null,
  factionModifier: null,
  unmodified,
  excludes: SHIP_BUILD_EXCLUDED_TERMS,
  sources: SHIP_BUILD_TIME_SOURCES
});

/**
 * Days until one hull of this design is fielded from this yard.
 *
 * days = baseConstructionTime_days
 *      x shipyardTierFactor(yard, hull)
 *      x factionModifier            (1 / speed setting, then the effect product)
 *
 * Reported as WHOLE DAYS by ceiling: a build that finishes 36.48 days out is
 * not finished on day 36, and for a race against an arrival the safe rounding
 * is the later one. `daysExact` is beside it, along with every input, so the
 * arithmetic can be checked by hand.
 *
 * `noShipyardBuild` hulls are refused, not scored -- the game builds those on a
 * different code path with no shipyard in it.
 */
export const estimateShipBuildDays = ({ hull, shipyard, factionModifier } = {}) => {
  const hullName = hull?.name ?? hull?.hullName ?? null;
  const inputs = {
    hullName,
    baseConstructionTimeDays: null,
    hullConstructionTier: null,
    shipyardTemplateName: shipyard?.templateName ?? null,
    shipyardTier: null,
    shipyardConstructionTimeModifier: null,
    smallShipyardPenaltyPowerPerTier: SMALL_SHIPYARD_PENALTY_POWER_PER_TIER
  };

  if (!hull) return refusal(SHIP_BUILD_REFUSALS.hullUnknown, inputs);

  const noShipyardBuild = hull.noShipyardBuild === undefined || hull.noShipyardBuild === null
    ? NO_SHIPYARD_BUILD_HULLS.includes(hullName)
    : hull.noShipyardBuild === true;
  if (noShipyardBuild) return refusal(SHIP_BUILD_REFUSALS.hullNotShipyardBuildable, inputs);

  const baseDays = finite(hull.baseConstructionTimeDays ?? hull.baseConstructionTime_days);
  inputs.baseConstructionTimeDays = baseDays;
  if (baseDays === null) return refusal(SHIP_BUILD_REFUSALS.hullBaseTimeUnmeasured, inputs);

  const hullTier = finite(hull.constructionTier ?? hull.consTier);
  inputs.hullConstructionTier = hullTier;
  if (hullTier === null) return refusal(SHIP_BUILD_REFUSALS.hullTierUnmeasured, inputs);

  if (!shipyard) return refusal(SHIP_BUILD_REFUSALS.shipyardUnknown, inputs);

  // A yard resolves either from an explicitly supplied tier/modifier pair or
  // from its template name in the table above. An unrecognised template name is
  // an unknown module, not a default one.
  const template = inputs.shipyardTemplateName
    ? SHIP_CONSTRUCTION_MODULES[inputs.shipyardTemplateName] ?? null
    : null;
  const yardTier = finite(shipyard.tier ?? template?.tier);
  const yardModifier = finite(shipyard.constructionTimeModifier ?? template?.constructionTimeModifier);
  inputs.shipyardTier = yardTier;
  inputs.shipyardConstructionTimeModifier = yardModifier;
  if (yardTier === null) {
    return refusal(
      inputs.shipyardTemplateName && !template
        ? SHIP_BUILD_REFUSALS.shipyardNotConstructionModule
        : SHIP_BUILD_REFUSALS.shipyardTierUnmeasured,
      inputs
    );
  }

  const gap = shipyardTierFactor({
    shipyardTier: yardTier,
    constructionTimeModifier: yardModifier,
    hullConstructionTier: hullTier
  });
  if (!gap.available) return refusal(gap.reason, inputs);

  const modifier = factionModifier && factionModifier.available === true
    ? finite(factionModifier.value)
    : null;
  if (modifier === null) {
    return refusal(
      SHIP_BUILD_REFUSALS.factionModifierUnmeasured,
      inputs,
      unmodifiedProjection(baseDays, gap.factor)
    );
  }

  const daysExact = baseDays * gap.factor * modifier;
  return Object.freeze({
    available: true,
    days: Math.ceil(daysExact),
    daysExact,
    reason: null,
    unmodified: null,
    inputs: Object.freeze(inputs),
    yardFactor: Object.freeze({ factor: gap.factor, tierGap: gap.tierGap, basis: gap.basis }),
    factionModifier: Object.freeze({
      value: modifier,
      basis: factionModifier.basis ?? null,
      settingsMultiplier: factionModifier.settingsMultiplier ?? null,
      shipConstructionSpeed: factionModifier.shipConstructionSpeed ?? null,
      effects: factionModifier.effects ?? null,
      rowsUsed: factionModifier.rowsUsed ?? null
    }),
    excludes: SHIP_BUILD_EXCLUDED_TERMS,
    sources: SHIP_BUILD_TIME_SOURCES
  });
};

/**
 * Whole days between two campaign instants, or null if either is unreadable.
 *
 * The arrival half of the race. Kept here so the comparison has one definition
 * of "days until"; a negative result means the arrival is already past and is
 * returned as such rather than clamped to zero.
 */
export const daysUntil = (fromDate, toDate) => {
  const from = fromDate instanceof Date ? fromDate : new Date(String(fromDate ?? ''));
  const to = toDate instanceof Date ? toDate : new Date(String(toDate ?? ''));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return (to.getTime() - from.getTime()) / 86400000;
};

/**
 * The race the advisor actually asks about: can this hull be fielded before
 * that fleet gets here?
 *
 * BOTH clocks must be readings. If either is absent the verdict is `null` with
 * a reason -- never "yes", never "no", never a comparison against a stand-in.
 * `docs/cross-aware-advisor-spec.md` names this the failure mode that would
 * make the whole feature wrong, and this is the one place it can happen.
 */
export const buildBeatsArrival = ({ buildDays, daysUntilArrival } = {}) => {
  const build = finite(buildDays);
  const arrival = finite(daysUntilArrival);
  if (build === null) {
    return { available: false, verdict: null, marginDays: null, buildDays: null, daysUntilArrival: arrival, reason: SHIP_BUILD_REFUSALS.buildDaysUnmeasured };
  }
  if (arrival === null) {
    return { available: false, verdict: null, marginDays: null, buildDays: build, daysUntilArrival: null, reason: SHIP_BUILD_REFUSALS.arrivalUnmeasured };
  }
  const marginDays = round(arrival - build, 2);
  return {
    available: true,
    verdict: build < arrival ? 'build-lands-first' : build > arrival ? 'arrival-first' : 'simultaneous',
    marginDays,
    buildDays: build,
    daysUntilArrival: arrival,
    reason: null
  };
};

/**
 * Hull statistics as the snapshot carries them.
 *
 * `snapshot.shipHullStats` is a map keyed by hull dataName carrying
 * `baseConstructionTimeDays` and `constructionTier` -- both of the template
 * numbers this file needs. It does NOT carry `noShipyardBuild`, so that falls
 * back to the cited constant list.
 */
export const hullFromSnapshot = (snapshot, hullName) => {
  const stats = snapshot?.shipHullStats;
  if (!stats || typeof stats !== 'object' || !hullName) return null;
  const row = stats[hullName];
  if (!row) return null;
  return {
    name: hullName,
    baseConstructionTimeDays: finite(row.baseConstructionTimeDays),
    constructionTier: finite(row.constructionTier),
    noShipyardBuild: NO_SHIPYARD_BUILD_HULLS.includes(hullName)
  };
};

/**
 * A design's hull class.
 *
 * The queue row's `hull` field is a MISNOMER -- `buildShipyardQueues` sets both
 * `design` and `hull` to the DESIGN template name -- so a design has to be
 * looked up in `shipDesigns` to find its actual hull. Returns null rather than
 * a guess when the design is not on the snapshot (an enemy design redacted in
 * player mode reaches here as absent, and absent is not "Frigate").
 *
 * TEMPLATE NAMES FIRST, AND DISPLAY NAMES ONLY IF UNIQUE. `dataName` is the
 * save's identity and cannot collide; `_displayName` is a player-chosen label
 * and two factions can and do pick the same one. Taking the first display-name
 * match would hand back another faction's hull class silently -- the same
 * identity-collision shape that once collapsed 303 mission candidates to 1.
 */
export const hullNameForDesign = (snapshot, designName) => {
  if (!designName) return null;
  const designs = asArray(snapshot?.shipDesigns);
  for (const design of designs) {
    if (design?.dataName === designName || design?.templateName === designName) {
      return design?.hullName ?? null;
    }
  }
  const byDisplayName = designs.filter(design => design?._displayName === designName);
  if (byDisplayName.length === 1) return byDisplayName[0]?.hullName ?? null;
  return null;
};

/**
 * A yard from the snapshot, by module id.
 *
 * Reads `shipyardStations` first (the collection `/api/intel/shipyards`
 * serves) and falls back to `habModules`. `habTier` on those rows is the HAB's
 * tier, NOT the module's -- the two are different numbers and only the module's
 * belongs in this formula -- so the tier comes from `templateName` through
 * `SHIP_CONSTRUCTION_MODULES`.
 */
export const shipyardFromSnapshot = (snapshot, shipyardId) => {
  const search = [...asArray(snapshot?.shipyardStations), ...asArray(snapshot?.habModules)];
  const row = search.find(item => sameId(item?.id, shipyardId));
  if (!row) return null;
  const template = SHIP_CONSTRUCTION_MODULES[row.templateName] ?? null;
  return {
    id: row.id ?? null,
    templateName: row.templateName ?? null,
    factionId: row.factionId ?? null,
    habName: row.habName ?? null,
    orbitBody: row.orbitBody ?? null,
    spaceTheaterKey: row.spaceTheaterKey ?? null,
    constructionStatus: row.constructionStatus ?? null,
    tier: template?.tier ?? null,
    constructionTimeModifier: template?.constructionTimeModifier ?? null
  };
};

/**
 * Calibration rows for one faction, assembled from the snapshot's own queues.
 *
 * Only entries with `costPaid === false` are usable: those state their full
 * duration, while a paid entry has been counting down since it started and a
 * refit carries an extra duration term of its own.
 */
export const calibrationRowsFromSnapshot = (snapshot, factionId) => {
  const rows = [];
  for (const queue of asArray(snapshot?.shipyardQueues)) {
    if (!sameId(queue?.factionId, factionId)) continue;
    if (queue?.costPaid !== false) continue;
    if (queue?.isRefit === true) continue;
    const hullName = hullNameForDesign(snapshot, queue?.design);
    const hull = hullFromSnapshot(snapshot, hullName);
    const yard = shipyardFromSnapshot(snapshot, queue?.shipyardId);
    if (!hull || !yard) continue;
    rows.push({
      id: queue?.id ?? null,
      observedDays: finite(queue?.daysToCompletion),
      baseConstructionTimeDays: hull.baseConstructionTimeDays,
      hullConstructionTier: hull.constructionTier,
      shipyardTier: yard.tier,
      constructionTimeModifier: yard.constructionTimeModifier
    });
  }
  return rows;
};

/**
 * Days-to-build straight from a snapshot.
 *
 * THE FACTION MULTIPLIER IS THE HARD PART, and the order below is deliberate:
 *
 *   1. `shipConstructionSpeed` + `effectNames` supplied by the caller, or found
 *      on the snapshot at `campaignSettings.shipConstructionSpeed{Player,
 *      HumanAI,Alien}` (resolved to the owner's bucket) /
 *      `factions[].shipConstructionTimeEffects`. This is the exact route, wired
 *      through `server/snapshot/`: the setting is read from
 *      `TIGlobalValuesState.scenarioCustomizations` and the effects from
 *      `TIEffectsState.factionEffectsNames[].Value.ShipConstructionTime`. In
 *      player mode the observer's OWN effects survive the intel filter while
 *      every rival's are redacted to ABSENT -- so a rival whose build time is
 *      requested reaches the refusal below rather than a number computed from
 *      a speed it was allowed to read and an effect list it was not.
 *   2. Otherwise CALIBRATE from that faction's own waiting queue entries. This
 *      is a measurement, exact where it applies, and it is what lets the module
 *      answer when the direct reading is absent (a stale snapshot, or a
 *      redacted rival with visible queue rows in enhanced mode).
 *   3. Otherwise REFUSE. Not 1.0, not the template base -- the live campaign
 *      runs the speed setting at 2, so a "1.0" default would report every
 *      build as taking twice as long as it does.
 */
export const shipBuildDaysFromSnapshot = (snapshot, {
  designName = null,
  hullName = null,
  shipyardId = null,
  factionId = null,
  shipConstructionSpeed = null,
  effectNames = null
} = {}) => {
  const resolvedHullName = hullName ?? hullNameForDesign(snapshot, designName);
  if (designName && !resolvedHullName) {
    return refusal(SHIP_BUILD_REFUSALS.designUnknown, {
      hullName: null,
      baseConstructionTimeDays: null,
      hullConstructionTier: null,
      shipyardTemplateName: null,
      shipyardTier: null,
      shipyardConstructionTimeModifier: null,
      smallShipyardPenaltyPowerPerTier: SMALL_SHIPYARD_PENALTY_POWER_PER_TIER,
      designName
    });
  }
  const hull = hullFromSnapshot(snapshot, resolvedHullName);
  const shipyard = shipyardFromSnapshot(snapshot, shipyardId);
  const owner = factionId ?? shipyard?.factionId ?? null;

  const settings = snapshot?.campaignSettings ?? snapshot?.metadata?.campaignSettings ?? null;
  const factionRow = asArray(snapshot?.factions).find(item => sameId(item?.ID, owner)) ?? null;
  // The campaign-global `shipConstructionSpeed{Player,HumanAI,Alien}` setting,
  // resolved to the owner's bucket. `resolveShipConstructionSpeed` accepts the
  // caller-supplied number, a pre-resolved snapshot number, or the three-bucket
  // object the snapshot's campaignSettings carries.
  const speed = resolveShipConstructionSpeed(
    shipConstructionSpeed
      ?? settings?.shipConstructionSpeed
      ?? settings?.settings?.shipConstructionSpeed?.value
      ?? null,
    snapshot,
    factionRow
  );
  const effects = effectNames ?? factionRow?.shipConstructionTimeEffects ?? null;

  let modifier = factionShipBuildModifier({ shipConstructionSpeed: speed, effectNames: effects });
  if (!modifier.available) {
    const calibrated = calibrateFactionShipBuildModifier({ rows: calibrationRowsFromSnapshot(snapshot, owner) });
    if (calibrated.available) modifier = calibrated;
  }
  return estimateShipBuildDays({ hull, shipyard, factionModifier: modifier });
};
