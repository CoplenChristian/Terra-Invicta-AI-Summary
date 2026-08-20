const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64';

async function runTest() {
  console.log('--- Launching Browser Test for The Initiative Command Center v2 ---');

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
    defaultViewport: { width: 1680, height: 1050 }
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

  console.log('1. Navigating to http://localhost:3000/v2...');
  await page.goto('http://localhost:3000/v2', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1200));

  // 2. Screenshot Full Dashboard Overview
  console.log('2. Capturing Initiative Big Screen Command Center...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_v2_initiative_bigscreen.png') });

  // 3. Scroll to Directives
  console.log('3. Scrolling to Directives Banner...');
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_v2_directives_stream.png') });

  // 4. Test Copy Button
  console.log('4. Testing Copy Briefing button...');
  await page.click('#btnCopySitrep');
  await new Promise(r => setTimeout(r, 400));

  await browser.close();

  console.log(`\nBrowser test completed with ${errors.length} errors.`);
  if (errors.length > 0) {
    console.error('Errors encountered:', errors);
    process.exit(1);
  } else {
    console.log('✓ Initiative Big Screen Command Center v2 rendered with 0 errors!');
  }
}

runTest().catch(err => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});
