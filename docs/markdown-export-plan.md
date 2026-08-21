# Markdown Exports as the LLM Interface

Three markdown exports at three altitudes. JSON stays optimised for the dashboard; markdown becomes the interface for language-model consumers.

Written 2026-08-20 against commit `f269f8a`. Every availability claim below is measured against the live save, in both modes.

---

## 1. Why, measured

An external agent could not read the operational picture and fell back to the user's in-game readings. That was a correct call on its part, and our fault. Measured on the hosted site:

| endpoint | size | lines |
| :-- | --: | --: |
| `/api/intel/fleets` | **908.9 KB** | **1** |
| `/api/intel/ships` | 766.0 KB | 1 |
| `/api/v2/briefing` | **3.3 MB** | **1** |
| `/latest-snapshot.md` | 13.9 KB | 98 |

Every JSON response is minified onto a single line. `?pretty=1` is silently ignored — verified byte-identical with and without. A 3.3 MB single-line body cannot be text-extracted; any crawler truncates it mid-token.

**The fix is not to pretty-print every JSON endpoint.** The JSON is shaped for the dashboard and should stay that way. Markdown becomes the model-facing surface.

`/latest-snapshot.md` is already the right *format* — line-broken, 98 lines — but carries only macro state: alien hate economics, faction balance, enemy holdings, technology, space balance. It has **no fleet locations, manifests, destinations, ETAs, or incoming transfers**, which is exactly what was needed.

### The architecture

```
/latest-snapshot.md    macro campaign state          ~14 KB   (exists, unchanged)
/latest-war-room.md    operational military/economic  20-30 KB  (new)
/latest-threats.md     immediate danger only          <10 KB   (new)
```

---

## 2. Field availability — verified, not assumed

### Available

**Per-ship**, inside `fleet.ships[]` — richer than the fleet level:

`hullName` · `cruiseAccelerationMps2` · `combatAccelerationMps2` · `currentDeltaVKps` · `currentMaxDeltaVKps` · `weaponLoadout` · `dominantWeaponType` · `armor` · `armorMedian` · `missionControlConsumption` · `propellantTons` · `currentMassKg`

Note `cruiseAccelerationMps2` exists **per ship**, not on the fleet — the fleet carries only `lowestCombatAccelerationMps2` and `lowestDeltaVKps`.

**PD count is available.** `weaponLoadout` entries carry `role: "Point Defense"` with a `count`, e.g. `[{role:"Laser",count:1,systems:["720 cm Green Laser Cannon"]},{role:"Point Defense",…}]`.

**Fleet level:** `mission` · `destination` · `destinationType` · `arrivalDate` · `orbitBody` · `spaceTheaterName` · `orbitBodyDistanceAU` · `inCombat` · `currentOrders` · `visibility`

**Resources:** stockpile and `monthlyNet` for **eight**, not six — the spec's water/volatiles/metals/nobles/fissiles/exotics plus `Antimatter` and `Money`/`Influence`/`Operations`/`Research`/`Projects`/`Boost`/`MissionControl`.

**Alien threat, hate, MC:** already assembled by `assessCampaignPosture` and `buildAlienHateEconomics`. Consume those — do not re-derive, and never read `assessedAlienHateOfMe` directly, which is redacted in player mode.

### Gaps that require work

**1. Ship `hullName` is a template id, not a readable name.** Values are `playerShipTemplate401`, `playerShipTemplate85`, … The design rollup the spec asks for —

```
India-139 — 12 ships
  6 Patapsco
  3 Xingu
  3 Cimarron
```

— needs a join: `ship.hullName` → `shipDesigns[].dataName` → `_displayName` / `friendlyName`. `shipDesigns[]` also carries a readable `hullName` (`"Escort"`) which is the hull *class*, distinct from the design name. Build the lookup once per render, not per ship.

**2. Hab detail needs a join to `habModules`.** `habs[]` carries only `ID` · `displayName` · `habType` · `tier` · `orbitBody` · `spaceTheaterName` · `inCombat` · `underAssault` · `underBombardment` · `visibility`. It has **no** mine count, shipyard count, defenses, repair/refuel flag, or resource output. All of those come from `habModules` (88 rows in player, 1,981 in omniscient) joined on hab id. Reuse the shipyard/construction classification from `shared/strategicSnapshot.mjs`, which was fixed on 2026-08-20 to read `allowsShipConstruction` and the `CanFoundTier*Habs` special rules from templates rather than regex-matching module names.

**3. Interception / pursuit state does not exist.** The only distinct `mission` values across all 144 fleets are **`"Stationary / Patrol"`** and **`"Transfer"`**. There is no interception, pursuit, or intercept-target field anywhere on the fleet. The spec's "interception/pursuit state" and "which fleets are being intercepted" cannot be filled from this save format.

Report it as unavailable. Do **not** infer pursuit from a shared destination — two fleets heading to the same body is not evidence of interception, and presenting an inference as a state reading is the failure this repo has spent the most effort eliminating. If an intercept signal is wanted, it needs a save-format investigation first, as its own task.

### One untested path worth pinning

The observer currently has **zero** shipyard queues (raw snapshot holds 70; none are faction 4712). Player mode reports `shipyardQueues: 0` while enhanced and omniscient report 70.

Because the observer owns none right now, **it cannot be determined from this save whether player mode preserves the observer's own queue or drops the array wholesale.** If it drops wholesale, the war-room export would show an empty construction section to a player who does have ships building — silently, and only in the default mode.

Verify with a synthetic queue owned by 4712 before shipping. This is exactly the shape of the two defects `CLAUDE.md` records under "always check player mode".

---

## 3. `/latest-war-room.md`

Target 20–30 KB. Sections per the spec: CAMPAIGN · ALIEN THREAT · FRIENDLY FLEETS · HOSTILE RELEVANT FLEETS · INCOMING THREATS · SHIPYARDS/CONSTRUCTION · KEY HABS · LOGISTICS · ACTIVE RESEARCH.

### The size rule is the design

**Never dump all fleets.** There are 144 fleets and 412 alien ships on the current save, and the user notes a prior era with 161 alien ships. Unfiltered, this balloons past any useful size.

Friendly fleets: all of them, with a **compact design rollup** rather than per-ship components. Drill-down stays at `/api/intel/ship-designs`.

Hostile fleets: include only those matching **any** of —

- targeting the observer
- destination is an observer-controlled body or hab
- sharing a body with an observer fleet or hab
- `shipsCount >= 5`
- arrival within 365 days

Each filter must be individually evaluable; a hostile fleet whose relevance cannot be determined is **included** with the reason stated. Under-reporting a threat is the worse error, and "we could not tell" is a legitimate line in a war-room brief.

Every omission is counted and stated — `"37 hostile fleets omitted (below relevance threshold)"`. Silent truncation reads as "this is everything", which is the same defect class as fabricating data.

### Player mode

Alien fleets are visible only through a detection capability; the live save carries `visibility: "Deep System Skywatch"`. **Zero visible hostile fleets must render as "no detection coverage", never as "no threats".** An unobserved sky is not an empty one.

---

## 4. `/latest-threats.md`

Target under 10 KB. The endpoint to hit first for *"the aliens are coming to Mercury, what do I do?"*

Only what can hurt the observer within a year: hostile transfers inbound to observer assets, friendly fleets at risk, assets targeted, ETAs, relative ship counts, PD/weapon mix on both sides, and friendly construction completing before arrival.

Ordered by time-to-impact, not by size. A 6-ship fleet arriving in 40 days outranks a 40-ship fleet arriving in 300.

Where the engagement outcome matters, reuse the Monte Carlo from `server/commentary/simulation.js` rather than writing a second model — and carry its `simulated: true` flag through into the markdown so a modelled band is never mistaken for a measured count.

---

## 5. Shared requirements

- **Both runtimes.** These must render locally and hosted. The Cloudflare worker cannot `require` CommonJS and has no filesystem or template access, so the renderer belongs in `shared/` as ESM. `shared/apiSurface.mjs` is the working precedent.
- **Both modes, always.** Player is the default and a genuinely different code path.
- **Absent stays null.** An unmeasured value renders as `UNAVAILABLE`, never `0`. `combatPower` is not in the save at all (`combatPowerSource: "not present in save"`) — it must render as unavailable everywhere it appears.
- **No fabricated fallbacks.** No placeholder fleet, no assumed design, no default ETA.
- **Deterministic.** Same snapshot → byte-identical markdown. No clock-seeded values, no `Math.random()`.
- Register the two new routes in the `/api/intel` discovery index, **with approximate response sizes**, so a model-facing client can choose an endpoint without first downloading a 909 KB one.

---

## 6. Acceptance

- `/latest-war-room.md` between 15 and 30 KB on the current save, in both modes. Assert the ceiling in a test — this is the requirement most likely to erode.
- `/latest-threats.md` under 10 KB.
- Both are `text/markdown`, multi-line, and contain no `null` / `undefined` / `NaN` / `[object Object]`.
- Hostile-fleet filtering demonstrably reduces the set; the omitted count is printed.
- Zero visible alien fleets renders as no-detection-coverage, not no-threats. Test by stripping alien fleet visibility.
- Design rollups show readable names, never `playerShipTemplate401`.
- Interception state renders as unavailable — and no inference is made from shared destinations.
- Observer-owned shipyard queues survive player-mode filtering, verified with a synthetic queue.
- `/latest-snapshot.md` is unchanged — assert byte-identical output against a frozen snapshot.

---

## 7. Sequencing

`/latest-threats.md` first. It is the smallest, it is the one hit first in practice, and its hostile-relevance filter is the hard part of the war-room export — building it standalone means the filter is proven before the larger document depends on it.
