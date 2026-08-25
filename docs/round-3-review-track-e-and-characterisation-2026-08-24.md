# Review — Track E primitives + Round 3 characterisation coverage

Reviewer: MiniMax-M3 (planning only). Date: 2026-08-24. Scope: review only.

---

## JOB 1 — Track E primitives

### 1. The cascade measurement

The harness `src/v2/primitivesHarness.jsx:101-105` mounts two spans with `className="cascade-order-probe"` and reads `getComputedStyle` in a real Chromium. That part is real — Playwright launches, the bundle is built, the stylesheets are linked in shell order.

The wording is wrong. The two rules are not at equal specificity:

- Global: `.cascade-order-probe { color: rgb(1,2,3) }` at `public/v2/primitives-harness.html:34`, specificity **(0, 1, 0)**.
- Emotion: `styled('span')({ '&.cascade-order-probe': { color: 'rgb(40,50,60)' } })` compiles to `.css-1xxx.cascade-order-probe` (the user class joins the emotion class on the DOM node), specificity **(0, 2, 0)**.

Emotion wins because `.foo.bar` beats `.foo`, not because of source order. `tests/mineModuleOutput.test.js:519-522` still pins the source-order outcome for the load-bearing pairs (`.mining-meas__value` after `.mining-yields-text`, `.mining-est` after `.mining-yield-basis`) — that test is independent of the harness and stays valid.

The decision in `docs/react-primitives-brief.md:172-178` says "Emotion wins at equal specificity. Measured in the real page." **The measurement is real; "equal specificity" is wrong; the conclusion (primitives may use `sx`/`styled` freely) still holds and holds more strongly than the brief claims.** Fix: rewrite the comment to "Emotion wins at this specificity, measured in the real page" and add a second probe that pins what happens when a global rule is `!important`-ed or duplicated in a later sheet — those are the cases that actually threaten the cascade, and the brief does not cover them.

**Does keeping global class names on the DOM make the measurement moot?** No. Legacy rules attach to `.tech-card`, `.mining-meas__value`, etc. directly — those class names appear on the DOM regardless of whether they came from `sx` or from JSX. The relevant question is whether `sx` adds new styling that survives the cascade, and the answer is yes. Keeping global class names is a separate decision (load-bearing cascade pairs stay attached) and is independent of the cascade measurement.

### 2. Value — measured zero vs absent vs unavailable

`src/v2/components/Value.jsx:35-83` takes `value` plus an explicit `present: boolean`. `parseNumeric` (L10-14) returns `null` for `null`/`undefined`/`''`/`NaN`. The component branches:

- `!present` → `data-value-state="absent"` + `absentLabel` (default `—`).
- formatter returns the unavailable token → `data-value-state="unavailable"` + `UNAVAILABLE`.
- otherwise → `data-value-state="measured"` + formatted number.

`Number(0)` passes through as `'0'`. Behaviour is right.

Tests: `tests/reactPrimitivesValue.test.js:11-35` reads all three states from a real page; `tests/reactPrimitivesValue.unit.test.js:14-33` extracts `parseNumeric` and forbids `Number(value) ?? default` in source. **Gap:** the unit test copies `parseNumeric` into the test file rather than importing it. If the source changes, the test will diverge silently. Export `parseNumeric` from `Value.jsx` and import it.

### 3. Panel — six modifiers and four border edges

`src/v2/components/Panel.jsx:10-17` declares the modifier map for all six: `priority`, `alert`, `featured`, `quiet`, `dense`, `commentary`. The border test `tests/reactPrimitivesPanel.test.js:24-40` reads `borderTopWidth`/`borderRightWidth`/`borderBottomWidth`/`borderLeftWidth` from a real page and asserts all four `> 0` — measured, not asserted.

**Gap:** the modifier test at `reactPrimitivesPanel.test.js:13-22` is a static-text regex check against the source file. The fallback `MODIFIER_CLASS[key] || \`tech-card--${key}\`` at `Panel.jsx:27` means an unknown modifier still produces a string. A rewrite that dropped a row from `MODIFIER_CLASS` would still pass the static-text test if the substring happened to appear elsewhere. No runtime test mounts each of the six modifiers and reads the class list.

### 4. DataTable — scroll hint, six variants, commentary-sim

`src/v2/components/DataTable.jsx:35-44` measures `wrap.scrollWidth > wrap.clientWidth + 1` (1px subpixel tolerance) and toggles `is-scrollable`. A `ResizeObserver` at L76-84 re-syncs on resize. `tests/reactPrimitivesDataTable.test.js:27-58` exercises two scenes (overflow + fits) — those are real measurements.

`commentary-sim` at `tableVariants.js:64-73` has `wrap: null`, `hint: null`, `hintPlacement: null`. Three branches handle this:

- `syncHint` (L71-74) early-returns on `!config.hint` → no observer, no measurement.
- `wrapClasses` (L86) joins `[config.wrap, className].filter(Boolean)` → null is dropped, safe.
- `bareTable = !config.wrap` (L88) returns a single `<div>` wrapping the bare `<table>` (L146-156). No scroll wrap, no hint node.

**The null-wrap path does not throw and does not silently disable hints for the other five variants.** Per-variant config is isolated.

**But the brief's exact ask — "confirm the null-wrap path cannot throw or silently disable hints for the other five variants" — is not pinned.** `tests/reactPrimitivesDataTable.test.js` only mounts `dataTableOverflow` and `dataTableFits`. No scene in `src/v2/primitivesHarness.jsx` mounts a `commentary-sim` DataTable, so the `bareTable` branch is only asserted by static-string match (`commentary-sim-table` substring, L22). A future refactor that added a wrap to `commentary-sim` would pass that test. Variant map test at L13-25 does not assert `wrap: null` or `hint: null` for `commentary-sim`.

### 5. TruncationNote — absent omitted count is unknown

`src/v2/components/TruncationNote.jsx:10-12` defines `isFiniteCount` as `typeof n === 'number' && Number.isFinite(n)`. L32-46 early-return `data-truncation-state="unknown"` + `unknownLabel` when `omittedCount` is not finite. L48-60 handle `omittedCount <= 0` with `complete`. L62-78 handle truncated.

`tests/reactPrimitivesTruncation.test.js:11-37` mounts all three states in the harness scene and asserts each by `data-truncation-state` attribute and text. L33 (`!/showing all/i`) directly defends against "rendering all when count was never read".

**Edge case not pinned:** when `omittedCount` is `0` AND `totalCount` is `null`, the complete branch renders `All entries shown.` with no count (L57). The test only asserts the text `All entries shown` is present (L36) — a regression that added a literal `0` next to it would still pass.

### 6. Brief's other claims

- **`scripts/verify_drive_explorer.js` and `scripts/verify_mining_registers.js` assert the two registers by computed style.** Both scripts query `.de-measured__value`, `.de-estimate__value`, `.mining-meas__value`, `.mining-est__value` from the production DOM. The class names are emitted by `Measured.jsx` and `Estimated.jsx` when those primitives are mounted. **But the production pages (`drive-explorer.js`, `mining-expansion.js`) still use the vanilla inline DOM components and never import the new Measured/Estimated primitives.** The brief's claim that the components "must satisfy those scripts unchanged" is checking the wrong invariant — those scripts are satisfied today by the vanilla components, not by the primitives. Either the production mount needs to switch (deferred to per-component phases per the brief), or the brief's claim is wrong. The "primitives keep global class names" decision (Decision 2) is correct as a *preparation* for the switch but unrelated to whether the scripts currently exercise the primitives.
- **`assertViewRegistryIntegrity`** is referenced in the brief but does not exist in this repo. Not a primitive defect.

### JOB 1 verdict per primitive

| Primitive | Source correct | Test real | Gaps |
| :-- | :-- | :-- | :-- |
| Cascade probe | yes | yes — but "equal specificity" wording wrong | rewrite probe to truly equal specificity, or correct the comment; add a `!important` regression test |
| Value | yes | yes (real + unit) | export `parseNumeric` and import in the unit test |
| Panel | yes | partial | modifier test is static-text; no runtime test mounting each of the six modifiers |
| DataTable | yes | partial | `commentary-sim` null-wrap path is NOT exercised in the harness; static-string match only |
| TruncationNote | yes | yes | `All entries shown` with no total fallback not pinned |
| Measured/Estimated | yes | yes (registers test reads computed style) | but `verify_drive_explorer.js` / `verify_mining_registers.js` do not currently exercise the primitives |

---

## JOB 2 — characterisation coverage

### The mockDom blind spot

`tests/fixtures/mockDom.js:280-300` (`serializeNode`) emits `_textContent` only when `children.length === 0`. The `textContent` *getter* at L72-77 walks the tree and handles mixed text+children correctly — but the serializer does not. A node like `<td>5<small>EST</small></td>` parsed with `_textContent = '5'` and one child serializes as `<td><small>EST</small></td>` — text silently dropped.

Two of the six work around the blind spot with a `treeText` helper that walks the tree in document order:

- `tests/executiveBoards.test.js:79-93` — `treeText` concatenates `_textContent` with each child's `treeText`, with a space at each node boundary so cells separate the way inline layout does. Header at L27-37 explains *why*: faction ledger displayName / GDP / habs-ships (text + `<small>` subtitle) and operations board effective skill value (text + org-bonus `<span>`) are exactly the cells at risk.
- `tests/councilOrders.test.js:56-69` — same pattern. Header at L27-32 cites the same blind-spot reason.

The other four (`mc-budget`, `world-map`, `intelligence-library-rendering`, `faction-intel-rendering`) assert on serialized output and inherit the blind spot. They do not assert on any text in a mixed text+children cell that is also behaviour-level data — every text assertion goes through `visibleText`, which strips tags before matching. The surface area for a false negative is real but narrow: a React port that emits `<header><h2>Faction roster</h2><actions/></header>` and sets `header._textContent = 'Faction roster'` before appending the `<actions>` element would lose the heading text on serialize and the assertion would fail not because the heading is gone from the page but because the harness serializer ate it.

#### `tests/executiveBoards.test.js` — TRUSTWORTHY

- Mechanism: `treeText` (L79-88) → `boardText` (L91-93) → `visibleText`. Walks the tree, recovers mixed text+children cells.
- Both modes: yes — iterated `for (mode of ['player','omniscient'])` for L213-229, L270-289, L353-373, L409-424, L481-496, L541-557; faction ledger has separate tests at L123-149 / L151-165; the `HATE UNAVAILABLE` (L138) vs `HATE 42.7` (L159) pair is the explicit redaction test.
- Unavailable: enumerated per board (null hate estimate, missing ship delta → em dash, null spendPerMonth, empty underConstruction, empty topProducers, null runwayDays, unmeasured capability metrics, three empty messages, UNAVAILABLE lead / UNKNOWN availability / GUARANTEED / RNG, three more empty messages). `assertNoPlaceholderText` × 14.
- Blind-spot exposure: none material — `treeText` recovers mixed cells before serializing.
- Trivia count: ~30 (headings, board notes, posture vocabulary, scroll hint, empty messages).
- VERDICT — TRUSTWORTHY — would catch a lossy rewrite. Trivia assertions would falsely fail a copy-rephrasing port, but they don't hide regressions in the behaviour the file exists to protect.

#### `tests/councilOrders.test.js` — TRUSTWORTHY

- Mechanism: `treeText` (L56-65) → `boardText` (L67-69). Same pattern as executive-boards.
- Both modes: yes (player L100-119, omniscient L121-139). Different content per mode: player has three councilors with `0 hate` and `GUARANTEED` odds; omniscient has five councilors with `'93% [89–96%]'` and `'+4.74 hate'`.
- Unavailable: enumerated per shape (null odds, automatic odds, roll band, `>99%` cap, FLOOR UNVERIFIED + MARGINAL, idle councilor, unavailable councilor, bare candidate, family lookup, target-kind lookup, four flavours of missing cyclePlan, empty cycle plan). `assertNoPlaceholderText` × 3.
- Blind-spot exposure: none material — `treeText`.
- Trivia count: ~12 (footnote link, empty messages, family-label loop, target-kind loop, `Councilor` fallback).
- VERDICT — TRUSTWORTHY — would catch a lossy rewrite. Behaviour assertions include the GUARANTEED-vs-ODDS-UNAVAILABLE mutual-exclusion (L181), the `'100%'` prohibition (L218 — must not appear because cap is `>99%`), and the roll-band shape with the bracket (L134). These are real behaviour tests, not string-matching.

#### `tests/mc-budget.test.js` — WEAK

- Mechanism: `renderToString` (L29-34) returns `root.innerHTML` from a `DOMNode('div')`, then `visibleText(html)`. **Serializes through the blind spot.**
- Both modes: yes — player L54-92; omniscient L94-110.
- Unavailable: enumerated — null payload (L125), undefined (L131), empty object (L137), `applicable: false` (L144), every economic metric null (L172-180), partial nulls (L185-203). `assertNoPlaceholderText` × 4.
- Blind-spot exposure: every hull roster assertion (L77-84) and the eight metric values (L67, L70-73) sit in mixed cells — `<li>Frigate <span>2 MC</span> · <span>120d</span> − <button>0</button> +</li>` shape — which the serializer drops on the parent's own `_textContent`. The stepper interactions at L302, L314-315, L329, L335, L348, L356 assert the rendered string after clicks; a React port that splits these into siblings would lose the parent text.
- Trivia count: ~18 (panel heading, status text, build-stage copy, explanation copy, unavailable copy, three verdict copy blocks).
- VERDICT — WEAK — would partly catch a lossy rewrite but would fail spuriously on a behaviour-correct port that splits cells. Class-attribute assertions (`is-danger`, `is-emphasis`) and `data-mc-reset` / `data-mc-hull` query assertions survive intact, so verdict-tone regressions and stepper regressions still trip — but every hull-row text assertion is vulnerable.

#### `tests/world-map.test.js` — WEAK

- Mechanism: `serializeNode(container)` (L83, L125, L145, L155, L172, L176, L194, L224, L245, L256) → `visibleText`. **Serializes through the blind spot.**
- Both modes: yes (player L78-118; omniscient L120-133).
- Unavailable: enumerated (empty array, `{ items: [] }`, null, undefined, null counts, undefined counts, custom statusTone fallback, GeoJSON fetch failure, custom titles and ariaLabel pass-through).
- Blind-spot exposure: theatre summary lines (`'CURRENT / HOSTILE 2 · OWN 1'` L102/L106/L114/L130/L148/L149/L166), per-theater blocks (`'NORTH AMERICA SECURED H 0 / OWN 1'` L130/L148, the unavailable blocks at L159-L164/L173/L177), the em-dash aria-label at L232 (`'Hostile count —; own count —.'`) — all plausibly render into wrappers with sibling status nodes. `font-size` attribute assertions at L277-307 are NOT vulnerable (attributes serialize regardless of children).
- Trivia count: ~16 (global headings, legend vocabulary, status vocabulary, attribution copy, unavailable banner copy, SVG `font-size` typography ladder).
- VERDICT — WEAK — would partly catch a lossy rewrite. The aria-label em dash at L232 and the custom-title pass-through at L248 are real contracts; the typography ladder at L268-307 is a real implementation pin (correct CSS-class rewrite that achieves the same visual ladder would fail). But every summary-count assertion is vulnerable to a wrapper-with-children drop.

#### `tests/intelligenceLibraryRendering.test.js` — NOT TRUSTWORTHY

- Mechanism: `serializeNode(root)` (L93, L355) → `visibleText`. **Serializes through the blind spot.**
- Both modes: yes (player L154-171; omniscient L173-181). Mode-redaction also pinned at L187-197 (player councilor with `maskedAttributes` and no `attributes`) and L199-212 (omniscient alien councilor).
- Unavailable: enumerated for the full-degraded shape (L298-301) but **partial unavailability is not pinned** — every metric is nulled simultaneously at L268-296, so a regression that mixes measured and unavailable in the same tile is not caught.
- Blind-spot exposure: the dominant rendering shape of this component is heading-tile-with-children (`'PLAYER INTEL / FILTERED'`, `'OMNISCIENT / FULL SAVE STATE'`, the eight nav labels at L168-170, the per-section header + value tiles like `'Earth GDP rank'` + `'#2 / 8'`, `'Hate of us'` + value, `'Strategic score (est.)'` + value). A port that renders `<header>PLAYER INTEL / FILTERED <small>{modeChip}</small></header>` would lose the parent's text on serialize.
- Trivia count: ~24 (panel heading, mode labels, section labels, the eight nav labels, mode-conditional section labels, column labels, button labels, section titles).
- VERDICT — NOT TRUSTWORTHY — would miss a lossy rewrite. The non-text assertions (L165-170 DOM selector and section count, L367-370 shell file match, L373-375 post-close empty check) survive; everything that pins visible content routes through the serializer. A React rewrite that produces wrapper-with-sibling-chip shapes would break the assertions without breaking behaviour.

#### `tests/factionIntelRendering.test.js` — NOT TRUSTWORTHY

- Mechanism: `serializeNode(root)` (L152, L184, L206) → `visibleText`. **Serializes through the blind spot.**
- Both modes: yes (player L160-175; omniscient L177-192). Mode-redaction pinned at L198-210 (player enemy councilor visible via `maskedAttributes`).
- Unavailable: enumerated (sparse snapshot with one faction and no councilors, every metric null L216-228; UNKNOWN observer-relative relationship L230-233; explicit em-dash visibility marker L235-240; empty factions list vs absent snapshot L242-250). **Partial unavailability is not pinned** — every metric nulled simultaneously at L216-223.
- Blind-spot exposure: six section titles at L168-173 (`'Faction roster'`, `'Earth footprint'`, `'Space posture'`, `'Research posture'`, `'Councilor roster'`, `'Plan of action'`) are heading-tiles wrapping sections of children — the typical title-bar-over-content shape. A React port that renders `<header><h2>Faction roster</h2><actions/></header><children/>` and sets `header.textContent = 'Faction roster'` before appending the `<actions>` element would lose the heading on serialize. The `'ALIEN HATE'` chip (L189), the `'EARTH —'` visibility tile (L239), the `'PLAYER INTEL'` mode label (L166) and `'OMNISCIENT'` (L186), the empty-state copy at L244 and L248 are vulnerable in the same way.
- Trivia count: ~13 (panel heading, mode labels, six section titles, chip labels, empty-state copy).
- VERDICT — NOT TRUSTWORTHY — would miss a lossy rewrite. The non-text assertions survive — controller state at L174, L183, L191, L205, L262-266; mount state at L269, L271; shell selector contract at L276-279, L282 — but they pin the *control contract*, not the *visible content*. Visible-content regressions are exactly what this file is supposed to catch, and they would slip through.

### Summary table

| File | Mechanism | Both modes | Unavailable | Blind? | Trivia | Verdict |
| :-- | :-- | :--: | :--: | :--: | :--: | :-- |
| `executiveBoards.test.js` | `treeText` | yes | enumerated | no | ~30 | TRUSTWORTHY |
| `councilOrders.test.js` | `treeText` | yes | enumerated | no | ~12 | TRUSTWORTHY |
| `mc-budget.test.js` | `root.innerHTML` | yes | enumerated | yes | ~18 | WEAK |
| `world-map.test.js` | `serializeNode` | yes | enumerated | yes | ~16 | WEAK |
| `intelligenceLibraryRendering.test.js` | `serializeNode` | yes | sampled | yes | ~24 | NOT TRUSTWORTHY |
| `factionIntelRendering.test.js` | `serializeNode` | yes | sampled | yes | ~13 | NOT TRUSTWORTHY |

### What to fix first

Fix `tests/factionIntelRendering.test.js` first, before Round 3 rewrites the dossier — it is the lowest-trust file and pins the visible content of the component with the highest redaction surface (player enemy councilors visible only via `maskedAttributes`). The single change that would most raise the floor across the four blind files is to teach `mockDom.js`'s `serializeNode` (L280-300) to concatenate `node._textContent` with `children.map(serializeNode).join('')` in the same `treeText` order, so the serializer matches what the `textContent` getter already returns — that eliminates the blind spot and the four files stop needing to know about it. After that, the four files' assertions become trustworthy without per-file helper duplication.

### Red-proof quality

No file in the six documents a deliberate break of the production code. The two files whose headers *discuss* the blind spot (`executiveBoards.test.js:27-37`, `councilOrders.test.js:27-32`) explain a test-design choice, not a red-proof exercise. The deliberate-break comments live in other files (`benchDisplacementReasons.test.js:36`, `commandLayout.test.js:44`, `researchCategoryBonus.test.js:1099`). So none of the six has a documented red proof; the assertion density is high but the "I broke it first and watched it go red" claim cannot be made for any of them.
