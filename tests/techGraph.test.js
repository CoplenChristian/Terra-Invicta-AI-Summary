const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const techIntel = require('../server/techIntel');
const techGraph = require('../shared/techGraph.mjs');
const templateLoader = require('../server/templateLoader');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;
const templateTest = templateLoader.templatesPath
  ? test
  : (name, options, fn) => test(name, { ...(typeof options === 'object' ? options : {}), skip: 'TI templates are not configured' }, typeof options === 'function' ? options : fn);

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

templateTest('techTree is embedded in the filtered snapshot', () => {
  const snapshot = buildSnapshot();
  assert.ok(snapshot.techTree, 'techTree present on filtered snapshot');
  assert.strictEqual(snapshot.techTree.counts.techs, 149);
  assert.strictEqual(snapshot.techTree.counts.projects, 750);
  assert.ok(Array.isArray(snapshot.techTree.nodes) && snapshot.techTree.nodes.length > 0);
});

templateTest('tech-tree reports accurate observer status per node', () => {
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

templateTest('tech-tree category filter narrows nodes', () => {
  const snapshot = buildSnapshot();
  const all = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  const weapons = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'weapons' });
  assert.ok(weapons.counts.nodes < all.counts.nodes, 'weapons category returns fewer nodes than all');
  assert.ok(weapons.nodes.some(n => n.id === 'Project_RailCannonMk3'), 'rail cannon project is in weapons category');
  assert.ok(weapons.nodes.every(n => /weapon|gun|laser|plasma|particle|rail|coil|missile|torpedo|kinetic|point.?defen/i.test(n.id + ' ' + n.displayName + ' ' + (n.subcategory || ''))));
});

templateTest('tech-path accounts for current progress', () => {
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

templateTest('tech-path reports already-completed target', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Project_RailCannonMk2']);
  assert.strictEqual(path.alreadyCompleted.length, 1);
  assert.strictEqual(path.alreadyCompleted[0].id, 'Project_RailCannonMk2');
  assert.strictEqual(path.totalRemainingResearchCost, 0);
});

templateTest('tech-path resolves target by display name', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Advanced Rail Cannon']);
  assert.strictEqual(path.target.id, 'Project_RailCannonMk3');
});

templateTest('multi-target path deduplicates shared prerequisites', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['Project_RailCannonMk3', 'Battlecruiser']);
  assert.ok(Array.isArray(path.targets));
  assert.strictEqual(path.targets.length, 2);
  const ids = path.remainingPath.map(p => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'remaining path has no duplicate nodes');
  assert.ok(ids.includes('Project_FleetCombatants'), 'Battlecruiser unlock project is on the path');
});

templateTest('tech-search finds the project that unlocks Battlecruiser', () => {
  const snapshot = buildSnapshot();
  const result = techIntel.buildSearch(snapshot, 'omniscient', OBSERVER, 'battlecruiser');
  assert.ok(result.items.length > 0);
  const unlockers = result.items.filter(i => i.unlocks.some(u => /battlecruiser/i.test(u.displayName)));
  assert.ok(unlockers.some(u => u.id === 'Project_FleetCombatants'), 'Fleet Combatants found via hull unlock name');
});

templateTest('tech-milestones reports ship hull unlock state', () => {
  const snapshot = buildSnapshot();
  const result = techIntel.buildMilestones(snapshot, 'omniscient', OBSERVER, 'ship_hull');
  const bc = result.items.find(i => i.name === 'Battlecruiser');
  assert.ok(bc, 'Battlecruiser milestone present');
  assert.strictEqual(bc.unlockProject, 'Project_FleetCombatants');
  assert.strictEqual(bc.status, 'locked');
  assert.ok(bc.remainingResearchCost > 0);
});

templateTest('research-queue projects observer current research', () => {
  const snapshot = buildSnapshot();
  const queue = techIntel.buildQueue(snapshot, 'omniscient', OBSERVER);
  assert.strictEqual(queue.resource, 'research-queue');
  assert.ok(Array.isArray(queue.factionProjects));
  assert.ok(queue.factionProjects.some(p => p.projectId === 'Project_TheirMovements'));
  assert.strictEqual(queue.factionProjects.find(p => p.projectId === 'Project_TheirMovements').progress, 0.25);
});

templateTest('unknown tech target returns an error entry', () => {
  const snapshot = buildSnapshot();
  const path = techIntel.buildPath(snapshot, 'omniscient', OBSERVER, ['NoSuchProject']);
  assert.ok(path.targets[0].error, 'missing target is reported as an error');
});

templateTest('shared module and local wrapper produce identical projections', async () => {
  const shared = await import('../shared/techGraph.mjs');
  const snapshot = buildSnapshot();
  const local = techIntel.buildTechTree(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  const pure = shared.buildTechTreeProjection(snapshot, 'omniscient', OBSERVER, { category: 'all' });
  assert.deepStrictEqual(pure.nodes, local.nodes);
});

// --- Project availability ----------------------------------------------------
// Project availability is a monthly RNG gate: it starts at initialUnlockChance,
// rises by deltaUnlockChance each month, and caps at maxUnlockChance. A project
// capped below 100 can never be scheduled, only waited on.
test('project availability distinguishes schedulable from RNG-capped', () => {
  const graph = techGraph.buildTechGraph(
    { allTechs: () => [], allProjects: () => [] },
    {
      techs: [],
      projects: [
        { dataName: 'Project_Certain', friendlyName: 'Certain', researchCost: 6000,
          initialUnlockChance: 0, deltaUnlockChance: 5, maxUnlockChance: 100 },
        { dataName: 'Project_Capped', friendlyName: 'Capped', researchCost: 5000,
          initialUnlockChance: 0, deltaUnlockChance: 5, maxUnlockChance: 35 },
        { dataName: 'Project_Unknown', friendlyName: 'Unknown', researchCost: 100 }
      ],
      effects: {},
      componentByEffect: {}
    }
  );

  const certain = graph.byId.get('Project_Certain');
  assert.strictEqual(certain.availability.schedulable, true);
  assert.strictEqual(certain.availability.maxPercent, 100);
  assert.ok(certain.availability.expectedMonths > 0);

  const capped = graph.byId.get('Project_Capped');
  assert.strictEqual(capped.availability.schedulable, false,
    'a 35% cap means it can never be counted on in a plan');
  assert.strictEqual(capped.availability.maxPercent, 35);

  // Missing template fields must report unknown, not a confident schedulable.
  const unknown = graph.byId.get('Project_Unknown');
  assert.strictEqual(unknown.availability.known, false);
  assert.strictEqual(unknown.availability.schedulable, null);
});

test('a higher monthly ramp shortens the expected wait', () => {
  const graph = techGraph.buildTechGraph(
    { allTechs: () => [], allProjects: () => [] },
    {
      techs: [],
      projects: [
        { dataName: 'Project_Slow', initialUnlockChance: 0, deltaUnlockChance: 5, maxUnlockChance: 100 },
        { dataName: 'Project_Fast', initialUnlockChance: 0, deltaUnlockChance: 10, maxUnlockChance: 100 }
      ],
      effects: {},
      componentByEffect: {}
    }
  );
  const slow = graph.byId.get('Project_Slow').availability.expectedMonths;
  const fast = graph.byId.get('Project_Fast').availability.expectedMonths;
  assert.ok(fast < slow, `expected faster ramp to resolve sooner (${fast} vs ${slow})`);
});

test('an omitted tech tree is distinguishable from an empty one', () => {
  // Published snapshots strip the tech tree (static template data) to save
  // storage. Without an explicit marker, "omitted" and "no techs exist" are
  // indistinguishable and callers would report the latter as fact.
  const stripped = techGraph.graphFromTree({
    techTreeRef: { omitted: true, nodeCount: 899, reason: 'static template data' }
  });
  assert.strictEqual(stripped.omitted, true);
  assert.strictEqual(stripped.expectedNodeCount, 899);
  assert.match(stripped.omittedReason, /static template data/);

  const genuinelyEmpty = techGraph.graphFromTree({ techTree: { nodes: [] } });
  assert.strictEqual(genuinelyEmpty.omitted, false);
  assert.strictEqual(genuinelyEmpty.expectedNodeCount, 0);
});

test('an unresolved shared tech graph reports unavailable, not empty', () => {
  // Published rows carry only the per-save half of the tree; the static nodes
  // live once on the campaign. If a reader fails to splice them back in, that
  // must read as "unavailable", never as "this campaign has no techs".
  const unresolved = techGraph.graphFromTree({
    techTree: {
      finishedTechsNames: ['MissiontoMars'],
      graphRef: { fingerprint: 'tg:899:abc123', nodeCount: 899, source: 'campaigns.tech_graph' }
    }
  });
  assert.strictEqual(unresolved.omitted, true);
  assert.strictEqual(unresolved.expectedNodeCount, 899);
  assert.match(unresolved.omittedReason, /tg:899:abc123/);

  // Once spliced, it is an ordinary graph again.
  const resolved = techGraph.graphFromTree({
    techTree: {
      finishedTechsNames: ['MissiontoMars'],
      graphRef: { fingerprint: 'tg:2:abc123', nodeCount: 2 },
      nodes: [
        { id: 'A', type: 'global_tech' },
        { id: 'Project_B', type: 'faction_project' }
      ]
    }
  });
  assert.strictEqual(resolved.omitted, false);
  assert.strictEqual(resolved.nodes.length, 2);
  assert.strictEqual(resolved.techs.length, 1);
  assert.strictEqual(resolved.projects.length, 1);
});

test('a reader-supplied unavailable reason is surfaced verbatim', () => {
  const mismatch = techGraph.graphFromTree({
    techTree: {
      graphRef: { fingerprint: 'tg:899:aaa', nodeCount: 899 },
      graphUnavailable: 'stored tech graph fingerprint does not match this snapshot; republish the campaign'
    }
  });
  assert.strictEqual(mismatch.omitted, true);
  assert.match(mismatch.omittedReason, /republish the campaign/);
});
