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
//
// The v2 entries are DERIVED from the shell's own <script>/<link> tags, not
// hand-listed beside them. A parallel hand-maintained list is exactly what
// broke this build: `v2/js/components/mining-expansion.js` and
// `v2/js/components/council-orders.js` were added to public/v2/index.html and
// never added here, so `npm run build:site` failed on the manifest check --
// and before that check existed, the hosted worker would simply have served a
// page missing those components. Adding a <script> tag is now the only edit a
// new browser module needs.
const ASSET_EXTENSIONS = /\.(html|css|js|mjs|json|geojson|png|svg|webp|woff2?)$/i;

// Local file references in one HTML shell, normalised to dist-relative paths.
// Skips absolute URLs, protocol-relative URLs, data: URIs, fragments, API
// routes and bare directory links such as href="/v2" -- only things that name
// a real file with an asset extension survive.
const readReferencedAssets = (htmlRelativePath, baseDir) => {
  const html = fs.readFileSync(path.join(distDir, htmlRelativePath), 'utf8');
  return [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1].trim())
      .filter(reference => reference && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference))
      .map(reference => reference.split(/[?#]/)[0])
      .filter(reference => ASSET_EXTENSIONS.test(reference))
      .map(reference => (reference.startsWith('/')
        ? reference.replace(/^\/+/, '')
        : `${baseDir}${reference}`).replace(/\\/g, '/'))
  )].filter(relativePath => {
    const absolute = path.join(distDir, relativePath);
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
  });
};

// Assets no HTML tag references because a script fetches them at runtime.
// These stay explicit -- there is no tag to derive them from.
const runtimeFetchedAssets = [
  'data/effects.json',
  'data/runtime-config.json',
  'v2/data/world.geojson'
];

const embeddedAssetPaths = [];
const addAsset = (relativePath) => {
  if (!embeddedAssetPaths.includes(relativePath)) embeddedAssetPaths.push(relativePath);
};

// v1 shell (public/index.html) and v2 shell (public/v2/index.html).
addAsset('index.html');
for (const asset of readReferencedAssets('index.html', '')) addAsset(asset);
addAsset('v2/index.html');
for (const asset of readReferencedAssets('v2/index.html', 'v2/')) addAsset(asset);
for (const asset of runtimeFetchedAssets) addAsset(asset);


const factionLogoDir = path.join(distDir, 'v2', 'assets', 'faction-logos');
if (fs.existsSync(factionLogoDir)) {
  for (const fileName of fs.readdirSync(factionLogoDir).filter(name => name.toLowerCase().endsWith('.png')).sort()) {
    addAsset(`v2/assets/faction-logos/${fileName}`);
  }
}

// The derivation above cannot drift from the shell, but `readReferencedAssets`
// drops a reference whose file is missing on disk. That has to be loud: a
// broken <script src> would otherwise leave the hosted page silently short a
// component, which is the failure mode the manifest check exists to prevent.
for (const [shell, baseDir] of [['index.html', ''], ['v2/index.html', 'v2/']]) {
  const html = fs.readFileSync(path.join(distDir, shell), 'utf8');
  const localReferences = [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1].trim())
      .filter(reference => reference && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference))
      .map(reference => reference.split(/[?#]/)[0])
      .filter(reference => ASSET_EXTENSIONS.test(reference))
      .map(reference => (reference.startsWith('/')
        ? reference.replace(/^\/+/, '')
        : `${baseDir}${reference}`).replace(/\\/g, '/'))
  )];
  for (const reference of localReferences) {
    if (!fs.existsSync(path.join(distDir, reference))) {
      throw new Error(`${shell} references a local asset that does not exist: ${reference}`);
    }
    if (!embeddedAssetPaths.includes(reference)) {
      throw new Error(`Hosted asset manifest is missing HTML reference: ${reference}`);
    }
  }
}
for (const missing of embeddedAssetPaths.filter(relativePath => !fs.existsSync(path.join(distDir, relativePath)))) {
  throw new Error(`Hosted asset manifest lists a file that does not exist: ${missing}`);
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
