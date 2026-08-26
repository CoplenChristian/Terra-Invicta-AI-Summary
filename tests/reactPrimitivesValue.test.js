/**
 * tests/reactPrimitivesValue.test.js
 *
 * Purpose: Value distinguishes measured zero from absent and unavailable states,
 *   and its `as` escape hatch really renders inside an SVG (defect #19).
 *
 * WHY THE SVG TEST MEASURES GEOMETRY RATHER THAN READING TEXT
 * -----------------------------------------------------------
 * `<Value>`'s default `<span>`, placed inside an `<svg>`, is created by React in
 * the SVG namespace. It is a node with no rendering behaviour — but it still
 * carries its characters in `innerHTML` and `textContent`. Every text-scraping
 * assertion in this repo (`visibleText`, `assertNoPlaceholderText`, every
 * `text.includes(...)` in tests/world-map.test.js) would therefore pass over a
 * figure no reader can see. So the guard is `getComputedTextLength()`: the
 * tspan host paints its digits and the span host does not, and the two hosts
 * are otherwise byte-identical.
 *
 * RED PROOF (2026-08-26): changing `as="tspan"` to `as="span"` in the harness's
 * tspan host made 'the as escape hatch renders inside SVG…' fail on
 * `hasGetBBox` (true -> false) — and the text-only assertions in the same test
 * stayed green, which is the point.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

test('Value renders measured zero, absent, and unavailable differently', async () => {
  await withPrimitivesHarnessPage('value', async (page) => {
    const states = await page.evaluate(() => {
      const read = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return {
          text: (el.textContent || '').trim(),
          state: el.getAttribute('data-value-state'),
        };
      };
      return {
        zero: read('value-zero'),
        absent: read('value-absent'),
        unavailable: read('value-unavailable'),
      };
    });

    assert.equal(states.zero.state, 'measured');
    assert.equal(states.zero.text, '0');
    assert.equal(states.absent.state, 'absent');
    assert.equal(states.absent.text, '—');
    assert.equal(states.unavailable.state, 'unavailable');
    assert.equal(states.unavailable.text, 'UNAVAILABLE');
    assert.notEqual(states.zero.text, states.absent.text);
  });
});

test('the as escape hatch renders inside SVG, where the default span does not', async () => {
  await withPrimitivesHarnessPage('valueSvg', async (page) => {
    await page.waitForSelector('[data-testid="harness-value-svg"]', { timeout: 15000 });

    const probe = await page.evaluate(() => {
      const read = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return null;
        let box = null;
        try { box = typeof el.getBBox === 'function' ? el.getBBox() : null; } catch { box = null; }
        return {
          tag: el.tagName,
          namespace: el.namespaceURI,
          state: el.getAttribute('data-value-state'),
          primitive: el.getAttribute('data-primitive'),
          cls: el.getAttribute('class'),
          text: (el.textContent || '').trim(),
          hasGetBBox: typeof el.getBBox === 'function',
          width: box ? box.width : null,
        };
      };
      const hostLength = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el && typeof el.getComputedTextLength === 'function'
          ? el.getComputedTextLength()
          : null;
      };
      return {
        tspan: read('svg-value-tspan'),
        span: read('svg-value-span'),
        absent: read('svg-value-absent'),
        tspanHostLength: hostLength('svg-host-tspan'),
        spanHostLength: hostLength('svg-host-span'),
        absentHostLength: hostLength('svg-host-absent'),
      };
    });

    // 1. The escape hatch emits an SVG-native node that still carries the whole
    //    contract — the tag name is delegated, the attributes are not.
    assert.equal(probe.tspan.tag, 'tspan');
    assert.equal(probe.tspan.namespace, 'http://www.w3.org/2000/svg');
    assert.equal(probe.tspan.primitive, 'value');
    assert.equal(probe.tspan.state, 'measured');
    assert.equal(probe.tspan.cls, 'value-measured');
    assert.equal(probe.tspan.text, '0');

    // 2. It actually RENDERS. A non-rendering node has no geometry at all.
    assert.equal(probe.tspan.hasGetBBox, true, 'a rendered tspan is an SVGGraphicsElement');
    assert.ok(probe.tspan.width > 0, `the measured zero must occupy width, got ${probe.tspan.width}`);

    // 3. The control: the default span in the same position does not render,
    //    even though its text is present in the DOM. This is what makes (2) a
    //    real assertion rather than a tautology.
    assert.equal(probe.span.tag, 'span');
    assert.equal(probe.span.namespace, 'http://www.w3.org/2000/svg',
      'React creates <span> in the SVG namespace here — that is the defect');
    assert.equal(probe.span.text, '0', 'the unrendered span still holds its text, which is why scraping cannot catch this');
    assert.equal(probe.span.hasGetBBox, false, 'a namespaced <span> is not an SVGGraphicsElement');

    // 4. Same host, same content, different `as`: only the tspan paints.
    assert.ok(
      probe.tspanHostLength > probe.spanHostLength,
      `tspan host must paint more glyphs than the span host: ${probe.tspanHostLength} vs ${probe.spanHostLength}`,
    );

    // 5. The absent affordance survives the hop as a painted glyph.
    assert.equal(probe.absent.state, 'absent');
    assert.equal(probe.absent.text, '—');
    assert.ok(probe.absent.width > 0, 'the em dash must be rendered, not merely held');
    assert.ok(
      probe.absentHostLength > probe.spanHostLength,
      'the absent host paints "H —"; the span host paints only "H "',
    );
  });
});
