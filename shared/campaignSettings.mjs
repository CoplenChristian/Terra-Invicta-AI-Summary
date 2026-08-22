// shared/campaignSettings.mjs
//
// Purpose: parse the save's custom-difficulty block and label a customised
//   campaign so no surface renders one as a stock difficulty.
//
// `TIMetadataState` carries a `customDifficulty` flag and nine tuning values
// beside the `difficulty` label. Only the label was ever baked, so a campaign
// running four rates at 200% presented itself as plain "Normal" -- and anyone
// comparing this dashboard's figures against a stock-difficulty reference drew
// the wrong conclusion from a field that was, strictly, telling the truth.
//
// THE PARSE TRAP. These values are STRINGS: "200%", "150", "0", "5".
// `Number("200%")` is `NaN`, so the usual `Number(x) ?? 0` / `|| 0` idiom
// yields a confident **zero** -- worse than no multiplier at all, because a
// zero annihilates whatever it touches. This is the third instance of the
// class in this repo (comma-formatted `req power` on 92 drives, and the
// `researchCost: -1` sentinels), so the parse here is deliberately strict:
// strip one trailing `%` and any thousands separators, require what remains to
// be a bare numeral, and report anything else as `null`. Never `0`, never a
// silent `1`.
//
// NOTHING HERE IS CAMPAIGN-SPECIFIC. The stock comparison values are the
// arithmetic identities of each kind -- 100% is the multiplier that changes
// nothing, and 0 is the bonus that adds nothing -- not this campaign's numbers.
// `averageMonthlyEvents` is a rate with no identity value, so its stock value
// is recorded as unknown and it is never claimed to be either stock or not.

/** How a setting's numeral is to be read, and what value would leave it stock. */
export const SETTING_KINDS = Object.freeze({
  /** A percentage multiplier. 100% is the identity. */
  percent: 'percent',
  /** A flat additive bonus. 0 is the identity. */
  flatBonus: 'flat-bonus',
  /** A bare rate with no identity value; stock-ness is not determinable. */
  rate: 'rate',
  /** A boolean flag rather than a numeral. */
  flag: 'flag'
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

/** Renders one parsed setting the way the label and the API both show it. */
export function formatCampaignSettingValue(field, value) {
  if (value === null) return 'unavailable';
  if (field.kind === SETTING_KINDS.percent) return `${value}%`;
  if (field.kind === SETTING_KINDS.flatBonus) return value > 0 ? `+${value}` : `${value}`;
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
  CAMPAIGN_SETTINGS_UNAVAILABLE,
  CAMPAIGN_SETTING_VERDICTS,
  parseCampaignSettingNumber,
  parseCampaignSettingFlag,
  formatCampaignSettingValue,
  buildCampaignSettings,
  describeCampaignDifficulty
};
