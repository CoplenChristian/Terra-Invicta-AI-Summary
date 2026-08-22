// tests/campaignSettings.test.js
//
// The custom-difficulty block: parsed without the `Number("200%") === NaN`
// trap, baked into the snapshot, and never rendered as a stock difficulty.
//
// Expected values here were read off the raw save BEFORE the change (see
// docs/campaign-settings-spec.md), not captured from this code's own output.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CAMPAIGN_SETTING_FIELDS,
  CAMPAIGN_SETTING_NUMERIC_FIELDS,
  CAMPAIGN_SETTING_VERDICTS,
  CAMPAIGN_SETTINGS_UNAVAILABLE,
  buildCampaignSettings,
  describeCampaignDifficulty,
  parseCampaignSettingFlag,
  parseCampaignSettingNumber
} = require('../shared/campaignSettings.mjs');

const saveParser = require('../server/saveParser');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');

// The block exactly as TIMetadataState carries it on the live campaign,
// transcribed from the raw save on 2026-08-21.
const LIVE_BLOCK = Object.freeze({
  difficulty: 'Normal',
  customDifficulty: true,
  researchSpeedMultiplier: '200%',
  miningProductivityMultiplier: '200%',
  nationalIPMultiplier: '200%',
  alienProgressionSpeed: '200%',
  controlPointMaintenanceFreebieBonus: '150',
  controlPointMaintenanceFreebieBonusAI: '0',
  missionControlBonus: '0',
  missionControlBonusAI: '0',
  averageMonthlyEvents: '5'
});

// ---------------------------------------------------------------------------
// The parse trap. `Number('200%')` is NaN, and `NaN ?? 0` / `NaN || 0` is 0.
// ---------------------------------------------------------------------------

test('the raw JS coercion this parser exists to avoid really does produce NaN', () => {
  // Pinned so nobody "simplifies" the parser back to Number(x) || 0.
  assert.ok(Number.isNaN(Number('200%')));
  assert.strictEqual(Number('200%') || 0, 0);
  assert.strictEqual(Number(null), 0);
  assert.strictEqual(Number(''), 0);
});

test('a percent string parses to its numeral, never to zero', () => {
  assert.strictEqual(parseCampaignSettingNumber('200%'), 200);
  assert.strictEqual(parseCampaignSettingNumber('100%'), 100);
  assert.strictEqual(parseCampaignSettingNumber('50%'), 50);
  assert.strictEqual(parseCampaignSettingNumber(' 200 % '), 200);
});

test('a bare numeral parses unchanged, including a genuine zero', () => {
  assert.strictEqual(parseCampaignSettingNumber('150'), 150);
  // '0' is a MEASURED zero and must survive as 0, which is why "never zero"
  // is a rule about unparseable input, not about the number itself.
  assert.strictEqual(parseCampaignSettingNumber('0'), 0);
  assert.strictEqual(parseCampaignSettingNumber('5'), 5);
  assert.strictEqual(parseCampaignSettingNumber('12.5'), 12.5);
  assert.strictEqual(parseCampaignSettingNumber('-3'), -3);
  assert.strictEqual(parseCampaignSettingNumber('1,200'), 1200);
  assert.strictEqual(parseCampaignSettingNumber(42), 42);
});

test('an unparseable setting is null -- never 0, never a silent 1', () => {
  for (const raw of ['', '   ', '%', 'abc', 'e5', '200%%', '1.2.3', null, undefined, NaN, Infinity, true, false, {}, []]) {
    const parsed = parseCampaignSettingNumber(raw);
    assert.strictEqual(parsed, null, `expected null for ${JSON.stringify(raw)}, got ${parsed}`);
    assert.notStrictEqual(parsed, 0);
    assert.notStrictEqual(parsed, 1);
  }
});

test('the customDifficulty flag is tri-state: true, false, or unknown', () => {
  assert.strictEqual(parseCampaignSettingFlag(true), true);
  assert.strictEqual(parseCampaignSettingFlag(false), false);
  assert.strictEqual(parseCampaignSettingFlag('true'), true);
  assert.strictEqual(parseCampaignSettingFlag('False'), false);
  // Unknown must not collapse into `false`: only a campaign KNOWN to be stock
  // may render without a marker.
  assert.strictEqual(parseCampaignSettingFlag(undefined), null);
  assert.strictEqual(parseCampaignSettingFlag(null), null);
  assert.strictEqual(parseCampaignSettingFlag('yes'), null);
  assert.strictEqual(parseCampaignSettingFlag(1), null);
});

// ---------------------------------------------------------------------------
// The block: all ten fields, parsed.
// ---------------------------------------------------------------------------

test('the field table names all ten settings from the save', () => {
  assert.strictEqual(CAMPAIGN_SETTING_FIELDS.length, 10);
  assert.strictEqual(CAMPAIGN_SETTING_NUMERIC_FIELDS.length, 9);
  assert.deepStrictEqual(CAMPAIGN_SETTING_FIELDS.map(f => f.key), [
    'customDifficulty',
    'researchSpeedMultiplier',
    'miningProductivityMultiplier',
    'nationalIPMultiplier',
    'alienProgressionSpeed',
    'controlPointMaintenanceFreebieBonus',
    'controlPointMaintenanceFreebieBonusAI',
    'missionControlBonus',
    'missionControlBonusAI',
    'averageMonthlyEvents'
  ]);
});

test('the live block parses every setting to the number the save states', () => {
  const built = buildCampaignSettings(LIVE_BLOCK);

  assert.strictEqual(built.available, true);
  assert.strictEqual(built.customDifficulty, true);
  assert.deepStrictEqual(built.unreadable, []);

  const values = Object.fromEntries(
    Object.entries(built.settings).map(([key, entry]) => [key, entry.value])
  );
  assert.deepStrictEqual(values, {
    researchSpeedMultiplier: 200,
    miningProductivityMultiplier: 200,
    nationalIPMultiplier: 200,
    alienProgressionSpeed: 200,
    controlPointMaintenanceFreebieBonus: 150,
    controlPointMaintenanceFreebieBonusAI: 0,
    missionControlBonus: 0,
    missionControlBonusAI: 0,
    averageMonthlyEvents: 5
  });

  // Not one of the four 200% settings may read as zero.
  for (const key of ['researchSpeedMultiplier', 'miningProductivityMultiplier', 'nationalIPMultiplier', 'alienProgressionSpeed']) {
    assert.strictEqual(built.settings[key].value, 200);
    assert.notStrictEqual(built.settings[key].value, 0);
    assert.strictEqual(built.settings[key].multiplier, 2);
    assert.strictEqual(built.settings[key].isStock, false);
  }
});

test('stock-ness is three-valued, and a setting with no stock value says so', () => {
  const built = buildCampaignSettings(LIVE_BLOCK);
  assert.strictEqual(built.settings.missionControlBonus.isStock, true);
  assert.strictEqual(built.settings.controlPointMaintenanceFreebieBonus.isStock, false);
  // averageMonthlyEvents is a rate with no identity value. Claiming it stock
  // would be the "unknown falls through to safe" defect.
  assert.strictEqual(built.settings.averageMonthlyEvents.isStock, null);
  assert.deepStrictEqual(built.undetermined.map(e => e.key), ['averageMonthlyEvents']);
});

test('an unreadable setting is recorded with a reason, not defaulted', () => {
  const built = buildCampaignSettings({
    customDifficulty: true,
    researchSpeedMultiplier: 'twice as fast',
    miningProductivityMultiplier: '200%'
  });

  assert.strictEqual(built.settings.researchSpeedMultiplier.value, null);
  assert.strictEqual(built.settings.researchSpeedMultiplier.available, false);
  assert.strictEqual(built.settings.researchSpeedMultiplier.isStock, null);
  assert.strictEqual(built.settings.researchSpeedMultiplier.display, 'unavailable');

  const reasons = Object.fromEntries(built.unreadable.map(e => [e.key, e.reason]));
  assert.strictEqual(reasons.researchSpeedMultiplier, 'not a readable numeral');
  assert.strictEqual(reasons.nationalIPMultiplier, 'absent from the save metadata');
});

test('a metadata state with none of the fields reports unavailable, not stock', () => {
  const built = buildCampaignSettings({ gameTimeString: '1/1/2030 12:00:00 AM', difficulty: 'Normal' });
  assert.strictEqual(built, CAMPAIGN_SETTINGS_UNAVAILABLE);
  assert.strictEqual(built.available, false);
  assert.strictEqual(built.customDifficulty, null);
  assert.strictEqual(buildCampaignSettings(null).available, false);
});

// ---------------------------------------------------------------------------
// The label: a customised campaign never renders as plain "Normal".
// ---------------------------------------------------------------------------

test('a customised campaign never renders as the bare difficulty name', () => {
  const label = describeCampaignDifficulty('Normal', buildCampaignSettings(LIVE_BLOCK));
  assert.notStrictEqual(label, 'Normal');
  assert.match(label, /^Normal \(custom:/);
  assert.match(label, /research speed 200%/);
  assert.match(label, /mining productivity 200%/);
  assert.match(label, /national IP 200%/);
  assert.match(label, /alien progression 200%/);
  assert.match(label, /CP maintenance freebie \+150/);
});

test('a custom campaign whose settings are all unreadable is still marked custom', () => {
  const label = describeCampaignDifficulty('Normal', buildCampaignSettings({
    customDifficulty: true,
    researchSpeedMultiplier: 'unknown'
  }));
  assert.notStrictEqual(label, 'Normal');
  assert.strictEqual(label, 'Normal (custom: settings unavailable)');
});

test('a stock campaign renders exactly the difficulty the save states', () => {
  const stock = buildCampaignSettings({
    customDifficulty: false,
    researchSpeedMultiplier: '100%',
    miningProductivityMultiplier: '100%'
  });
  assert.strictEqual(describeCampaignDifficulty('Veteran', stock), 'Veteran');
  assert.deepStrictEqual(stock.nonStock, []);
});

test('with the settings absent the label is unchanged from the bare difficulty', () => {
  assert.strictEqual(describeCampaignDifficulty('Brutal', null), 'Brutal');
  assert.strictEqual(describeCampaignDifficulty('Brutal', undefined), 'Brutal');
  assert.strictEqual(describeCampaignDifficulty('Brutal', CAMPAIGN_SETTINGS_UNAVAILABLE), 'Brutal');
  // An unstated difficulty stays null rather than becoming an invented 'Normal'.
  assert.strictEqual(describeCampaignDifficulty(null, CAMPAIGN_SETTINGS_UNAVAILABLE), null);
  assert.strictEqual(describeCampaignDifficulty('   ', CAMPAIGN_SETTINGS_UNAVAILABLE), null);
});

test('a custom campaign that states no difficulty still says it is custom', () => {
  const label = describeCampaignDifficulty(null, buildCampaignSettings(LIVE_BLOCK));
  assert.match(label, /^Unknown difficulty \(custom:/);
});

// ---------------------------------------------------------------------------
// Baking: parser -> raw snapshot -> both modes.
// ---------------------------------------------------------------------------

function writeSave(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-campaign-'));
  const file = path.join(dir, 'campaign.json');
  fs.writeFileSync(file, JSON.stringify(contents));
  return { dir, file };
}

test('the save parser bakes the block off TIMetadataState', () => {
  const { dir, file } = writeSave({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2035 12:00:00 AM', ...LIVE_BLOCK } }
      ]
    }
  });

  try {
    const parsed = saveParser.readSaveJson(file);
    // The raw difficulty word is untouched: the alien-hate model keys off it.
    assert.strictEqual(parsed.difficulty, 'Normal');
    assert.strictEqual(parsed.campaignSettings.customDifficulty, true);
    assert.strictEqual(parsed.campaignSettings.settings.researchSpeedMultiplier.value, 200);
    assert.strictEqual(parsed.campaignSettings.settings.averageMonthlyEvents.value, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a save with no custom-difficulty fields parses to the unavailable block', () => {
  const { dir, file } = writeSave({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2030 12:00:00 AM', difficulty: 'Brutal' } }
      ]
    }
  });

  try {
    const parsed = saveParser.readSaveJson(file);
    assert.strictEqual(parsed.difficulty, 'Brutal');
    assert.strictEqual(parsed.campaignSettings.available, false);
    assert.strictEqual(parsed.campaignSettings.customDifficulty, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the raw snapshot carries the block, the label, and the untouched difficulty', () => {
  const save = makeSaveData();
  save.campaignSettings = buildCampaignSettings(LIVE_BLOCK);

  const raw = snapshotBuilder.buildRawSnapshot(save);
  assert.strictEqual(raw.metadata.difficulty, 'Veteran');
  assert.strictEqual(raw.metadata.difficultyIsCustom, true);
  assert.match(raw.metadata.difficultyLabel, /^Veteran \(custom: research speed 200%/);
  assert.strictEqual(raw.metadata.campaignSettings.settings.nationalIPMultiplier.value, 200);
});

test('a raw snapshot built from a saveData with no settings behaves as before', () => {
  const save = makeSaveData();
  assert.strictEqual(save.campaignSettings, undefined);

  const raw = snapshotBuilder.buildRawSnapshot(save);
  assert.strictEqual(raw.metadata.difficulty, 'Veteran');
  // Unchanged behaviour: the label is the bare difficulty and nothing claims
  // the campaign is either custom or stock.
  assert.strictEqual(raw.metadata.difficultyLabel, 'Veteran');
  assert.strictEqual(raw.metadata.difficultyIsCustom, null);
  assert.strictEqual(raw.metadata.campaignSettings.available, false);
});

test('both intelligence modes carry the settings -- they are campaign facts, not faction intel', () => {
  const save = makeSaveData();
  save.campaignSettings = buildCampaignSettings(LIVE_BLOCK);
  const raw = snapshotBuilder.buildRawSnapshot(save);

  for (const mode of ['player', 'enhanced', 'omniscient']) {
    const filteredSnapshot = intelligenceFilter.applyFilter(raw, mode, 4712);
    assert.strictEqual(
      filteredSnapshot.metadata.campaignSettings.settings.miningProductivityMultiplier.value,
      200,
      `${mode} mode lost the mining multiplier`
    );
    assert.strictEqual(filteredSnapshot.metadata.difficultyIsCustom, true, `${mode} mode lost the custom flag`);
    assert.notStrictEqual(filteredSnapshot.metadata.difficultyLabel, 'Veteran', `${mode} mode renders a custom campaign as stock`);
  }
});

// ---------------------------------------------------------------------------
// The recorded verdicts. These exist so a future reader does not "fix" a figure
// that measurement already cleared.
// ---------------------------------------------------------------------------

test('every multiplier the save carries has a recorded verdict', () => {
  for (const key of ['researchSpeedMultiplier', 'miningProductivityMultiplier', 'nationalIPMultiplier', 'alienProgressionSpeed', 'controlPointMaintenanceFreebieBonus', 'averageMonthlyEvents']) {
    const verdict = CAMPAIGN_SETTING_VERDICTS[key];
    assert.ok(verdict, `no recorded verdict for ${key}`);
    // `WRONG, corrected` is a legitimate verdict and the third one this table
    // can hold. It was added on 2026-08-22 when the research verdict was
    // overturned; a table that could only say "checked" or "not applicable"
    // would have had to either lie or drop the entry.
    assert.match(verdict.verdict, /checked -- unaffected|not applicable|WRONG, corrected/);
    assert.ok(verdict.evidence && verdict.evidence.length > 40, `${key} verdict carries no evidence`);
    // The original measurement date must stay readable. A verdict whose
    // EVIDENCE was later replaced says so after it, rather than losing the date
    // it was first established on.
    assert.match(verdict.measuredOn, /^2026-08-21(; .+)?$/, `${key} lost its measurement date`);
  }
});

test('the OVERTURNED research verdict keeps the wrong reasoning, marked, and names why it was wrong', () => {
  // Two rounds of correction are recorded on this one entry and both must stay
  // legible. 2026-08-21 cleared it; 2026-08-22 (tracker 3b) replaced the
  // EVIDENCE while keeping the verdict; 2026-08-22 (this change) overturned the
  // VERDICT. A reader who finds only the current text cannot tell that the old
  // argument was examined -- and the way it went wrong is the reusable part.
  const research = CAMPAIGN_SETTING_VERDICTS.researchSpeedMultiplier;
  assert.match(research.verdict, /^WRONG, corrected 2026-08-22/, 'the verdict itself was overturned');
  assert.match(research.appliesTo, /cost/, 'and it acts on cost, not on output');
  assert.ok(research.correctedBy, 'with a pointer to where the correction lives');

  // The evidence now covers BOTH sides, because the income half still stands
  // and a reader who drops it applies the multiplier twice.
  assert.match(research.evidence, /4,708\.568/, 'the tracked completion on the cost side');
  assert.match(research.evidence, /0\.49716/, 'the ceiling across 278 rows');
  assert.match(research.evidence, /2\.1115x/, 'and the income measurement, which still stands');

  // The wrong evidence, kept and explained.
  assert.ok(research.evidenceThatWasWrong, 'the overturned argument must be kept and marked');
  assert.match(research.evidenceThatWasWrong, /Fleet Logistics/);
  assert.match(research.evidenceThatWasWrong, /First\.gz/,
    'and must name the save it came from, which carries no multiplier at all');

  // Why the income measurement could not have caught it. Without this a future
  // reader repeats the same non-discriminating test and concludes the same way.
  assert.ok(research.whyTheIncomeMeasurementCouldNotCatchIt);
  assert.match(research.whyTheIncomeMeasurementCouldNotCatchIt, /identical 2\.1115x/);

  // The tracker-3b round is still recorded too.
  assert.ok(research.evidenceSuperseded, 'the earlier withdrawn argument must survive as well');
  assert.match(research.evidenceSuperseded, /1\.147x/);
  assert.match(research.evidenceSuperseded, /WITHDRAWN/);
  assert.match(research.evidenceSuperseded, /-0\.209/, 'and must name the fitted parameter that made it circular');
});

test('the verdicts are also written beside the models they clear', () => {
  const root = path.join(__dirname, '..');
  const sites = [
    ['shared/researchSlots.mjs', /DO NOT APPLY `researchSpeedMultiplier`/],
    ['shared/intel/common.mjs', /DO NOT APPLY `miningProductivityMultiplier` HERE/],
    ['server/engine/adviseEconomics.js', /DO NOT APPLY `nationalIPMultiplier` HERE/],
    ['shared/alienHateEconomics.mjs', /ON `alienProgressionSpeed`/]
  ];
  for (const [file, pattern] of sites) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, pattern, `${file} lost its recorded verdict`);
  }
});
