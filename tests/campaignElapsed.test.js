// tests/campaignElapsed.test.js
//
// Purpose: pin the elapsed-campaign-time resolution order and its absent-stays-null
//   behaviour, and pin that the save's two real start-year fields are read.
//
// Every expected value here was measured against the live save BEFORE the
// change that introduced this module (frozen `ExitSave.gz`, campaign date
// 1/1/2035, MD5 5c0d9ef98213c91d8187ae11bf885d57):
//
//   TITimeState.daysInCampaign              3256   -> 8.91 years
//   TIGlobalResearchState.campaignStartYear 2026   -> 9    years
//   TIMetadataState.campaignStartYear       ABSENT
//   assumed 2022                                   -> 13   years (what shipped)
//
// Each test below was confirmed to FAIL when the code it covers is broken --
// a fixture captured from post-change output passes by construction.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const saveParser = require('../server/saveParser');
const {
  resolveCampaignElapsed,
  resolveAlienProgressionSpeed,
  CAMPAIGN_AGE_SOURCES,
  DAYS_PER_CAMPAIGN_YEAR
} = require('../shared/campaignElapsed.mjs');

// ---------------------------------------------------------------------------
// Resolution order.
// ---------------------------------------------------------------------------

test('daysInCampaign is preferred over subtracting the start year', () => {
  const elapsed = resolveCampaignElapsed({
    daysInCampaign: 3256,
    campaignStartYear: 2026,
    assumedCampaignStartYear: 2022
  }, 2035);

  assert.strictEqual(elapsed.yearsElapsed, 8.91, '3256 / 365.25, the live save');
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.daysInCampaign);
  assert.match(elapsed.sourceText, /^measured:/);
  assert.match(elapsed.sourceText, /daysInCampaign = 3256/);
  assert.strictEqual(elapsed.daysInCampaign, 3256);
  // The start year is still reported, because it is genuinely measured too --
  // it is simply not what produced the elapsed figure.
  assert.strictEqual(elapsed.campaignStartYear, 2026);
  assert.strictEqual(elapsed.campaignStartYearMeasured, true);
});

test('year subtraction over-reports, which is why it is second not first', () => {
  // A campaign that began on 2026-12-31 and now reads 2036-01-01 has run for
  // one day. Subtracting calendar years calls that 10 elapsed years, which
  // opens a 10-year total-war gate nine years early. This is a correctness
  // ordering, not a rounding nicety.
  const byYear = resolveCampaignElapsed({ campaignStartYear: 2026 }, 2036);
  assert.strictEqual(byYear.yearsElapsed, 10);

  const byDays = resolveCampaignElapsed({ daysInCampaign: 1, campaignStartYear: 2026 }, 2036);
  assert.strictEqual(byDays.yearsElapsed, 0, 'one day is not ten years');
});

test('the measured start year answers when there is no day count', () => {
  const elapsed = resolveCampaignElapsed({
    campaignStartYear: 2026,
    assumedCampaignStartYear: 2022
  }, 2035);

  assert.strictEqual(elapsed.yearsElapsed, 9);
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.startYear);
  assert.match(elapsed.sourceText, /^measured:/);
  assert.strictEqual(elapsed.campaignStartYearMeasured, true);
  assert.strictEqual(elapsed.daysInCampaign, null);
});

test('the assumption is reached only when the save carries neither reading, and says so', () => {
  const elapsed = resolveCampaignElapsed({
    assumedCampaignStartYear: 2022,
    campaignStartYearSource: 'assumed 2022 (ModernDayStart scenario start)'
  }, 2035);

  assert.strictEqual(elapsed.yearsElapsed, 13, 'what every save reported before this change');
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.assumed);
  assert.match(elapsed.sourceText, /assumed/);
  assert.strictEqual(elapsed.campaignStartYearMeasured, false,
    'an assumed start year must never be reported as measured');
  assert.strictEqual(elapsed.campaignStartYear, null);
});

// ---------------------------------------------------------------------------
// Absent stays null.
// ---------------------------------------------------------------------------

test('nothing readable reports null with a reason, never a confident zero', () => {
  const elapsed = resolveCampaignElapsed({}, 2035);
  assert.strictEqual(elapsed.yearsElapsed, null);
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.unavailable);
  assert.match(elapsed.sourceText, /unavailable/);
  assert.strictEqual(elapsed.campaignStartYearMeasured, false);

  // Null metadata entirely -- the shape a fixture or an older row can have.
  assert.strictEqual(resolveCampaignElapsed(null, null).yearsElapsed, null);
});

test('an empty or unparseable reading is null, not zero', () => {
  // Number('') and Number(null) are both 0 and both finite. If either reached
  // the arithmetic the campaign would report as brand new -- which reads as
  // "the total-war gate is the full 10 years away".
  for (const bad of ['', '   ', null, undefined, 'soon', NaN, Infinity, {}, []]) {
    const elapsed = resolveCampaignElapsed({ daysInCampaign: bad }, 2035);
    assert.notStrictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.daysInCampaign,
      `daysInCampaign=${JSON.stringify(bad)} must not be read as a day count`);
  }
});

test('day zero is a real campaign age and is not mistaken for absent', () => {
  const elapsed = resolveCampaignElapsed({ daysInCampaign: 0, campaignStartYear: 2026 }, 2026);
  assert.strictEqual(elapsed.yearsElapsed, 0);
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.daysInCampaign,
    'a campaign on its first day has a measured age of zero, not an unknown one');
});

test('a negative day count is treated as unreadable rather than as a negative age', () => {
  const elapsed = resolveCampaignElapsed({ daysInCampaign: -5, campaignStartYear: 2026 }, 2035);
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.startYear);
  assert.strictEqual(elapsed.yearsElapsed, 9);
});

test('a campaign year that cannot be parsed does not fabricate an elapsed time', () => {
  const elapsed = resolveCampaignElapsed({ campaignStartYear: 2026 }, null);
  assert.strictEqual(elapsed.yearsElapsed, null);
  assert.strictEqual(elapsed.source, CAMPAIGN_AGE_SOURCES.unavailable);
});

test('DAYS_PER_CAMPAIGN_YEAR is the Julian year the conversion actually uses', () => {
  assert.strictEqual(DAYS_PER_CAMPAIGN_YEAR, 365.25);
  assert.strictEqual(
    resolveCampaignElapsed({ daysInCampaign: 365.25 }, 2035).yearsElapsed,
    1
  );
});

// ---------------------------------------------------------------------------
// Alien progression speed.
// ---------------------------------------------------------------------------

test('alien progression speed reads the parsed multiplier, and absent stays null', () => {
  const withSetting = {
    campaignSettings: { settings: { alienProgressionSpeed: { multiplier: 2, value: 200 } } }
  };
  assert.strictEqual(resolveAlienProgressionSpeed(withSetting), 2);

  // No block at all -- a fixture, or a save parsed before the block existed.
  assert.strictEqual(resolveAlienProgressionSpeed({}), null);
  assert.strictEqual(resolveAlienProgressionSpeed(null), null);

  // Unreadable is null, never a confident 1 and never a 0. A zero would
  // annihilate the gate: `20 / 0` is Infinity.
  assert.strictEqual(
    resolveAlienProgressionSpeed({ campaignSettings: { settings: { alienProgressionSpeed: { multiplier: null } } } }),
    null
  );
  assert.strictEqual(
    resolveAlienProgressionSpeed({ campaignSettings: { settings: { alienProgressionSpeed: { multiplier: 0 } } } }),
    null,
    'a zero multiplier is not a speed; it would make the year gate infinite'
  );
});

// ---------------------------------------------------------------------------
// The save parser actually finds the two fields, in the states that carry them.
// ---------------------------------------------------------------------------

const withSave = (gamestates, assertions) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-elapsed-'));
  const file = path.join(dir, 'probe.json');
  fs.writeFileSync(file, JSON.stringify({ gamestates }));
  try {
    assertions(saveParser.readSaveJson(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('the parser reads campaignStartYear from TIGlobalResearchState, not TIMetadataState', () => {
  // Measured 2026-08-21 across all 14 saves in the user's save folder:
  // TIMetadataState carries campaignStartYear in 0 of 14, TIGlobalResearchState
  // in 14 of 14. Looking only at the former is why the measured value was
  // always null and the 2022 assumption was always used.
  withSave({
    'PavonisInteractive.TerraInvicta.TIMetadataState': [
      { Value: { gameTimeString: '1/1/2035 12:00:00 AM', difficulty: 'Normal' } }
    ],
    'PavonisInteractive.TerraInvicta.TIGlobalResearchState': [
      { Value: { campaignStartYear: 2026 } }
    ],
    'PavonisInteractive.TerraInvicta.TITimeState': [
      { Value: { daysInCampaign: 3256, currentQuarterSinceStart: 35 } }
    ]
  }, (parsed) => {
    assert.strictEqual(parsed.campaignStartYear, null, 'TIMetadataState genuinely has none');
    assert.strictEqual(parsed.campaignStartYearFromResearchState, 2026);
    assert.strictEqual(parsed.daysInCampaign, 3256);
  });
});

test('the parser reports both readings as null when the states are absent', () => {
  withSave({
    'PavonisInteractive.TerraInvicta.TIMetadataState': [
      { Value: { gameTimeString: '1/1/2035 12:00:00 AM', difficulty: 'Normal' } }
    ]
  }, (parsed) => {
    assert.strictEqual(parsed.campaignStartYearFromResearchState, null);
    assert.strictEqual(parsed.daysInCampaign, null);
  });
});

test('the parser does not turn an empty or non-numeric state field into zero', () => {
  withSave({
    'PavonisInteractive.TerraInvicta.TIGlobalResearchState': [{ Value: { campaignStartYear: '' } }],
    'PavonisInteractive.TerraInvicta.TITimeState': [{ Value: { daysInCampaign: 'many' } }]
  }, (parsed) => {
    assert.strictEqual(parsed.campaignStartYearFromResearchState, null);
    assert.strictEqual(parsed.daysInCampaign, null);
  });
});
