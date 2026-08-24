// Live-save integration: risk-tolerance floor against the current campaign.
// Run via `npm run test:live` — not part of the unit suite.

const { test } = require('node:test');
const assert = require('node:assert');

const briefingGenerator = require('../../server/briefingGenerator');

function liveBriefing(mode, riskFloorPercent) {
  const { loadFilteredSnapshot } = require('../../server/snapshotLoader');
  return briefingGenerator.generateMissionControlBriefing(
    loadFilteredSnapshot({ latest: true, mode, observer: 4712 }),
    null,
    { riskFloorPercent }
  );
}

function skipIfSaveUnavailable(t, err) {
  if (
    err.code === 'EBUSY' || err.code === 'ENOENT' || err.code === 'EPERM'
    || /EBUSY|locked|busy|No save path configured|Save folder not found|Save file not found|No \.gz or \.json save files found|No save files found/.test(err.message || '')
  ) {
    t.skip(`Skipping live save test: ${err.message}`);
    return true;
  }
  return false;
}

test('Live save, omniscient: a 90% floor vetoes the straddling Purge and an 88% floor does not', (t) => {
  try {
    const ids = (briefing) => briefing.engineDirectives.cyclePlan.assignments.map((a) => a.candidateId);

    const baseline = liveBriefing('omniscient', 0);
    const straddler = baseline.engineDirectives.cyclePlan.assignments.find(
      (a) => a.odds?.automatic !== true && Array.isArray(a.odds?.band) && a.odds.band[0] < a.odds.point
    );
    if (!straddler) {
      t.skip('The current live save has no assigned contested action whose band straddles its midpoint.');
      return;
    }

    const bandLow = straddler.odds.band[0];
    const point = straddler.odds.point;
    assert.ok(bandLow < point, 'the discriminator needs band low below the midpoint');

    const kept = liveBriefing('omniscient', bandLow);
    const dropped = liveBriefing('omniscient', bandLow + 1);

    assert.ok(ids(kept).includes(straddler.candidateId),
      `a floor at the band low (${bandLow}) must keep ${straddler.candidateId}`);
    assert.ok(!ids(dropped).includes(straddler.candidateId),
      `a floor one point above the band low (${bandLow + 1}) must drop ${straddler.candidateId}, `
      + `even though its midpoint is ${point}`);
    assert.ok(bandLow + 1 <= point, 'the midpoint would still have cleared the vetoing floor — that is the whole test');

    const held = dropped.engineDirectives.cyclePlan.riskFloorVetoed
      .find((entry) => entry.candidateId === straddler.candidateId);
    assert.ok(held, 'the vetoed action is recorded, not silently missing');
    assert.strictEqual(held.floorPercent, bandLow + 1);
    assert.match(held.reason, new RegExp(`${bandLow + 1}% floor`));

    if (ids(baseline).includes('purge:3728:3729')) {
      assert.strictEqual(straddler.candidateId, 'purge:3728:3729');
      assert.strictEqual(point, 93);
      assert.deepStrictEqual(straddler.odds.band, [89, 96]);
      assert.strictEqual(straddler.odds.assumed, true);
      assert.ok(!ids(liveBriefing('omniscient', 90)).includes('purge:3728:3729'));
      assert.ok(ids(liveBriefing('omniscient', 88)).includes('purge:3728:3729'));
    }
  } catch (err) {
    if (!skipIfSaveUnavailable(t, err)) throw err;
  }
});

test('Live save, both modes: a floor of 0 changes nothing and automatic assignments survive a 100% floor', (t) => {
  try {
    for (const mode of ['player', 'omniscient']) {
      const ids = (briefing) => briefing.engineDirectives.cyclePlan.assignments.map((a) => a.candidateId);

      const baseline = liveBriefing(mode, 0);
      assert.strictEqual(baseline.engineDirectives.cyclePlan.riskFloorVetoedTotalCount, 0,
        `${mode}: a floor of 0 must veto nothing`);
      assert.deepStrictEqual(baseline.engineDirectives.cyclePlan.riskFloor,
        { percent: 0, inForce: false, configured: true }, `${mode}: floor readout`);

      const maxFloor = liveBriefing(mode, 100);
      assert.strictEqual(maxFloor.engineDirectives.cyclePlan.riskFloor.inForce, true, `${mode}: 100% floor is in force`);

      const automaticIds = baseline.engineDirectives.cyclePlan.assignments
        .filter((a) => a.odds?.automatic === true).map((a) => a.candidateId);
      const contestedIds = baseline.engineDirectives.cyclePlan.assignments
        .filter((a) => a.odds?.automatic !== true).map((a) => a.candidateId);

      assert.ok(automaticIds.length > 0, `${mode}: expected at least one uncontested assignment in the baseline`);
      for (const id of automaticIds) {
        assert.ok(ids(maxFloor).includes(id), `${mode}: uncontested ${id} must clear a 100% floor`);
      }
      for (const id of contestedIds) {
        assert.ok(!ids(maxFloor).includes(id), `${mode}: contested ${id} cannot clear a 100% floor`);
      }

      for (const entry of maxFloor.engineDirectives.cyclePlan.riskFloorVetoed) {
        assert.match(entry.reason, /floor/i);
        assert.strictEqual(entry.floorPercent, 100);
      }
    }
  } catch (err) {
    if (!skipIfSaveUnavailable(t, err)) throw err;
  }
});

test('Live save: player mode and omniscient mode are genuinely different boards under the same floor', (t) => {
  try {
    const player = liveBriefing('player', 90).engineDirectives.cyclePlan;
    const omniscient = liveBriefing('omniscient', 90).engineDirectives.cyclePlan;

    assert.strictEqual(player.riskFloor.percent, 90);
    assert.strictEqual(omniscient.riskFloor.percent, 90);

    assert.notStrictEqual(
      player.riskFloorVetoedTotalCount + omniscient.riskFloorVetoedTotalCount,
      0,
      'a 90% floor should hold back something in at least one mode'
    );

    for (const plan of [player, omniscient]) {
      for (const entry of plan.riskFloorVetoed) {
        assert.strictEqual(typeof entry.reason, 'string');
        assert.ok(!/\b(null|undefined|NaN)\b/.test(entry.reason), `absent value rendered verbatim: ${entry.reason}`);
        assert.ok(entry.bandLow === null || entry.bandLow < 90, 'a vetoed entry must be below the floor at its band low');
      }
      for (const assignment of plan.assignments) {
        if (!assignment.riskFloor) continue;
        assert.ok(['pass', 'unknown'].includes(assignment.riskFloor.outcome),
          'no assignment may carry a veto verdict');
      }
    }
  } catch (err) {
    if (!skipIfSaveUnavailable(t, err)) throw err;
  }
});
