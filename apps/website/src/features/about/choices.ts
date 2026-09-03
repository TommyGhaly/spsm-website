import { BELIEF_PICTURES, beliefLarge, type BeliefPictureName } from '@/features/belief/images';
import { FUTURE_PICTURES, futureLarge, type FuturePictureName } from '@/features/future/images';
import { SAINT_IMAGES, saintFull } from '@/features/saints/saints';
import { WHO_PICTURES, whoLarge, type WhoPictureName } from '@/features/who/images';
import { STOCK_PICTURES, type PictureChoice } from '@/features/media/stockPictures';

/**
 * Every photograph the About pages can be given without uploading one.
 *
 * ---------------------------------------------------------------------------
 * ## Why the list is this long
 *
 * Because an upload is the expensive option and the picker should not push
 * anybody towards it. These files are already committed, already optimised into
 * a 640/1280 pair by `optimize-assets.mjs`, and already carry alt text and a
 * caption written for them. An uploaded phone photograph has none of that: no
 * derivatives, no alt text until somebody types one, and a multi-megabyte
 * original on every visit.
 *
 * So: offer the whole library first, and let the upload answer the case it is
 * genuinely for — a photograph of this parish that the repository does not
 * have.
 *
 * ## The alt text and caption travel with the choice
 *
 * `pictureFor` returns them, so choosing "The desert monastery" gives the
 * override the same alt text the coded plate had. Nothing else on this site
 * would have supplied it — the editor cannot make somebody write alt text, and
 * a picture with none on a page a screen reader reads is worse than no picture.
 *
 * ## Not the icons, and not the flythrough
 *
 * `SAINT_IMAGES` is included because the saints page's own figures are there and
 * a page about two martyrs should be able to show a different image of them.
 * The flythrough is a video with a caption track and is not a picture at all.
 * ---------------------------------------------------------------------------
 */
export interface AboutPictureChoice extends PictureChoice {
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

function group(label: string, rows: AboutPictureChoice[]): AboutPictureChoice[] {
  return rows.map((row) => ({ ...row, label: `${label} · ${row.label}` }));
}

const WHO: AboutPictureChoice[] = group(
  'History',
  (Object.keys(WHO_PICTURES) as WhoPictureName[]).map((name) => {
    const picture = WHO_PICTURES[name];
    return {
      value: whoLarge(name),
      label: picture.short,
      alt: picture.alt,
      caption: picture.caption,
      width: picture.width,
      height: picture.height,
    };
  }),
);

const BELIEF: AboutPictureChoice[] = group(
  'Belief',
  (Object.keys(BELIEF_PICTURES) as BeliefPictureName[]).map((name) => {
    const picture = BELIEF_PICTURES[name];
    return {
      value: beliefLarge(name),
      label: picture.short,
      alt: picture.alt,
      caption: picture.caption,
      width: picture.width,
      height: picture.height,
    };
  }),
);

const FUTURE: AboutPictureChoice[] = group(
  'Future plans',
  (Object.keys(FUTURE_PICTURES) as FuturePictureName[]).map((name) => {
    const picture = FUTURE_PICTURES[name];
    return {
      value: futureLarge(name),
      // `FuturePicture` carries no `short`, so the drawing is named by its key —
      // 'approach', 'courtyard'. Those are the words the architects use for
      // them and they read acceptably in a list.
      label: name.replace(/-/g, ' '),
      alt: picture.alt,
      caption: picture.caption,
      width: picture.width,
      height: picture.height,
    };
  }),
);

const SAINTS: AboutPictureChoice[] = group(
  'Patron saints',
  Object.entries(SAINT_IMAGES).map(([slug, picture]) => ({
    value: saintFull(slug),
    label: picture.caption.split('.')[0] ?? slug,
    alt: picture.alt,
    caption: picture.caption,
    width: picture.width,
    height: picture.height,
  })),
);

const SANCTUARY: AboutPictureChoice[] = [
  {
    value: '/img/home-sanctuary-1600.webp',
    label: 'This church · the sanctuary at Wayland',
    alt: 'The sanctuary at Wayland: a carved wooden screen across the front of the church, icons set into it, and the altar behind.',
    caption:
      'The sanctuary at Wayland. The screen, the icons and the altar behind them were put in by this congregation; the walls around them were built by another one.',
    width: 2400,
    height: 926,
  },
];

export const ABOUT_PICTURE_CHOICES: readonly AboutPictureChoice[] = [
  ...SANCTUARY,
  ...WHO,
  ...BELIEF,
  ...SAINTS,
  ...FUTURE,
  // The stock photographs last: they are the generic option, and a page about
  // this parish's history should reach for its own pictures first.
  ...STOCK_PICTURES.map((row) => ({ ...row })),
];

/** The full record behind a chosen `src`, so alt text and caption come with it. */
export function pictureFor(src: string | null): AboutPictureChoice | undefined {
  if (src === null) return undefined;
  return ABOUT_PICTURE_CHOICES.find((choice) => choice.value === src);
}
