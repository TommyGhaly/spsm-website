import Link from 'next/link';
import { formatAddress, type ContentPage, type DocOf } from '@spsm/shared';
import { BookshelfPreview, getProducts, toShopProducts } from '@/features/bookstore';
import { ActivitiesPreview } from '@/features/programs';
import { getCurrentBulletin, BulletinLive, todayInParish } from '@/features/bulletin';
import { DEACONS, bundledPortrait, clericInitial, getContentPages } from '@/features/content';
import { GiveButton } from '@/features/giving';
import { LivestreamPlayer, ShowWhenLive, livestreamProbe } from '@/features/livestream';
import { getIntegrationsConfig, getParishConfig } from '@/lib/config';
import { storageUrl } from '@/lib/storage';
import { DragRail } from '@/components/DragRail';
import { Icon, type IconName } from '@/components/Icon';
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

      {/* A short word of welcome, directly under the three facts. Takes a turn
          of `band()` like every other unconditional section — see
          `alternatingBands`. */}
      <Welcome band={band()} />

      {/* The ministries, directly under the welcome and above everything the
          parish *does for* a visitor — the stream, the sheet, the shop.

          Asked for directly, and the ordering is the point of it. The welcome
          says who the parish is in three sentences; this says it in five
          photographs, which is the better answer to the same question. It is a
          preview of `/events` rather than a second copy of it: smaller plates,
          no editing, and a link out at the foot. See `ActivitiesPreview`.

          Takes a turn of `band()` like every other section — see
          `alternatingBands`. **The turn is consumed even in the one case where
          the section renders nothing**, which is the trade `band` being a prop
          buys: the tint is dealt on the server, so a client-side read that comes
          back empty cannot change the colour of the page under a reader. The
          cost is two matching bands running together on a parish that publishes
          no ministries at all, which is not a state this parish is in.

          `band--tight-end`, at Tommy's direction, for the same reason the
          bookstore carries it: the full `--space-section` under this section and
          again over the schedule put two sections' worth of air into one seam.
          The rail also brings its own — `.rail--programs .rail` pads its block
          axis to make room for the plates standing off the page — so the gap
          here was the widest on the homepage. See `.rail--activities` in
          globals.css for the rest of it. */}
      <ActivitiesPreview band={`${band()} band--tight-end`} />

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

      {/* The parish's own weekly sheet — whichever bulletin the announcements
          app has made active. Absent if the source is empty or the section is
          switched off in config/integrations.

          The week read at build time is the first paint, not the last word:
          `BulletinLive` re-reads the source in the browser, so making a
          different bulletin active reaches this page without a deploy. The
          section and its band stay out here, so the alternation is still dealt
          out at build time and nothing arrives late to move the page.

          `band--tight-start`, at Tommy's direction: the activities above stop
          close under their own last line and this starts close over its heading,
          which are the two halves of one seam. Safe here because the ground
          changes colour across it — see the note on the modifier. */}
      {bulletin && (
        <section
          className={`${band()} band--tight-start`}
          aria-labelledby="bulletin-heading"
        >
          <div className="wrap reveal">
            <BulletinLive initial={bulletin} today={todayInParish()} />
          </div>
        </section>
      )}

      {/* The bookstore, under the week's sheet.

          Here because of who is on this page: someone checking whether there is
          a Liturgy this Saturday, who has no idea the parish sells books at
          all. Below the stream so it never competes with a service in progress.

          **It was above the sheet, and it moved below it at Tommy's direction.**
          The old note argued the sheet is the errand most people came for and
          the page should not interrupt it — which is the argument for putting
          the shop *after* the sheet, not before. What it got wrong is how
          reading works: a section above the thing you came for interrupts it by
          definition, and a shelf of covers between the stream and the schedule
          was a page saying "buy something" on the way to a service time. After
          the sheet, the errand is done and the shelf is an offer rather than an
          obstacle.

          Takes a turn of `band()` like the other conditional sections — see
          `alternatingBands`. It removes itself when the catalog is empty, and a
          section that does not render must not consume a turn. */}
      {products.length > 0 && (
        <section
          className={`${band()} band--tight-end`}
          aria-labelledby="bookstore-heading"
        >
          <div className="wrap reveal">
            {/*
              "Books for the year" was the title here, and it was wrong twice
              over: it promised an annual selection, which this is not — it is
              simply what the bookstore stocks — and "for the year" is a
              publisher's phrase rather than the Church's.

              **The replacement names the shop rather than its contents, at
              Tommy's direction, because the contents are going to widen.** The
              catalog is eleven books today; icons and church goods are coming,
              and a heading that says "books" or "reading" would have to be
              edited again the day the first icon is listed. "From our
              bookstore" is true of anything the shop ever carries.

              **No eyebrow, and that is the trade.** Every other section here
              opens with a gold eyebrow over its `h2`, but the only honest
              eyebrow for this one was "From the bookstore" — which is now the
              title. A label repeating the heading beneath it is worse than an
              absent label, and the shelf's own gold plank keeps the section
              from reading thin without it. If a real second line ever exists
              (a category, a season), it goes back in.
            */}
            <SectionHeading
              id="bookstore-heading"
              title="From our bookstore"
              note="Collect at the church, or have them delivered."
            />
            <BookshelfPreview products={toShopProducts(products)} />
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
 * **This was four frames, and going back to three is the fix, not a trim.**
 *
 * The two that came out were the two that made it look like a broken carousel
 * rather than a slideshow:
 *
 *   - **The cross on the dome** was a 381×524 source stretched across a hero
 *     1458px wide on a laptop, cropped to a 147px strip that held the crossbar
 *     and nothing else, with `blur(2.5px)` over it so the upscale read as soft
 *     focus instead of as a broken image. It is now only in the welcome
 *     section — and not even as that photograph. See `Welcome`.
 *   - **The domes** were cream masonry against pale sky shot from below, which
 *     is also a fair description of the towers frame that followed it. Two
 *     different buildings that at hero size, under the veil, read as the same
 *     picture coming round again. That frame is now cut from the *same file* but
 *     from the one part of it that looks like nothing else here: the arched
 *     stained glass, deep blue, with a gold cross across it. See the note in
 *     `scripts/optimize-assets.mjs`.
 *
 * What is left is three pictures that are plainly three pictures: a sanctuary
 * interior, blue glass, a sandstone façade against sky.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * The provenance rule this markup enforces.
 *
 * Only the first frame is this parish. `HomeScreen.png` — the iconostasis at
 * Wayland, the four living creatures above it, a priest at the altar — is the
 * one photograph in `assets/` that is verifiably ours, and it is the one frame
 * here that carries `alt` text naming the church.
 *
 * The other two are the Egyptian/Gulf backdrops, and `assets/README.md` is
 * explicit that they are **not this building** and must not be captioned or
 * described as it. Both are therefore `alt=""` and `aria-hidden`: to a screen
 * reader this hero remains one photograph of one sanctuary, which is the only
 * claim this repo can stand behind.
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
            the case where a wrong crop is most obvious, not least.

            Frame two is the stained glass. Its portrait pair tops out at 800
            rather than the 900 the other two carry, and that is a real ceiling
            rather than a rounding: 865×1154 is the largest 3:4 box that fits
            below the verse text in the source, so 900 would be a file named
            for a width it does not have. */}
        <picture>
          <source
            media="(max-width: 40rem)"
            srcSet="/img/hero-glass-portrait-600.webp 600w, /img/hero-glass-portrait-800.webp 800w"
            sizes="100vw"
          />
          <img
            className="hero__frame hero__frame--2"
            src="/img/hero-glass-1600.webp"
            srcSet="/img/hero-glass-1000.webp 1000w, /img/hero-glass-1600.webp 1600w"
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
        <Link href="/contact">Ask the church office →</Link>
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
          body: <Link href="/about">About our church →</Link>,
        },
  ];

  return (
    <section className={band} aria-labelledby="facts-heading">
      <div className="wrap">
        {/* The section needs a name for landmark navigation, but a visible
            heading over three self-explanatory tiles is clutter. */}
        <h2 id="facts-heading" className="visually-hidden">
          Visiting the church
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
 * A word of welcome, directly under the three facts.
 *
 * The hero already says one sentence of this and cannot say more — it is a
 * heading over a photograph, and anything longer than a line and a half stops
 * being a lede and starts being a paragraph nobody reads over an image. This is
 * where the rest of it goes: two short paragraphs beside the Coptic cross.
 *
 * Short is load-bearing. The cross is a 13rem column and the band is one row
 * of a long page; anything longer than this stops being a greeting.
 *
 * ---------------------------------------------------------------------------
 * On the wording, which is most of this section.
 *
 * The first draft was rejected for reading Protestant, and it is worth being
 * precise about what that meant, because the failing is easy to write again.
 * It was built out of the evangelical invitation formula — "whether you have
 * been Orthodox all your life, or have never been inside a Coptic church" — a
 * construction whose whole job is to close the distance between the reader and
 * a decision they are being asked to make. It was selling a visit.
 *
 * What is here instead says what the parish *is* and then what is not required
 * of anybody. Two rules for editing it:
 *
 *   - **State, do not invite.** "The Divine Liturgy is the heart of our week"
 *     is a fact about the Church. "Come and experience the Liturgy" is an
 *     advertisement, and the Church is not one.
 *   - **Do not talk about expectations at all.** Two later drafts tried to be
 *     kind by subtracting — "nothing is asked of you", "stand or sit as you are
 *     able", "there is nothing you need to know beforehand" — and Tommy cut all
 *     of it. Reassurance raises the question it answers: a reader who was not
 *     wondering whether they would be expected to perform is now wondering it.
 *     Say hello and say what the parish is; leave the rules unmentioned.
 *
 * The register is friendly and short, and that too was Tommy's call — the
 * earlier drafts were stiff in a specific way ("This is a Coptic Orthodox
 * parish", "one of the fathers will be glad to speak with you"), the register
 * of a printed notice rather than of somebody talking to you.
 *
 * The test to apply to any edit: would a father read this aloud without
 * wincing? Nothing here should sound like it came from a brochure — and
 * nothing should sound like it was read off a laminated sign either.
 * ---------------------------------------------------------------------------
 *
 * Hardcoded rather than read from the `content` collection. It is three
 * sentences of chrome that should be on the page whether or not a Firestore
 * read succeeds, and the section it would live in — `welcome` — is the NFC
 * landing page's, which is a different audience answering different questions.
 */
function Welcome({ band }: { band: string }) {
  return (
    <section className={band} aria-labelledby="welcome-heading">
      <div className="wrap reveal">
        <SectionHeading id="welcome-heading" eyebrow="Our church" title="A word of welcome" />

        <div className="welcome">
          {/*
            The Coptic cross, beside the words.

            **This was a photograph of a cross on a dome, and it is now the
            cross itself** — `assets/coptic_cross_image.png`, at Tommy's
            direction. Both were the right *subject* for this section, for a
            reason worth keeping: a cross asserts nothing about which building
            it stands on, so the provenance rule the hero enforces — only
            `HomeScreen.png` may be presented as this parish — has nothing to
            bite on here.

            The mark is the better version of that. It is inscribed
            Ⲓⲏⲥ Ⲡⲭⲥ / Ⲡ̀ϣⲏⲣⲓ ⲙ̀Ⲫϯ — "Jesus Christ, the Son of God" — which is the
            Church saying something rather than a stock detail shot standing in
            for one. And it is the size it is drawn at: 360×360 in a 13rem
            (208px) column, where the photograph it replaced was a 381px file
            that the hero was also stretching four-fold.

            Its white ground is keyed to alpha in the pipeline, so it sits *on*
            the band's paper rather than on a white card. That is why the CSS
            carries no border radius and no shadow — see `.welcome__photo`.

            Real `alt` text rather than `aria-hidden`. The hero's decorative
            frames are hidden because describing them would either make a false
            claim or add nothing; here the picture is the section's one image
            and a reader who cannot see it should still know what is beside the
            words — including what it says, which is the part that matters.
          */}
          <img
            className="welcome__photo"
            src="/img/cross-coptic-360.webp"
            alt='A Coptic cross, its four arms filled with gold and blue interlace and inscribed in Coptic: "Jesus Christ, the Son of God".'
            /* The source is 360×360 and the pipeline does not upscale, so these
               are the file's real dimensions. Stating them reserves the box
               before it lands, so the paragraphs beside it do not jump. */
            width={360}
            height={360}
            /* Never above the fold — the hero is — so this is the lazy case,
               unlike `hero__frame--1`. */
            loading="lazy"
            decoding="async"
          />

          <div className="welcome__words">
            <p>
              We are glad you found us. This is a Coptic Orthodox church in Wayland, and
              the Divine Liturgy is the heart of our week — the feasts and the fasts,
              Sunday school, the prayers said for the sick all grow out of it.
            </p>
            <p>
              Sunday morning is the best time to find us, and the fathers are always
              happy to say hello.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The fathers who serve the parish: a face, a name, and a rank. Nothing else.
 *
 * ---------------------------------------------------------------------------
 * This was a row of disclosures carrying the full biographies, and the
 * biographies have come off the homepage at Tommy's direction — the section
 * answers "who serves here", which is a question with a three-word answer, and
 * the paragraph behind each name was the homepage doing a second page's job.
 *
 * **The biographies are not deleted.** They are still `body` on each published
 * `content/clergy` page, still edited the same way, still fetched by the
 * `getContentPages('clergy')` call this section is handed — this component
 * simply does not render them. Whatever gets built to show them next reads the
 * same field and needs no migration.
 *
 * What that means for now: nothing on the site displays a father's biography.
 * That is the intended state, not an oversight. `/clergy` is still excluded in
 * `[section]/page.tsx`, and the footer's "Our clergy" still points at
 * `/#clergy`, which is this — a name and a rank is a complete answer to what
 * that link promises.
 * ---------------------------------------------------------------------------
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
          eyebrow="Serving here"
          title="Our clergy"
          note="Who to look for on a Sunday morning."
        />
        {/* A face with the name beside it, not under it. The portraits are up
            to 11rem — large enough that a visitor can recognise a father from
            the row afterwards, which is the only thing this section is for —
            and setting the caption alongside is what pays for that without the
            section taking another 3rem of the page for each of them.

            A rail, the same one the ministries and the shelf use. Three fathers
            fit a laptop, so on one it is simply a row and nothing moves —
            `DragRail` measures before it animates anything. It earns its keep
            narrower than that, where the row used to become a column three
            portraits tall.

            `reveal-stagger` came off when it did. That rule animates on a
            `view()` timeline, which resolves against the nearest scroll
            container — and inside the rail that is the rail, which never scrolls
            vertically, so the fathers would have sat at the start of their
            reveal permanently. The `.reveal` on the wrap above still brings the
            whole section in. */}
        <DragRail className="rail--clergy">
          <ul className="clergy">
            {clergy.map((page) => (
              <Cleric key={page.id} page={page} />
            ))}
          </ul>
        </DragRail>

        {/*
          The deacons, on a second rail of their own.
          ------------------------------------------------------------------
          Two rows of three rather than one rail of six, which is how Tommy
          asked for it — "3 and 3 to keep it even". It is also the truthful
          shape: the split between the rows is the split between the ranks, and
          six in a row would have scrolled sideways on the laptop the first
          three fit exactly.

          No sub-heading over either rail. Every card already prints a rank
          under the name — Bishop, Priest, Deacon — so a "Deacons" label would
          be the page saying twice what the cards say once, and an `h3` there
          would sit at the same level as the names themselves.

          They come from `features/content/deacons.ts`, not from Firestore: a
          `content` document is a biography, and a deacon here has a name and a
          year. /about/who-we-are shows the same three from the same module.
        */}
        <DragRail className="rail--clergy">
          <ul className="clergy">
            {DEACONS.map((deacon) => (
              <ClericCard
                key={deacon.slug}
                slug={deacon.slug}
                name={deacon.name}
                rank={deacon.rank}
              />
            ))}
          </ul>
        </DragRail>
      </div>
    </section>
  );
}

/**
 * A father, from his `content` document.
 *
 * Nothing but the adapter now: it resolves the two portrait sources and hands
 * the card what it needs. `ClericCard` below draws it, and the deacons — who
 * have no `content` document — use that directly.
 *
 * `person.portraitPath` is a Firebase Storage object staff can replace from the
 * console without a deploy, so it wins wherever it is set. It is null for all
 * three fathers today, and the fallback is the copy the build put in
 * `public/img/clergy/` — see features/content/portraits.ts.
 */
function Cleric({ page }: { page: DocOf<ContentPage> }) {
  return (
    <ClericCard
      slug={page.slug}
      name={page.person?.name ?? page.title}
      rank={page.person?.rank}
      uploaded={storageUrl(page.person?.portraitPath)}
    />
  );
}

/**
 * One card: a face, a name, a rank.
 *
 * Takes plain strings rather than a `ContentPage`, because half the people it
 * draws are not in Firestore — see `features/content/deacons.ts`. That is the
 * whole reason this was split out of `Cleric`.
 */
function ClericCard({
  slug,
  name,
  rank,
  uploaded,
}: {
  slug: string;
  name: string;
  /* `| undefined` explicitly, not just `?`. `exactOptionalPropertyTypes` is on,
     so an optional property will not accept an explicit `undefined` — and
     `page.person?.rank` is exactly that. */
  rank?: string | undefined;
  /** A Storage URL, where staff have uploaded one. Never set for a deacon. */
  uploaded?: string | null | undefined;
}) {
  /*
   * The uploaded photograph wins; the file the build bundled is the fallback.
   * If there is neither — which is every deacon today — the card carries the
   * person's initial rather than an empty frame: a grey rectangle where a face
   * should be reads as a broken image, and the initial at least says who is
   * missing.
   */
  const bundled = uploaded ? null : bundledPortrait(slug);

  return (
    /*
     * `id` on the list item, where it used to be on the `<details>`.
     *
     * The card no longer opens, so the fragment no longer has to open it — but
     * an old `/clergy#fr-armia-tawfik`-shaped link should still scroll to the
     * right father rather than to the top of the section, and keeping the slug
     * as the anchor is all that takes. The stylesheet's `scroll-padding-top`
     * keeps it clear of the sticky masthead.
     */
    <li className="cleric" id={slug}>
      {uploaded || bundled ? (
        <img
          className="cleric__portrait"
          // Empty, not "portrait of…": this sits directly above the name, and a
          // screen reader announcing the image would say it twice.
          alt=""
          src={uploaded ?? bundled!.src}
          {...(bundled
            ? {
                srcSet: bundled.srcSet,
                /*
                 * These have to track the layout in globals.css, in the same
                 * order the media queries resolve: 7.5rem on a phone, and a
                 * fixed 11rem circle at every width above that. Both are still
                 * small enough that the 400px source covers them on a 2x screen
                 * — 11rem is 176px — which is the point of stating them at all:
                 * overstating the case is what makes a 176px portrait download
                 * the 800px file.
                 */
                sizes: '(max-width: 34rem) 7.5rem, 11rem',
              }
            : {})}
          width={bundled?.width ?? 800}
          height={bundled?.height ?? 1000}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="cleric__mark" aria-hidden="true">
          {/* The person's initial, not an ornament. A mark that stands for "no
              photograph yet" should still say which person it is — and the rank
              has to come off the front, or all three deacons show a D. Shared
              with /about/who-we-are, which lists the same six people and must
              not disagree about which letter stands for whom. */}
          {clericInitial(name)}
        </span>
      )}

      <div className="cleric__id">
        {/*
          An `h3`, so the section still has an outline a screen-reader user can
          navigate by heading. It was inside a `<summary>` before, which made it
          both the heading and the control; with nothing to open, it is only the
          heading, which is the simpler and more honest thing for it to be.
        */}
        <h3>{name}</h3>
        {rank && <p className="meta">{rank}</p>}
      </div>
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
   * `probe={false}` on the player because `ShowWhenLive` has already asked, and
   * hands its answer — including which video — down through context. See
   * `InheritedLiveState`.
   */
  return (
    <ShowWhenLive probe={livestreamProbe(config)}>
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
 * Still not a payment form of ours. `GiveButton` opens Tithe.ly's own hosted
 * form in an overlay over this page — the card number is typed into Tithe.ly's
 * origin, inside a frame this site cannot read across. See features/giving.
 */
function Giving() {
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
            title="Supporting the church"
            note="What is offered here sustains the church, its services, and the poor."
          />

          <div className="hero__actions">
            {/*
              The offering itself first, because a visitor who has already
              decided should not be routed through a page whose job is to tell
              them where to go — and now that the form opens in place, they are
              not routed anywhere at all. `/giving` follows as the quieter second
              action, for anyone who wants to read first.

              There is no "not configured" branch any more: the form id is
              committed rather than left to an empty `.env` line, so the give
              action exists on every build. See `features/giving/config.ts`.
            */}
            <GiveButton>Give online</GiveButton>
            <Link className="button button--ghost" href="/giving">
              About giving
            </Link>
          </div>

          <p className="meta giving__note">
            The form opens here on this page. Tithe.ly processes the payment; the
            church website never sees your card details.
          </p>

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
