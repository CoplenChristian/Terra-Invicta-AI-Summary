// Live-save integration: the military read-model against the current campaign.
// Run via `npm run test:live` — not part of the unit suite.
//
// WHY THIS EXISTS BESIDE THE FIXTURE TEST
// --------------------------------------
// `tests/engineMilitaryWorld.test.js` asserts the refusal path against the
// committed fixture, which is the only honest answer for that fixture: the
// observer faction it carries has neither `shipConstructionSpeed` nor
// `shipConstructionTimeEffects`, so refusing every (body, hull) is correct.
// The positive property — measured `fastestDays`, real yards considered, the
// full row shape — needs the current save, where the build modifier is
// actually populated. It lives here because that is where live-save contact
// is allowed.
//
// Like every other file in `tests/live/`, this MUST skip cleanly when no save
// is configured: there is no live campaign attached in CI, and "no save" is
// not a failure. The skip pattern matches `tests/live/holdGround.live.test.js`.

const { test } = require('node:test');
const assert = require('node:assert');

const { buildMilitaryWorld } = require('../../server/engine/military');
const { COMPOSITION_BASIS } = require('../../shared/fleetEngagement.mjs');

const OBSERVER = 4712;

function loadLive(mode) {
  const { loadFilteredSnapshot } = require('../../server/snapshotLoader');
  return loadFilteredSnapshot({ latest: true, mode, observer: OBSERVER });
}

/** Shared skip guard: no configured save, or the game mid-write, is not a failure. */
function loadOrSkip(t, mode) {
  try {
    return loadLive(mode);
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

test('Live save: buildOptions rows carry a measured fastestDays, never null', (t) => {
  let snapshot;
  try {
    snapshot = loadLive('omniscient');
  } catch (err) {
    if (
      err.code === 'EBUSY' || err.code === 'ENOENT' || err.code === 'EPERM'
      || /EBUSY|locked|busy|No save path configured|Save folder not found|Save file not found|No \.gz or \.json save files found|No save files found/.test(err.message || '')
    ) {
      t.skip(`Skipping live save test: ${err.message}`);
      return;
    }
    throw err;
  }

  const world = buildMilitaryWorld(snapshot, OBSERVER);
  assert.ok(world.buildOptions.length > 0,
    'the current save must produce at least one measured (body, hull) build option — '
    + 'if it does not, the model has lost contact with a live faction build modifier');

  for (const option of world.buildOptions) {
    assert.equal(typeof option.fastestDays, 'number',
      `fastestDays for ${option.body}/${option.hullName} must be a number`);
    assert.ok(Number.isFinite(option.fastestDays),
      `fastestDays for ${option.body}/${option.hullName} must be finite`);
    assert.ok(option.fastestDays > 0,
      `fastestDays for ${option.body}/${option.hullName} must be positive`);
    assert.ok(option.yardsConsidered > 0,
      `yardsConsidered for ${option.body}/${option.hullName} must be positive`);
    assert.ok(option.hullName,
      `hullName for ${option.body} must be present`);
    assert.ok(option.body,
      `body for ${option.hullName} must be present`);
    assert.ok('spaceTheaterKey' in option);
    assert.ok('shipyardId' in option);
    assert.ok('shipyardModuleTier' in option);
  }
});

// -----------------------------------------------------------------------------
// theaterForce: the positive half, which needs a campaign with fleets in it.
//
// `tests/engineTheaterForce.test.js` owns the shape and every refusal path
// against the committed fixtures. What only the live save can show is that the
// surface is still in contact with the current campaign: that the observer's
// own hulls and the aliens' still land on the twelve-body board and compose a
// rating there. A failure here means the campaign moved somewhere the model
// does not cover -- information, not a broken build.
// -----------------------------------------------------------------------------

test('Live save: theaterForce composes a rated body in both modes', (t) => {
  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadOrSkip(t, mode);
    if (!snapshot) return;

    const world = buildMilitaryWorld(snapshot, OBSERVER);
    const rows = world.theaterForce;

    assert.equal(rows.length, 12, `${mode}: one row per tracked body`);
    assert.deepEqual(rows.map(r => r.body), world.theaters.map(t2 => t2.body),
      `${mode}: theaterForce must stay row-for-row aligned with the board`);

    const unavailable = rows.filter(r => !r.available);
    assert.deepEqual(unavailable.map(r => `${r.body}: ${r.unavailableReason}`), [],
      `${mode}: every unavailable row must be explainable; if this fires, read the reasons`);

    assert.ok(rows.some(r => typeof r.own.rating === 'number' && r.own.rating > 0),
      `${mode}: the current save must compose an own-force rating at at least one tracked body -- `
      + 'if it does not, either the observer has no hull on the twelve-body board or the surface has '
      + 'lost contact with the fleet-engagement resource');

    for (const row of rows) {
      assert.equal(row.isEstimate, true, `${mode}/${row.body}`);
      assert.strictEqual(row.opponent.basis, COMPOSITION_BASIS[mode], `${mode}/${row.body}: basis verbatim`);
      assert.equal(row.calibrated, mode === 'omniscient', `${mode}/${row.body}: calibrated`);
      for (const side of ['own', 'opponent']) {
        const { rating, ratedShips } = row[side];
        if (rating === null) {
          assert.equal(ratedShips, 0, `${mode}/${row.body}/${side}: a null rating rates no ships`);
        } else {
          assert.ok(Number.isFinite(rating) && rating > 0, `${mode}/${row.body}/${side}: finite positive`);
          assert.ok(ratedShips > 0, `${mode}/${row.body}/${side}: a rating must be backed by ships`);
        }
      }
    }
  }
});
