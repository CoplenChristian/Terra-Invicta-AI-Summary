// tests/detailPanel.test.js
//
// Purpose: proves the React shared detail panel is real — that it mounts, that
//   absence renders as absence, that page-wide `inert` is applied and removed
//   for all THREE overlays, and that focus enters and leaves the dialog.
//
// DELIBERATELY THIN. The behaviour this component already had pinned lives in
// `tests/v2Navigation.test.js` (syncPageInert against a fake document, all three
// assertions unchanged) and `tests/drivePathModal.test.js` (the sections/notes
// blocks and the empty-section rule). Nothing here re-characterises those; these
// are only the things a source read and a fake document cannot show.
//
// THE ONE MOST LIKELY TO BREAK SILENTLY is the inert sweep. It is not this
// dialog's own concern: `syncPageInert` marks the TOPBAR, EVERY `.init-view` and
// `main` inert while ANY of `#factionIntelScreen`, `#intelligenceLibraryScreen`
// or `#mcDetailPanel` is open. The first two belong to components already
// migrated to React and are not exercised anywhere else, so all three are opened
// in turn below. Getting it wrong leaves the background keyboard-reachable
// behind a modal, or leaves the page permanently inert after one closes —
// neither shows up in a text diff.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const url = require('node:url');

const {
  getDetailPanelHarnessPage,
  closeDetailPanelHarness,
  consoleErrors,
  readModal,
  readInert,
  openPanel,
  closePanel,
  resetPanel,
  setSiblingOverlay,
} = require('./fixtures/detailPanelBrowser');

const utilsPath = path.join(__dirname, '..', 'src', 'v2', 'panels', 'detailPanelUtils.mjs');
const detailPanelUtils = () => import(url.pathToFileURL(utilsPath).href);

let page;

before(async () => {
  page = await getDetailPanelHarnessPage();
});

after(async () => {
  await closeDetailPanelHarness();
});

const FULL_OPTIONS = {
  eyebrow: 'RESEARCH PATH',
  title: 'Pion Torch',
  summary: 'Everything still to research before this drive can be fitted.',
  facts: [
    { label: 'FACTION RESEARCH', value: '1,300,325 RP' },
    { label: 'TOTAL REMAINING', value: 'UNKNOWN' },
  ],
  sections: [
    {
      title: 'FACTION PROJECTS',
      caption: '2 remaining · 1,300,325 RP',
      rows: [
        { label: 'Antimatter Beam-Core Torch', sublabel: 'via Antimatter Traps', status: 'LOCKED', statusTone: 'block', meta: '900,000 RP' },
        { label: 'Antimatter Traps', status: 'RESEARCHING 41.2%', statusTone: 'warn', meta: '400,325 RP' },
      ],
    },
    { title: 'GLOBAL TECHS', rows: [], empty: 'No global techs remain on this path.' },
  ],
  notes: ['Availability is rolled monthly and a cleared path is not a startable one.'],
  actions: [{ label: 'Close' }],
};

test('the panel mounts, renders its headline content, and takes the page inert', async () => {
  await resetPanel(page);
  await openPanel(page, FULL_OPTIONS);

  const modal = await readModal(page);
  assert.strictEqual(modal.present, true, 'the shell is appended to the document');
  assert.strictEqual(modal.hidden, false, 'and it is open');
  assert.strictEqual(modal.inert, false, 'an open panel is not itself inert');
  assert.strictEqual(modal.ariaHidden, 'false');
  assert.strictEqual(modal.bodyClassOpen, true, 'body carries detail-panel-open so the page cannot scroll behind it');
  assert.strictEqual(modal.eyebrow, 'RESEARCH PATH');
  assert.strictEqual(modal.title, 'Pion Torch');
  assert.strictEqual(modal.summary, 'Everything still to research before this drive can be fitted.');
  assert.deepStrictEqual(modal.facts, [
    { label: 'FACTION RESEARCH', value: '1,300,325 RP' },
    { label: 'TOTAL REMAINING', value: 'UNKNOWN' },
  ]);
  assert.deepStrictEqual(modal.sections.map((section) => section.title), ['FACTION PROJECTS', 'GLOBAL TECHS']);
  assert.strictEqual(modal.sections[0].caption, '2 remaining · 1,300,325 RP');
  assert.deepStrictEqual(modal.sections[0].rows[0], {
    label: 'Antimatter Beam-Core Torch',
    sublabel: 'via Antimatter Traps',
    status: 'LOCKED',
    statusClass: 'detail-panel__status detail-panel__status--block',
    meta: '900,000 RP',
  });
  assert.deepStrictEqual(modal.notes, ['Availability is rolled monthly and a cleared path is not a startable one.']);
  assert.deepStrictEqual(modal.actions, [{ label: 'Close', className: 'init-btn' }]);
  assert.strictEqual(modal.sectionsHidden, false, 'the sections block is shown when there are sections');
  assert.strictEqual(modal.notesHidden, false, 'and the notes block when there are notes');
});

test('absence renders as absence: defaults, dropped rows, an empty section that still says so', async () => {
  await resetPanel(page);
  await openPanel(page, {
    facts: [
      { label: 'MEASURED', value: 0 },
      { label: 'UNMEASURED', value: null },
      { label: 'MISSING' },
    ],
    sections: [
      {
        title: 'ROWS',
        rows: [
          { label: 'has a label', status: 'DONE', statusTone: 'ok' },
          { sublabel: 'no label at all', status: 'DONE' },
          { label: 'unrecognised tone', status: 'ODD', statusTone: 'chartreuse' },
        ],
      },
      { title: 'NOTHING HERE', rows: [] },
    ],
    notes: ['   ', '', 42, null],
  });

  const modal = await readModal(page);
  assert.strictEqual(modal.eyebrow, 'DETAIL', 'an absent eyebrow falls back to the panel default');
  assert.strictEqual(modal.title, 'Operational detail', 'and an absent title to its own');
  assert.strictEqual(modal.summary, null, 'an absent summary renders nothing, not the word null');

  // `0` is a value the caller chose; `null` and an absent key are not, and
  // neither may render as a confident zero or as the text "null"/"undefined".
  assert.deepStrictEqual(modal.facts, [
    { label: 'MEASURED', value: '0' },
    { label: 'UNMEASURED', value: '' },
    { label: 'MISSING', value: '' },
  ]);

  assert.strictEqual(modal.sections[0].rows.length, 2, 'a row with no label is dropped, not rendered blank');
  assert.deepStrictEqual(modal.sections[0].rows.map((row) => row.label), ['has a label', 'unrecognised tone']);
  assert.strictEqual(modal.sections[0].rows[1].statusClass,
    'detail-panel__status detail-panel__status--neutral',
    'an unrecognised tone lands on neutral rather than pasting a class name into the DOM');

  assert.strictEqual(modal.sections[1].empty, 'None.',
    'an empty section still renders and says so: a vanished section reads as "not applicable"');

  assert.deepStrictEqual(modal.notes, [], 'blank and non-string notes are not notes');
  assert.strictEqual(modal.notesHidden, true, 'and the notes block hides rather than leaving an empty rule');

  for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
    assert.ok(!new RegExp(`\\b${token.replace(/[[\]]/g, '\\$&')}\\b`).test(modal.bodyText),
      `no "${token}" reaches the modal text — got: ${modal.bodyText}`);
  }
});

test('syncPageInert applies and removes inert for all three overlays, not just this one', async () => {
  await resetPanel(page);

  const closed = await readInert(page);
  assert.strictEqual(closed.topbar, false, 'topbar is reachable with nothing open');
  assert.strictEqual(closed.main, false, 'and main is never inert while .init-view sections carry it');
  assert.deepStrictEqual(closed.views.map((view) => [view.id, view.inert]),
    [['view-command', false], ['view-records', true]],
    'a hidden view stays inert; the visible one does not');

  // 1. This panel.
  await openPanel(page, FULL_OPTIONS);
  const withPanel = await readInert(page);
  assert.strictEqual(withPanel.topbar, true, 'the topbar goes inert behind the detail panel');
  assert.strictEqual(withPanel.main, false, 'main stays reachable; the views inside it carry inert instead');
  assert.ok(withPanel.views.every((view) => view.inert),
    'EVERY view goes inert behind the detail panel, the visible one included');

  await closePanel(page);
  const afterPanel = await readInert(page);
  assert.strictEqual(afterPanel.topbar, false, 'and the topbar comes back when it closes');
  assert.deepStrictEqual(afterPanel.views.map((view) => view.inert), [false, true],
    'each view returns to inert-iff-hidden, not left permanently inert');

  // 2 and 3. The two sibling overlays, whose section ids this selector keys on.
  for (const id of ['factionIntelScreen', 'intelligenceLibraryScreen']) {
    await setSiblingOverlay(page, id, true);
    const open = await readInert(page);
    assert.strictEqual(open.topbar, true, `the topbar goes inert behind #${id}`);
    assert.strictEqual(open.main, false, `main is not marked inert behind #${id}`);
    assert.ok(open.views.every((view) => view.inert), `every view goes inert behind #${id}`);

    await setSiblingOverlay(page, id, false);
    const shut = await readInert(page);
    assert.strictEqual(shut.topbar, false, `the topbar comes back when #${id} closes`);
    assert.deepStrictEqual(shut.views.map((view) => view.inert), [false, true],
      `views return to inert-iff-hidden when #${id} closes`);
  }
});

test('focus enters the dialog on open and returns to the trigger on Escape', async () => {
  await resetPanel(page);
  await page.focus('#detailPanelHarnessTrigger');
  await page.click('#detailPanelHarnessTrigger');
  await page.waitForSelector('#mcDetailPanel:not([hidden])', { timeout: 10000 });

  const opened = await readModal(page);
  assert.strictEqual(opened.activeElement, 'BUTTON[data-detail-close]',
    'open() moves focus onto the Close button before it returns');

  await page.keyboard.press('Escape');
  await page.waitForSelector('#mcDetailPanel[hidden]', { state: 'attached', timeout: 10000 });

  const shut = await readModal(page);
  assert.strictEqual(shut.hidden, true, 'Escape closes it');
  assert.strictEqual(shut.inert, true, 'a closed panel is inert so nothing inside it is tabbable');
  assert.strictEqual(shut.ariaHidden, 'true');
  assert.strictEqual(shut.bodyClassOpen, false);
  assert.strictEqual(shut.activeElement, 'BUTTON#detailPanelHarnessTrigger',
    'and focus goes back to whatever opened it, not to the body');
  assert.strictEqual(shut.title, opened.title,
    'a closed panel keeps what it last said rather than blanking itself');
  assert.ok(opened.title && opened.title.length > 0, 'and it had something to say');
});

test('an action closes by default, keeps the panel open when close is false, and logs nothing', async () => {
  await resetPanel(page);

  const stayed = await page.evaluate(() => {
    const calls = [];
    window.MissionControlDetailPanel.open({
      title: 'Actions',
      actions: [
        { label: 'Stay', close: false, onClick: () => calls.push('stay') },
        { label: 'Go', primary: true, onClick: () => calls.push('go') },
      ],
    });
    const buttons = Array.from(document.querySelectorAll('#detailPanelActions button'));
    buttons[0].click();
    const afterStay = document.getElementById('mcDetailPanel').hidden;
    buttons[1].click();
    const afterGo = document.getElementById('mcDetailPanel').hidden;
    return { afterStay, afterGo, calls, classes: buttons.map((b) => b.className) };
  });

  assert.strictEqual(stayed.afterStay, false, '`close: false` leaves the panel open for its own handler');
  assert.strictEqual(stayed.afterGo, true, 'and the default closes it');
  assert.deepStrictEqual(stayed.calls, ['stay', 'go'], 'both handlers ran');
  assert.deepStrictEqual(stayed.classes, ['init-btn', 'init-btn init-btn-cyan'],
    'primary actions carry the cyan modifier and the rest do not');

  assert.deepStrictEqual(consoleErrors(), [],
    'no console errors across the whole session — React warnings would fail scripts/verify_drive_path_modal.js');
});

test('with no .init-view sections there is nothing finer to mark, so main itself is toggled', async () => {
  // The other branch of syncPageInert, which the real shell and the harness both
  // take the first half of. A page without views must still become unreachable
  // behind a modal, or the branch is dead code that silently protects nothing.
  const { syncPageInert } = await detailPanelUtils();

  let mainInert = false;
  let overlayOpen = false;
  const fakeDoc = {
    querySelector: (sel) => {
      if (sel.includes(':not([hidden])')) return overlayOpen ? { id: 'mcDetailPanel' } : null;
      if (sel === 'main') {
        return {
          removeAttribute: (attr) => { if (attr === 'inert') mainInert = false; },
          toggleAttribute: (attr, val) => { if (attr === 'inert') mainInert = Boolean(val); },
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };

  syncPageInert(fakeDoc);
  assert.strictEqual(mainInert, false, 'main is reachable with nothing open');

  overlayOpen = true;
  syncPageInert(fakeDoc);
  assert.strictEqual(mainInert, true, 'main itself goes inert when there are no views to mark');

  overlayOpen = false;
  syncPageInert(fakeDoc);
  assert.strictEqual(mainInert, false, 'and comes back when the overlay closes');
});
