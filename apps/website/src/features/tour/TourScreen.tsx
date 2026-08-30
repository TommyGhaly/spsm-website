'use client';

import { useEffect, useRef } from 'react';
import { Gallery } from './parts';
import { STATION_CONTENT } from './content';
import { TOUR_CREDITS, TOUR_STATIONS } from './stations';
import { usePassport } from './passport';
import { useChromeHeight } from './useChromeHeight';
import { Passport, Reward, StampButton } from './widgets';

/**
 * The festival tour, whole.
 *
 * ---------------------------------------------------------------------------
 * One page, six stations, each with its own fragment. The fragments are the
 * contract with the physical festival: a station leader's QR code or NFC tag
 * points at `/about/welcome-newcomers#station-4`, and once those are printed
 * the ids in `stations.ts` cannot be renamed. Nothing here may become a route
 * per station for the same reason — a visitor deep-linked to station 4 should
 * be able to keep scrolling into station 5, because that is what they are about
 * to walk to.
 *
 * A client component from the root down. Almost everything on the page is
 * interactive — the passport reads `localStorage`, the galleries open a
 * lightbox, every station is a set of disclosures — so splitting a server shell
 * out of it would save nothing and would put a boundary through the middle of
 * the layout. The *content* is still static: this all pre-renders into the
 * exported HTML, so the words and the photographs are in the document a phone
 * receives, and the script only adds the behaviour.
 * ---------------------------------------------------------------------------
 */
export function TourScreen() {
  const passport = usePassport();
  const root = useRef<HTMLDivElement>(null);

  // Publishes `--tour-masthead-h`. The sticky passport and every station's
  // scroll-margin are positioned against it — see the note in the hook for why
  // this is measured rather than read from `--masthead-h`.
  useChromeHeight(root);

  /*
   * Land on the station the fragment names.
   *
   * The browser does this by itself for a fragment present at load — except
   * that here it does it before the sticky passport exists, so the heading ends
   * up underneath it. Re-running the scroll after mount, with `scroll-margin`
   * applied (see `.tour-station` in globals.css), puts the station's title
   * where the reader can see it.
   *
   * Guarded on the element existing: a stale QR code pointing at a station that
   * has since been renamed should do nothing at all, not throw.
   *
   * A direct call, not `requestAnimationFrame`. Layout has already run by the
   * time an effect fires, so the frame buys nothing — and rAF never fires at
   * all in some embedded browser views, which would silently drop the one
   * behaviour every printed QR code at the festival depends on.
   */
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <div className="tour" ref={root}>
      <section className="band band--deep tour-hero">
        <div className="wrap tour-hero__inner">
          <p className="tour-hero__eyebrow">Follow the tour</p>
          <p className="tour-hero__title">
            Six stations through the Coptic Orthodox Church
          </p>
          <p className="tour-hero__lede">
            The same six stops the guides walk. Collect a stamp at each one.
          </p>
        </div>
      </section>

      <Passport passport={passport} />

      {TOUR_STATIONS.map((station) => {
        const Content = STATION_CONTENT[station.id];
        // Alternating grounds, so six long stations read as six things rather
        // than one scroll. See `.band--sunken`.
        const sunken = station.number % 2 === 0;

        return (
          <section
            key={station.id}
            id={station.id}
            className={`band tour-station${sunken ? ' band--sunken' : ''}`}
            aria-labelledby={`${station.id}-title`}
          >
            <div className="wrap tour-station__inner">
              <header className="tour-station__head">
                <p className="tour-station__eyebrow">
                  <span className="tour-station__num" aria-hidden="true">
                    {station.number}
                  </span>
                  <span>Station {station.number}</span>
                </p>
                <h2 className="tour-station__title" id={`${station.id}-title`}>
                  {station.title}
                </h2>
                <p className="tour-station__lede">{station.lede}</p>
              </header>

              {/*
                The aside precedes the body in the DOM, and that is the mobile
                reading order: title, then the photographs, then the words.
                Above 68rem the grid lifts it into the second column beside the
                prose — see `.tour-station__grid`. Ordering it the other way
                round and fixing mobile with `order` would put the stamp button
                before the station it stamps for a screen reader, which reads
                the DOM and not the grid.
              */}
              <div className="tour-station__grid">
                <aside className="tour-station__aside">
                  <Gallery images={station.images} station={station.title} />
                  <StampButton station={station.id} passport={passport} />
                </aside>

                <div className="tour-station__body">{Content ? <Content /> : null}</div>
              </div>
            </div>
          </section>
        );
      })}

      <section className="band band--tinted tour-end">
        <div className="wrap tour-end__inner">
          <Reward passport={passport} />

          {/*
            The credits — in the page, not on it.
            ----------------------------------------------------------------
            This was a `<details>` fold at the foot of the band. Tommy asked
            for the same treatment the credits on /about/our-belief got:
            *"hide the photo credits."* So the block is `visually-hidden` —
            clipped to a pixel, still in the markup, still read by a screen
            reader, still in view-source and in the static export.

            **It cannot simply be deleted.** Seven of the twenty-four
            photographs are CC BY or CC BY-SA — altar-ark, hand-cymbals,
            iconostasis, ney, ney-player, oud and tunic-embroidery — and each
            of those obliges the church to name the author and the licence
            wherever the picture is published. To get the credits off the page
            for real, replace those seven files in `assets/tour/` with CC0 or
            public-domain ones and *then* remove this; never drop the
            attribution and keep the photographs.

            The `.tour-credits*` rules in globals.css match nothing now.

            The same twenty-four entries are also printed *visibly*, in the
            credits drawer on /about, alongside the other three picture sets.
            Both are wanted: the drawer is where a reader goes looking, and
            this one is the attribution travelling with the page the pictures
            are actually on.
          */}
          <div className="visually-hidden">
            <h2>Where these photographs come from</h2>
            <p>
              None of the photographs on this page is of this church. They are from Wikimedia
              Commons, and every one is public domain, CC0, CC BY or CC BY&#8209;SA.
            </p>
            <ul>
              {TOUR_CREDITS.map((credit) => (
                <li key={credit.slug}>
                  <a href={credit.page} rel="noreferrer noopener" target="_blank">
                    {credit.what}
                  </a>
                  {` — ${credit.author} · ${credit.license}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
