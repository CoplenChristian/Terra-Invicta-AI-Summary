/**
 * server/commentary/simulation.js
 * Purpose: Layer 3 of the strategic commentary — the opponent-tier builders and
 *   projection simulator over the shared Monte Carlo engagement sweep.
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
  const baseHullStat = shipHullStats?.[ownBestHullName] || {};
  const baseBuildDays = toFiniteNumber(baseHullStat.baseConstructionTimeDays);
  const queuedCount = Array.isArray(ownQueuedShips) ? ownQueuedShips.length : null;

  let rebuildProjection;
  if (baseBuildDays === null || baseBuildDays <= 0 || queuedCount === null) {
    const missing = [];
    if (baseBuildDays === null) missing.push(`no readable base construction time for ${ownBestHullName || 'the target hull'}`);
    else if (baseBuildDays <= 0) missing.push(`a base construction time of ${baseBuildDays} days, which cannot be divided into a rate`);
    if (queuedCount === null) missing.push('no readable shipyard queue');
    rebuildProjection = {
      available: false,
      reason: `Production throughput was not projected: ${missing.join(' and ')}. `
        + 'No default build time or queue count is substituted, so this is not a report of zero throughput.',
      targetHull: ownBestHullName,
      baseConstructionDays: baseBuildDays,
      activeShipyardQueues: queuedCount,
      monthlyThroughputEst: null,
      daysPerHullEst: null,
      simulated: true
    };
  } else {
    // NO THROUGHPUT FLOOR, since 2026-08-22.
    //
    // This read `Math.max(1, Math.round(30 / (baseBuildDays / queuedCount)))`,
    // and both operations destroyed the answer at the low end. `Math.round`
    // takes every rate under 0.5 to 0, and `Math.max(1, ...)` then replaces
    // that 0 with a 1 -- so a hull the observer can build once every four
    // months was published as "~1 hulls/mo", a number the model never
    // produced, presented with no mark saying it was a floor.
    //
    // The sub-1 answer is the IMPORTANT one, not an edge case to be smoothed
    // away: "you cannot replace this hull inside a month" and "you replace one
    // a month" lead to opposite decisions about whether to accept an
    // engagement. On the live save (ExitSave.gz, 1/1/2035) the true rate is
    // 1.25 hulls/mo in both modes and the old code printed 1; at the far more
    // common single-queued-hull state the true rate is 0.25 and the old code
    // printed the same 1.
    //
    // `daysPerHullEst` is the same measurement read the way a sub-1 rate is
    // actually usable -- 0.25 hulls/mo is one Monitor every 120 days.
    //
    // WHAT THE FIGURE ASSUMES, AND WHY THE EXPORT SAYS SO. `queuedCount` is a
    // count of QUEUED SHIPS, not of shipyards (`shipyardQueues` entries are
    // per-ship; war-room section 5 heads the same array "N ship(s) building").
    // Dividing the build time by it therefore assumes those hulls build in
    // PARALLEL. Five ships queued at one yard build serially and the true rate
    // would be 0.25, not 1.25. That assumption predates this change and is left
    // in place rather than silently re-modelled, but it is no longer unstated:
    // section 11 of /latest-war-room.md prints it beside the rate.
    const daysPerHull = queuedCount === 0 ? null : baseBuildDays / queuedCount;
    rebuildProjection = {
      available: true,
      targetHull: ownBestHullName,
      baseConstructionDays: baseBuildDays,
      activeShipyardQueues: queuedCount,
      // An empty queue is a MEASURED zero rate. It is the one zero here that is
      // a reading, and it is why the floor had to go rather than be lowered.
      monthlyThroughputEst: queuedCount === 0 ? 0 : toSignificant(30 / daysPerHull),
      daysPerHullEst: toSignificant(daysPerHull),
      simulated: true
    };
  }

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
