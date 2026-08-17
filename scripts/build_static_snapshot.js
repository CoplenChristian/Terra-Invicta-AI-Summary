const fs = require('fs');
const path = require('path');
const saveParser = require('../server/saveParser');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const exportGenerator = require('../server/exportGenerator');
const templateLoader = require('../server/templateLoader');

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

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(publicDir, distDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'server'), { recursive: true });
fs.copyFileSync(
  path.join(projectRoot, 'site', 'worker', 'index.js'),
  path.join(distDir, 'server', 'index.js')
);

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
};

const observerFactions = rawSnapshot.factions.filter(f => f.ID !== undefined);
for (const observer of observerFactions) {
  const playerData = intelligenceFilter.applyFilter(rawSnapshot, 'player', observer.ID);
  writeJson(`snapshot-player-${observer.ID}.json`, { success: true, data: playerData });
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

writeJson('site-info.json', {
  mode: 'static-player-intel',
  save: rawSnapshot.metadata,
  generatedAt: new Date().toISOString(),
  note: 'Hosted build contains Player Intel snapshots only. Raw save files are not included.'
});

console.log(`Built hosted Player Intel snapshot from ${latestSave.name}`);
console.log(`Campaign date: ${rawSnapshot.metadata.gameTimeString}`);
console.log(`Observers packaged: ${observerFactions.length}`);
console.log(`Output: ${distDir}`);
