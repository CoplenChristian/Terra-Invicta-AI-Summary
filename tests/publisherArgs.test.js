const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, applyTechTreeMode, techGraphFingerprint } = require('../scripts/push_latest_to_supabase');

test('publisher parser rejects unknown flags and conflicting tech-tree modes', () => {
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
  assert.throws(() => parseArgs(['--omit-tech-tree', '--inline-tech-tree']), /mutually exclusive/);
  assert.throws(() => parseArgs(['--observer', 'bad']), /positive integer/);
});

test('publisher parser exposes explicit tech-tree modes', () => {
  assert.equal(parseArgs(['--inline-tech-tree']).shareTechGraph, false);
  assert.equal(parseArgs(['--omit-tech-tree']).omitTechTree, true);
  const omitted = applyTechTreeMode({ techTree: { nodes: [{ id: 'x' }] }, value: 1 }, { omitTechTree: true, shareTechGraph: false }, 'tg:1:x');
  assert.equal(omitted.techTree, undefined);
  assert.deepEqual(omitted.techTreeRef, { omitted: true, nodeCount: 1, reason: 'static template data omitted by --omit-tech-tree' });
});

test('tech graph fingerprint includes content beyond node ids', () => {
  const base = {
    nodes: [{ id: 'Tech_A', prerequisites: [], researchCost: 100 }],
    categories: { Tech_A: 'energy' },
    unlockClasses: { Tech_A: ['reactor'] }
  };
  const changed = {
    ...base,
    nodes: [{ ...base.nodes[0], researchCost: 101 }]
  };
  assert.notEqual(techGraphFingerprint(base), techGraphFingerprint(changed));
  assert.equal(techGraphFingerprint(base), techGraphFingerprint({
    unlockClasses: base.unlockClasses,
    categories: base.categories,
    nodes: base.nodes
  }));
});
