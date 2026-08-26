// tests/unlockedTechRendering.test.js
//
// Purpose: characterisation coverage for the UNLOCKED TECHNOLOGY panel (RECORDS)
//   — what a reader actually sees for each of its eight render states. Drives a
//   real browser through the primitives harness against stubbed
//   /api/intel/tech-tree and /api/intel/tech-search endpoints.
//
// WHY THIS FILE EXISTS AND WHEN IT WAS WRITTEN
// --------------------------------------------
// The panel had no rendering suite. tests/unlockedTechPanel.test.js covers the
// shell wiring and — before the React port — asserted four properties by
// grepping the vanilla component's SOURCE TEXT, which a rewrite invalidates even
// when the rendered output is byte-identical. Those four properties are now
// asserted here as behaviour instead: the announced row cap, the absent research
// cost, the display-name-only match explanation and server-side search. Nothing
// was dropped — those four guards were repointed at the React sources rather
// than deleted, and the two census tests that ran the vanilla panel in a `vm`
// sandbox were repointed at this file's browser harness with every assertion and
// every message intact.
//
// EVERY ASSERTION BELOW WAS WRITTEN AND CONFIRMED GREEN AGAINST THE VANILLA
// COMPONENT FIRST, on 2026-08-26, with tests/fixtures/unlockedTechBrowser.js's
// `mountUnlockedTech` injecting public/v2/js/components/unlocked-tech.js into
// the harness page. Only that one driver function changed when the React panel
// replaced it. A fixture captured from post-change output would have pinned
// whatever the new code happened to do, including its bugs.
//
// MODE
// ----
// The panel reads the observer's OWN research. `mode` travels the request path
// as a dead parameter (docs/react-component-contracts-detail.md §2 — `mode` is
// placed on `saveState` at shared/techGraph.mjs:1084 and never read). Test 2
// therefore pins the stronger claim: the two modes render IDENTICAL text, and
// mode is still threaded into both request URLs.
//
// RED PROOF (2026-08-26): deleted the presence guard from `costLabel` in
//   src/v2/panels/unlockedTechUtils.js — both the
//   `if (cost === null || cost === undefined || cost === '') return null;` line
//   and the `Number.isFinite` refusal — leaving the classic `Number(cost) || 0`
//   coercion this repo keeps re-introducing. The harness was rebuilt and this
//   file went red, 2 of 19 failing:
//   - "research cost: absent, empty and non-numeric all say UNAVAILABLE, and a
//     measured zero still reads as zero": expected /RESEARCH COST UNAVAILABLE/
//     on the null-cost row, got 'Project_BravoMATERIALS0 pts'.
//   - "a category is camel-split and uppercased...": the meta chips for the
//     empty- and absent-category rows read ['0 pts'] instead of
//     ['RESEARCH COST UNAVAILABLE'].
//   tests/unlockedTechPanel.test.js's ported source guard went red on the same
//   change ("an absent research cost renders as unavailable, never as zero",
//   11/12). The guard was restored; 19/19 and 12/12 pass.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  bulkProjects,
  clickScope,
  getFooterText,
  getPanelText,
  getRowTexts,
  mountUnlockedTech,
  project,
  startUnlockedTechHarness,
  stopUnlockedTechHarness,
  typeQuery,
  unlock,
  waitForStable,
} = require('./fixtures/unlockedTechBrowser.js');

before(async () => { await startUnlockedTechHarness(); }, { timeout: 180000 });
after(async () => { await stopUnlockedTechHarness(); });

/* ------------------------------------------------------------------ *
 * Graphs
 * ------------------------------------------------------------------ */

/**
 * The workhorse graph. Five faction_projects and one non-project node, so the
 * `type === 'faction_project'` filter is exercised by every scenario that uses
 * it rather than by one test that could be deleted.
 *
 * Costs deliberately span the four cases the panel distinguishes: a real
 * number, a real ZERO, null, '' and a non-numeric string.
 */
const MIXED_NODES = [
  project({
    id: 'Project_Alpha',
    displayName: 'Alpha Beam',
    status: 'completed',
    researchCost: 1200,
    category: 'MilitaryScience',
    unlocks: [unlock('u_alpha', 'Alpha Emitter')],
  }),
  project({
    id: 'Project_Bravo',
    displayName: 'Bravo Hull',
    status: 'available',
    researchCost: null,
    category: 'Materials',
  }),
  project({
    id: 'Project_Charlie',
    displayName: 'Charlie Drive',
    status: 'researching',
    researchCost: '',
    category: '',
  }),
  project({
    id: 'Project_Delta',
    displayName: 'Delta Array',
    status: null,
    researchCost: 'not-a-number',
  }),
  project({
    id: 'Project_Echo',
    displayName: 'Echo Free',
    status: 'completed',
    researchCost: 0,
    category: 'AppliedScience',
  }),
  { id: 'tech_root', type: 'tech', displayName: 'Not a project', status: 'completed' },
];

/* ------------------------------------------------------------------ *
 * 1-2 · headline render, both modes
 * ------------------------------------------------------------------ */

test("the panel mounts and renders the observer's unlocked projects with its census and cap footer", async () => {
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes: MIXED_NODES } } });
  try {
    const rows = await getRowTexts(page);
    assert.deepEqual(rows, [
      'Alpha Beam Project_Alpha MILITARY SCIENCE 1,200 pts 1 item Alpha Emitter',
      'Echo Free Project_Echo APPLIED SCIENCE 0 pts',
    ], 'the default scope lists only completed projects, sorted by display name');

    assert.equal(
      await getFooterText(page),
      '2 unlocked of 5 projects. 2 shown of 2 matching.',
      'the census counts faction_project nodes only, and the cap line reports shown-of-matching',
    );
  } finally {
    await page.close();
  }
});

test('player and omniscient render identical text, and mode is still threaded into both endpoints', async () => {
  const search = {
    items: [project({ id: 'Project_Alpha', displayName: 'Alpha Beam', researchCost: 1200 })],
  };

  const seen = {};
  for (const mode of ['player', 'omniscient']) {
    const { page, calls } = await mountUnlockedTech({
      mode,
      routes: { tree: { nodes: MIXED_NODES }, search },
    });
    try {
      await typeQuery(page, 'alpha');
      seen[mode] = await getPanelText(page);
      assert.ok(
        calls.tree.some((url) => url.includes(`mode=${mode}`)),
        `the tech-tree request must carry mode=${mode}`,
      );
      assert.ok(
        calls.search.some((url) => url.includes(`mode=${mode}`)),
        `the tech-search request must carry mode=${mode}`,
      );
    } finally {
      await page.close();
    }
  }

  assert.equal(
    seen.player,
    seen.omniscient,
    'this is the observer\'s own research; the two modes must not diverge',
  );
});

/* ------------------------------------------------------------------ *
 * 3-5 · row anatomy
 * ------------------------------------------------------------------ */

test('the ALL scope lists every project with a status chip, and an absent status reads UNKNOWN', async () => {
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes: MIXED_NODES } } });
  try {
    await clickScope(page, 'all');
    const rows = await getRowTexts(page);
    assert.equal(rows.length, 5, 'ALL drops the completed-only filter');

    const chips = await page.evaluate(() => Array.from(
      document.querySelectorAll('#unlockedTech .ut-row'),
    ).map((row) => {
      const chip = row.querySelector('.ut-status');
      return [row.querySelector('.ut-row__project').textContent.trim(), chip ? chip.textContent.trim() : null];
    }));

    assert.deepEqual(chips, [
      ['Alpha Beam', 'COMPLETED'],
      ['Bravo Hull', 'AVAILABLE'],
      ['Charlie Drive', 'RESEARCHING'],
      ['Delta Array', 'UNKNOWN'],
      ['Echo Free', 'COMPLETED'],
    ], 'a project whose status the graph does not carry is UNKNOWN, not assumed locked');
  } finally {
    await page.close();
  }
});

test('research cost: absent, empty and non-numeric all say UNAVAILABLE, and a measured zero still reads as zero', async () => {
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes: MIXED_NODES } } });
  try {
    await clickScope(page, 'all');
    const costs = await page.evaluate(() => Array.from(
      document.querySelectorAll('#unlockedTech .ut-row'),
    ).map((row) => {
      const meta = row.querySelector('.ut-row__meta');
      return [
        row.querySelector('.ut-row__project').textContent.trim(),
        meta ? meta.textContent.replace(/\s+/g, ' ').trim() : '',
      ];
    }));

    const costOf = (name) => costs.find(([project]) => project === name)[1];

    // Number(null) === 0 and Number('') === 0. All three must refuse.
    assert.match(costOf('Bravo Hull'), /RESEARCH COST UNAVAILABLE/, 'a null cost is unavailable, not zero');
    assert.match(costOf('Charlie Drive'), /RESEARCH COST UNAVAILABLE/, 'an empty-string cost is unavailable, not zero');
    assert.match(costOf('Delta Array'), /RESEARCH COST UNAVAILABLE/, 'a non-numeric cost is unavailable, not zero');

    // ...and the converse: a cost that really is zero must not be laundered
    // into "unavailable" by a truthiness test.
    assert.match(costOf('Echo Free'), /0 pts/, 'a measured zero cost is a measurement, not an absence');
    assert.ok(
      !/RESEARCH COST UNAVAILABLE/.test(costOf('Echo Free')),
      'a measured zero must not be reported as unavailable',
    );
    assert.match(costOf('Alpha Beam'), /1,200 pts/, 'a measured cost is grouped for reading');
  } finally {
    await page.close();
  }
});

test('a category is camel-split and uppercased, and an absent category is omitted rather than blanked', async () => {
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes: MIXED_NODES } } });
  try {
    await clickScope(page, 'all');
    const metas = await page.evaluate(() => Array.from(
      document.querySelectorAll('#unlockedTech .ut-row'),
    ).map((row) => [
      row.querySelector('.ut-row__project').textContent.trim(),
      Array.from(row.querySelectorAll('.ut-row__meta .ut-meta-item'))
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
    ]));
    const metaOf = (name) => metas.find(([project]) => project === name)[1];

    assert.ok(metaOf('Alpha Beam').includes('MILITARY SCIENCE'), 'MilitaryScience splits on the case boundary');
    assert.ok(metaOf('Echo Free').includes('APPLIED SCIENCE'), 'AppliedScience splits on the case boundary');

    // '' and undefined both drop the chip entirely — no empty meta item.
    assert.deepEqual(metaOf('Charlie Drive'), ['RESEARCH COST UNAVAILABLE'], 'an empty category renders no chip at all');
    assert.deepEqual(metaOf('Delta Array'), ['RESEARCH COST UNAVAILABLE'], 'an absent category renders no chip at all');
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------------ *
 * 6-7 · the two caps
 * ------------------------------------------------------------------ */

test('the row cap announces itself with both totals and names the cap and the remedy', async () => {
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes: bulkProjects(65) } } });
  try {
    const rows = await getRowTexts(page);
    assert.equal(rows.length, 60, 'the display cap is 60 rows');

    assert.equal(
      await getFooterText(page),
      '65 unlocked of 65 projects. 60 shown of 65 matching — 5 omitted by the 60-row display cap; '
      + 'narrow the search to see them.',
      'a capped list carries its total and omitted counts, names the cap and says how to see the rest',
    );
  } finally {
    await page.close();
  }
});

test('an uncapped list reports shown-of-matching without inventing an omission', async () => {
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes: bulkProjects(60) } } });
  try {
    assert.equal((await getRowTexts(page)).length, 60, 'exactly at the cap, nothing is omitted');
    const footer = await getFooterText(page);
    assert.equal(footer, '60 unlocked of 60 projects. 60 shown of 60 matching.');
    assert.ok(!/omitted/.test(footer), 'a complete list must not claim rows were dropped');
  } finally {
    await page.close();
  }
});

test('the per-row unlock list caps at six and keeps the TRUE item count beside the row', async () => {
  const nodes = [
    project({
      id: 'Project_Many',
      displayName: 'Many Items',
      unlocks: Array.from({ length: 9 }, (_, i) => unlock(`u${i}`, `Item ${i + 1}`)),
    }),
    project({ id: 'Project_One', displayName: 'One Item', unlocks: [unlock('solo', 'Solo Item')] }),
  ];
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes } } });
  try {
    const chips = await page.evaluate(() => Array.from(
      document.querySelectorAll('#unlockedTech .ut-row'),
    ).map((row) => Array.from(row.querySelectorAll('.ut-unlock'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())));

    assert.deepEqual(chips[0], [
      'Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6', '+3 more of 9',
    ], 'six chips render and the remainder is announced against the true total');

    const rows = await getRowTexts(page);
    assert.match(rows[0], /9 items/, 'the count beside the row is the true count, not the shown count');
    assert.match(rows[1], /1 item(?!s)/, 'a single item is not pluralised');
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------------ *
 * 8-10 · the census
 * ------------------------------------------------------------------ */

test('an unreadable project census says so, and never prints a confident 0 of 0', async () => {
  // The graph is a static parse of the game templates — the same projects for
  // every faction — so no faction_project nodes is a census that could not be
  // read, not a faction with nothing researched. Missing and empty are the same
  // unreadable state; both used to land on "0 unlocked of 0 projects".
  for (const [label, tree] of [['missing', {}], ['empty', { nodes: [] }], ['no projects', { nodes: [{ id: 'tech_root', type: 'tech' }] }]]) {
    const { page } = await mountUnlockedTech({ routes: { tree } });
    try {
      const text = await getPanelText(page);
      assert.match(
        text,
        /The project census is unavailable, so this panel cannot say what this faction has unlocked\./,
        `nodes ${label}: the empty state must say the census could not be read`,
      );
      assert.ok(
        !/has not completed any research projects/.test(text),
        `nodes ${label}: an unread graph must not be reported as a faction with no research`,
      );
      assert.ok(
        !/0 unlocked of 0 projects/.test(text),
        `nodes ${label}: an absent census must not be coerced to zero`,
      );
    } finally {
      await page.close();
    }
  }
});

test('a census that could not be read still says so in the footer beneath real search rows', async () => {
  const { page } = await mountUnlockedTech({
    routes: {
      tree: { nodes: [] },
      search: { items: [project({ id: 'Project_Laser', displayName: 'Basic Lasers', researchCost: 100 })] },
    },
  });
  try {
    await typeQuery(page, 'laser');
    const text = await getPanelText(page);
    assert.match(text, /Basic Lasers/, 'the search endpoint answers independently of the graph');
    assert.match(text, /Project census unavailable\./, 'the footer must declare the census unavailable');
    assert.ok(!/0 unlocked of 0 projects/.test(text), 'an absent census must not be coerced to zero');

    // The two footer facts are independent: the census can be unreadable while
    // the cap line is perfectly well measured.
    assert.match(await getFooterText(page), /Project census unavailable\. 1 shown of 1 matching\./);
  } finally {
    await page.close();
  }
});

test('a census that WAS read, with nothing completed, reports that — not an unreadable census', async () => {
  const nodes = [
    project({ id: 'Project_A', displayName: 'Alpha', status: 'available' }),
    project({ id: 'Project_B', displayName: 'Bravo', status: 'locked' }),
    project({ id: 'Project_C', displayName: 'Charlie', status: 'researching' }),
  ];
  const { page } = await mountUnlockedTech({ routes: { tree: { nodes } } });
  try {
    const text = await getPanelText(page);
    assert.match(
      text,
      /This faction has not completed any research projects yet\./,
      'a read census is the evidence that "nothing unlocked" is a measurement',
    );
    assert.ok(!/census is unavailable/.test(text), 'a readable census must not be reported as unavailable');
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------------ *
 * 11-14 · search
 * ------------------------------------------------------------------ */

test('search is server-side: the panel renders what the server returned, including rows the query appears nowhere in', async () => {
  const { page, calls } = await mountUnlockedTech({
    routes: {
      tree: { nodes: MIXED_NODES },
      search: {
        items: [
          project({ id: 'Project_Zulu', displayName: 'Zulu Reactor', researchCost: 50 }),
          project({ id: 'Project_Yankee', displayName: 'Yankee Radiator', researchCost: 60 }),
        ],
      },
    },
  });
  try {
    await typeQuery(page, 'copperhead');
    const rows = await getRowTexts(page);
    assert.equal(rows.length, 2, 'both server rows render; the panel does not re-filter them');
    assert.match(rows[0], /Yankee Radiator/);
    assert.match(rows[1], /Zulu Reactor/);

    assert.ok(
      calls.search.some((url) => url.includes('q=copperhead')),
      'a typed query goes to the tech-search endpoint with the query attached',
    );
  } finally {
    await page.close();
  }
});

test('the match explanation keys on the display name only, since ids leak the query term', async () => {
  // Project_CopperheadMissileBay's ID contains "Copperhead" while its display
  // name (Hydrolox High Explosive Missiles) does not. Treating the id as a
  // self-evident name match suppressed the chip that explains why the row is
  // here — the panel's whole reason for existing.
  const copperhead = project({
    id: 'Project_CopperheadMissileBay',
    displayName: 'Hydrolox High Explosive Missiles',
    researchCost: 340,
    unlocks: [unlock('bay', 'Copperhead Missile Bay'), unlock('warhead', 'Hydrolox Warhead')],
  });
  const { page } = await mountUnlockedTech({
    routes: { tree: { nodes: MIXED_NODES }, search: { items: [copperhead] } },
  });
  try {
    await typeQuery(page, 'copperhead');
    const matched = await page.evaluate(() => Array.from(
      document.querySelectorAll('#unlockedTech .ut-unlock--matched'),
    ).map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(matched, ['Copperhead Missile Bay MATCHED'],
      'the item that carries the query term is the one marked');

    // The same row, matched on its own display name, needs no explanation.
    await typeQuery(page, 'hydrolox');
    const stillMatched = await page.evaluate(
      () => document.querySelectorAll('#unlockedTech .ut-unlock--matched').length,
    );
    assert.equal(stillMatched, 0, 'a row whose own name matches is self-explanatory');
  } finally {
    await page.close();
  }
});

test('an empty result set gets a scope-aware notice that offers ALL only when scoped to unlocked', async () => {
  const { page } = await mountUnlockedTech({
    routes: { tree: { nodes: MIXED_NODES }, search: { items: [] } },
  });
  try {
    await typeQuery(page, 'zzz');
    const scoped = await getPanelText(page);
    assert.match(scoped, /Nothing unlocked matches “zzz”\./);
    assert.match(scoped, /Switch to ALL to search the projects this faction has not completed\./);

    await clickScope(page, 'all');
    const all = await getPanelText(page);
    assert.match(all, /Nothing matches “zzz”\./);
    assert.ok(
      !/Switch to ALL/.test(all),
      'the remedy must not be offered once it is already applied',
    );
  } finally {
    await page.close();
  }
});

test('the scope filter applies to search results as well as to the graph', async () => {
  const items = [
    project({ id: 'Project_Done', displayName: 'Done Thing', status: 'completed' }),
    project({ id: 'Project_Open', displayName: 'Open Thing', status: 'available' }),
  ];
  const { page } = await mountUnlockedTech({
    routes: { tree: { nodes: MIXED_NODES }, search: { items } },
  });
  try {
    const projectNames = () => page.evaluate(() => Array.from(
      document.querySelectorAll('#unlockedTech .ut-row__project'),
    ).map((el) => el.textContent.trim()));

    await typeQuery(page, 'thing');
    assert.deepEqual(
      await projectNames(),
      ['Done Thing'],
      'UNLOCKED scope hides a search hit the faction has not completed',
    );

    await clickScope(page, 'all');
    assert.deepEqual(
      await projectNames(),
      ['Done Thing', 'Open Thing'],
      'ALL scope shows it',
    );
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------------ *
 * 15-18 · failure, races, caching, loading
 * ------------------------------------------------------------------ */

test('an endpoint failure names the reason the server gave, and falls back to the HTTP status', async () => {
  const named = await mountUnlockedTech({
    routes: { tree: { status: 503, body: { error: 'techTree payload missing from this snapshot' } } },
  });
  try {
    assert.match(
      await getPanelText(named.page),
      /The unlocked technology index is unavailable: techTree payload missing from this snapshot/,
      "the server's own explanation is what the reader needs",
    );
  } finally {
    await named.page.close();
  }

  const bare = await mountUnlockedTech({ routes: { tree: { status: 502, body: {} } } });
  try {
    assert.match(
      await getPanelText(bare.page),
      /The unlocked technology index is unavailable: HTTP 502/,
      'with no explanation to relay, the status is stated rather than invented',
    );
  } finally {
    await bare.page.close();
  }
});

test('a stale in-flight response never overwrites a newer one', async () => {
  const { page } = await mountUnlockedTech({
    routes: {
      tree: { nodes: MIXED_NODES },
      search: (url) => (url.includes('q=slow')
        ? { delayMs: 900, body: { items: [project({ id: 'Project_Slow', displayName: 'Stale Answer' })] } }
        : { items: [project({ id: 'Project_Fast', displayName: 'Fresh Answer' })] }),
    },
  });
  try {
    await page.fill('#unlockedTechQuery', 'slow');
    await page.waitForTimeout(400);   // past the 220ms debounce: the slow request is in flight
    await page.fill('#unlockedTechQuery', 'fast');
    await waitForStable(page, { quietMs: 1200 });

    const text = await getPanelText(page);
    assert.match(text, /Fresh Answer/, 'the newest query owns the panel');
    assert.ok(!/Stale Answer/.test(text), 'a response for an abandoned keystroke must be discarded');
  } finally {
    await page.close();
  }
});

test('the research graph is fetched once and reused across scope and query changes', async () => {
  const { page, calls } = await mountUnlockedTech({
    routes: {
      tree: { nodes: MIXED_NODES },
      search: { items: [project({ id: 'Project_Alpha', displayName: 'Alpha Beam' })] },
    },
  });
  try {
    assert.equal(calls.tree.length, 1, 'the graph is read on first activation');
    const [treeUrl] = calls.tree;
    assert.match(treeUrl, /observer=4712/);
    assert.match(treeUrl, /category=all/);
    assert.match(treeUrl, /includeEffects=false/, 'effects are not requested — the panel never reads them');

    await clickScope(page, 'all');
    await typeQuery(page, 'alpha');
    await clickScope(page, 'unlocked');

    assert.equal(
      calls.tree.length, 1,
      'the ~570KB graph must not be re-read for a scope toggle or a keystroke',
    );
    assert.ok(calls.search.length >= 1, 'the typed query still reaches the search endpoint');
  } finally {
    await page.close();
  }
});

test('the loading state is shown while the graph is still arriving', async () => {
  const { page } = await mountUnlockedTech({
    routes: { tree: { delayMs: 1500, body: { nodes: MIXED_NODES } } },
    settle: false,
  });
  try {
    await page.waitForSelector('#unlockedTech .ut-notice', { timeout: 5000 });
    assert.match(
      await getPanelText(page),
      /Reading the research graph…/,
      'an unfinished read says it is unfinished rather than showing an empty list',
    );
    await page.waitForSelector('#unlockedTech .ut-row', { timeout: 15000 });
    await waitForStable(page);
    assert.match(await getPanelText(page), /Alpha Beam/, 'and is replaced by the answer when it lands');
    assert.ok(
      !/Reading the research graph…/.test(await getPanelText(page)),
      'the loading notice is retired once the graph is read',
    );
  } finally {
    await page.close();
  }
});
