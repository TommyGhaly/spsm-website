/**
 * The ten pictures on /about/future-plans, and where each one came from.
 *
 * ---------------------------------------------------------------------------
 * **None of these is a photograph.** Every other picture set on this site shows
 * something that exists — a monastery, an icon, this church's own sanctuary.
 * These show a building that has not been built, and the page has to be honest
 * about that in its captions rather than leaving the reader to work it out from
 * the unnaturally clean cars in the car park.
 *
 * Eight are frames lifted out of the flythrough animation Dewing Schmid Kearns
 * delivered on 19 March 2026; two are sheets out of the permit set compiled on
 * 22 December 2025. `assets/future/credits.json` records the source document
 * and, for the frames, the timestamp — so "is this still what the building
 * looks like" is a question somebody can actually check when the design moves.
 *
 * `scripts/optimize-assets.mjs` writes an 800px and a 1600px WebP for each into
 * `public/img/future/`. 1600 rather than the 1280 the other sets use because
 * two of these are line drawings whose street names have to stay legible.
 *
 * **`width`/`height` are the real dimensions of the large file**, read off the
 * emitted WebP rather than assumed — the frames are 1600×900 and the two sheets
 * are 1600×977, and a srcset descriptor that lies about either makes the
 * browser choose wrong. Same rule as `features/who/images.ts`.
 *
 * **Not free-licensed**, unlike the tour, the belief plates, the saints and the
 * who-we-are set — this is work the parish commissioned and paid for. So the
 * page carries a *visible* credit line naming the architects, not the hidden
 * drawer /about/our-belief and /about/patron-saints use. There the licence was
 * the obligation; here the obligation is not letting a reader think a rendering
 * is a photograph, or that a drawing filed with a planning board is a promise.
 * ---------------------------------------------------------------------------
 */

export type FuturePicture = {
  alt: string;
  caption: string;
  /** Intrinsic size of the 1600 file, so nothing reflows when it lands. */
  width: number;
  height: number;
};

export const FUTURE_PICTURES = {
  approach: {
    alt: 'A rendering of the proposed church seen from the car park: a wide arched west front between two tall bell towers, each capped with a cross, with lower buildings to the left and pines behind.',
    caption:
      'The proposed church from the drive, roughly where the car park meets Rice Road today. The arch over the doors and the two towers are the Coptic front; what is behind them is a dome.',
    width: 1600,
    height: 900,
  },
  'west-front': {
    alt: 'A closer rendering of the west front: a deep recessed arch over tall glazing and timber doors, flanked by two towers of narrow arched windows.',
    caption:
      'The west front, closer. The great arch is glazed above the doors, so the light in the nave in the morning comes through it and not through the side aisles.',
    width: 1600,
    height: 900,
  },
  steps: {
    alt: 'A rendering of people walking up a broad flight of stone steps toward the arched doors of the church, with planting either side and a handrailed ramp at the edge.',
    caption:
      'The steps up to the doors. The church floor sits sixteen feet above the car park, so the approach is a climb — and the ramp beside it, drawn at one in twelve with seven landings, is the same approach for anyone who cannot take the steps.',
    width: 1600,
    height: 900,
  },
  piazza: {
    alt: 'A rendering looking across a paved courtyard: a glazed two-storey building on the left, the flank of the church with its arched windows and tower ahead, and people walking between them.',
    caption:
      'The piazza — the paved court between the three buildings, sitting one level above the car park. It is where the congregation would come out to after the Liturgy.',
    width: 1600,
    height: 900,
  },
  'diocese-center': {
    alt: 'A rendering of a two-storey building with clapboard walls, a glazed corner and dark window frames, seen across a car park with the church behind it.',
    caption:
      'Building C, the diocese centre, from the car park. Offices, meeting rooms and three apartments, in a plainer language than the church deliberately.',
    width: 1600,
    height: 900,
  },
  'youth-center': {
    alt: 'A rendering of a long two-storey clapboard building with a covered walkway running its length, trees and a car park in front.',
    caption:
      'Building B, the long one: Sunday school below, senior housing above, and the covered walk that runs the length of it.',
    width: 1600,
    height: 900,
  },
  'roofs-aerial': {
    alt: 'An aerial rendering of the whole site: the domed church at the centre with barrel-vaulted roofs, the long youth centre behind it, the diocese centre in front, and car parking around the edges.',
    caption:
      'The three buildings together, from above the east. The vaults over the nave and the aisles are what the arches on the front are the ends of.',
    width: 1600,
    height: 900,
  },
  'campus-aerial': {
    alt: 'An aerial rendering from the south-west: the church with its two towers and broad steps, the diocese centre and youth centre beside it, and marked car parking wrapping around the site.',
    caption:
      'The whole site from above Rice Road. The present church stands about where the near corner of the diocese centre is drawn.',
    width: 1600,
    height: 900,
  },
  massing: {
    alt: 'An architectural line drawing, in axonometric view, of three buildings on a wooded site, labelled A Church, B Youth Center Sunday School and Senior Housing, and C Dioceses Center, between Rice Road and Turkey Hill Road.',
    caption:
      'Sheet G1 of the set filed with the town — the same three buildings as a drawing rather than a rendering, with the roads and the property line on it. A is the church, B the youth centre and housing, C the diocese centre.',
    width: 1600,
    height: 977,
  },
  'site-plan': {
    alt: 'An architectural site plan showing three labelled building footprints, a piazza between them, drives and car parking, a fire access road, the property line and setbacks, and the surrounding streets.',
    caption:
      'Sheet G7, the site plan. The dashed outline just left of the diocese centre, marked “outline of existing church to be demolished”, is the building the congregation worships in now.',
    width: 1600,
    height: 977,
  },
} as const satisfies Record<string, FuturePicture>;

export type FuturePictureName = keyof typeof FUTURE_PICTURES;

export const futureLarge = (name: FuturePictureName) => `/img/future/${name}-1600.webp`;
export const futureSmall = (name: FuturePictureName) => `/img/future/${name}-800.webp`;

/**
 * The compressed flythrough, its poster, and its cue track.
 *
 * ---------------------------------------------------------------------------
 * **Self-hosted, and that was a decision rather than a default.** The master is
 * 1080p at 20 Mbit and 538 MB, which is not a thing to put behind a `<video>`
 * tag; `public/video/future-flythrough-720.mp4` is 720p at CRF 28, silent, and
 * 33 MB. The alternative considered and not taken was YouTube, which the site
 * already embeds on /livestream: free bandwidth and adaptive quality on a
 * phone, at the cost of the page being incomplete until somebody uploads it.
 * If that upload ever happens, this constant and `Flythrough` in `parts.tsx`
 * are the only two places to change.
 *
 * **It autoplays, and that reverses what was written here first.** The original
 * note argued for `preload="none"` behind a poster on the grounds that 33 MB
 * should never leave the server unasked; Tommy asked for autoplay, and the
 * arithmetic turns out to be far kinder than that note assumed. The file is
 * `+faststart` and served over range requests, so an autoplaying video streams
 * as it plays rather than landing in one lump: a reader who scrolls past after
 * ten seconds has fetched about 1.6 MB, and the full 33 MB arrives only for
 * somebody who watches the whole three and a half minutes. Which is a visitor
 * we want.
 *
 * Silent, and that is now load-bearing rather than tidy. The master carries a
 * music track whose licence nobody has checked; dropping it saved about 6 MB;
 * and **a video with no audio track is one Safari and Chrome will autoplay**.
 * `muted` is set on the element as well, because their policies test the
 * attribute and not the file. Put the audio back and the autoplay stops.
 *
 * `captions` is the cue track — see the note on `Flythrough` in `parts.tsx` for
 * why a silent film has one, and `future-flythrough.vtt` for the timings.
 * ---------------------------------------------------------------------------
 */
export const FLYTHROUGH = {
  src: '/video/future-flythrough-720.mp4',
  type: 'video/mp4',
  poster: futureLarge('approach'),
  captions: '/video/future-flythrough.vtt',
  width: 1280,
  height: 720,
  /** 3 minutes 30 seconds, for the line under the player. */
  length: '3 minutes 30 seconds',
} as const;

/**
 * The gallery — ten more frames from the same flythrough.
 *
 * ---------------------------------------------------------------------------
 * Separate from `FUTURE_PICTURES` because the two are shown differently and
 * built differently. A plate sits beside a paragraph it illustrates and carries
 * a caption doing real explanatory work; a gallery picture is one of ten in a
 * grid, opened full size if a reader wants it, and its caption is a label.
 * `optimize-assets.mjs` emits a cropped 480px thumbnail for these and no 800 —
 * see the note there.
 *
 * **Ten and not thirty.** The flythrough is 5,040 frames and it would be easy
 * to fill a page with them; a grid of ten distinct views of three buildings is
 * a gallery, and a grid of thirty near-identical ones is a screensaver. Each of
 * these is somewhere the other nine are not.
 *
 * The order is the order the camera visits them, which is also the order the
 * page has already described them in — approach, steps, court, Building B,
 * then up. A reader who has scrolled the whole page recognises the sequence.
 * ---------------------------------------------------------------------------
 */
export const FUTURE_GALLERY = {
  'gallery-through-the-pines': {
    alt: 'A rendering of the church seen at a distance between tall pines, its two towers and dome above the treeline.',
    caption: 'From the road, through the pines.',
  },
  'gallery-from-the-steps': {
    alt: 'A rendering looking down the church steps from the top, across the car park to the trees beyond.',
    caption: 'From the top of the steps, looking back.',
  },
  'gallery-colonnade': {
    alt: 'A rendering of a covered walkway on square columns running along a lawn, with a two-storey clapboard building above it.',
    caption: 'The covered walk along the youth centre.',
  },
  'gallery-north-flank': {
    alt: 'A rendering of the north side of the church: a row of tall arched windows under a barrel-vaulted roof, with a tower beyond and lawn in front.',
    caption: 'The north flank of the church, from the court.',
  },
  'gallery-tower': {
    alt: 'A rendering looking up at one of the church towers and the edge of the great arch, framed by a tree.',
    caption: 'A tower and the edge of the arch.',
  },
  'gallery-b-entrance': {
    alt: 'A rendering of the entrance canopy on the long youth centre building, with cars parked in front of it.',
    caption: 'The way into the youth centre.',
  },
  'gallery-b-far-end': {
    alt: 'A rendering of the far end of the youth centre building across the car park, with the church dome visible beyond it.',
    caption: 'The far end of Building B, the church behind.',
  },
  'gallery-aerial-domes': {
    alt: 'An aerial rendering close over the church roofs: the dome over the crossing and the barrel vaults either side of it.',
    caption: 'Close over the dome and the vaults.',
  },
  'gallery-aerial-low': {
    alt: 'A low aerial rendering across the car park toward the three buildings, trees along the boundary.',
    caption: 'Low across the car park.',
  },
  'gallery-aerial-southwest': {
    alt: 'An aerial rendering of the whole site from the south-west, showing all three buildings, the piazza and the parking.',
    caption: 'The whole site from the south-west.',
  },
} as const satisfies Record<string, { alt: string; caption: string }>;

export type FutureGalleryName = keyof typeof FUTURE_GALLERY;

export const galleryThumb = (name: FutureGalleryName) => `/img/future/${name}-480.webp`;
export const galleryFull = (name: FutureGalleryName) => `/img/future/${name}-1600.webp`;
