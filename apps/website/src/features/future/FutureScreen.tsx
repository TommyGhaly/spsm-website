import Link from 'next/link';
import { MoreOfAbout } from '@/components/MoreOfAbout';
import { GiveButton } from '@/features/giving';
import { Figures } from './Figures';
import { Film } from './Film';
import { Gallery } from './Gallery';
import { Reveals } from './Reveals';
import {
  ByUse,
  Credit,
  Plate,
  Progress,
  Team,
  TeamMarksBand,
  WidePlate,
} from './parts';

/**
 * /about/future-plans, whole.
 *
 * ---------------------------------------------------------------------------
 * **A server component with four client leaves in it**, and the split is the
 * point: `Film`, `Gallery`, `Figures` and `GiveButton` are the only things here
 * that need a browser, and everything between them — nine bands of prose, ten
 * captioned plates, two schedules and a dated spine — is HTML with no
 * JavaScript attached to it at all. The page was entirely static until Tommy
 * asked for it to be more interactive; what was added is four islands, not a
 * client boundary around the document.
 *
 * Each of the four degrades to something complete rather than to nothing: the
 * film is still an autoplaying captioned player without its chapter list, the
 * gallery is still ten pictures with captions without its lightbox, the figures
 * are server-rendered at their final values and only animate on top of that,
 * and the give button's `href` is the real Tithe.ly URL.
 *
 * The order of the bands, and why:
 *
 *   1. A short deep band, then **the flythrough immediately**. This page has
 *      one genuinely arresting asset and burying it under four paragraphs of
 *      preamble would be the mistake /livestream was corrected for: lead with
 *      the thing, let the prose follow the reader who wants it. It autoplays,
 *      silent, with a cue line naming what is on screen.
 *   2. **The consultants' marks**, straight after it — the answer to "is this
 *      real", put where the question is asked. Drops out entirely if no logo
 *      file has been built; see `TeamMarksBand`.
 *   3. What is being built, with the four numbers.
 *   3. Building A, the church.
 *   4. Building B, the youth centre, Sunday school and housing.
 *   5. Building C, the diocese centre.
 *   7. **Ten more views**, as a grid that opens — the page's one break from
 *      reading, placed where a reader has just been told what each building is
 *      and wants to look rather than read.
 *   8. The whole floor area split by use, on `band--tinted`.
 *   9. The land: the two drawings, the piazza, what happens to the present
 *      building.
 *  10. Where the work stands, as a dated spine.
 *  11. **Who is drawing it** — the nine firms by name, with roles and towns —
 *      on `band--tinted`. The marks answered "is this serious" at the top; this
 *      answers "who checked the structure", for the reader who got this far.
 *  12. The offering, on `band--deep`, bookending the hero.
 *  13. The rest of About, on `band--sunken`. Not an afterthought: it replaced a
 *      lone "All of About" link stranded on bare paper between two dark bands,
 *      which read as a hole rather than a foot. `components/MoreOfAbout`,
 *      shared with the other four parts of About since it was lifted out of
 *      `parts.tsx`.
 *
 * **The page's job is to be believed.** Which is why it says twice that nothing
 * is built and once that nothing is approved, sources every figure to the sheet
 * it was read off, and gives the nine consultants a ground of their own instead
 * of a credit line at the bottom. A page of photorealistic renderings that does
 * not say "this is a drawing" is a page that will be quoted back at the church
 * by a neighbour, and rightly — and one that cannot say who drew it is a page
 * nobody has to take seriously.
 *
 * **Nine of the eleven bands do not mention money, and the last one does.**
 * That is the shape /about/who-we-are has for a reason — a description that
 * turns into an appeal partway through stops being a description — and the
 * exception at the end was asked for and is right: 119,458 square feet is not
 * paid for by a church that never says so, and a reader who has been shown the
 * whole thing and told twice that nothing is built has earned the sentence
 * about what happens next. The rule that holds is that none of the nine bands
 * above it asks for anything. Do not seed a second ask further up.
 * ---------------------------------------------------------------------------
 */
export function FutureScreen() {
  return (
    <div className="future">
      {/* Renders nothing. Marks the blocks below and reveals them as they come
          into view; see `Reveals.tsx` for why this is an observer and not CSS. */}
      <Reveals />

      <section className="band band--deep band--tight-end future-hero">
        <div className="wrap future-hero__inner">
          <p className="future-hero__eyebrow">About</p>
          {/*
            A `p`, not a heading. `PageHeader` has already rendered the page's
            hidden `h1`; a second would give the document two, and the sections
            below need `h2` to be the level under it.
          */}
          <p className="future-hero__title">Future Plans</p>
          <p className="future-hero__lede">
            A church, a youth centre with housing above it, and a diocese centre — three buildings
            on the land at 169 Rice Road, drawn and filed with the town. None of it is built. This
            is what has been designed, and how far it has got.
          </p>
        </div>
      </section>

      {/*
        The film sits in its own band rather than inside the hero, so it gets a
        light ground under it: a 16:9 poster on the dark hero reads as a hole
        cut in the page, which is the same fault `.band--deep` was given a
        gradient to fix.

        Tight at both ends. `band--tight-start` closes the seam with the hero,
        where the ground changes; `band--tight-end` closes the one below, where
        it does not — whatever follows the film, the marks or the first
        paragraph, is a continuation of the same errand and a full section's air
        between them reads as the page having ended.
      */}
      <section
        className="band band--tight-start band--tight-end future-film-band"
        aria-labelledby="the-flythrough"
      >
        <div className="wrap">
          <h2 id="the-flythrough" className="visually-hidden">
            A walk through the proposed buildings
          </h2>
          <Film />
        </div>
      </section>

      <TeamMarksBand />

      <section className="band future-what" aria-labelledby="what-is-being-built">
        <div className="wrap future-split">
          <div className="future-split__body prose">
            <h2 id="what-is-being-built">Three buildings, one courtyard</h2>
            <p>
              The church now worships in a building it did not build. It was put up for an
              Episcopal congregation, it was bought in 2016, and the altar, the screen and the
              icons in it were fitted into a room that was designed around a different service.{' '}
              <Link href="/about/who-we-are">How that happened</Link> is its own story. What was
              always going to follow from it is this one.
            </p>
            <p>
              The design puts three buildings around a paved court. The church stands at the east
              end, on the highest part of the site, with its doors facing the car park across a
              broad flight of steps. Behind it and to the north runs the long building that holds
              the Sunday school on its lower floors and one-bedroom apartments above. Between them
              and Rice Road sits the diocese centre, the smallest of the three.
            </p>
            <p>
              They are one project and they are not one building. The church is drawn in the
              Coptic language of arches, vaults and a dome; the other two are plainly and
              deliberately not, so that a reader driving past can tell at a glance which of the
              three is the church.
            </p>
            <p>
              It has been drawn by an architecture practice with{' '}
              <a href="#who-is-drawing-it">eight consulting firms working under it</a> — structural,
              civil, traffic, code, mechanical, landscape, wetland and survey — and the drawings
              have been in front of the Wayland Planning Board since August 2025.
            </p>
          </div>
          <Plate name="campus-aerial" className="future-split__plate" />
        </div>

        <div className="wrap">
          <Figures />
          <WidePlate name="piazza" />
        </div>
      </section>

      <section className="band band--sunken future-a" aria-labelledby="the-church">
        <div className="wrap future-split future-split--flipped">
          <div className="future-split__body prose">
            <p className="future-tag">Building A</p>
            <h2 id="the-church">The church</h2>
            <p>
              A nave of 5,429 square feet under barrel vaults, with a dome over the crossing and a
              gallery above the west end. Seating for 570 — about three times what the present
              building holds. The main altar stands at the east with a side altar to either side of
              it, which is the Coptic arrangement: three sanctuaries behind one screen, so that
              more than one Liturgy can be served on a morning when more than one is needed.
            </p>
            <p>
              Around them the rooms a Liturgy actually needs and the present building improvises:
              a baptistery off the nave, a chamber for the relics, a room for the deacons to vest
              in, a chorus, and two crying rooms — one on each level — so that a parent with a
              small child can still see and hear the altar.
            </p>
            <p>
              The floor of the church sits sixteen feet above the car park. That is the reason the
              approach is a flight of steps and the reason there is a ramp beside it, drawn at one
              in twelve with seven landings, so that the same doors are the way in for everybody.
            </p>
            <p>
              It also means there is a whole floor underneath the nave, and that floor is where
              most of a Sunday actually happens: a dining hall of 4,050 square feet, a kitchen with
              a pantry and a receiving door behind it, a bakery for the bread, the bookstore, the
              three church offices, and a small chapel of 887 square feet for the weekday services
              that do not need 570 seats.
            </p>
          </div>
          <Plate name="steps" className="future-split__plate" />
        </div>

        <div className="wrap">
          <WidePlate name="west-front" />
        </div>
      </section>

      <section className="band future-b" aria-labelledby="youth-and-housing">
        <div className="wrap future-split">
          <div className="future-split__body prose">
            <p className="future-tag">Building B</p>
            <h2 id="youth-and-housing">Sunday school, sport, and housing</h2>
            <p>
              The largest of the three at 60,458 square feet, and the one that carries most of what
              the church does between Sundays. Thirteen classrooms on the ground floor, from 487 to
              665 square feet, with a nurse station and a staff kitchen among them and more Sunday
              school space on the floor below. A flexible room of 2,810 square feet, and a game
              room beside it.
            </p>
            <p>
              Behind those, a full-size sports court of 7,400 square feet with locker rooms off it
              — a real court, marked for basketball, not a hall with a hoop at one end. It is the
              single largest room in the project after the nave.
            </p>
            <p>
              Above all of it are twenty-one one-bedroom apartments across two floors, with a
              common room on each, reached by their own stairs and lift. They are drawn for older
              members of the congregation: housing on the same ground as the church, so that
              growing old does not mean leaving it.
            </p>
          </div>
          <Plate name="youth-center" className="future-split__plate" />
        </div>
      </section>

      <section className="band band--sunken future-c" aria-labelledby="the-diocese-centre">
        <div className="wrap future-split future-split--flipped">
          <div className="future-split__body prose">
            <p className="future-tag">Building C</p>
            <h2 id="the-diocese-centre">The diocese centre</h2>
            <p>
              The smallest of the three, at 23,983 square feet over three levels, and the one that
              serves beyond this congregation. Its ground floor is the function room — 5,639 square
              feet drawn with twenty-four round tables in it, its own kitchen and its own lobby off
              the car park, so a wedding or a funeral reception does not have to be held in the
              room the Liturgy was just served in.
            </p>
            <p>
              Above that, offices, a conference room, a lounge and three apartments. Below it, a
              hall with dressing rooms either side.
            </p>
            <p>
              It stands closest to Rice Road, on roughly the ground the present church occupies —
              which is the plain reason the present church has to come down before this one can go
              up.
            </p>
          </div>
          <Plate name="diocese-center" className="future-split__plate" />
        </div>
      </section>

      {/*
        The gallery.

        Placed after the three buildings and before the numbers, which is the
        seam it belongs in: the reader has just been told what each building is
        and has seen one picture of each, and what they want next is more
        pictures — not another table. It is also the page's one break from
        reading, and a page of nine bands needs one.
      */}
      <section className="band future-gallery-band" aria-labelledby="more-views">
        <div className="wrap">
          <header className="future-head">
            <p className="future-head__eyebrow">Ten more views</p>
            <h2 id="more-views">Walk round it</h2>
            <p className="lede">
              More frames from the same flythrough — the approach, the court, the two buildings
              behind, and the whole site from above. Open any of them.
            </p>
          </header>

          <Gallery />
        </div>
      </section>

      <section className="band band--tinted future-uses-band" aria-labelledby="all-of-it">
        <div className="wrap">
          <header className="future-head">
            <p className="future-head__eyebrow">119,458 square feet, accounted for</p>
            <h2 id="all-of-it">What the space is for</h2>
            <p className="lede">
              Straight off the schedule that repeats on every floor plan in the filed set, summed
              across the three buildings. The seven lines add to the total exactly.
            </p>
          </header>

          <ByUse />
        </div>
      </section>

      <section className="band future-land" aria-labelledby="the-land">
        <div className="wrap">
          <header className="future-head">
            <p className="future-head__eyebrow">Five and a half acres</p>
            <h2 id="the-land">How it sits on the land</h2>
            <p className="lede">
              The lot is the one the church already owns — Map 40, Lot 008, between Rice Road and
              Turkey Hill Road. No land is being bought, and the buildings are fitted to what is
              there.
            </p>
          </header>

          <WidePlate name="roofs-aerial" />

          <WidePlate name="site-plan" openable />

          <div className="future-land__body prose">
            <p>
              The three buildings are set back from both streets and turned inward, so that what
              they enclose is a courtyard rather than a frontage. The car park wraps around the
              outside: 190 spaces, six of them accessible, which is exactly what the Wayland bylaw
              asks for a church of 570 seats, and a fire access road runs the length of the north
              boundary.
            </p>
            <p>
              Built footprint comes to 18 per cent of the lot against a limit of 20, and just under
              two acres is left as open space. A brook crosses the north-west corner of the
              property, and the drawings show the work inside its buffer measured, drawn and kept
              small — a little over two thousand square feet of it. Two species of native cedar are
              specified for the planting.
            </p>
            <p>
              The present church is drawn on the site plan as a dashed outline marked{' '}
              <i>outline of existing church to be demolished</i>. That is the hardest line on the
              sheet, and it is the honest one: the congregation would be worshipping in the
              building on the day the drawings for its replacement are approved.
            </p>
          </div>

          <WidePlate name="massing" openable />
        </div>
      </section>

      <section className="band band--sunken future-stands" aria-labelledby="where-it-stands">
        <div className="wrap">
          <header className="future-head">
            <p className="future-head__eyebrow">Nothing has been dug</p>
            <h2 id="where-it-stands">Where the work stands</h2>
            <p className="lede">
              Dates below are the ones printed on the drawings themselves, not dates anybody
              remembers.
            </p>
          </header>

          <Progress />

          <div className="future-stands__foot prose">
            <p>
              Every sheet in the set is stamped <i>not for construction</i>, and the line on the
              cover reading <i>date site plan endorsed</i> is still blank. The design has been
              revised twice already in answer to the town's review, and it can be revised again.
              What is on this page is a proposal in front of a planning board, which is a real and
              specific stage and is not the same thing as a building.
            </p>
            <p>
              Building it is the work of years and of the congregation's{' '}
              <Link href="/giving">offering</Link>. If you want to know where it has got to since
              this page was written, <Link href="/contact">ask the office</Link> — that answer will
              be current and this one will not.
            </p>
          </div>
        </div>
      </section>

      {/*
        `band--tinted` — the third ground, and this is the second and last use
        of it on the page. It is not a credit strip at the bottom of a document;
        it is the section that answers "is this real", and it is given a ground
        of its own so that a reader skimming stops at it.
      */}
      <section className="band band--tinted future-team-band" aria-labelledby="who-is-drawing-it">
        <div className="wrap">
          <header className="future-head">
            <p className="future-head__eyebrow">Nine firms</p>
            <h2 id="who-is-drawing-it">Who is drawing it</h2>
            <p className="lede">
              A structural engineer, a traffic consultant, a code consultant, a wetland scientist
              and a licensed land surveyor, each named on the sheets they are responsible for. This
              is not a sketch somebody made for the church.
            </p>
          </header>

          <Team />
          <Credit />
        </div>
      </section>

      {/*
        The offering, and it is the last band on purpose.

        ---------------------------------------------------------------------
        /about/who-we-are ends on the people who serve rather than on an
        invitation, and this page was built the same way — a description of a
        building that turns into an appeal in its last band stops being a
        description. Tommy asked for the appeal, and on this page he is right
        and the rule is not: 119,458 square feet is not paid for by a church
        that never mentions it, and a reader who has just been shown the whole
        thing and told twice that nothing is built has *earned* the sentence
        about what happens next. The rule still holds for the eight bands above
        it, which is why none of them mentions money.

        **The fund line is the load-bearing part, not the button.** Tithe.ly's
        form opens on the church's general fund, and there is no documented
        query parameter that preselects a different one — so an offering meant
        for the building lands in the general fund unless the giver changes it
        themselves. Telling them so, in the sentence before the button rather
        than after it, is the whole reason this band is worth having. If
        Tithe.ly ever publishes a fund parameter, put it in
        `features/giving/config.ts` and this paragraph gets shorter.

        `GiveButton` is a client component and the only one on this page. It is
        used rather than a plain link to /giving for the reason it exists: its
        `href` is the real Tithe.ly URL, so it works with JavaScript off, and
        with scripting on it opens the form in an overlay instead of sending a
        reader who has scrolled through nine bands away to another page.
        ---------------------------------------------------------------------
      */}
      <section className="band band--deep future-give" aria-labelledby="paying-for-it">
        <div className="wrap future-give__inner">
          <h2 id="paying-for-it">Paying for it</h2>
          <p className="future-give__lede">
            The drawings are paid for. The buildings are not, and they will be built the way
            everything in this church is built — out of what the congregation gives.
          </p>
          <p className="future-give__fund">
            When the form opens, change the fund to <strong>SPSM Construction Project</strong>. It
            opens on the general fund, and an offering left there supports the church's day-to-day
            work rather than this.
          </p>
          {/*
            A `div`, not a `p`, and this cost a hydration error to learn.
            `GiveButton` renders its overlay as a sibling of the trigger, and a
            `<dialog>` inside a `<p>` is invalid HTML: the parser closes the
            paragraph before the dialog, so the server's tree and the browser's
            disagree and React re-renders the whole subtree on hydration. The
            same is true of the `div` inside the dialog's head. Anything that
            can contain this component has to be flow content.
          */}
          <div className="future-give__act">
            <GiveButton className="button">Give to the construction fund</GiveButton>
          </div>
          <p className="future-give__note">
            One offering or a recurring one, through the church's Tithe.ly form.{' '}
            <Link href="/giving">More ways to give</Link>.
          </p>
        </div>
      </section>

      <MoreOfAbout current="future-plans" />
    </div>
  );
}
