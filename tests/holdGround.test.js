const { test } = require('node:test');
const assert = require('node:assert');

const {
  assessCampaignPosture,
  summarizeFleetCapability,
  classifyWarPressure,
  buildHoldGround,
  DECISIVE_CAPABILITY_RATIO,
  CHEAPEST_HATE_ACTION_LOW
} = require('../server/directiveAdvisor');
const briefingGenerator = require('../server/briefingGenerator');
const { ALIEN_HATE_WAR_THRESHOLD } = require('../server/alienHateEconomics');

// ---------------------------------------------------------------------------
// Hold Ground — the affirmative posture directive
// (docs/directive-engine-v2-plan.md §4f)
//
// A hold used to be a SUPPRESSION: the engine could say "don't crackdown
// Japan", never "do this instead", so a cycle where the vetoes fired hard left
// the broad-actions board reading as "no information" when the truth was a
// specific and correct posture. These tests pin the two halves of the trigger,
// the three-state verdicts on each, and the degrade paths.
// ---------------------------------------------------------------------------

const ALIEN_FACTION = { ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil' };
const OBSERVER = { ID: 4712, displayName: 'the Initiative' };

/**
 * A fleet shaped like the live save's: fleet-level shipsCount / armorMedian /
 * lowestDeltaVKps plus the per-ship rows the aggregation prefers.
 */
function fleet(factionId, { ships = 10, armor = 5, deltaV = 100, visibility = null } = {}) {
  return {
    factionId,
    shipsCount: ships,
    armorMedian: armor,
    lowestDeltaVKps: deltaV,
    dominantWeaponType: 'Laser',
    visibility,
    ships: Array.from({ length: ships }, () => ({
      armorMedian: armor,
      currentMaxDeltaVKps: deltaV
    }))
  };
}

function postureFor({ own, alien, alienFactionShips = null, hate = null, pips = null, currentWarStatus = undefined }) {
  const factions = [
    { ...OBSERVER },
    alienFactionShips === null ? { ...ALIEN_FACTION } : { ...ALIEN_FACTION, shipsCount: alienFactionShips }
  ];
  return assessCampaignPosture({
    alienHateEconomics: {
      actualAlienHate: hate,
      currentWarStatus,
      minimumAlienHate: 36.6,
      usedMissionControl: 122
    },
    observer: { ...OBSERVER },
    observerHate: pips === null ? {} : { pips },
    factions,
    fleets: [...own, ...alien]
  });
}

// ---------------------------------------------------------------------------
// Half 2 — the capability comparison
// ---------------------------------------------------------------------------

test('the fleet comparison reads delta-V and armour, not just hull count', () => {
  // 240 obsolete hulls lose to 20 modern ones, which is exactly why counting
  // was the wrong test on its own.
  const capability = summarizeFleetCapability({
    observer: OBSERVER,
    factions: [OBSERVER, ALIEN_FACTION],
    fleets: [
      fleet(4712, { ships: 240, armor: 2, deltaV: 15 }),
      fleet(4717, { ships: 20, armor: 20, deltaV: 600 })
    ]
  });

  assert.strictEqual(capability.canContest, false, 'outnumbering them does not make us able to contest');
  const ships = capability.axes.find((axis) => axis.key === 'ships');
  assert.strictEqual(ships.decisive, false, 'we hold the hull-count axis');
  assert.strictEqual(capability.dominantDeficit.key, 'deltaV');
});

test('zero visible alien fleets is unknown, never "no threat"', () => {
  // THE highest-risk failure mode in this directive. Alien fleets reach a
  // player-mode snapshot only through a detection capability; with none, there
  // are no alien fleets in the snapshot at all. An empty sky because you
  // cannot see is not an empty sky.
  const capability = summarizeFleetCapability({
    observer: OBSERVER,
    factions: [OBSERVER, ALIEN_FACTION],
    fleets: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })]
  });

  assert.strictEqual(capability.canContest, 'unknown');
  assert.notStrictEqual(capability.canContest, true);
  assert.strictEqual(capability.alienFleetsVisible, 0);
  assert.match(capability.verdictReason, /detection capability/i);
  assert.ok(
    !/\bclear\b|no threat|safe/i.test(capability.verdictReason),
    `blindness reported as safety: ${capability.verdictReason}`
  );
});

test('an axis absent on either side is excluded by name, not counted as parity', () => {
  const capability = summarizeFleetCapability({
    observer: OBSERVER,
    factions: [OBSERVER, ALIEN_FACTION],
    fleets: [
      // No per-ship rows and no fleet-level armour/delta-V on our side.
      { factionId: 4712, shipsCount: 30 },
      fleet(4717, { ships: 40, armor: 10, deltaV: 400 })
    ]
  });

  const keys = capability.axes.map((axis) => axis.key);
  assert.deepStrictEqual(keys, ['ships'], 'only the measurable axis is scored');
  assert.strictEqual(capability.excludedAxes.length, 2);
  for (const excluded of capability.excludedAxes) {
    assert.match(excluded.reason, /not measurable/i);
  }
});

test('a fleet at parity can contest, and that is a reason not to hold', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 40, armor: 10, deltaV: 300 })],
    alien: [fleet(4717, { ships: 40, armor: 10, deltaV: 300 })],
    hate: 71.6,
    currentWarStatus: 'WAR THRESHOLD EXCEEDED'
  });

  assert.strictEqual(posture.fleetCapability.canContest, true);
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });
  assert.strictEqual(hold.fires, false, 'being able to fight is an argument against holding');
  assert.match(hold.standDownReason, /can contest/i);
});

test('combatPower is never used — it carries no data in any mode', () => {
  const capability = summarizeFleetCapability({
    observer: OBSERVER,
    factions: [OBSERVER, ALIEN_FACTION],
    fleets: [
      { ...fleet(4712, { ships: 28 }), combatPower: 9999, combatPowerAvailable: false },
      { ...fleet(4717, { ships: 348 }), combatPower: 1, combatPowerAvailable: false }
    ]
  });
  assert.ok(!capability.axes.some((axis) => axis.key === 'combatPower'));
  assert.match(capability.combatPowerExcluded, /not present in save/i);
});

// ---------------------------------------------------------------------------
// Half 1 — war pressure, and the saturated meter
// ---------------------------------------------------------------------------

test('war pressure separates at-war, one-action-away, clear, and blind', () => {
  assert.strictEqual(
    classifyWarPressure({ actualAlienHate: 71.6, warHeadroom: -21.6, pips: null }),
    'at-war'
  );
  // 0.44 of headroom does not survive the cheapest hate-generating mission's
  // worst case, so the next offensive starts the war rather than risking it.
  assert.strictEqual(
    classifyWarPressure({ actualAlienHate: 49.56, warHeadroom: 0.44, pips: null }),
    'on-the-line'
  );
  assert.ok(CHEAPEST_HATE_ACTION_LOW > 0.44);
  assert.strictEqual(
    classifyWarPressure({ actualAlienHate: 22, warHeadroom: 28, pips: null }),
    'clear'
  );
  // pips = round(hate/10) capped at 5, so five diamonds means ">= 45" and
  // nothing more precise. It must not resolve to either "at war" or "clear".
  assert.strictEqual(classifyWarPressure({ actualAlienHate: null, warHeadroom: null, pips: 5 }), 'saturated');
  assert.strictEqual(classifyWarPressure({ actualAlienHate: null, warHeadroom: null, pips: 3 }), 'clear');
  assert.strictEqual(classifyWarPressure({ actualAlienHate: null, warHeadroom: null, pips: null }), 'unknown');
});

test('a saturated meter never asserts the war is confirmed', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690, visibility: 'Deep System Skywatch' })],
    pips: 5
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: { minimumAlienHate: 36.6, usedMissionControl: 122 } });

  assert.strictEqual(hold.fires, true);
  assert.strictEqual(hold.warPressure, 'saturated');
  assert.strictEqual(hold.warConfirmed, 'unknown', 'never true from a saturated meter');
  assert.match(hold.warLine, /saturates/i);
  assert.ok(
    !/at or past the war threshold|the aliens are hunting/i.test(hold.statement),
    `player-mode copy asserts a war it cannot see: ${hold.statement}`
  );
  assert.match(hold.exit.condition, /not observable/i);
});

test('a measured hate below the line words the exit as "has not started"', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    hate: 49.56
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });

  assert.strictEqual(hold.warPressure, 'on-the-line');
  assert.strictEqual(hold.warConfirmed, false);
  assert.match(hold.exit.condition, /has not started/i);
  assert.match(hold.warLine, /0\.44 of headroom/);
});

// ---------------------------------------------------------------------------
// What it recommends
// ---------------------------------------------------------------------------

test('the research axis follows the measured dominant deficit, not a fixed list', () => {
  // Armour is the gap here and delta-V is fine, so recommending drives would
  // be recommending from a hardcoded opinion instead of the measurement.
  const posture = postureFor({
    own: [fleet(4712, { ships: 30, armor: 2, deltaV: 300 })],
    alien: [fleet(4717, { ships: 30, armor: 20, deltaV: 300 })],
    hate: 71.6,
    currentWarStatus: 'WAR THRESHOLD EXCEEDED'
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });

  assert.strictEqual(hold.fires, true);
  assert.strictEqual(hold.comparison.axes.find((a) => a.key === 'armor').decisive, true);
  assert.strictEqual(hold.comparison.axes.find((a) => a.key === 'deltaV').decisive, false);
  assert.match(hold.recommendations[0].label, /armour/i);
  assert.ok(!/drive|propulsion/i.test(hold.recommendations[0].label), hold.recommendations[0].label);
  assert.ok(!/drive|propulsion/i.test(hold.action), hold.action);
});

test('the same shape with delta-V as the gap recommends drives instead', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 30, armor: 10, deltaV: 20 })],
    alien: [fleet(4717, { ships: 30, armor: 10, deltaV: 300 })],
    hate: 71.6,
    currentWarStatus: 'WAR THRESHOLD EXCEEDED'
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });
  assert.match(hold.recommendations[0].label, /drive|propulsion/i);
});

test('a hold never silences the zero-hate work', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    pips: 5
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });

  // Advise, Defend Interests and Public Campaign all carry a template
  // success-slot hate of 0, so a hate hold cannot touch them.
  for (const mission of ['Advise', 'Defend Interests', 'Public Campaign']) {
    assert.ok(hold.zeroHateMissions.includes(mission), `${mission} must stay available during a hold`);
  }
  assert.ok(hold.recommendations.some((rec) => /advise/i.test(rec.label)));
  for (const entry of hold.deferred) {
    assert.ok(entry.successHate > 0, `${entry.missionType} has 0 hate and must not be deferred`);
  }
});

test('the deferred list prices each held action and its effect on headroom', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    hate: 49.56
  });
  const hold = buildHoldGround({
    posture,
    alienHateEconomics: {},
    deferredCounts: { Purge: 41 }
  });

  const purge = hold.deferred.find((entry) => entry.missionType === 'Purge');
  assert.strictEqual(purge.successHate, 5);
  assert.strictEqual(purge.hateBand, '+4.0–6.0');
  assert.match(purge.headroomEffect, /crosses the threshold/i);
  assert.strictEqual(purge.heldCandidates, 41);

  // Absent stays absent: a mission with no held candidates reports null, never
  // a fabricated 0.
  const crackdown = hold.deferred.find((entry) => entry.missionType === 'Crackdown');
  assert.strictEqual(crackdown.heldCandidates, null);
});

// ---------------------------------------------------------------------------
// The exit condition
// ---------------------------------------------------------------------------

test('the exit names the threshold and the Mission Control floor beneath it', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    hate: 71.6,
    currentWarStatus: 'WAR THRESHOLD EXCEEDED'
  });
  const hold = buildHoldGround({
    posture,
    alienHateEconomics: { minimumAlienHate: 36.6, usedMissionControl: 122 }
  });

  assert.strictEqual(hold.exit.threshold, ALIEN_HATE_WAR_THRESHOLD);
  assert.match(hold.exit.condition, new RegExp(String(ALIEN_HATE_WAR_THRESHOLD)));
  assert.match(hold.exit.floorNote, /36\.6/);
  assert.match(hold.exit.floorNote, /122 MC in use/);
});

test('a floor at or above the threshold says venting cannot end the war', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    hate: 71.6,
    currentWarStatus: 'WAR THRESHOLD EXCEEDED'
  });
  const hold = buildHoldGround({
    posture,
    alienHateEconomics: { minimumAlienHate: 66, usedMissionControl: 220 }
  });
  assert.match(hold.exit.floorNote, /cannot end this war/i);
});

test('an unmeasured floor says so instead of estimating one', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    pips: 5
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });
  assert.strictEqual(hold.exit.floor, null, 'absent stays null');
  assert.match(hold.exit.floorNote, /not measurable/i);
});

test('the venting rate is measured when observable and refused when it is not', () => {
  const measurable = buildHoldGround({
    posture: postureFor({
      own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
      alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
      hate: 62,
      currentWarStatus: 'WAR THRESHOLD EXCEEDED'
    }),
    alienHateEconomics: {},
    hateTrend: { delta: -6.2, from: 68.2, to: 62, elapsedGameDays: 31 }
  });
  assert.match(measurable.exit.trendText, /-6\.20 over 31\.0 campaign days/);
  assert.match(measurable.exit.estimateText, /60\.0 campaign days/);
  assert.match(measurable.exit.estimateText, /straight-line projection/i);

  const blind = buildHoldGround({
    posture: postureFor({
      own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
      alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
      pips: 5
    }),
    alienHateEconomics: {}
  });
  assert.strictEqual(blind.exit.estimateText, null, 'no estimate is better than a fabricated one');
  assert.match(blind.exit.trendText, /not measurable in player mode/i);
});

test('a rising trend refuses to project a return date', () => {
  const hold = buildHoldGround({
    posture: postureFor({
      own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
      alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
      hate: 62,
      currentWarStatus: 'WAR THRESHOLD EXCEEDED'
    }),
    alienHateEconomics: {},
    hateTrend: { delta: 0.15, from: 61.85, to: 62, elapsedGameDays: 15.5 }
  });
  assert.match(hold.exit.estimateText, /not venting/i);
  assert.ok(!/campaign day/i.test(hold.exit.estimateText), hold.exit.estimateText);
});

// ---------------------------------------------------------------------------
// Blind-but-pressured: the degrade path that must not read as safety
// ---------------------------------------------------------------------------

test('war pressure with an unmeasurable fleet comparison still holds, with a caveat', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [],
    pips: 5
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });

  assert.strictEqual(hold.canContest, 'unknown');
  assert.strictEqual(hold.fires, true, 'unknown degrades to recommend-with-caveat, never to "you are fine"');
  assert.match(hold.capabilityLine, /UNKNOWN/);
  assert.match(hold.recommendations[0].label, /detection gap/i);
  assert.match(hold.recommendations[0].detail, /not that the sky is empty|comparison/i);
  // Still names the zero-hate work rather than degrading to an empty board.
  assert.ok(hold.recommendations.some((rec) => /advise/i.test(rec.label)));
});

test('nothing fires when hate is measurably clear of the threshold', () => {
  const posture = postureFor({
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690 })],
    hate: 22
  });
  const hold = buildHoldGround({ posture, alienHateEconomics: {} });
  assert.strictEqual(hold.fires, false);
  assert.match(hold.standDownReason, /measurably clear/i);
});

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

function briefingWith({ hate = null, pips = null, currentWarStatus = undefined, own, alien }) {
  return briefingGenerator.generateMissionControlBriefing({
    metadata: { gameTimeString: '5/16/2033' },
    observerFactionId: 4712,
    mode: hate === null ? 'player' : 'omniscient',
    alienHateEconomics: {
      actualAlienHate: hate,
      currentWarStatus,
      minimumAlienHate: 36.6,
      usedMissionControl: 122
    },
    factions: [
      { ID: 4712, displayName: 'the Initiative', templateName: 'CooperateCouncil', alienHate: pips === null ? undefined : { pips } },
      { ...ALIEN_FACTION }
    ],
    councilors: [],
    nations: [],
    fleets: [...own, ...alien],
    habs: [],
    habSites: []
  });
}

test('the board leads with Hold Ground, and it survives a board with no proxy target', () => {
  // The case the old geo-hold could not reach: no servant targets at all, so
  // the whole geopolitical group used to degrade to a standing Defend
  // Interests order with no posture reasoning attached.
  const briefing = briefingWith({
    pips: 5,
    own: [fleet(4712, { ships: 28, armor: 2, deltaV: 14 })],
    alien: [fleet(4717, { ships: 348, armor: 11, deltaV: 690, visibility: 'Deep System Skywatch' })]
  });

  const directive = briefing.directives.geopolitical.find((d) => d.id === 'hold-ground');
  assert.ok(directive, 'Hold Ground reaches the broad-actions board');
  assert.strictEqual(briefing.primaryDirective.id, 'hold-ground');
  assert.strictEqual(briefing.holdGround.fires, true);

  // Nothing on the card may render as a raw absence.
  for (const [key, value] of Object.entries(directive)) {
    if (typeof value !== 'string') continue;
    assert.ok(
      !/\b(null|undefined|NaN)\b/.test(value),
      `directive.${key} renders an absent value verbatim: ${value}`
    );
  }
});

test('the board drops Hold Ground when the fleet can contest', () => {
  const briefing = briefingWith({
    hate: 71.6,
    currentWarStatus: 'WAR THRESHOLD EXCEEDED',
    own: [fleet(4712, { ships: 40, armor: 10, deltaV: 300 })],
    alien: [fleet(4717, { ships: 40, armor: 10, deltaV: 300 })]
  });

  assert.ok(!briefing.directives.geopolitical.some((d) => d.id === 'hold-ground'));
  assert.strictEqual(briefing.holdGround.fires, false);
  assert.notStrictEqual(briefing.primaryDirective?.id, 'hold-ground');
});

test('the decisive ratio is one named constant, not a scattered literal', () => {
  assert.strictEqual(typeof DECISIVE_CAPABILITY_RATIO, 'number');
  assert.ok(DECISIVE_CAPABILITY_RATIO > 1);
});

// ---------------------------------------------------------------------------
// The live campaign
//
// The acceptance criterion is explicitly about the CURRENT save in BOTH modes,
// so the synthetic fixtures above are not enough on their own. Skipped, never
// silently passed, when the save is locked or absent -- the game rewrites it
// while it runs.
// ---------------------------------------------------------------------------

test('Live save integration: Hold Ground fires in both modes with different wording', (t) => {
  const { loadFilteredSnapshot } = require('../server/snapshotLoader');
  try {
    const player = briefingGenerator.generateMissionControlBriefing(
      loadFilteredSnapshot({ latest: true, mode: 'player', observer: 4712 })
    );
    const omniscient = briefingGenerator.generateMissionControlBriefing(
      loadFilteredSnapshot({ latest: true, mode: 'omniscient', observer: 4712 })
    );

    assert.strictEqual(player.holdGround.fires, true, 'fires in player mode');
    assert.strictEqual(omniscient.holdGround.fires, true, 'fires in omniscient mode');

    // Same recommendation, different wording -- that is the whole point of the
    // saturated-meter handling.
    assert.strictEqual(
      player.holdGround.recommendations[0].kind,
      omniscient.holdGround.recommendations[0].kind
    );
    assert.strictEqual(
      player.holdGround.recommendations[0].label,
      omniscient.holdGround.recommendations[0].label
    );
    assert.notStrictEqual(
      player.holdGround.headline,
      omniscient.holdGround.headline,
      'the two modes must not read identically — one of them knows the hate figure'
    );
    assert.strictEqual(player.holdGround.warPressure, 'saturated');
    assert.notStrictEqual(player.holdGround.warConfirmed, true);
    assert.strictEqual(player.campaignPosture.actualAlienHate, null, 'player mode stays redacted');

    // Player mode cannot measure a venting rate and must say so rather than
    // borrowing the redacted figure through the previous-save comparison.
    assert.match(player.holdGround.exit.trendText, /not measurable in player mode/i);
    assert.strictEqual(player.holdGround.exit.estimateText, null);

    for (const briefing of [player, omniscient]) {
      const directive = briefing.directives.geopolitical.find((d) => d.id === 'hold-ground');
      assert.ok(directive, 'the directive reaches the broad-actions board');
      for (const [key, value] of Object.entries(directive)) {
        if (typeof value !== 'string') continue;
        assert.ok(
          !/\b(null|undefined|NaN)\b/.test(value),
          `directive.${key} renders an absent value verbatim: ${value}`
        );
      }
    }
  } catch (err) {
    if (
      err.code === 'EBUSY' || err.code === 'ENOENT' || err.code === 'EPERM'
      || /EBUSY|locked|busy|No save path configured|Save folder not found|No save files found/.test(err.message || '')
    ) {
      t.skip(`Skipping live save test: ${err.message}`);
    } else {
      throw err;
    }
  }
});
