/**
 * Browser verification script for Research Advisor: Separate Procurement from Research
 * Purpose: browser verification of separating procurement from research and of
 *   dashboard-wide CSS variable resolution across all four views.
 * and Dashboard-wide CSS variable resolution & contrast across all 4 views.
 */

const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const assert = require('assert');

process.env.NODE_ENV = 'test';

function parseColor(str) {
  if (!str) return null;
  const rgbMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }
  const hexMatch = str.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (hexMatch) {
    return [parseInt(hexMatch[1], 16), parseInt(hexMatch[2], 16), parseInt(hexMatch[3], 16)];
  }
  return null;
}

function luminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrastRatio(rgb1, rgb2) {
  const lum1 = luminance(rgb1[0], rgb1[1], rgb1[2]);
  const lum2 = luminance(rgb2[0], rgb2[1], rgb2[2]);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

async function runVerification() {
  const app = require('../server/index.js');

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  console.log(`[Verification] Server listening on http://localhost:${port}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const networkErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('response', res => {
      const status = res.status();
      const url = res.url();
      if (status >= 400) {
        networkErrors.push(`${status} ${res.request().method()} ${url}`);
      }
    });

    const modes = ['player', 'omniscient'];
    const views = ['command', 'expansion', 'fleet', 'threat', 'records'];

    for (const mode of modes) {
      console.log(`\n========================================`);
      console.log(`Testing Mode: ${mode.toUpperCase()} at 1920x1080`);
      console.log(`========================================`);

      await page.goto(`http://localhost:${port}/v2/?mode=${mode}#/command`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // --- 1. CSS Custom Properties Computed-Style Assertion ---
      console.log('\n--- 1. Computed Style Assertion for :root CSS variables ---');
      const cssVariables = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const text = style.getPropertyValue('--text').trim();
        const textMuted = style.getPropertyValue('--text-muted').trim();
        const textDim = style.getPropertyValue('--text-dim').trim();
        const canvas = style.getPropertyValue('--canvas').trim();
        const surface = style.getPropertyValue('--surface').trim();
        const surfaceInset = style.getPropertyValue('--surface-inset').trim();
        return { text, textMuted, textDim, canvas, surface, surfaceInset };
      });

      console.log('Computed CSS variables on :root:');
      console.log(`  --text:          "${cssVariables.text}"`);
      console.log(`  --text-muted:    "${cssVariables.textMuted}"`);
      console.log(`  --text-dim:      "${cssVariables.textDim}"`);
      console.log(`  --canvas:        "${cssVariables.canvas}"`);
      console.log(`  --surface:       "${cssVariables.surface}"`);
      console.log(`  --surface-inset: "${cssVariables.surfaceInset}"`);

      assert.ok(cssVariables.textMuted.length > 0, '--text-muted must not be empty');
      assert.ok(cssVariables.textDim.length > 0, '--text-dim must not be empty');
      assert.notStrictEqual(cssVariables.textMuted, cssVariables.text, '--text-muted must not equal --text');
      assert.notStrictEqual(cssVariables.textDim, cssVariables.text, '--text-dim must not equal --text');

      // Check contrast
      const rgbText = parseColor(cssVariables.text);
      const rgbMuted = parseColor(cssVariables.textMuted);
      const rgbDim = parseColor(cssVariables.textDim);
      const rgbCanvas = parseColor(cssVariables.canvas);
      const rgbSurface = parseColor(cssVariables.surface);

      if (rgbText && rgbCanvas) {
        const cr = contrastRatio(rgbText, rgbCanvas);
        console.log(`Contrast ratio (--text vs --canvas): ${cr.toFixed(2)}:1`);
        assert.ok(cr >= 4.5, `Contrast ratio ${cr.toFixed(2)}:1 must be >= 4.5:1 for WCAG AA normal text`);
      }
      if (rgbMuted && rgbCanvas) {
        const cr = contrastRatio(rgbMuted, rgbCanvas);
        console.log(`Contrast ratio (--text-muted vs --canvas): ${cr.toFixed(2)}:1`);
        assert.ok(cr >= 3.0, `Contrast ratio ${cr.toFixed(2)}:1 must be >= 3.0:1 for secondary text`);
      }
      if (rgbDim && rgbSurface) {
        const cr = contrastRatio(rgbDim, rgbSurface);
        console.log(`Contrast ratio (--text-dim vs --surface): ${cr.toFixed(2)}:1`);
        assert.ok(cr >= 2.5, `Contrast ratio ${cr.toFixed(2)}:1 must be >= 2.5:1 for de-emphasized metadata`);
      }

      // --- 2. Dashboard-wide View Traversal (5 Views) ---
      console.log('\n--- 2. Dashboard-wide View Traversal & CSS Computed Colors ---');
      for (const viewId of views) {
        await page.click(`.init-nav-btn[data-view="${viewId}"]`);
        await page.waitForTimeout(200);

        const viewScan = await page.evaluate((vId) => {
          const section = document.getElementById(`view-${vId}`);
          if (!section) return { found: false };

          const metaElements = Array.from(section.querySelectorAll('.ra-row__meta, .tech-card-header span, small, .since-save-row__time'));
          const colors = metaElements.map(el => getComputedStyle(el).color);
          return {
            found: true,
            visible: !section.hidden && !section.hasAttribute('inert'),
            elementsScanned: metaElements.length,
            distinctColors: Array.from(new Set(colors))
          };
        }, viewId);

        console.log(`View '${viewId}': visible=${viewScan.visible}, scanned=${viewScan.elementsScanned} elements, distinct colors=${JSON.stringify(viewScan.distinctColors)}`);
        assert.ok(viewScan.found && viewScan.visible, `View '${viewId}' must be present and visible when selected`);
      }

      // Back to command
      await page.click('.init-nav-btn[data-view="command"]');
      await page.waitForTimeout(200);

      // --- 3. View Height & Research Advisor Inspection ---
      console.log('\n--- 3. Page Height & Research Advisor Inspection ---');
      const scrollMetrics = await page.evaluate(() => {
        const bodyHeight = document.body.scrollHeight;
        const innerHeight = window.innerHeight;
        const screens = bodyHeight / innerHeight;
        return { bodyHeight, innerHeight, screens };
      });

      console.log(`[${mode}] COMMAND body height: ${scrollMetrics.bodyHeight}px (${scrollMetrics.screens.toFixed(3)} screens @ ${scrollMetrics.innerHeight}px viewport)`);
      if (scrollMetrics.screens >= 3.00) {
        throw new Error(`COMMAND view exceeded 3.00-screen ceiling in ${mode} mode: ${scrollMetrics.screens.toFixed(3)} screens (${scrollMetrics.bodyHeight}px) >= 3.00 max`);
      }
      console.log(`✓ COMMAND view height is strictly under 3.00 screens (${scrollMetrics.screens.toFixed(3)} screens).`);

      // Research advisor DOM inspection (must NOT contain procurement)
      const advisorScan = await page.evaluate(() => {
        const advisor = document.querySelector('.research-advisor');
        if (!advisor) return { exists: false };

        const procurement = advisor.querySelector('.ra-procurement');
        const researchTrack = advisor.querySelector('.ra-track');
        const researchHead = researchTrack ? researchTrack.querySelector('.ra-track__head') : null;
        const researchGroups = researchTrack
          ? Array.from(researchTrack.querySelectorAll('.ra-group')).map(g => ({
            label: g.querySelector('.ra-group__label') ? g.querySelector('.ra-group__label').textContent.trim() : null,
            rows: Array.from(g.querySelectorAll('.ra-row')).map(r => ({
              name: r.querySelector('.ra-row__name') ? r.querySelector('.ra-row__name').textContent.trim() : null,
              sub: r.querySelector('.ra-row__sub') ? r.querySelector('.ra-row__sub').textContent.trim() : null,
              metric: r.querySelector('.ra-row__metric') ? r.querySelector('.ra-row__metric').textContent.trim() : null,
              meta: r.querySelector('.ra-row__meta') ? r.querySelector('.ra-row__meta').textContent.trim() : null
            }))
          }))
          : [];

        return {
          exists: true,
          hasProcurement: !!procurement,
          researchHeadText: researchHead ? researchHead.textContent.trim() : null,
          researchGroups
        };
      });

      console.log(`\nResearch Advisor procurement block present in COMMAND: ${advisorScan.hasProcurement}`);
      assert.strictEqual(advisorScan.hasProcurement, false, 'Procurement block must NOT render inside the Research Advisor');

      console.log(`Military research header: "${advisorScan.researchHeadText}"`);
      for (const g of advisorScan.researchGroups) {
        console.log(`Research group: "${g.label}" (${g.rows.length} rows):`);
        for (const r of g.rows) {
          console.log(`  - Project: "${r.name}" | Sub: "${r.sub}" | Metric: ${r.metric} | Meta: "${r.meta}"`);
          assert.ok(r.meta.includes('pts'), `Research row "${r.name}" must show research pts cost`);
        }
      }

      // --- 4. FLEET View Inspection ---
      console.log('\n--- 4. FLEET View Inspection ---');
      await page.click('.init-nav-btn[data-view="fleet"]');
      await page.waitForTimeout(300);

      const fleetScan = await page.evaluate(() => {
        const fp = document.getElementById('fleetProcurement');
        if (!fp) return { exists: false };

        const procurement = fp.querySelector('.fp-procurement, .ra-procurement');
        const procurementHead = fp.querySelector('.fp-procurement__head, .ra-procurement__head');
        const procurementRows = fp
          ? Array.from(fp.querySelectorAll('.ra-row, .fp-row')).map(r => ({
            name: r.querySelector('.ra-row__name, .fp-row__name') ? r.querySelector('.ra-row__name, .fp-row__name').textContent.trim() : null,
            tooltip: r.querySelector('.ra-row__name, .fp-row__name') ? r.querySelector('.ra-row__name, .fp-row__name').getAttribute('title') : null,
            metric: r.querySelector('.ra-row__metric, .fp-row__metric') ? r.querySelector('.ra-row__metric, .fp-row__metric').textContent.trim() : null,
            meta: r.querySelector('.ra-row__meta, .fp-row__meta') ? r.querySelector('.ra-row__meta, .fp-row__meta').textContent.trim() : null
          }))
          : [];

        return {
          exists: true,
          hasProcurement: !!procurement,
          procurementHeadText: procurementHead ? procurementHead.textContent.trim() : null,
          procurementRows
        };
      });

      console.log(`Fleet procurement block found in FLEET view: ${fleetScan.hasProcurement}`);
      assert.ok(fleetScan.hasProcurement, 'Procurement block must render inside the FLEET view');
      console.log(`Procurement header: "${fleetScan.procurementHeadText}"`);
      assert.match(fleetScan.procurementHeadText, /unfielded/i, 'Procurement header must state unfielded count');
      console.log(`Procurement rows (${fleetScan.procurementRows.length}):`);
      for (const r of fleetScan.procurementRows) {
        console.log(`  - Item: "${r.name}" | Metric: ${r.metric} | Meta: "${r.meta}" | Tooltip: "${r.tooltip}"`);
        assert.ok(!r.meta.includes('0 pts'), `Procurement row "${r.name}" must not show "0 pts" in meta`);
        assert.ok(r.meta.includes('refit') || r.meta.includes('build'), `Procurement row "${r.name}" must state refit or build`);
        assert.ok(!r.name.includes('('), `Procurement row "${r.name}" must lead with item name without parenthesised project`);
        assert.ok(r.tooltip && r.tooltip.includes('unlocked by'), `Procurement row "${r.name}" must include unlocking project in tooltip`);
      }

      // --- 5. Test Full Breakdown Modal from FLEET View ---
      console.log('\n--- 5. Detail Panel (Full Breakdown) Modal from FLEET ---');
      await page.click('[data-fleet-procurement-full]');
      await page.waitForTimeout(400);

      const modalFacts = await page.evaluate(() => {
        const panel = document.getElementById('mcDetailPanel');
        if (!panel || panel.hidden) return { open: false, factRows: [] };
        const dts = Array.from(panel.querySelectorAll('#detailPanelFacts dt'));
        const dds = Array.from(panel.querySelectorAll('#detailPanelFacts dd'));
        const factRows = dts.map((dt, i) => ({
          label: dt.textContent.trim(),
          value: dds[i] ? dds[i].textContent.trim() : ''
        }));
        return { open: true, factRows };
      });

      console.log(`Detail panel open: ${modalFacts.open}, fact count: ${modalFacts.factRows.length}`);
      assert.ok(modalFacts.open, 'Full procurement modal must open on click');

      const procurementFacts = modalFacts.factRows.filter(f => f.label.startsWith('PROCUREMENT'));
      console.log(`Modal carries ${procurementFacts.length} procurement facts.`);
      if (procurementFacts.length > 0) {
        console.log(`Sample procurement modal fact: "${procurementFacts[0].label}" -> "${procurementFacts[0].value}"`);
        assert.ok(!procurementFacts[0].value.includes('pts'), 'Procurement fact in modal must not show research pts');
      }

      // Close procurement modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // --- 6. Refit Advisor Inspection in FLEET View ---
      console.log('\n--- 6. Refit Advisor Section Inspection ---');
      const refitScan = await page.evaluate(() => {
        const section = document.querySelector('.fp-refit-section');
        if (!section) return { exists: false };

        const notice = section.querySelector('.fp-refit-notice');
        const cards = Array.from(section.querySelectorAll('.fp-refit-card')).map(c => ({
          id: c.getAttribute('data-design-id'),
          title: c.querySelector('.fp-refit-card__title strong')?.textContent.trim() || null,
          role: c.querySelector('.fp-refit-card__role')?.textContent.trim() || null,
          driveText: c.querySelector('.fp-refit__drive')?.textContent.trim() || null,
          hasFailsFloorBadge: !!c.querySelector('.fp-refit__drive .ra-tag--warn')
        }));

        return {
          exists: true,
          noticeText: notice?.textContent.trim() || null,
          cardCount: cards.length,
          cards
        };
      });

      console.log(`Refit Advisor section found: ${refitScan.exists}, designs evaluated: ${refitScan.cardCount}`);
      assert.ok(refitScan.exists, 'Refit Advisor section must render in FLEET view');
      assert.ok(refitScan.cardCount > 0, 'Refit Advisor must evaluate observer designs');
      assert.ok(refitScan.noticeText && refitScan.noticeText.includes('dry mass constant'), 'Refit notice must state constant dry mass');

      // Check for State 2 (Best available drive already fitted) and State 3 (fails floor)
      const state2Cards = refitScan.cards.filter(c => c.driveText && c.driveText.includes('Best available drive already fitted'));
      const state3Cards = refitScan.cards.filter(c => c.driveText && c.driveText.includes('No available drive improves this design without unacceptable ΔV loss'));
      console.log(`Refit cards: ${state2Cards.length} in State 2 (best already fitted), ${state3Cards.length} in State 3 (fails floor)`);
      assert.ok(state2Cards.length >= 3, `Expected >= 3 designs with best drive already fitted, found ${state2Cards.length}`);
      assert.ok(state3Cards.length >= 5, `Expected >= 5 designs with fails floor rejected alternative, found ${state3Cards.length}`);
      for (const c of state3Cards) {
        assert.ok(c.hasFailsFloorBadge, `State 3 card "${c.title}" must display fails floor badge`);
      }

      // Open refit detail modal for first design
      const firstBtn = await page.$('.fp-refit-card__btn');
      if (firstBtn) {
        await firstBtn.click();
        await page.waitForTimeout(400);

        const refitModal = await page.evaluate(() => {
          const panel = document.getElementById('mcDetailPanel');
          if (!panel || panel.hidden) return { open: false, factRows: [] };
          const dts = Array.from(panel.querySelectorAll('#detailPanelFacts dt'));
          const dds = Array.from(panel.querySelectorAll('#detailPanelFacts dd'));
          return {
            open: true,
            factRows: dts.map((dt, i) => ({ label: dt.textContent.trim(), value: dds[i]?.textContent.trim() || '' }))
          };
        });

        console.log(`Refit detail modal open: ${refitModal.open}, fact count: ${refitModal.factRows.length}`);
        assert.ok(refitModal.open, 'Refit detail modal must open on click');
        const nonCompFact = refitModal.factRows.find(f => f.label.includes('NON-COMPOSABILITY'));
        assert.ok(nonCompFact, 'Refit modal must carry NON-COMPOSABILITY NOTICE');

        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }

    console.log('\n--- 5. Console & Network Errors Summary ---');
    console.log(`Total console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.error('Console errors:', consoleErrors);
      throw new Error('Console errors encountered during test run');
    }

    console.log(`Total network errors: ${networkErrors.length}`);
    if (networkErrors.length > 0) {
      console.error('Network errors:', networkErrors);
      throw new Error('Network errors encountered during test run');
    }

    console.log('\n🎉 ALL DASHBOARD-WIDE CSS, CONTRAST, AND RESEARCH-VS-PROCUREMENT CHECKS PASSED!\n');
  } catch (err) {
    console.error('\n❌ Verification failed:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

runVerification().catch(err => {
  console.error('\n❌ Fatal verification runner error:', err);
  process.exit(1);
});
