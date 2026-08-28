// Live-save integration: the build recommendation against the current campaign.
// Run via `npm run test:live` — not part of the unit suite.
//
// WHY THIS EXISTS BESIDE THE FIXTURE TEST
// --------------------------------------
// `tests/theaterDefence.test.js` owns the shape, the arithmetic and every
// refusal path — but it owns the arithmetic only against HAND-BUILT worlds,
// because the committed fixtures produce ZERO measured build options in both
// modes. What only the live campaign can show is that the block is still in
// contact with a real board: that a real observer design gets named, that a
// real body with a real requirement resolves a real refusal, and above all that
// PLAYER MODE — the mode the dashboard defaults to — emits no hull count when
// pointed at the actual save rather than at a fixture.
//
// A failure here usually means the campaign moved somewhere the model does not
// cover yet. That is information, not a broken build.
//
// Like every other file in `tests/live/`, this MUST skip cleanly when no save
// is configured: there is no live campaign attached in CI, and "no save" is not
// a failure.

const { test } = require('node:test');
const assert = require('node:assert');

const { buildMilitaryWorld } = require('../../server/engine/military');
const {
  buildTheaterDefence,
  RECOMMENDATION_CHECKS
} = require('../../server/engine/theaterDefence');

const OBSERVER = 4712;

/** Shared skip guard: no configured save, or the game mid-write, is not a failure. */
function loadOrSkip(t, mode) {
  try {
    const { loadFilteredSnapshot } = require('../../server/snapshotLoader');
    return loadFilteredSnapshot({ latest: true, mode, observer: OBSERVER });
  } catch (err) {
    if (
      err.code === 'EBUSY' || err.code === 'ENOENT' || err.code === 'EPERM'
      || /EBUSY|locked|busy|No save path configured|Save folder not found|Save file not found|No \.gz or \.json save files found|No save files found/.test(err.message || '')
    ) {
      t.skip(`Skipping live save test: ${err.message}`);
      return null;
    }
    throw err;
  }
}

/**
 * ONE military world, handed to the block and returned beside it.
 *
 * Deliberately not two calls: `buildMilitaryWorld` composes fresh requirement
 * objects every time, so building it twice would make the by-reference test
 * below unfalsifiable -- it would fail on identity even where the block carried
 * the object through perfectly. That is exactly what the first cut of this file
 * did, and the test caught it.
 */
const liveBlock = (t, mode) => {
  const snapshot = loadOrSkip(t, mode);
  if (!snapshot) return null;
  const military = buildMilitaryWorld(snapshot, OBSERVER);
  return { military, block: buildTheaterDefence({ military }) };
};

test('Live save: every finding answers or refuses BY NAME, in both modes', (t) => {
  for (const mode of ['player', 'omniscient']) {
    const live = liveBlock(t, mode);
    if (!live) return;
    const { block } = live;

    assert.equal(block.available, true, `${mode}: the live board must produce findings`);
    assert.ok(block.findings.length > 0, `${mode}: the current campaign carries threatened theaters`);

    for (const finding of block.findings) {
      assert.notEqual(
        finding.recommendation !== null,
        finding.recommendationRefusal !== null,
        `${mode}: ${finding.body} must carry exactly one of recommendation / recommendationRefusal`
      );
      if (finding.recommendationRefusal) {
        assert.ok(
          Object.values(RECOMMENDATION_CHECKS).includes(finding.recommendationRefusal.check),
          `${mode}: ${finding.body} refused under the unnamed check `
          + `${finding.recommendationRefusal.check}`
        );
      }
      // The readings the verdict rests on are emitted either way. A refusal
      // that hides its inputs is an empty panel.
      assert.ok(finding.force, `${mode}: ${finding.body} carries no force readings`);
      assert.ok(finding.requiredDesignBuild, `${mode}: ${finding.body} carries no build reading`);
      assert.equal(finding.force.coverage.countsAreComparable, false, `${mode}: ${finding.body}`);
    }
  }
});

test('Live save: PLAYER MODE emits no hull count anywhere, and says why', (t) => {
  // The whole point of the feature's refusal half, measured against the actual
  // campaign rather than a fixture. Measured 2026-08-27: the same fleets read
  // 48-51 hulls in player mode against 5-6 in omniscient at Callisto -- an
  // order of magnitude, from an invented x1.5 constant.
  const live = liveBlock(t, 'player');
  if (!live) return;
  const { military, block } = live;
  const json = JSON.stringify(block);

  for (const finding of block.findings) {
    assert.equal(finding.recommendation, null, `${finding.body} must emit no recommendation`);
    assert.equal(finding.recommendationRefusal.check, RECOMMENDATION_CHECKS.ratingCalibration,
      `${finding.body}: calibration must refuse before any later check produces a number`);
    assert.equal(finding.force.calibrated, false, finding.body);
  }

  for (const key of ['p20', 'p80', 'hullsAtLeast', 'bandLabel', 'guaranteedWinAt', 'maxHullsSwept',
    'serialDeliverableBeforeContact', 'shortfallAtLeast']) {
    assert.equal(json.includes(`"${key}"`), false, `player mode leaked the hull-count field ${key}`);
  }

  // Scan for the TRUE values the read-model carries, not just for field names --
  // the four shipped player-mode leaks all had the derived field nulled while
  // the raw one it came from survived.
  const labels = [];
  for (const row of military.theaterForce) {
    for (const fleet of row.opponentFleets ?? []) {
      if (fleet.requirement?.bandLabel) labels.push(fleet.requirement.bandLabel);
    }
  }
  assert.ok(labels.length > 0,
    'the live save must carry player-mode hull bands on the read-model, or this proves nothing');
  for (const label of labels) {
    assert.equal(json.includes(label), false, `player mode leaked the band label ${label}`);
  }
  assert.deepEqual(json.match(/[0-9]+[^"]{0,3}hulls?/gi) ?? [], []);
});

test('Live save: OMNISCIENT names a real observer design for the requirement to count', (t) => {
  const live = liveBlock(t, 'omniscient');
  if (!live) return;
  const { block } = live;

  const named = block.findings.filter(f => f.force.own?.bestDesignName);
  assert.ok(named.length > 0,
    'the current campaign must carry at least one rated observer design, or every hull count on this '
    + 'board would have no unit');
  for (const finding of named) {
    assert.equal(typeof finding.force.own.bestDesignName, 'string');
    assert.ok(finding.force.own.bestHullName,
      `${finding.body}: a named design must carry the hull class its build time is priced against`);
  }
});

test('Live save: a body with no yard reads as a MEASURED ABSENCE, not an unmeasured time', (t) => {
  // Measured 2026-08-27: `buildOptions` is empty for Callisto -- the body with
  // the largest requirement on the board -- so this is the dominant real case,
  // not an edge one. It must never be answered by pointing at Mars.
  const live = liveBlock(t, 'omniscient');
  if (!live) return;
  const { military, block } = live;

  const buildableBodies = new Set(military.buildOptions.map(o => o.body));
  const yardless = block.findings.filter(f => f.requiredDesignBuild.yardsAtBody === 0);
  if (yardless.length === 0) {
    t.skip('the current campaign holds a yard at every threatened body; nothing to assert here');
    return;
  }

  for (const finding of yardless) {
    assert.equal(finding.requiredDesignBuild.available, false, finding.body);
    // Absent stays null. Never 0, never "fast", never the arrival date.
    assert.strictEqual(finding.requiredDesignBuild.fastestDays, null, finding.body);
    assert.match(finding.requiredDesignBuild.unavailableReason,
      /measured absence of build capacity, not an unmeasured build time/);
    // And it must not offer another body's production in its place.
    for (const body of buildableBodies) {
      if (body === finding.body) continue;
      assert.equal(finding.requiredDesignBuild.unavailableReason.includes(body), false,
        `${finding.body}: the refusal named ${body}, implying a delivery no transit model backs`);
    }
  }
});

test('Live save: every fleet has its requirement WITHHELD with a named reason, in both modes', (t) => {
  // After the universal hull-count removal, the block never carries a
  // requirement -- the reading still lives on `world.military.theaterForce`
  // with its own provenance, but this block withholds the CLAIM. This test
  // owns the withholding: in BOTH modes, every fleet on every finding has a
  // null `requirement` and a non-null `requirementWithheldReason` that
  // names the gate which fired.
  for (const mode of ['player', 'omniscient']) {
    const live = liveBlock(t, mode);
    if (!live) return;
    const { block } = live;

    let checked = 0;
    for (const finding of block.findings) {
      if (!Array.isArray(finding.force.fleets)) continue;
      for (const [index, fleet] of finding.force.fleets.entries()) {
        assert.strictEqual(fleet.requirement, null,
          `${mode}: ${finding.body} fleet ${index}: requirement must be withheld`);
        assert.ok(fleet.requirementWithheldReason,
          `${mode}: ${finding.body} fleet ${index}: a withheld reading must say why`);
        checked += 1;
      }
    }
    assert.ok(checked > 0,
      `the ${mode} live save must carry at least one fleet into the block, or this proves nothing`);
  }
});
