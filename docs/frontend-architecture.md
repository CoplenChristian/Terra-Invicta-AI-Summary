# Frontend architecture — MUI for presentation, our primitives for meaning

**Decided 2026-08-27 by the user. Binding on new UI work.**

> *"We should reuse MUI components where possible, only creating our custom
> components to compile data etc, but the overall styling should be MUI."*

This settles a question the React migration left open. `@mui/material` 6.5.0 has
been a dependency with a full `createTheme` mirror of the v2 token vocabulary
(`src/v2/theme.js`, 265 lines) since before the migration finished, and until now
only `main.jsx` and `primitivesHarness.jsx` imported it — for `Box` and `Typography`
alone. Every panel styled itself against 26 hand-written stylesheets instead.

## The division

| concern | owner |
| :-- | :-- |
| layout, grid, cards, tables, controls, typography, spacing, colour, elevation | **MUI**, themed from `src/v2/theme.js` |
| presence and absence semantics, truncation disclosure, measured vs estimated | **our primitives**, rendering *through* MUI |
| data compilation, joins, thresholds, refusals | **our modules** under `shared/` and `server/` |

**Use MUI's grid rather than writing another one.** 6.5.0 ships both
`@mui/material/Grid` (legacy) and `Grid2` (the v6 implementation); prefer `Grid2`.
Express responsive behaviour with breakpoint props, not new CSS.

## The one thing that must not be lost

**`<Value>` is not a styling component.** It stamps `data-value-state` —
`measured` / `absent` / `unavailable` — on the DOM, which is what lets a test assert
that a figure was *measured* rather than infer it from an em dash. That is the
mechanism making "absent stays null" structural instead of a convention everyone has
to remember, and this repo has paid for the convention version twice: defect **#21**
is ten panels that hand-wrote the affordance, and defect **#24**'s CSS half was only
findable because computed state could be asserted.

**It already takes an `as` prop**, added when `world-map` needed `<text>` inside
SVG. So it composes with MUI directly:

```jsx
<Value as={Typography} variant="body2" present={gdp !== null} value={gdp} />
```

MUI owns the appearance; the data attribute survives. There is also
`resolveValue()` for hosts that can take no element at all — an `aria-label`, a
`title`, a string being concatenated.

**Never render a bare figure through a MUI component where presence matters.** A
`<Typography>{count}</Typography>` is exactly the regression this rule exists to
prevent, and `Number(null) === 0` will make it look plausible.

The same holds for `<Measured>`, `<Estimated>` and `<TruncationNote>`: they encode
claims about *how a number was arrived at*, which MUI has no concept of.

## What changes for the existing panels

`<Panel>` and `<DataTable>` become thin wrappers over MUI `Card` and `Table`. They
keep what carries meaning — `DataTable`'s variant registry, which throws on an
unregistered variant by design, and its truncation disclosure — and shed their
hand-rolled markup and styling.

**Converting existing panels is a refactor, and this repo's rule applies: prove it
changed nothing.** Capture rendered output before and after, diff to zero, and check
computed colour and geometry as well as text — defect #24 showed that an unresolved
CSS value drops the whole declaration, so a border can vanish while the text diff
stays clean.

Do it a panel at a time. Ten of eleven `<Value>` conversions are still outstanding
under #21; folding the MUI move into each conversion is cheaper than two passes.

## What this does not license

- **Deleting the token system.** `theme.js` mirrors it; the tokens remain the source
  of truth for colour and type, and MUI consumes them.
- **Dropping `assertViewRegistryIntegrity()`** or the mount/registry discipline. A
  MUI-styled panel that renders nowhere is still a panel that renders nowhere.
- **Adding CSS to `public/v2/css/` for layout** that MUI breakpoints already do. The
  goal is that `.init-view__grid` becomes unnecessary; new CSS in that direction is
  CSS the conversion has to delete again.
