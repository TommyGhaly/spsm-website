'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { tourFull, tourThumb, type TourImage } from './stations';

/**
 * The interactive pieces the six stations are built out of.
 *
 * ---------------------------------------------------------------------------
 * One rule shaped all of them: a visitor is holding this phone *while walking*,
 * in a hall, standing in front of the thing the screen is describing. So every
 * component here is thumb-sized, works with one hand, and never hides something
 * behind a hover — a hover state on a touch screen is a control that does
 * nothing until you tap it, and then does two things at once.
 *
 * The second rule is that nothing may depend on JavaScript having run for the
 * *words* to be readable. Every station's prose is in the document and on the
 * screen from the first paint; the panels below rearrange and foreground it,
 * and none of them is the only way to reach anything.
 * ---------------------------------------------------------------------------
 */

/* ── Parts of a station ──────────────────────────────────────────────────── */

/**
 * One part of a station — "The Coptic language", "Relics", "The seven
 * sacraments".
 *
 * ---------------------------------------------------------------------------
 * **Open. Always.** These were `<details>` folds, and Tommy had them taken out:
 * *"make it look better and less reliant on opening sections"*. He is right,
 * and the reasoning that put them there was wrong in a specific way worth
 * writing down, because it is a tempting mistake.
 *
 * The argument for folding was that a visitor walking a hall wants a short
 * screen. But what a fold actually does is hide the content behind a promise —
 * the reader has to decide whether "Relics" is worth a tap *before* they can
 * see that it is three sentences. Six stations of that is a page that looks
 * empty and reads as work. Scrolling past a paragraph you do not want costs a
 * flick; deciding whether to open it costs attention, which is the scarcer
 * thing in a crowded room.
 *
 * What replaced the fold is not "the same content, unfolded" — it is the
 * two-column station layout in `TourScreen`, which is what makes an open page
 * navigable. The passport strip is the jump control now, and it always was the
 * better one.
 *
 * The interactive panels below (`Reveal`, `Switcher`, `Stepper`) still show one
 * thing at a time, and that is not the same pattern. They hold sets of parallel
 * items — six symbols, seven sacraments, two sets of vestments — where the
 * reader wants *one* answer and the set is the navigation. A fold hid prose
 * that had no alternative way in.
 * ---------------------------------------------------------------------------
 */
export function Subsection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tour-part">
      <h3 className="tour-part__title">{title}</h3>
      <div className="tour-part__body">{children}</div>
    </section>
  );
}

/* ── Reveal ──────────────────────────────────────────────────────────────── */

export type RevealItem = {
  id: string;
  /** The chip's label — two or three words, because six of them share a row. */
  label: string;
  /** A line printed beside the label in the open panel. Optional. */
  aside?: string;
  body: React.ReactNode;
};

/**
 * A row of chips, one of which is open at a time.
 *
 * Used wherever the station is a list of *symbols* rather than a paragraph —
 * the things in St. Mark's icon, the parts of the censer, the seven sacraments.
 * Each of those is a small closed question ("what is the lion for?") and a
 * reader wants one answer, not the wall of six.
 *
 * Always exactly one open, never zero: an empty panel below a row of chips
 * looks broken, and the height of the panel changing to nothing makes the page
 * jump under the reader's thumb. Tapping the open chip is therefore a no-op
 * rather than a toggle-closed.
 *
 * This is a tab set in everything but name, so it is marked up as one — arrow
 * keys move between chips, and the panel is labelled by whichever is selected.
 */
export function Reveal({ items, label }: { items: RevealItem[]; label: string }) {
  const [openId, setOpenId] = useState(items[0]?.id);
  const base = useId();
  const open = items.find((item) => item.id === openId) ?? items[0];
  if (!open) return null;

  const move = (delta: number) => {
    const at = items.findIndex((item) => item.id === open.id);
    // Wrap, which is what a tablist does and what a row of six chips on a phone
    // wants — the sixth is one press from the first rather than five.
    const next = items[(at + delta + items.length) % items.length];
    if (!next) return;
    setOpenId(next.id);
    document.getElementById(`${base}-${next.id}`)?.focus();
  };

  return (
    <div className="tour-reveal">
      <div className="tour-reveal__chips" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            id={`${base}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={item.id === open.id}
            aria-controls={`${base}-panel`}
            tabIndex={item.id === open.id ? 0 : -1}
            className={`tour-chip${item.id === open.id ? ' is-open' : ''}`}
            onClick={() => setOpenId(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-${open.id}`}
        className="tour-reveal__panel"
      >
        <p className="tour-reveal__head">
          <strong>{open.label}</strong>
          {open.aside ? <span className="tour-reveal__aside">{open.aside}</span> : null}
        </p>
        <div className="tour-reveal__body">{open.body}</div>
      </div>
    </div>
  );
}

/* ── Stepper ─────────────────────────────────────────────────────────────── */

export type Step = {
  id: string;
  /** The step's own name — "The Meeting", "Reconciliation". */
  title: string;
  /** What it corresponds to in the service, printed under the title. */
  service: string;
  body: React.ReactNode;
};

/**
 * A sequence walked one screen at a time.
 *
 * The liturgy-as-a-wedding is five steps that only mean anything *in order*,
 * and printing all five as paragraphs loses the one thing the analogy is doing
 * — that each stage follows from the last. So it is a stepper: one at a time,
 * with the whole sequence visible above as a rail, so a reader can see where
 * they are in it and jump back.
 *
 * The rail doubles as the control. Tapping a dot is how you skip; Previous and
 * Next are for the reader who is being walked through it by a guide and wants
 * to keep pace without aiming at a 12px target.
 */
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  const [at, setAt] = useState(0);
  const base = useId();
  const step = steps[at];
  if (!step) return null;

  return (
    <div className="tour-stepper">
      <ol className="tour-stepper__rail" aria-label={label}>
        {steps.map((entry, index) => (
          <li key={entry.id} className="tour-stepper__rail-item">
            <button
              type="button"
              className={`tour-stepper__dot${index === at ? ' is-here' : ''}${
                index < at ? ' is-done' : ''
              }`}
              aria-current={index === at ? 'step' : undefined}
              onClick={() => setAt(index)}
            >
              <span aria-hidden="true">{index + 1}</span>
              <span className="visually-hidden">
                Step {index + 1}: {entry.title}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/*
        `aria-live` rather than moving focus. The reader's focus is on Next,
        which they are likely to press again; yanking it into the panel would
        cost them the button they are using. Polite, so it waits for a screen
        reader to finish whatever it is saying.
      */}
      <div className="tour-stepper__panel" id={`${base}-panel`} aria-live="polite">
        <p className="tour-stepper__count">
          Step {at + 1} of {steps.length}
        </p>
        <h4 className="tour-stepper__title">{step.title}</h4>
        <p className="tour-stepper__service">{step.service}</p>
        <div className="tour-stepper__body">{step.body}</div>
      </div>

      <div className="tour-stepper__controls">
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setAt((n) => Math.max(0, n - 1))}
          disabled={at === 0}
        >
          Previous
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => setAt((n) => Math.min(steps.length - 1, n + 1))}
          disabled={at === steps.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ── Switcher ────────────────────────────────────────────────────────────── */

export type Side = {
  id: string;
  label: string;
  body: React.ReactNode;
};

/**
 * Two things held up against each other, one shown at a time.
 *
 * The tour notes give the priest's vestments and the deacon's as two columns of
 * a table, which is the right shape on paper and the wrong one on a phone —
 * two columns at 390px are two columns of about eighteen characters. Same
 * content, shown as a switch: you read one list, then the other, and the
 * comparison is in the switching rather than in the eye moving sideways.
 */
export function Switcher({ sides, label }: { sides: Side[]; label: string }) {
  const [openId, setOpenId] = useState(sides[0]?.id);
  const base = useId();
  const open = sides.find((side) => side.id === openId) ?? sides[0];
  if (!open) return null;

  return (
    <div className="tour-switch">
      <div className="tour-switch__bar" role="tablist" aria-label={label}>
        {sides.map((side) => (
          <button
            key={side.id}
            type="button"
            role="tab"
            id={`${base}-${side.id}`}
            aria-selected={side.id === open.id}
            aria-controls={`${base}-panel`}
            tabIndex={side.id === open.id ? 0 : -1}
            className={`tour-switch__tab${side.id === open.id ? ' is-open' : ''}`}
            onClick={() => setOpenId(side.id)}
          >
            {side.label}
          </button>
        ))}
      </div>
      <div
        className="tour-switch__panel"
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-${open.id}`}
      >
        {open.body}
      </div>
    </div>
  );
}

/* ── Gallery ─────────────────────────────────────────────────────────────── */

/**
 * A station's photographs, and the lightbox they open into.
 *
 * ---------------------------------------------------------------------------
 * Tiles are a fixed 4:3 and `object-fit: cover`, which crops. That is a real
 * cost here — half of these are tall museum photographs of icons and manuscript
 * leaves, and cropping an icon to a landscape band shows a torso. It is paid
 * deliberately, because the alternative is worse: a grid of mixed portrait and
 * landscape images shown whole is a ragged, gappy thing that reads as broken
 * layout, and a visitor scrolling past on a phone sees the raggedness before
 * they see any picture. The crop buys a calm grid; the lightbox gives the
 * framing back, whole, one tap away.
 *
 * **Not `<dialog>`.** The lightbox is a plain fixed element with its own state.
 * `<dialog>`'s `close` event does not fire in every embedded browser view this
 * site gets looked at in, and a lightbox that cannot be dismissed is a trap
 * over the whole page rather than a cosmetic bug. Escape, the button and the
 * backdrop are all wired here, in code that runs the same everywhere.
 * ---------------------------------------------------------------------------
 */
export function Gallery({ images, station }: { images: TourImage[]; station: string }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const closer = useRef<HTMLButtonElement>(null);
  /** Where focus goes back to. A lightbox that returns focus to the top of the
   *  document loses a reader their place in a page this long. */
  const opener = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpenAt(null);
    opener.current?.focus();
  }, []);

  const step = useCallback(
    (delta: number) => {
      setOpenAt((at) => (at === null ? at : (at + delta + images.length) % images.length));
    },
    [images.length],
  );

  useEffect(() => {
    if (openAt === null) return undefined;
    closer.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll while the lightbox is over it — on a
    // touch screen a drag on the image would otherwise carry the reader away
    // from the station they were looking at.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [openAt, close, step]);

  const open = openAt === null ? null : images[openAt];

  return (
    <>
      <ul className="tour-gallery" aria-label={`Photographs — ${station}`}>
        {images.map((image, index) => (
          <li key={image.slug} className="tour-gallery__cell">
            <button
              type="button"
              className="tour-gallery__tile"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpenAt(index);
              }}
            >
              <img
                src={tourThumb(image.slug)}
                alt={image.alt}
                loading="lazy"
                decoding="async"
                className="tour-gallery__img"
              />
              <span className="visually-hidden">View larger</span>
            </button>
            <p className="tour-gallery__caption">{image.caption}</p>
          </li>
        ))}
      </ul>

      {open ? (
        <div
          className="tour-light"
          role="dialog"
          aria-modal="true"
          aria-label={open.caption}
          onClick={(event) => {
            // Backdrop only. A click that started on the picture must not close
            // the thing the reader is looking at.
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="tour-light__frame">
            <img
              src={tourFull(open.slug)}
              alt={open.alt}
              className="tour-light__img"
              decoding="async"
            />
            <p className="tour-light__caption">{open.caption}</p>
          </div>

          <button
            ref={closer}
            type="button"
            className="tour-light__close"
            onClick={close}
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>

          {images.length > 1 ? (
            <>
              <button
                type="button"
                className="tour-light__step tour-light__step--prev"
                onClick={() => step(-1)}
                aria-label="Previous photograph"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                type="button"
                className="tour-light__step tour-light__step--next"
                onClick={() => step(1)}
                aria-label="Next photograph"
              >
                <span aria-hidden="true">›</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
