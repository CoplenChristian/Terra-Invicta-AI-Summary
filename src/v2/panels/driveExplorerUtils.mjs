/**
 * src/v2/panels/driveExplorerUtils.mjs
 *
 * Purpose: pure formatters, filters, sorters and research-path shaping for the
 *   DRIVES React panel — every rule the panel applies without touching the DOM,
 *   so both the browser and a bare Node test read the same code.
 *
 * `.mjs` rather than `.js` deliberately: the repo is CommonJS by default, so a
 * `.js` file carrying `export` cannot be reached from `tests/*.test.js` at all.
 * Vite resolves `.mjs` identically.
 *
 * TWO NUMERIC TRAPS THIS FILE EXISTS TO AVOID
 * -------------------------------------------
 * 1. Template numerics arrive as STRINGS and 92 of 541 drives carry a thousands
 *    separator in `req power` ("2,130.928"). `Number()` makes those NaN and the
 *    usual `|| 0` idiom then scores the highest-power drives as drawing ZERO.
 *    `num()` strips the separator and reports an unparseable value as null.
 * 2. `combat = cruise x thrustCap`, and `thrustCap` runs 1 to 160 across the
 *    catalogue — only 72 of 541 drives have the two equal. The magnitudes span
 *    five orders, so `accel()` renders SIGNIFICANT FIGURES, never a fixed number
 *    of decimals: `toFixed(3)` prints the bottom of that range as a
 *    confident-looking `0.000`.
 *
 * Absent stays null throughout. A missing value renders as the shared absent
 * affordance in the panel, never as 0 and never as a blank cell.
 */

// The DOM-facing panel gets its affordance from <Value>. These pure formatters
// retain their long-standing string API for the Node-side path tests; keeping
// the character construction here avoids making the DOM-free module a second
// JSX dependency. DriveExplorer passes resolveValue into string builders when
// it opens the detail panel.
const ABSENT_TEXT = String.fromCodePoint(0x2014);

/** Availability buckets, mirroring shared/intel/driveExplorer.mjs. */
export const BUCKETS = Object.freeze({
  fittable: 'fittable',
  researchable: 'researchable',
  never: 'never',
  unresolved: 'unresolved'
});

export const BUCKET_LABEL = Object.freeze({
  fittable: 'FITTABLE NOW',
  researchable: 'RESEARCHABLE',
  never: 'NEVER',
  unresolved: 'UNRESOLVED'
});

export const BUCKET_TITLE = Object.freeze({
  fittable: 'The project that gates this drive is completed, or the drive is not gated at all. It can be fitted today.',
  researchable: 'Locked behind research. The chain cost is the remaining cost of the cheapest satisfying prerequisite path, from the same walk /api/intel/tech-path performs.',
  never: 'Not researchable by this faction at all — either the researchCost -1 sentinel, or a faction restriction. It is listed so you know it exists, not offered.',
  unresolved: 'Availability could not be determined from this snapshot. Listed below the table with its reason rather than shown as a blank row.'
});

export const SORTS = Object.freeze([
  { key: 'delta-v', label: 'ΔV' },
  { key: 'combat-acceleration', label: 'COMBAT ACCEL' },
  { key: 'cruise-acceleration', label: 'CRUISE ACCEL' },
  { key: 'availability', label: 'AVAILABILITY' },
  { key: 'name', label: 'NAME' }
]);

export const REACTOR_FILTERS = Object.freeze([
  { key: 'all', label: 'ANY REACTOR FIT' },
  { key: 'compatible', label: 'REACTOR-COMPATIBLE ONLY' },
  { key: 'incompatible', label: 'REACTOR-INCOMPATIBLE ONLY' }
]);

// A display cap keeps 541 table rows from being laid out at once, but it is
// the reader's to lift -- a cap nobody can raise is pagination with extra
// steps, and the spec asked for sorting and filtering instead.
export const ROW_CAPS = Object.freeze([60, 120, 250, 1000]);

export const ESTIMATE_CAPTION = 'ESTIMATE — heuristic, not a measurement';

export const SCROLL_HINT_TEXT = 'SWIPE HORIZONTALLY — DRIVE NAME STAYS PINNED';

/**
 * The minimum-threshold controls, mirroring `DRIVE_THRESHOLD_FILTERS` in
 * shared/requestValidation.mjs.
 *
 * `measure` is the field on `row.measured` each one tests, so the predicate
 * below and the endpoint's are reading the same number by the same name. The
 * unit is on the control's own label AND in its placeholder: "> 10" is
 * ambiguous between km/s and m/s², which is the same defect as the missing
 * column this table just gained.
 */
export const THRESHOLDS = Object.freeze([
  { key: 'minDeltaV', measure: 'deltaVKps', label: 'MIN ΔV (km/s)', unit: 'km/s', placeholder: 'e.g. 10 km/s' },
  {
    key: 'minCombatAcceleration',
    measure: 'combatAccelerationMps2',
    label: 'MIN COMBAT ACCEL (m/s²)',
    unit: 'm/s²',
    placeholder: 'e.g. 20 m/s²'
  },
  {
    key: 'minCruiseAcceleration',
    measure: 'cruiseAccelerationMps2',
    label: 'MIN CRUISE ACCEL (m/s²)',
    unit: 'm/s²',
    placeholder: 'e.g. 0.5 m/s²'
  }
]);

/** The panel's view state at rest. A fresh object every call: it is mutable. */
export function defaultViewState() {
  return {
    payload: null,
    loading: false,
    designId: null,
    sort: 'delta-v',
    bucket: 'all',
    reactor: 'all',
    search: '',
    // Raw, as typed. Parsed by `parseThreshold` on every paint so a half-typed
    // value is a rejected one and never a coerced one.
    thresholds: { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '' },
    limit: 120,
    container: null,
    observer: null,
    mode: null
  };
}

/**
 * A number, or null. NEVER 0 for an absent or unreadable value.
 *
 * The comma branch is load-bearing: `Number("2,130.928")` is NaN, and 92 of the
 * 541 shipped drives write their power figure that way.
 */
export function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === '') return null;
  const stripped = /^-?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(text) ? text.replace(/,/g, '') : text;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Absent renders as the shared absent affordance. Never as 0 or a blank cell. */
export function dec(value, places) {
  const parsed = num(value);
  return parsed === null ? ABSENT_TEXT : parsed.toFixed(places === undefined ? 2 : places);
}

export function int(value) {
  const parsed = num(value);
  return parsed === null ? ABSENT_TEXT : Math.round(parsed).toLocaleString('en-US');
}

export function mult(value) {
  const parsed = num(value);
  if (parsed === null) return ABSENT_TEXT;
  const abs = Math.abs(parsed);
  if (abs >= 1000) return `${Math.round(parsed).toLocaleString('en-US')}×`;
  if (abs >= 10) return `${parsed.toFixed(1)}×`;
  return `${parsed.toFixed(2)}×`;
}

/**
 * An acceleration, to three significant figures.
 *
 * Measured cruise acceleration on the live catalogue runs from 0.00016846 to
 * 20.59560406 -- five orders of magnitude. `toFixed(3)` renders the bottom of
 * that range as `0.000`, which a reader cannot tell from a measured zero, so
 * this keeps three significant figures instead of three decimal places.
 *
 * A measured 0 stays `0`: it is a real measurement, and it is NOT what an
 * absent value renders as. Absent is the em dash, as everywhere else here.
 */
export function accel(value) {
  const parsed = num(value);
  if (parsed === null) return ABSENT_TEXT;
  if (parsed === 0) return '0';
  const abs = Math.abs(parsed);
  if (abs >= 1000) return Math.round(parsed).toLocaleString('en-US');
  // `Number(...)` drops the trailing zeros `toPrecision` pads with, so 20.6
  // does not read as 20.600 beside 0.000168.
  return String(Number(parsed.toPrecision(3)));
}

/** A magnitude that spans nine orders on this data set. */
export function power(value) {
  const parsed = num(value);
  if (parsed === null) return ABSENT_TEXT;
  if (parsed === 0) return '0';
  if (Math.abs(parsed) >= 1e6) return `${(parsed / 1e6).toFixed(1)}M`;
  if (Math.abs(parsed) >= 1e3) return `${(parsed / 1e3).toFixed(1)}k`;
  if (Math.abs(parsed) < 1) return parsed.toFixed(3);
  return parsed.toFixed(1);
}

/** Splits Snake_Case reactor and drive class ids into readable words. */
export function words(value) {
  if (!value) return ABSENT_TEXT;
  return String(value).replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Filtering and sorting, over the catalogue already fetched.
//
// WHY THE NUMERIC FILTER RUNS HERE AS WELL AS ON THE ENDPOINT
// ----------------------------------------------------------
// `/api/intel/drive-explorer` honours `minDeltaV`, `minCombatAcceleration` and
// `minCruiseAcceleration` -- that is not optional, because a filter that exists
// only in the browser is invisible to every agent reading the endpoint, and
// being agent-readable is half the point of this project.
//
// The panel nevertheless applies the SAME rules client-side rather than
// re-fetching, because it already holds all 541 rows and already sorts and
// filters them here: a fetch per keystroke would re-transfer the whole
// catalogue to answer a question the page can already answer. That buys
// responsiveness at the cost of a second implementation of the rule, so
// tests/driveExplorer.test.js runs both against the live save over a matrix of
// thresholds and fails if the two sets or the two counts ever differ.
//
// ABSENT STAYS NULL, and it is the whole risk here. `Number(null) === 0`, so a
// null measurement tested against `>= 10` becomes `0 >= 10` and the row is
// dropped as though it had been measured and found wanting. The three outcomes
// below are the same three-valued logic the endpoint uses.
// ---------------------------------------------------------------------------

export const OUTCOME = Object.freeze({ pass: 'pass', below: 'below', untestable: 'untestable' });

/**
 * Parses one typed threshold. Mirrors `parseMinimumThreshold`.
 *
 * Absent -> no filter. Malformed or negative -> no filter AND a rejection the
 * reader is shown, never a coercion: `Number('abc')` is NaN and `Number('')`
 * is 0, and either would silently answer a different question.
 */
export function parseThreshold(raw) {
  if (raw === null || raw === undefined) return { applied: null, rejected: null };
  const text = String(raw).trim();
  if (text === '') return { applied: null, rejected: null };
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return { applied: null, rejected: text };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { applied: null, rejected: text };
  return { applied: parsed, rejected: null };
}

/** Every typed threshold, parsed. `active` is what actually filters. */
export function activeThresholds(typed) {
  const applied = {};
  const active = [];
  const rejected = [];
  THRESHOLDS.forEach(entry => {
    const result = parseThreshold(typed ? typed[entry.key] : null);
    applied[entry.key] = result.applied;
    if (result.applied !== null) active.push(entry);
    if (result.rejected !== null) rejected.push({ ...entry, value: result.rejected });
  });
  return { applied, active, rejected };
}

/**
 * One row against the active minimums.
 *
 * A definite failure on any TESTABLE minimum is a failure whatever else is
 * unmeasured -- the AND is then definitely false. Only when every testable
 * minimum passes and something is missing is the answer unknown, and an
 * unknown row is excluded and counted apart from the genuine failures.
 */
export function thresholdOutcome(row, active) {
  let unmeasured = 0;
  for (const entry of active) {
    const value = num(row.measured ? row.measured[entry.measure] : null);
    if (value === null) unmeasured += 1;
    else if (value < entry.applied) return OUTCOME.below;
  }
  return unmeasured > 0 ? OUTCOME.untestable : OUTCOME.pass;
}

/**
 * The rows to show, plus WHY the rest are not shown.
 *
 * Returns the matched rows and the two exclusion counts separately, because
 * "408 filtered out" cannot be read: a drive that failed the minimum and a
 * drive nobody could measure are different facts and the reader needs both.
 */
export function visibleRows(items, viewState) {
  const view = viewState || defaultViewState();
  const term = String(view.search || '').trim().toLowerCase();
  const request = activeThresholds(view.thresholds);
  const active = request.active.map(entry => ({
    ...entry,
    applied: request.applied[entry.key]
  }));

  const matched = [];
  const untestable = [];
  let belowThresholdCount = 0;

  for (const row of (items || [])) {
    if (view.bucket !== 'all' && row.availability.bucket !== view.bucket) continue;
    if (view.reactor === 'compatible' && row.reactor.compatible !== true) continue;
    if (view.reactor === 'incompatible' && row.reactor.compatible !== false) continue;
    if (term) {
      const haystack = `${row.displayName || ''} ${row.driveId || ''} ${row.classification || ''} ${row.propellant || ''}`.toLowerCase();
      if (!haystack.includes(term)) continue;
    }
    const outcome = thresholdOutcome(row, active);
    if (outcome === OUTCOME.pass) matched.push(row);
    else if (outcome === OUTCOME.untestable) untestable.push(row);
    else belowThresholdCount += 1;
  }

  return {
    rows: matched,
    belowThresholdCount,
    untestableCount: untestable.length,
    untestableDrives: untestable,
    thresholds: request
  };
}

export function sortRows(rows, sort) {
  const byName = (a, b) => String(a.displayName || a.driveId).localeCompare(String(b.displayName || b.driveId));
  const numeric = (read) => (a, b) => {
    const x = num(read(a));
    const y = num(read(b));
    // Uncomputable is not zero and never ranks as zero: it sorts last.
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x !== y) return y - x;
    return byName(a, b);
  };
  const bucketRank = { fittable: 0, researchable: 1, never: 2, unresolved: 3 };

  const sorted = rows.slice();
  if (sort === 'name') sorted.sort(byName);
  else if (sort === 'availability') {
    sorted.sort((a, b) => {
      const rankA = bucketRank[a.availability.bucket] ?? 99;
      const rankB = bucketRank[b.availability.bucket] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return numeric(row => row.measured.deltaVKps)(a, b);
    });
  } else if (sort === 'combat-acceleration') sorted.sort(numeric(row => row.measured.combatAccelerationMps2));
  else if (sort === 'cruise-acceleration') sorted.sort(numeric(row => row.measured.cruiseAccelerationMps2));
  else sorted.sort(numeric(row => row.measured.deltaVKps));
  return sorted;
}

// ---------------------------------------------------------------------------
// The path modal: click a drive, see what unlocks it.
//
// Everything below shapes /api/intel/tech-path for the drive's GATE PROJECT.
// The endpoint already makes the split this modal is about -- `type` is
// `faction_project` or `global_tech` -- and already picks the cheapest
// satisfying route through the alternate prerequisites, reporting the road not
// taken. Nothing here re-derives any of that.
//
// Two things it must never do:
//   * present a `researchCost: -1` sentinel as a cost. It marks a project that
//     is never researched, so a path containing one has NO honest total.
//   * imply that a cleared path is a startable one. Availability is rolled
//     monthly, not derived (docs/research-advisor-spec.md 3b), and the caveat
//     travels on the payload so this panel cannot forget to say so.
// ---------------------------------------------------------------------------

export const STATUS_LABEL = Object.freeze({
  completed: 'DONE',
  researching: 'RESEARCHING',
  available: 'AVAILABLE',
  locked: 'LOCKED',
  unknown: 'UNKNOWN'
});

export const STATUS_TONE = Object.freeze({
  completed: 'ok',
  researching: 'warn',
  available: 'ok',
  locked: 'block',
  unknown: 'unknown'
});

/** Research points, or an honest UNKNOWN. -1 is a sentinel, never a number. */
export function rp(value, resolve) {
  const format = (raw) => {
    const parsed = num(raw);
    if (parsed < 0) return 'NEVER RESEARCHED';
    return `${Math.round(parsed).toLocaleString('en-US')} RP`;
  };
  if (typeof resolve === 'function') {
    return resolve({ value, present: num(value) !== null, format, absentLabel: ABSENT_TEXT }).text;
  }
  const parsed = num(value);
  if (parsed === null) return ABSENT_TEXT;
  return format(parsed);
}

export function statusText(node) {
  const label = STATUS_LABEL[node.status] || 'UNKNOWN';
  const pct = num(node.progressPercent);
  if (node.status === 'researching' && pct !== null) return `${label} ${pct.toFixed(1)}%`;
  return label;
}

export function pathRow(node, resolve) {
  return {
    label: node.displayName || node.id,
    sublabel: node.category ? String(node.category).replace(/([a-z])([A-Z])/g, '$1 $2') : null,
    status: statusText(node),
    statusTone: STATUS_TONE[node.status] || 'unknown',
    meta: rp(node.cost, resolve)
  };
}

// A node before the nodes that depend on it -- a path, not a set.
//
// `remainingPath` is a PRE-order walk, so reversing it is NOT a dependency
// order: on the live save `Exotic Hybrid Systems` and `Exotics` are siblings
// under one parent while the first also needs the second, and the reversed
// pre-order lists the dependent first. The endpoint carries the real
// topological order as `remainingPathDependencyOrder` (ids), so this sorts by
// position in it. A node the order does not mention keeps its emitted
// position at the end rather than being dropped.
export function inDependencyOrder(nodes, order) {
  const index = new Map((Array.isArray(order) ? order : []).map((id, position) => [id, position]));
  return nodes
    .map((node, position) => ({ node, position }))
    .sort((a, b) => {
      const rankA = index.has(a.node.id) ? index.get(a.node.id) : Number.POSITIVE_INFINITY;
      const rankB = index.has(b.node.id) ? index.get(b.node.id) : Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return a.position - b.position;
    })
    .map(entry => entry.node);
}

export function routeSection(routes, resolve) {
  const list = Array.isArray(routes) ? routes : [];
  if (list.length === 0) return null;
  return {
    title: 'ROUTE CHOSEN',
    caption: `${list.length} node(s) on this path had an alternate prerequisite`,
    rows: list.map(route => ({
      label: route.nodeDisplayName || route.nodeId,
      sublabel: `via ${route.chosenRoute?.displayName || route.chosenRoute?.id || 'an unnamed prerequisite'}`
        + ` rather than ${route.alternativeRoute?.displayName || route.alternativeRoute?.id || 'an unnamed alternative'}`,
      status: num(route.savings) === null ? 'SAVINGS UNKNOWN' : `SAVES ${rp(route.savings, resolve)}`,
      statusTone: num(route.savings) === null ? 'unknown' : 'ok',
      meta: `${rp(route.chosenRoute?.cost, resolve)} vs ${rp(route.alternativeRoute?.cost, resolve)}`
    })),
    empty: 'No node on this path had an alternate prerequisite.'
  };
}

/** Facts and sections for a drive whose gate is resolved and whose path loaded. */
export function pathPanelOptions(row, payload, resolve) {
  const drive = row.displayName || row.driveId;
  const gateId = row.availability.gateProjectId;
  const gateName = row.availability.gateProjectName || payload?.target?.displayName || gateId;

  const facts = [
    { label: 'DRIVE', value: drive },
    { label: 'GATE PROJECT', value: gateName ? `${gateName} (${gateId})` : 'none — this drive names no gating project' },
    { label: 'AVAILABILITY', value: BUCKET_LABEL[row.availability.bucket] || 'UNKNOWN' }
  ];

  if (payload?.unavailable) {
    return {
      eyebrow: 'RESEARCH PATH',
      title: drive,
      summary: 'The research path behind this drive could not be read from this snapshot.',
      facts,
      notes: [payload.reason || 'No reason was reported.']
    };
  }

  const remaining = Array.isArray(payload.remainingPath) ? payload.remainingPath : [];
  const satisfied = Array.isArray(payload.satisfiedPrerequisites) ? payload.satisfiedPrerequisites : [];
  const order = payload.remainingPathDependencyOrder;
  const factionNodes = inDependencyOrder(remaining.filter(n => n.type === 'faction_project'), order);
  const globalNodes = inDependencyOrder(remaining.filter(n => n.type === 'global_tech'), order);
  const otherNodes = inDependencyOrder(
    remaining.filter(n => n.type !== 'faction_project' && n.type !== 'global_tech'), order);
  const satisfiedFaction = satisfied.filter(n => n.type === 'faction_project').length;
  const satisfiedGlobal = satisfied.filter(n => n.type === 'global_tech').length;

  const totalCost = payload.researchCostComplete === true
    ? rp(payload.totalRemainingResearchCost, resolve)
    : 'UNKNOWN — a step on this path is never researched';

  facts.push(
    { label: 'REMAINING', value: `${remaining.length} step(s)` },
    { label: 'FACTION RESEARCH', value: payload.remainingFactionResearchCost === null ? 'UNKNOWN' : rp(payload.remainingFactionResearchCost, resolve) },
    { label: 'GLOBAL RESEARCH', value: payload.remainingGlobalResearchCost === null ? 'UNKNOWN' : rp(payload.remainingGlobalResearchCost, resolve) },
    { label: 'TOTAL REMAINING', value: totalCost },
    { label: 'ALREADY SATISFIED', value: `${payload.satisfiedPrerequisiteTotalCount ?? satisfied.length} prerequisite(s)` }
  );

  const sections = [
    {
      title: 'FACTION PROJECTS',
      caption: `${factionNodes.length} remaining · ${payload.remainingFactionResearchCost === null ? 'cost unknown' : rp(payload.remainingFactionResearchCost, resolve)}`,
      rows: factionNodes.map(node => pathRow(node, resolve)),
      empty: 'No faction project remains on this path.'
    },
    {
      title: 'GLOBAL TECHS',
      caption: `${globalNodes.length} remaining · ${payload.remainingGlobalResearchCost === null ? 'cost unknown' : rp(payload.remainingGlobalResearchCost, resolve)}`,
      rows: globalNodes.map(node => pathRow(node, resolve)),
      empty: 'No global tech remains on this path.'
    }
  ];

  // Neither of the two types the endpoint reports. Shown rather than dropped:
  // a node silently absent from both sections would make the counts lie.
  if (otherNodes.length > 0) {
    sections.push({
      title: 'OTHER NODES',
      caption: `${otherNodes.length} node(s) the endpoint classified as neither a faction project nor a global tech`,
      rows: otherNodes.map(node => pathRow(node, resolve)),
      empty: 'None.'
    });
  }

  sections.push({
    title: 'ALREADY SATISFIED',
    caption: `${satisfied.length} shown · ${satisfiedFaction} faction, ${satisfiedGlobal} global · already researched, nothing further to pay`,
    rows: satisfied.map(node => pathRow(node, resolve)),
    empty: 'No prerequisite on this path is satisfied yet.'
  });

  const routes = routeSection(payload.routesEvaluated, resolve);
  if (routes) sections.push(routes);

  const notes = [payload.availabilityCaveat].filter(Boolean);
  const omitted = num(payload.satisfiedPrerequisiteOmittedCount);
  if (omitted !== null && omitted > 0) {
    notes.push(`${omitted} further satisfied prerequisite(s) are not listed here: the endpoint caps the list at ${satisfied.length}. The full set is on /api/intel/tech-path?target=${gateId}.`);
  }
  if (Array.isArray(payload.uncostedNodes) && payload.uncostedNodes.length > 0) {
    notes.push(`${payload.uncostedNodes.length} node(s) on this path carry no readable cost, so no total for it is honest: ${payload.uncostedNodes.join(', ')}.`);
  }

  return {
    eyebrow: 'RESEARCH PATH',
    title: drive,
    summary: `${remaining.length} step(s) remain to unlock ${gateName || 'this drive'}, and ${payload.satisfiedPrerequisiteTotalCount ?? satisfied.length} prerequisite(s) on the route are already done. The route is the cheapest satisfying one, from the same walk /api/intel/tech-path performs.`,
    facts,
    sections,
    notes
  };
}

/** The facts a drive that names no gating project opens its modal with. */
export function ungatedPanelOptions(row) {
  const drive = row.displayName || row.driveId;
  return {
    eyebrow: 'RESEARCH PATH',
    title: drive,
    facts: [
      { label: 'DRIVE', value: drive },
      { label: 'GATE PROJECT', value: 'none — this drive names no gating project' },
      { label: 'AVAILABILITY', value: BUCKET_LABEL[row.availability.bucket] || 'UNKNOWN' }
    ],
    summary: 'This drive is not gated by any project, so there is no research path to it. What makes it usable is whatever mounts it.',
    notes: ['Nothing unlocks this drive because nothing needs to. 33 of the 125 laser templates and a handful of hulls, armours, reactors and radiators are the same.']
  };
}
