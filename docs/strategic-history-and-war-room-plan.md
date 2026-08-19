# Strategic History & War Room Plan

Implementation plan covering two related workstreams:

- **Part A — War Room supplements.** Four dashboard features that turn verified 1.0 mechanics into decision support.
- **Part B — Storage and `strategic_snapshot_v1`.** Bounding Supabase growth, and a compact history format for trend and delta analysis.

Both draw on the 1.0 fact-check completed 2026-08-19, which verified the knowledge base against the official wiki (read as raw wikitext) and against the installed game templates in `StreamingAssets/Templates`.

**Revision note (2026-08-19, after live database analysis):** Part B has been substantially rewritten. The original draft assumed the compact history format was the answer to storage pressure. Measurement against the live project shows it is not — see §B0. Part A is unchanged.

**Status as of 2026-08-19:**

Everything in this plan is implemented.

| Item | State |
| --- | --- |
| A1 MC budget planner | **Done** — `public/v2/js/components/mc-budget.js`, interactive; verified 8 BC + 6 Monitors = +36 MC |
| A2 Total War proximity gauge | **Done** — model + UI, verified live |
| A3 Honest ventable hate | **Done** — model + UI, verified live |
| A4 Project schedulability | **Done** — on every project node, the `/tech-tree` API, and the Watchlist chip |
| A5 Mining prospects (unowned) | **Done** — `/api/intel/mining-prospects`, theater-filterable |
| B `strategic_snapshot_v1` reducer | **Done** — `shared/strategicSnapshot.mjs`, ~15 KB/save |
| B Supabase table + RPC + retention | **Done** — migrations applied and committed |
| B Backfill | **Done** — 17 saves, 82 kB on disk |
| B Prune full snapshots | **Done** — 272 rows removed, DB 89 MB → 43 MB |
| B `/history`, `/history/{id}`, delta | **Done** — `/api/intel/history`, `/api/intel/history/:saveLastModified`, `/api/intel/strategic-delta` |
| Lever 3: strip `techTree` | **Done** — 33% smaller stored snapshots; `techTreeRef` marker so omitted never reads as empty |

Test suite: **113 passing.**

Deferred, with reasons:

- **Alien Progression Speed is still unparsed**, so the Total War year axis assumes the default slider and says so in the UI rather than silently reporting a wrong year count.
- **Abductions and alien surveillance operations remain unparsed** — `TIRegionState` is collected but neither is surfaced. This is the prerequisite for a facility early-warning board and a 192-day surveillance countdown, and is its own piece of work.
- **Human war thresholds** (22.2–100, not a fixed 50) are still not modelled in the faction views.

---

## 0. Prerequisites already landed

These shipped with the audit fixes and Part A depends on them:

| Change | Location | Why it matters here |
| --- | --- | --- |
| Alien hate floor routed through the single correct implementation | `shared/intelResources.mjs` → `buildAlienHateEconomics()` | The endpoint previously reported 667 MC safe against a real ceiling of 325. Every hate-derived feature below would have inherited that error. |
| `venting` block with explicit preconditions + `guaranteed: false` | `shared/intelResources.mjs` | Feature A3 renders these. |
| `hateModifierVariance: {min: 0.8, max: 1.2}` | `shared/intelResources.mjs` | Features A1/A3 render the band. |
| Real per-hull stats on the snapshot | `server/snapshotBuilder.js` → `buildShipHullStats()` | Feature A1 needs per-hull Mission Control. |
| Regression suite | `tests/alienThreatResource.test.js` | 11 tests pinning the wiki reference table. |

`snapshot.shipHullStats` is keyed by hull `dataName` and carries `missionControl`, `constructionTier`, `baseConstructionTimeDays`, `noseHardpoints`, `hullHardpoints`, `structuralIntegrity`, `requiredProjectName`.

---

# Part A — War Room supplements

## A1. Mission Control budget planner

**Problem.** The Alien Hate Economics card is a readout: it states the current floor. The question the doctrine actually asks is forward-looking — *can we afford this fleet?* Mission Control is the sole input to the alien minimum-hate floor, so every build decision is also a diplomacy decision, and nothing in the tool connects them.

**Why it is now possible.** Per-hull MC is real template data the code previously discarded (it hard-coded `missionControl: 1` for every design). Actual values: Escort 1, Monitor 2, Destroyer 2, Cruiser 3, Battlecruiser 3, Battleship 3, Lancer 4.

**Worked example** against the published state (60/137 MC used/cap, Normal, 0 concealment projects):

| Plan | Added MC | New used | New floor | Binding constraint |
| --- | --- | --- | --- | --- |
| Current | — | 60 | 18.0 | — |
| 14-ship fleet (8 BC + 6 Monitors) | 36 | 96 | 28.8 | none |
| 20-ship fleet (12 BC + 8 Monitors) | 52 | 112 | 33.6 | **MC cap 137 nearly binding** |

The second row is the finding: the constraint that bites first is the MC *cap*, not the hate floor. Neither the doctrine pages nor the dashboard surface that today.

**Build.**

- New component `public/v2/js/components/mc-budget.js`, rendered inside or beside the hate card.
- Inputs: `snapshot.shipHullStats`, `economics.usedMissionControl`, `economics.missionControlCapacity`, `economics.mcWarFloor`, `economics.difficultyMultiplier`, `economics.concealmentMultiplier`.
- Show: current used/cap; headroom to cap; headroom to the **war floor** (`mcWarFloor - used`); per-hull "cost to add one".
- Let the user stage a hypothetical build and recompute in place. No server round-trip — the math is `used × difficultyMultiplier × concealmentMultiplier`.
- **Fold in the mine-limit penalty.** Excess mines beyond the limit (36 pre-Future-Tech, 42 for Project Exodus) add `Max(1, Floor(excess² / 2))` MC. Ten excess mines cost 50 MC = +15 hate on Normal. Mines and warships compete for one budget; show them together.

**Acceptance.** Given 60 used MC and a staged 8×Battlecruiser build, the panel reports 84 used and a 25.2 floor. A staged build that pushes used MC past `mcWarFloor` shows a critical state naming the hull count that crosses it.

---

## A2. Total War proximity gauge

**Problem.** Total War is binary, catastrophic, and invisible to the tool. It permanently voids hate venting — the mechanic pages 02 and 11 both build strategy on.

**Mechanic** (wiki `Diplomacy`, last edited 2026-08-11):

- Alien **maximum** hate: Normal starts at 1000, +100/year. Cinematic starts at 70, +2/year. If ≥25 years elapsed and the max is under 200, it is raised to 200. Whenever minimum exceeds maximum, maximum is set to the minimum.
- **Total War** triggers at ≥200 hate once ≥20 years have passed (Normal), after which venting becomes far more restrictive and the war is effectively permanent.
- All campaign-duration checks are multiplied by the **Alien Progression Speed** slider. Accelerated Campaign sets it to 200%, so each year counts as two.

**Build.**

- Extend `buildAlienHateEconomics()` with `maximumAlienHate`, `yearsElapsed`, `totalWarHateThreshold`, `totalWarYearsThreshold`, `totalWarState` (`'safe' | 'approaching' | 'active' | 'unavailable'`).
- Inputs already present: `metadata.campaignStartYear` (`server/saveParser.js:121`), current campaign date, difficulty. `campaign_start_year` is also already a column on `player_intel_snapshots`.
- Render as a **two-axis** gauge — hate vs 200, elapsed years vs 20. Total War requires both, so a single bar would mislead.

**Known gap.** Alien Progression Speed is **not parsed**. Until it is, the year axis is only correct at 100% progression. Emit `progressionSpeedKnown: false` and label the assumption rather than silently reporting a wrong year count.

**Acceptance.** 71.6 hate / 9 years reports `safe` with both distances. 210 hate / 22 years reports `active`, and A3 switches to its voided state.

---

## A3. Honest ventable hate

**Problem.** `ventableHate = actualHate − minimumHate` reads as "this much will drain away." It will not.

**Mechanic.** The aliens vent hate on destroying a player asset only if **all** hold:

1. Not at Total War.
2. The asset is not **Trespassing** — at or beyond Jupiter's orbit, *or anywhere the aliens hold a hab*, except Earth.
3. The asset was **actually targeted by the aliens**. Self-defence kills vent nothing.

Amounts: ship = hull **Construction Tier**; complete hab module = `ModuleTier²` (+Tier if Mining Complex, +Tier if Construction Module), ÷ 2/3/4/5 for Cinematic/Normal/Veteran/Brutal.

**Build.**

- The API already returns `venting` with `guaranteed: false` and the conditions. The card must render them, not a bare number.
- Add a **per-theater trespass check**: if any alien hab exists in a theater containing player assets, mark those assets vent-ineligible. `snapshot.habs` carries faction and body; `spaceTheater.theaterForBody()` exists.
- States: `ventable` (green, with ±20% band), `conditional` (amber, conditions listed), `voided` (red).
- Show **per-asset vent value** so "is this station worth losing?" is answerable: a tier-2 hab module vents `4 ÷ 3 ≈ 1.33` hate on Normal — almost never worth a station.

**Acceptance.** With an alien hab at Mars and player habs at Mars, those habs report vent-ineligible with the reason. Under Total War the panel reports `voided` regardless of arithmetic.

---

## A4. Project schedulability

**Problem.** A research "priority order" implies you can schedule projects. You cannot — availability is a two-stage RNG gate. This is exactly why page 06's ordering was wrong.

**Mechanic** (verified against installed templates):

| Project | RP | initial | delta/mo | **max** | Schedulable? |
| --- | --- | --- | --- | --- | --- |
| `Project_FleetCombatants` | 6000 | — | — | **100** | Yes — deterministic |
| `Project_NanotubeArmor` | 5000 | 0 | 5 | **35** | No — capped monthly roll |

Availability starts at `initialUnlockChance`, rises `deltaUnlockChance`/month, caps at `maxUnlockChance`. Council Science raises the roll (+0.2% per point summed across the **whole** council), as does research share on the parent tech.

**Build.**

- Surface the three unlock-chance fields through `server/templateLoader.js` into `shared/techGraph.mjs`, then into `/api/intel/tech-tree` nodes.
- Add `schedulable: boolean` (true iff `maxUnlockChance >= 100`) and `expectedMonthsToAvailable` — expectation of a geometric process over the ramp `p(m) = min(initial + delta·m, max)`.
- Render a **Guaranteed / RNG-gated** chip in the Technology Watchlist, plus expected wait.

**Acceptance.** Fleet Combatants renders `Guaranteed`. Nanotube Armor renders `RNG-gated · 35%/mo cap · ~5 months expected`. No capped project is ever presented as a schedulable step.

---

## A5. Mining site quality analysis — unowned sites only

**Problem.** The audit found page 10 treated Fortuna and Zelinda as notable producers. Both use `CarbonaceousMine`, shared by **95 of 671** sites. Aspasia and Lutetia carry the *identical* `MixedCMMine` profile, so the "strong" vs "useful" distinction was fabricated. Quality is computable; guessing produced wrong doctrine.

**Scope.** Rank **unowned sites only** — this is an expansion-targeting tool, not an inventory. `snapshot.habSites[].factionName === 'Unclaimed'` already identifies them; no new parsing needed.

**Data available per site** (`server/snapshotBuilder.js:565`): `water`, `volatiles`, `metals`, `nobleMetals`, `fissiles` (per-day rates), plus `parentBodyName`, `spaceTheaterKey`, `habTier`, `pendingHab`.

**Build.**

- New `miningProspectsResource` in `shared/intelResources.mjs`, exposed at `/api/intel/mining-prospects`.
- Filter `factionName === 'Unclaimed'` and not `pendingHab`.
- Compute a **per-resource percentile** both within the site's mining profile and globally. Two numbers, because "best of its type" and "good in absolute terms" are different questions — Fortuna is mid-of-type *and* unremarkable globally; Hertha is max-of-type *and* best-in-game for nobles.
- **Weight by scarcity, not raw yield.** Nobles bind military construction (17–38% of most component costs, 0% for drives) and cap at 31.25 across the solar system while metals reach 62.5. A flat sum would rank metal sites first and reproduce the original mistake. Defaults: nobles 3.0, fissiles 3.0, volatiles 1.5, water 1.0, metals 1.0 — configurable.
- **Surface the marginal MC cost** of each prospect given the current mine count, so a "great" site past the mine limit reads as expensive rather than free. This is the A1 linkage.
- Show theater and a transit-feasibility hint so unreachable prospects sort down.

**Acceptance.** Hertha-class Metallic sites top the nobles ranking; generic `CarbonaceousMine` sites show their true percentile. Owned sites never appear.

---

# Part B — Storage and strategic history

## B0. Measured reality of the live database

Measured 2026-08-19 against project `wckfkfczckgdggefbcok` (org plan: **free**, 500 MB database ceiling).

| Metric | Value |
| --- | --- |
| Database total | **87 MB** |
| `player_intel_snapshots` | **77 MB** (72 MB in the `snapshot` column) |
| `campaigns` | 32 kB |
| Rows | **320** |
| Distinct saves | **16** |
| **Rows per save** | **24** (8 observer factions × 3 visibility modes) |
| Avg row (on disk) | 229 kB · max 722 kB |
| Uncompressed payload | 398 MB → 72 MB on disk (**5.5× TOAST compression**) |
| Cost per save, oldest → newest | **824 kB → 15 MB** |
| Retention | **none — every save ever published is still stored** |
| Security advisors | clean, no lints |

### This inverts the original plan's premise

The first draft treated `strategic_snapshot_v1` as the fix for storage pressure. It is not. A compact snapshot is ~30 KB; five of them is **150 KB — about 1% of a single current save**. The history feature is essentially free, which is good news, but it does not address storage at all.

The real problem is three separate things:

1. **No retention.** `scripts/push_latest_to_supabase.js` only upserts; nothing ever deletes. All 16 saves are retained.
2. **24× fan-out.** `for (observer of observerFactions) for (mode of INTELLIGENCE_MODES)` produces 24 rows per save. I verified all 24 payloads are genuinely **distinct** (including all 8 omniscient copies), so naive deduplication will not work — this has to be a publishing-policy decision.
3. **Superlinear growth.** Per-save cost rose 824 kB → 15 MB across 16 saves as the campaign advanced. The curve is driven by campaign size, so it keeps climbing.

**Runway.** 413 MB headroom ÷ ~15 MB per save ≈ **25 more saves**, and fewer as per-save cost grows. That is weeks of play, not months.

### The correct relationship between the two workstreams

> The compact history is not the storage fix. It is **what makes aggressive retention safe.**

You can afford to keep only two or three full snapshots precisely because the compact history preserves the trend line after the full snapshots are deleted. Sequence the work that way: history first, then retention.

---

## B1. Storage levers, ranked by impact

| # | Lever | Saving | Effort | Risk |
| --- | --- | --- | --- | --- |
| 1 | **Reduce publish fan-out** | up to **87%** | S | Policy decision — see below |
| 2 | **Retention on `player_intel_snapshots`** | bounded, permanent | S | Needs history first |
| 3 | **Strip `techTree` from stored snapshots** | **11.7%** of payload | S | Resolve from templates at read time |
| 4 | Add `strategic_snapshots` | +0.6 MB (a cost, not a saving) | M | None |

### Lever 1 — fan-out policy

24 rows per save is the dominant multiplier. Per-save on-disk cost is ~15 MB ÷ 24 ≈ **625 kB per row**, so every row you stop publishing is a direct saving.

The question is what the extra 21 rows are *for*. Publishing `player` and `enhanced` for the seven non-observer factions answers "what does the Servants know?", and eight separate `omniscient` rows differ only by observer-relative framing. Suggested tiered policy, configurable:

```js
PUBLISH_POLICY = {
  observerFaction: ['player', 'enhanced', 'omniscient'],  // 3 rows
  otherFactions:   [],                                    // 0 rows (was 21)
}
```

24 rows → 3 rows is an **87.5% cut**, taking a 15 MB save to ~1.9 MB. If cross-faction analysis matters, `otherFactions: ['player']` still cuts 24 → 10.

**This is your call, not a technical constraint** — it trades analytical breadth for runway. Recommend deciding it before implementing retention, since it changes what retention needs to hold.

### Lever 3 — strip `techTree`

`techTree` is **11.7%** of uncompressed payload and is overwhelmingly static template data, duplicated across all 320 rows. `server/templateLoader.js` already loads the source templates locally, and the tech tree is rebuilt per snapshot at `server/snapshotBuilder.js:1102`.

Store a `techTreeVersion` / template hash instead and resolve the tree at read time. Adding `shipDesigns` to the strip list takes it to 14.3%, but designs are genuinely per-save state — strip `techTree` only.

### Projected steady state

| | Now | After levers 1–4 |
| --- | --- | --- |
| Rows per save | 24 | 3 |
| Full snapshots retained | 16 (unbounded) | 3 |
| Full-snapshot storage | 77 MB | **~5 MB** |
| Compact history | — | 20 rows ≈ 0.6 MB |
| **Total** | **77 MB** | **~6 MB** |

That converts an unbounded curve into a bounded one, with *more* usable history than today.

---

## B2. Design rules for `strategic_snapshot_v1`

> **Current save = full fidelity. Older saves = compact strategic history.**

A historical snapshot answers *what changed and which way are we trending*, not *reconstruct every endpoint*. It must:

- Store **IDs and raw numbers**, never presentation strings. `4712`, not `"The Initiative"`.
- Exclude **all static template data** — tech tree, component catalogs, mining-site deposits, effect definitions. This is the same discipline as lever 3.
- Be **independently readable**. No delta chains: if H-3 is corrupted, H-4 and H-5 still parse. Diffs computed on demand.
- Fit in **one JSONB document per save**, not 40 normalized tables.

**Revised retention count.** The original plan said five. Given a compact snapshot is ~30 KB, **20 is still only ~600 KB** — cheaper than a twentieth of one current save. Default to **20 history rows**, and spend the saved space on depth rather than hoarding full snapshots. `retention` stays configurable.

---

## B3. Schema

Reconciled with the **live** schema, which differs from the original draft in two ways that matter:

- **There is no `save_hash` column.** Save identity in this database is `(campaign_key, save_last_modified)`. The proposed `UNIQUE (campaign_key, save_hash)` cannot be built as written.
- `campaigns.campaign_key` is the primary key and `player_intel_snapshots.campaign_key` already references it, so the new table should too.

```sql
create table public.strategic_snapshots (
    id                 uuid primary key default gen_random_uuid(),

    campaign_key       text        not null references public.campaigns(campaign_key) on delete cascade,
    save_last_modified timestamptz not null,
    save_filename      text,
    game_time          text,
    campaign_date      timestamptz not null,

    schema_version     int         not null default 1,
    payload            jsonb       not null,

    created_at         timestamptz not null default now(),

    unique (campaign_key, save_last_modified)
);

-- Covers the FK (Postgres does not index FKs automatically) and serves the
-- newest-first retention and listing queries from one index.
create index strategic_snapshots_campaign_recent_idx
    on public.strategic_snapshots (campaign_key, campaign_date desc, save_last_modified desc);

alter table public.strategic_snapshots enable row level security;
```

RLS should mirror the existing pattern in `supabase/migrations/20260817204009_allow_public_omniscient_snapshots.sql` — public read where the parent campaign is public, service-role write. Wrap any function call in a policy as `(select ...)` so it evaluates once rather than per row.

## B4. Retention must be one atomic server-side function

**`supabase-js` has no multi-statement transaction support.** An insert followed by a prune issued as two client calls can interleave with a concurrent publish and delete the row it just wrote. Retention has to run server-side.

Per Supabase's own guidance, a `SECURITY DEFINER` function must live in a non-exposed schema, pin `search_path`, fully qualify every reference, and have `EXECUTE` revoked from roles that should not call it:

```sql
create schema if not exists private;

create or replace function private.store_strategic_snapshot(
    p_campaign_key       text,
    p_save_last_modified timestamptz,
    p_save_filename      text,
    p_game_time          text,
    p_campaign_date      timestamptz,
    p_payload            jsonb,
    p_retention          int default 20
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.strategic_snapshots
        (campaign_key, save_last_modified, save_filename, game_time, campaign_date, payload)
    values
        (p_campaign_key, p_save_last_modified, p_save_filename, p_game_time, p_campaign_date, p_payload)
    on conflict (campaign_key, save_last_modified) do update
        set payload       = excluded.payload,
            campaign_date = excluded.campaign_date,
            game_time     = excluded.game_time
    returning id into v_id;

    delete from public.strategic_snapshots
    where campaign_key = p_campaign_key
      and id not in (
          select id from public.strategic_snapshots
          where campaign_key = p_campaign_key
          order by campaign_date desc, save_last_modified desc
          limit p_retention
      );

    return v_id;
end;
$$;

revoke all on function private.store_strategic_snapshot from public, anon, authenticated;
grant execute on function private.store_strategic_snapshot to service_role;
```

A sibling `private.prune_intel_snapshots(p_campaign_key text, p_keep int)` should do the same for `player_intel_snapshots` (lever 2). Call both from `scripts/push_latest_to_supabase.js` after a successful publish.

**Retention model.** N compact history rows plus the retained full snapshots gives N+K comparison points while the compact rows cost ~30 KB each.

## B5. Payload specification

### Header

```json
{
  "schema": "strategic_snapshot_v1",
  "meta": {
    "campaignKey": "initiative-project-phoenix",
    "saveLastModified": "2026-08-19T19:39:18.954Z",
    "saveFilename": "Autosave.gz",
    "campaignDate": "2031-10-16T12:00:00",
    "difficulty": "Normal"
  }
}
```

No generated-at timestamps in nested objects.

### `summary`

```json
{
  "observerFactionId": 4712,
  "factions": [
    { "id": 4712, "cp": 24, "nations": 5, "habs": 13, "fleets": 2, "ships": 23,
      "gdp": 44260000000000, "research": 2022 },
    { "id": 4717, "habs": 24, "fleets": 54, "ships": 161 }
  ]
}
```

### `economy`

```json
{
  "money": 123456,
  "boost": 87.2,
  "mc": { "used": 60, "cap": 137, "minePenalty": 0 },
  "mines": { "count": 12, "limit": 36 },
  "resources": {
    "water": [4112, 189], "volatiles": [9493, 275], "metals": [8546, 325],
    "nobles": [3995, 103], "fissiles": [325, 3.5],
    "antimatter": [0, 0], "exotics": [12.8, 0]
  }
}
```

Tuples are `[stockpile, monthlyNet]`. `mines` and `mc.minePenalty` are additions beyond the original design: the mine limit imposes a quadratic MC penalty that converts directly into alien hate, so it belongs in the same history as MC and hate.

### `alienThreat`

Uses the **corrected** field set. Any history captured before the hate fix would carry a floor computed with additive concealment and wrong difficulty multipliers — **do not backfill from existing stored snapshots.**

```json
{
  "hate": 71.61, "minimumHate": 18.0, "maximumHate": 1000,
  "usedMC": 60, "warThreshold": 50, "concealment": 0,
  "retaliationActive": true, "totalWar": false, "yearsElapsed": 9
}
```

`concealment` is the completed-project **count** — the multiplier is `0.8^n`, so the count reconstructs the floor.

### `research`

```json
{
  "monthly": 2022,
  "global":   [["Supercapacitors", 12455, 30000], ["ArcLasers", 8820, 25000]],
  "projects": [["Project_FleetCombatants", 2567, 6000]],
  "completedSincePrior": ["Project_NanotubeArmor"],
  "completedTechHash": "sha1:...",
  "completedProjectHash": "sha1:..."
}
```

Tuples are `[id, progress, total]`. Never the tech tree — that is the same 11.7% problem as lever 3.

### `theaters`

Highest value per byte in the format.

```json
[
  { "body": "Earth", "ours": [0,3,2], "aliens": [24,4,1],
    "servants": [9,2,3], "protectorate": [12,3,5] },
  { "body": "Mars",  "ours": [23,2,1], "aliens": [0,0,0] }
]
```

Tuples are `[ships, fleets, habs]`. Twenty snapshots of this yields a full campaign trend for a few kilobytes.

### `friendlyFleets` and `ships`

```json
{
  "friendlyFleets": [
    { "id": 28833, "body": "Mars", "ships": 14, "dv": 21.8,
      "cruiseMg": 9.7, "combatMg": 238,
      "operation": "Transfer", "destination": "Earth", "arrival": "2032-06-13",
      "designs": [["Patapsco", 4], ["Cimarron", 3], ["Xingu", 1]] }
  ],
  "ships": [[1823, "Patapsco", 28833], [1824, "Patapsco", 28833]]
}
```

Ship tuple is `[shipId, designId, fleetId]`. **Store only living ships** — absence between snapshots already means loss, so an `alive` flag is redundant. Upgrades reporting from *"you lost four ships"* to *"you lost three Devilfish and one Cimarron; both Patapscos survived."*

### `hostileContacts`

Never all 54 alien fleets. Retain only fleets that are targeting a player asset, intercepting a player fleet, transferring to a player-controlled body, in the same theater as a player fleet/hab, or at/above `hostileContactMinimumShips`.

```json
[
  { "id": 22169, "faction": 4717, "ships": 19,
    "origin": "Earth", "destination": "Mars",
    "targetType": "hab", "targetId": 19373, "arrival": "2031-10-26",
    "weaponMix": { "laser": 9, "kinetic": 4, "missile": 3, "pd": 11 } }
]
```

### `infrastructure`, `construction`, `transfers`

```json
{
  "infrastructure": [
    { "id": 19373, "body": "Mars", "tier": 2,
      "mine": 0, "yards": 3, "defense": 2, "construction": 1, "research": 0 }
  ],
  "mines": [["Hertha", 4712, 1], ["Aspasia", 4712, 1]],
  "construction": [
    { "id": "build-8723", "type": "ship", "design": "playerShipTemplate584",
      "location": "Mars", "completion": "2031-10-17" }
  ],
  "transfers": [
    { "fleet": 22169, "faction": 4717, "from": "Earth", "to": "Mars",
      "ships": 19, "arrival": "2031-10-26", "target": 19373 }
  ]
}
```

Mine tuple is `[siteName, factionId, tier]`. Static deposit values stay out — the game does not modify them.

### `events`

Derived at write time by comparing against the previous compact snapshot.

```json
[
  { "type": "ship_loss", "faction": 4712, "count": 4,
    "designs": [["Devilfish", 3], ["Cimarron", 1]] },
  { "type": "hab_lost", "faction": 4712, "body": "Mars", "id": 19373 },
  { "type": "tech_completed", "id": "Project_NanotubeArmor" },
  { "type": "hate_threshold_crossed", "from": 48.2, "to": 52.9,
    "threshold": 50, "direction": "up" }
]
```

`hate_threshold_crossed` is an addition — crossing 50 is the most consequential discrete state change in a campaign and should be first-class, not inferred from two numbers.

**Explicitly excluded:** all nations, all councilors, tech/weapon/component templates, all alien ships, all hab modules, mining-site deposit metadata, static effect definitions, capability mappings.

## B6. Reducer policy

```js
const HISTORY_POLICY = {
  retention: 20,                          // raised from 5 — see B2
  friendlyFleetDetail: true,
  friendlyShipLedger: true,
  hostileContactMinimumShips: 5,
  preserveHostileIfTargetingPlayer: true,
  preserveHostileIfSameTheater: true,
  preserveConstruction: true,
  preserveResearchQueues: true,
  preserveCouncilors: false,
  preserveNations: false,
  preserveShipComponents: false,
  preserveStaticTechTree: false,
};
```

## B7. Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/intel/history` | `{ current: {...}, history: [...] }` |
| `GET /api/intel/history/{saveLastModified}` | One `strategic_snapshot_v1` document |
| `GET /api/intel/delta` | Current vs most-recent stored history |
| `GET /api/intel/delta?from=X&to=Y` | Any two compact snapshots |

Note the path key is `saveLastModified`, not a `snapshotId` — there is no stored snapshot hash to address by. Deltas are **computed on demand**, never stored.

```json
{
  "period": { "from": "2031-07-16", "to": "2031-10-16", "days": 92 },
  "military": {
    "initiativeShips": { "from": 23, "to": 19, "delta": -4 },
    "alienShips":      { "from": 161, "to": 168, "delta": 7 }
  },
  "economy": { "nobles": { "stockpileDelta": -318, "netMonthlyDelta": 14 } },
  "hate":    { "from": 71.6, "to": 58.2, "delta": -13.4 },
  "events":  ["Lost 4 Initiative ships", "Alien 19-ship strike launched toward Mars"]
}
```

This becomes the first call for *"I uploaded a new save, assess it."*

## B8. Size budget

Target **<100 KB** uncompressed per snapshot; ideal **<50 KB**; hard ceiling **250 KB**.

Estimating from the current save (23 friendly ships, 13 habs, 2 fleets, ~30 theaters, ~10 hostile contacts), the realistic figure is **well under 30 KB**. Note the live table shows **5.5× TOAST compression** on jsonb, so on-disk cost will be a fraction of that again. The budget exists to catch regressions where someone reintroduces template data, not because the format is near its limit.

## B9. Acceptance tests

1. **Wiki-table conformance.** Covered by `tests/alienThreatResource.test.js`; the history `alienThreat` block must reuse that computation, not a second copy.
2. **Size ceiling.** Serialize from the real fixture; assert `< 250 KB`, warn above 100 KB.
3. **No static leakage.** Assert the payload contains no tech-tree, component-template or mining-deposit keys, and no display strings where an ID exists.
4. **Independence.** Each stored snapshot parses in isolation with the others deleted.
5. **Retention.** Publishing `retention + 1` distinct saves leaves exactly `retention` rows, newest by `(campaign_date, save_last_modified)`.
6. **Idempotence.** Republishing an identical `(campaign_key, save_last_modified)` does not create a second row and does not evict a distinct snapshot.
7. **Ship-loss fidelity.** Two snapshots differing by three removed ship IDs produce an event naming the three designs correctly.
8. **Storage regression guard.** Assert `player_intel_snapshots` row count per campaign never exceeds `retainedSaves × rowsPerSave`.

## B10. Implementation order

| Phase | Work | Depends on |
| --- | --- | --- |
| 1 | A2 Total War gauge, A3 honest venting | Nothing — data already on snapshot |
| 2 | A1 MC budget planner | `shipHullStats` (landed) |
| 3 | A4 project schedulability | Unlock-chance fields through `techGraph.mjs` |
| 4 | A5 mining prospects (unowned) | Mining profile percentiles from `templateLoader` |
| **5** | **Decide fan-out policy (lever 1)** | **Your call — blocks 7** |
| 6 | Reducer + `strategic_snapshot_v1` writer, behind a flag | Phases 1–2 for `alienThreat` |
| 7 | Migration: table, RPC, RLS; wire retention into the push script | Phases 5–6 |
| 8 | Strip `techTree` from stored snapshots (lever 3) | Phase 7 |
| 9 | `/history`, `/history/{id}`, `/delta` upgrade | Phase 7 |

Phases 1–4 are independent of Part B and deliver value immediately. **Phase 5 is a decision, not code, and it gates the largest saving.**

## B11. Open items and risks

- **Fan-out policy is unresolved and is the biggest lever.** 24 → 3 rows per save is an 87.5% cut but removes cross-faction intel views. Needs a decision.
- **Do not backfill history from existing rows.** Snapshots stored before the alien-hate correction carry a wrong floor; a trend built from them would be wrong in a plausible-looking way.
- **Alien Progression Speed is unparsed.** Blocks exact Total War year math (A2). Small fix in `server/saveParser.js`.
- **Abductions and alien surveillance operations are unparsed.** `TIRegionState` is collected but neither is surfaced. Would enable a facility early-warning board (Build Facility needs ≥15 regional abductions) and a 192-day surveillance countdown. Its own pass.
- **"Quiet" aliens (build 1.0.47).** The aliens now temporarily favour less aggressive actions. Any indicator inferring threat from *observed activity* will read a quiet period as de-escalation while the structural position is unchanged. Keep structural risk (hate, MC, floor, Total War distance) visually separate from behavioural risk.
- **Human war thresholds are not 50.** They range 22.2–100 by ideological distance and self-assessment. The dashboard shows raw per-pair hate against an implied fixed threshold. Candidate for a later phase.
- **Growth is superlinear.** Even with retention, per-save cost keeps climbing with campaign size. Re-measure after phase 8 and revisit `retainedSaves` if the curve steepens.

---

## Source provenance

Live database figures measured 2026-08-19 against project `wckfkfczckgdggefbcok`.

Game mechanics verified 2026-08-19 against:

- The official wiki at `wiki.hoodedhorse.com/Terra_Invicta/`, read as **raw wikitext** via the MediaWiki API — alien mechanics sit inside spoiler templates that never expand in the rendered page. Key pages and last-edit dates: `Diplomacy` 2026-08-11, `Factions` 2026-08-18, `Aliens` 2026-04-05, `Habs` 2026-04-15, `Fleets` 2026-05-27, `Spaceships` 2026-05-07, `Orgs` 2026-01-31.
- The **installed game templates** in `TerraInvicta_Data/StreamingAssets/Templates`, ground truth for the current build, which resolve the wiki's pre-1.0 CSV export caveat.
- Steam's news API for build history: current build **1.0.51** (2026-07-30), plus the **Dark Skies** DLC (2026-07-27).

Full audit: <https://claude.ai/code/artifact/439ce4be-4f12-41f5-a27c-3ad55b87fca5>
