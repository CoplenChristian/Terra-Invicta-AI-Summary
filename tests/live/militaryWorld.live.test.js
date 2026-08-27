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

const OBSERVER = 4712;

function loadLive(mode) {
  const { loadFilteredSnapshot } = require('../../server/snapshotLoader');
  return loadFilteredSnapshot({ latest: true, mode, observer: OBSERVER });
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