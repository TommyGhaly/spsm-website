import Link from 'next/link';
import { EGYPT, NEW_ENGLAND } from './chronologies';
import { Chronology, Clergy, Credits, Plate, Sanctuary, WidePlate } from './parts';

/**
 * /about/who-we-are, whole.
 *
 * ---------------------------------------------------------------------------
 * **A server component with no client boundary anywhere in it.** Everything on
 * this page is the same for everybody and will be the same next year, so it
 * ships as HTML and no JavaScript at all — which is also what makes the dates
 * in it findable by search engines and by the browser's own find-in-page.
 *
 * One story in three movements, which is how it was asked for: the Coptic
 * Orthodox Church in Egypt, the emigration to America, and this church. The
 * bands, in order:
 *
 *   1. A short deep band. Three lines, no picture.
 *   2. Where the Church comes from, and what the word Copt means.
 *   3. **Nineteen centuries as a dated spine**, on `band--tinted` — the third
 *      ground, used once, for the thing a reader scrolling fast should find.
 *   4. What being a minority at home made the Church into, and the revival.
 *   5. The crossing: 1952, 1965, 1970, and the priests who were sent after.
 *   6. New England, as a second spine, and the borrowed buildings.
 *   7. This church — Holy Spirit, February 2016, and the room it left us.
 *   8. The clergy, with their photographs.
 *
 * **What this page does not do is argue.** /about/our-belief states the faith
 * and explains the councils; this one gives each council a line and a date and
 * links there. Two pages that both half-explain Chalcedon would be worse than
 * either.
 *
 * Nor does it end by inviting anybody. There is no closing "come and see"
 * panel, for the reason one was cut from /about/our-belief: a history that
 * turns into an advertisement at the last band stops being a history. The page
 * ends on the six people who serve in the room it has just described.
 * ---------------------------------------------------------------------------
 */
export function WhoScreen() {
  return (
    <div className="who">
      <section className="band band--deep who-hero">
        <div className="wrap who-hero__inner">
          <p className="who-hero__eyebrow">About</p>
          {/*
            A `p`, not a heading. `PageHeader` has already rendered the page's
            hidden `h1`; a second one would give the document two, and the
            sections below need `h2` to be the level under it.
          */}
          <p className="who-hero__title">Who We Are</p>
          <p className="who-hero__lede">
            A Coptic Orthodox church in Wayland, Massachusetts. The Church it belongs to was
            founded in Alexandria in the first century and has been in Egypt ever since; this
            building has been ours since 2016. What follows is how the one reached the other.
          </p>
        </div>
      </section>

      <section className="band who-origin" aria-labelledby="what-copt-means">
        <div className="wrap who-split">
          <div className="who-split__body prose">
            <h2 id="what-copt-means">A word that means Egyptian</h2>
            <p>
              The Coptic Orthodox Church began in Alexandria. St. Mark the Evangelist brought the
              Gospel there around the middle of the first century and was martyred in the city, and
              the Church he founded has had an unbroken line of successors in that see ever since.
              Its patriarch is the Pope of Alexandria. This church in Wayland belongs to it.
            </p>
            <p>
              <i>Copt</i> is not the name of a denomination. It is the Greek word for Egyptian,
              which the Arabs shortened to <i>qibṭ</i> after they arrived in the seventh century,
              and which came back into English as Copt. For a long stretch of history it meant both
              things at once — Egyptian, and Christian — because in Egypt those were the same
              people.
            </p>
            <p>
              The language is the same story. Coptic is the last stage of the language of the
              pharaohs, written in Greek letters with seven signs kept back from demotic for the
              sounds Greek had no letters for. It stopped being spoken in the street centuries ago.
              It is still the language of the Liturgy, and a child learning to serve in the altar in
              Massachusetts learns to read it.
            </p>
          </div>
          <Plate name="coptic-family" className="who-split__plate" />
        </div>
      </section>

      <section className="band band--tinted who-spine" aria-labelledby="in-egypt">
        <div className="wrap">
          <header className="who-spine__head">
            <p className="who-spine__eyebrow">Nineteen centuries, one country</p>
            <h2 id="in-egypt">The Church in Egypt</h2>
            <p className="lede">
              The councils get a line each here and no more. What they decided, and why it is said
              aloud every Sunday, is on <Link href="/about/our-belief">Our Belief</Link>.
            </p>
          </header>

          <Chronology moments={EGYPT} />

          <WidePlate name="desert-monastery" />
        </div>
      </section>

      <section className="band who-minority" aria-labelledby="a-minority-at-home">
        <div className="wrap who-split">
          <div className="who-split__body prose">
            <h2 id="a-minority-at-home">A minority at home</h2>
            <p>
              After 641 the Christians of Egypt did not go anywhere. They became, slowly and over
              centuries, a minority in the country they had always lived in — taxed as one,
              governed as one, and periodically persecuted as one. The Church that came out of that
              is not the Church of the majority anywhere, and has never organised itself as though
              it expected to be.
            </p>
            <p>
              What it did instead was keep things. It kept the calendar counted from the martyrs. It
              kept the fasts, which still take up more than half the year. It kept the language in
              the Liturgy long after the language had died everywhere else. And it kept the
              monasteries, which is where its bishops still come from — a Coptic bishop is a monk
              first, and the Pope of Alexandria is chosen from among the monks.
            </p>
            <p>
              The renewal that produced the Church as it is now started with a layman. In 1900
              Habib Girgis, a teacher at the theological college in Cairo, began organising Sunday
              schools — fifteen years before Egypt had public schools at all. By 1949 the movement
              had 2,500 teachers and 43,000 children in it, and the men it taught became the monks,
              priests and bishops of the next fifty years. In 1959 Pope Kyrillos VI was enthroned,
              and in twelve years he rebuilt the monasteries and restored the shrine of St. Mina at
              Mariout — the saint the second half of this church is named for.
            </p>
          </div>
          <Plate name="coptic-houses-cairo" className="who-split__plate" />
        </div>

        <div className="wrap">
          <WidePlate name="coptic-monks" />
        </div>
      </section>

      <section className="band band--sunken who-crossing" aria-labelledby="the-crossing">
        <div className="wrap who-split">
          <div className="who-split__body prose">
            <h2 id="the-crossing">The crossing</h2>
            <p>
              Copts began arriving in America in small numbers early in the twentieth century, and
              in larger ones after 1952, when the revolution and the nationalisations that followed
              it — of businesses, of land, including land willed to churches and monasteries — made
              staying harder for exactly the educated class the Church had spent fifty years
              teaching. Then in 1965 the United States repealed the national-origins quotas that had
              kept the door mostly shut to anyone not European. The new law took full effect in
              1968, a year after Egypt’s defeat in the Six-Day War, and a generation of Coptic
              engineers, doctors and pharmacists left.
            </p>
            <p>
              They arrived without churches. The first Coptic organisation in the country, the
              Coptic American Association, was founded in 1964 and had two hundred members by the
              end of that year — a mailing list, not a congregation. Pope Kyrillos VI answered by
              sending priests after them: Fr. Bishoy Kamel to Los Angeles in 1969, and Fr. Rofael
              Nakhla, who prayed the first Liturgy in the first Coptic church building in the United
              States — a church bought and renovated in Jersey City — on 22 March 1970.
            </p>
          </div>
          <Plate name="pope-kyrillos" className="who-split__plate" />
        </div>

        <div className="wrap who-split who-split--flipped">
          <div className="who-split__body prose">
            <p>
              By 1976 there were ten. Pope Shenouda III, who succeeded Kyrillos in 1971 and led the
              Church for forty years, came to the United States in 1977 and stayed two months, which
              for a Pope of Alexandria was without precedent. The first two American dioceses were
              established in 1995. By 2007 there were something like two hundred Coptic churches in
              the country.
            </p>
            <p>
              Almost none of them was built as one. They are former Methodist, Catholic,
              Presbyterian and Episcopal churches, bought from congregations that had grown too
              small to fill them, with a Coptic cross put up on the roof. That is not a temporary
              arrangement anybody is embarrassed by. It is what the Coptic Orthodox Church in
              America mostly looks like, and it is what this church is.
            </p>
          </div>
          <Plate name="pope-shenouda" className="who-split__plate" />
        </div>
      </section>

      <section className="band who-here" aria-labelledby="in-new-england">
        <div className="wrap">
          <header className="who-spine__head">
            <p className="who-spine__eyebrow">Borrowed rooms, then bought ones</p>
            <h2 id="in-new-england">New England</h2>
            <p className="lede">
              The same thing happened here, later and smaller. Boston had Egyptian students before
              it had a Coptic church, and everything Coptic in this part of the country grew out of
              one building in Natick — including us.
            </p>
          </header>

          <WidePlate name="queens-church" />

          <Chronology moments={NEW_ENGLAND} />
        </div>
      </section>

      <section className="band band--sunken who-wayland" aria-labelledby="this-church">
        <div className="wrap who-wayland__inner">
          <header className="who-wayland__head">
            <h2 id="this-church">This church</h2>
          </header>

          <Sanctuary />

          <div className="who-wayland__body prose">
            <p>
              The Church of the Holy Spirit, at 169 Rice Road in Wayland, was an Episcopal church.
              Its congregation had grown small, and in June 2015 it held its last service. St. Mark
              of Boston bought the building in January 2016.
            </p>
            <p>
              On 24 February 2016 the two churches held one service in it to hand over the
              ecclesiastical authority — Episcopal hymns and Coptic prayers, the Coptic clergy and
              Bishop Gayle Harris of the Episcopal Diocese of Massachusetts together, and more than
              two hundred people, a good number of whom had been baptised or married in that room.
              It was a handing on rather than a closing. In June 2017 the property passed from St.
              Mark to St. Philopater Mercurius &amp; St. Mina, and the church took the name it has
              now — a soldier martyred under Julian, and a soldier martyred under Diocletian, whose
              shrine in the desert west of Alexandria was rebuilt in the same decade the first Copts
              were landing in New York. Both of them are on{' '}
              <Link href="/about/patron-saints">Our Patron Saints</Link>.
            </p>
            <p>
              The Liturgy is prayed in this building in Coptic, Arabic and English, by people whose
              grandparents prayed it in Egypt and by people who found the church last month. It has
              outgrown the room, and what the church intends to build instead is on{' '}
              <Link href="/about/future-plans">Future Plans</Link>. Some maps still label the
              building Holy Spirit. That is not wrong about it, and nobody here is in a hurry to
              have it corrected.
            </p>
          </div>
        </div>
      </section>

      {/*
        `id="clergy"`, because the footer's "Our clergy" points here. It used to
        point at `/#clergy` — the homepage band built from the `content/clergy`
        pages, none of which are published, so the band does not render and the
        link landed at the top of the homepage. The roster below is written into
        the page, so it is always there to arrive at.
      */}
      <section id="clergy" className="band who-clergy" aria-labelledby="the-clergy-here">
        <div className="wrap">
          <header className="who-spine__head">
            <p className="who-spine__eyebrow">Serving here</p>
            <h2 id="the-clergy-here">The clergy</h2>
            <p className="lede">
              A Coptic Orthodox church is a bishop&rsquo;s church, served by his priests. A deacon
              is not an apprentice priest — the order is its own, and permanent. Deacons chant the
              responses, read the Epistle and keep the altar&rsquo;s service moving, which means
              most of what a visitor hears at a Liturgy here is sung by them.
            </p>
          </header>

          <Clergy />

          {/*
            The credits, hidden — see `Credits` in `parts.tsx`. Inside the last
            real band rather than in a slim band of their own, because a band
            containing nothing visible is a band that will one day be given
            padding and then a seam nobody can account for.
          */}
          <Credits />
        </div>
      </section>
    </div>
  );
}
