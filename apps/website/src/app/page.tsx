import Link from 'next/link';
import { formatAddress, type ContentPage, type DocOf } from '@spsm/shared';
import { getAnnouncements, AnnouncementList } from '@/features/announcements';
import { getUpcomingEvents, EventCard } from '@/features/events';
import { getCurrentBulletin, BulletinWeek } from '@/features/bulletin';
import { bundledPortrait, getContentPages } from '@/features/content';
import { givingUrl } from '@/features/giving';
import { LivestreamPlayer } from '@/features/livestream';
import { getIntegrationsConfig, getParishConfig } from '@/lib/config';
import { storageUrl } from '@/lib/storage';
import { EmptyState } from '@/components/Notice';
import { Icon, type IconName } from '@/components/Icon';
import { CopticCross, Ornament } from '@/components/Ornament';
import { Prose } from '@/components/Prose';
import { SectionHeading, SectionMore } from '@/components/SectionHeading';

export default async function HomePage() {
  // Independent reads — no reason to make the build wait on them in sequence.
  // The bulletin is the exception: it needs the config document first, since
  // that says which project and collection to read.
  const [config, parish, announcements, events, clergy] = await Promise.all([
    getIntegrationsConfig(),
    getParishConfig(),
    getAnnouncements(4),
    getUpcomingEvents(6),
    getContentPages('clergy'),
  ]);
  const bulletin = await getCurrentBulletin(config.announcements);

  // See `alternatingBands`. The first band under the hero is sunken.
  const band = alternatingBands();

  return (
    <>
      <Hero livestreamEnabled={config.livestream.enabled} />

      <QuickFacts
        band={band()}
        parish={parish}
        livestreamEnabled={config.livestream.enabled}
      />

      {/* The fathers. Absent entirely when no clergy page is published, rather
          than an empty band with a heading over nothing. */}
      {clergy.length > 0 && <Clergy band={band()} clergy={clergy} />}

      {/* The player itself, not a link to it — someone at home on a Sunday
          morning should not have to navigate to watch. Only when a stream is
          actually configured: `LivestreamPlayer` renders an honest "not set up"
          notice when it is not, which belongs on `/livestream` and would read
          as a fault on the homepage. */}
      {config.livestream.enabled && <Livestream band={band()} config={config.livestream} />}

      {/* The parish's own weekly sheet. Absent if the source is empty or the
          section is switched off in config/integrations. */}
      {bulletin && (
        <section className={band()} aria-labelledby="bulletin-heading">
          <div className="wrap reveal">
            <SectionHeading
              id="bulletin-heading"
              eyebrow="This week"
              title={bulletin.weekLabel}
              note={bulletin.presetName || undefined}
            />
            <BulletinWeek bulletin={bulletin} />
          </div>
        </section>
      )}

      <section className={band()} aria-labelledby="events-heading">
        <div className="wrap reveal">
          <SectionHeading
            id="events-heading"
            eyebrow="Upcoming"
            title="Feasts and gatherings"
            note="The feasts of the coming weeks, with the classes and gatherings around them."
          />
          {events.length === 0 ? (
            <EmptyState what="events" collection="events" />
          ) : (
            <>
              <ul className="grid reveal-stagger">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </ul>
              <SectionMore href="/events">See the full calendar</SectionMore>
            </>
          )}
        </div>
      </section>

      <section className={band()} aria-labelledby="announcements-heading">
        <div className="wrap reveal">
          <SectionHeading
            id="announcements-heading"
            eyebrow="From the parish"
            title="Announcements"
            note="Word from the parish office and the ministries."
          />
          {announcements.length === 0 ? (
            <EmptyState what="announcements" collection="announcements" />
          ) : (
            <AnnouncementList announcements={announcements} />
          )}
        </div>
      </section>

      <NewHere />

      <Giving band={band()} />
    </>
  );
}

/**
 * Deals out the `band` classes in render order, alternating paper and sunken.
 *
 * The alternation is what stops a long page reading as one column of beige, and
 * two of the sections it runs through — the bulletin and the clergy — are
 * conditional. Written by hand, the classes are correct only for the case where
 * both are present: switch the bulletin off in `config/integrations`, or publish
 * no clergy page, and two sunken bands run together with the boundary between
 * two unrelated sections invisible.
 *
 * Dealing them out is correct because JSX evaluates its children in source
 * order and short-circuits the conditional ones, so a section that does not
 * render never takes a turn. The consequence to know: these calls must stay in
 * the same order as the sections themselves.
 *
 * The closing `band--deep` is not part of this. It is the end of the page
 * rather than another alternation, and it reads as deliberate wherever it lands.
 */
function alternatingBands(): () => string {
  let sunken = false;
  return () => {
    sunken = !sunken;
    return sunken ? 'band band--sunken' : 'band';
  };
}

/**
 * The homepage hero.
 *
 * This now carries **a photograph of this parish's own sanctuary** — the
 * iconostasis at Wayland, with the four living creatures above it and a priest
 * at the altar. That is a change of kind, not degree: every other photograph in
 * `assets/` is either a different church or of unverified provenance, which is
 * why this hero used to be built out of type and ornament with a stock image
 * dimmed to 14% behind it.
 *
 * Because it is the parish, the rules that governed the old backdrop no longer
 * apply. It gets real alt text, it is carried at full strength rather than as
 * texture, and it may be presented as this church, because it is.
 *
 * The seal is deliberately gone from the hero. It is in the masthead directly
 * above, and against a photograph this detailed a second detailed mark is two
 * things competing for the same attention.
 */
function Hero({ livestreamEnabled }: { livestreamEnabled: boolean }) {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      {/*
        Real alt text, unlike the backdrop this replaces. It describes what a
        visitor would see on walking in, because that is the question the
        photograph is answering.

        `fetchPriority="high"` and no lazy loading: this is the largest element
        above the fold on the site's most-visited page, so it is the Largest
        Contentful Paint. Deferring it is deferring the page.
      */}
      {/*
        `<picture>`, because this is art direction rather than resolution
        switching. The landscape frame is 2.6:1 and a phone hero is about 0.6:1,
        so `object-fit: cover` would discard three quarters of the width and
        leave only the red curtain behind the altar — no icons, no altar, just a
        smear. The 3:4 source below 40rem is cropped around the altar instead.

        One `alt` for both, on the `img`: they are the same photograph of the
        same room, and `<source>` carries no alt of its own.
      */}
      <picture>
        <source
          media="(max-width: 40rem)"
          srcSet="/img/home-sanctuary-portrait-600.webp 600w, /img/home-sanctuary-portrait-900.webp 900w"
          sizes="100vw"
          width={900}
          height={1200}
        />
        <img
          className="hero__photo"
          src="/img/home-sanctuary-1600.webp"
          srcSet="/img/home-sanctuary-1000.webp 1000w, /img/home-sanctuary-1600.webp 1600w, /img/home-sanctuary-2400.webp 2400w"
          sizes="100vw"
          alt="The sanctuary at St. Philopater Mercurius & St. Mina: the iconostasis, its icons of Christ and the Theotokos, and a priest serving at the altar."
          width={2400}
          height={1104}
          fetchPriority="high"
          decoding="async"
        />
      </picture>
      <div className="hero__veil" />

      <div className="wrap hero__inner">
        <p className="hero__eyebrow">Coptic Orthodox Church · Wayland, Massachusetts</p>

        <h1 id="hero-heading">St. Philopater Mercurius &amp; St. Mina</h1>

        <p className="hero__lede">
          Here the Divine Liturgy is offered as the Church has offered it since the
          Apostles. Whoever you are, you are welcome to come and pray with us.
        </p>

        <div className="hero__actions">
          {/* `/welcome` used to be the primary action here. It is now reached by
              NFC tap only, so the hero sends a first-time visitor to the two
              things they actually need: when we pray, and where we are. */}
          <Link className="button" href="/contact">
            Times of prayer
          </Link>
          <Link className="button button--ghost" href="/about">
            About the parish
          </Link>
          {/* Only offered when a stream is actually configured. A "Watch live"
              button leading to an empty player reads as a broken site. */}
          {livestreamEnabled && (
            <Link className="button button--ghost" href="/livestream">
              Watch live
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * When, where, and what to expect — directly under the hero.
 *
 * A first-time visitor arrives with three questions, and a visitor who has to
 * open the nav to find the Sunday liturgy time has already been failed once.
 * Every card degrades on its own: the parish document is often partly filled,
 * and a blank tile is worse than an honest "ask the office".
 */
function QuickFacts({
  band,
  parish,
  livestreamEnabled,
}: {
  band: string;
  parish: Awaited<ReturnType<typeof getParishConfig>>;
  livestreamEnabled: boolean;
}) {
  const address = formatAddress(parish.address);

  // The service a visitor most likely means by "when is church?". First in the
  // parish's own ordering rather than a guess at which is most important —
  // staff control that order, and they know.
  const principalService = parish.serviceTimes[0];

  const facts: { icon: IconName; label: string; body: React.ReactNode }[] = [
    {
      icon: 'clock',
      label: 'The Divine Liturgy',
      body: principalService ? (
        <>
          {principalService.day} · {principalService.time}
          <br />
          {principalService.name}
        </>
      ) : (
        <Link href="/contact">Ask the parish office →</Link>
      ),
    },
    {
      icon: 'pin',
      label: 'Where to find us',
      body: address ? (
        <>
          {parish.address.line1}
          <br />
          {[parish.address.city, parish.address.state].filter(Boolean).join(', ')}{' '}
          {parish.address.postalCode}
        </>
      ) : (
        <Link href="/contact">Wayland, Massachusetts →</Link>
      ),
    },
    livestreamEnabled
      ? {
          icon: 'play',
          label: 'Praying from home',
          // The player is further down this same page, so this jumps to it
          // rather than sending someone to `/livestream` for something they are
          // already looking at. That route still exists and is still in the nav.
          body: <a href="#livestream">Watch the Liturgy live →</a>,
        }
      : {
          icon: 'door',
          label: 'Visiting',
          // Was `/welcome`, which is now an NFC destination rather than a page
          // on the site. `/about` is the nearest thing a visitor can browse to.
          body: <Link href="/about">About this parish →</Link>,
        },
  ];

  return (
    <section className={band} aria-labelledby="facts-heading">
      <div className="wrap">
        {/* The section needs a name for landmark navigation, but a visible
            heading over three self-explanatory tiles is clutter. */}
        <h2 id="facts-heading" className="visually-hidden">
          Visiting the parish
        </h2>
        <ul className="facts reveal-stagger">
          {facts.map((fact) => (
            <li className="fact" key={fact.label}>
              <span className="fact__icon">
                {/* Larger than the 20px it was inside a filled disc: a bare
                    glyph has no plate around it to give it presence. */}
                <Icon name={fact.icon} size={26} />
              </span>
              <div className="fact__body">
                <h3>{fact.label}</h3>
                <p>{fact.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The fathers who serve the parish, under the week's schedule.
 *
 * **This is the only place the biographies live.** `/clergy` used to be a page
 * of its own through the `[section]` route and no longer is: three biographies
 * is not a page, it is a section, and a visitor who wants to know who the priest
 * is should not have to leave the page they landed on to find out. The route is
 * excluded in `[section]/page.tsx`; the footer and the sitemap point here.
 *
 * Because there is nowhere else to read them, each father is a disclosure rather
 * than an excerpt — closed, the section is three faces and three names side by
 * side; opened, the whole biography, in the card it came out of.
 *
 * Every father is shown rather than a fixed first three. The list is small and
 * finite — a bishop and the parish priests — and truncating it would mean the
 * homepage silently dropping a father the moment a fourth is appointed.
 */
function Clergy({ band, clergy }: { band: string; clergy: DocOf<ContentPage>[] }) {
  return (
    // `id`, because the footer links here now that the page is gone. The
    // stylesheet's `scroll-padding-top` keeps the heading clear of the sticky
    // masthead when someone arrives on `/#clergy`.
    <section id="clergy" className={band} aria-labelledby="clergy-heading">
      <div className="wrap reveal">
        <SectionHeading
          id="clergy-heading"
          eyebrow="Our fathers"
          title="The clergy of the parish"
          note="Who serves the Liturgy, and who to ask for when you need a priest."
        />
        <ul className="clergy reveal-stagger">
          {clergy.map((page) => (
            <Cleric key={page.id} page={page} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Cleric({ page }: { page: DocOf<ContentPage> }) {
  /*
   * Two sources, in this order.
   *
   * `person.portraitPath` is a Firebase Storage object staff can replace from
   * the console without a deploy, so it wins wherever it is set. It is null for
   * all three fathers today, and the fallback is the copy the build put in
   * `public/img/clergy/` — see features/content/portraits.ts. If neither has a
   * photograph, the row carries the parish's cross instead of an empty frame:
   * a grey rectangle where a face should be reads as a broken image.
   */
  const uploaded = storageUrl(page.person?.portraitPath);
  const bundled = uploaded ? null : bundledPortrait(page.slug);
  const name = page.person?.name ?? page.title;

  return (
    <li>
      {/*
        Deliberately no `name` attribute, which would make the three of them an
        exclusive accordion. Side by side they read as three separate cards
        rather than as one list, and closing a neighbour the visitor did not
        touch — in a different column, possibly off to the side of where they
        are looking — reads as a glitch rather than as tidying up.

        `id` on the details, not the heading: a fragment link that lands on a
        closed `<details>` is opened by the browser, which is what makes an old
        `/clergy#fr-armia-tawfik`-shaped link still arrive somewhere useful.
      */}
      <details className="cleric" id={page.slug}>
        <summary className="cleric__summary">
          {uploaded || bundled ? (
            <img
              className="cleric__portrait"
              // Empty, not "portrait of…": this sits directly above the name,
              // and a screen reader announcing the image would say it twice.
              alt=""
              src={uploaded ?? bundled!.src}
              {...(bundled
                ? {
                    srcSet: bundled.srcSet,
                    /*
                     * These have to track the layout in globals.css, in the
                     * same order the media queries resolve: a thumbnail beside
                     * the name on a phone, one card of a three-track grid at
                     * desk width, and roughly half the viewport in between.
                     * Overstating the phone case is what makes a 5.5rem
                     * thumbnail download the 800px file.
                     */
                    sizes: '(max-width: 34rem) 5.5rem, (min-width: 62rem) 22rem, 45vw',
                  }
                : {})}
              width={bundled?.width ?? 800}
              height={bundled?.height ?? 1000}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="cleric__mark" aria-hidden="true">
              <CopticCross size={22} />
            </span>
          )}

          <span className="cleric__line">
            <span className="cleric__id">
              {page.person?.rank && <span className="meta">{page.person.rank}</span>}
              {/* An `h3` inside the summary, so the section still has an outline
                  a screen-reader user can navigate by heading — the disclosure
                  widget is how it opens, not what it is. */}
              <h3>{name}</h3>
            </span>

            <Icon name="chevron" size={20} className="cleric__chevron" />
          </span>
        </summary>

        <div className="cleric__bio">
          <Prose>{page.body}</Prose>
        </div>
      </details>
    </li>
  );
}

/**
 * The Liturgy, live, on the page rather than one click away.
 *
 * The same `LivestreamPlayer` the `/livestream` route uses, so the embed logic
 * — which differs per platform, and is the part that breaks when the parish
 * changes provider — has one implementation. What the homepage adds is the
 * heading around it and the decision not to render at all when no stream is
 * configured.
 *
 * `loading="lazy"` inside the player matters more here than on `/livestream`:
 * this is the busiest page on the site and the frame is a third-party script.
 */
function Livestream({
  band,
  config,
}: {
  band: string;
  config: Awaited<ReturnType<typeof getIntegrationsConfig>>['livestream'];
}) {
  return (
    <section id="livestream" className={band} aria-labelledby="livestream-heading">
      <div className="wrap reveal">
        <SectionHeading
          id="livestream-heading"
          eyebrow="Live"
          title="Watch the Liturgy"
          note="For those who cannot be with us in person — the sick, the homebound, and those travelling."
        />
        <LivestreamPlayer config={config} />
      </div>
    </section>
  );
}

/**
 * The offering, last on the page.
 *
 * Quiet on purpose, and on the sunken ground rather than the dark one. The
 * closing band above it is the invitation; putting the ask in the page's most
 * emphatic slot, straight after "come and pray with us", turns the invitation
 * into a preamble for it.
 *
 * A link out rather than a form. The giving flow is a Tithe.ly-hosted page and
 * this site never touches a card number — see features/giving.
 */
function Giving({ band }: { band: string }) {
  const url = givingUrl();

  return (
    <section id="giving" className={band} aria-labelledby="giving-heading">
      <div className="wrap reveal">
        <SectionHeading
          id="giving-heading"
          eyebrow="Offering"
          title="Supporting the parish"
          note="What is offered here sustains the church, its services, and the poor."
        />

        <div className="hero__actions">
          {/*
            The direct link when there is one, because a visitor who has decided
            to give should not be routed through a page whose job is to tell
            them where to go. `/giving` then follows as the quieter second
            action, for anyone who wants to read first.

            With no URL configured there is only one destination worth offering,
            and two buttons pointing at the same page is a choice that isn't one.
          */}
          {url ? (
            <>
              <a className="button" href={url} rel="noopener noreferrer" target="_blank">
                Give online
              </a>
              <Link className="button button--ghost" href="/giving">
                About giving
              </Link>
            </>
          ) : (
            <Link className="button" href="/giving">
              How to give
            </Link>
          )}
        </div>

        {url && (
          <p className="meta" style={{ marginTop: 'var(--space-md)' }}>
            Opens Tithe.ly, which processes the payment. The parish website never sees
            your card details.
          </p>
        )}
      </div>
    </section>
  );
}

/** Closing invitation, on the dark ground so the page ends deliberately. */
function NewHere() {
  return (
    <section className="band band--deep" aria-labelledby="new-here-heading">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <Ornament />
        <h2 id="new-here-heading">Come and see</h2>
        <p className="lede" style={{ margin: '0 auto', maxWidth: '46ch' }}>
          You need not know the hymns, nor the language, nor when to stand. Come and
          pray with us, and someone will gladly stand beside you.
        </p>
        <div
          className="hero__actions hero__actions--center"
          style={{ marginTop: 'var(--space-lg)' }}
        >
          {/* Both buttons here pointed at NFC-only routes — `/welcome` and
              `/prayer`. What remains of the invitation is the practical part:
              when the Liturgy is served, and what the Church confesses. */}
          <Link className="button" href="/contact">
            Times of prayer
          </Link>
          <Link className="button button--ghost" href="/beliefs">
            What we believe
          </Link>
        </div>
      </div>
    </section>
  );
}
