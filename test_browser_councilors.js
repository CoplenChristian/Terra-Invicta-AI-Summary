const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64';

async function runTest() {
  console.log('--- Launching Browser Test for Councilors Screen ---');

  const browserPaths = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'F:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ];
  let execPath = browserPaths.find(p => fs.existsSync(p));
  console.log('Using browser executable:', execPath);

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: true,
    defaultViewport: { width: 1440, height: 900 }
  });

  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('[Browser Console Error]:', msg.text());
      errors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    console.error('[Browser Page Error]:', err.message);
    errors.push(err.message);
  });

  console.log('1. Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));

  // 2. Click Councilors Nav Link
  console.log('2. Clicking Councilors Tab (#councilors)...');
  await page.click('a[data-tab="councilors"]');
  await new Promise(r => setTimeout(r, 600));

  // 3. Screenshot Cards View
  console.log('3. Capturing Councilors Cards View...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_councilors_cards.png') });

  // 4. Switch to Table View
  console.log('4. Switching to Table View...');
  await page.click('#btnCouncilorViewTable');
  await new Promise(r => setTimeout(r, 600));

  // 5. Screenshot Table View
  console.log('5. Capturing Councilors Table View...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_councilors_table.png') });

  // 6. Open Councilor Modal
  console.log('6. Clicking first councilor row to open Dossier Modal...');
  await page.click('#councilorsMainTableBody tr:first-child');
  await new Promise(r => setTimeout(r, 600));

  // 7. Screenshot Dossier Modal
  console.log('7. Capturing Councilor Dossier Modal...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_councilor_modal.png') });

  // 8. Close Modal
  console.log('8. Closing modal...');
  await page.click('#btnCloseCouncilorModal');
  await new Promise(r => setTimeout(r, 400));

  // 9. Switch back to cards view & test Omniscient Mode
  console.log('9. Switching to OMNISCIENT mode to view all global councilors...');
  await page.click('#btnCouncilorViewCards');
  await page.click('.mode-btn[data-mode="omniscient"]');
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_councilors_omniscient.png') });

  await browser.close();

  console.log(`\nBrowser test completed with ${errors.length} errors.`);
  if (errors.length > 0) {
    console.error('Errors encountered:', errors);
    process.exit(1);
  } else {
    console.log('✓ All Councilors views and modal rendered with 0 console errors!');
  }
}

runTest().catch(err => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});
