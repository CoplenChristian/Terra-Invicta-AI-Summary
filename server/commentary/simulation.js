/**
 * server/commentary/simulation.js
 * Purpose: Layer 3 of the strategic commentary — the opponent-tier builders, the
 *   measured shipyard-throughput model, and the projection simulator over the
 *   shared Monte Carlo engagement sweep.
 *
 * Layer 3 — opponent tiers and projections.
 *
 * The SWEEP ITSELF moved to `shared/engagementModel.mjs` on 2026-08-22 so the
 * hosted Cloudflare worker can run the same model for the per-fleet THREAT
 * estimates in `shared/fleetEngagement.mjs`, which reach the AI markdown
 * exports the worker renders. Per CLAUDE.md a split re-exports the SAME
 * function objects rather than wrapping them, so reference-identity holds and
 * no caller moved. The model is unchanged: `findRequiredHullsForTier` gained an
 * optional `maxHulls` that defaults to `MAX_SIMULATED_HULLS`, and every call
 * here still uses that default, so every tier sweeps exactly the range it
 * always swept.
 *
 * What stayed here is what only the commentary needs: the two mode-specific
 * opponent-tier builders and `runMonteCarloSimulation`.
 *
 * Requirements from docs/archive/strategic-commentary-and-layout-plan.md & Review:
 * 1. Player-First: Uses observable alien fleet telemetry in player mode;
 *    never relies on redacted shipDesigns CVs in player mode.
 * 2. Zero-Opponent Guard: Empty opponent list resolves to unavailable, NEVER P(win) = 1.0.
 * 3. Seeded PRNG: Mulberry32 seeded by snapshotId ensures byte-identical results per save.
 * 4. Ranges as Output: p20-p80 percentile bands across 120 seeds (e.g. "4" or "4–5").
 * 5. Unwinnable Handling: If P(win) < 0.80 up to max hulls, reports explicit unwinnable message.
 * 6. Visual Metadata: Simulated numbers are stamped with simulated: true.
 *
 * What the p20-p80 band is and is not, and why "not winnable at any count
 * simulated" is a ceiling report rather than an impossibility verdict, are
 * documented at the top of `shared/engagementModel.mjs`.
 */

'use strict';

const { samplePercentile } = require('./prng');
const { toFiniteNumber, sameId } = require('../../shared/util.mjs');
const { ALIEN_HATE_WAR_THRESHOLD } = require('../alienHateEconomics');
const {
  BATTLE_TRIALS_PER_COUNT,
  MAX_SIMULATED_HULLS,
  OPPONENT_RATING_BASIS,
  SIMULATION_SEEDS_COUNT,
  TARGET_WIN_PROBABILITY,
  describeBandUncertainty,
  findRequiredHullsForTier,
  guaranteedWinHullCount,
  simulateEngagement
} = require('../../shared/engagementModel.mjs');

/**
 * A rate to three SIGNIFICANT figures, never to a fixed number of decimals.
 *
 * `round(value, 2)` would print a throughput of 0.004 hulls/mo as `0` -- a
 * confident measured zero standing in for "one hull every twenty years", which
 * is the `Number(null) === 0` failure in a second costume. The catalogue of
 * hull build times runs from tens of days to thousands, so the bottom of the
 * range is reachable. Three significant figures is the same rule and the same
 * reasoning as `accelOr` in shared/markdownExports.mjs.
 *
 * A measured 0 stays 0: it is a reading (nothing queued produces nothing), and
 * it is deliberately not what an unreadable input renders as.
 */
function toSignificant(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0;
  return Number(value.toPrecision(digits));
}

/**
 * Builds opponent tiers from observable fleet metrics (Player Mode).
 *
 * The 0.7 / 1.5 / 4.0 multipliers below have no shipped source. See
 * OPPONENT_RATING_BASIS.player -- they are assumptions, and the threshold bands
 * they produce inherit that.
 *
 * NO ARMOUR DEFAULTS, since 2026-08-22. This read
 * `toFiniteNumber(f.armorMedian) || 10` per fleet and then `|| 12` / `|| 24` on
 * the two percentiles, so an alien fleet whose armour could not be read was
 * simulated at a specific 10 cm and an unreadable population produced a
 * specific 12 / 24 cm -- three invented figures that every downstream hull
 * threshold then inherited as though measured. They are latent on the live save
 * (0 of 57 alien fleets miss `armorMedian`, measured on ExitSave.gz), and
 * latent is not fixed: a save that exercised them would have published invented
 * numbers with nothing on the surface saying so.
 *
 * A fleet with no readable armour is DROPPED from the sample rather than
 * defaulted, and the counts are returned so the caller can say how much of the
 * observed force the tiers actually rest on. No readable armour at all, or a
 * non-positive median, refuses: the whole tier scale is `medianArmor / 10`, so
 * a zero there quietly rates every alien at nothing.
 */
function buildPlayerOpponentTiers(alienFleets, ownRating) {
  if (!Array.isArray(alienFleets) || alienFleets.length === 0) {
    return null;
  }

  // Only measured armour medians. `toFiniteNumber` returns null for an absent,
  // blank or non-numeric field, and null is not a measurement of 10 cm.
  const armors = alienFleets
    .map(f => toFiniteNumber(f.armorMedian))
    .filter(value => value !== null)
    .sort((a, b) => a - b);
  if (armors.length === 0) return null;

  const medianArmor = samplePercentile(armors, 0.5);
  const p90Armor = samplePercentile(armors, 0.9);
  // `samplePercentile` returns null only for an empty sample, which is already
  // excluded -- but a MEASURED zero would scale every tier to nothing, and a
  // rating of 0 reads as "any hull wins" rather than as "this was unmeasurable".
  if (medianArmor === null || p90Armor === null || medianArmor <= 0 || p90Armor <= 0) return null;

  // Rating calibrated against own rating
  const baseEscortRating = ownRating * 0.7 * (medianArmor / 10);
  const baseTypicalRating = ownRating * 1.5 * (medianArmor / 10);
  const baseHeavyRating = ownRating * 4.0 * (p90Armor / 10);

  return [
    {
      id: 'median-alien-escort',
      label: '1x median alien escort / patrol',
      opponentRating: baseEscortRating,
      description: `Observed median patrol signature (median armor ${medianArmor.toFixed(1)}cm)`
    },
    {
      id: 'typical-alien-combatant',
      label: '1x typical alien combatant',
      opponentRating: baseTypicalRating,
      description: `Observed mainline combat element (median armor ${medianArmor.toFixed(1)}cm)`
    },
    {
      id: 'two-typical-aliens',
      label: '2x typical alien combatants',
      opponentRating: baseTypicalRating * 2.0,
      description: 'Typical paired combat element'
    },
    {
      id: 'heavy-alien-capital',
      label: '1x heavy alien capital (p90)',
      opponentRating: baseHeavyRating,
      description: `Observed heavy capital force (p90 armor ${p90Armor.toFixed(1)}cm)`
    },
    {
      id: 'three-typical-aliens',
      label: '3x typical alien strike group',
      opponentRating: baseTypicalRating * 3.0,
      description: 'Coordinated strike element (3 mainline ships)'
    }
  ];
}

/**
 * Builds opponent tiers from true design CVs (Omniscient Mode).
 *
 * NO CV DEFAULTS, since 2026-08-22 -- and this one is DEAD CODE REMOVAL, not a
 * behaviour change, which is the honest way to describe it. The three
 * percentiles read `|| 3250`, `|| 20330` and `|| 70100`: three specific alien
 * combat values with no source, which would have decided every omniscient hull
 * threshold outright had they ever fired. They could not. The sample is already
 * filtered to positive finite values and refused when empty, and
 * `samplePercentile` returns null only for an empty array, so an interpolation
 * between positive values can be neither null nor zero. Restoring the three
 * fallbacks leaves the whole suite green, which is the measurement that says
 * so.
 *
 * They are deleted anyway, because a fallback that reads as a degrade path and
 * is not one is worse than no fallback: the next person to loosen the filter
 * inherits three invented numbers. The explicit refusal below is what that
 * person's change would trip over instead. Measured on ExitSave.gz: 82 of 82
 * alien designs carry a positive CV.
 */
function buildOmniscientOpponentTiers(alienDesigns) {
  if (!Array.isArray(alienDesigns) || alienDesigns.length === 0) {
    return null;
  }

  const cvs = alienDesigns
    .map(d => toFiniteNumber(d._unnormalizedCombatValue))
    .filter(v => v !== null && v > 0)
    .sort((a, b) => a - b);

  if (cvs.length === 0) return null;

  const p10Cv = samplePercentile(cvs, 0.1);
  const p50Cv = samplePercentile(cvs, 0.5);
  const p90Cv = samplePercentile(cvs, 0.9);
  if (p10Cv === null || p50Cv === null || p90Cv === null) return null;

  return [
    {
      id: 'median-alien-escort',
      label: '1x median alien escort',
      opponentRating: p10Cv,
      description: `P10 alien design rating (${Math.round(p10Cv).toLocaleString()} CV)`
    },
    {
      id: 'typical-alien-combatant',
      label: '1x typical alien',
      opponentRating: p50Cv,
      description: `Median alien design rating (${Math.round(p50Cv).toLocaleString()} CV)`
    },
    {
      id: 'two-typical-aliens',
      label: '2x typical alien',
      opponentRating: p50Cv * 2.0,
      description: `2x median alien designs (${Math.round(p50Cv * 2).toLocaleString()} CV)`
    },
    {
      id: 'heavy-alien-capital',
      label: '1x heavy alien (p90)',
      opponentRating: p90Cv,
      description: `P90 heavy capital design (${Math.round(p90Cv).toLocaleString()} CV)`
    },
    {
      id: 'three-typical-aliens',
      label: '3x typical alien',
      opponentRating: p50Cv * 3.0,
      description: `3x median alien designs (${Math.round(p50Cv * 3).toLocaleString()} CV)`
    }
  ];
}

/**
 * Production throughput, measured rather than assumed.
 *
 * WHAT THE OLD MODEL ASSUMED, AND WHAT THE SAVE ACTUALLY SAYS.
 *
 * This was `30 / (baseConstructionTimeDays / ownQueuedShips.length)`, and both
 * halves of that division were wrong. Settled by measurement on 2026-08-22
 * against four MD5-verified frozen saves spanning three campaign moments
 * (Autosave3 12/1/2034 d3225, Autosave2 12/16/2034 d3241, Autosave and
 * ExitSave 1/1/2035 d3256) and all eight factions.
 *
 * THE DIVISOR. `shipyardQueues` rows are per-SHIP, but the save's own
 * `nShipyardQueues` is a map keyed by SHIPYARD MODULE with an array of entries
 * per yard. Across 129 yard-queues carrying work, exactly ZERO had more than
 * one entry with `costPaid` set, and every paid entry sat at index 0. Over the
 * two intervals, all 15 unpaid entries held their `daysToCompletion` EXACTLY
 * frozen (Humanity First's yard 17063 sat at 60 / 60 behind a head that ran
 * 111.80 -> 95.80 -> 80.80), while paid entries counted down by the elapsed
 * campaign days. So: SERIAL WITHIN A YARD, PARALLEL ACROSS YARDS. The divisor
 * is the number of hulls actually in progress -- at most one per yard -- and
 * never the queue length.
 *
 * That mattered on live data even though it did not move the observer's own
 * number: on Autosave3 the Servants had 15 queued against 5 building (a 3.00x
 * overstatement), the Protectorate 5 against 3, and the Academy 2 queued with
 * NOTHING building, which the old model published as two hulls' worth of
 * parallel throughput from a faction delivering nothing at all.
 *
 * THE DIVIDEND. `baseConstructionTimeDays` is not the build time. Ship
 * construction time is scaled by the yard's tier (`constructionTimeModifier` in
 * TIHabModuleTemplate.json: SpaceDock 1.0, Shipyard 0.8, Spaceworks 0.6), by
 * other modules on the station (ConstructionModule 0.9, Nanofactory 0.75,
 * NanofacturingComplex 0.6) and by faction tech (`Effect_ShipConstructionTime
 * Reduction` x0.8, `...Reduction10` x0.9, `...Reduction5` x0.95, `...Minor`
 * x0.9875). The observer HOLDS `Effect_ShipConstructionTimeReduction` --
 * measured in `TIEffectsState.factionEffectsNames` on ExitSave.gz -- and runs
 * 11 Shipyard modules beside 3 Space Docks. Against the waiting entries that
 * state their own full duration, the ratio to the template base runs 0.30 to
 * 0.86 across five factions on that one save.
 *
 * So the template base OVERSTATES time and therefore UNDERSTATES the rate.
 * It is not substituted for silently: the record says `buildTimeBasis:
 * 'hull-template-base'` and `throughputBound: 'lower'`, and the rate is
 * published as a FLOOR. A stated duration from the observer's own queue is
 * used in preference wherever one exists, and then the bound is 'measured'.
 *
 * THE MEASURED PIPELINE. The save states `daysToCompletion` per queued hull and
 * it decrements by exactly the elapsed campaign days, so it already contains
 * every modifier above. Those horizons are reported as-is -- next completion,
 * last committed completion, deliveries inside 30 days -- and they are the one
 * part of this record that rests on no assumption whatsoever.
 *
 * @param {string|null} ownBestHullName the hull the rate is quoted for
 * @param {Object} shipHullStats template hull statistics
 * @param {Array|null} ownQueuedShips the observer's queue rows, null if unread
 * @param {Array|null} ownShipyards the observer's operational yard modules
 * @param {Array} shipDesigns designs, needed because a queue row's `hull` field
 *   is a MISNOMER: `buildShipyardQueues` sets both `design` and `hull` to the
 *   ship DESIGN template name (`playerShipTemplate475`), never to a hull class.
 *   Comparing that field against a hull name matches nothing, silently.
 */
function buildRebuildProjection({ ownBestHullName, shipHullStats, ownQueuedShips, ownShipyards, shipDesigns }) {
  const hullByDesignName = new Map();
  for (const design of (Array.isArray(shipDesigns) ? shipDesigns : [])) {
    for (const key of [design?.dataName, design?.templateName, design?.displayName, design?._displayName]) {
      if (typeof key === 'string' && key && design?.hullName) hullByDesignName.set(key, design.hullName);
    }
  }
  const baseHullStat = shipHullStats?.[ownBestHullName] || {};
  const baseBuildDays = toFiniteNumber(baseHullStat.baseConstructionTimeDays);
  const queuedCount = Array.isArray(ownQueuedShips) ? ownQueuedShips.length : null;

  // A ROW WITHOUT A READABLE STATUS MAKES THE CONCURRENCY UNKNOWN, NOT SMALLER.
  //
  // `rows.filter(r => r.constructionStatus === 'building').length` would count
  // a row whose status could not be read as "not building" and hand back a
  // confident smaller number -- the `Number(null) === 0` failure wearing a
  // filter. One unreadable status makes the whole count unknown.
  let concurrentBuilds = null;
  let buildingRows = [];
  if (queuedCount !== null) {
    const unreadable = ownQueuedShips.filter(row => typeof row?.constructionStatus !== 'string');
    if (unreadable.length === 0) {
      buildingRows = ownQueuedShips.filter(row => row.constructionStatus === 'building');
      concurrentBuilds = buildingRows.length;
    }
  }

  const shipyardCount = Array.isArray(ownShipyards) ? ownShipyards.length : null;
  // Distinct yards with a hull in progress. Measured at most one build per
  // yard, so this should equal `concurrentBuilds` -- it is computed separately
  // rather than assumed so a save that broke the rule would show the gap.
  const yardsBuilding = concurrentBuilds === null
    ? null
    : new Set(buildingRows.map(row => row.shipyardId).filter(id => id !== null && id !== undefined)).size;
  const idleShipyardCount = (shipyardCount === null || yardsBuilding === null)
    ? null
    : Math.max(0, shipyardCount - yardsBuilding);

  if (queuedCount === null || concurrentBuilds === null) {
    const missing = queuedCount === null
      ? 'no readable shipyard queue'
      : 'a queued hull whose construction status could not be read, which makes the number building UNKNOWN rather than smaller';
    return {
      available: false,
      reason: `Production throughput was not projected: ${missing}. `
        + 'No default build time or queue count is substituted, so this is not a report of zero throughput.',
      targetHull: ownBestHullName,
      baseConstructionDays: baseBuildDays,
      queuedHullCount: queuedCount,
      concurrentBuilds: null,
      waitingBehindCount: null,
      shipyardCount,
      shipyardsBuilding: null,
      idleShipyardCount: null,
      nextCompletionDays: null,
      lastCommittedCompletionDays: null,
      deliveriesWithin30Days: null,
      completionHorizonsUnreadableCount: null,
      buildDays: null,
      buildTimeBasis: null,
      throughputBound: null,
      throughputUnavailableReason: null,
      monthlyThroughputEst: null,
      daysPerHullEst: null,
      simulated: true
    };
  }

  // THE MEASURED HALF. Straight from the save's own countdowns, which already
  // contain yard tier, station modules and faction tech.
  const horizons = buildingRows
    .map(row => toFiniteNumber(row.daysToCompletion))
    .filter(value => value !== null)
    .sort((a, b) => a - b);
  const completionHorizonsUnreadableCount = buildingRows.length - horizons.length;
  const nextCompletionDays = horizons.length > 0 ? toSignificant(horizons[0]) : null;
  const lastCommittedCompletionDays = horizons.length > 0 ? toSignificant(horizons[horizons.length - 1]) : null;
  // Only counted when every horizon was readable: an unread countdown would
  // silently shrink this into a confident smaller delivery count.
  const deliveriesWithin30Days = completionHorizonsUnreadableCount === 0
    ? horizons.filter(value => value <= 30).length
    : null;

  // A DURATION STATED BY THE SAVE BEATS A TEMPLATE CONSTANT.
  //
  // A queued-but-not-yet-started entry carries the FULL nominal duration of
  // that build (measured: frozen across every interval), at that yard, with
  // every modifier already applied. Where one exists for the hull the rate is
  // quoted for, it is used and the bound is exact. Entries already building
  // carry only the REMAINING time, so they cannot supply a full duration and
  // are deliberately not read for one.
  const waitingRows = ownQueuedShips.filter(row => row.constructionStatus !== 'building');
  const statedForTargetHull = ownBestHullName === null ? [] : waitingRows
    .filter(row => row.isRefit !== true && hullByDesignName.get(row.design) === ownBestHullName)
    .map(row => toFiniteNumber(row.daysToCompletion))
    .filter(value => value !== null && value > 0);

  let buildDays = null;
  let buildTimeBasis = null;
  let throughputBound = null;
  if (statedForTargetHull.length > 0) {
    buildDays = Math.min(...statedForTargetHull);
    buildTimeBasis = 'measured-queue-entry';
    throughputBound = 'measured';
  } else if (baseBuildDays !== null && baseBuildDays > 0) {
    buildDays = baseBuildDays;
    buildTimeBasis = 'hull-template-base';
    // The template base ignores yard tier, station modules and faction tech,
    // every one of which only SHORTENS the build. So the rate derived from it
    // can only be too low, and it is published as a floor rather than as an
    // estimate.
    throughputBound = 'lower';
  }

  // An unreadable build time kills the RATE, not the record: the measured
  // pipeline above stands on its own and still reaches the consumer.
  const throughputUnavailableReason = buildDays !== null
    ? null
    : (baseBuildDays === null
      ? `no readable base construction time for ${ownBestHullName || 'the target hull'}, and no queued hull of that type states one`
      : `a base construction time of ${baseBuildDays} days, which cannot be divided into a rate`);

  // An empty queue -- or a queue where nothing has started -- is a MEASURED
  // zero rate. It is the one zero here that is a reading, and it is why the
  // old `Math.max(1, ...)` floor had to go rather than be lowered.
  const daysPerHull = (buildDays === null || concurrentBuilds === 0) ? null : buildDays / concurrentBuilds;
  return {
    available: true,
    targetHull: ownBestHullName,
    baseConstructionDays: baseBuildDays,
    queuedHullCount: queuedCount,
    concurrentBuilds,
    waitingBehindCount: queuedCount - concurrentBuilds,
    shipyardCount,
    shipyardsBuilding: yardsBuilding,
    idleShipyardCount,
    nextCompletionDays,
    lastCommittedCompletionDays,
    deliveriesWithin30Days,
    completionHorizonsUnreadableCount,
    buildDays: toSignificant(buildDays),
    buildTimeBasis,
    throughputBound,
    throughputUnavailableReason,
    monthlyThroughputEst: buildDays === null ? null : (concurrentBuilds === 0 ? 0 : toSignificant(30 / daysPerHull)),
    daysPerHullEst: toSignificant(daysPerHull),
    simulated: true
  };
}

/**
 * Runs Monte Carlo combat threshold and strategic projections simulation.
 */
function runMonteCarloSimulation(facts) {
  const {
    mode,
    snapshotId,
    alienFleets,
    shipDesigns,
    shipHullStats,
    actualAlienHate,
    hateVentRatePerDay,
    ownQueuedShips,
    ownShipyards,
    observerId
  } = facts;

  // 1. Determine Own Best Combat Hull
  const ownDesigns = (Array.isArray(shipDesigns) ? shipDesigns : []).filter(
    d => sameId(d.factionId, observerId)
  );

  // NO DEFAULT RATING, AND NO DEFAULT NAMES.
  //
  // This block used to open at `ownRating = 5000 // default baseline`, with
  // `'Combat Hull'` and `'Standard Combatant'` beside it. All three fired when
  // the observer had no design carrying a combat value, so a strength that
  // could not be MEASURED was simulated as a specific number and every
  // downstream verdict inherited it as though it were real. In omniscient mode
  // the opponent tiers are absolute design CVs, so the invented 5000 decided
  // every threshold outright; in player mode it also seeded the opponent
  // ratings themselves, since those are scaled off it.
  //
  // `shared/fleetEngagement.mjs` already models the correct behaviour for the
  // same quantity -- `available: false`, and it says no default was substituted
  // -- and this now follows it rather than inventing a third answer.
  let ownRating = null;
  let ownBestHullName = null;
  let ownBestDesignName = null;

  if (ownDesigns.length > 0) {
    const withCv = ownDesigns
      .map(d => ({ design: d, cv: toFiniteNumber(d._unnormalizedCombatValue) }))
      .filter(entry => entry.cv !== null)
      .sort((a, b) => b.cv - a.cv);
    if (withCv.length > 0) {
      ownRating = withCv[0].cv;
      ownBestHullName = withCv[0].design.hullName || null;
      ownBestDesignName = withCv[0].design.displayName
        || withCv[0].design._displayName
        || ownBestHullName;
    }
  }

  // Checked BEFORE the opponent tiers because player mode builds them by
  // scaling `ownRating`; a null there would silently produce opponent ratings
  // of 0 and a sweep over meaningless numbers.
  if (ownRating === null) {
    return {
      available: false,
      reason: 'the observer has no ship design carrying a combat value in this snapshot, so there is no '
        + 'own-side rating to sweep any engagement against. No default rating is substituted, and no '
        + 'hull threshold is reported.',
      ownBestHull: null,
      ownBestDesign: null,
      ownRating: null,
      tiers: [],
      projections: {}
    };
  }

  // 2. Build Opponent Tiers (Player vs Omniscient)
  let opponentTiers = null;
  let opponentSource = 'observable_fleet_telemetry';
  let opponentRatingBasis = OPPONENT_RATING_BASIS.player;
  // Why the tiers could not be built, when they could not. "Nothing is out
  // there" and "something is out there and I cannot measure it" are opposite
  // strategic statements, and the builders now refuse in both cases rather than
  // defaulting their way past the second -- so the guard below has to tell them
  // apart instead of reporting the reassuring one for both.
  let opponentUnavailableReason = 'No alien forces visible in this intelligence picture; simulation unavailable.';

  if (mode === 'omniscient') {
    const alienDesigns = (Array.isArray(shipDesigns) ? shipDesigns : []).filter(
      d => d.factionName === 'the Aliens' || sameId(d.factionId, 4717)
    );
    opponentTiers = buildOmniscientOpponentTiers(alienDesigns);
    opponentSource = 'true_design_blueprints';
    opponentRatingBasis = OPPONENT_RATING_BASIS.omniscient;
    if (!opponentTiers && alienDesigns.length > 0) {
      opponentUnavailableReason = `${alienDesigns.length} alien design(s) are visible but none carries a readable `
        + 'combat value, so no opponent rating could be measured. No default CV is substituted; this is NOT a '
        + 'report that the alien designs are weak.';
    }
  } else {
    opponentTiers = buildPlayerOpponentTiers(alienFleets, ownRating);
    opponentSource = 'observable_fleet_telemetry';
    opponentRatingBasis = OPPONENT_RATING_BASIS.player;
    if (!opponentTiers && Array.isArray(alienFleets) && alienFleets.length > 0) {
      opponentUnavailableReason = `${alienFleets.length} alien fleet(s) are visible but none carries a readable, `
        + 'positive armour median, so no opponent rating could be measured. No default armour is substituted; '
        + 'this is NOT a report that the alien fleets are weak.';
    }
  }

  // Zero-Opponent Guard: if no opponents are observable, return explicit unavailable state
  if (!opponentTiers || opponentTiers.length === 0) {
    return {
      available: false,
      reason: opponentUnavailableReason,
      ownBestHull: ownBestHullName,
      ownBestDesign: ownBestDesignName,
      // Measured, and reported even though the sweep did not run. It was
      // previously left undefined here, which JSON drops -- indistinguishable
      // downstream from a rating that could not be read.
      ownRating: Math.round(ownRating),
      tiers: [],
      projections: {}
    };
  }

  // 3. Simulate Combat Thresholds for Each Opponent Tier
  const tierResults = [];
  for (const tier of opponentTiers) {
    const result = findRequiredHullsForTier(
      ownRating,
      tier.opponentRating,
      `${snapshotId}-${tier.id}`,
      { opponentRatingBasis }
    );
    tierResults.push({
      id: tier.id,
      label: tier.label,
      description: tier.description,
      winnable: result.winnable,
      p20: result.p20,
      p80: result.p80,
      bandLabel: result.bandLabel,
      simulated: true,
      // The band never travels without what it covers. A consumer that renders
      // `bandLabel` alone would otherwise present Monte Carlo spread as though
      // it were the total uncertainty.
      uncertainty: result.uncertainty
    });
  }

  // 4. Hate Vent Projection
  //
  // FOUR REASONS FOR NO PROJECTION, AND THEY ARE NOT THE SAME REASON.
  //
  // Until 2026-08-22 this was `let hateVentProjection = null` behind a single
  // four-clause `if`, so every one of the reasons below arrived at the consumer
  // as the same bare `null`. The dashboard renders a projection card only when
  // `hateVent.available` is true, so all four read on the page as the absence
  // of a hate-venting story -- and one of them is not a story about hate at
  // all.
  //
  // THE PLAYER-MODE ONE IS THE DANGEROUS ONE. `campaignPosture.actualAlienHate`
  // is null in player mode by redaction (measured on the live save 2026-08-22:
  // 42.86 omniscient, null player), so the first clause can NEVER pass there.
  // Player mode therefore could not produce a vent horizon under any campaign
  // state whatsoever, and said so with the same silence it uses for "hostility
  // is below the floor" -- an unmeasurable input reported as a reassuring
  // finding. That is the exact shape of the Total War veto defect in CLAUDE.md.
  //
  // The threshold is `ALIEN_HATE_WAR_THRESHOLD` rather than a literal 50. Both
  // literals were already that constant's value, so nothing moves.
  let hateVentProjection;
  const ventBase = {
    available: false,
    currentHate: actualAlienHate,
    ventRatePerDay: hateVentRatePerDay,
    projectedDaysLow: null,
    projectedDaysHigh: null,
    bandLabel: null,
    simulated: true
  };
  if (actualAlienHate === null) {
    hateVentProjection = {
      ...ventBase,
      reason: 'the true alien hate value is not in this intelligence picture, so no venting horizon can be '
        + 'projected. In player mode it is redacted outright, which means this branch is the ONLY outcome '
        + `player mode can reach. This is NOT a report that hostility is stable or below ${ALIEN_HATE_WAR_THRESHOLD}.`
    };
  } else if (hateVentRatePerDay === null) {
    hateVentProjection = {
      ...ventBase,
      reason: 'no hate trend could be measured: the comparison against a previous save produced neither a '
        + 'hate delta nor an elapsed-day count, so the venting RATE is unknown. This is NOT a report that '
        + 'hostility is flat.'
    };
  } else if (hateVentRatePerDay >= 0) {
    hateVentProjection = {
      ...ventBase,
      // The sign is always non-negative in this branch, so it is written as a
      // literal rather than as a ternary that can only take one arm.
      reason: `hostility is not venting: the measured trend is +${hateVentRatePerDay} hate/day. A horizon to `
        + `${ALIEN_HATE_WAR_THRESHOLD} is only projected while the trend is downward.`
    };
  } else if (actualAlienHate <= ALIEN_HATE_WAR_THRESHOLD) {
    hateVentProjection = {
      ...ventBase,
      reason: `hostility is already at or below the ${ALIEN_HATE_WAR_THRESHOLD} war threshold this horizon `
        + `measures down to (currently ${actualAlienHate}), so there is nothing to project. This is a MEASURED `
        + 'state, not an unreadable one.'
    };
  } else {
    const daysToClear = (actualAlienHate - ALIEN_HATE_WAR_THRESHOLD) / Math.abs(hateVentRatePerDay);
    const lowDays = Math.max(1, Math.round(daysToClear * 0.85));
    const highDays = Math.max(lowDays + 1, Math.round(daysToClear * 1.15));
    hateVentProjection = {
      available: true,
      currentHate: actualAlienHate,
      ventRatePerDay: hateVentRatePerDay,
      projectedDaysLow: lowDays,
      projectedDaysHigh: highDays,
      bandLabel: `${lowDays}–${highDays} campaign days`,
      simulated: true
    };
  }

  // 5. Rebuild Throughput Projection
  //
  // NO BUILD-TIME OR QUEUE DEFAULTS, since 2026-08-22. This read
  // `baseConstructionTimeDays || 60` and `Math.max(1, queuedCount || 2)`, and
  // both were `available: true` -- so a hull whose build time was not in the
  // snapshot was reported as a 60-day hull, and an observer with NOTHING queued
  // was reported as running two shipyards. Both then went straight into a
  // "~N hulls/mo" figure on the dashboard with no mark saying it was invented.
  // Measured on ExitSave.gz: 0 of 28 hulls miss `baseConstructionTimeDays` and
  // `Monitor` reads 120, so both are latent -- and latent is not fixed.
  //
  // `queuedCount` of 0 is a MEASUREMENT and stays one: nothing queued means no
  // throughput, which is a real and useful answer, and it is why the `|| 2` had
  // to go rather than being replaced by a different floor.
  const rebuildProjection = buildRebuildProjection({
    ownBestHullName,
    shipHullStats,
    ownQueuedShips,
    ownShipyards,
    shipDesigns
  });

  return {
    available: true,
    source: opponentSource,
    ownBestHull: ownBestHullName,
    ownBestDesign: ownBestDesignName,
    ownRating: Math.round(ownRating),
    tiers: tierResults,
    projections: {
      hateVent: hateVentProjection,
      rebuildClock: rebuildProjection
    }
  };
}

module.exports = {
  runMonteCarloSimulation,
  buildRebuildProjection,
  buildPlayerOpponentTiers,
  buildOmniscientOpponentTiers,
  // Re-exported, not re-implemented: these are the SAME function objects
  // `shared/engagementModel.mjs` defines, so `require('./simulation')
  // .simulateEngagement === require('shared/engagementModel.mjs')
  // .simulateEngagement` and no caller of the old path moved.
  simulateEngagement,
  findRequiredHullsForTier,
  describeBandUncertainty,
  guaranteedWinHullCount,
  OPPONENT_RATING_BASIS,
  SIMULATION_SEEDS_COUNT,
  MAX_SIMULATED_HULLS,
  TARGET_WIN_PROBABILITY,
  BATTLE_TRIALS_PER_COUNT
};
