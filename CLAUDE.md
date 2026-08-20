# Terra Invicta Intel — working notes

## The frontend is `/v2/`, not the root

`public/index.html` is the **legacy v1 dashboard**. `public/v2/index.html` is the live one and the only place current work renders.

This matters because `preview_start` and a bare `node server/index.js` open the site root, so a browser check that lands on `/` shows the old UI and none of the current features — easy to misread as "the change didn't land".

- Browser: `http://localhost:<port>/v2/`
- Directive board mounts at element id `directiveBoard`
- Briefing API: `/api/v2/briefing?mode=player&observer=4712`
- Snapshot API: `/api/snapshot?mode=omniscient&observer=4712`

Observer faction is `4712` (the Initiative); the aliens are `4717`.

## Always check player mode

`server/index.js` sets `defaultMode: 'player'`. Player mode redacts the save's true alien hate and masks enemy councilor attributes, so it is a genuinely different code path — not a cosmetic filter.

**A feature verified only in omniscient mode is not verified.** Two shipped defects came from exactly this:

- The Total War veto was inert in player mode because `actualAlienHate` is null there, so `totalWarHeadroom` was null and the check fell through to `false`. At hate 168 omniscient held and player mode green-lit the offensive.
- The council candidate axis vanished entirely in player mode because observed enemies carry `maskedAttributes` rather than `attributes`, so every target filtered out.

Check both modes, every time.

## Absent stays null

`Number(null) === 0` and `Number('') === 0`, so guard on presence before coercing. Rendering an unmeasured value as a confident zero is the most repeated bug class in this repo's history — it has been fixed in `toFiniteNumber`, in the snapshot reducer, in `countShips`, and in the odds model.

Related: a check that cannot be evaluated must report `unknown`, never fall through to "safe". And never fabricate data for a UI fallback — an honest "unavailable" state beats mock content that looks real.

## Sources

Game mechanics are verified against the installed templates at
`F:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates`
or the official wiki read as **raw wikitext** (spoiler content only exists there — `{{SpoilerBox}}` never expands in the DOM).

1.0 shipped 2026-01-05. Claims need a dated citation, and anything that is a judgement call should say so rather than being presented as measured.

## Line endings

`core.autocrlf=true` with no `.gitignore` normalisation. Multi-line string replacement via `sed` or Node scripts silently fails to match — use the editing tools instead.

## Design docs

- `docs/directive-rule-engine-plan.md` — v1 engine
- `docs/directive-engine-v2.md` — v2 design (what and why)
- `docs/directive-engine-v2-plan.md` — v2 implementation plan (how and in what order)
