/**
 * scripts/verify_computed_style_baseline.js
 *
 * Purpose: captures the computed style and geometry map for every visible element
 *   across all six views at 375, 1440, 1600, and 1920 in both player and omniscient
 *   modes, and diffs for zero unintended layout/rendering changes.
 *
 * Inherited lessons from the stylesheet split:
 * 1. Chromium does NOT enumerate custom properties in a stable order across page loads.
 *    Custom CSS properties (--*) and all style keys are sorted alphabetically.
 * 2. #hudSnapshot renders a live wall clock timestamp, so its text and dynamic timestamp
 *    nodes are masked out of comparison.
 * 3. Two identical baseline runs MUST be captured and diffed first to prove the harness
 *    itself is 100% deterministic (0 diffs) before trusting any pre/post diff.
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SHELL_PATH = '/v2/index.html';

const VIEWS = ['command', 'expansion', 'fleet', 'drives', 'threat', 'records'];
const MODES = ['player', 'omniscient'];
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 }
];

const TRACKED_PROPERTIES = [
  'display', 'position', 'visibility', 'opacity', 'overflow-x', 'overflow-y',
  'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'color', 'background-color', 'text-align', 'text-transform', 'text-overflow', 'white-space',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end'
];

async function selectMode(page, mode) {
  await page.evaluate((targetMode) => {
    const btn = document.querySelector(`.init-mode-btn[data-mode="${targetMode}"]`);
    if (btn) btn.click();
  }, mode);
  await page.waitForTimeout(700);
}

/** Runs in browser to extract sorted computed styles and rects for all elements */
function captureDomState(trackedProps) {
  const elements = [];
  const allNodes = Array.from(document.querySelectorAll('body *'));

  for (let i = 0; i < allNodes.length; i++) {
    const el = allNodes[i];
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK' || el.tagName === 'TEMPLATE') {
      continue;
    }
    // Only capture rendered / non-hidden elements in active DOM
    if (el.getClientRects().length === 0) continue;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    const styleObj = {};
    for (const prop of trackedProps) {
      styleObj[prop] = style.getPropertyValue(prop);
    }

    // Build stable selector / path
    let selector = el.tagName.toLowerCase();
    if (el.id) selector += `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(Boolean).sort().join('.');
      if (classes) selector += `.${classes}`;
    }

    // Dynamic wall clock mask
    const isClockElement = el.id === 'hudSnapshot' || (typeof el.className === 'string' && el.className.includes('init-hud-pill-snapshot')) || el.closest('#hudSnapshot') || el.closest('.init-hud-pill-snapshot');
    const textContent = isClockElement ? '[MASKED_WALL_CLOCK]' : (el.children.length === 0 ? (el.textContent || '').trim() : '');

    if (isClockElement) {
      styleObj['width'] = '[MASKED_WALL_CLOCK]';
      styleObj['height'] = '[MASKED_WALL_CLOCK]';
      styleObj['min-width'] = '[MASKED_WALL_CLOCK]';
      styleObj['max-width'] = '[MASKED_WALL_CLOCK]';
    }

    elements.push({
      selector,
      id: el.id || null,
      rect: isClockElement ? { x: 0, y: 0, width: 0, height: 0 } : {
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      },
      text: textContent,
      styles: styleObj
    });
  }

  // Also capture root CSS custom properties in alphabetical order
  const rootStyle = window.getComputedStyle(document.documentElement);
  const rootProps = {};
  const customNames = [];
  for (let j = 0; j < rootStyle.length; j++) {
    const name = rootStyle[j];
    if (name.startsWith('--')) customNames.push(name);
  }
  customNames.sort();
  for (const name of customNames) {
    rootProps[name] = rootStyle.getPropertyValue(name).trim();
  }

  return { rootProps, elements };
}

const crypto = require('crypto');
const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');
const saveParser = require('../server/saveParser.js');

function getActiveSaveFingerprint() {
  const args = process.argv.slice(2);
  let savePath = null;
  if (args.includes('--save')) {
    savePath = args[args.indexOf('--save') + 1];
  } else if (process.env.TI_SAVE_FILE) {
    savePath = process.env.TI_SAVE_FILE;
  }

  let saveFullPath = null;
  if (savePath) {
    saveFullPath = path.isAbsolute(savePath) ? savePath : path.resolve(process.cwd(), savePath);
    if (!fs.existsSync(saveFullPath)) {
      // Check in default saves folder
      const folder = saveParser.resolveSaveFolder();
      const candidate = path.join(folder, savePath);
      if (fs.existsSync(candidate)) {
        saveFullPath = candidate;
      }
    }
  } else {
    const saveInfo = saveParser.getLatestSaveFile();
    saveFullPath = saveInfo?.fullPath;
  }

  if (!saveFullPath || !fs.existsSync(saveFullPath)) {
    throw new Error(`[verify_computed_style_baseline] --save file not found: ${savePath || '(none)'}`);
  }
  // The server's snapshot routes accept ?save=<basename> and resolve it
  // strictly inside the configured save folder (server/requestValidation.js
  // resolveSavePath). If --save resolved to anything outside that folder the
  // harness would stamp a fingerprint the server cannot render, which is
  // exactly defect #16. Refuse loudly instead.
  if (savePath) {
    const folder = path.resolve(saveParser.resolveSaveFolder());
    // realpathSync can throw if the file vanished between the existsSync
    // check above and now; treat that as "not pinned" so the next line
    // reports a clean error.
    let resolvedFolder, resolvedSave;
    try {
      resolvedFolder = fs.realpathSync(folder);
      resolvedSave = fs.realpathSync(saveFullPath);
    } catch (_) {
      throw new Error(`[verify_computed_style_baseline] --save '${savePath}' could not be resolved at '${saveFullPath}'. The file may have moved or been deleted.`);
    }
    if (path.dirname(resolvedSave).toLowerCase() !== resolvedFolder.toLowerCase()) {
      throw new Error(
        `[verify_computed_style_baseline] --save '${savePath}' resolves to '${resolvedSave}', which is outside the configured save folder '${resolvedFolder}'. ` +
        `The harness server can only render saves inside its save folder. Move the file there or pass just the basename (e.g. --save <basename>.gz).`
      );
    }
  }
  const content = fs.readFileSync(saveFullPath);
  const md5 = crypto.createHash('md5').update(content).digest('hex');
  const stats = fs.statSync(saveFullPath);
  return {
    savePath: saveFullPath,
    saveFileName: path.basename(saveFullPath),
    md5,
    sizeBytes: stats.size,
    mtime: stats.mtime.toISOString()
  };
}

async function captureFullState(page, logPrefix = '', port = 0) {
  const saveStart = getActiveSaveFingerprint();
  if (logPrefix) {
    console.log(`[Capture] Starting against save: ${saveStart.saveFileName} (MD5: ${saveStart.md5.slice(0, 8)}...)`);
  }

  const result = {};

  for (const mode of MODES) {
    result[mode] = {};

    for (const vp of VIEWPORTS) {
      const vpKey = `${vp.width}x${vp.height}`;
      result[mode][vpKey] = {};

      await page.setViewportSize({ width: vp.width, height: vp.height });
      // The save pin (defect #16) reaches the server through ?save=<name>.
      // The front-end (mission-control.js) reads the same query param and
      // threads it onto the /api/v2/briefing fetch, so the server renders
      // the file the capture's fingerprint labels. The fingerprint reader
      // below refuses any --save that doesn't resolve to a file inside the
      // server's save folder, so this URL is always a real save there.
      const saveQuery = saveStart.saveFileName ? `?save=${encodeURIComponent(saveStart.saveFileName)}` : '';
      await page.goto(`http://localhost:${port}${SHELL_PATH}${saveQuery}#/command`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await selectMode(page, mode);

      for (const view of VIEWS) {
        await page.evaluate((v) => { window.location.hash = `#/${v}`; }, view);
        await page.waitForTimeout(view === 'drives' ? 2500 : 800);

        const state = await page.evaluate(captureDomState, TRACKED_PROPERTIES);
        result[mode][vpKey][view] = state;
        if (logPrefix) {
          process.stdout.write(`\r${logPrefix} [${mode.toUpperCase()}] [${vpKey}] [${view}] elements: ${state.elements.length}    `);
        }
      }
    }
  }
  if (logPrefix) console.log();

  const saveEnd = getActiveSaveFingerprint();
  if (saveStart.md5 !== saveEnd.md5 || saveStart.savePath !== saveEnd.savePath) {
    throw new Error(
      `[verify_computed_style_baseline] SAVE DRIFT DETECTED during capture!\n` +
      `  Start: ${saveStart.saveFileName} (${saveStart.md5})\n` +
      `  End:   ${saveEnd.saveFileName} (${saveEnd.md5})\n` +
      `CLAUDE.md requires capture against a frozen save.`
    );
  }

  return {
    metadata: {
      saveFileName: saveStart.saveFileName,
      savePath: saveStart.savePath,
      saveMd5Start: saveStart.md5,
      saveMd5End: saveEnd.md5,
      saveMd5: saveStart.md5,
      saveSizeBytes: saveStart.sizeBytes,
      saveMtime: saveStart.mtime,
      capturedAt: new Date().toISOString()
    },
    states: result
  };
}

function diffStates(rawA, rawB, labelA = 'Run A', labelB = 'Run B') {
  const diffs = [];
  const metaA = rawA?.metadata || {};
  const metaB = rawB?.metadata || {};
  const statesA = rawA?.states || rawA || {};
  const statesB = rawB?.states || rawB || {};

  // Save MD5 verification guard: refuse if either capture lacks a fingerprint, or if fingerprints differ
  const md5A = metaA.saveMd5 || metaA.saveMd5Start;
  const md5B = metaB.saveMd5 || metaB.saveMd5Start;

  if (!md5A || !md5B) {
    const missing = [];
    if (!md5A) missing.push(`${labelA} (${metaA.saveFileName || 'unfingerprinted capture'})`);
    if (!md5B) missing.push(`${labelB} (${metaB.saveFileName || 'unfingerprinted capture'})`);
    diffs.push(
      `REFUSING TO DIFF UNVERIFIABLE CAPTURES!\n` +
      `  Capture missing save MD5 fingerprint: ${missing.join(', ')}\n` +
      `CLAUDE.md: an unfingerprinted capture is UNVERIFIABLE, not compatible. Captures must be taken with the fingerprinting harness against an MD5-verified frozen save.`
    );
    return diffs;
  }

  if (md5A !== md5B) {
    diffs.push(
      `REFUSING TO DIFF CAPTURES FROM DIFFERENT SAVES!\n` +
      `  - ${labelA}: ${metaA.saveFileName || 'unknown'} (MD5: ${md5A})\n` +
      `  - ${labelB}: ${metaB.saveFileName || 'unknown'} (MD5: ${md5B})\n` +
      `Captures must be against the exact same MD5-verified save.`
    );
    return diffs;
  }

  for (const mode of MODES) {
    for (const vp of VIEWPORTS) {
      const vpKey = `${vp.width}x${vp.height}`;
      for (const view of VIEWS) {
        const dataA = statesA[mode]?.[vpKey]?.[view];
        const dataB = statesB[mode]?.[vpKey]?.[view];

        // Fail if a state is missing or has zero elements
        if (!dataA || !Array.isArray(dataA.elements) || dataA.elements.length === 0) {
          diffs.push(`[${mode} ${vpKey} ${view}] Missing or empty DOM state in ${labelA} (found ${dataA?.elements?.length ?? 0} elements)`);
          continue;
        }
        if (!dataB || !Array.isArray(dataB.elements) || dataB.elements.length === 0) {
          diffs.push(`[${mode} ${vpKey} ${view}] Missing or empty DOM state in ${labelB} (found ${dataB?.elements?.length ?? 0} elements)`);
          continue;
        }

        // Check root custom props
        const allCustom = Array.from(new Set([...Object.keys(dataA.rootProps || {}), ...Object.keys(dataB.rootProps || {})])).sort();
        for (const k of allCustom) {
          if (dataA.rootProps[k] !== dataB.rootProps[k]) {
            diffs.push(`[${mode} ${vpKey} ${view} :root] Variable '${k}' differs: '${dataA.rootProps[k]}' vs '${dataB.rootProps[k]}'`);
          }
        }

        const listA = dataA.elements;
        const listB = dataB.elements;

        if (listA.length !== listB.length) {
          diffs.push(`[${mode} ${vpKey} ${view}] Element count mismatch: ${labelA}=${listA.length} vs ${labelB}=${listB.length}`);
          continue;
        }

        for (let i = 0; i < listA.length; i++) {
          const itemA = listA[i];
          const itemB = listB[i];

          if (itemA.selector !== itemB.selector) {
            diffs.push(`[${mode} ${vpKey} ${view} #${i}] Selector mismatch: ${itemA.selector} vs ${itemB.selector}`);
            continue;
          }

          // Compare rects
          for (const key of ['width', 'height', 'x', 'y']) {
            if (Math.abs(itemA.rect[key] - itemB.rect[key]) > 0.5) {
              diffs.push(`[${mode} ${vpKey} ${view} ${itemA.selector}] Rect.${key} changed: ${itemA.rect[key]} -> ${itemB.rect[key]}`);
            }
          }

          // Compare tracked styles
          for (const prop of TRACKED_PROPERTIES) {
            if (itemA.styles[prop] !== itemB.styles[prop]) {
              diffs.push(`[${mode} ${vpKey} ${view} ${itemA.selector}] Style '${prop}' changed: '${itemA.styles[prop]}' -> '${itemB.styles[prop]}'`);
            }
          }

          // Compare text (clock is already masked)
          if (itemA.text !== itemB.text) {
            diffs.push(`[${mode} ${vpKey} ${view} ${itemA.selector}] Text changed: '${itemA.text}' -> '${itemB.text}'`);
          }
        }
      }
    }
  }

  return diffs;
}

async function run() {
  ensureBundleBuilt();
  const args = process.argv.slice(2);
  const outDir = path.join(__dirname, '..', 'tmp', 'computed-style-captures');
  fs.mkdirSync(outDir, { recursive: true });

  const app = require('../server/index.js');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const serverPort = server.address().port;
  console.log(`[Computed Style Harness] Server started on http://localhost:${serverPort}${SHELL_PATH}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (args.includes('--baseline-proof')) {
      console.log('--- RUNNING BASELINE DETERMINISM PROOF (2 identical runs) ---');
      console.log('Capturing Baseline Run 1...');
      const run1 = await captureFullState(page, 'Run 1', serverPort);
      fs.writeFileSync(path.join(outDir, 'baseline_run1.json'), JSON.stringify(run1, null, 2));

      console.log('Capturing Baseline Run 2...');
      const run2 = await captureFullState(page, 'Run 2', serverPort);
      fs.writeFileSync(path.join(outDir, 'baseline_run2.json'), JSON.stringify(run2, null, 2));

      console.log('Diffing Baseline Run 1 vs Baseline Run 2...');
      const baselineDiffs = diffStates(run1, run2, 'Run 1', 'Run 2');
      if (baselineDiffs.length > 0) {
        console.error(`FAIL: Baseline harness is NOT deterministic! ${baselineDiffs.length} differences found:`);
        console.error(baselineDiffs.slice(0, 20).join('\n'));
        process.exit(1);
      }
      console.log('✔ DETERMINISM PROOF PASSED: 0 differences between Run 1 and Run 2 across all 48 matrix states.');
      return;
    }

    if (args.includes('--capture')) {
      const filename = args[args.indexOf('--capture') + 1] || 'capture.json';
      console.log(`Capturing state to ${filename}...`);
      const state = await captureFullState(page, 'Capture', serverPort);
      fs.writeFileSync(path.join(outDir, filename), JSON.stringify(state, null, 2));
      console.log(`✔ State saved to ${path.join(outDir, filename)}`);
      return;
    }

    if (args.includes('--diff-files')) {
      const fileA = args[args.indexOf('--diff-files') + 1];
      const fileB = args[args.indexOf('--diff-files') + 2];
      const stateA = JSON.parse(fs.readFileSync(fileA, 'utf8'));
      const stateB = JSON.parse(fs.readFileSync(fileB, 'utf8'));
      const diffs = diffStates(stateA, stateB, path.basename(fileA), path.basename(fileB));
      if (diffs.length > 0) {
        console.error(`FAIL: Found ${diffs.length} computed style differences:`);
        console.error(diffs.slice(0, 30).join('\n'));
        process.exit(1);
      }
      console.log('✔ DIFF PASSED: 0 computed style or geometry differences.');
      return;
    }

    console.log('Capturing baseline state...');
    const baseline = await captureFullState(page, 'Baseline', serverPort);
    fs.writeFileSync(path.join(outDir, 'baseline.json'), JSON.stringify(baseline, null, 2));
    console.log(`✔ Baseline captured to ${path.join(outDir, 'baseline.json')}`);

  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('[Error in verify_computed_style_baseline]:', err);
    process.exit(1);
  });
}

module.exports = { captureFullState, diffStates, getActiveSaveFingerprint };
