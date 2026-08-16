# assets/

Original image files, as received. **Nothing here is served.**

`npm run assets` reads this directory and writes the web-ready copies into
`apps/website/public/` and `apps/website/src/app/`. Those outputs are committed;
regenerate them rather than editing them.

Originals are kept at full size on purpose. They are the only copy of some of
this, and a 3000px photo is worth having when someone wants a different crop
next year. The cost is ~21 MB in the repo, paid once.

There is no `derived/` any more. It held a second copy of each clergy portrait,
staged for a Firebase Storage upload that never happened, and once the site
started shipping those portraits in the bundle it meant three fathers with five
files each. Every output has one home now: `apps/website/public/` or
`apps/website/src/app/`. See the destination split in
`scripts/optimize-assets.mjs`.

## Provenance and licensing

The parish is responsible for having the right to publish all of this. This
table records what is known; **unknown is not the same as cleared.**

| File | Source | Status |
| --- | --- | --- |
| `St Philopater & St. Mena Logo.svg` | Parish/diocese seal | Parish's own mark. Vector, converted from PDF. |
| `HomeScreen.png` | Parish — livestream frame | **This parish's own sanctuary.** The homepage hero. See below. |
| `Father-Youhanna.jpg` | Parish | Assumed parish-owned. Same session as Fr. Armia. |
| `Father-Armia.jpg` | Parish | Assumed parish-owned. |
| `Bishop-David.jpg` | "Photo From The Heart by Nash", 2014 | **Watermarked.** Parish states it owns this; written confirmation still outstanding. See below. |
| `Crucifixion.jpg` | Unknown | Photograph of a Coptic icon. Genuine inscription. Provenance unrecorded. |
| `Iconography1.jpg`, `Iconography2.JPG` | Unknown | Pencil studies. Artist unrecorded. |
| `Coptic_church_example.jpg` | Unknown, likely stock | **Not this parish's building.** See below. |
| `Coptic_Church_Verse.jpg` | Unknown, likely stock | **Not this parish's building.** Verse text cropped out in the derivative. |
| `Donation.png` | Unknown, likely stock | Generic "helping hands" stock. |
| `Coptic_pattern.png` | AI-generated | Not used. See below. |
| `Festival.jpg` | Parish | Not used. Past event. |
| `SPSM-Church-Image.jpg` | Old Wix site | Not used. 176×176 thumbnail. |
| `brand/instagram.svg`, `brand/facebook.svg`, `brand/youtube.svg` | Official brand marks | Third-party trademarks. See below. |

### The three social marks are not ours to redraw

`brand/*.svg` are the official Instagram, Facebook and YouTube glyphs, copied
through to `public/brand/` **unchanged** — not minified, not recoloured, not
redrawn to match the stroke weight of `components/Icon.tsx`. A brand mark is
recognisable because its outline is fixed, and an SVG minifier that rounds
coordinates is a quiet way to ship three slightly-wrong logos.

They are the single copy of that path data. The footer paints them with CSS
`mask-image` and `currentColor` (see `.social-icon`), which is what lets one
flat file per platform serve both the resting colour and the gold hover without
a second, recoloured set — and why there is no React component duplicating the
coordinates.

Each platform's brand guidelines permit a monochrome mark used to link to your
own profile, which is the only use here. The accounts themselves are in
`DEFAULT_PARISH_CONFIG.social` and overridable from `config/parish`.

### `HomeScreen.png` is the first usable photograph of this sanctuary

Added 2026-08-13, and it changes what the homepage can be. Everything else in
this directory is either a different church or of unrecorded provenance, which is
why the hero was previously built from type and ornament over a stock image
dimmed to 14%. This is the Wayland iconostasis — the four living creatures, the
Theotokos and Pantocrator icons, a priest at the altar — so it may be captioned,
given real alt text, and presented as this parish, because it is.

Two caveats that shaped how it is used:

- **It is a livestream frame** (5061×2325; a camera rig and a tablet are visible
  near the edges). Downscaling to hero width hides the softness. Do not use it
  above ~2400px, and do not upscale it.
- **It contains identifiable people** — a priest, a young deacon serving, and
  congregation in the front rows. `optimize-assets.mjs` crops away the bottom
  16% of the frame, which is composition *and* privacy: it drops most of the
  seated congregation while tightening onto the iconostasis. Clergy and servants
  visibly serving a public liturgy is a different matter from publishing
  recognisable shots of parishioners in the pews, and the crop keeps that line.

**Still worth confirming with the parish:** that they are content to publish a
frame showing the people it shows. The `photoApprovals` collection was deferred
past the September cutover, so there is no workflow enforcing this — it is a
conversation, not a feature.

### Bishop David's portrait carries a visible copyright notice

"© Photo From The Heart by Nash 2014" is burned into the top of the image. It is
preserved in the derivative deliberately — a build script quietly erasing a
photographer's copyright notice is not a thing this repo does.

Two things are needed before launch: written confirmation of the licence, and a
clean unwatermarked master from the photographer. If neither arrives, use the
diocese's official portrait instead.

### Two of the "church" photographs are not this church

`Coptic_church_example.jpg` and `Coptic_Church_Verse.jpg` show Egyptian or Gulf
churches — sandstone, desert light, domes. This parish is a New England building
in Wayland, Massachusetts.

They must not be captioned, given alt text describing them as this church, or
used anywhere a visitor would take them for the building they are trying to
find.

**They are now in the homepage hero, and that was Tommy's explicit call on
2026-08-16.** The hero cross-fades three frames: the Wayland sanctuary, then
these two. He was shown this rule before choosing it. The constraint is kept the
only way it can be — **only the sanctuary frame carries `alt` text.** Both of
these are `alt=""` and `aria-hidden`, so nothing on the page claims either is
this parish, and to a screen reader the hero remains one photograph of one
room. See the note on `Hero` in `apps/website/src/app/page.tsx`.

Their hero crops are separate outputs (`hero-domes-*`, `hero-towers-*`), cut to
the sanctuary's own 2.591:1 and 3:4 so the three frames share geometry. The
older `backdrop-*` outputs are still generated and are currently unused.

Their licence is also unverified. If they came off the old Wix site, a Wix stock
licence does not travel to Firebase Hosting. Replace them as soon as there is
real photography of the Wayland building — which is the actual gap here: there
is currently no usable photograph of the parish's own exterior or sanctuary.

### `Coptic_pattern.png` is AI-generated and is not used

The Coptic lettering in its banners is imitation letterforms spelling nothing —
"CRIEIA", "TOHOAC", "WPTYC". Compare the genuine inscription on
`Crucifixion.jpg`: ⲠⲈⲔⲐⲢⲞⲚⲞⲤ ⲪϮ ϢⲀⲈⲚⲈϨ, "Your throne, O God, is forever."

Decorative fake liturgical script on an Orthodox parish's website is the kind of
error a parishioner who reads Coptic notices immediately.

### Metadata is stripped

The build strips EXIF from every derivative. Phone photographs carry GPS
coordinates, and the parish should not publish the home addresses of the people
who took its pictures.
