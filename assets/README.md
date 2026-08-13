# assets/

Original image files, as received. **Nothing here is served.**

`npm run assets` reads this directory and writes the web-ready copies into
`apps/website/public/` and `apps/website/src/app/`. Those outputs are committed;
regenerate them rather than editing them.

Originals are kept at full size on purpose. They are the only copy of some of
this, and a 3000px photo is worth having when someone wants a different crop
next year. The cost is ~21 MB in the repo, paid once.

`derived/` is the staging area for images bound for Firebase Storage rather than
the bundle — clergy portraits today. See the destination split in
`scripts/optimize-assets.mjs`.

## Provenance and licensing

The parish is responsible for having the right to publish all of this. This
table records what is known; **unknown is not the same as cleared.**

| File | Source | Status |
| --- | --- | --- |
| `St Philopater & St. Mena Logo.svg` | Parish/diocese seal | Parish's own mark. Vector, converted from PDF. |
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

They are used only as dimmed backdrops behind text, where they read as texture
rather than as a photograph of this parish. They must not be captioned, given
alt text describing them as this church, or used anywhere a visitor would take
them for the building they are trying to find.

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
