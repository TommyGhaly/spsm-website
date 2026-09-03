import { Editable } from '@/features/about/Editable';
import { EditableCaption } from '@/features/about/EditableCaption';
import { FUTURE_PICTURES, futureLarge, futureSmall, type FuturePictureName } from './images';
import { haveAnyLogos, teamLogo, type TeamLogo } from './logos';
import { BY_USE, PROGRESS, TEAM } from './plan';

/**
 * A framed picture with its caption.
 *
 * Deliberately the same shape as `features/who/parts.tsx` — a figure, a
 * hairline frame, a caption underneath, no lightbox — because these two pages
 * sit next to each other in the About menu and a reader moving between them
 * should not have to learn a second set of behaviours. Only the class prefix
 * differs, and it has to: there is one `globals.css` for the whole site and
 * `.who-plate` is already spoken for.
 */
export function Plate({
  name,
  className = '',
  captionSlot,
}: {
  name: FuturePictureName;
  className?: string;
  /** Makes the caption rewritable. See `EditableCaption`. */
  captionSlot?: string | undefined;
}) {
  const picture = FUTURE_PICTURES[name];

  return (
    <figure className={`future-plate ${className}`.trim()}>
      <img
        className="future-plate__img"
        src={futureLarge(name)}
        srcSet={`${futureSmall(name)} 800w, ${futureLarge(name)} ${picture.width}w`}
        sizes="(min-width: 60rem) 34rem, 100vw"
        alt={picture.alt}
        width={picture.width}
        height={picture.height}
        loading="lazy"
        decoding="async"
      />
      <EditableCaption slot={captionSlot} className="future-plate__caption">
        {picture.caption}
      </EditableCaption>
    </figure>
  );
}

/**
 * A picture across the width of its band.
 *
 * The two drawings need this more than the renderings do: a site plan at column
 * width is a grey smudge, and the whole reason it is on the page is that a
 * reader can find Rice Road on it.
 *
 * ---------------------------------------------------------------------------
 * `openable` adds a link to the full-size file at the end of the caption, and
 * it is set for the two sheets out of the permit set and nothing else. **A
 * drawing is a document, not a picture**, which is the whole distinction: a
 * rendering is taken in at whatever size the band gives, but a site plan is
 * 340px wide on a phone with its street names set at about four pixels, and a
 * reader who wants to know where the fire road runs cannot get that from the
 * page.
 *
 * **No lightbox**, for the reason /about/who-we-are and /about/our-belief have
 * none — and here for a second reason on top of it: a modal needs a client
 * component, and this page is otherwise pure HTML with no JavaScript at all. A
 * link to an image opens at whatever size the reader's browser gives it,
 * pinch-zooms on a phone, works with JavaScript off, and can be saved. It is
 * the better affordance as well as the cheaper one.
 *
 * The link is in the caption rather than wrapped around the picture. A picture
 * that is silently a link is a picture nobody clicks; a sentence saying "open
 * the full sheet" is one they do.
 * ---------------------------------------------------------------------------
 */
export function WidePlate({
  name,
  openable = false,
  captionSlot,
}: {
  name: FuturePictureName;
  openable?: boolean;
  captionSlot?: string | undefined;
}) {
  const picture = FUTURE_PICTURES[name];

  return (
    <figure className="future-plate future-plate--full">
      <img
        className="future-plate__img"
        src={futureLarge(name)}
        srcSet={`${futureSmall(name)} 800w, ${futureLarge(name)} ${picture.width}w`}
        sizes="(min-width: 80rem) 76rem, 100vw"
        alt={picture.alt}
        width={picture.width}
        height={picture.height}
        loading="lazy"
        decoding="async"
      />
      <figcaption className="future-plate__caption">
        {/*
          The caption only, never the "Open the full sheet" link beside it —
          that is a control, and its words have to keep describing what it does.
        */}
        {captionSlot === undefined ? (
          picture.caption
        ) : (
          <Editable slot={captionSlot} as="span" prose>
            {picture.caption}
          </Editable>
        )}
        {openable ? (
          <>
            {' '}
            <a
              className="future-plate__open"
              href={futureLarge(name)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the full sheet
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * The whole floor area, split by use.
 *
 * A `dl`, for the reason the chronologies on /about/who-we-are are one: a term
 * and the thing said about it. The area is part of the term rather than a third
 * column, so the row survives a phone without a horizontal scroller — the
 * failure mode a table would have here.
 *
 * The numbers are formatted at render rather than stored as strings, so
 * `plan.ts` holds arithmetic that can be checked and not typography.
 */
export function ByUse() {
  return (
    <dl className="future-uses">
      {BY_USE.map((row, index) => (
        <div key={row.use} className="future-uses__row">
          <dt className="future-uses__term">
            <Editable
              slot={`all-of-it.use-${index}-name`}
              as="span"
              className="future-uses__name"
            >
              {row.use}
            </Editable>
            {/*
              The **area is not editable**, and this is the one place on these
              five pages where that is a considered refusal rather than an
              oversight. It is `row.area` off the schedule that repeats on every
              floor plan in the set filed with the town, formatted here rather
              than stored as a string precisely so `plan.ts` holds arithmetic
              that can be checked. The seven lines add to the total exactly; a
              hand-typed figure would silently stop doing that, on a page whose
              whole claim is that it agrees with the drawings.
            */}
            <span className="future-uses__area">
              {row.area.toLocaleString('en-US')}
              <span className="future-uses__unit"> sq ft</span>
            </span>
          </dt>
          <Editable
            slot={`all-of-it.use-${index}-of`}
            as="dd"
            prose
            className="future-uses__what"
          >
            {row.of}
          </Editable>
        </div>
      ))}
    </dl>
  );
}

/**
 * The dated spine — where the work has got to.
 *
 * Same construction as `features/who/parts.tsx`: the date is display type in
 * the accent so the eye can run down the column, and it is emphatically not a
 * heading, because a screen reader jumping by heading through this page should
 * land on the sections and not on seven dates.
 *
 * Unlike that page's `Chronology` this takes no props. That one renders two
 * different spines and needs to be told which; there is exactly one of these.
 */
export function Progress() {
  return (
    <dl className="future-chron">
      {PROGRESS.map((moment, index) => (
        <div key={moment.when} className="future-chron__row">
          <Editable
            slot={`where-it-stands.step-${index}-when`}
            as="dt"
            className="future-chron__when"
          >
            {moment.when}
          </Editable>
          <Editable
            slot={`where-it-stands.step-${index}-what`}
            as="dd"
            prose
            className="future-chron__what"
          >
            {moment.what}
          </Editable>
        </div>
      ))}
    </dl>
  );
}

/**
 * The row of consultants' marks.
 *
 * ---------------------------------------------------------------------------
 * **Renders nothing at all if no logo file has been built**, rather than nine
 * empty boxes — `haveAnyLogos` is a separate question from `teamLogo` for
 * exactly that reason. The names below it are the information; this row is the
 * thing a reader recognises at a glance, and a half-empty version of it does
 * the opposite of what it is for.
 *
 * `alt=""` on every mark, and that is not laziness. Each logo sits directly
 * above — and is the same word as — the firm name in `Team` below, so a screen
 * reader announcing both reads every firm twice. The name is the accessible
 * text; the picture is decoration on top of it.
 *
 * `loading="lazy"` throughout: this is the last band on a long page and nobody
 * arrives at it in the first screenful.
 * ---------------------------------------------------------------------------
 */
export function TeamMarks() {
  if (!haveAnyLogos()) return null;

  const marks = TEAM.map((member) => ({ member, logo: teamLogo(member.slug) })).filter(
    (entry): entry is { member: (typeof TEAM)[number]; logo: TeamLogo } => entry.logo !== null,
  );

  if (marks.length === 0) return null;

  return (
    <ul className="future-marks">
      {marks.map(({ member, logo }) => (
        <li key={member.slug} className="future-mark">
          <img
            className="future-mark__img"
            src={logo.src}
            srcSet={logo.srcSet}
            /*
              Measured against the widest mark rather than guessed. Every logo
              renders 2.6rem tall and takes whatever width that implies, which
              for MDM's 12.5:1 wordmark is about 520px — so `520px` is the size
              that keeps the browser from picking the 240 file for the one mark
              that most needs the 480. The narrow marks over-fetch by a few
              kilobytes each, which is the right way round.
            */
            sizes="520px"
            alt=""
            loading="lazy"
            decoding="async"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The marks row with its own band and heading, under the film.
 *
 * ---------------------------------------------------------------------------
 * **The whole band disappears when no logo has been built**, heading and all,
 * and that is the reason this exists rather than the section living inline in
 * `FutureScreen`. `TeamMarks` alone returning `null` left a sentence naming the
 * architects with an empty white gap under it — worse than either having the
 * marks or not mentioning them here, because it reads as a broken image row.
 *
 * The position was asked for: *"put the logos at the top after the video."* A
 * reader who has just watched a photorealistic animation of a building that
 * does not exist is at their most sceptical in the second after it ends, and
 * seven engineering firms' marks answer that in about a second — which only
 * works if they are the next thing on the screen.
 *
 * The *names* stay at the foot of the page with their roles and towns. A row of
 * marks answers "is this serious"; the list answers "who checked the
 * structure", and needs a reader who has got that far. Two questions, two
 * places, one `TEAM` array.
 * ---------------------------------------------------------------------------
 */
export function TeamMarksBand() {
  if (!haveAnyLogos()) return null;

  return (
    /*
      `band--tight-start` because the ground does not change at the seam above:
      the film band is paper and so is this, and a full section's air here would
      break the film away from the answer to it. This is the case that modifier
      was written for.
    */
    <section className="band band--tight-start future-marks-band" aria-labelledby="drawn-by">
      <div className="wrap">
        <h2 id="drawn-by" className="future-marks-band__head">
          Drawn by <strong>Dewing Schmid Kearns</strong>, with eight consulting firms under them
        </h2>
        <TeamMarks />
      </div>
    </section>
  );
}

/**
 * Who is drawing it. Nine firms, each with what they do and where they are.
 *
 * The role comes first and the firm second, because the question a reader has
 * is "did anyone check the structure / the traffic / the wetland", not "who is
 * Foley Buhl Roberts". Answering in that order lets the list be skimmed as a
 * checklist of disciplines, which is what it is being offered as.
 */
export function Team() {
  return (
    <dl className="future-team">
      {TEAM.map((member) => (
        <div key={member.slug} className="future-team__row">
          <Editable
            slot={`who-is-drawing-it.firm-${member.slug}-role`}
            as="dt"
            className="future-team__role"
          >
            {member.role}
          </Editable>
          <dd className="future-team__firm">
            <Editable slot={`who-is-drawing-it.firm-${member.slug}-name`} as="span">
              {member.firm}
            </Editable>
            {/* Empty for the two firms whose address is not printed anywhere in
                the set. An empty span would still take the line's leading. */}
            {member.town ? (
              <Editable
                slot={`who-is-drawing-it.firm-${member.slug}-town`}
                as="span"
                className="future-team__town"
              >
                {member.town}
              </Editable>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The picture credit, and it is **visible**.
 *
 * /about/our-belief and /about/patron-saints fold theirs into a shut drawer,
 * and /about/who-we-are hides its list entirely — all three for the same
 * reason, which is that free-licence attribution is an obligation to a
 * photographer nobody on the page is going to look up.
 *
 * This one is different in kind. Nothing here is licensed to us by a stranger;
 * it is work the church commissioned. The reason to print it is not attribution
 * but **calibration**: a reader looking at a photorealistic aerial view needs
 * to be told, in the same eyeful, that it is a drawing of an unbuilt building,
 * dated, by a named firm, filed with a town that has not yet approved it. That
 * is not a credit hidden at the bottom. It is part of what the page says.
 */
export function Credit() {
  return (
    <p className="future-credit">
      All views on this page are renderings by Dewing Schmid Kearns Architects + Planners, drawn
      for the church — eight of them frames from the flythrough of 19 March 2026, and two of them
      sheets from the set filed with the Town of Wayland in December 2025. Nothing here is a
      photograph, and nothing here is final.
    </p>
  );
}
