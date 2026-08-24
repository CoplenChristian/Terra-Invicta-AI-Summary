// Live-save integration: Hold Ground against the current campaign.
// Run via `npm run test:live` — not part of the unit suite.

const { test } = require('node:test');
const assert = require('node:assert');

const briefingGenerator = require('../../server/briefingGenerator');

test('Live save integration: Hold Ground fires in both modes with different wording', (t) => {
  const { loadFilteredSnapshot } = require('../../server/snapshotLoader');
  try {
    const player = briefingGenerator.generateMissionControlBriefing(
      loadFilteredSnapshot({ latest: true, mode: 'player', observer: 4712 })
    );
    const omniscient = briefingGenerator.generateMissionControlBriefing(
      loadFilteredSnapshot({ latest: true, mode: 'omniscient', observer: 4712 })
    );

    if (!player.holdGround.fires) {
      t.skip(`Current live save is not in a war pressure state (warPressure: ${player.holdGround.warPressure})`);
      return;
    }

    assert.strictEqual(player.holdGround.fires, true, 'fires in player mode');
    assert.strictEqual(omniscient.holdGround.fires, true, 'fires in omniscient mode');

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
      || /EBUSY|locked|busy|No save path configured|Save folder not found|Save file not found|No \.gz or \.json save files found|No save files found/.test(err.message || '')
    ) {
      t.skip(`Skipping live save test: ${err.message}`);
    } else {
      throw err;
    }
  }
});
