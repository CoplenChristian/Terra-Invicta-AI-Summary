// tests/drivePathModal.test.js
//
// Purpose: pins the drive-path modal — the satisfied half of a tech path that
//   the remaining-path walk drops, the click affordance a drive row lacked
//   entirely, and the two things the modal must never imply.
//
// THE GAP THIS FILE EXISTS FOR
// ----------------------------
// `buildTechPath` collects only the REMAINING path. Before the change that
// accompanies this file, `satisfiedPrerequisites` did not exist and
// `alreadyCompleted` returned 0 entries even on a 12-step path, so the modal
// could only ever be a to-do list. The first test below is the non-vacuity
// proof: it fails against the previous code because the field is absent.
//
// TWO THINGS THE MODAL MUST NEVER IMPLY
// -------------------------------------
//  1. That a cleared path is a startable one. Availability is rolled monthly
//     from each project's unlock chance, not derived from its prerequisites
//     (docs/research-advisor-spec.md 3b).
//  2. That `researchCost: -1` is a cost. It marks a project that is never
//     researched, so a path containing one has NO honest total -- it reports
//     unknown, never a smaller number.
//
// Live-save independence: the Pion Torch figures are asserted only where the
// spec named them as the acceptance case, and every other assertion is a
// PROPERTY (the sections partition the path; the counts reconcile; no null
// reaches the text) so a later save does not turn this file red.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const techIntel = require('../server/techIntel');
const techGraph = require('../shared/techGraph.mjs');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const templateLoader = require('../server/templateLoader');
const { buildResourceProjection } = require('../shared/intel/registry.mjs');
const { MISSION_CONTROL_SHARED } = require('./fixtures/renderHarness');

const OBSERVER = 4712;
const MODES = ['player', 'omniscient'];

// The spec's acceptance case: the gate behind Pion Torch on the live save.
const PION_TORCH_GATE = 'Project_AntimatterBeamCoreTorch';

const templateTest = templateLoader.templatesPath
  ? test
  : (name, fn) => test(name, { skip: 'TI templates are not configured' }, fn);

const liveCache = new Map();
function live(mode) {
  if (!liveCache.has(mode)) {
    liveCache.set(mode, loadFixtureFilteredSnapshot({ mode, observer: OBSERVER }));
  }
  return liveCache.get(mode);
}

// ---------------------------------------------------------------------------
// 1. THE GAP — satisfied prerequisites, which returned nothing before
// ---------------------------------------------------------------------------

templateTest('the satisfied half of a path is reported, and it is not empty', () => {
  for (const mode of MODES) {
    const projection = techIntel.buildPath(live(mode), mode, OBSERVER, [PION_TORCH_GATE]);

    assert.ok(Array.isArray(projection.satisfiedPrerequisites),
      `[${mode}] satisfiedPrerequisites must be an array, not absent`);
    // NON-VACUITY: this is the assertion that fails against the previous code,
    // where the field did not exist and alreadyCompleted was 0 on this path.
    assert.strictEqual(projection.satisfiedPrerequisiteTotalCount, projection.satisfiedPrerequisites.length,
      `[${mode}] satisfiedPrerequisiteTotalCount must match the carried list`);
    assert.strictEqual(projection.satisfiedPrerequisiteOmittedCount, 0,
      `[${mode}] nothing is omitted at this size, and the count must say so rather than be absent`);
    assert.ok(projection.satisfiedPrerequisiteTotalCount > 0,
      `[${mode}] the Pion Torch gate must have prerequisites already satisfied on the fixture`);

    for (const node of projection.satisfiedPrerequisites) {
      assert.strictEqual(node.status, 'completed',
        `[${mode}] ${node.id} is in the satisfied list, so it must read as completed`);
      assert.ok(node.id && node.displayName, `[${mode}] a satisfied node must carry its identity`);
      assert.ok(node.type === 'faction_project' || node.type === 'global_tech',
        `[${mode}] ${node.id} must carry the same two-way split the remaining path uses`);
    }

    // The two lists are disjoint by construction: a node cannot be both done
    // and remaining. If they ever overlap, every count in the modal is wrong.
    const remainingIds = new Set(projection.remainingPath.map(node => node.id));
    for (const node of projection.satisfiedPrerequisites) {
      assert.ok(!remainingIds.has(node.id),
        `[${mode}] ${node.id} appears in both the remaining and the satisfied list`);
    }
  }
});

templateTest('satisfied prerequisites are additive: the pinned remaining figures are untouched', () => {
  for (const mode of MODES) {
    const projection = techIntel.buildPath(live(mode), mode, OBSERVER, [PION_TORCH_GATE]);

    assert.ok(projection.remainingPath.length > 0, `[${mode}] steps remain on the Pion Torch path`);
    const factionRemain = projection.remainingPath.filter(n => n.type === 'faction_project').length;
    const globalRemain = projection.remainingPath.filter(n => n.type === 'global_tech').length;
    assert.ok(factionRemain > 0, `[${mode}] faction projects remain on the path`);
    assert.ok(globalRemain > 0, `[${mode}] global techs remain on the path`);
    assert.strictEqual(projection.remainingFactionResearchCost, 497500, `[${mode}] faction cost`);
    assert.strictEqual(projection.remainingGlobalResearchCost, 139702, `[${mode}] global cost`);
    assert.strictEqual(projection.totalRemainingResearchCost, 637202, `[${mode}] total`);
    // `alreadyCompleted` names TARGETS already done. It is a different question
    // from satisfied prerequisites and must not have been repurposed.
    assert.deepStrictEqual(projection.alreadyCompleted, [],
      `[${mode}] the target is not itself completed, so alreadyCompleted stays empty`);
  }
});

templateTest('a completed target still reports through alreadyCompleted, with no satisfied list', () => {
  for (const mode of MODES) {
    const graph = techGraph.observerGraph(live(mode), mode, OBSERVER);
    const done = graph.nodes.find(node => node.status === 'completed');
    assert.ok(done, `[${mode}] the observer must have completed something`);

    const projection = techIntel.buildPath(live(mode), mode, OBSERVER, [done.id]);
    assert.strictEqual(projection.alreadyCompleted.length, 1);
    assert.strictEqual(projection.remainingPath.length, 0);
    assert.strictEqual(projection.satisfiedPrerequisiteTotalCount, 0,
      `[${mode}] a target already done has no path left to have satisfied anything on`);
  }
});

templateTest('the satisfied list follows the chosen route, never the road not taken', () => {
  // The walker picks the cheapest satisfying branch through altPrereq0. A
  // completed prerequisite that sits only on the REJECTED branch is not on this
  // path and must not be claimed as progress toward it.
  const nodes = [
    {
      id: 'Project_Target', displayName: 'Target', type: 'faction_project', category: 'Energy',
      researchCost: 100, status: 'locked',
      prerequisites: [{ id: 'Project_Expensive', type: 'faction_project' }],
      alternatePrerequisites: [{ id: 'Project_Cheap', type: 'faction_project' }],
      effects: [], unlocks: []
    },
    {
      id: 'Project_Expensive', displayName: 'Expensive', type: 'faction_project', category: 'Energy',
      researchCost: 9000, status: 'locked',
      prerequisites: [{ id: 'Project_OnlyOnExpensive', type: 'global_tech' }],
      alternatePrerequisites: [], effects: [], unlocks: []
    },
    {
      id: 'Project_Cheap', displayName: 'Cheap', type: 'faction_project', category: 'Energy',
      researchCost: 10, status: 'available',
      prerequisites: [{ id: 'Project_OnlyOnCheap', type: 'global_tech' }],
      alternatePrerequisites: [], effects: [], unlocks: []
    },
    {
      id: 'Project_OnlyOnExpensive', displayName: 'Only On Expensive', type: 'global_tech', category: 'Energy',
      researchCost: 50, status: 'completed', prerequisites: [], alternatePrerequisites: [], effects: [], unlocks: []
    },
    {
      id: 'Project_OnlyOnCheap', displayName: 'Only On Cheap', type: 'global_tech', category: 'Energy',
      researchCost: 50, status: 'completed', prerequisites: [], alternatePrerequisites: [], effects: [], unlocks: []
    }
  ];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const projection = techGraph.buildTechPath({ nodes, byId }, byId, ['Project_Target']);

  const satisfiedIds = projection.satisfiedPrerequisites.map(node => node.id);
  assert.deepStrictEqual(satisfiedIds, ['Project_OnlyOnCheap'],
    'only the completed prerequisite on the chosen (cheap) branch belongs to this path');
  assert.strictEqual(projection.satisfiedPrerequisiteTotalCount, 1);
  assert.strictEqual(projection.totalRemainingResearchCost, 110,
    'and the cost of the chosen branch is unchanged by collecting it');
});

templateTest('a path is capped only with the counts that announce it', () => {
  // The deepest node in the live graph carries far fewer satisfied
  // prerequisites than the cap, so nothing is truncated today. What is pinned
  // is that the three fields RECONCILE, which is what makes a future truncation
  // visible rather than silent.
  const projection = techIntel.buildPath(live('player'), 'player', OBSERVER, [PION_TORCH_GATE]);
  assert.strictEqual(
    projection.satisfiedPrerequisites.length + projection.satisfiedPrerequisiteOmittedCount,
    projection.satisfiedPrerequisiteTotalCount,
    'shown + omitted must equal the true total, or a capped list reads as the whole set'
  );
  assert.ok(projection.satisfiedPrerequisites.length <= techGraph.SATISFIED_PREREQUISITE_LIMIT);
});

templateTest('the rolled-availability caveat travels on the payload, not only on the screen', () => {
  for (const mode of MODES) {
    const projection = techIntel.buildPath(live(mode), mode, OBSERVER, [PION_TORCH_GATE]);
    assert.ok(typeof projection.availabilityCaveat === 'string' && projection.availabilityCaveat.length > 0,
      `[${mode}] an agent reading /api/intel/tech-path must see the caveat too`);
    assert.match(projection.availabilityCaveat, /rolled monthly/i);
  }
});

// ---------------------------------------------------------------------------
// 2. THE GATE REACHES THE COMPACT ROW — without it nothing can be clicked
// ---------------------------------------------------------------------------

templateTest('a compact drive row names the gate project the modal opens on', () => {
  for (const mode of MODES) {
    const payload = buildResourceProjection(live(mode), 'drive-explorer', { mode, observerId: OBSERVER, limit: 1000 });
    const gated = payload.items.filter(row => row.availability.gateProjectId);
    assert.ok(gated.length > 0, `[${mode}] most drives are gated; the compact row must carry the gate`);

    for (const row of payload.items) {
      assert.ok(Object.prototype.hasOwnProperty.call(row.availability, 'gateProjectId'),
        `[${mode}] ${row.driveId}: the gate field must be present even when it is null`);
      if (row.availability.gateProjectId === null) {
        // Ungated is a fact about the drive, not a missing value.
        assert.strictEqual(row.availability.state, 'ungated',
          `[${mode}] ${row.driveId}: a null gate must mean ungated, never an unresolved lookup`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 3. THE PANEL — the click affordance, and what the modal says
// ---------------------------------------------------------------------------

/** Loads the panel into its own window, which tests can then stub against. */
function loadPanelSandbox(fetchImpl) {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'drive-explorer.js'), 'utf8');
  const sandbox = {
    console,
    // The SHIPPED bundle, not a hand-copy of its escaper. The copy that used to
    // sit here was faithful, so nothing was wrong with it -- but it was a second
    // thing to keep in step with `public/v2/js/shared.js`, and the harness
    // executes that file rather than reproducing it.
    MissionControlShared: MISSION_CONTROL_SHARED,
    fetch: fetchImpl || (() => Promise.reject(new Error('no network in this test'))),
    URLSearchParams
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'drive-explorer.js' });
  return { panel: sandbox.window.MissionControlDriveExplorer, sandbox };
}

function loadPanel() {
  return loadPanelSandbox().panel;
}

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholders(text, label) {
  for (const token of FORBIDDEN) {
    assert.ok(!new RegExp(`\\b${token.replace(/[[\]]/g, '\\$&')}\\b`).test(text),
      `${label}: "${token}" reached the reader`);
  }
}

templateTest('every drive row carries a real control that opens its path, not a bare <tr>', () => {
  const panel = loadPanel();
  const payload = buildResourceProjection(live('player'), 'drive-explorer',
    { mode: 'player', observerId: OBSERVER, limit: 1000 });
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  panel.render(container, payload);
  const html = container.innerHTML;

  const rowCount = (html.match(/<tr class="de-row/g) || []).length;
  const buttonCount = (html.match(/data-de-path="/g) || []).length;
  assert.ok(rowCount > 0, 'the table must render rows at all');
  assert.strictEqual(buttonCount, rowCount,
    'every rendered row must carry the path control -- a row that responds to nothing is the defect this fixes');
  assert.strictEqual((html.match(/data-de-drive="/g) || []).length, rowCount,
    'and every row must identify which drive it is, so a click on any cell resolves');
  assert.match(html, /<button type="button" class="de-name-btn"/,
    'the control must be a real button, so Enter and Space work without a keydown handler');
  assert.match(html, /aria-label="[^"]*research path[^"]*"/,
    'and it must name what it does for a reader who cannot see the row');
});

templateTest('the modal splits the path into faction projects and global techs, and both reconcile', () => {
  const panel = loadPanel();
  const payload = buildResourceProjection(live('player'), 'drive-explorer',
    { mode: 'player', observerId: OBSERVER, limit: 1000 });
  const row = payload.items.find(entry => entry.availability.gateProjectId === PION_TORCH_GATE);
  assert.ok(row, 'the live save must still carry a drive gated on the Pion Torch project');

  const projection = techIntel.buildPath(live('player'), 'player', OBSERVER, [PION_TORCH_GATE]);
  const options = panel._internals.pathPanelOptions(row, projection);

  const byTitle = new Map(options.sections.map(section => [section.title, section]));
  const factionRemain = projection.remainingPath.filter(node => node.type === 'faction_project').length;
  const globalRemain = projection.remainingPath.filter(node => node.type === 'global_tech').length;
  assert.strictEqual(byTitle.get('FACTION PROJECTS').rows.length, factionRemain);
  assert.strictEqual(byTitle.get('GLOBAL TECHS').rows.length, globalRemain);
  assert.strictEqual(byTitle.get('ALREADY SATISFIED').rows.length, projection.satisfiedPrerequisiteTotalCount);
  assert.ok(byTitle.has('ROUTE CHOSEN'), 'the route actually chosen must be named');

  // The two remaining sections must partition the remaining path exactly: a
  // node in neither would make every count above a quiet lie.
  const sectioned = options.sections
    .filter(section => section.title !== 'ALREADY SATISFIED' && section.title !== 'ROUTE CHOSEN')
    .reduce((total, section) => total + section.rows.length, 0);
  assert.strictEqual(sectioned, projection.remainingPath.length,
    'the sections must partition the remaining path with nothing dropped');

  // The satisfied rows read as done rather than as another thing to research.
  for (const entry of byTitle.get('ALREADY SATISFIED').rows) {
    assert.strictEqual(entry.status, 'DONE');
    assert.strictEqual(entry.statusTone, 'ok');
  }

  const facts = new Map(options.facts.map(fact => [fact.label, fact.value]));
  // Moved 2026-08-22 for the reason recorded on the pinned figures above: the
  // campaign's 200% research speed setting acts on cost.
  assert.match(facts.get('FACTION RESEARCH'), /497,500 RP/);
  assert.match(facts.get('GLOBAL RESEARCH'), /139,702 RP/);
  assert.match(facts.get('TOTAL REMAINING'), /637,202 RP/);
  assert.match(facts.get('ALREADY SATISFIED'), new RegExp(`^${projection.satisfiedPrerequisiteTotalCount} `));
  assert.match(facts.get('GATE PROJECT'), new RegExp(PION_TORCH_GATE));

  // The caveat is on screen, not merely on the payload.
  assert.ok(options.notes.some(note => /rolled monthly/i.test(note)),
    'the rolled-availability caveat must be visible in the modal');

  const text = [options.summary, ...options.notes,
    ...options.sections.flatMap(section => [section.title, section.caption,
      ...section.rows.flatMap(entry => [entry.label, entry.sublabel, entry.status, entry.meta])]),
    ...options.facts.map(fact => `${fact.label} ${fact.value}`)]
    .filter(Boolean).join(' | ');
  assertNoPlaceholders(text, 'the drive path modal');
});

templateTest('a part-researched node shows its progress rather than reading as untouched', () => {
  const panel = loadPanel();
  const payload = buildResourceProjection(live('player'), 'drive-explorer',
    { mode: 'player', observerId: OBSERVER, limit: 1000 });
  const row = payload.items.find(entry => entry.availability.gateProjectId === PION_TORCH_GATE);
  const projection = techIntel.buildPath(live('player'), 'player', OBSERVER, [PION_TORCH_GATE]);

  const researching = projection.remainingPath.filter(node => node.status === 'researching');
  assert.ok(researching.length > 0, 'the live save must have something in progress on this path');

  const options = panel._internals.pathPanelOptions(row, projection);
  const rendered = options.sections.flatMap(section => section.rows);
  for (const node of researching) {
    const entry = rendered.find(candidate => candidate.label === node.displayName);
    assert.ok(entry, `${node.displayName} must appear in a section`);
    assert.match(entry.status, /^RESEARCHING \d+\.\d%$/,
      `${node.displayName} is part-researched, so its progress must be on the row`);
  }
});

test('a never-researchable node makes the total unknown, never a smaller number', () => {
  const panel = loadPanel();
  const row = {
    driveId: 'drive_x',
    displayName: 'Sentinel Drive',
    availability: { bucket: 'researchable', gateProjectId: 'Project_Gate', gateProjectName: 'Gate' }
  };
  const projection = {
    target: { id: 'Project_Gate', displayName: 'Gate', type: 'faction_project' },
    remainingPath: [
      { id: 'Project_Gate', displayName: 'Gate', type: 'faction_project', category: 'Energy', cost: 1000, status: 'locked', progressPercent: 0 },
      { id: 'Project_Never', displayName: 'Never Researched', type: 'faction_project', category: 'Xenology', cost: -1, status: 'locked', progressPercent: 0 }
    ],
    satisfiedPrerequisites: [],
    satisfiedPrerequisiteTotalCount: 0,
    satisfiedPrerequisiteOmittedCount: 0,
    remainingFactionResearchCost: null,
    remainingGlobalResearchCost: 0,
    totalRemainingResearchCost: null,
    researchCostComplete: false,
    uncostedNodes: ['Project_Never'],
    routesEvaluated: [],
    availabilityCaveat: 'Prerequisites met does not mean startable. Availability is rolled monthly.'
  };

  const options = panel._internals.pathPanelOptions(row, projection);
  const facts = new Map(options.facts.map(fact => [fact.label, fact.value]));

  assert.match(facts.get('TOTAL REMAINING'), /UNKNOWN/,
    'a path containing the -1 sentinel has no honest total');
  assert.ok(!/\b1,?000\b/.test(facts.get('TOTAL REMAINING')),
    'and it must never fall back to the sum of the costable nodes');
  assert.strictEqual(facts.get('FACTION RESEARCH'), 'UNKNOWN');

  const sentinelRow = options.sections
    .flatMap(section => section.rows)
    .find(entry => entry.label === 'Never Researched');
  assert.strictEqual(sentinelRow.meta, 'NEVER RESEARCHED',
    '-1 is a sentinel, so it renders as what it means, not as a negative cost or a zero');

  assert.ok(options.notes.some(note => /Project_Never/.test(note)),
    'the uncostable node must be named, not merely counted');
  assert.ok(options.notes.some(note => /rolled monthly/i.test(note)));
});

test('an ungated drive says why there is no path, rather than opening an empty modal', async () => {
  const { panel, sandbox } = loadPanelSandbox();
  const opened = [];
  sandbox.MissionControlDetailPanel = { open: (options) => opened.push(options) };
  panel._internals.state.payload = {
    items: [{
      driveId: 'drive_ungated',
      displayName: 'Ungated Drive',
      availability: { bucket: 'fittable', gateProjectId: null, gateProjectName: null }
    }]
  };

  await panel.openDrivePath('drive_ungated', null);

  assert.strictEqual(opened.length, 1, 'a click on an ungated drive must still open the modal');
  const facts = new Map(opened[0].facts.map(fact => [fact.label, fact.value]));
  assert.match(facts.get('GATE PROJECT'), /names no gating project/,
    'ungated is a fact about the drive, not a missing value');
  assertNoPlaceholders([opened[0].summary, ...opened[0].notes,
    ...opened[0].facts.map(fact => `${fact.label} ${fact.value}`)].join(' | '), 'the ungated modal');
});

test('a failed path fetch opens an honest unavailable modal, never a fabricated empty path', async () => {
  const { panel, sandbox } = loadPanelSandbox(() => Promise.resolve({ ok: false, status: 503 }));
  const opened = [];
  sandbox.MissionControlDetailPanel = { open: (options) => opened.push(options) };
  panel._internals.state.observer = OBSERVER;
  panel._internals.state.mode = 'player';
  panel._internals.state.payload = {
    items: [{
      driveId: 'drive_gated',
      displayName: 'Gated Drive',
      availability: { bucket: 'researchable', gateProjectId: 'Project_Gate', gateProjectName: 'Gate' }
    }]
  };

  await panel.openDrivePath('drive_gated', null);

  assert.strictEqual(opened.length, 1);
  assert.ok(!opened[0].sections, 'no sections may be rendered from a payload that never arrived');
  assert.match(opened[0].summary, /could not be read/);
  assert.ok(opened[0].notes.some(note => /503/.test(note)),
    'the reason the path is unavailable must reach the reader');
});

templateTest('the endpoint carries a real topological order, not a reversed pre-order', () => {
  // The bug this pins: `remainingPath` is a PRE-order walk, so reversing it puts
  // a dependent before its dependency wherever the two are siblings under one
  // parent. Measured on the live save: Project_ExoticHybridSystems needs
  // Project_Exotics, and both hang off the same parent, so the reversed
  // pre-order listed the dependent first.
  for (const mode of MODES) {
    const graph = techGraph.observerGraph(live(mode), mode, OBSERVER);
    const projection = techIntel.buildPath(live(mode), mode, OBSERVER, [PION_TORCH_GATE]);
    const order = projection.remainingPathDependencyOrder;

    assert.ok(Array.isArray(order), `[${mode}] the order must be reported`);
    assert.deepStrictEqual([...order].sort(), projection.remainingPath.map(node => node.id).sort(),
      `[${mode}] the order must name exactly the remaining nodes -- no more, no fewer`);

    // THE PROPERTY, which holds on any save: every prerequisite of a node that
    // is also on the path appears earlier in the order.
    const position = new Map(order.map((id, index) => [id, index]));
    for (const id of order) {
      const node = graph.byId.get(id);
      for (const branch of techGraph.getPrerequisiteBranches(node)) {
        for (const ref of branch) {
          if (!position.has(ref.id)) continue;
          assert.ok(position.get(ref.id) < position.get(id),
            `[${mode}] ${ref.id} is a prerequisite of ${id} but is listed after it`);
        }
      }
    }

    // The reversed pre-order is NOT this order, which is what makes the field
    // necessary rather than a restatement.
    const reversedPreOrder = projection.remainingPath.map(node => node.id).reverse();
    assert.notDeepStrictEqual(order, reversedPreOrder,
      `[${mode}] if these ever agree, re-check whether the field is still earning its place`);
  }
});

test('the modal orders by the endpoint order, and does not mutate what it was handed', () => {
  const panel = loadPanel();
  const emitted = [{ id: 'target' }, { id: 'dependent' }, { id: 'dependency' }];
  const order = ['dependency', 'dependent', 'target'];
  assert.deepStrictEqual(
    panel._internals.inDependencyOrder(emitted, order).map(node => node.id),
    ['dependency', 'dependent', 'target'],
    'the step you can start first is listed first'
  );
  assert.deepStrictEqual(emitted.map(node => node.id), ['target', 'dependent', 'dependency'],
    'and it must not mutate the payload it was handed');

  // A node the order does not mention keeps its emitted position at the end
  // rather than disappearing from the section.
  const withStranger = [{ id: 'target' }, { id: 'stranger' }, { id: 'dependency' }];
  assert.deepStrictEqual(
    panel._internals.inDependencyOrder(withStranger, order).map(node => node.id),
    ['dependency', 'target', 'stranger'],
    'an unordered node is placed last, never dropped');
});

test('research points render as points, and absence renders as absence', () => {
  const { rp } = loadPanel()._internals;
  assert.strictEqual(rp(1300325), '1,300,325 RP');
  assert.strictEqual(rp(0), '0 RP');
  assert.strictEqual(rp(-1), 'NEVER RESEARCHED');
  assert.strictEqual(rp(null), '—');
  assert.strictEqual(rp(undefined), '—');
  assert.strictEqual(rp(''), '—');
});

// ---------------------------------------------------------------------------
// 4. THE SHARED MODAL — one dialog, extended, not a second one
// ---------------------------------------------------------------------------

test('the sections and notes live on the one shared detail panel', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'detail-panel.js'), 'utf8');
  assert.match(source, /id="detailPanelSections"/, 'the shared panel renders the sections itself');
  assert.match(source, /id="detailPanelNotes"/, 'and the caveat notes');

  const driveSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'drive-explorer.js'), 'utf8');
  assert.match(driveSource, /MissionControlDetailPanel/,
    'the drive panel must reuse the shared modal rather than build a second one');
  assert.ok(!/createElement\(['"]dialog['"]\)/.test(driveSource),
    'and it must not construct a dialog of its own');
});

test('an empty section still renders and says so, rather than vanishing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'detail-panel.js'), 'utf8');
  assert.match(source, /detail-panel__empty/,
    'a section with no rows must render its own empty text: a vanished section reads as "not applicable"');
});
