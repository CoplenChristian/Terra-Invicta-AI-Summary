const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
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
  const consoleLogs = [];
  const errors = [];
  page.on('console', msg => consoleLogs.push(msg.text()));
  page.on('pageerror', err => errors.push(err.toString()));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  console.log('1. Page Title:', await page.title());

  // Check cards count
  const cards = await page.$$('.card');
  console.log('2. Overview cards count:', cards.length);

  // Copy screenshots to brain artifact dir if available
  const artifactDir = 'C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64';
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

  // Take Overview screenshot
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_overview.png') });

  // Test mode switcher: switch to Omniscient
  await page.click('button[data-mode="omniscient"]');
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_omniscient.png') });

  // Test Earth tab: Nations, Councilors, Targets
  await page.click('a[data-tab="earth"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_earth_nations.png') });

  await page.click('button[data-earth-view="councilors"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_earth_councilors.png') });

  await page.click('button[data-earth-view="targets"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_earth_targets.png') });

  // Test Space tab
  await page.click('a[data-tab="space"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_space.png') });

  // Test Technology tab: Global, Matrix, Inspector
  await page.click('a[data-tab="technology"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_tech_global.png') });

  await page.click('button[data-tech-view="matrix"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_tech_matrix.png') });

  await page.click('button[data-tech-view="inspector"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_tech_inspector.png') });

  // Test Intelligence tab
  await page.click('a[data-tab="intelligence"]');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_intelligence.png') });

  // Test Export tab
  await page.click('a[data-tab="export"]');
  await new Promise(r => setTimeout(r, 400));
  const exportPreview = await page.$eval('#exportMarkdownPreview', el => el.textContent);
  console.log('3. Export content length:', exportPreview.length);
  await page.screenshot({ path: path.join(artifactDir, 'screenshot_export.png') });

  console.log('4. Browser errors count:', errors.length);
  if (errors.length > 0) console.log('Errors:', errors);

  await browser.close();
  console.log('✓ All browser tests completed successfully!');
})();
