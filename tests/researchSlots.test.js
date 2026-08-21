// Research advisor, phase 5: slot allocation. Spec sections 0 and 6.
//
// The rule this file exists to hold is a NEGATIVE one, and it is the whole
// point of the phase: the wiki's allocation formula does not reproduce the
// observer's measured research delivery, so no reallocation is recommended.
// The tests below pin the measured half (which slot holds what, which slots
// carry pips, which holdings receive nothing) and pin the refusal, so a later
// change cannot quietly start offering an optimisation the model cannot
// support.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');
const { buildResourceProjection } = require('../shared/intel/registry.mjs');
const {
  ALLOCATION_MODEL,
  SLOT_INDEX_PIN,
  SLOT_KINDS,
  buildResearchSlotAllocation
} = require('../shared/researchSlots.mjs');

const OBSERVER = 4712;

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

/**
 * A hand-built snapshot in the shape the projection consumes.
 *
 * Deliberately literal rather than derived from the save pipeline: this module
 * is a join between three save fields by slot index, and a fixture that hides
 * the indices would not test the join.
 */
function snapshotWith({ weights, techSlots = [], projects = [], research = 3150 } = {}) {
  return {
    factions: [{
      ID: OBSERVER,
      displayName: 'the Initiative',
      totalResearch: research,
      researchWeights: weights,
      currentProjects: projects
    }],
    globalResearch: { activeSlots: techSlots }
  };
}

/** The observer's live layout on ExitSave, reduced to the fields that matter. */
const LIVE_LAYOUT = Object.freeze({
  weights: [0, 0, 3, 3, 3, 0],
  techSlots: [
    { techId: 'ColonyHabs', displayName: 'Colony Habs', category: 'LifeScience', totalCost: 35000, contributions: [{ factionId: OBSERVER, contribution: 0 }] },
    { techId: 'AdministrationAlgorithms', displayName: 'Administration Algorithms', category: 'InformationScience', totalCost: 50000, contributions: [{ factionId: OBSERVER, contribution: 0 }] },
    { techId: 'Coilguns', displayName: 'Coilguns', category: 'MilitaryScience', totalCost: 30000, contributions: [{ factionId: OBSERVER, contribution: 10220 }] }
  ],
  projects: [
    { projectId: 'Project_PherocyteResistance', displayName: 'Pherocyte Resistance', slot: 3, category: 'Xenology', accumulatedResearch: 11037, totalCost: 30000, percent: 36.8 },
    { projectId: 'Project_FusionReactorArray', displayName: 'Fusion Reactor Array', slot: 4, category: 'Energy', accumulatedResearch: 1147, totalCost: 5000, percent: 22.9 },
    { projectId: 'Project_AudienceResearch', displayName: 'Audience Research', slot: 5, category: 'SocialScience', accumulatedResearch: 43, totalCost: 100, percent: 42.5 },
    { projectId: 'Project_OperationsResearch', displayName: 'Operations Research', slot: 7, category: 'SocialScience', accumulatedResearch: 23, totalCost: 100, percent: 22.8 }
  ]
});

const live = () => buildResearchSlotAllocation(snapshotWith(LIVE_LAYOUT), { observerId: OBSERVER });

// ---------------------------------------------------------------------------
// THE MEASURED HALF
// ---------------------------------------------------------------------------

test('weights join to tech slots and projects by slot index, in that index space', () => {
  const result = live();
  assert.equal(result.available, true);
  assert.equal(result.slotCount, 6);
  assert.equal(result.totalPips, 9);
  assert.equal(result.slotsWithPips, 3);

  // Indices 0-2 are the global tech slots, in the order the save lists them.
  assert.equal(result.slots[0].kind, SLOT_KINDS.globalTech);
  assert.equal(result.slots[2].displayName, 'Coilguns');
  assert.equal(result.slots[2].pips, 3);
  assert.equal(result.slots[2].category, 'MilitaryScience');
  // A global tech slot reports the OBSERVER's contribution, not the world total.
  assert.equal(result.slots[2].accumulatedResearch, 10220);

  // Indices 3+ are projects, each at the slot the save states.
  assert.equal(result.slots[3].kind, SLOT_KINDS.project);
  assert.equal(result.slots[3].displayName, 'Pherocyte Resistance');
  assert.equal(result.slots[4].displayName, 'Fusion Reactor Array');
  assert.equal(result.slots[5].displayName, 'Audience Research');
});

test('pip share is the share of PIPS and says so, not the share of research', () => {
  const result = live();
  assert.equal(result.slots[2].pipShare, 0.333333, 'rounded, never a raw repeating float');
  assert.equal(result.slots[0].pipShare, 0);
  assert.match(result.slots[2].pipShareBasis, /NOT the share of research/);
});

test('a slot that holds something with no pips is reported as receiving nothing', () => {
  const result = live();
  // Two global techs and one project on this layout.
  assert.equal(result.occupiedWithoutPips, 3);
  assert.match(result.slots[0].idleReason, /receives no research/);
  assert.equal(result.slots[2].idleReason, null);
});

test('pips with nothing to spend them on is a different fact from an unpipped holding', () => {
  const result = buildResearchSlotAllocation(
    snapshotWith({ weights: [2, 0], techSlots: [], projects: [] }),
    { observerId: OBSERVER }
  );
  assert.equal(result.pipsWithoutOccupant, 1);
  assert.equal(result.occupiedWithoutPips, 0);
  assert.match(result.slots[0].idleReason, /holds nothing/);
});

test('a project beyond the weighted slots is surfaced as queued, not researching', () => {
  const result = live();
  assert.equal(result.unweightedOccupantCount, 1);
  assert.equal(result.unweightedOccupants[0].index, 7);
  assert.equal(result.unweightedOccupants[0].displayName, 'Operations Research');
  assert.match(result.unweightedOccupantNote, /queued, not researching/);
  // And it is NOT smuggled into the weighted list.
  assert.equal(result.slots.length, 6);
});

// ---------------------------------------------------------------------------
// ABSENT STAYS NULL
// ---------------------------------------------------------------------------

test('a snapshot with no weights says so rather than reporting an empty layout', () => {
  const result = buildResearchSlotAllocation(snapshotWith({ weights: null }), { observerId: OBSERVER });
  assert.equal(result.available, false);
  assert.match(result.reason, /carries no research slot weights/);
  assert.deepEqual(result.slots, []);
  // Not "0 of 0 slots": an unread layout has no slot count at all.
  assert.equal(result.slotCount, null);
  assert.equal(result.totalPips, null);
});

test('a weight the save does not carry stays unknown, and never becomes zero pips', () => {
  const result = buildResearchSlotAllocation(
    snapshotWith({ weights: [3, null, 0] }),
    { observerId: OBSERVER }
  );
  assert.equal(result.slots[1].pips, null);
  assert.equal(result.slots[1].carriesPips, null, 'unknown is not "no pips"');
  assert.equal(result.slots[1].pipShare, null, 'and an unknown pip count yields no share');
  assert.equal(result.slots[2].carriesPips, false, 'a measured zero still reads as a measured zero');
});

test('an observer the snapshot does not carry reports that, not a blank layout', () => {
  const result = buildResearchSlotAllocation(snapshotWith(LIVE_LAYOUT), { observerId: 9999 });
  assert.equal(result.available, false);
  assert.match(result.reason, /not present in this snapshot/);
});

test('two occupants claiming one slot is reported, never silently resolved', () => {
  const result = buildResearchSlotAllocation(snapshotWith({
    weights: [3, 3],
    techSlots: [{ techId: 'A', displayName: 'Tech A', contributions: [] }],
    // A project claiming slot 0, which the tech slot already holds.
    projects: [{ projectId: 'P', displayName: 'Project P', slot: 0 }]
  }), { observerId: OBSERVER });
  assert.equal(result.slotIndexCollisions.length, 1);
  assert.equal(result.slotIndexCollisions[0].index, 0);
  assert.match(result.slotIndexCollisionNote, /does not hold here/);
  // The first occupant is kept and the second is not silently overwritten.
  assert.equal(result.slots[0].displayName, 'Tech A');
});

// ---------------------------------------------------------------------------
// SECTION 0: NOTHING CAMPAIGN-SPECIFIC
// ---------------------------------------------------------------------------

test('turn one: no pips anywhere renders as that, not as a missing section', () => {
  const result = buildResearchSlotAllocation(snapshotWith({
    weights: [0, 0, 0, 0, 0, 0],
    techSlots: [{ techId: 'T', displayName: 'A World Tech', category: 'Energy', contributions: [] }],
    projects: [],
    research: 0
  }), { observerId: OBSERVER });
  assert.equal(result.available, true);
  assert.equal(result.slotsWithPips, 0);
  assert.equal(result.totalPips, 0);
  // Zero total pips must not divide.
  for (const slot of result.slots) assert.equal(slot.pipShare, null);
  assert.equal(result.occupiedWithoutPips, 1);
});

test('the slot count and the tech-slot count come from the data, never from a constant', () => {
  // Four tech slots and an eight-entry weight array: a shape no save checked
  // has, and the module must still report it at its own size.
  const result = buildResearchSlotAllocation(snapshotWith({
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
    techSlots: [0, 1, 2, 3].map(index => ({
      techId: `T${index}`, displayName: `Tech ${index}`, contributions: []
    })),
    projects: [{ projectId: 'P', displayName: 'A Project', slot: 4 }]
  }), { observerId: OBSERVER });
  assert.equal(result.slotCount, 8);
  assert.equal(result.slots.filter(slot => slot.kind === SLOT_KINDS.globalTech).length, 4);
  assert.equal(result.slots[4].kind, SLOT_KINDS.project);
  assert.equal(result.slots[7].kind, SLOT_KINDS.empty);
});

// ---------------------------------------------------------------------------
// THE REFUSAL
// ---------------------------------------------------------------------------

test('no reallocation is recommended, and the payload carries why', () => {
  for (const result of [live(), buildResearchSlotAllocation(snapshotWith({ weights: null }), { observerId: OBSERVER })]) {
    assert.equal(result.recommendation.offered, false);
    assert.match(result.recommendation.reason, /does not reproduce/);
  }
});

test('the allocation model is marked unvalidated and names what it could not reproduce', () => {
  assert.equal(ALLOCATION_MODEL.validatedAgainstGameOutput, false);
  assert.equal(ALLOCATION_MODEL.reproducesObservedDelivery, false);
  assert.equal(ALLOCATION_MODEL.termsWithNoShippedSource.length, 3);
  assert.match(ALLOCATION_MODEL.reproduction.findings.join(' '), /1\.147x .*0\.993x/);
  assert.match(ALLOCATION_MODEL.reproduction.findings.join(' '), /-0\.209/);
  // The half that DID reproduce is recorded beside the half that did not, so
  // the refusal is a measurement and not a shrug.
  assert.match(ALLOCATION_MODEL.reproduction.whatDidReproduce, /2\.26216/);
});

test('the slot index mapping is the pinned claim, and it is marked as pinned', () => {
  assert.equal(SLOT_INDEX_PIN.validatedAgainstGameOutput, true);
  assert.equal(SLOT_INDEX_PIN.agreements.length, 7);
  assert.match(SLOT_INDEX_PIN.method, /two consecutive 15\.5-day intervals/);
});

// ---------------------------------------------------------------------------
// THROUGH THE PIPELINE
// ---------------------------------------------------------------------------

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

const saveWithWeights = () => makeSaveData({
  factionOptions: {
    [OBSERVER]: {
      researchWeights: [0, 3, 2],
      currentProjects: [{ projectTemplateName: 'Project_NanotubeArmor', accumulatedResearch: 120, slot: 1 }]
    },
    // The rivals carry a layout too, or the redaction test below has nothing
    // to redact and passes whatever the filter does.
    4713: { researchWeights: [3, 3, 3] },
    4717: { researchWeights: [1, 0, 0] }
  }
});

test('the snapshot carries the pip weights and each project\'s slot', () => {
  const snapshot = filtered(saveWithWeights(), 'omniscient');
  const observer = snapshot.factions.find(faction => faction.ID === OBSERVER);
  assert.deepEqual(observer.researchWeights, [0, 3, 2]);
  assert.equal(observer.currentProjects[0].slot, 1);
  assert.equal(observer.currentProjects[0].category, 'Materials');
});

test('player mode redacts every other faction\'s pip layout, as null and never as []', () => {
  // The rivals really do carry a layout in omniscient mode, so the assertion
  // below has something to catch.
  const omniscient = filtered(saveWithWeights(), 'omniscient');
  assert.deepEqual(omniscient.factions.find(faction => faction.ID === 4713).researchWeights, [3, 3, 3]);

  const snapshot = filtered(saveWithWeights(), 'player');
  const observer = snapshot.factions.find(faction => faction.ID === OBSERVER);
  assert.deepEqual(observer.researchWeights, [0, 3, 2], 'the observer keeps their own');
  for (const faction of snapshot.factions) {
    if (faction.ID === OBSERVER) continue;
    assert.equal(faction.researchWeights, null,
      `${faction.ID}: an enemy reported with an empty weight array reads as assigning no research`);
  }
  // And the filter's own leak assertion agrees.
  assert.equal(intelligenceFilter.assertPlayerSnapshotSafe(snapshot), true);
});

test('the ranking endpoint carries the slot block in both modes', () => {
  for (const mode of ['player', 'omniscient']) {
    const result = buildResourceProjection(filtered(saveWithWeights(), mode), 'research-ranking', {
      mode, observerId: OBSERVER
    });
    assert.equal(result.slots.available, true, `${mode}: the slot block must answer`);
    assert.equal(result.slots.slotCount, 3);
    assert.equal(result.slots.recommendation.offered, false);
  }
});

test('a snapshot published before phase 5 degrades to a stated reason, not a crash', () => {
  // makeSaveData without researchWeights is exactly an older published row.
  const snapshot = filtered(makeSaveData({}), 'player');
  const result = buildResourceProjection(snapshot, 'research-ranking', { mode: 'player', observerId: OBSERVER });
  assert.equal(result.slots.available, false);
  assert.match(result.slots.reason, /re-publish/i);
});

// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------

const componentPath = path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'research-advisor.js');

function loadComponent() {
  const sandbox = { window: {}, console, fetch: () => Promise.resolve(null) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(componentPath, 'utf8'), sandbox, { filename: componentPath });
  return sandbox.window.MissionControlResearchAdvisor;
}

function renderToString(payload) {
  const root = { innerHTML: '', querySelector: () => null };
  loadComponent().render(root, payload);
  return root.innerHTML;
}

const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const PANEL_BASE = {
  success: true,
  sources: {
    propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true }
  },
  research: { monthlyResearchIncome: 3150 },
  ordering: { deficitApplied: false },
  deficit: { applied: false, capability: { canContest: 'unknown' } },
  military: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, groups: [] },
  economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
};

test('the card states the allocation on the line it already had, adding no height', () => {
  const html = renderToString({ ...PANEL_BASE, slots: live() });
  const text = visibleText(html);
  assert.match(text, /3\/6 slots weighted/);
  assert.match(text, /4 idle/, 'three unpipped holdings plus the one beyond the weighted slots');
  // One foot line, not two: the COMMAND column has no height to spend.
  assert.equal((html.match(/class="ra-foot"/g) || []).length, 1);
  for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
    assert.ok(!text.includes(token), `rendered text contains "${token}"`);
  }
});

test('an unavailable slot block leaves the income line alone rather than inventing zeros', () => {
  const html = renderToString({
    ...PANEL_BASE,
    slots: buildResearchSlotAllocation(snapshotWith({ weights: null }), { observerId: OBSERVER })
  });
  const text = visibleText(html);
  assert.ok(!/slots weighted/.test(text), 'no allocation claim is made when none could be read');
  assert.match(text, /3,150 research\/mo/);
});
