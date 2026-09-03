import { DefinitionSpine } from '@/components/DefinitionSpine';
import { Editable } from '@/features/about/Editable';
import { EditableCaption } from '@/features/about/EditableCaption';
import { clericInitial } from '@/features/content/deacons';
import { bundledPortrait } from '@/features/content/portraits';
import type { Moment } from './chronologies';
import { ROSTER } from './clergy';
import { WHO_CREDITS, WHO_PICTURES, whoLarge, whoSmall, type WhoPictureName } from './images';

/**
 * A framed picture with its caption.
 *
 * No lightbox, for the reason /about/our-belief has none: the tour's galleries
 * are the point of the station, but here a picture supports a paragraph the
 * reader is in the middle of, and a modal that takes the screen — and focus,
 * and body scroll — is a way of losing their place in a long page.
 *
 * `sizes` is measured, not guessed: the plate is the full column on a phone and
 * a little under half of `--shell-width` beside prose from 60rem up. The srcset
 * descriptor for the large file is that file's real width — see the note in
 * `images.ts` about `withoutEnlargement`.
 */
export function Plate({
  name,
  className = '',
  captionSlot,
}: {
  name: WhoPictureName;
  className?: string;
  /** Makes the caption rewritable. See `EditableCaption`. */
  captionSlot?: string | undefined;
}) {
  const picture = WHO_PICTURES[name];

  return (
    <figure className={`who-plate ${className}`.trim()}>
      <img
        className="who-plate__img"
        src={whoLarge(name)}
        srcSet={`${whoSmall(name)} 640w, ${whoLarge(name)} ${picture.width}w`}
        sizes="(min-width: 60rem) 34rem, 100vw"
        alt={picture.alt}
        width={picture.width}
        height={picture.height}
        loading="lazy"
        decoding="async"
      />
      <EditableCaption slot={captionSlot} className="who-plate__caption">
        {picture.caption}
      </EditableCaption>
    </figure>
  );
}

/**
 * A picture that runs the full width of its band rather than sitting beside
 * prose. The landscapes need it — the monastery under its cliff is a smear at
 * column width — and it gives a page of six long bands somewhere to breathe.
 */
export function WidePlate({
  name,
  captionSlot,
}: {
  name: WhoPictureName;
  captionSlot?: string | undefined;
}) {
  const picture = WHO_PICTURES[name];

  return (
    <figure className="who-plate who-plate--full">
      <img
        className="who-plate__img"
        src={whoLarge(name)}
        srcSet={`${whoSmall(name)} 640w, ${whoLarge(name)} ${picture.width}w`}
        sizes="(min-width: 80rem) 76rem, 100vw"
        alt={picture.alt}
        width={picture.width}
        height={picture.height}
        loading="lazy"
        decoding="async"
      />
      <EditableCaption slot={captionSlot} className="who-plate__caption">
        {picture.caption}
      </EditableCaption>
    </figure>
  );
}

/**
 * The sanctuary at Wayland.
 *
 * Not a `WhoPictureName`, and deliberately not moved into `assets/who/`. This
 * is the one photograph on the page of this church, it is already built by the
 * optimiser as `img/home-sanctuary-*` for the homepage hero, and copying it
 * into a second set of files under `img/who/` would mean two answers to "what
 * does the inside of this church look like" that could drift apart.
 *
 * The 2400 file is the largest the optimiser emits; 1000 is the phone. There is
 * no 640, which is why `sizes` stops where it does.
 */
export function Sanctuary({ captionSlot }: { captionSlot?: string | undefined }) {
  return (
    <figure className="who-plate who-plate--full">
      <img
        className="who-plate__img"
        src="/img/home-sanctuary-1600.webp"
        srcSet="/img/home-sanctuary-1000.webp 1000w, /img/home-sanctuary-1600.webp 1600w, /img/home-sanctuary-2400.webp 2400w"
        sizes="(min-width: 80rem) 76rem, 100vw"
        alt="The sanctuary at Wayland: a carved wooden screen across the front of the church, icons set into it, and the altar behind."
        width={2400}
        height={926}
        loading="lazy"
        decoding="async"
      />
      <EditableCaption slot={captionSlot} className="who-plate__caption">
        The sanctuary at Wayland. The screen, the icons and the altar behind them were put in by
        this congregation; the walls around them were built by another one.
      </EditableCaption>
    </figure>
  );
}

/**
 * One dated spine — the nineteen centuries in Egypt, or the sixty years in New
 * England.
 *
 * The markup and the reasoning behind it moved to
 * `components/DefinitionSpine`, because a staff-added list on an About page is
 * the same thing and should not be a second implementation of `.who-chron`
 * that drifts from this one. The name stays here: a nineteen-century spine is a
 * meaningful thing on this page in a way "definition list" is not.
 */
export function Chronology({
  moments,
  slotPrefix,
}: {
  moments: readonly Moment[];
  slotPrefix?: string | undefined;
}) {
  return (
    <DefinitionSpine
      rows={moments.map((moment) => ({ term: moment.when, detail: moment.what }))}
      slotPrefix={slotPrefix}
    />
  );
}

/**
 * The clergy serving this church, with their photographs.
 *
 * ---------------------------------------------------------------------------
 * **The portrait is looked up on disk, not assumed.** `bundledPortrait` lists
 * `public/img/clergy/` at build time and returns null for anybody with no file
 * there, and that null is the whole reason this renders correctly today: the
 * three deacons have no photographs yet, and emitting `<img
 * src="/img/clergy/deacon-severus-ghaly.webp">` and hoping would put three
 * broken images at the foot of the page. They get the initial mark instead —
 * the same fallback the homepage uses — and they get their faces the moment the
 * files are dropped into `assets/` and `npm run assets` is run. No change here,
 * and no deploy-day scramble.
 *
 * Unlike the homepage, this does not read `person.portraitPath`. That override
 * exists so staff can replace a photograph from the Firebase console without a
 * deploy; it is null for all three fathers, it needs a Storage URL builder and
 * a Firestore read to resolve, and this page has neither and is otherwise a
 * pure static render. If it is ever set, the homepage will show it and this
 * page will show the bundled file — which is a real inconsistency, and cheaper
 * than making a history page read Firestore.
 *
 * `alt=""` on the portraits on purpose: each sits directly above the person's
 * name, and a screen reader announcing both says the name twice.
 * ---------------------------------------------------------------------------
 */
export function Clergy() {
  return (
    <ul className="who-clergy__list">
      {ROSTER.map((cleric) => {
        const portrait = bundledPortrait(cleric.slug);

        return (
          <li key={cleric.slug} className="who-cleric">
            {portrait ? (
              <img
                className="who-cleric__portrait"
                alt=""
                src={portrait.src}
                srcSet={portrait.srcSet}
                /* Tracks the layout below: the frame is a fixed 8.5rem circle at
                   every width, which is 136px — so the 400px file covers it to
                   3x and the 800px one is never the right choice. Overstating
                   this is how a small portrait ends up downloading a big file. */
                sizes="8.5rem"
                width={portrait.width}
                height={portrait.height}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="who-cleric__mark" aria-hidden="true">
                {/* The person's initial, not an ornament. A mark standing for
                    "no photograph yet" should still say who it is — and the
                    rank has to come off first, or all three deacons show a D.
                    Shared with the homepage, which shows the same six people
                    and must not disagree about which letter stands for whom. */}
                {clericInitial(cleric.name)}
              </span>
            )}
            {/*
              The roster's three lines. Editable, so a rank or a note can be
              corrected the day it changes rather than at the next deploy — but
              note that `clericInitial(cleric.name)` above and the homepage both
              read the *coded* name, so rewriting a name here changes it on this
              page only. Renaming somebody is still a code change; fixing the
              spelling of their note is not.
            */}
            <Editable
              slot={`the-clergy-here.cleric-${cleric.slug}-name`}
              as="p"
              className="who-cleric__name"
            >
              {cleric.name}
            </Editable>
            <Editable
              slot={`the-clergy-here.cleric-${cleric.slug}-rank`}
              as="p"
              className="who-cleric__rank"
            >
              {cleric.rank}
            </Editable>
            <Editable
              slot={`the-clergy-here.cleric-${cleric.slug}-note`}
              as="p"
              prose
              className="who-cleric__note"
            >
              {cleric.note}
            </Editable>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The picture credits, hidden.
 *
 * ---------------------------------------------------------------------------
 * Hidden, not deleted, and the difference matters. Every picture on this page
 * is public domain, CC0 or "no restrictions" — that was the rule the set was
 * chosen under, and it is enforced in the fetch rather than remembered — so
 * nothing here is a licence obligation we are quietly dropping. What it is, is
 * the answer to "what is that photograph and where is it from", kept in the
 * page where the pictures are instead of in a developer's head.
 *
 * `visually-hidden` rather than `hidden` or `display: none`: the list stays in
 * the accessibility tree and in the page source, and find-in-page still reaches
 * it. The same shape /about/our-belief and /about/patron-saints ended at.
 * ---------------------------------------------------------------------------
 */
export function Credits() {
  return (
    <div className="visually-hidden">
      <h2 id="picture-credits">Picture credits</h2>
      <p>
        Every picture on this page except the sanctuary is from Wikimedia Commons and is public
        domain, CC0 or free of known restrictions. None of them is a photograph of this church.
      </p>
      <ul>
        {WHO_CREDITS.map((credit) => (
          <li key={credit.name}>
            <a href={credit.page} rel="noreferrer">
              {WHO_PICTURES[credit.name].short}
            </a>
            {` — ${credit.author} · ${credit.license}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
