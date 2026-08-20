/**
 * Regression tests for the v2 mining expansion board.
 *
 * Two defects are pinned here, both of which shipped:
 *
 *  1. The renderer interpolated payload values straight into template
 *     literals, so `${c.buildTimeDays}d` printed the literal text "nulld" on
 *     all 109 rows of a live save -- an unowned site has no mine under
 *     construction, so the save records no build duration for it.
 *  2. The component was added to public/v2/index.html as a <script> tag but
 *     the page had no `#miningExpansion` element to mount it in, so
 *     mission-control.js looked the element up, found nothing, and skipped
 *     the render entirely. The same omission left the component out of the
 *     hosted asset manifest and broke `npm run build:site`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'mining-expansion.js');
const v2ShellPath = path.join(repoRoot, 'public', 'v2', 'index.html');
const v1ShellPath = path.join(repoRoot, 'public', 'index.html');

// Minimal browser surface: the component only assigns `root.innerHTML`.
function loadMiningComponent() {
  const source = fs.readFileSync(componentPath, 'utf8');
  const sandbox = { window: {}, console, fetch: () => Promise.resolve(null) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: componentPath });
  return sandbox.window.MissionControlMiningExpansion;
}

function renderToString(payload) {
  const component = loadMiningComponent();
  const root = { innerHTML: '' };
  component.render(root, payload);
  return root.innerHTML;
}

// Text a reader would actually see, tags stripped, so an attribute value can
// never mask a null that reaches the visible copy.
function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

const LIVE_SHAPED_CANDIDATE = {
  siteId: 5156,
  displayName: 'Creag Màthair',
  parentBodyName: '31 Euphrosyne',
  spaceTheaterKey: 'belt',
  spaceTheaterName: 'BELT / CERES',
  siteDensity: 6.61,
  siteDensityMeasured: true,
  siteDensityAssumed: false,
  siteDensitySource: 'site template Density',
  yields: {
    water: { daily: 2.517, monthly: 75.5, measured: true },
    volatiles: { daily: 3.204, monthly: 96.1, measured: true },
    metals: { daily: 0, monthly: 0, measured: true },
    nobleMetals: { daily: 0, monthly: 0, measured: true },
    fissiles: { daily: 0, monthly: 0, measured: true }
  },
  resourceGains: { water: 1.7893, volatiles: 0.1016, metals: 0, nobleMetals: 0, fissiles: 0 },
  unmeasuredResources: [],
  scoreInputsComplete: true,
  siteValue: 9.374,
  siteValueMeasured: true,
  mcCost: 1,
  hateCost: 0.3,
  hateCostAvailable: true,
  wouldExceedMineLimit: false,
  valuePerHate: 31.247,
  // The live save reports this as null for EVERY unowned site.
  buildTimeDays: null,
  destinationTech: 'MissiontotheAsteroids',
  destinationTechName: 'Mission to the Asteroids',
  destinationTechSource: 'space theater'
};

const LIVE_SHAPED_PAYLOAD = {
  capacity: {
    minesBuilt: 15,
    mineLimit: 18,
    headroom: 3,
    overLimit: false,
    excess: 0,
    penaltyMC: 0,
    penaltyHate: 0,
    marginalNextMinePenaltyMC: 0,
    marginalNextMinePenaltyHate: 0,
    mcWarFloorDistance: 44.7,
    baseHateMultiplier: 0.3,
    hateCostAvailable: true,
    difficulty: 'Normal',
    difficultyMeasured: true,
    difficultyMultiplier: 0.3,
    concealmentMultiplier: 1
  },
  resourceRunways: {
    water: { key: 'water', stock: 937.76, income: 264.01, net: 261.9, consumption: 2.11, runwayMonths: 444.4, status: 'comfortable' },
    volatiles: { key: 'volatiles', stock: 7001.77, income: 364.19, net: -582.25, consumption: 946.44, runwayMonths: 7.4, status: 'tight' }
  },
  available: [LIVE_SHAPED_CANDIDATE],
  availableTotalCount: 109,
  availableOmittedCount: 0,
  availableUnmeasuredCount: 0,
  techGated: [{ missingTech: 'MissiontoSaturn', missingTechName: 'Mission to Saturn', siteCount: 39, unmeasuredSiteCount: 0, bestSiteValue: 2.51, sites: [] }],
  unreachable: { totalSites: 187 }
};

test('an unowned site with no recorded build duration renders "build n/a", never "nulld"', () => {
  const html = renderToString(LIVE_SHAPED_PAYLOAD);
  assert.ok(html.includes('1 MC · build n/a'), 'the cost cell must state the build time is unavailable');
  assert.ok(!html.includes('nulld'), 'the "nulld" regression must not come back');
  assertNoPlaceholderText(html, 'live-shaped payload');
});

test('the board reports the TRUE available-site total, not the length of the truncated view', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...LIVE_SHAPED_CANDIDATE, siteId: 6000 + i }));
  const html = renderToString({ ...LIVE_SHAPED_PAYLOAD, available: many, availableTotalCount: 109 });
  assert.ok(html.includes('AVAILABLE EXPANSION SITES (109)'), 'the header must carry the true total');
  assert.ok(/Top 8 of 109/.test(html), 'the truncation must be stated, not implied');
});

test('every unmeasured payload value renders as an honest unavailable state', () => {
  const degraded = {
    capacity: {
      minesBuilt: 15, mineLimit: 18, headroom: 3, overLimit: false, excess: 0,
      penaltyMC: 0, penaltyHate: null,
      marginalNextMinePenaltyMC: 0, marginalNextMinePenaltyHate: null,
      mcWarFloorDistance: null,
      baseHateMultiplier: null, hateCostAvailable: false,
      difficulty: null, difficultyMeasured: false, difficultyMultiplier: null, concealmentMultiplier: 1
    },
    resourceRunways: {
      water: { key: 'water', stock: null, income: null, net: null, consumption: null, runwayMonths: null, status: 'unmeasured' },
      volatiles: { key: 'volatiles', stock: 10, income: null, net: null, consumption: null, runwayMonths: null, status: 'consumption_unknown' }
    },
    available: [{
      siteId: 1,
      displayName: 'Unmeasured Site',
      parentBodyName: 'Nowhere',
      spaceTheaterKey: 'unassigned',
      siteDensity: 1.0,
      siteDensityMeasured: false,
      siteDensityAssumed: true,
      siteDensitySource: 'assumed 1.0 (site template Density not resolved)',
      yields: {
        water: { daily: null, monthly: null, measured: false },
        volatiles: { daily: null, monthly: null, measured: false },
        metals: { daily: null, monthly: null, measured: false },
        nobleMetals: { daily: null, monthly: null, measured: false },
        fissiles: { daily: null, monthly: null, measured: false }
      },
      resourceGains: {},
      unmeasuredResources: ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles'],
      scoreInputsComplete: false,
      siteValue: null,
      siteValueMeasured: false,
      mcCost: 1,
      hateCost: null,
      hateCostAvailable: false,
      wouldExceedMineLimit: false,
      valuePerHate: null,
      buildTimeDays: null,
      destinationTechSource: 'assumed main belt (body not in the theater table)'
    }],
    availableTotalCount: 1,
    availableOmittedCount: 0,
    availableUnmeasuredCount: 1,
    techGated: [{ missingTech: 'MissiontoSaturn', missingTechName: 'Mission to Saturn', siteCount: null, unmeasuredSiteCount: null, bestSiteValue: null, sites: [] }],
    unreachable: { totalSites: null }
  };

  const html = renderToString(degraded);
  assertNoPlaceholderText(html, 'fully degraded payload');

  assert.ok(html.includes('ALIEN-HATE COSTS UNAVAILABLE'), 'an unpriceable hate cost is stated, not hidden');
  assert.ok(html.includes('HATE UNKNOWN'), 'an unknown hate cost must not use the FREE badge');
  assert.ok(!html.includes('mining-tag--free'), 'unknown must never be rendered as free');
  assert.ok(html.includes('YIELDS UNMEASURED'), 'unmeasured yields are named, not reported as trace amounts');
  assert.ok(html.includes('(assumed)'), 'an assumed density is labelled as an assumption');
  assert.ok(html.includes('not scoreable'), 'a site with nothing evaluable is not scored as zero utility');
  assert.ok(html.includes('War Floor: <strong>unavailable</strong>'), 'an uncomputable war floor says so');
  assert.ok(html.includes('site count unavailable'), 'an unreadable gated site count is not folded in as 0');
  assert.ok(!/Unmeasured Site[\s\S]*?0\.00/.test(visibleText(html)), 'an unscoreable site must not print 0.00');
});

test('an over-limit capacity with an unknown hate multiplier does not report a costless penalty', () => {
  const html = renderToString({
    ...LIVE_SHAPED_PAYLOAD,
    capacity: {
      ...LIVE_SHAPED_PAYLOAD.capacity,
      minesBuilt: 25, mineLimit: 21, headroom: 0, overLimit: true, excess: 4,
      penaltyMC: 8, penaltyHate: null,
      marginalNextMinePenaltyMC: 4, marginalNextMinePenaltyHate: null,
      baseHateMultiplier: null, hateCostAvailable: false, difficultyMeasured: false, difficulty: null
    }
  });
  assertNoPlaceholderText(html, 'over-limit with unknown multiplier');
  assert.ok(html.includes('HATE UNAVAILABLE'), 'the over-limit banner must not claim a hate figure it does not have');
  assert.ok(!/\+0 HATE/.test(html), 'an unknown penalty must never render as +0 hate');
});

// ---------------------------------------------------------------------------
// Hosted asset manifest: every browser module the shell loads must exist, and
// the mining board needs a mount point or it silently never renders.
// ---------------------------------------------------------------------------

const ASSET_EXTENSIONS = /\.(html|css|js|mjs|json|geojson|png|svg|webp|woff2?)$/i;

function localReferences(htmlPath, baseDir) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  return [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1].trim())
      .filter(reference => reference && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference))
      .map(reference => reference.split(/[?#]/)[0])
      .filter(reference => ASSET_EXTENSIONS.test(reference))
      .map(reference => (reference.startsWith('/') ? reference.replace(/^\/+/, '') : `${baseDir}${reference}`))
  )];
}

test('every local asset the v2 and v1 shells reference exists on disk', () => {
  for (const [shellPath, baseDir, label] of [
    [v2ShellPath, 'v2/', 'public/v2/index.html'],
    [v1ShellPath, '', 'public/index.html']
  ]) {
    for (const reference of localReferences(shellPath, baseDir)) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, 'public', reference)),
        `${label} references a file that does not exist: ${reference}`
      );
    }
  }
});

test('the v2 shell loads the mining and council-orders components and mounts the mining board', () => {
  const html = fs.readFileSync(v2ShellPath, 'utf8');
  // These two were referenced by the shell but absent from the hosted asset
  // manifest, which is what broke `npm run build:site`.
  assert.ok(html.includes('/v2/js/components/mining-expansion.js'), 'the mining component must be loaded');
  assert.ok(html.includes('/v2/js/components/council-orders.js'), 'the council-orders component must be loaded');
  // mission-control.js renders into this id; without it the board is inert.
  assert.ok(/id="miningExpansion"/.test(html), 'the mining board needs its #miningExpansion mount element');

  const missionControl = fs.readFileSync(path.join(repoRoot, 'public', 'v2', 'js', 'mission-control.js'), 'utf8');
  assert.ok(
    missionControl.includes("getElementById('miningExpansion')"),
    'mission-control.js must still mount the board on the id the shell provides'
  );
});

test('the hosted asset manifest is derived from the shells, not hand-maintained beside them', () => {
  const buildScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'build_static_snapshot.js'), 'utf8');
  assert.ok(
    buildScript.includes('readReferencedAssets'),
    'the manifest must be derived from the HTML shells'
  );
  // A hard-coded component list is the defect class: it silently drifts from
  // the shell every time a browser module is added.
  assert.ok(
    !/embeddedAssetPaths\s*=\s*\[\s*\n\s*'index\.html'/.test(buildScript),
    'the manifest must not be a hard-coded parallel list of shell assets'
  );
});
