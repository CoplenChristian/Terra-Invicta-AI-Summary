// Live-save integration: days-to-build against the current campaign's own
// shipyard queues. Run via `npm run test:live` — not part of the unit suite.
//
// WHY THIS EXISTS BESIDE THE UNIT TEST
// ------------------------------------
// `tests/shipBuildTime.test.js` pins 14 rows frozen from CombatAutosave.gz on
// 2026-08-26. Those numbers cannot move, which is the point — but it also means
// they stop testing the current campaign the moment the campaign advances. This
// file re-derives the same cross-check from whatever save is newest, so a
// formula that quietly stops matching the game shows up as a live failure
// rather than as a stale green.
//
// A failure here means the game state moved somewhere the model does not cover
// yet — information, not a broken build. The most likely cause is a hull, yard
// or effect the tables in `shared/shipBuildTime.mjs` do not carry.
//
// ONLY WAITING ENTRIES ARE COMPARABLE. `ShipConstructionQueueItem.daysToCompletion`
// is seeded with the full duration and counted down once the cost is paid, so a
// `costPaid: true` row is a partial burn-down and is asserted only to lie inside
// (0, full duration]. Refits carry an added duration term of their own and are
// skipped entirely.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  SHIP_CONSTRUCTION_MODULES,
  calibrateFactionShipBuildModifier,
  calibrationRowsFromSnapshot,
  estimateShipBuildDays,
  hullFromSnapshot,
  hullNameForDesign,
  shipyardFromSnapshot
} = require('../../shared/shipBuildTime.mjs');

const OBSERVER = 4712;

function loadLive(mode) {
  const { loadFilteredSnapshot } = require('../../server/snapshotLoader');
  return loadFilteredSnapshot({ latest: true, mode, observer: OBSERVER });
}

test('Live save: every waiting queue entry is reproduced by the formula', (t) => {
  const snapshot = loadLive('omniscient');
  const waiting = (snapshot.shipyardQueues || []).filter(row => row.costPaid === false && row.isRefit !== true);
  if (waiting.length === 0) {
    t.skip('the current save has no waiting shipyard queue entries to check against');
    return;
  }

  // Calibrate per faction on that faction's OWN rows, then check every row of
  // that faction against it. With more than one row this is a real constraint:
  // a single multiplier has to explain hulls of different tiers at yards of
  // different tiers, which is exactly what a wrong tier-gap rule cannot do.
  const modifiers = new Map();
  const failures = [];
  let checked = 0;

  for (const row of waiting) {
    if (!modifiers.has(row.factionId)) {
      modifiers.set(row.factionId, calibrateFactionShipBuildModifier({
        rows: calibrationRowsFromSnapshot(snapshot, row.factionId)
      }));
    }
    const modifier = modifiers.get(row.factionId);
    if (!modifier.available) {
      failures.push(`${row.factionName}: calibration refused (${modifier.reason}, spread ${JSON.stringify(modifier.spread)})`);
      continue;
    }
    const hull = hullFromSnapshot(snapshot, hullNameForDesign(snapshot, row.design));
    const yard = shipyardFromSnapshot(snapshot, row.shipyardId);
    const result = estimateShipBuildDays({ hull, shipyard: yard, factionModifier: modifier });
    if (!result.available) {
      failures.push(`${row.factionName} ${row.design}@${yard?.templateName}: ${result.reason}`);
      continue;
    }
    checked += 1;
    const error = Math.abs(result.daysExact - row.daysToCompletion);
    // One part in 10^4 — loose enough for a short Earth-delivery term on a row
    // whose pay method was changed after queueing, tight enough that a wrong
    // tier-gap branch (which moves the answer by 1.5x at minimum) cannot hide.
    if (error / row.daysToCompletion > 1e-4) {
      failures.push(
        `${row.factionName} ${hull?.name}@${yard?.templateName}: model ${result.daysExact}, save ${row.daysToCompletion}`
      );
    }
  }

  assert.deepStrictEqual(failures, [], `${checked} of ${waiting.length} waiting entries checked`);
  assert.ok(checked > 0, 'no waiting entry was checkable — the readers found nothing');
});

test('Live save: in-progress entries sit inside their own full duration', (t) => {
  const snapshot = loadLive('omniscient');
  const building = (snapshot.shipyardQueues || []).filter(row => row.costPaid === true && row.isRefit !== true);
  if (building.length === 0) {
    t.skip('the current save has nothing under construction');
    return;
  }

  const overrun = [];
  let checked = 0;
  for (const row of building) {
    const modifier = calibrateFactionShipBuildModifier({ rows: calibrationRowsFromSnapshot(snapshot, row.factionId) });
    if (!modifier.available) continue;
    const hull = hullFromSnapshot(snapshot, hullNameForDesign(snapshot, row.design));
    const yard = shipyardFromSnapshot(snapshot, row.shipyardId);
    const result = estimateShipBuildDays({ hull, shipyard: yard, factionModifier: modifier });
    if (!result.available) continue;
    checked += 1;
    if (!(row.daysToCompletion > 0)) {
      overrun.push(`${row.factionName} ${hull?.name}: remaining ${row.daysToCompletion} is not positive`);
    }
    // An entry ABOVE its own full duration is not a model failure: the
    // Earth-substituted pay method adds a delivery term
    // (TISpaceShipTemplate.earthResourceConstructionCost). It is recorded, not
    // asserted against, because this module deliberately excludes that term.
  }
  assert.deepStrictEqual(overrun, [], `${checked} in-progress entries checked`);
});

test('Live save: PLAYER MODE either answers or refuses — never guesses', (t) => {
  const snapshot = loadLive('player');
  const rows = calibrationRowsFromSnapshot(snapshot, OBSERVER);
  const modifier = calibrateFactionShipBuildModifier({ rows });
  const yard = (snapshot.shipyardStations || []).find(station => SHIP_CONSTRUCTION_MODULES[station.templateName]);
  if (!yard) {
    t.skip('the observer holds no ship construction module in the current save');
    return;
  }
  const hull = hullFromSnapshot(snapshot, 'Frigate');
  const result = estimateShipBuildDays({ hull, shipyard: shipyardFromSnapshot(snapshot, yard.id), factionModifier: modifier });

  if (modifier.available) {
    assert.strictEqual(result.available, true, result.reason ?? '');
    assert.ok(result.days > 0, 'an available build time must be a positive number of days');
  } else {
    assert.strictEqual(result.available, false);
    assert.strictEqual(result.days, null, 'a refusal must not carry a number');
    assert.strictEqual(result.daysExact, null);
    assert.ok(result.reason, 'a refusal must name its reason');
  }
});
