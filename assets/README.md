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
| `coptic_cross_image.png` | Added by Tommy, 2026-08-19 | The Coptic cross as a drawn mark, not a photograph. The homepage welcome section. Source and licence unrecorded. See below. |
| `Coptic_cross_top_church.jpeg` | Added by Tommy, 2026-08-19 | A Coptic cross on a dome. Source and licence unrecorded. **Only 381×524, and now read by nothing** — see below. |
| `Father-Youhanna.jpg` | Parish | Assumed parish-owned. Same session as Fr. Armia. |
| `Father-Armia.jpg` | Parish | Assumed parish-owned. |
| `Bishop-David.jpg` | "Photo From The Heart by Nash", 2014 | **Watermarked.** Parish states it owns this; written confirmation still outstanding. See below. |
| `Deacon-Severus.jpg`, `Deacon-Peter.jpg`, `Deacon-Kyrillos.jpg` | Parish, supplied by Tommy 2026-09-07 | Assumed parish-owned. All three taken in one session in front of the sanctuary curtain. Already cut to 4:5 on the face — see below. |
| `Crucifixion.jpg` | Unknown | Photograph of a Coptic icon. Genuine inscription. Provenance unrecorded. |
| `Iconography1.jpg`, `Iconography2.JPG` | Unknown | Pencil studies. Artist unrecorded. |
| `Coptic_church_example.jpg` | Unknown, likely stock | **Not this parish's building.** See below. |
| `Coptic_Church_Verse.jpg` | Unknown, likely stock | **Not this parish's building.** Verse text cropped out in the derivative. |
| `Donation.png` | Unknown, likely stock | Generic "helping hands" stock. The homepage offering band. |
| `Donation_backgroudn.png` | Added by Tommy, 2026-08-26 | A dome, its cross, and the bells beside it. **Not this parish's building** — but a detail rather than a portrait of one, which is why it can head a page when `Coptic_church_example.jpg` cannot. The /giving hero. Source and licence unrecorded. Filename is as received, misspelling included. |
| `Coptic_pattern.png` | AI-generated | Not used. See below. |
| `stock/stock-parking-lot.jpg` | Unsplash `photo-1506521781263-d8422e82f27a`, 2026-08-26 | **Unsplash License** — commercial use, no permission needed, attribution not required. Vehicle registration. |
| `stock/stock-passenger-van.jpg` | Unsplash `photo-1746985094087-e703bf52c71b`, 2026-08-26 | **Unsplash License.** Van request. |
| `stock/stock-small-group.jpg` | Unsplash `photo-1529070538774-1843cb3265df`, 2026-08-26 | **Unsplash License.** New service request. |
| `stock/stock-gathering.jpg` | Unsplash `photo-1517457373958-b7bdd4587205`, 2026-08-26 | **Unsplash License.** Events request. It was also the summer-camp sign-up's picture until 2026-09-02; that form has its own now. |
| `stock/stock-camp.jpg` | Unsplash `photo-1776243773206-a29b683c97fb` by Pierre Vaucher (`princlili`), 2026-09-05 | **Unsplash License.** The summer-camp servant sign-up — its banner on /forms/summer-camp and its card on /forms. A line of older children and teenagers linked arm to arm across a field, all facing away. Replaced `photo-1606092195730-5d7b9af1efc5` (a rainbow parachute, by Artem Kniaz, in this slot 2–5 Sep 2026), which was a lit stock frame full of small children on a page that asks teenagers and adults to serve. |
| `stock/stock-office.jpg` | Unsplash `photo-1556442350-74d5dccbcec5` by CHUTTERSNAP, 2026-09-02 | **Unsplash License.** Contact the church office — its card on /forms and its banner on /contact. A telephone, a pen and a notepad; no faces. |
| `Festival.jpg` | Parish | Not used. Past event. |
| `SPSM-Church-Image.jpg` | Old Wix site | Not used. 176×176 thumbnail. |
| `brand/instagram.svg`, `brand/facebook.svg`, `brand/youtube.svg` | Official brand marks | Third-party trademarks. See below. |
| `brand/app-store-badge.svg` | Apple Marketing Tools, 2026-08-26 | **Apple trademark.** Official "Download on the App Store" badge, US/UK English, black. Licensed for linking to the App Store only; may not be recoloured, recomposed, redrawn or reworded. Copied through unchanged. |
| `apps/taksis-icon.png` | Taksis App Store listing (`id6743824691`), 2026-08-27 | **The parish's own.** Apple lists the seller as "ST. PHILOPATER MERCURIUS & ST. MINA COPTIC ORTHODOX CHURCH, INC." The artwork is the sixth-century icon of Christ and St. Menas. 512×512, resized for /apps. |
| `apps/spsm-connect-icon.png` | SPSM Connect's own `assets/icon.png`, 2026-09-17 | **The parish's own.** The parish seal on the brand ground — the App Store icon the app ships, and the icon Apple has. Copied from the app repository rather than from the listing, because `scripts/make-icons.mjs` there generates it from `config/theme` and that file is the master; Apple's copy is a downscale of it. 1024×1024 reduced to 512, resized again for /apps. Re-copy it if the app is ever restyled. |
| `apps/tithely-icon.png` | Tithe.ly App Store listing (`id694740700`), 2026-08-27 | **Your Giving, Inc.'s mark.** Their app's icon, shown on /apps to identify the app the parish's own store badges link to. Resized only — not cropped, recoloured, or rounded in the file. |
| `brand/google-play-badge.png` | Google Play brand resources, 2026-08-26 | **Google trademark.** Official "Get it on Google Play" generic web badge. May not be modified, and the padding in the file is Google's required clear space — do not crop it. Copied through unchanged. |

### An app icon is not a badge

The three icons in `apps/` **are** resized and
re-encoded, unlike the two store badges below, and the distinction is worth
stating because it looks inconsistent. A badge is a lockup with type in it that
Apple and Google license for one purpose and publish rules about altering; an app
icon is the artwork identifying the app being linked to, and showing it at 64px
is not altering it. What is not done to either: no crop, no recolour, and no
rounded corner baked into the pixels — the corner is a CSS `border-radius` on the
element, which is how every store renders these and leaves the file untouched.

Taksis's and SPSM Connect's are the parish's own artwork and raise no question at
all. Tithe.ly's is theirs, used beside their own badges to say which app you are
installing.

### The three social marks are not ours to redraw

The same goes double for `brand/app-store-badge.svg` and
`brand/google-play-badge.png`, which are on /giving. Both vendors publish written
rules, both rules say the artwork is used as supplied, and both files are copied
through the pipeline byte for byte — no `sharp`, no re-encoding, no resizing, and
the PNG is deliberately *not* converted to WebP. They are 11 KB and 5 KB
together. Unlike the social marks these are not painted with `mask-image` and
`currentColor` either: they are full-colour lockups with type in them, and
`currentColor` would flatten the Play triangle to one colour.

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

### `coptic_cross_image.png` is a drawn mark, and is handled as one

Added 2026-08-19 at Tommy's direction, and it is the homepage welcome section's
picture. 360×360, inscribed Ⲓⲏⲥ Ⲡⲭⲥ / Ⲡ̀ϣⲏⲣⲓ ⲙ̀Ⲫϯ — "Jesus Christ, the Son of
God" — which is a genuine inscription, unlike the imitation letterforms on
`Coptic_pattern.png` below.

Two things `optimize-assets.mjs` does differently for it than for any
photograph here, both explained at length beside the code:

- **Lossless WebP, one size.** Flat primary colour with hard navy outlines is
  the case lossy WebP puts ringing into, and at this palette lossless comes out
  smaller anyway. 360 is the source's own width and the ceiling.
- **Its white ground is keyed to alpha**, so it sits on the band's warm paper
  instead of arriving as a white card — including the white *inside* the
  design, so the paper shows through the interlace. `.welcome__photo`
  consequently carries no border radius and no shadow.

Provenance is unrecorded. It is a common devotional mark rather than anything
bespoke, but unknown is not cleared.

### `Coptic_cross_top_church.jpeg` is too small, and is now read by nothing

Added 2026-08-19 at Tommy's direction, and it had two jobs: the homepage's
welcome section, and a fourth frame in the hero cross-fade. **It has lost both**
— the welcome section is `coptic_cross_image.png` above, and the hero is back to
three frames.

**It is 381×524**, and that is why. `optimize-assets.mjs` sets
`withoutEnlargement`, so nothing was upscaled on the way out — the derivative
named `hero-cross-1600.webp` was actually 381px wide, and the browser stretched
it across a hero that is 1458px on a laptop and up to 2400 on a desktop. Two
consequences, both visible on the live page until 2026-08-19:

- **The wide crop was thin as well as soft.** A 2.591:1 window cut from a 524px
  tall portrait is 147px, which cannot hold the cross and the dome together, so
  the landscape frame was the crossbar against sky and nothing else.
- **The desktop frame was blurred on purpose.** `.hero__frame--4` carried
  `blur(2.5px)` — compensation, not styling: unblurred, a four-fold upscale
  reads as a broken image rather than as a photograph. Past ~2px it reads as
  deliberate soft focus instead.

The file is kept rather than deleted, because a full-size original of the same
shot would be genuinely useful — the parish has no other photograph of a cross
in the open air. Drop one over this name, run `npm run assets`, and it is a
candidate for the hero again on its own merits.

Provenance is unrecorded, as it is for the two backdrops. Unknown is not
cleared.

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

### The three deacons' portraits are already cropped

Every other file here is the original, and `optimize-assets.mjs` does the
cutting. These three arrived as full-length shots of a man standing in front of
the sanctuary curtain, with the icon of Christ and the curtain rod filling the
top half of the frame — so the script's own 4:5 `position: north` crop would
have produced three pictures of an icon with a small face beneath it.

They are stored cut to 4:5 and framed on the face, which makes that crop a no-op
and leaves the script's table untouched. The framing is not identical because it
could not be: the three men are different heights against the same backdrop, so
Deacon Severus has clean curtain above his hat and the other two reach the rod.
Head size and the pectoral cross being whole were matched instead, which is what
survives the circular mask both pages actually draw.

**Both pages show a circle**, not the 4:5 file: 176px on the homepage clergy
band, 136px on /about/who-we-are, each `object-fit: cover` at `50% 0%`. So what
is on screen is the *top square* of these files. Judge any recrop there — a
change that looks right on the 4:5 can put the curtain rod through the top of
the circle, which is what a first pass at Deacon Kyrillos did.

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

Their hero crops are separate outputs (`hero-glass-*`, `hero-towers-*`), cut to
the sanctuary's own 2.591:1 and 3:4 so the three frames share geometry. The
older `backdrop-*` outputs are still generated and are currently unused.

**`hero-glass-*` replaced `hero-domes-*` on 2026-08-19, and the reason was that
these two photographs are hard to tell apart.** Both are sandstone against pale
sky shot from below, so at hero size and under the veil the cross-fade looked
like one picture cycling back into itself rather than three. `hero-domes` was
very nearly the whole verse image; `hero-glass` is cut from the same file but
from the arched stained glass at its right — deep blue, with a gold cross across
it — which is the one region in either backdrop that looks like nothing else in
this directory. The crop rectangles are hand-picked and written down in
`scripts/optimize-assets.mjs`.

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

### `assets/stock/` — the forms photographs

Four stock photographs, one per form on `/forms`, added 2026-08-26.

**These are the only images in this directory whose licence anyone recorded.**
Every other "likely stock" row above says *Unknown*, which is the state this is
meant not to repeat: the photo id is in the table, so the source of each one can
be checked years from now without guessing. Unsplash's licence permits
commercial use without permission or attribution.

None of them is this parish, and none should ever be mistaken for it. They
illustrate what a form is *for* — a van, a car park, a group meeting, a
gathering — which is a job a generic photograph can do honestly. A stock
photograph standing in for the parish's own building or people is the failure
mode; see the backdrops note above, which exists for the same reason.

They were chosen against two rejected candidates worth recording:

- a close-up of a bible embossed **HOLY BIBLE**, which is evangelical-Protestant
  visual language and the wrong register for a Coptic Orthodox parish;
- a dense car park of brightly coloured cars, which fights the site's palette.

The derivatives are cropped to 5:2 in `optimize-assets.mjs` rather than by CSS,
because both places that show them — the card and the form banner — want a wide,
short frame, and a phone should not download a 3:2 file to crop away a third.

### `assets/future/` — the new church

Ten pictures for `/about/future-plans`, added 2026-09-01. **The only set here
that is not a photograph and not an icon: it is a building that does not exist
yet.**

Eight are single frames lifted from a flythrough animation; two are sheets
rendered out of the permit set with the title block cropped away, which is the
only alteration either drawing gets. `credits.json` records, per file, which
document it came from and — for the frames — the timestamp, so that "is this
still what the building looks like" is a question somebody can answer in a
minute rather than by eye.

| Source document | What it is |
| --- | --- |
| `20260319_St Philopater_Flythrough.mp4` | 3 min 30 s, 1080p, 538 MB. Delivered 2026-03-19. The eight renderings and the video on the page both come from this. |
| `compiled_coptic_church_plan_-_12-22-25_1_0.pdf` | 33 sheets, 56 MB. The regulatory set of 2025-08-26 with two revisions, compiled 2025-12-22. Sheets G1 and G7 are on the page; the area schedules and the zoning table are where the page's numbers come from. |
| `250620_ Renderings.pdf` | 4 sheets, 13 MB. Grey-and-white renderings of Building A alone, 2025-06-18. **Not used** — the flythrough shows the same three views in colour, nine months later. Kept because it is the earliest dated view of the design. |

**All three are gitignored** — 607 MB between them — which is the one exception
to the rule at the top of this file. See the note in `.gitignore`. Keep the
masters; the parish paid for them. They just do not belong in git history, where
nothing can ever be taken out again.

**Nothing here is free-licensed.** It is work the church commissioned from
Dewing Schmid Kearns Architects + Planners. That is why `/about/future-plans`
carries a *visible* credit line rather than the hidden drawer
`/about/our-belief` and `/about/patron-saints` use: with Commons material the
licence is the obligation, and here the obligation is not letting a reader
mistake a photorealistic aerial view for a photograph, or a drawing filed with a
planning board for a building.

The two sheets are rendered from the PDF at 1.6× with PyMuPDF, cropped to
`(40, 24) – (2566, 1566)` in PDF points to drop the title block and the sheet
border. The eight frames are pulled with `ffmpeg -ss <t> -frames:v 1`, at the
timestamps in `credits.json`. Both write PNG rather than JPEG, because these
came off a video decoder and a PDF renderer rather than a camera and a JPEG
intermediate would add generation loss for nothing.

#### The video is committed, not generated

`apps/website/public/video/future-flythrough-720.mp4` is not built by
`npm run assets` — it is not an image, and its master is not in the repository.
It was made once, by hand, and is committed:

```
ffmpeg -i "assets/Future Plans/20260319_St Philopater_Flythrough.mp4" \
  -c:v libx264 -preset slow -crf 28 -profile:v high -level 4.0 \
  -pix_fmt yuv420p -vf "scale=1280:-2" -an -movflags +faststart \
  apps/website/public/video/future-flythrough-720.mp4
```

538 MB in, 33 MB out. `-an` drops the audio: the master carries a music track
whose licence nobody has checked, an architectural walk-through is not something
anybody needs to hear, and it saved about 6 MB. `+faststart` moves the index to
the front so the file starts playing before it has finished arriving.

The page loads it with `preload="none"` behind a poster, so those 33 MB never
leave the server unless a visitor presses play. If the flythrough is ever
re-cut, re-run the command above **and** re-pull the eight stills — their
timestamps will have moved.
