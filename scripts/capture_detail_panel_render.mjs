/**
 * Capture DetailPanel rendered surface for zero-change diffing (defect #21 slice 7).
 * Run: node scripts/capture_detail_panel_render.mjs [--out path.json]
 *
 * Purpose: one-off Playwright capture of DetailPanel innerText, geometry and
 *   computed style across enumerated payload branches for before/after diffs.
 */
import http from 'node:http';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.NODE_ENV = 'test';
process.chdir(ROOT);

const { ensurePrimitivesHarnessBuilt } = require('../tests/fixtures/ensurePrimitivesHarness.js');
ensurePrimitivesHarnessBuilt();

const BRANCHES = {
  full: {
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
  },
  absence: {
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
          { label: 'meta dash', status: 'LOCKED', statusTone: 'block', meta: '—' },
        ],
      },
      { title: 'NOTHING HERE', rows: [] },
    ],
    notes: ['   ', '', 42, null],
  },
  factsOnly: {
    eyebrow: 'THEATER DETAIL',
    title: 'Mars Theater',
    summary: 'Active. No visible xenoforming sites are reported in this theater.',
    facts: [
      { label: 'Combined GDP', value: '$12.5T' },
      { label: 'Nations', value: 8 },
      { label: 'Observer control', value: 3 },
      { label: 'Expected Value', value: '—' },
    ],
  },
  ungated: {
    eyebrow: 'RESEARCH PATH',
    title: 'Laser Drive Mk1',
    facts: [
      { label: 'DRIVE', value: 'Laser Drive Mk1' },
      { label: 'GATE PROJECT', value: 'none — this drive names no gating project' },
      { label: 'AVAILABILITY', value: 'Available now' },
    ],
    summary: 'This drive is not gated by any project.',
    notes: ['Nothing unlocks this drive because nothing needs to.'],
  },
  actions: {
    title: 'Actions',
    actions: [
      { label: 'Stay', close: false },
      { label: 'Go', primary: true },
    ],
  },
};

const CAPTURE = () => {
  const panel = document.getElementById('mcDetailPanel');
  if (!panel) return { error: 'no panel' };
  const sel = (s) => panel.querySelector(s);
  const cells = [];
  panel.querySelectorAll('.detail-panel__fact, .detail-panel__row, .detail-panel__section, .detail-panel__note, #detailPanelActions button').forEach((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    cells.push({
      key: el.className + (el.id ? `#${el.id}` : '') + (el.tagName === 'BUTTON' ? `:${el.textContent.trim()}` : ''),
      text: el.innerText?.replace(/\s+/g, ' ').trim() || '',
      title: el.getAttribute('title') || '',
      className: el.className,
      font: cs.font,
      color: cs.color,
      border: cs.border,
      background: cs.backgroundColor,
      display: cs.display,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    });
  });
  const valueStates = [...panel.querySelectorAll('[data-value-state]')].map((el) => ({
    state: el.getAttribute('data-value-state'),
    text: el.textContent.trim(),
    parent: el.parentElement?.className || '',
  }));
  return {
    innerText: panel.innerText.replace(/\s+/g, ' ').trim(),
    nodeCount: panel.querySelectorAll('*').length,
    valueStateCount: panel.querySelectorAll('[data-value-state]').length,
    cells,
    valueStates,
  };
};

async function main() {
  const app = require(path.join(ROOT, 'server/index.js'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1660, height: 950 } });
  await page.goto(`http://127.0.0.1:${port}/v2/primitives-harness.html?scene=detailPanel`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="detail-panel-harness"]', { timeout: 30000 });

  const out = {};
  for (const [name, opts] of Object.entries(BRANCHES)) {
    await page.evaluate(() => window.MissionControlDetailPanel._internals.reset());
    await page.evaluate((o) => window.MissionControlDetailPanel.open(o), opts);
    await page.waitForSelector('#mcDetailPanel:not([hidden])');
    out[name] = await page.evaluate(CAPTURE);
  }

  await browser.close();
  await new Promise((r) => server.close(r));

  const outPath = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;
  const json = JSON.stringify(out, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
