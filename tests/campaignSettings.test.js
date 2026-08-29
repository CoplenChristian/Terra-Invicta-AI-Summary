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
  SCENARIO_CUSTOMIZATIONS_UNAVAILABLE,
  buildCampaignSettings,
  buildScenarioCustomizations,
  SCENARIO_CUSTOMIZATION_FIELDS,
  SCENARIO_CUSTOMIZATION_NUMERIC_FIELDS,
  SCENARIO_CUSTOMIZATION_BOOLEAN_FIELDS,
  deriveArmourMultipliers,
  parseScenarioCustomizationNumber,
  parseScenarioCustomizationBoolean,
  parseScenarioCustomizationValue,
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

// The block exactly as TIGlobalValuesState.scenarioCustomizations carries it on
// the live campaign, transcribed from the raw save in 2026-08-29. Bare numbers
// (NOT the "200%" strings the metadata block uses) and booleans -- the parse
// for this block is deliberately stricter than parseCampaignSettingNumber.
const LIVE_SCENARIO_BLOCK = Object.freeze({
  cinematicCombatRealismScale: true,
  cinematicCombatRealismDV: true,
  habConstructionSpeedPlayer: 2.0,
  habConstructionSpeedHumanAI: 2.0,
  habConstructionSpeedAlien: 2.0,
  shipConstructionSpeedPlayer: 2.0,
  shipConstructionSpeedHumanAI: 2.0,
  shipConstructionSpeedAlien: 2.0,
  miningRatePlayer: 1.0,
  miningRateHumanAI: 1.0,
  miningRateAlien: 1.0,
  variableProjectUnlocks: true,
  showTriggeredProjects: false,
  addAlienAssaultCarrierFleet: false,
  otherFactionStartingNations: false,
  usePlayerCountryForStartingCouncilor: true,
  canDisableFactions: true,
  randomizeMap: false,
  randomizedMapSeed: 0
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

// ---------------------------------------------------------------------------
// The scenarioCustomizations block -- nineteen settings read off a different
// state class than the metadata block. Bare numbers (NOT percent strings)
// and booleans, parsed by stricter readers than the metadata block uses.
// armourMultipliers is the derivation that depends on this block.
// ---------------------------------------------------------------------------

test('the scenario field table names all nineteen settings on the live save', () => {
  assert.strictEqual(SCENARIO_CUSTOMIZATION_FIELDS.length, 19);
  // Numeric + boolean partition covers everything.
  assert.strictEqual(
    SCENARIO_CUSTOMIZATION_NUMERIC_FIELDS.length + SCENARIO_CUSTOMIZATION_BOOLEAN_FIELDS.length,
    19
  );
  assert.deepStrictEqual(SCENARIO_CUSTOMIZATION_FIELDS.map(f => f.key), [
    'cinematicCombatRealismScale',
    'cinematicCombatRealismDV',
    'habConstructionSpeedPlayer',
    'habConstructionSpeedHumanAI',
    'habConstructionSpeedAlien',
    'shipConstructionSpeedPlayer',
    'shipConstructionSpeedHumanAI',
    'shipConstructionSpeedAlien',
    'miningRatePlayer',
    'miningRateHumanAI',
    'miningRateAlien',
    'variableProjectUnlocks',
    'showTriggeredProjects',
    'addAlienAssaultCarrierFleet',
    'otherFactionStartingNations',
    'usePlayerCountryForStartingCouncilor',
    'canDisableFactions',
    'randomizeMap',
    'randomizedMapSeed'
  ]);
});

test('the scenario number parser accepts only finite JS numbers', () => {
  for (const v of [2.0, 0, -1, 1.5, 100]) {
    assert.strictEqual(parseScenarioCustomizationNumber(v), v);
  }
  // The wrong shapes a lenient Number(x) would silently accept -- each one
  // would corrupt the reading if it slipped through.
  for (const v of ['2.0', '200%', null, undefined, NaN, Infinity, -Infinity, true, false, [], {}, () => {}]) {
    assert.strictEqual(parseScenarioCustomizationNumber(v), null,
      'scenario number parser let ${JSON.stringify(v)} through');
  }
  // A boolean MUST NOT coerce to a number: `miningRatePlayer = true` and
  // `miningRatePlayer = 1` are different values, and the parse has to keep
  // them different so Cinematic/Realistic/Unknown do not collapse.
  assert.strictEqual(parseScenarioCustomizationNumber(true), null);
  assert.strictEqual(parseScenarioCustomizationNumber(false), null);
});

test('the scenario boolean parser is tri-state, not boolean', () => {
  assert.strictEqual(parseScenarioCustomizationBoolean(true), true);
  assert.strictEqual(parseScenarioCustomizationBoolean(false), false);
  assert.strictEqual(parseScenarioCustomizationBoolean('true'), true);
  assert.strictEqual(parseScenarioCustomizationBoolean('False'), false);
  // An absent or wrong-shape value MUST be null, not false -- unknown is not
  // the same as stock. `Number(false) === 0` would have collapsed a mode
  // flag into a confident off.
  for (const v of [undefined, null, 'yes', 1, 0, [], {}]) {
    assert.strictEqual(parseScenarioCustomizationBoolean(v), null);
  }
});

test('parseScenarioCustomizationValue dispatches by kind, not by call site', () => {
  const flagField = SCENARIO_CUSTOMIZATION_FIELDS.find(f => f.kind === 'flag');
  const modeField = SCENARIO_CUSTOMIZATION_FIELDS.find(f => f.kind === 'mode');
  const speedField = SCENARIO_CUSTOMIZATION_FIELDS.find(f => f.kind === 'speed-multiplier');
  const intField = SCENARIO_CUSTOMIZATION_FIELDS.find(f => f.kind === 'integer');

  // Booleans to booleans.
  assert.strictEqual(parseScenarioCustomizationValue(flagField, true), true);
  assert.strictEqual(parseScenarioCustomizationValue(modeField, false), false);
  // Numbers to numbers, never to "200%" strings -- the scenario block is bare
  // numbers only.
  assert.strictEqual(parseScenarioCustomizationValue(speedField, 2.0), 2.0);
  assert.strictEqual(parseScenarioCustomizationValue(speedField, '2.0'), null);
  assert.strictEqual(parseScenarioCustomizationValue(speedField, '200%'), null);
  assert.strictEqual(parseScenarioCustomizationValue(intField, 0), 0);
  assert.strictEqual(parseScenarioCustomizationValue(intField, '0'), null);
});

test('the live scenario block reads every one of the nineteen settings', () => {
  const built = buildScenarioCustomizations(LIVE_SCENARIO_BLOCK);

  assert.strictEqual(built.available, true);
  assert.strictEqual(built.source, 'TIGlobalValuesState.scenarioCustomizations');
  assert.deepStrictEqual(built.unreadable, []);

  // The values the save carries -- exactly what was measured.
  assert.strictEqual(built.settings.cinematicCombatRealismScale.value, true);
  assert.strictEqual(built.settings.cinematicCombatRealismDV.value, true);
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.value, 2.0);
  assert.strictEqual(built.settings.habConstructionSpeedHumanAI.value, 2.0);
  assert.strictEqual(built.settings.habConstructionSpeedAlien.value, 2.0);
  assert.strictEqual(built.settings.shipConstructionSpeedPlayer.value, 2.0);
  assert.strictEqual(built.settings.shipConstructionSpeedHumanAI.value, 2.0);
  assert.strictEqual(built.settings.shipConstructionSpeedAlien.value, 2.0);
  assert.strictEqual(built.settings.miningRatePlayer.value, 1.0);
  assert.strictEqual(built.settings.miningRateHumanAI.value, 1.0);
  assert.strictEqual(built.settings.miningRateAlien.value, 1.0);
  assert.strictEqual(built.settings.variableProjectUnlocks.value, true);
  assert.strictEqual(built.settings.showTriggeredProjects.value, false);
  assert.strictEqual(built.settings.addAlienAssaultCarrierFleet.value, false);
  assert.strictEqual(built.settings.otherFactionStartingNations.value, false);
  assert.strictEqual(built.settings.usePlayerCountryForStartingCouncilor.value, true);
  assert.strictEqual(built.settings.canDisableFactions.value, true);
  assert.strictEqual(built.settings.randomizeMap.value, false);
  assert.strictEqual(built.settings.randomizedMapSeed.value, 0);
});

test('scenario speed multipliers carry their value as the multiplier', () => {
  // The game divides build time by the speed; the dashboard wants the speed
  // as a multiplier so consumers do not have to invert it themselves.
  const built = buildScenarioCustomizations(LIVE_SCENARIO_BLOCK);
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.multiplier, 2.0);
  assert.strictEqual(built.settings.shipConstructionSpeedPlayer.multiplier, 2.0);
  assert.strictEqual(built.settings.miningRatePlayer.multiplier, 1.0);
  // Booleans do NOT carry a multiplier -- the armour scaling is DERIVED
  // from `cinematicCombatRealismScale`, not a multiplier of the flag itself.
  assert.strictEqual(built.settings.cinematicCombatRealismScale.multiplier, null);
  assert.strictEqual(built.settings.variableProjectUnlocks.multiplier, null);
});

test('scenario isStock uses 1.0 as the identity for speed multipliers', () => {
  const built = buildScenarioCustomizations(LIVE_SCENARIO_BLOCK);
  // 2.0 is not 1.0 -- non-stock.
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.isStock, false);
  assert.strictEqual(built.settings.shipConstructionSpeedPlayer.isStock, false);
  // 1.0 IS 1.0 -- stock.
  assert.strictEqual(built.settings.miningRatePlayer.isStock, true);
  assert.strictEqual(built.settings.miningRateHumanAI.isStock, true);
  // Booleans with stockValue null say "cannot tell", which is the only
  // honest answer -- a mode flag has no identity value to compare against.
  assert.strictEqual(built.settings.cinematicCombatRealismScale.isStock, null);
  assert.strictEqual(built.settings.randomizeMap.isStock, null);
});

test('an absent scenario block is reported as unavailable, with reasons for absent fields', () => {
  const built = buildScenarioCustomizations({});
  assert.strictEqual(built.available, false);
  assert.strictEqual(built.source, null);
  // The merged settings still carries all 19 keys (with value null and a
  // path-naming reason), so a consumer can ask for settings.<key>.value
  // and get the honest "we looked and could not read it" answer.
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.value, null);
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.available, false);
  assert.strictEqual(built.unreadable.length, 19);
});

test('a partial scenario block reads what is present and names what is missing', () => {
  const built = buildScenarioCustomizations({
    habConstructionSpeedPlayer: 2.0,
    cinematicCombatRealismScale: true
  });
  assert.strictEqual(built.available, true);
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.value, 2.0);
  assert.strictEqual(built.settings.cinematicCombatRealismScale.value, true);
  assert.strictEqual(built.unreadable.length, 17);
  // Every unreadable entry names the path it looked in so a consumer can
  // tell where to inspect the save.
  for (const entry of built.unreadable) {
    assert.strictEqual(entry.reason, 'absent from TIGlobalValuesState.scenarioCustomizations',
      `${entry.key} did not name its source path`);
  }
});

test('a wrong-shape scenario value is recorded with a kind-specific reason', () => {
  // `2.0` typed as a string is the wrong shape -- the save carries bare
  // numbers, not "200%". A confident read here would be a silent corruption.
  const built = buildScenarioCustomizations({
    habConstructionSpeedPlayer: '2.0',
    cinematicCombatRealismScale: 'true'
  });
  // Booleans-as-strings ARE accepted (the parser handles 'true'/'false'),
  // so cinematicCombatRealismScale reads correctly.
  assert.strictEqual(built.settings.cinematicCombatRealismScale.value, true);
  assert.strictEqual(built.settings.cinematicCombatRealismScale.available, true);
  // But the speed-multiplier-as-string is refused, with a kind-specific reason.
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.value, null);
  assert.strictEqual(built.settings.habConstructionSpeedPlayer.available, false);
  const reasons = Object.fromEntries(built.unreadable.map(e => [e.key, e.reason]));
  assert.match(reasons.habConstructionSpeedPlayer, /^not a readable speed-multiplier value$/);
});

test('a boolean where the save has `null` stays null, never collapses to false', () => {
  // The exact regression the scenario parser exists to catch: a mode flag read
  // as null MUST NOT fall through to false, because Cinematic/Realistic/Unknown
  // would then all look the same and armourMultipliers would collapse to one.
  const built = buildScenarioCustomizations({
    cinematicCombatRealismScale: null,
    habConstructionSpeedPlayer: 2.0
  });
  assert.strictEqual(built.settings.cinematicCombatRealismScale.value, null);
  assert.strictEqual(built.settings.cinematicCombatRealismScale.available, false);
  assert.strictEqual(built.settings.cinematicCombatRealismScale.display, 'unavailable');
  // armourMultipliers reports unavailable, naming the flag it would have read.
  assert.strictEqual(built.armourMultipliers.available, false);
  assert.strictEqual(built.armourMultipliers.reason, 'cinematicCombatRealismScale not read');
});

// ---------------------------------------------------------------------------
// armourMultipliers -- the derivation the ship designer depends on. A wrong
// value here is a 3x error on the heaviest part of a ship.
// ---------------------------------------------------------------------------

test('deriveArmourMultipliers: Cinematic reads true -> nose/tail x1, side x0.75', () => {
  const m = deriveArmourMultipliers(true);
  assert.strictEqual(m.available, true);
  assert.strictEqual(m.mode, 'Cinematic');
  assert.strictEqual(m.nose, 1);
  assert.strictEqual(m.tail, 1);
  assert.strictEqual(m.side, 0.75);
  assert.strictEqual(m.source, 'cinematicCombatRealismScale');
});

test('deriveArmourMultipliers: Realistic reads false -> nose/tail x3, side x0.5', () => {
  const m = deriveArmourMultipliers(false);
  assert.strictEqual(m.available, true);
  assert.strictEqual(m.mode, 'Realistic');
  assert.strictEqual(m.nose, 3);
  assert.strictEqual(m.tail, 3);
  assert.strictEqual(m.side, 0.5);
});

test('deriveArmourMultipliers: unreadable stays unavailable with a path-naming reason', () => {
  const m = deriveArmourMultipliers(null);
  assert.strictEqual(m.available, false);
  assert.strictEqual(m.source, 'cinematicCombatRealismScale');
  // The brief pinned this exact reason string; consumers may depend on it.
  assert.strictEqual(m.reason, 'cinematicCombatRealismScale not read');
  // No multipliers when the source was unreadable -- a confident 1.0 here
  // would let a ship designer paper over an unmeasured save.
  assert.strictEqual(m.nose, undefined);
  assert.strictEqual(m.tail, undefined);
  assert.strictEqual(m.side, undefined);
});

test('armourMultipliers resolves to Cinematic on the live save', () => {
  // The live save carries `cinematicCombatRealismScale: true` -- a 3x
  // error on the heaviest part of a ship if this resolves wrong.
  const built = buildScenarioCustomizations(LIVE_SCENARIO_BLOCK);
  assert.strictEqual(built.armourMultipliers.available, true);
  assert.strictEqual(built.armourMultipliers.mode, 'Cinematic');
  assert.strictEqual(built.armourMultipliers.nose, 1);
  assert.strictEqual(built.armourMultipliers.tail, 1);
  assert.strictEqual(built.armourMultipliers.side, 0.75);
});

test('armourMultipliers flips to Realistic when the flag flips', () => {
  const built = buildScenarioCustomizations({
    cinematicCombatRealismScale: false
  });
  assert.strictEqual(built.armourMultipliers.available, true);
  assert.strictEqual(built.armourMultipliers.mode, 'Realistic');
  assert.strictEqual(built.armourMultipliers.nose, 3);
  assert.strictEqual(built.armourMultipliers.side, 0.5);
});

// ---------------------------------------------------------------------------
// Wiring -- the save parser reads BOTH blocks and merges them; the existing
// nine custom-difficulty values stay byte-identical.
// ---------------------------------------------------------------------------

test('the save parser reads scenarioCustomizations off TIGlobalValuesState', () => {
  const { dir, file } = writeSave({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2035 12:00:00 AM', ...LIVE_BLOCK } }
      ],
      'PavonisInteractive.TerraInvicta.TIGlobalValuesState': [
        { Value: { scenarioCustomizations: { ...LIVE_SCENARIO_BLOCK } } }
      ]
    }
  });

  try {
    const parsed = saveParser.readSaveJson(file);
    // Existing nine, byte-identical to before this change.
    assert.strictEqual(parsed.campaignSettings.settings.researchSpeedMultiplier.value, 200);
    assert.strictEqual(parsed.campaignSettings.settings.miningProductivityMultiplier.value, 200);
    assert.strictEqual(parsed.campaignSettings.settings.averageMonthlyEvents.value, 5);
    // The new nineteen.
    assert.strictEqual(parsed.campaignSettings.settings.habConstructionSpeedPlayer.value, 2.0);
    assert.strictEqual(parsed.campaignSettings.settings.cinematicCombatRealismScale.value, true);
    // armourMultipliers is on the merged block.
    assert.strictEqual(parsed.campaignSettings.armourMultipliers.mode, 'Cinematic');
    // shipConstructionSpeed is added at the raw-snapshot stage, not by the
    // parser -- the existing consumer (shared/shipBuildTime.mjs) reads it
    // off the snapshot's campaignSettings, not off the parsed save. The
    // raw snapshot is exercised separately below.
    assert.strictEqual(parsed.campaignSettings.shipConstructionSpeed, undefined);
    // The scenario sub-block is exposed so consumers that want the new shape
    // alone can read it without walking the merged `settings`.
    assert.strictEqual(parsed.campaignSettings.scenarioCustomizations.available, true);
    assert.strictEqual(parsed.campaignSettings.scenarioCustomizations.source,
      'TIGlobalValuesState.scenarioCustomizations');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a save with no scenarioCustomizations reports each new field as absent with a path-naming reason', () => {
  const { dir, file } = writeSave({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2035 12:00:00 AM', ...LIVE_BLOCK } }
      ]
    }
  });

  try {
    const parsed = saveParser.readSaveJson(file);
    // Existing nine are still byte-identical.
    assert.strictEqual(parsed.campaignSettings.settings.researchSpeedMultiplier.value, 200);
    // The new nineteen are absent: the scenario sub-block reports them
    // with a path-naming reason, and the merged settings does not invent keys
    // for fields the save never carried.
    const scenarioSettings = parsed.campaignSettings.scenarioCustomizations.settings;
    assert.strictEqual(scenarioSettings.habConstructionSpeedPlayer.value, null);
    assert.strictEqual(scenarioSettings.habConstructionSpeedPlayer.available, false);
    assert.strictEqual(scenarioSettings.cinematicCombatRealismScale.value, null);
    // armourMultipliers refuses with the pinned reason string.
    assert.strictEqual(parsed.campaignSettings.armourMultipliers.available, false);
    assert.strictEqual(parsed.campaignSettings.armourMultipliers.reason,
      'cinematicCombatRealismScale not read');
    // Scenario sub-block is the unavailable shape but still carries all 19
    // settings as null entries with a path-naming reason.
    assert.strictEqual(parsed.campaignSettings.scenarioCustomizations.available, false);
    assert.strictEqual(parsed.campaignSettings.scenarioCustomizations.source, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the raw snapshot adds shipConstructionSpeed at the top level from the merged block', () => {
  const { dir, file } = writeSave({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2035 12:00:00 AM', ...LIVE_BLOCK } }
      ],
      'PavonisInteractive.TerraInvicta.TIGlobalValuesState': [
        { Value: { scenarioCustomizations: { ...LIVE_SCENARIO_BLOCK } } }
      ]
    }
  });

  try {
    const parsed = saveParser.readSaveJson(file);
    const raw = snapshotBuilder.buildRawSnapshot(parsed);
    // The ship-build-time consumer expects this exact shape at the top level.
    assert.deepStrictEqual(raw.campaignSettings.shipConstructionSpeed, {
      Player: 2.0, HumanAI: 2.0, Alien: 2.0
    });
    assert.deepStrictEqual(raw.metadata.campaignSettings.shipConstructionSpeed, {
      Player: 2.0, HumanAI: 2.0, Alien: 2.0
    });
    // armourMultipliers and the scenario block are on the snapshot too.
    assert.strictEqual(raw.campaignSettings.armourMultipliers.mode, 'Cinematic');
    assert.strictEqual(raw.metadata.campaignSettings.scenarioCustomizations.available, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the raw snapshot carries the scenario block and armourMultipliers unchanged through intelligence modes', () => {
  const save = makeSaveData();
  save.campaignSettings = buildScenarioCustomizations(LIVE_SCENARIO_BLOCK);
  // Inject the metadata-derived settings too, so the merged block has both.
  save.campaignSettings = Object.assign(
    {},
    buildCampaignSettings(LIVE_BLOCK),
    save.campaignSettings,
    { settings: { ...buildCampaignSettings(LIVE_BLOCK).settings, ...save.campaignSettings.settings } }
  );
  const raw = snapshotBuilder.buildRawSnapshot(save);
  for (const mode of ['player', 'enhanced', 'omniscient']) {
    const filtered = intelligenceFilter.applyFilter(raw, mode, 4712);
    assert.strictEqual(filtered.metadata.campaignSettings.settings.habConstructionSpeedPlayer.value, 2.0,
      `${mode} mode lost the hab construction speed`);
    assert.strictEqual(filtered.metadata.campaignSettings.settings.cinematicCombatRealismScale.value, true,
      `${mode} mode lost the cinematic realism flag`);
    assert.strictEqual(filtered.metadata.campaignSettings.armourMultipliers.mode, 'Cinematic',
      `${mode} mode lost the armour multipliers`);
  }
});

