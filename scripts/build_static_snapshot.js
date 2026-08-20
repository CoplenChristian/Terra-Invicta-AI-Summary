const fs = require('fs');
const path = require('path');
const saveParser = require('../server/saveParser');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const exportGenerator = require('../server/exportGenerator');
const briefingGenerator = require('../server/briefingGenerator');
const templateLoader = require('../server/templateLoader');
const snapshotIdentity = require('../server/snapshotIdentity');
const snapshotDelta = require('../server/snapshotDelta');
const { resolveConfig, safeRuntimeConfig } = require('../server/config');
const runtimeConfig = resolveConfig();

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const distDir = path.join(projectRoot, 'dist');
const dataDir = path.join(distDir, 'data');

if (path.basename(distDir) !== 'dist' || path.dirname(distDir) !== projectRoot) {
  throw new Error(`Refusing to rebuild unexpected output path: ${distDir}`);
}

const latestSave = saveParser.getLatestSaveFile();
const saveData = saveParser.readSaveJson(latestSave.fullPath);
const rawSnapshot = snapshotBuilder.buildRawSnapshot(saveData);
const identity = snapshotIdentity.createSnapshotIdentity(latestSave, runtimeConfig.campaign.key);
snapshotIdentity.attachSnapshotIdentity(rawSnapshot, identity);
let previousRawSnapshot = null;
try {
  const previousSave = saveParser.getAvailableSaves().find(candidate => {
    return path.resolve(candidate.fullPath).toLowerCase() !== path.resolve(latestSave.fullPath).toLowerCase() &&
      new Date(candidate.lastModified).getTime() < new Date(latestSave.lastModified).getTime();
  });
  if (previousSave) {
    previousRawSnapshot = snapshotBuilder.buildRawSnapshot(saveParser.readSaveJson(previousSave.fullPath));
    snapshotIdentity.attachSnapshotIdentity(previousRawSnapshot, snapshotIdentity.createSnapshotIdentity(
      previousSave,
      runtimeConfig.campaign.key,
      identity.generatedAt
    ));
  }
} catch (previousError) {
  console.warn(`[Warning] Previous save comparison unavailable: ${previousError.message}`);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(publicDir, distDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'server'), { recursive: true });
fs.cpSync(path.join(projectRoot, 'shared'), path.join(distDir, 'shared'), { recursive: true });
fs.copyFileSync(
  path.join(projectRoot, 'site', 'worker', 'index.js'),
  path.join(distDir, 'server', 'index.js')
);
// Sites executes dist/server/index.js as the worker entrypoint. Keep the
// worker's ESM dependencies beside that entrypoint because some deployments
// do not expose sibling directories under dist during module resolution.
fs.cpSync(path.join(projectRoot, 'shared'), path.join(distDir, 'server', 'shared'), { recursive: true });
const workerPath = path.join(distDir, 'server', 'index.js');
const workerSource = fs.readFileSync(workerPath, 'utf8')
  .replaceAll("from '../shared/", "from './shared/");
fs.writeFileSync(workerPath, workerSource);

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
};

const observerFactions = rawSnapshot.factions.filter(f => f.ID !== undefined);
for (const observer of observerFactions) {
  const playerData = intelligenceFilter.applyFilter(rawSnapshot, 'player', observer.ID);
  intelligenceFilter.assertPlayerSnapshotSafe(playerData);
  playerData.changesSincePrevious = previousRawSnapshot
    ? snapshotDelta.build(
      intelligenceFilter.applyFilter(previousRawSnapshot, 'player', observer.ID),
      playerData,
      observer.ID
    )
    : snapshotDelta.build(null, playerData, observer.ID);
  const missionControlBriefing = briefingGenerator.generateMissionControlBriefing(playerData, rawSnapshot);
  writeJson(`snapshot-player-${observer.ID}.json`, {
    success: true,
    data: { ...playerData, missionControlBriefing }
  });
  writeJson(`export-chatgpt-player-${observer.ID}.json`, {
    success: true,
    markdown: exportGenerator.generateCompactSnapshot(playerData)
  });
  writeJson(`export-full-player-${observer.ID}.json`, {
    success: true,
    markdown: exportGenerator.generateFullMarkdownReport(playerData)
  });
}

writeJson('effects.json', {
  success: true,
  validation: templateLoader.validationResults,
  templatesPath: 'Game templates validated during the local snapshot build.',
  techCount: templateLoader.templates.techs.size,
  projectCount: templateLoader.templates.projects.size,
  effectCount: templateLoader.templates.effects.size
});

writeJson('runtime-config.json', safeRuntimeConfig(runtimeConfig));

writeJson('site-info.json', {
  mode: 'static-player-intel',
  save: rawSnapshot.metadata,
  campaignDate: rawSnapshot.metadata.gameTimeString || null,
  saveFilename: rawSnapshot.metadata.fileName || null,
  saveModifiedAt: identity.saveModifiedAt,
  ...identity,
  note: 'Hosted build contains Player Intel snapshots only. Raw save files are not included.'
});

// Sites deployments may not mount the static asset binding for this
// non-vinext worker. Embed the small dashboard shell and metadata assets in a
// generated module so the worker can still serve the UI and effects endpoint.
const embeddedAssetPaths = [
  'index.html',
  'css/main.css',
  'css/components.css',
  'js/api.js',
  'js/app.js',
  'data/effects.json',
  'data/runtime-config.json',
  'v2/index.html',
  'v2/css/mission-control.css',
  'v2/js/shared.js',
  'v2/js/mission-control.js',
  'v2/js/components/mc-budget.js',
  'v2/js/components/detail-panel.js',
  'v2/js/components/world-map.js',
  'v2/data/world.geojson',
  'v2/js/components/faction-intel.js',
  'v2/js/components/intelligence-library.js',
  'v2/js/components/executive-boards.js',
  'v2/js/components/alien-hate-economics.js',
  'v2/js/components/directive-board.js'
];
const factionLogoDir = path.join(distDir, 'v2', 'assets', 'faction-logos');
if (fs.existsSync(factionLogoDir)) {
  for (const fileName of fs.readdirSync(factionLogoDir).filter(name => name.toLowerCase().endsWith('.png')).sort()) {
    embeddedAssetPaths.push(`v2/assets/faction-logos/${fileName}`);
  }
}
// Keep the worker's explicit safe asset manifest honest as browser modules
// are split or added. Every local script/link reference in the v2 shell must
// be embedded, otherwise the hosted worker serves a page with broken assets.
const referencedAssets = [
  ...[...fs.readFileSync(path.join(distDir, 'v2', 'index.html'), 'utf8').matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)]
    .map(match => match[1].replace(/^\//, ''))
    .filter(relativePath => relativePath.startsWith('v2/'))
];
for (const referenced of referencedAssets) {
  if (!embeddedAssetPaths.includes(referenced)) {
    throw new Error(`Hosted asset manifest is missing HTML reference: ${referenced}`);
  }
}
const embeddedAssets = Object.fromEntries(
  embeddedAssetPaths.map(relativePath => {
    const absolutePath = path.join(distDir, relativePath);
    if (relativePath.toLowerCase().endsWith('.png')) {
      return [relativePath, {
        encoding: 'base64',
        data: fs.readFileSync(absolutePath).toString('base64')
      }];
    }
    return [relativePath, fs.readFileSync(absolutePath, 'utf8')];
  })
);
fs.writeFileSync(
  path.join(distDir, 'server', 'static-assets.js'),
  `export const staticAssets = ${JSON.stringify(embeddedAssets)};\n`
);

console.log(`Built hosted Player Intel snapshot from ${latestSave.name}`);
console.log(`Campaign date: ${rawSnapshot.metadata.gameTimeString}`);
console.log(`Observers packaged: ${observerFactions.length}`);
console.log(`Output: ${distDir}`);
