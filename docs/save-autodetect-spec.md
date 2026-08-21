# Local Dashboard — Detect and Load New Saves Automatically

Written 2026-08-21 against `bbef9f0`. Local runtime only; the hosted worker is unaffected.

---

## The server already does this

This is the finding that shapes the whole design, and it means the job is much smaller
than "add save watching".

`snapshotCache.loadOrGetSnapshot()` calls `saveParser.getLatestSaveFile()` and computes a
`size:mtimeMs:sha256` fingerprint on **every request**
([`server/http/snapshotCache.js:51`](../server/http/snapshotCache.js)). A changed newest
save misses the cache, gets re-parsed, and clears `filteredSnapshotCache`. Every API
response is therefore *already* serving the newest save on disk.

**The only thing missing is that the browser never asks again after initial page load.**

So: no `fs.watch`, no new dependency, no invalidation logic. One cheap route and a client
poll.

## Measured

Real save folder, 14 saves, newest `Autosave.gz` at 3.14 MB:

| operation | cost |
| :-- | :-- |
| `getAvailableSaves()` — dir scan + `statSync` per file | **2.19 ms** |
| `createFileFingerprint()` — the above plus sha256 of the save | **2.89 ms** |
| detection, scan + stat | **2.3 ms** |
| detection, scan + sha256 | **5.1 ms** |
| `readSaveJson()` + `buildRawSnapshot()` — full re-parse | **885 ms** |

Detection is **~400× cheaper than parsing**. That settles poll-vs-watch: a 5-second poll
costs roughly 0.05% of one core. `fs.watch` on Windows adds a dependency and fires
duplicate and partial events while Terra Invicta is writing, for no gain over a poll this
cheap.

## What to build

### 1. `GET /api/save-state` — identity without parsing

A new route in [`server/http/routes/runtime.js`](../server/http/routes/runtime.js), which
is the correct home: that module's stated boundary is routes that describe the local
install and "need no observer, no mode and no save parse."

It must return the newest save's identity computed the **same way** the cache computes it,
so the client compares like with like:

```
snapshotId       from snapshotIdentity.createSnapshotIdentity — sha256(campaignKey|saveModifiedAt|saveHash)
saveHash         from createFileFingerprint
saveModifiedAt   ISO string
saveFilename     basename only
campaignDate     null — requires a parse; see below
```

**It must not parse the save.** Reuse `createFileFingerprint()` and
`createSnapshotIdentity()`; both are pure stat + hash. Budget ~5 ms.

**Do not return `fullPath`.** `getAvailableSaves()` includes absolute local paths and
`/api/saves` currently leaks them; the new route must not repeat that.

`campaignDate` (`metadata.gameTimeString`) is **only available after a parse** and must be
`null` here rather than guessed — absent stays null. If the affordance wants to show the
in-game date, it can take it from the loaded payload after the refresh completes, or the
route can report the cache's date when the server happens to already hold that save. Do
not parse to obtain it.

Set `Cache-Control: no-store`, as `/api/runtime` does.

### 2. A client poller, gated on runtime capability

`/api/runtime` already returns **`canRefresh: true`** locally, and the hosted worker
returns the same route with the capability false. Gate on it exactly as the publish button
does at [`mission-control.js:274-278`](../public/v2/js/mission-control.js) — that pattern
is established and keeps this feature off the public site.

The client already holds `state.snapshotIdentity` as
`{snapshotId, saveHash, saveModifiedAt, generatedAt}`. Poll `/api/save-state` on an
interval and compare `snapshotId`. Different means a new save exists.

Poll only when the document is visible (`document.visibilityState`). A background tab
polling every 5 s while the user plays for an hour is 720 pointless requests.

### 3. Surface it without stealing the view

Default behaviour: a **non-blocking affordance** in the header — the new save's filename
and, once known, its in-game date, plus a control to load it. The existing
`Refresh save` button (`initRefreshBtn` → `POST /api/refresh`) is the manual path and
becomes the same code path; do not build a second one.

Offer **auto-load as an explicit opt-in toggle**, persisted in `localStorage`, for playing
with the dashboard on a second monitor. Default off: a silent re-render while the user is
reading the research advisor loses scroll position and any expanded state, and the panel
is 336 px of dense ranked rows where losing your place is genuinely costly.

## The three traps

**1. 503 is normal, not an error.** `loadOrGetSnapshot` throws a **503** when the save
changes while being parsed — "Terra Invicta may still be writing it; retry after the save
finishes." The game autosaves continuously, so a poller *will* hit this. It must back off
and retry, never raise an error toast. A failed poll means **unknown**, not "no new save"
and not "something is broken" — `CLAUDE.md`'s rule that a check which cannot be evaluated
must report unknown applies directly.

The poll itself is stat-and-hash only and cannot 503; the 503 arrives from the subsequent
`/api/refresh`. Handle it there.

**2. The poll must never trigger a parse.** Polling `/api/snapshot` would cost 885 ms per
new save and ship a full payload. That is the reason for a dedicated route rather than
reusing an existing one.

**3. A partial reload will trip the existing stale-data guard.** `mission-control.js`
already validates that every dataset carries the same identity and renders
`MIXED / STALE INTELLIGENCE — Expected snapshot <id>; <dataset> does not match`
([`mission-control.js:744-753`](../public/v2/js/mission-control.js)). Reloading some
panels and not others will fire it.

**The reload must therefore be all-or-nothing across every dataset the view holds.** This
is a feature, not an obstacle — it is exactly the guard that will catch a half-applied
refresh, so verify it stays green rather than working around it.

## Constraints

- **Local only.** Gate on `/api/runtime`; the hosted worker has no save folder. Confirm
  the control is absent from the hosted build.
- **Both modes**, player and omniscient. Mode and observer must survive a refresh —
  `/api/refresh` already takes `mode` and `observer` and the existing button passes them.
- Absent stays null: no `campaignDate`, `saveHash` or `snapshotId` may be defaulted,
  zeroed, or rendered as `undefined`.
- No new npm dependency.
- Do not touch `public/index.html` (legacy v1).
- Read `docs/code-index.md` before editing; update the `Purpose:` line of any file whose
  purpose changes, then run `npm run index`.
- New route needs a test in the file that already covers this surface —
  `tests/serverRoutes.test.js` covers `/api/snapshot`, `/api/refresh` and `/api/export`.

## Acceptance

- `GET /api/save-state` returns the newest save's `snapshotId`, `saveHash`,
  `saveModifiedAt` and `saveFilename`, and **no absolute path**.
- It completes in **under ~20 ms** on a 3 MB save and does **not** log
  `[Server] Parsing save` — assert on the absence of a parse, not just on timing.
- Its `snapshotId` is byte-identical to the one `/api/snapshot` reports for the same save.
  This is the correctness pin: if the two derive identity differently, the poller either
  never fires or fires forever.
- With the game writing a save, a poll during the write does not produce a user-visible
  error; the load retries and succeeds afterwards.
- Saving in Terra Invicta causes the dashboard to offer the new save within one poll
  interval, without a manual page reload.
- With auto-load off, the view does not change until the user acts.
- With auto-load on, the reload is atomic — `MIXED / STALE INTELLIGENCE` never appears.
- Polling stops while the tab is hidden.
- The control does not render on the hosted site.
- Mode and observer are preserved across an auto-load, verified in **both** modes.
- 798 tests pass, plus the new route's test.

## Out of scope

Reloading on a save that is **older** than the one displayed (loading a historical save
from the picker should not be undone by the poller), and any change to how the publisher
or hosted worker select snapshots.
