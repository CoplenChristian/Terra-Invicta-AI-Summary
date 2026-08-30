// tests/researchAdvisorRendering.test.js
//
// Purpose: the minimum browser coverage that proves the React research advisor
//   is the panel that actually renders — the production mount, the strangler
//   global, the drill-down button, register defect #5, and the one figure the
//   vanilla's own suite never reached in its absent state.
//
// DELIBERATELY THIN. `tests/researchRanking.test.js` (63 tests) and
// `tests/researchSlots.test.js` (2 panel tests) already characterise this panel
// against the same browser harness, and every one of their assertions survived
// the migration unchanged. This file covers only what those cannot:
//
//   1. THE PRODUCTION MOUNT. Both existing files render into the bench root
//      `#research-advisor-test-root`. Nothing they assert would fail if the
//      panel never reached `#researchAdvisor`, which is the id
//      public/v2/index.html owns and the VIEWS registry drives.
//   2. WHICH IMPLEMENTATION IS LIVE. `public/v2/js/components/research-advisor.js`
//      is deleted and its <script> tag removed, so the global can only come from
//      the React bundle. A half-migration that left both in place is the failure
//      mode the migration protocol names first, and it is invisible to every
//      output assertion because both implementations produce the same text.
//   3. THE `Full ranking` BUTTON. The vanilla wired it with `addEventListener`
//      after setting `innerHTML`; `docs/react-component-contracts.md:111` records
//      that NOTHING covered `render`, and nothing covered the click either.
//   4. REGISTER DEFECT #5, on the live save rather than on a hand-built four-group
//      fixture — `tests/researchRanking.test.js` pins the sentence, this pins that
//      the sentence is reached by the real payload and that its counts are read
//      from it.
//   5. THE ABSENT RESEARCH INCOME at the foot. `Number(null) === 0` would print
//      "0 research/mo"; the honest state is a sentence saying no completion times
//      can be shown.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildResourceProjection } = require('../shared/intel/registry.mjs');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const {
  getResearchAdvisorHarnessPage,
  closeResearchAdvisorHarness,
  withResearchAdvisorHarnessPage,
  renderResearchAdvisorOnPage,
  getProductionMountHtml,
  openFullRankingByClick,
  visibleText,
} = require('./fixtures/researchAdvisorBrowser');

const OBSERVER = 4712;
const GROUPS_SHOWN = 2;
const repoRoot = path.resolve(__dirname, '..');

after(async () => { await closeResearchAdvisorHarness(); });

const live = (mode) => buildResourceProjection(
  loadFixtureFilteredSnapshot({ mode, observer: OBSERVER }),
  'research-ranking',
  { mode, observerId: OBSERVER, limit: 6 },
);

async function render(payload) {
  const page = await getResearchAdvisorHarnessPage();
  const html = await renderResearchAdvisorOnPage(page, payload);
  return { html, text: visibleText(html) };
}

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

async function readAdvisorRows(payload) {
  const page = await getResearchAdvisorHarnessPage();
  await renderResearchAdvisorOnPage(page, payload);
  return page.evaluate(() => [...document.querySelectorAll(
    '#research-advisor-test-root .ra-row',
  )].map((row) => ({
    name: row.querySelector('.ra-row__name')?.textContent.replace(/\s+/g, ' ').trim(),
    metricValues: [...row.querySelectorAll('.ra-row__metric [data-primitive="value"]')]
      .map((value) => ({
        state: value.dataset.valueState,
        text: value.textContent,
      })),
  })));
}

async function readDeficitValues(payload) {
  const page = await getResearchAdvisorHarnessPage();
  await renderResearchAdvisorOnPage(page, payload);
  return page.evaluate(() => [...document.querySelectorAll(
    '#research-advisor-test-root .ra-deficit.is-gap [data-primitive="value"]',
  )].map((value) => ({
    state: value.dataset.valueState,
    text: value.textContent,
  })));
}

test('the panel mounts on the production id and paints both rankings', async () => {
  // Seeded through `window.__RESEARCH_ADVISOR_PAYLOAD__` into #researchAdvisor,
  // which is the element public/v2/index.html declares and mission-control.js
  // resolves — not the bench root the ported suites use.
  await withResearchAdvisorHarnessPage(live('player'), async (page) => {
    const html = await getProductionMountHtml(page);
    const text = visibleText(html);

    assert.match(html, /class="research-advisor"/,
      'the mount must hold the panel root the three verify scripts select on');
    assert.match(text, /MILITARY RESEARCH/);
    assert.match(text, /ECONOMIC/);
    assert.match(text, /ranked/, 'the census reaches the production mount too');
    assert.match(text, /research\/mo/, 'and so does the foot line');
    assert.ok(!text.includes('LOADING RESEARCH RANKING'),
      'the shell\'s loading copy must be replaced, not rendered beside the panel');
    for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
      assert.ok(!text.includes(token), `production mount rendered "${token}"`);
    }
  });
});

test('the React bundle is the only thing that can supply MissionControlResearchAdvisor', async () => {
  // On disk: the vanilla is gone and nothing loads it.
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'public', 'v2', 'js', 'components', 'research-advisor.js')),
    'the vanilla component file must be deleted, or two implementations race for one global',
  );
  const shell = fs.readFileSync(path.join(repoRoot, 'public', 'v2', 'index.html'), 'utf8');
  assert.ok(!shell.includes('/v2/js/components/research-advisor.js'));
  assert.ok(shell.includes('/v2/app/bundle.js'));
  const main = fs.readFileSync(path.join(repoRoot, 'src', 'v2', 'main.jsx'), 'utf8');
  assert.match(main, /window\.MissionControlResearchAdvisor\s*=/,
    'the React entry point must assign the global mission-control.js already calls');

  // In the browser: what renders carries the React primitives' own marker. The
  // vanilla emitted no `data-primitive` attribute anywhere, so this cannot pass
  // against it — which is what makes it a proof of which one is live rather
  // than a restatement of the text assertions.
  const { html } = await render(live('player'));
  assert.match(html, /data-primitive="value"/,
    'the figures must render through <Value>, which only the React panel emits');
});

test('the Full ranking button hands the drill-down to the shared detail panel', async () => {
  const page = await getResearchAdvisorHarnessPage();
  const opened = await openFullRankingByClick(page, live('player'));

  assert.equal(opened.length, 1, 'exactly one detail panel open call');
  const options = opened[0];
  assert.equal(options.eyebrow, 'RESEARCH ADVISOR');
  assert.equal(options.title, 'Full research ranking');
  assert.ok(Array.isArray(options.facts) && options.facts.length > 0);
  assert.ok(options.facts.some(fact => fact.label === 'REALLOCATION'),
    'the slot facts must ride in with the ranking facts');
  assert.ok(options.facts.some(fact => /^MILITARY RESEARCH · /.test(fact.label)),
    'and the military rows must be there, which is the whole point of the drill-down');
  for (const fact of options.facts) {
    assert.ok(!/\bnull\b|\bundefined\b|\bNaN\b/.test(fact.value),
      `${fact.label}: a drill-down fact printed a placeholder token — ${fact.value}`);
  }
});

test('defect #5: the live save\'s dropped availability groups are counted on screen', async () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = live(mode);
    const populated = (payload.military.groups || []).filter(group => group.items.length > 0);
    // Non-vacuity: if the live save ever stops overflowing the cap this test
    // must fail loudly rather than pass by having nothing to omit.
    assert.ok(populated.length > GROUPS_SHOWN,
      `${mode}: the live save must have more populated groups than the card shows, or this test proves nothing`);

    const { html, text } = await render(payload);
    const omitted = populated.length - GROUPS_SHOWN;
    assert.ok(
      text.includes(`Showing ${GROUPS_SHOWN} of ${populated.length} availability groups; `
        + `${omitted} further group${omitted === 1 ? ' is' : 's are'} omitted from this view.`),
      `${mode}: the cap must state its own total and omitted counts; got: ${text}`,
    );
    // Through <TruncationNote>, so the counts are the primitive's and not a
    // sentence a later edit could leave behind when the cap changes.
    assert.match(html, /data-truncation-state="truncated"/,
      `${mode}: the omission note must be a TruncationNote, not hand-rolled copy`);

    // And the omitted groups' rows are genuinely absent, which is what makes
    // the note necessary rather than decorative.
    for (const group of populated.slice(GROUPS_SHOWN)) {
      for (const row of group.items) {
        const lead = String(row.gateProjectName || row.displayName || '');
        if (!lead) continue;
        assert.ok(!text.includes(lead),
          `${mode}: ${lead} is in an omitted group and must not be on the card`);
      }
    }
  }
});

test('an unmeasured research income says so instead of rendering a confident zero', async () => {
  const payload = live('player');
  const { text: measured } = await render(payload);
  assert.match(measured, /[\d,]+ research\/mo/, 'the measured case still prints the figure');

  // `Number(null) === 0`, so the failure mode here is "0 research/mo" — a
  // measured claim about an unmeasured quantity.
  const unmeasured = { ...payload, research: { ...payload.research, monthlyResearchIncome: null } };
  const { text } = await render(unmeasured);
  assert.match(text, /research income not measurable — no completion times shown/,
    'an absent income is named, not zeroed');
  assert.ok(!/\b0 research\/mo/.test(text), 'and never rendered as a measured zero');

  // The same for an absent slot block: the foot shows the income alone rather
  // than inventing "0 of 0 slots".
  const noSlots = { ...payload, slots: { available: false, reason: 're-publish the save' } };
  const { text: withoutSlots } = await render(noSlots);
  assert.ok(!/slots weighted/.test(withoutSlots),
    'no allocation claim is made when none could be read');
});

test('military metric presence is independent for each candidate row', async () => {
  const payload = clonePayload(live('player'));
  const sourceGroup = payload.military.groups.find((group) => group.items.length > 0);
  const sourceRow = sourceGroup.items[0];
  const makeRow = (id, displayName, improvementMultiple) => ({
    ...sourceRow,
    id,
    displayName,
    gateProjectName: null,
    chain: null,
    chainPromoted: false,
    isZeroCost: false,
    improvementMultiple,
    isFirstInClass: false,
  });
  payload.military.groups = [{
    ...sourceGroup,
    state: 'researchable-now',
    label: 'Researchable now',
    count: 2,
    items: [
      makeRow('military:missing-multiple', 'Missing military metric', null),
      makeRow('military:measured-multiple', 'Measured military metric', 2),
    ],
  }];

  const rows = await readAdvisorRows(payload);
  const byName = new Map(rows.map((row) => [row.name, row.metricValues]));
  assert.deepEqual(byName.get('Missing military metric'), [
    { state: 'absent', text: '—' },
  ]);
  assert.deepEqual(byName.get('Measured military metric'), [
    { state: 'measured', text: '2.00×' },
  ]);
});

test('economic metric presence is independent for each candidate row', async () => {
  const payload = clonePayload(live('player'));
  const sourceUnit = payload.economic.units.find((unit) => unit.groups.some((group) => group.items.length > 0));
  const sourceGroup = sourceUnit.groups.find((group) => group.items.length > 0);
  const sourceRow = sourceGroup.items[0];
  const makeRow = (id, displayName, monthlyValue) => ({
    ...sourceRow,
    id,
    displayName,
    unit: 'tonnes/month',
    monthlyValue,
  });
  payload.economic.units = [{
    ...sourceUnit,
    unit: 'tonnes/month',
    count: 2,
    groups: [{
      ...sourceGroup,
      state: 'researchable-now',
      label: 'Researchable now',
      count: 2,
      items: [
        makeRow('economic:missing-value', 'Missing economic metric', null),
        makeRow('economic:measured-value', 'Measured economic metric', 12),
      ],
    }],
  }];

  const rows = await readAdvisorRows(payload);
  const byName = new Map(rows.map((row) => [row.name, row.metricValues]));
  assert.deepEqual(byName.get('Missing economic metric'), [
    { state: 'absent', text: '—' },
  ]);
  assert.deepEqual(byName.get('Measured economic metric'), [
    { state: 'measured', text: '+12 t/mo' },
  ]);
});

test('deficit figures keep gap, ours, and alien presence independent', async () => {
  const payload = clonePayload(live('player'));
  payload.deficit = {
    ...payload.deficit,
    applied: true,
    axisLabel: 'output per tonne',
    unit: 'GW/t',
    ratio: null,
    own: 4,
    alien: null,
  };

  assert.deepEqual(await readDeficitValues(payload), [
    { state: 'absent', text: '—' },
    { state: 'measured', text: '4.0 GW/t' },
    { state: 'absent', text: '—' },
  ]);
});
