// shared/campaignElapsed.mjs
//
// Purpose: resolve elapsed campaign time and alien progression speed from one
//   place, so the total-war gate and the research horizon cannot drift apart.
//
// WHY THIS MODULE EXISTS
//
// Elapsed campaign time gates the alien total-war declaration and sets the
// research planning horizon. It was derived in two places -- once in
// `server/intelligenceFilter.js` for the live snapshot and again in
// `shared/strategicSnapshot.mjs` for the published history -- from the same
// inputs, by the same arithmetic, with two separately worded source strings.
// `shared/researchReachability.mjs` already warns in its own header that two
// parallel derivations of one quantity is the drift class CLAUDE.md records
// from the three hand-maintained registry lists. This is that consolidation.
//
// WHAT THE SAVE ACTUALLY CARRIES (measured 2026-08-21 against 14 saves in
// `c:/Users/cople/Documents/My Games/TerraInvicta/Saves`, game 1.0.51)
//
// `TIMetadataState` carries NO `campaignStartYear` -- absent in 14 of 14. That
// is the field the previous code looked for, which is why the measured value
// was always null and the labelled 2022 assumption was always used.
//
// The save does carry the quantity, in two other states, in 14 of 14:
//
//   TITimeState.daysInCampaign              e.g. 3256
//   TIGlobalResearchState.campaignStartYear e.g. 2026
//
// `daysInCampaign` is the game's own counter of campaign duration and is
// therefore the DIRECT measurement of exactly the quantity the gate needs. It
// is preferred over subtracting years for a correctness reason, not a
// precision one: year subtraction reports whole years between two calendar
// years, so a campaign that began 2026-12-31 and now reads 2036-01-01 scores
// 10 elapsed years -- opening a 10-year gate -- when 1.0 year has passed. On
// the live save the two agree closely (8.91 vs 9), and on a `ModernDayStart`
// save they diverge by 0.59 years, so the ordering is not academic.
//
// Cross-checks on the live save (`ExitSave.gz`, 1/1/2035):
//   2035-01-01 minus 3256 days               = 2026-02-01
//   earliest non-sentinel dated record       = 2026-02-01 (1,975 completionDate
//                                              records; the starting habs)
//   TIGlobalResearchState.campaignStartYear  = 2026
//   TITimeState.scenarioMetaTemplateName     = "2026Scenario" / "2026Start"
// Four independent readings, one answer.
//
// The `0001-01-01` sentinel means "never", not a date: 8,053 records carry it
// (4,074 `decommissionDate`, 2,004 `startBuildDate`, 1,975 `completionDate`).
// Nothing in this module reads dated records, so it cannot be fooled by them --
// that census is recorded because it is the corroboration for 2026-02-01.
//
// ABSENT STAYS NULL
//
// Every reading is presence-checked before coercion. When no measurement can
// be made the resolver falls back to the explicitly labelled assumption, and
// when even that is missing it reports null with a reason -- never a confident
// zero, and never an unlabelled number.

// `strictFiniteNumber`, not `toFiniteNumber`. The looser form accepts anything
// `Number()` can coerce, so `'   '` and `[]` both become a confident **0** --
// a campaign that has run for no time at all, which reads on screen as "the
// total-war gate is the full ten years away". These are arbitrary snapshot
// fields that may hold anything, which is exactly the case shared/util.mjs
// documents the stricter form for.
import { strictFiniteNumber } from './util.mjs';

/** Days per year used to convert `daysInCampaign` into years. */
export const DAYS_PER_CAMPAIGN_YEAR = 365.25;

/**
 * How elapsed campaign time was arrived at, most to least trustworthy.
 *
 * `measured` and `assumed` are the two states the codebase already had.
 * There is deliberately no third "derived" state: the save turned out to carry
 * the figure outright, so nothing here infers a start year from dated records.
 */
export const CAMPAIGN_AGE_SOURCES = Object.freeze({
  /** TITimeState.daysInCampaign -- the game's own campaign-duration counter. */
  daysInCampaign: 'days-in-campaign',
  /** TIGlobalResearchState.campaignStartYear subtracted from the campaign year. */
  startYear: 'start-year',
  /** The documented constant, used only when the save carries neither reading. */
  assumed: 'assumed',
  /** Nothing readable at all. */
  unavailable: 'unavailable'
});

/**
 * Resolves elapsed campaign time from a raw snapshot's metadata.
 *
 * @param {Object} metadata `rawSnapshot.metadata`
 * @param {number|null} campaignYear the four-digit year parsed from gameTimeString
 * @returns {{
 *   yearsElapsed: number|null,
 *   source: string,
 *   sourceText: string,
 *   campaignStartYear: number|null,
 *   campaignStartYearMeasured: boolean,
 *   daysInCampaign: number|null
 * }}
 */
export function resolveCampaignElapsed(metadata = null, campaignYear = null) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const days = strictFiniteNumber(meta.daysInCampaign);
  const measuredStartYear = strictFiniteNumber(meta.campaignStartYear);
  const assumedStartYear = strictFiniteNumber(meta.assumedCampaignStartYear);
  const year = strictFiniteNumber(campaignYear);

  // A negative or zero day count is not a campaign age; treat it as unreadable
  // rather than reporting a campaign that has run for minus three years.
  if (days !== null && days >= 0) {
    return {
      yearsElapsed: Number((days / DAYS_PER_CAMPAIGN_YEAR).toFixed(2)),
      source: CAMPAIGN_AGE_SOURCES.daysInCampaign,
      sourceText: `measured: save TITimeState.daysInCampaign = ${days} (${DAYS_PER_CAMPAIGN_YEAR} days/year)`,
      campaignStartYear: measuredStartYear,
      campaignStartYearMeasured: measuredStartYear !== null,
      daysInCampaign: days
    };
  }

  if (measuredStartYear !== null && year !== null) {
    return {
      yearsElapsed: year - measuredStartYear,
      source: CAMPAIGN_AGE_SOURCES.startYear,
      sourceText: `measured: save TIGlobalResearchState.campaignStartYear = ${measuredStartYear}`,
      campaignStartYear: measuredStartYear,
      campaignStartYearMeasured: true,
      daysInCampaign: null
    };
  }

  if (assumedStartYear !== null && year !== null) {
    return {
      yearsElapsed: year - assumedStartYear,
      source: CAMPAIGN_AGE_SOURCES.assumed,
      sourceText: typeof meta.campaignStartYearSource === 'string' && meta.campaignStartYearSource
        ? meta.campaignStartYearSource
        : `assumed start year ${assumedStartYear}`,
      campaignStartYear: null,
      campaignStartYearMeasured: false,
      daysInCampaign: null
    };
  }

  return {
    yearsElapsed: null,
    source: CAMPAIGN_AGE_SOURCES.unavailable,
    sourceText: 'unavailable: this save carries neither a campaign duration nor a campaign start year, '
      + 'and no assumed start year is configured',
    campaignStartYear: measuredStartYear,
    campaignStartYearMeasured: measuredStartYear !== null,
    daysInCampaign: null
  };
}

/**
 * The alien progression speed multiplier this campaign runs at.
 *
 * Reads the parsed custom-difficulty block, which already handles the
 * `Number("200%") === NaN` trap and reports an unreadable setting as null
 * rather than as a confident 0 or a silent 1.
 *
 * Returns null when the campaign settings are absent (a fixture, a save parsed
 * before the block existed) or the value cannot be read. `buildTotalWarState`
 * treats null as "assume 1" and says so through `progressionSpeedAssumed`, so
 * an old save keeps its previous behaviour and announces it.
 *
 * @param {Object|null} metadata `rawSnapshot.metadata`
 * @returns {number|null} e.g. 2 for "200%", or null when unreadable
 */
export function resolveAlienProgressionSpeed(metadata = null) {
  const setting = metadata?.campaignSettings?.settings?.alienProgressionSpeed;
  const multiplier = strictFiniteNumber(setting?.multiplier);
  return multiplier !== null && multiplier > 0 ? multiplier : null;
}
