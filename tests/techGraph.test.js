const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const techIntel = require('../server/techIntel');
const techGraph = require('../shared/techGraph.mjs');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

function buildSnapshot(initiativeOverrides = {}) {
  const save = makeSaveData();
  const initiative = save.gamestates['PavonisInteractive.TerraInvicta.TIFactionState'][0].Value;
  Object.assign(initiative, {
    finishedProjectNames: ['Project_TheirOperations', 'Project_RailCannonMk1', 'Project_RailCannonMk2'],
    availableProjectNames: ['Project_RailCannonMk3'],
    currentProjectProgress: [{ projectTemplateName: 'Project_TheirMovements', accumulatedResearch: 500, totalCost: 2000 }],
    ...initiativeOverrides
  });
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  snapshotIdentity.attachSnapshotIdentity(raw, identity);
  return intelligenceFilter.applyFilter(raw, 'omniscient', OBSERVER);
}

test('techTree is embedded in the filtered snapshot', () => {
  const snapshot = buildSnapshot();
  assert.ok(snapshot.techTree, 'techTree present on filtered snapshot');
  assert.strictEqual(snapshot.techTree.counts.techs, 149);
  assert.strictEqual(snapshot.techTree.counts.projects, 750);
  assert.ok(Array.isArray(snapshot.techTree.nodes) && snapshot.techTree.nodes.length > 0);
});

test('tech-tree reports accurate observer status per node', () => {
  const snapshot = buildSnapshot();
  const tree = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  assert.strictEqual(tree.resource, 'tech-tree');
  const rail3 = tree.nodes.find(n => n.id === 'Project_RailCannonMk3');
  assert.strictEqual(rail3.status, 'available');
  assert.strictEqual(rail3.available, true);
  assert.strictEqual(rail3.locked, false);
  const rail2 = tree.nodes.find(n => n.id === 'Project_RailCannonMk2');
  assert.strictEqual(rail2.status, 'completed');
  const theirMov = tree.nodes.find(n => n.id === 'Project_TheirMovements');
  assert.strictEqual(theirMov.status, 'researching');
  assert.strictEqual(theirMov.researchPercent, 25);
});

test('tech-tree category filter narrows nodes', () => {
  const snapshot = buildSnapshot();
  const all = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  const weapons = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'weapons' });
  assert.ok(weapons.counts.nodes < all.counts.nodes, 'weapons category returns fewer nodes than all');
  assert.ok(weapons.nodes.some(n => n.id === 'Project_RailCannonMk3'), 'rail cannon project is in weapons category');
  assert.ok(weapons.nodes.every(n => /weapon|gun|laser|plasma|particle|rail|coil|missile|torpedo|kinetic|point.?defen/i.test(n.id + ' ' + n.displayName + ' ' + (n.subcategory || ''))));
});

test('tech-path accounts for current progress', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Project_RailCannonMk3']);
  assert.strictEqual(path.resource, 'tech-path');
  assert.strictEqual(path.target.id, 'Project_RailCannonMk3');
  // Mk1 and Mk2 are completed, so only Mk3 itself remains in the faction path.
  const factionIds = path.remainingPath.filter(p => p.type === 'faction_project').map(p => p.id);
  assert.deepStrictEqual(factionIds, ['Project_RailCannonMk3']);
  assert.strictEqual(path.totalRemainingResearchCost, 5000);
  assert.strictEqual(path.remainingFactionResearchCost, 5000);
});

test('tech-path reports already-completed target', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Project_RailCannonMk2']);
  assert.strictEqual(path.alreadyCompleted.length, 1);
  assert.strictEqual(path.alreadyCompleted[0].id, 'Project_RailCannonMk2');
  assert.strictEqual(path.totalRemainingResearchCost, 0);
});

test('tech-path resolves target by display name', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Advanced Rail Cannon']);
  assert.strictEqual(path.target.id, 'Project_RailCannonMk3');
});

test('multi-target path deduplicates shared prerequisites', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Project_RailCannonMk3', 'Battlecruiser']);
  assert.ok(Array.isArray(path.targets));
  assert.strictEqual(path.targets.length, 2);
  const ids = path.remainingPath.map(p => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'remaining path has no duplicate nodes');
  assert.ok(ids.includes('Project_FleetCombatants'), 'Battlecruiser unlock project is on the path');
});

test('tech-search finds the project that unlocks Battlecruiser', () => {
  const snapshot = buildSnapshot();
  const result = techIntel.buildSearch(snapshot, 'omniscient', OBSERVER, 'battlecruiser');
  assert.ok(result.items.length > 0);
  const unlockers = result.items.filter(i => i.unlocks.some(u => /battlecruiser/i.test(u.displayName)));
  assert.ok(unlockers.some(u => u.id === 'Project_FleetCombatants'), 'Fleet Combatants found via hull unlock name');
});

test('tech-milestones reports ship hull unlock state', () => {
  const snapshot = buildSnapshot();
  const result = techIntel.buildMilestones(snapshot, 'omniscient', OBSERVER, 'ship_hull');
  const bc = result.items.find(i => i.name === 'Battlecruiser');
  assert.ok(bc, 'Battlecruiser milestone present');
  assert.strictEqual(bc.unlockProject, 'Project_FleetCombatants');
  assert.strictEqual(bc.status, 'locked');
  assert.ok(bc.remainingResearchCost > 0);
});

test('research-queue projects observer current research', () => {
  const snapshot = buildSnapshot();
  const queue = techIntel.buildQueue(snapshot, 'omniscient', OBSERVER);
  assert.strictEqual(queue.resource, 'research-queue');
  assert.ok(Array.isArray(queue.factionProjects));
  assert.ok(queue.factionProjects.some(p => p.projectId === 'Project_TheirMovements'));
  assert.strictEqual(queue.factionProjects.find(p => p.projectId === 'Project_TheirMovements').progress, 0.25);
});

test('unknown tech target returns an error entry', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['NoSuchProject']);
  assert.ok(path.targets[0].error, 'missing target is reported as an error');
});

test('shared module and local wrapper produce identical projections', async () => {
  const shared = await import('../shared/techGraph.mjs');
  const snapshot = buildSnapshot();
  const local = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  const pure = shared.buildTechTreeProjection(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  assert.deepStrictEqual(pure.nodes, local.nodes);
});
