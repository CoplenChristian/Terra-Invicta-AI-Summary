/**
 * tests/reactPrimitivesRegisters.test.js
 *
 * Purpose: Measured/Estimated registers match verify_drive_explorer and
 * verify_mining_registers computed-style discipline.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

function readStyle(page, testId) {
  return page.evaluate((id) => {
    const host = document.querySelector(`[data-testid="${id}"]`);
    const el = host?.querySelector('[class*="__value"]') || host;
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily,
      fontStyle: s.fontStyle,
      fontWeight: s.fontWeight,
      color: s.color,
      className: el?.className || '',
    };
  }, testId);
}

test('Measured register is upright mono at full contrast (de)', async () => {
  await withPrimitivesHarnessPage('registers', async (page) => {
    const meas = await readStyle(page, 'meas-de');
    const est = await readStyle(page, 'est-de');

    assert.match(meas.fontFamily.toLowerCase(), /mono|cascadia|consolas/);
    assert.equal(meas.fontStyle, 'normal');
    assert.notEqual(meas.color, est.color, 'measured and estimated colors must differ');
    assert.equal(est.fontStyle, 'italic', 'estimated register must be italic');
  });
});

test('Measured vs Estimated registers differ on fe and mining class names', async () => {
  await withPrimitivesHarnessPage('registers', async (page) => {
    const feMeas = await readStyle(page, 'meas-fe');
    const feEst = await readStyle(page, 'est-fe');
    const miningMeas = await readStyle(page, 'meas-mining');
    const miningEst = await readStyle(page, 'est-mining');

    assert.equal(feMeas.fontStyle, 'normal', 'fe measured register stays upright');
    assert.equal(feEst.fontStyle, 'italic', 'fe estimated register is italic');
    assert.match(feMeas.className, /fe-meas__value/);
    assert.match(miningMeas.className, /mining-meas__value/);
    assert.notEqual(miningMeas.color, miningEst.color);
  });
});
