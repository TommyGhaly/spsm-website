# `assets/future/logos/` — the consultants' marks

The logos of the firms working on the new church, for the credentials band at
the foot of `/about/future-plans`.

**Optional.** `scripts/optimize-assets.mjs` skips this directory if it is empty,
`features/future/logos.ts` lists what was actually built, and a firm with no
mark renders as its name. The page is correct with nine logos, with three, or
with none — it is never a broken image.

## The quick way

The marks arrived as one composite image — seven logos on a white ground, two
rows. **Copy that image and run:**

```
npm run logos
npm run assets
```

`npm run logos` takes the sheet straight off the macOS clipboard, cuts the seven
marks apart on fractional boxes, and auto-trims each one to its ink. No file to
save and no filename to get wrong, which is the step that kept not happening.
Pass a path instead if the sheet is already saved somewhere, and add `--boxes`
to write the untrimmed crops when a box needs checking. See
`scripts/slice-logo-sheet.mjs`.

## The long way

Drop a PNG or SVG in named after the firm's `slug` in
`apps/website/src/features/future/plan.ts`, then run `npm run assets`:

| Filename | Firm |
| --- | --- |
| `dsk.png` | Dewing Schmid Kearns — architects and planners |
| `oak-consulting-group.png` | Oak Consulting Group — civil |
| `foley-buhl-roberts.png` | Foley Buhl Roberts & Associates — structural |
| `buro-happold.png` | Buro Happold — MEP and fire |
| `crowley-cottrell.png` | Crowley Cottrell — landscape |
| `mdm.png` | MDM Transportation Consultants — traffic |
| `code-red.png` | Code Red Consultants — code |
| `goddard-consulting.png` | Goddard Consulting — wetlands |
| `dillis-roy.png` | Dillis & Roy Civil Design Group — survey |

Any of those nine may be missing. Anything not on that list is still built, but
nothing will render it — the row is driven by `TEAM`, not by this directory.

## What is done to them

Resized to 240px and 480px wide and converted to WebP. Nothing else: **no crop,
no recolour, no redraw, no rounding**. These are third-party trademarks and the
only defensible use of one is to identify the firm it belongs to, unaltered.
The band gives each a white card of its own for the same reason — several of
these are dark type drawn for white paper and would read as smudges on the
tinted ground.

Prefer a version with transparent or white background and no drop shadow. A
logo cut out of a screenshot of somebody's website carries their page background
with it, which is visible the moment it lands on the card.
