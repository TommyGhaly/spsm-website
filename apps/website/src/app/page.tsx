import Link from 'next/link';
import { formatAddress, type ContentPage, type DocOf } from '@spsm/shared';
import { BookshelfPreview, getProducts, toShopProducts } from '@/features/bookstore';
import { getCurrentBulletin, BulletinWeek } from '@/features/bulletin';
import { bundledPortrait, getContentPages } from '@/features/content';
import { givingUrl } from '@/features/giving';
import { LivestreamPlayer, ShowWhenLive, livestreamProbeUrl } from '@/features/livestream';
import { getIntegrationsConfig, getParishConfig } from '@/lib/config';
import { storageUrl } from '@/lib/storage';
import { Icon, type IconName } from '@/components/Icon';
import { Prose } from '@/components/Prose';
import { SectionHeading } from '@/components/SectionHeading';

export default async function HomePage() {
  // Independent reads — no reason to make the build wait on them in sequence.
  // The bulletin is the exception: it needs the config document first, since
  // that says which project and collection to read.
  const [config, parish, clergy, products] = await Promise.all([
    getIntegrationsConfig(),
    getParishConfig(),
    getContentPages('clergy'),
    getProducts(),
  ]);
  const bulletin = await getCurrentBulletin(config.announcements);

  // See `alternatingBands`. The first band under the hero is sunken.
  const band = alternatingBands();

  return (
    <>
      <Hero />

      <QuickFacts
        band={`${band()} band--slim`}
        parish={parish}
        livestreamEnabled={config.livestream.enabled}
      />


      {/* The player itself, not a link to it — someone at home on a Sunday
          morning should not have to navigate to watch. Only when a stream is
          actually configured: `LivestreamPlayer` renders an honest "not set up"
          notice when it is not, which belongs on `/livestream` and would read
          as a fault on the homepage.

          Note it takes a fixed `band--deep` rather than a turn of `band()`,
          and that is load-bearing. This section removes itself at *view* time
          when nothing is being streamed (see `Livestream`), but `band()`
          alternates at *build* time — so consuming a turn here would leave the
          two sections either side of it with the same tint on every one of the
          many hours the stream is off. A ground that is neither of the two
          alternating tints sits correctly next to both, whether this section is
          in the page or not, and a dark frame suits a video besides. */}
      {config.livestream.enabled && (
        <Livestream band="band band--deep" config={config.livestream} />
      )}

      {/* The bookstore, between the stream and the week ahead.
          
          Here because of who is on this page: someone checking whether there is
          a Liturgy this Saturday, who has no idea the parish sells books at
          all. Below the stream so it never competes with a service in progress,
          and above the week's sheet because the sheet is the errand most people
          came for and the page should not interrupt it.

          Takes a turn of `band()` like the other conditional sections — see
          `alternatingBands`. It removes itself when the catalog is empty, and a
          section that does not render must not consume a turn. */}
      {products.length > 0 && (
        <section
          className={`${band()} band--tight-end`}
          aria-labelledby="bookstore-heading"
        >
          <div className="wrap reveal">
            <SectionHeading
              id="bookstore-heading"
              eyebrow="From the bookstore"
              title="Books for the year"
              note="Collect at the church, or have them posted."
            />
            <BookshelfPreview products={toShopProducts(products)} />
          </div>
        </section>
      )}

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

      {/* The fathers, directly above the offering. Absent entirely when no
          clergy page is published, rather than an empty band with a heading
          over nothing.

          Not dealt a band: this is the page's one accent ground, and it is safe
          to pin precisely because the alternation around it is paper/sunken.
          Tinted differs from both, so whichever of the conditional sections
          above happens to precede it, the boundary still reads. */}
      {clergy.length > 0 && <Clergy clergy={clergy} />}

      {/* Not dealt a band: the offering is the deep one, which is the end of
          the page rather than another turn in the alternation. It reads as
          deliberate wherever the conditional sections above leave it. */}
      <Giving />
    </>
  );
}

/**
 * Deals out the `band` classes in render order, alternating paper and sunken.
 *
 * The alternation is what stops a long page reading as one column of beige, and
 * three of the four sections it runs through — the livestream, the bulletin and
 * the clergy — are conditional. Written by hand, the classes would be correct
 * only for the case where all three are present: switch the bulletin off in
 * `config/integrations`, publish no clergy page, or configure no stream, and two
 * matching bands run together with the boundary between two unrelated sections
 * invisible.
 *
 * **The alternate ground is `band--sunken`, and it is meant to be barely
 * visible.** This briefly alternated with the much stronger `band--tinted`, on
 * the reasoning that sunken paper is only about 4% darker than paper and so the
 * alternation never really landed. It landed: the page came out striped, one
 * saturated band per section down its whole length. A background rhythm is
 * supposed to be felt rather than counted, and the gold hairline along each
 * sunken band is already doing most of the separating.
 *
 * The one section that keeps a colour of its own is the clergy — see `Clergy`.
 * One accent band among neutral ones reads as emphasis; five read as stripes.
 *
 * Dealing them out is correct because JSX evaluates its children in source
 * order and short-circuits the conditional ones, so a section that does not
 * render never takes a turn. The consequence to know: these calls must stay in
 * the same order as the sections themselves.
 *
 * The offering's `band--deep` is not part of this and does not take a turn. It
 * is the end of the page rather than another alternation, and it reads as
 * deliberate wherever the conditional sections above leave it.
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
 * Three photographs, cross-fading behind the parish's name.
 *
 * ---------------------------------------------------------------------------
 * The provenance rule this markup enforces.
 *
 * Only the first frame is this parish. `HomeScreen.png` — the iconostasis at
 * Wayland, the four living creatures above it, a priest at the altar — is the
 * one photograph in `assets/` that is verifiably ours, and it is the one frame
 * here that carries `alt` text naming the church.
 *
 * The other two are the Egyptian/Gulf backdrops. `assets/README.md` is explicit
 * that they are **not this building** and must not be captioned or described as
 * it, so they are `alt=""` and `aria-hidden`: decorative texture in a moving
 * collage, asserting nothing. To a screen reader this hero is one photograph of
 * one sanctuary, which is the only claim this repo can stand behind.
 *
 * Their licence is also still unverified. If they came off the old Wix site,
 * that licence does not travel here. The fix is real photography of the Wayland
 * building, not re-labelling these — see the README.
 * ---------------------------------------------------------------------------
 *
 * The seal is deliberately gone from the hero. It is in the masthead directly
 * above, and against photography this detailed a second detailed mark is two
 * things competing for the same attention.
 */
function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      {/*
        One wrapper around all three frames, because the drift and the parallax
        belong to the *frame* rather than to any one photograph. Animating them
        here leaves each `.hero__frame` free to own its opacity, and animations
        writing different properties on different elements cannot clobber one
        another — the trap the existing breathe/parallax pair already documents.
      */}
      <div className="hero__frames">
        {/*
          Frame one, and the only one with a name.

          `<picture>`, because this is art direction rather than resolution
          switching. The landscape frame is 2.6:1 and a phone hero is about
          0.6:1, so `object-fit: cover` would discard three quarters of the
          width and leave only the red curtain behind the altar — no icons, no
          altar, just a smear. The 3:4 source below 40rem is cropped around the
          altar instead.

          `fetchPriority="high"` and no lazy loading: this is the largest
          element above the fold on the site's most-visited page, so it is the
          Largest Contentful Paint. Deferring it is deferring the page. The two
          frames after it are the opposite case — not visible for the first
          eight seconds — and are lazy.

          One `alt` for both sources, on the `img`: they are the same photograph
          of the same room, and `<source>` carries no alt of its own.

          **All three frames now use the same two crops**, cut in
          `scripts/optimize-assets.mjs` rather than steered from CSS. Before
          that, each frame was its source image's native shape — the towers shot
          is 1.52:1 against this one's 2.59:1 — so `object-fit` cropped 40% off
          its height and took the crosses with it, and the subject jumped on
          every fade. Matched geometry is what makes this read as one camera.
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
            className="hero__frame hero__frame--1"
            src="/img/home-sanctuary-1600.webp"
            srcSet="/img/home-sanctuary-1000.webp 1000w, /img/home-sanctuary-1600.webp 1600w, /img/home-sanctuary-2400.webp 2400w"
            sizes="100vw"
            alt="The sanctuary at St. Philopater Mercurius & St. Mina: the iconostasis, its icons of Christ and the Theotokos, and a priest serving at the altar."
            /* 926, not the 1104 this said before. The file is 2400×926; a wrong
               ratio here reserves the wrong box and the page jumps on load. */
            width={2400}
            height={926}
            fetchPriority="high"
            decoding="async"
          />
        </picture>

        {/* Frames two and three: decorative, per the provenance note above.
            Neither is this building, so neither says anything about itself.
            Both get the same portrait art direction as frame one — a phone is
            the case where a wrong crop is most obvious, not least. */}
        <picture>
          <source
            media="(max-width: 40rem)"
            srcSet="/img/hero-domes-portrait-600.webp 600w, /img/hero-domes-portrait-900.webp 900w"
            sizes="100vw"
          />
          <img
            className="hero__frame hero__frame--2"
            src="/img/hero-domes-1600.webp"
            srcSet="/img/hero-domes-1000.webp 1000w, /img/hero-domes-1600.webp 1600w"
            sizes="100vw"
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
          />
        </picture>
        <picture>
          <source
            media="(max-width: 40rem)"
            srcSet="/img/hero-towers-portrait-600.webp 600w, /img/hero-towers-portrait-900.webp 900w"
            sizes="100vw"
          />
          <img
            className="hero__frame hero__frame--3"
            src="/img/hero-towers-1600.webp"
            srcSet="/img/hero-towers-1000.webp 1000w, /img/hero-towers-1600.webp 1600w"
            sizes="100vw"
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
          />
        </picture>
      </div>

      <div className="hero__veil" />

      <div className="wrap hero__inner">
        <p className="hero__eyebrow">Coptic Orthodox Church · Wayland, Massachusetts</p>

        <h1 id="hero-heading">St. Philopater Mercurius &amp; St. Mina</h1>

        {/* The gold rule draws itself in under the name. With the three buttons
            gone, this is what keeps the hero from ending on a paragraph. */}
        <span className="hero__rule" aria-hidden="true" />

        <p className="hero__lede">
          Here the Divine Liturgy is offered as the Church has offered it since the
          Apostles. Whoever you are, you are welcome to come and pray with us.
        </p>
      </div>

      {/*
        A quiet cue that the page continues, in place of the buttons. It is not
        a control — everything it could have pointed at is one scroll or one nav
        item away — so it is hidden from the accessibility tree rather than
        announced as a link that isn't there.
      */}
      <span className="hero__scroll" aria-hidden="true" />
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
          // `/livestream`, not the `#livestream` anchor this used to be. The
          // in-page jump saved a navigation but landed the reader in the middle
          // of the homepage with no page change to confirm the link had done
          // anything — and the destination page carries the schedule note and
          // the fallback link that the embedded player on the homepage does not.
          body: <Link href="/livestream">Watch the Liturgy live →</Link>,
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
                {/* 18px, beside the text rather than over it. This went 20 → 26
                    when the filled disc came off, on the reasoning that a bare
                    glyph has no plate to give it presence — but presence is
                    what this row is not supposed to have. */}
                <Icon name={fact.icon} size={18} />
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
function Clergy({ clergy }: { clergy: DocOf<ContentPage>[] }) {
  return (
    // `id`, because the footer links here now that the page is gone. The
    // stylesheet's `scroll-padding-top` keeps the heading clear of the sticky
    // masthead when someone arrives on `/#clergy`.
    <section id="clergy" className="band band--tinted" aria-labelledby="clergy-heading">
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
              {/* The father's initial, not an ornament. A mark that stands for
                  "no photograph yet" should still say which person it is. */}
              {page.title.trim().charAt(0).toUpperCase()}
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
  /*
   * The whole section disappears when nothing is being streamed, rather than
   * standing there with a notice in place of the player.
   *
   * That is the opposite of what `/livestream` does, deliberately. This is the
   * page most visitors see first, and a "Watch the Liturgy" heading with no
   * liturgy behind it advertises something that is not there. `/livestream` is
   * a page *about* watching, so it owes an answer either way; the homepage owes
   * none, and the stream is off far more hours of the week than it is on.
   *
   * `probe={false}` on the player because `ShowWhenLive` has already asked —
   * see that component and the prop's note.
   */
  return (
    <ShowWhenLive probeUrl={livestreamProbeUrl(config)}>
      <section id="livestream" className={band} aria-labelledby="livestream-heading">
        <div className="wrap reveal">
          <SectionHeading
            id="livestream-heading"
            eyebrow="Live"
            title="Watch the Liturgy"
            note="For those who cannot be with us in person — the sick, the homebound, and those travelling."
          />
          <LivestreamPlayer config={config} probe={false} />
        </div>
      </section>
    </ShowWhenLive>
  );
}

/**
 * The offering, last on the page — and now the page's one full-colour band.
 *
 * ---------------------------------------------------------------------------
 * It used to be a heading and two buttons on the same paper as everything above
 * it, which made the one section with something to ask the least memorable
 * thing on the page. It is now a full-bleed photograph with the deep ground
 * carried over it as a veil.
 *
 * The photograph is `Donation.png`, at Tommy's direction, and its being the
 * *background* rather than a panel is his too. `assets/README.md` records it as
 * generic stock of unverified provenance — that is the open item on it, and not
 * a thing to quietly swap back.
 *
 * What the markup adds is the verse as **text**: 2 Corinthians 9:7, the one the
 * pipeline crops off `Coptic_Church_Verse.jpg` precisely so it can be set in
 * HTML instead of baked into pixels. See the README's note on that crop.
 * ---------------------------------------------------------------------------
 *
 * A link out rather than a form. The giving flow is a Tithe.ly-hosted page and
 * this site never touches a card number — see features/giving.
 */
function Giving() {
  const url = givingUrl();

  return (
    <section id="giving" className="band band--deep giving" aria-labelledby="giving-heading">
      {/*
        The photograph is the section's ground now rather than a framed panel
        beside the text.

        An `<img>` rather than a CSS `background-image`, for the reason the hero
        uses one: `srcSet`/`sizes` let the browser pick a width, and a 1600px
        file behind a phone-width band is most of a megabyte spent on
        decoration. `aria-hidden` and empty `alt` because it is exactly that.
      */}
      <img
        className="giving__photo"
        src="/img/backdrop-giving-1600.webp"
        srcSet="/img/backdrop-giving-800.webp 800w, /img/backdrop-giving-1600.webp 1600w"
        sizes="100vw"
        alt=""
        aria-hidden="true"
        width={1600}
        height={1030}
        loading="lazy"
        decoding="async"
      />
      {/*
        The veil is not optional decoration here — it is what keeps the heading,
        the note and the button readable over a photograph whose right half is a
        blown-out sunrise. See `.giving__veil`.
      */}
      <div className="giving__veil" />

      <div className="wrap giving__inner reveal">
        <div className="giving__body">
          <SectionHeading
            id="giving-heading"
            eyebrow="Offering"
            title="Supporting the parish"
            note="What is offered here sustains the church, its services, and the poor."
          />

          <div className="hero__actions">
            {/*
              The direct link when there is one, because a visitor who has
              decided to give should not be routed through a page whose job is
              to tell them where to go. `/giving` then follows as the quieter
              second action, for anyone who wants to read first.

              With no URL configured there is only one destination worth
              offering, and two buttons at the same page is a choice that isn't.
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
            <p className="meta giving__note">
              Opens Tithe.ly, which processes the payment. The parish website never
              sees your card details.
            </p>
          )}

          {/*
            The verse, as text.

            This is the one typeset across the top of `Coptic_Church_Verse.jpg`
            and cropped out by the asset pipeline — `assets/README.md` says so,
            and says that if the giving page wants it, it goes in the markup. It
            does, so here it is: selectable, translatable, and legible to a
            screen reader, which text baked into a JPEG is none of.

            It moved out of the old `<figcaption>` when the photograph became
            the background: a caption belongs to a figure, and there is no
            longer a figure for it to belong to.
          */}
          <p className="giving__verse">
            “God loves a cheerful giver.”
            <cite>2 Corinthians 9:7</cite>
          </p>
        </div>
      </div>
    </section>
  );
}
