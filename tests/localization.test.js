// tests/localization.test.js
//
// Defect register #10: the dashboard rendered the template's internal
// `friendlyName` where the game shows a localised display name.
//
// EVERY EXPECTED VALUE BELOW WAS READ FROM THE INSTALLED LOCALISATION FILE
// BEFORE THE FIX, not captured from this code's output. A fixture derived from
// post-change output passes by construction and proves nothing.
//
//   StreamingAssets/Localization/en/TIDriveTemplate.en:405
//     TIDriveTemplate.displayName.AdvancedOrionDrivex1=H-Orion Drive
//   StreamingAssets/Localization/en/TIDriveTemplate.en:379
//     TIDriveTemplate.displayName.NeutronFluxLanternx1=Poseidon Lantern x1
//   StreamingAssets/Localization/en/TILaserWeaponTemplate.en
//     TILaserWeaponTemplate.displayName.60cmIRLaserBattery=60 cm Infrared Laser Battery
//   StreamingAssets/Localization/en/TIShipHullTemplate.en
//     TIShipHullTemplate.displayName.AlienBattlecruiser=Battlecruiser   <- CONTESTED

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const templateLoader = require('../server/templateLoader');
const {
  LocalizationCatalogue,
  resolveLocalizationPath,
  templateDisplayName,
  templateFallbackName
} = require('../server/localization');
const snapshotTemplates = require('../server/snapshot/templates');

const templateTest = templateLoader.templatesPath
  ? test
  : (name, fn) => test(name, { skip: 'TI templates are not configured' }, fn);

// ---------------------------------------------------------------------------
// The parser and its absence handling -- these run with no game install.
// ---------------------------------------------------------------------------

test('an absent localisation directory resolves every lookup to null, never a guess', () => {
  const empty = new LocalizationCatalogue(null);
  assert.equal(empty.available, false);
  assert.equal(empty.lookup('TIDriveTemplate', 'AdvancedOrionDrivex1'), null);
  // The caller then falls back to exactly what it rendered before localisation
  // existed -- an absence must never surface as a blank label or as the raw key.
  assert.equal(
    templateDisplayName({ dataName: 'X', friendlyName: 'Fallback Name', _localizedName: null }, 'X'),
    'Fallback Name'
  );
});

test('a missing key is absent, not the key and not an empty string', () => {
  // Written to a temp directory, not into tests/fixtures: this file exists to
  // exercise the parser's edge cases and leaving it in the tree would be an
  // untracked artifact regenerated on every run.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-localization-'));
  const file = path.join(dir, 'TIFakeTemplate.en');
  fs.writeFileSync(file, [
    'TIFakeTemplate.displayName.Alpha=Alpha Shown',
    'TIFakeTemplate.description.Alpha=not a name',
    'TIFakeTemplate.displayName.Blank=',
    'TIFakeTemplate.displayName.WithEquals=A = B',
    '',
    '// a comment line with no equals'
  ].join('\r\n'), 'utf8');

  const cat = new LocalizationCatalogue(dir);
  assert.equal(cat.lookup('TIFakeTemplate', 'Alpha'), 'Alpha Shown');
  assert.equal(cat.lookup('TIFakeTemplate', 'Missing'), null);
  // An empty value is not a name.
  assert.equal(cat.lookup('TIFakeTemplate', 'Blank'), null);
  // Split on the FIRST '=' only: a display name may legitimately contain one.
  assert.equal(cat.lookup('TIFakeTemplate', 'WithEquals'), 'A = B');
  // A description line must never be mistaken for a display name.
  assert.notEqual(cat.lookup('TIFakeTemplate', 'Alpha'), 'not a name');
  assert.equal(cat.lookup('TIMissingFile', 'Alpha'), null);
});

test('templateFallbackName reads displayName where a file carries no friendlyName', () => {
  // TIHeatSinkTemplate, TIParticleWeaponTemplate and TIPlasmaWeaponTemplate carry
  // `displayName` and no `friendlyName` at all. Comparing against friendlyName
  // alone counted all 63 of their entries as renames when only 17 are.
  assert.equal(templateFallbackName({ dataName: 'A', displayName: 'Water Heat Sink' }), 'Water Heat Sink');
  assert.equal(templateFallbackName({ dataName: 'A', friendlyName: 'F', displayName: 'D' }), 'F');
  assert.equal(templateFallbackName({ dataName: 'A' }), 'A');
  assert.equal(templateFallbackName(null), null);
});

// ---------------------------------------------------------------------------
// Against the installed game.
// ---------------------------------------------------------------------------

templateTest('the localisation directory is found beside the templates directory', () => {
  const resolved = resolveLocalizationPath(templateLoader.templatesPath);
  assert.ok(resolved, 'localisation directory resolved');
  assert.ok(fs.existsSync(path.join(resolved, 'TIDriveTemplate.en')));
});

templateTest('the two drives the user could not find render the name the game shows', () => {
  templateLoader.load();
  const driveStats = snapshotTemplates.buildDriveStats();

  // Read from TIDriveTemplate.en before the fix; the pre-fix dashboard showed
  // "Advanced Orion Drive x1" and "Neutron Flux Lantern x1".
  assert.equal(driveStats.AdvancedOrionDrivex1.displayName, 'H-Orion Drive');
  assert.equal(driveStats.NeutronFluxLanternx1.displayName, 'Poseidon Lantern x1');
  assert.equal(driveStats.PonderomotiveVASIMRx1.displayName, 'Advanced VASIMR x1');

  // The key is still the template dataName, so nothing that resolves by id moved.
  assert.ok(Object.prototype.hasOwnProperty.call(driveStats, 'AdvancedOrionDrivex1'));
});

templateTest('the weapon loadout and the catalogue index resolve names identically', () => {
  templateLoader.load();
  const componentStats = snapshotTemplates.buildComponentStats();

  // THE TWO-SIDED MATCH. `space.js:buildWeaponLoadout` writes the loader's
  // weapon `displayName` into a redacted ship's `weaponLoadout[].systems`, and
  // `militaryValue.buildCatalogueIndex` matches those strings against the
  // `displayName` baked into componentStats. Localise one side only and every
  // redacted-ship weapon inventory silently drops to zero.
  let checked = 0;
  for (const family of snapshotTemplates.WEAPON_FAMILIES) {
    const entries = componentStats[family] || {};
    for (const [id, stats] of Object.entries(entries)) {
      const loaded = templateLoader.getWeaponModule(id);
      assert.ok(loaded, `weapon ${id} is in the loader`);
      assert.equal(
        stats.displayName,
        loaded.displayName,
        `both sides of the weapon match must resolve ${id} the same way`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 300, `checked the whole weapon catalogue, not a slice (${checked})`);

  // At least one weapon must actually have moved, or this test is vacuous.
  assert.equal(componentStats.laser_weapon['60cmIRLaserBattery'].displayName, '60 cm Infrared Laser Battery');
});

templateTest('no two catalogue entries end up sharing a display name', () => {
  templateLoader.load();
  const componentStats = snapshotTemplates.buildComponentStats();

  // `militaryValue.buildCatalogueIndex` DROPS an ambiguous display name rather
  // than guessing, so a collision silently removes that component from the
  // redacted-ship weapon match. The game's own localisation collapses distinct
  // entries onto shared labels on purpose -- alien hulls lose the prefix that
  // separates them from the human hull, alien utility modules all read
  // "Unknown", the nine destroyed hab modules share one label -- so adopting it
  // blindly introduced seventeen collisions where there had been none.
  const seen = new Map();
  const collisions = new Set();
  for (const [family, entries] of Object.entries(componentStats)) {
    if (!entries || typeof entries !== 'object') continue;
    for (const [id, stats] of Object.entries(entries)) {
      const name = stats && stats.displayName;
      if (!name) continue;
      const prior = seen.get(name);
      if (prior && (prior.id !== id || prior.family !== family)) collisions.add(name);
      else seen.set(name, { family, id });
    }
  }
  assert.deepEqual([...collisions], []);
});

templateTest('a contested game name is refused, and the entry keeps its unique template name', () => {
  templateLoader.load();
  // TIShipHullTemplate.en gives BOTH `Battlecruiser` and `AlienBattlecruiser`
  // the name "Battlecruiser". Taking it would make `tech-path?target=Battlecruiser`
  // resolve to the ALIEN hull's unlock project.
  const alien = templateLoader.templates.shipHulls.get('AlienBattlecruiser');
  assert.ok(alien, 'AlienBattlecruiser is loaded');
  assert.equal(alien._localizedName, null, 'a contested name is refused, not adopted');
  assert.equal(templateDisplayName(alien, 'AlienBattlecruiser'), 'Alien Battlecruiser');

  // And the refusal is counted, not silent.
  const coverage = templateLoader.getLocalizationCoverage();
  assert.ok(coverage.files.TIShipHullTemplate.ambiguous > 0);
  assert.ok(coverage.files.TIUtilityModuleTemplate.ambiguous > 0);
  assert.ok(coverage.totals.ambiguous > 0);
});

templateTest('coverage reports what fell back rather than leaving the gap silent', () => {
  templateLoader.load();
  const coverage = templateLoader.getLocalizationCoverage();
  assert.equal(coverage.available, true);

  for (const [file, counters] of Object.entries(coverage.files)) {
    assert.equal(
      counters.localized + counters.fallback + counters.ambiguous,
      counters.scanned,
      `${file}: every scanned entry is accounted for`
    );
  }
  // 101 of 381 org templates and 4 of 750 projects carry no localisation entry.
  // A fallback is an ABSENCE, and it is reported as a number.
  assert.ok(coverage.files.TIOrgTemplate.fallback > 0);
  assert.ok(coverage.totals.fallback > 0);
  assert.ok(coverage.totals.divergent > 0);
});

templateTest('mission friendlyName stays the engine identity key, display is a separate field', () => {
  templateLoader.load();
  const specs = snapshotTemplates.buildMissionSpecs();

  // server/engine/odds.js matches the literal 'Control Nation' and
  // server/engine/clocks.js matches 'Defend Interests'. Rewriting friendlyName
  // would silently break mission matching.
  assert.equal(specs.GainInfluence.friendlyName, 'Control Nation');
  assert.equal(specs.DefendInterests.friendlyName, 'Defend Interests');
  assert.equal(specs.Propaganda.friendlyName, 'Public Campaign');

  // The game's own name lives beside it. Read from TIMissionTemplate.en.
  assert.equal(specs.Assassinate.friendlyName, 'Assassinate Councilor');
  assert.equal(specs.Assassinate.displayName, 'Assassinate');
  assert.equal(specs.SeizeSpaceAsset.displayName, 'Assault Enemy Space Asset');
});

templateTest('save-sourced families are left alone -- localising them would be a regression', () => {
  templateLoader.load();
  // Nations and hab sites render the SAVE's displayName, which the game already
  // writes localised. Their TEMPLATES diverge (36 and 490 entries) but never
  // reach the screen, so nothing in the snapshot may read them.
  //
  // The nation template's own name is the pre-localisation spelling; the save
  // carries the localised one. If a reducer ever started reading the template
  // here, this pins which side of the difference it would be on.
  const atz = templateLoader.templates.nations.get('ATZ');
  if (atz) {
    assert.equal(templateFallbackName(atz), 'Atzlan', 'the template still spells it the old way');
  }
  const site = templateLoader.templates.habSites.get('LunaSite1');
  if (site) {
    assert.equal(templateFallbackName(site), 'Mare Ibrium', 'the template still spells it the old way');
  }
});
