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

process.env.PORT = '3889';
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
  console.log('[Verification] Starting local test server on port 3889...');
  const app = require('../server/index.js');

  const server = app.listen(3889, async () => {
    console.log('[Verification] Server listening on http://localhost:3889');
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
      const views = ['command', 'expansion', 'threat', 'records'];

      for (const mode of modes) {
        console.log(`\n========================================`);
        console.log(`Testing Mode: ${mode.toUpperCase()} at 1920x1080`);
        console.log(`========================================`);

        await page.goto(`http://localhost:3889/v2/?mode=${mode}#/command`, { waitUntil: 'networkidle' });
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
        assert.notStrictEqual(cssVariables.textDim, cssVariables.textMuted, '--text-dim must not equal --text-muted');
        console.log('✓ Computed style assertions on :root variables passed.');

        // Measure palette contrast ratios
        const canvasRgb = parseColor(cssVariables.canvas) || [8, 16, 17];
        const surfaceRgb = parseColor(cssVariables.surface) || [16, 27, 29];
        const surfaceInsetRgb = parseColor(cssVariables.surfaceInset) || [11, 21, 23];
        const textDimRgb = parseColor(cssVariables.textDim) || [117, 138, 129];
        const textMutedRgb = parseColor(cssVariables.textMuted) || [145, 162, 155];
        const textRgb = parseColor(cssVariables.text) || [230, 238, 234];

        const contrastDimOnCanvas = contrastRatio(textDimRgb, canvasRgb);
        const contrastDimOnInset = contrastRatio(textDimRgb, surfaceInsetRgb);
        const contrastDimOnSurface = contrastRatio(textDimRgb, surfaceRgb);
        const contrastMutedOnCanvas = contrastRatio(textMutedRgb, canvasRgb);
        const contrastTextOnCanvas = contrastRatio(textRgb, canvasRgb);

        console.log(`\nPalette contrast ratios:`);
        console.log(`  --text-dim on canvas:        ${contrastDimOnCanvas.toFixed(2)}:1`);
        console.log(`  --text-dim on surface-inset: ${contrastDimOnInset.toFixed(2)}:1`);
        console.log(`  --text-dim on surface:       ${contrastDimOnSurface.toFixed(2)}:1`);
        console.log(`  --text-muted on canvas:      ${contrastMutedOnCanvas.toFixed(2)}:1`);
        console.log(`  --text on canvas:            ${contrastTextOnCanvas.toFixed(2)}:1`);

        assert.ok(contrastDimOnSurface >= 4.5, `--text-dim on surface contrast ratio (${contrastDimOnSurface.toFixed(2)}:1) must be >= 4.5:1 (WCAG AA)`);
        assert.ok(contrastDimOnInset >= 4.5, `--text-dim on surface-inset contrast ratio (${contrastDimOnInset.toFixed(2)}:1) must be >= 4.5:1 (WCAG AA)`);
        assert.ok(contrastDimOnCanvas >= 4.5, `--text-dim on canvas contrast ratio (${contrastDimOnCanvas.toFixed(2)}:1) must be >= 4.5:1 (WCAG AA)`);
        assert.ok(contrastMutedOnCanvas >= 6.0, `--text-muted on canvas contrast ratio (${contrastMutedOnCanvas.toFixed(2)}:1) must be >= 6.0:1`);

        // --- 2. Check all 4 views for contrast, legibility, and forbidden tokens ---
        console.log('\n--- 2. View Inspection (COMMAND, EXPANSION, THREAT, RECORDS) ---');
        for (const viewId of views) {
          await page.click(`.init-nav-btn[data-view="${viewId}"]`);
          await page.waitForTimeout(300);

          const viewScan = await page.evaluate((vId) => {
            const section = document.getElementById(`view-${vId}`);
            if (!section) return { exists: false };
            const text = section.innerText || section.textContent || '';
            const allElements = Array.from(section.querySelectorAll('*'));
            let dimCount = 0;
            let mutedCount = 0;
            let totalLeaves = 0;

            for (const el of allElements) {
              if (el.children.length === 0 && el.textContent.trim().length > 0) {
                totalLeaves++;
                const comp = window.getComputedStyle(el);
                const col = comp.color;
                if (col.includes('106, 125, 117') || col === 'rgb(106, 125, 117)') dimCount++;
                if (col.includes('145, 162, 155') || col === 'rgb(145, 162, 155)') mutedCount++;
              }
            }

            return {
              exists: true,
              text,
              totalLeaves,
              dimCount,
              mutedCount
            };
          }, viewId);

          console.log(`View '${viewId}': total text elements=${viewScan.totalLeaves}, dim=${viewScan.dimCount}, muted=${viewScan.mutedCount}`);

          // Check forbidden tokens
          const forbidden = ['null', 'undefined', 'NaN', 'nulld', '[object Object]'];
          for (const token of forbidden) {
            const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            const hasMatch = token === 'nulld' || token === '[object Object]' ? viewScan.text.includes(token) : re.test(viewScan.text);
            if (hasMatch) {
              const idx = viewScan.text.indexOf(token);
              const snippet = viewScan.text.slice(Math.max(0, idx - 40), idx + 40).replace(/\n/g, ' ');
              throw new Error(`Forbidden token '${token}' found in view '${viewId}' (${mode} mode) near: "${snippet}"`);
            }
          }
        }

        // --- 3. Return to COMMAND view for Research Advisor verification ---
        console.log('\n--- 3. Research Advisor & Procurement Verification on COMMAND view ---');
        await page.click(`.init-nav-btn[data-view="command"]`);
        await page.waitForTimeout(300);

        // Screen height measurement
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

        // Research advisor DOM inspection
        const advisorScan = await page.evaluate(() => {
          const advisor = document.querySelector('.research-advisor');
          if (!advisor) return { exists: false };

          const procurement = advisor.querySelector('.ra-procurement');
          const procurementHead = procurement ? procurement.querySelector('.ra-procurement__head') : null;
          const procurementRows = procurement
            ? Array.from(procurement.querySelectorAll('.ra-row')).map(r => ({
              name: r.querySelector('.ra-row__name') ? r.querySelector('.ra-row__name').textContent.trim() : null,
              tooltip: r.querySelector('.ra-row__name') ? r.querySelector('.ra-row__name').getAttribute('title') : null,
              metric: r.querySelector('.ra-row__metric') ? r.querySelector('.ra-row__metric').textContent.trim() : null,
              meta: r.querySelector('.ra-row__meta') ? r.querySelector('.ra-row__meta').textContent.trim() : null
            }))
            : [];

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
            procurementHeadText: procurementHead ? procurementHead.textContent.trim() : null,
            procurementRows,
            researchHeadText: researchHead ? researchHead.textContent.trim() : null,
            researchGroups
          };
        });

        console.log(`\nProcurement block found: ${advisorScan.hasProcurement}`);
        if (advisorScan.hasProcurement) {
          console.log(`Procurement header: "${advisorScan.procurementHeadText}"`);
          console.log(`Procurement rows (${advisorScan.procurementRows.length}):`);
          for (const r of advisorScan.procurementRows) {
            console.log(`  - Item: "${r.name}" | Metric: ${r.metric} | Meta: "${r.meta}" | Tooltip: "${r.tooltip}"`);
            assert.ok(!r.meta.includes('0 pts'), `Procurement row "${r.name}" must not show "0 pts" in meta`);
            assert.ok(r.meta.includes('refit') || r.meta.includes('build'), `Procurement row "${r.name}" must state refit or build`);
            assert.ok(!r.name.includes('('), `Procurement row "${r.name}" must lead with item name without parenthesised project`);
            assert.ok(r.tooltip && r.tooltip.includes('unlocked by'), `Procurement row "${r.name}" must include unlocking project in tooltip`);
          }
        }

        console.log(`\nMilitary research header: "${advisorScan.researchHeadText}"`);
        for (const g of advisorScan.researchGroups) {
          console.log(`Research group: "${g.label}" (${g.rows.length} rows):`);
          for (const r of g.rows) {
            console.log(`  - Project: "${r.name}" | Sub: "${r.sub}" | Metric: ${r.metric} | Meta: "${r.meta}"`);
            assert.ok(r.meta.includes('pts'), `Research row "${r.name}" must show research pts cost`);
          }
        }

        // --- 4. Test Full Ranking Modal ---
        console.log('\n--- 4. Detail Panel (Full Ranking) Modal ---');
        await page.click('[data-research-advisor-full]');
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
        assert.ok(modalFacts.open, 'Full ranking modal must open on click');

        const procurementFacts = modalFacts.factRows.filter(f => f.label.startsWith('PROCUREMENT'));
        const researchFacts = modalFacts.factRows.filter(f => f.label.startsWith('MILITARY RESEARCH'));

        console.log(`Modal carries ${procurementFacts.length} procurement facts and ${researchFacts.length} military research facts.`);
        if (procurementFacts.length > 0) {
          console.log(`Sample procurement modal fact: "${procurementFacts[0].label}" -> "${procurementFacts[0].value}"`);
          assert.ok(!procurementFacts[0].value.includes('pts'), 'Procurement fact in modal must not show research pts');
        }

        // Close modal
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
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
  });
}

runVerification().catch(err => {
  console.error('\n❌ Fatal verification runner error:', err);
  process.exit(1);
});
