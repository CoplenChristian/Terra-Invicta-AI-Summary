// shared/campaignSettings.mjs
//
// Purpose: parse the save's two campaign-customisation blocks and label a
//   customised campaign so no surface renders one as a stock difficulty.
//
// `TIMetadataState` carries a `customDifficulty` flag and nine tuning values
// beside the `difficulty` label. Only the label was ever baked, so a campaign
// running four rates at 200% presented itself as plain "Normal" -- and anyone
// comparing this dashboard's figures against a stock-difficulty reference drew
// the wrong conclusion from a field that was, strictly, telling the truth.
//
// `TIGlobalValuesState.scenarioCustomizations` carries a second block of
// nineteen values, distinct in shape and meaning: speed multipliers as bare
// numbers (NOT the "200%" string the metadata block uses) and boolean mode
// flags. This module reads both blocks, with the strict parsers each shape
// demands. The armour-scaling mode flag from this block is also resolved
// into the nose/tail/side multipliers the ship designer depends on -- a
// wrong value here is a 3x error on the heaviest part of a ship.
//
// THE PARSE TRAP, PART ONE -- the metadata block. These values are STRINGS:
// "200%", "150", "0", "5". `Number("200%")` is `NaN`, so the usual
// `Number(x) ?? 0` / `|| 0` idiom yields a confident **zero** -- worse than
// no multiplier at all, because a zero annihilates whatever it touches. This
// is the third instance of the class in this repo (comma-formatted `req
// power` on 92 drives, and the `researchCost: -1` sentinels), so the parse
// here is deliberately strict: strip one trailing `%` and any thousands
// separators, require what remains to be a bare numeral, and report anything
// else as `null`. Never `0`, never a silent `1`.
//
// THE PARSE TRAP, PART TWO -- the scenario block. These values are NOT
// strings: `2.0` is `2.0`, `true` is `true`. A bare `Number("2.0") === 2.0`
// is fine, but `parseCampaignSettingNumber` would still accept a string,
// which is the wrong path for this block. A boolean MUST NOT be coerced to
// a number (`Number(true) === 1`, `Number(false) === 0`): a mode flag read
// as the number 1 collapses Cinematic/Realistic/Unknown into the same
// reading, and the armour multipliers that depend on it become a 3x error.
// The scenario parsers are therefore separate and stricter: they accept
// only what the save actually carries (finite numbers, true/false booleans)
// and report anything else as `null` -- never `0`, never `1`, never a silent
// fallback.
//
// NOTHING HERE IS CAMPAIGN-SPECIFIC. The stock comparison values are the
// arithmetic identities of each kind -- 100% is the multiplier that changes
// nothing, 0 is the bonus that adds nothing, and 1.0 is the speed that
// finishes the build in the standard time -- not this campaign's numbers.
// `averageMonthlyEvents` and `randomizedMapSeed` carry no identity value, so
// their stock values are recorded as unknown and they are never claimed to
// be either stock or not.

/** How a setting's numeral is to be read, and what value would leave it stock. */
export const SETTING_KINDS = Object.freeze({
  /** A percentage multiplier. 100% is the identity. */
  percent: 'percent',
  /** A flat additive bonus. 0 is the identity. */
  flatBonus: 'flat-bonus',
  /** A bare rate with no identity value; stock-ness is not determinable. */
  rate: 'rate',
  /**
   * A boolean flag rather than a numeral. Tri-state: `true`, `false`, or `null`
   * when unreadable. `null` MUST NOT collapse into `false`: an undetermined flag
   * rendered as off is the same defect class as an unmeasured value rendered as
   * zero -- a confident answer the data does not support.
   */
  flag: 'flag',
  /**
   * A bare-number speed multiplier stored on `TIGlobalValuesState.scenarioCustomizations`.
   * 1.0 is the identity -- the game divides build time by it, so 1.0 = stock
   * speed, 2.0 = builds complete in half the time, 0.5 = twice the time. These
   * are NOT percentages and are NOT strings: the save carries `2.0` as a bare
   * number, not `"200%"`. The metadata-block percent parser would still accept
   * them but is the wrong reader, so the scenario block uses its own.
   */
  speedMultiplier: 'speed-multiplier',
  /**
   * A bare integer with no identity value (e.g. `randomizedMapSeed`). Carries
   * stockValue `null` so it is never claimed to be either stock or not.
   */
  integer: 'integer',
  /**
   * A boolean MODE selector -- distinct from a `flag` in that a mode picks one
   * of several known branches of derived behaviour. `cinematicCombatRealismScale`
   * is the load-bearing example: `true` = Cinematic (nose/tail x1, side x0.75),
   * `false` = Realistic (nose/tail x3, side x0.5), `null` = unreadable. The
   * boolean is NOT a multiplier itself -- the multipliers are DERIVED from it --
   * which is why the kind is separate and the parse refuses `Number(true)` /
   * `Number(false)` coercions that would collapse the three states.
   */
  mode: 'mode'
});

/**
 * The ten fields of the custom-difficulty block, in the order `TIMetadataState`
 * declares them, with the short label each renders under.
 *
 * `stockValue: null` means "this kind has no identity value", NOT "stock is
 * zero" -- the two must not be confused, because the second would silently
 * report a five-event campaign as a stock one.
 */
export const CAMPAIGN_SETTING_FIELDS = Object.freeze([
  Object.freeze({ key: 'customDifficulty', label: 'custom difficulty', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'researchSpeedMultiplier', label: 'research speed', kind: SETTING_KINDS.percent, stockValue: 100 }),
  Object.freeze({ key: 'miningProductivityMultiplier', label: 'mining productivity', kind: SETTING_KINDS.percent, stockValue: 100 }),
  Object.freeze({ key: 'nationalIPMultiplier', label: 'national IP', kind: SETTING_KINDS.percent, stockValue: 100 }),
  Object.freeze({ key: 'alienProgressionSpeed', label: 'alien progression', kind: SETTING_KINDS.percent, stockValue: 100 }),
  Object.freeze({ key: 'controlPointMaintenanceFreebieBonus', label: 'CP maintenance freebie', kind: SETTING_KINDS.flatBonus, stockValue: 0 }),
  Object.freeze({ key: 'controlPointMaintenanceFreebieBonusAI', label: 'CP maintenance freebie (AI)', kind: SETTING_KINDS.flatBonus, stockValue: 0 }),
  Object.freeze({ key: 'missionControlBonus', label: 'mission control bonus', kind: SETTING_KINDS.flatBonus, stockValue: 0 }),
  Object.freeze({ key: 'missionControlBonusAI', label: 'mission control bonus (AI)', kind: SETTING_KINDS.flatBonus, stockValue: 0 }),
  Object.freeze({ key: 'averageMonthlyEvents', label: 'average monthly events', kind: SETTING_KINDS.rate, stockValue: null })
]);

/** The nine numeric fields, i.e. everything but the boolean flag. */
export const CAMPAIGN_SETTING_NUMERIC_FIELDS = Object.freeze(
  CAMPAIGN_SETTING_FIELDS.filter(field => field.kind !== SETTING_KINDS.flag)
);

/**
 * The nineteen fields of `TIGlobalValuesState.scenarioCustomizations`, in
 * roughly the order the save's IL names them. Distinct from
 * `CAMPAIGN_SETTING_FIELDS` because:
 *   - the values arrive as bare numbers and booleans, NOT as `"200%"` strings;
 *   - the kinds are `speed-multiplier`, `mode`, `flag` or `integer` -- not the
 *     metadata block's `percent`/`flat-bonus`/`rate` set;
 *   - three of the keys (`shipConstructionSpeed{Player,HumanAI,Alien}`) are
 *     ALSO consumed at the snapshot level as `campaignSettings.shipConstructionSpeed`,
 *     and the merged block keeps both shapes so no consumer has to move.
 *
 * `researchSpeedMultiplier` appears in BOTH blocks -- as `"200%"` on the
 * metadata block and as `2.0` on the scenario block. The metadata value is
 * authoritative for the existing nine fields and that read must stay
 * byte-identical (docs/campaign-settings-spec.md, overturned verdict). The
 * scenario-block reading is NOT included here.
 */
export const SCENARIO_CUSTOMIZATION_FIELDS = Object.freeze([
  // Armour scaling mode. `true` -> Cinematic (nose/tail x1, side x0.75),
  // `false` -> Realistic (nose/tail x3, side x0.5). The boolean is read for
  // `armourMultipliers` derivation; consumers should never re-derive the
  // multipliers themselves, because a wrong derivation is a 3x error on the
  // heaviest part of a ship (docs/ship-designer-spec.md, section 6c).
  Object.freeze({ key: 'cinematicCombatRealismScale', label: 'cinematic realism', kind: SETTING_KINDS.mode, stockValue: null }),
  Object.freeze({ key: 'cinematicCombatRealismDV', label: 'cinematic realism (delta-V)', kind: SETTING_KINDS.mode, stockValue: null }),
  // Hab-construction speed. Game divides build time by this; 1.0 = stock.
  Object.freeze({ key: 'habConstructionSpeedPlayer', label: 'hab construction speed (Player)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  Object.freeze({ key: 'habConstructionSpeedHumanAI', label: 'hab construction speed (Human AI)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  Object.freeze({ key: 'habConstructionSpeedAlien', label: 'hab construction speed (Alien)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  // Ship-construction speed. Same semantics as hab -- game divides build time
  // by this. These three also feed `campaignSettings.shipConstructionSpeed`,
  // which the merged block carries at the top level for the existing consumer.
  Object.freeze({ key: 'shipConstructionSpeedPlayer', label: 'ship construction speed (Player)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  Object.freeze({ key: 'shipConstructionSpeedHumanAI', label: 'ship construction speed (Human AI)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  Object.freeze({ key: 'shipConstructionSpeedAlien', label: 'ship construction speed (Alien)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  // Mining rate. DISTINCT from `miningProductivityMultiplier` ("200%") on the
  // metadata block: that one multiplies the productivity of the produced
  // resources, this one is the speed at which the mine extracts. They share
  // the identity value (1.0 == 100%) but measure different things, so they
  // are NOT interchangeable (docs/ship-designer-spec.md, section 6c table).
  Object.freeze({ key: 'miningRatePlayer', label: 'mining rate (Player)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  Object.freeze({ key: 'miningRateHumanAI', label: 'mining rate (Human AI)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  Object.freeze({ key: 'miningRateAlien', label: 'mining rate (Alien)', kind: SETTING_KINDS.speedMultiplier, stockValue: 1.0 }),
  // Mode flags. Each one toggles a piece of campaign-level behaviour that
  // nothing in this repo currently consumes, but they are part of what the
  // save records so a future model is not reduced to guessing them.
  Object.freeze({ key: 'variableProjectUnlocks', label: 'variable project unlocks', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'showTriggeredProjects', label: 'show triggered projects', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'addAlienAssaultCarrierFleet', label: 'add alien assault carrier fleet', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'otherFactionStartingNations', label: 'other faction starting nations', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'usePlayerCountryForStartingCouncilor', label: 'use player country for starting councilor', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'canDisableFactions', label: 'can disable factions', kind: SETTING_KINDS.flag, stockValue: null }),
  Object.freeze({ key: 'randomizeMap', label: 'randomize map', kind: SETTING_KINDS.flag, stockValue: null }),
  // A bare integer; carries no identity value so stock-ness is not claimed.
  Object.freeze({ key: 'randomizedMapSeed', label: 'randomized map seed', kind: SETTING_KINDS.integer, stockValue: null })
]);

/** Numeric fields on the scenario block: speed multipliers and the integer seed. */
export const SCENARIO_CUSTOMIZATION_NUMERIC_FIELDS = Object.freeze(
  SCENARIO_CUSTOMIZATION_FIELDS.filter(field =>
    field.kind === SETTING_KINDS.speedMultiplier || field.kind === SETTING_KINDS.integer
  )
);

/** Boolean fields on the scenario block: mode selectors and flag toggles. */
export const SCENARIO_CUSTOMIZATION_BOOLEAN_FIELDS = Object.freeze(
  SCENARIO_CUSTOMIZATION_FIELDS.filter(field =>
    field.kind === SETTING_KINDS.flag || field.kind === SETTING_KINDS.mode
  )
);
// A bare decimal numeral, optionally signed, optionally with thousands
// separators already removed by the caller. Anchored on purpose: `Number('')`
// and `Number(' ')` are both 0, and either would turn an unreadable setting
// into a confident zero.
const BARE_NUMERAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * Parses one custom-difficulty value into a number, or `null` when it cannot be
 * read.
 *
 * Accepts `"200%"`, `"150"`, `"1,200"`, `-3`, and `12.5`. Rejects `""`, `"%"`,
 * `"abc"`, `null`, `undefined`, `NaN`, `Infinity` and booleans -- every one of
 * which becomes `null`, never `0`.
 *
 * @param {*} raw the value exactly as the save carried it
 * @returns {number|null} the numeral as written (`"200%"` -> `200`), or null
 */
export function parseCampaignSettingNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  let text = raw.trim();
  if (text === '') return null;
  if (text.endsWith('%')) text = text.slice(0, -1).trim();
  text = text.replace(/,/g, '');
  if (!BARE_NUMERAL.test(text)) return null;

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses the `customDifficulty` flag.
 *
 * Returns `null` rather than `false` when the field is absent or unreadable: a
 * campaign whose customisation cannot be determined is not the same as one
 * known to be stock, and only the second may be rendered without a marker.
 */
export function parseCampaignSettingFlag(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return null;
}

/**
 * Strict reader for one numeric value on `TIGlobalValuesState.scenarioCustomizations`.
 *
 * The save carries these as **bare JS numbers** (`2.0`, `1.0`, `0`), so this
 * parser is tighter than `parseCampaignSettingNumber` in two ways:
 *
 *   1. Strings are NOT accepted. `"2.0"` reads as `2.0` in JS but is the wrong
 *      shape: the metadata-block reader exists precisely because the metadata
 *      values arrive as strings, and the scenario block is different. If the
 *      save ever starts writing these as strings (template change, save
 *      migration), the value MUST refuse and the consumer should know, not
 *      silently accept what the wrong reader would have accepted.
 *
 *   2. Booleans are NOT coerced. `Number(true) === 1` and `Number(false) === 0`,
 *      which would collapse `miningRatePlayer = true` and `miningRatePlayer = 1`
 *      to the same reading. They are different values; the parser must keep
 *      them different.
 *
 * Accepts only finite JS numbers. Rejects everything else -- including `null`,
 * `undefined`, `NaN`, `Infinity`, strings, booleans, arrays, objects.
 *
 * @param {*} raw the value exactly as the save carried it
 * @returns {number|null} the finite number, or null when unreadable
 */
export function parseScenarioCustomizationNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  return null;
}

/**
 * Strict reader for one boolean value on `TIGlobalValuesState.scenarioCustomizations`.
 *
 * Identical to `parseCampaignSettingFlag` but kept separate so the two parsers
 * cannot silently drift apart. Same tri-state: `true`, `false`, or `null`.
 * A mode flag read as `null` MUST be reported as unavailable, never as `false`:
 * "unknown is not the same as stock" -- an undetermined mode collapses Cinematic,
 * Realistic and "cannot tell" into a single reading and breaks the armour
 * multipliers that depend on it.
 *
 * @param {*} raw the value exactly as the save carried it
 * @returns {boolean|null}
 */
export function parseScenarioCustomizationBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return null;
}

/**
 * Picks the right scenario parser for one field. Numeric kinds
 * (`speed-multiplier`, `integer`) go through `parseScenarioCustomizationNumber`;
 * boolean kinds (`flag`, `mode`) through `parseScenarioCustomizationBoolean`.
 *
 * The dispatch exists so a future caller never has to know which parser a
 * given kind wants -- and so a misuse (passing a numeric parser a `flag` or
 * vice versa) shows up at the field declaration, not in a deeper stack.
 *
 * @param {Object} field a `SCENARIO_CUSTOMIZATION_FIELDS` entry
 * @param {*} raw the raw value as the save carried it
 * @returns {number|boolean|null}
 */
export function parseScenarioCustomizationValue(field, raw) {
  if (field.kind === SETTING_KINDS.flag || field.kind === SETTING_KINDS.mode) {
    return parseScenarioCustomizationBoolean(raw);
  }
  return parseScenarioCustomizationNumber(raw);
}

/**
 * The armour scaling mode, derived from `cinematicCombatRealismScale`.
 *
 * The save records the campaign's pick as a boolean flag; the actual armour
 * multipliers the game applies are DERIVED from it:
 *
 *   - `true`  -> Cinematic: nose x1, tail x1, side x0.75
 *   - `false` -> Realistic: nose x3, tail x3, side x0.5
 *   - `null`  -> unreadable: refuse with a reason naming the flag
 *
 * Consumers must NEVER re-derive the multipliers from the flag themselves:
 * the ship designer depends on these numbers and a wrong value is a 3x error
 * on the heaviest part of a ship (docs/ship-designer-spec.md, section 6c).
 * Reading them from this function is the only route.
 *
 * @param {boolean|null} scaleFlag the parsed value of `cinematicCombatRealismScale`
 * @returns {{available: boolean, source: string, reason?: string, mode?: string, nose?: number, tail?: number, side?: number}}
 */
export function deriveArmourMultipliers(scaleFlag) {
  if (scaleFlag === true) {
    return Object.freeze({
      available: true,
      source: 'cinematicCombatRealismScale',
      mode: 'Cinematic',
      nose: 1,
      tail: 1,
      side: 0.75
    });
  }
  if (scaleFlag === false) {
    return Object.freeze({
      available: true,
      source: 'cinematicCombatRealismScale',
      mode: 'Realistic',
      nose: 3,
      tail: 3,
      side: 0.5
    });
  }
  return Object.freeze({
    available: false,
    source: 'cinematicCombatRealismScale',
    reason: 'cinematicCombatRealismScale not read'
  });
}

/** Renders one parsed setting the way the label and the API both show it. */
export function formatCampaignSettingValue(field, value) {
  if (value === null) return 'unavailable';
  if (field.kind === SETTING_KINDS.percent) return `${value}%`;
  if (field.kind === SETTING_KINDS.flatBonus) return value > 0 ? `+${value}` : `${value}`;
  if (field.kind === SETTING_KINDS.speedMultiplier) {
    // `1.0` is the identity; render bare so "1" does not look like a separate
    // integer dimension from "1.0". For 2.0 and other rates, keep one decimal
    // so the reader sees the dimension is the same as the save's.
    if (value === 1) return '1x';
    if (value === 0) return '0x';
    return `${value}x`;
  }
  if (field.kind === SETTING_KINDS.integer) return `${value}`;
  if (field.kind === SETTING_KINDS.flag || field.kind === SETTING_KINDS.mode) {
    // Booleans render the way a UI would: on / off. The tri-state guarantees
    // we never reach this branch with `null` -- `formatCampaignSettingValue`
    // returns `'unavailable'` first.
    return value ? 'on' : 'off';
  }
  return `${value}`;
}

function describeSetting(field, rawValue) {
  const raw = rawValue === undefined ? null : rawValue;
  const value = parseCampaignSettingNumber(raw);
  const available = value !== null;

  // Three states, not two. `null` is "cannot be determined" and must never
  // collapse into `true` -- an undetermined setting rendered as stock is the
  // same defect as an unmeasured figure rendered as zero.
  let isStock = null;
  if (available && field.stockValue !== null) isStock = value === field.stockValue;

  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    raw: typeof raw === 'string' ? raw : (raw === null ? null : String(raw)),
    value,
    available,
    /** Percent settings also carry the multiplier form, so no caller divides by 100 itself. */
    multiplier: field.kind === SETTING_KINDS.percent && available ? value / 100 : null,
    stockValue: field.stockValue,
    isStock,
    display: formatCampaignSettingValue(field, value)
  };
}

/** The block reported when a save carries no custom-difficulty metadata at all. */
export const CAMPAIGN_SETTINGS_UNAVAILABLE = Object.freeze({
  available: false,
  source: null,
  customDifficulty: null,
  settings: Object.freeze({}),
  nonStock: Object.freeze([]),
  undetermined: Object.freeze([]),
  unreadable: Object.freeze([])
});

/**
 * The block reported when a save carries no `TIGlobalValuesState.scenarioCustomizations`
 * at all -- or carries the field but it is not an object. Distinct from
 * `CAMPAIGN_SETTINGS_UNAVAILABLE` because the two blocks are read from two
 * different `TI*State` collections and either can be present while the other
 * is not. A consumer that reads ONLY the scenario block should see this
 * shape, not the metadata shape, when there is nothing to read.
 */
export const SCENARIO_CUSTOMIZATIONS_UNAVAILABLE = Object.freeze({
  available: false,
  source: null,
  settings: Object.freeze({}),
  nonStock: Object.freeze([]),
  undetermined: Object.freeze([]),
  unreadable: Object.freeze([]),
  armourMultipliers: deriveArmourMultipliers(null)
});

/**
 * Reads one `TIGlobalValuesState.scenarioCustomizations` field into the same
 * shape `describeSetting` produces for the metadata block.
 *
 * The two paths are separate on purpose: `parseCampaignSettingNumber` is the
 * right reader for `"200%"` strings but the wrong one for `2.0` bare numbers,
 * so reusing it here would either silently accept the wrong shape or coerce
 * `true`/`false` to `1`/`0`. Both are wrong; this function uses the strict
 * parsers that match what the save actually carries.
 *
 * The returned entry is the same shape `describeSetting` returns: `key`,
 * `label`, `kind`, `raw`, `value`, `available`, `multiplier`, `stockValue`,
 * `isStock`, `display` -- with two differences:
 *   - `multiplier` is populated for `speedMultiplier` settings (the game
 *     divides by the value, so the multiplier the rest of the dashboard wants
 *     is `1 / speed`, and we expose the raw value as the multiplier so the
 *     consumer does not have to invert it differently);
 *   - boolean settings report `on` / `off` / `unavailable` rather than `200%`
 *     or `+0`. The tri-state guarantee is preserved.
 */
function describeScenarioCustomization(field, rawValue) {
  const raw = rawValue === undefined ? null : rawValue;
  const value = parseScenarioCustomizationValue(field, raw);
  const available = value !== null;

  // Same three-state rule as the metadata block: `null` is "cannot be
  // determined" and MUST NOT collapse into "stock". A boolean `null` is
  // especially dangerous here because Cinematic/Realistic/Unknown share the
  // same "looks like a stock setting" surface area.
  let isStock = null;
  if (available && field.stockValue !== null) {
    isStock = value === field.stockValue;
  }

  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    raw: raw === null ? null : (typeof raw === 'string' ? raw : (typeof raw === 'boolean' ? String(raw) : String(raw))),
    value,
    available,
    /**
     * Speed multipliers and integers carry the value directly as a multiplier.
     * Booleans (flag, mode) are not multipliers themselves -- the armour
     * scaling is derived elsewhere. `null` when unreadable.
     */
    multiplier: available && (
      field.kind === SETTING_KINDS.speedMultiplier || field.kind === SETTING_KINDS.integer
    ) ? value : null,
    stockValue: field.stockValue,
    isStock,
    display: formatCampaignSettingValue(field, value)
  };
}

/**
 * Builds the baked scenario-customizations block from the raw
 * `TIGlobalValuesState.scenarioCustomizations` object.
 *
 * Returns the same shape as `buildCampaignSettings`:
 *   { available, source, settings: {key: entry}, nonStock, undetermined, unreadable, armourMultipliers }
 * so a consumer walking the merged campaign-settings block can use one path
 * for both.
 *
 * The block is `available: false` when the raw input is missing or not an
 * object -- NOT when individual fields are unreadable. Absent fields are
 * recorded in `unreadable` with a path-naming reason so a consumer knows
 * exactly which `TI*State` to inspect, mirroring the "path it looked in"
 * rule from the campaign-settings-spec.
 *
 * `armourMultipliers` is derived from the `cinematicCombatRealismScale` entry
 * if present, otherwise from `null`. It is the one block-level field that is
 * NOT a per-setting reading, so it lives at the top level alongside the
 * metadata.
 *
 * @param {Object|null} rawScenario the raw `scenarioCustomizations` object,
 *   or null when absent
 * @returns {Object} a frozen block
 */
export function buildScenarioCustomizations(rawScenario) {
  const hasRaw = rawScenario && typeof rawScenario === 'object';

  // Walk every known scenario field, even if the raw block was missing.
  // The merged campaign-settings block uses the same `settings` map shape
  // for both available and unavailable states -- so a consumer can ask for
  // `settings.habConstructionSpeedPlayer.value` and get `null` (with the
  // usual "cannot be determined" reason) instead of an undefined key. An
  // undefined key looks like the field was never looked at, which is a
  // different defect class from "we looked and could not read it".
  const settings = {};
  const nonStock = [];
  const undetermined = [];
  const unreadable = [];
  let anyFieldPresent = false;

  for (const field of SCENARIO_CUSTOMIZATION_FIELDS) {
    const rawField = hasRaw ? rawScenario[field.key] : undefined;
    if (rawField !== undefined) anyFieldPresent = true;
    const entry = describeScenarioCustomization(field, rawField);
    settings[field.key] = Object.freeze(entry);

    if (!entry.available) {
      unreadable.push(Object.freeze({
        key: field.key,
        label: field.label,
        raw: entry.raw,
        reason: entry.raw === null
          ? 'absent from TIGlobalValuesState.scenarioCustomizations'
          : `not a readable ${field.kind} value`
      }));
      continue;
    }
    if (entry.isStock === false) {
      nonStock.push(Object.freeze({ key: field.key, label: field.label, value: entry.value, display: entry.display }));
    } else if (entry.isStock === null) {
      undetermined.push(Object.freeze({
        key: field.key,
        label: field.label,
        value: entry.value,
        display: entry.display,
        reason: 'this setting has no stock value to compare against'
      }));
    }
  }

  // Armour scaling is a derivation of one field, not a parallel reading.
  // Pull it from the per-field entry we already built, so a save that has
  // the value reachable only through a non-standard key path still resolves.
  const armourMultipliers = deriveArmourMultipliers(settings.cinematicCombatRealismScale?.value ?? null);

  return Object.freeze({
    available: anyFieldPresent,
    source: anyFieldPresent ? 'TIGlobalValuesState.scenarioCustomizations' : null,
    settings: Object.freeze(settings),
    nonStock: Object.freeze(nonStock),
    undetermined: Object.freeze(undetermined),
    unreadable: Object.freeze(unreadable),
    armourMultipliers: Object.freeze(armourMultipliers)
  });
}
/**
 * Builds the baked custom-difficulty block from a raw `TIMetadataState` object.
 *
 * @param {Object|null} meta the raw metadata state, or null when absent
 * @returns {Object} a frozen block; `available: false` when nothing was read
 */
export function buildCampaignSettings(meta) {
  if (!meta || typeof meta !== 'object') return CAMPAIGN_SETTINGS_UNAVAILABLE;

  const customDifficulty = parseCampaignSettingFlag(meta.customDifficulty);
  const settings = {};
  const nonStock = [];
  const undetermined = [];
  const unreadable = [];

  for (const field of CAMPAIGN_SETTING_NUMERIC_FIELDS) {
    const entry = describeSetting(field, meta[field.key]);
    settings[field.key] = Object.freeze(entry);

    if (!entry.available) {
      unreadable.push(Object.freeze({
        key: field.key,
        label: field.label,
        raw: entry.raw,
        reason: entry.raw === null
          ? 'absent from the save metadata'
          : 'not a readable numeral'
      }));
      continue;
    }
    if (entry.isStock === false) {
      nonStock.push(Object.freeze({ key: field.key, label: field.label, value: entry.value, display: entry.display }));
    } else if (entry.isStock === null) {
      undetermined.push(Object.freeze({
        key: field.key,
        label: field.label,
        value: entry.value,
        display: entry.display,
        reason: 'this setting has no stock value to compare against'
      }));
    }
  }

  const anyFieldPresent = customDifficulty !== null
    || CAMPAIGN_SETTING_NUMERIC_FIELDS.some(field => meta[field.key] !== undefined);

  if (!anyFieldPresent) return CAMPAIGN_SETTINGS_UNAVAILABLE;

  return Object.freeze({
    available: true,
    source: 'TIMetadataState',
    customDifficulty,
    settings: Object.freeze(settings),
    nonStock: Object.freeze(nonStock),
    undetermined: Object.freeze(undetermined),
    unreadable: Object.freeze(unreadable)
  });
}

/**
 * The one-line difficulty label every surface renders.
 *
 * A campaign with `customDifficulty: true` NEVER returns the bare difficulty
 * name -- that is the whole point of this module. The customisation is named
 * even when not one multiplier could be read, because "custom, settings
 * unavailable" is honest and "Normal" is not.
 *
 * @param {string|null} difficulty the save's own difficulty label
 * @param {Object|null} campaignSettings the block from `buildCampaignSettings`
 * @returns {string|null} null only when there is nothing at all to report
 */
export function describeCampaignDifficulty(difficulty, campaignSettings) {
  const base = typeof difficulty === 'string' && difficulty.trim() !== '' ? difficulty.trim() : null;
  const block = campaignSettings && typeof campaignSettings === 'object'
    ? campaignSettings
    : CAMPAIGN_SETTINGS_UNAVAILABLE;

  if (block.customDifficulty !== true) return base;

  const nonStock = Array.isArray(block.nonStock) ? block.nonStock : [];
  const detail = nonStock.length > 0
    ? nonStock.map(entry => `${entry.label} ${entry.display}`).join(', ')
    : 'settings unavailable';

  return `${base || 'Unknown difficulty'} (custom: ${detail})`;
}

/**
 * The measured verdicts from `docs/campaign-settings-spec.md`, recorded here so
 * a reader who finds the multipliers does not go "fix" a figure that is already
 * correct. Each model also carries the same verdict as a comment at its own
 * site; this is the index of them.
 *
 * FOUR OF THE FIVE CLEAR. The reason they clear is structural: the dashboard
 * READS measured values out of the save almost everywhere rather than computing
 * them from base rates, so those multipliers are already inside what it reads.
 * Applying one to a read value would introduce a 2x error.
 *
 * THE FIFTH DID NOT, and its entry says so. `researchSpeedMultiplier` was
 * cleared on 2026-08-21 and the clearance was WRONG: research cost is the one
 * figure on the dashboard that came from a game TEMPLATE rather than from the
 * save, and a template cannot carry a campaign setting. That is exactly where
 * the multiplier had somewhere to hide, and the structural argument above --
 * "the multipliers are already inside what it reads" -- is precisely why the
 * template path was the one to check hardest and the one that was checked with
 * a save from a different campaign.
 *
 * The lesson generalises: a structural argument tells you where to LOOK, and
 * cannot substitute for looking. Any future figure computed from a template
 * rather than read from the save needs its own measurement.
 */
export const CAMPAIGN_SETTING_VERDICTS = Object.freeze({
  researchSpeedMultiplier: Object.freeze({
    verdict: 'WRONG, corrected 2026-08-22 -- it acts on COST',
    appliesTo: 'the effective research cost: template cost / (multiplier / 100)',
    correctedBy: 'shared/researchCostScaling.mjs, which carries the three independent lines of evidence',
    site: 'shared/researchCostScaling.mjs (applied), server/snapshot/research.js and '
      + 'server/snapshot/factions.js (applied at snapshot build), shared/researchAllocationPricing.mjs '
      + '(consumes the effective cost)',
    evidence: 'THE COST SIDE, measured 2026-08-22: the observer\'s Project_GasCoreFissionReactorVI '
      + '(template researchCost 10,000) stood at 4,708.568 accumulated on 12/16/2034 12:00 and was '
      + 'complete by 1/1/2035, with its slot delivering a measured 30.2467 points/day -- which reaches '
      + '5,000 in 9.64 days and cannot reach 10,000 in under 175. 278 in-progress project rows across '
      + 'the five saves carrying 200% never exceed 50% of template cost (maximum 0.49716), while saves '
      + 'carrying no readable multiplier do routinely (First.gz 13 of 49, maximum 0.9756). '
      + 'THE INCOME SIDE is unaffected and must NOT be multiplied: over 12/1/2034 -> 12/16/2034 12:00 '
      + 'the observer\'s slots delivered 2.1115x cachedYearlyRevenue.Research against 2.1420x predicted '
      + 'from the allocation terms alone, a uniform 1.4% residual.',
    evidenceThatWasWrong: 'the 2026-08-21 verdict read "acts on OUTPUT, not on cost", on the strength '
      + 'of Fleet Logistics sitting at accumulatedResearch 44,780 against a template researchCost of '
      + '45,000 and still being in progress. That observation is real and reproduces -- on First.gz, '
      + 'which carries NO TIMetadataState custom-difficulty block and therefore no '
      + 'researchSpeedMultiplier. It established that a campaign WITHOUT a multiplier charges template '
      + 'cost, which is true and silent about a campaign that has one.',
    whyTheIncomeMeasurementCouldNotCatchIt: 'delivered research over cachedYearlyRevenue.Research has '
      + 'research POINTS on both sides; cost never enters. "Income already doubled, cost unscaled" and '
      + '"income never doubled, cost halved" predict the identical 2.1115x. The 4.2840x alternative it '
      + 'ruled out -- income doubled AND everything else unchanged -- was a hypothesis nobody held.',
    evidenceSuperseded: 'the original wording cited ALLOCATION_MODEL reproducing delivery at 1.147x and '
      + '0.993x, "where a missing 200% would have read ~2.0". WITHDRAWN 2026-08-22 (tracker 3b) as '
      + 'invalid reasoning, though the conclusion it reached was right. A delivered/predicted ratio near '
      + '1.0 cannot detect a missing constant factor when the prediction itself carries a FITTED '
      + 'parameter -- the first pass had fitted ProjectBonus at -0.209, leaving room for a compensating '
      + '~2 to hide. The figures were also not reproducible as recorded: they name a pip layout of '
      + '[0,0,3,3,3,0] and dates in 2033, while all four MD5-verified saves carry [0,0,3,1,3,1] and run '
      + '12/1/2034 to 1/1/2035. Kept, marked, and replaced by the measurement above.',
    measuredOn: '2026-08-21; income evidence replaced 2026-08-22; VERDICT OVERTURNED 2026-08-22'
  }),
  miningProductivityMultiplier: Object.freeze({
    verdict: 'checked -- unaffected',
    appliesTo: 'site rates are realised extraction',
    site: 'shared/intel/common.mjs siteMonthlyOutput',
    evidence: 'Five resources on the observer\'s 17 completed mines, per-day rate x30 against the '
      + 'faction\'s own monthlyIncome: water 1.033, volatiles 0.939, metals 1.094, nobleMetals 1.088, '
      + 'fissiles 1.219. An omitted 200% would read ~2.0 throughout.',
    measuredOn: '2026-08-21'
  }),
  nationalIPMultiplier: Object.freeze({
    verdict: 'checked -- unaffected',
    appliesTo: 'the formula already reproduces the game\'s own figure',
    site: 'server/engine/adviseEconomics.js computeBaseIP',
    evidence: 'Across 295 nations the median of the save\'s own baseInvestmentPoints_month over the '
      + 'computed value is 1.000, with exact matches on nations carrying no army drag (United Malay '
      + 'Nation 25.58/25.58, Brazil 19.08/19.08, Mexico 17.24/17.24).',
    measuredOn: '2026-08-21'
  }),
  alienProgressionSpeed: Object.freeze({
    verdict: 'checked -- unaffected',
    appliesTo: 'hate is save-derived; the venting rate is measured or refused',
    site: 'shared/alienHateEconomics.mjs',
    evidence: 'buildAlienHateEconomics reports source: save-derived, and the venting rate comes from a '
      + 'previous-save comparison that is explicitly refused when unmeasurable -- including in player '
      + 'mode, where the true hate figure is redacted. Nothing projects from a stock rate.',
    measuredOn: '2026-08-21'
  }),
  controlPointMaintenanceFreebieBonus: Object.freeze({
    verdict: 'not applicable',
    appliesTo: 'no model computes control-point upkeep',
    site: null,
    evidence: 'There is no control-point upkeep model, so the freebie bonus has nothing to be '
      + 'misapplied to.',
    measuredOn: '2026-08-21'
  }),
  averageMonthlyEvents: Object.freeze({
    verdict: 'not applicable',
    appliesTo: 'nothing consumes an event rate',
    site: null,
    evidence: 'No model reads or projects an event rate.',
    measuredOn: '2026-08-21'
  })
});

export default {
  SETTING_KINDS,
  CAMPAIGN_SETTING_FIELDS,
  CAMPAIGN_SETTING_NUMERIC_FIELDS,
  SCENARIO_CUSTOMIZATION_FIELDS,
  SCENARIO_CUSTOMIZATION_NUMERIC_FIELDS,
  SCENARIO_CUSTOMIZATION_BOOLEAN_FIELDS,
  CAMPAIGN_SETTINGS_UNAVAILABLE,
  SCENARIO_CUSTOMIZATIONS_UNAVAILABLE,
  CAMPAIGN_SETTING_VERDICTS,
  parseCampaignSettingNumber,
  parseCampaignSettingFlag,
  parseScenarioCustomizationNumber,
  parseScenarioCustomizationBoolean,
  parseScenarioCustomizationValue,
  deriveArmourMultipliers,
  formatCampaignSettingValue,
  buildCampaignSettings,
  buildScenarioCustomizations,
  describeCampaignDifficulty
};
