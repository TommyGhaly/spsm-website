import { ARTICLES } from './articles';
import { CREED } from './creed';
import { Credits, Plate, WidePlate } from './parts';

/**
 * /about/our-belief, whole.
 *
 * ---------------------------------------------------------------------------
 * **A server component with no client boundary anywhere in it.** The tour next
 * door is interactive because a visitor is walking around a hall with it; this
 * page is read sitting down, and every part of it — the Creed, the councils,
 * the pictures — is the same for everybody, forever. So it ships as HTML and no
 * JavaScript at all, which is also what makes the Creed findable by search
 * engines and by the browser's own find-in-page.
 *
 * The shape of the page, and why:
 *
 *   1. A short deep band. Three lines, no picture — the point of this page is
 *      the Creed, and a hero that fills the viewport pushes it below the fold.
 *   2. Why the Church has dogma at all, before any of it is stated.
 *   3. **The Creed itself**, high up, whole, quoted rather than summarised.
 *   4. Where it came from: Arius, Nicaea, Constantinople, Ephesus.
 *   5. The Creed again, clause by clause, with what each clause means.
 *   6. Whose confession this is — the See of St. Mark, and Chalcedon.
 *
 * There is no seventh band. One was built — the picture credits, and before
 * that a closing "come to a Liturgy" panel — and both were cut. The page ends
 * on Chalcedon.
 *
 * Bands alternate ground so a page this long reads as parts rather than as one
 * column of beige. The Creed sits on `band--tinted`, which is the third ground
 * and is used nowhere else on this page: it is the one thing here a reader
 * might have come for, and it should be findable by scrolling past everything
 * else at speed.
 * ---------------------------------------------------------------------------
 */
export function BeliefScreen() {
  return (
    <div className="belief">
      <section className="band band--deep belief-hero">
        <div className="wrap belief-hero__inner">
          <p className="belief-hero__eyebrow">About</p>
          {/*
            A `p`, not a heading. `PageHeader` has already rendered the page's
            hidden `h1`; a second one here would give the document two, and the
            sections below need `h2` to be the level under it.
          */}
          <p className="belief-hero__title">Our Belief</p>
          <p className="belief-hero__lede">
            The Coptic Orthodox Church confesses the faith the Apostles handed down, in the words
            the whole Church settled at Nicaea in 325. That Creed is said aloud at every Liturgy.
            Everything else on this page is an unfolding of it.
          </p>
        </div>
      </section>

      <section className="band belief-opening" aria-labelledby="the-faith">
        <div className="wrap belief-split">
          <div className="belief-split__body prose">
            {/*
              The Latin carries the `lang` attribute so a screen reader changes
              voice for it rather than reading it as mispronounced English, and
              the English line below is inside the `h2` — the gloss is part of
              the heading, not a caption under it.
            */}
            <h2 id="the-faith" className="belief-opening__title">
              <span lang="la">Lex orandi, lex credendi</span>
              <span className="belief-opening__gloss">As the Church prays, so it believes</span>
            </h2>
            <p>
              The phrase is Prosper of Aquitaine&rsquo;s, written about 435 —{' '}
              <i lang="la">ut legem credendi lex statuat supplicandi</i>, that the law of praying
              establishes the law of believing. He was arguing that if you want to know what the
              Church holds, listen to how it prays; the prayers came first, and the doctrine states
              what was already being prayed.
            </p>
            <p>
              So the faith belongs to the whole Church, not to its scholars. It is confessed aloud
              by everyone present at every Liturgy, and carried out of the church into the week.
              Every dogma the Church states says one thing: that man is called into communion with
              God the Father, in Jesus Christ the incarnate Word, by His Holy Spirit.
            </p>
            <p>
              Redemption, membership of the Church, the reading of the Scriptures, the Kingdom of
              God within the soul, the company of the angels and the saints, the life of the age to
              come — all of it holds together in that communion. The Church states its dogma in
              order to live by it: to worship God, to serve mankind, to work for the renewal of this
              world, and to wait for the world to come.
            </p>
            <p>
              So the faith is sung, painted and fasted as much as it is stated. The Creed below is
              said standing, by everyone present, at every Divine Liturgy. The same faith is in the
              icons on the walls, in the seven hours of the Agpeya, and in the fasts that take up
              more than half the year.
            </p>
          </div>
          <Plate name="wadi-natrun-frescos" className="belief-split__plate" />
        </div>
      </section>

      <section className="band band--tinted belief-creed" aria-labelledby="the-creed">
        <div className="wrap belief-creed__inner">
          <header className="belief-creed__head">
            <p className="belief-creed__eyebrow">Said standing, at every Liturgy</p>
            <h2 id="the-creed">The Nicene Creed</h2>
            <p className="lede">
              Three hundred and eighteen bishops met at Nicaea in 325 to answer one question:
              whether the Son of God is a creature. Their answer is this. It was completed at
              Constantinople in 381, and the Church has said it in this form ever since — after the
              readings and before the offering, and again at every baptism.
            </p>
          </header>

          <div className="belief-creed__body">
            {/*
              A `blockquote`, one `p` per stanza, one `span` per line of the
              Creed. It is verse in the sense that matters — it is said in
              breaths, and where the lines break is where the church breathes —
              so the breaks are content rather than styling. A `<pre>` would
              preserve them too, and would also refuse to wrap on a phone.

              Spans set to `display: block` rather than `<br />`, so each line
              is a box that can carry the hanging indent that tells the
              Church's line breaks apart from the ones a narrow screen makes.
            */}
            <blockquote className="belief-creed__text">
              {CREED.map((stanza) => (
                <p key={stanza.id} id={stanza.id} className="belief-creed__stanza">
                  {stanza.lines.map((line) => (
                    <span key={line} className="belief-creed__line">
                      {line}
                    </span>
                  ))}
                </p>
              ))}
            </blockquote>

            <div className="belief-creed__aside">
              <Plate name="council-of-nicaea" />
              <p className="note">
                Two things in this English are deliberate. The Church says{' '}
                <b>&ldquo;Who proceeds from the Father&rdquo;</b>, without the later Western
                addition <i>and the Son</i>; and it opens the article on the Holy Spirit with{' '}
                <b>&ldquo;Yes&rdquo;</b> — an affirmation, carried over from the Coptic, rather than
                a continuation of the sentence before it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band belief-councils" aria-labelledby="the-councils">
        <div className="wrap belief-split">
          <div className="belief-split__body prose">
            <h2 id="the-councils">Three councils, and one word</h2>
            <p>
              Arius was a priest of Alexandria who taught that there was a time when the Son was
              not: that He was the highest and first of the creatures, but a creature. Alexander,
              Pope of Alexandria, condemned it, and the argument spread far enough that the Emperor
              Constantine summoned the bishops of the whole world to Nicaea, in 325, to settle it.
            </p>
            <p>
              They settled it with one word — <i>homoousios</i>, of one essence with the Father —
              and with the Creed built around it. Among the Alexandrian delegation was a young
              deacon named Athanasius, who spent the next forty-five years, and five separate
              exiles, defending what the council had written.
            </p>
            <p>
              At Constantinople in 381 the same question was asked about the Holy Spirit, and the
              council answered it by completing the Creed: the articles on the Spirit, the Church,
              baptism and the resurrection are theirs. At Ephesus in 431, with St. Cyril of
              Alexandria presiding, Nestorius was answered for refusing the Virgin Mary the title{' '}
              <i>Theotokos</i> — on the ground that a creature cannot bear the Creator. The council
              replied that the One she bore is a single Person, God the Word made flesh, and that
              to take the title from her is to divide Him in two.
            </p>
            <p>
              Those three councils — Nicaea, Constantinople, Ephesus — are the ones the Coptic
              Orthodox Church receives as ecumenical, and the whole of the Creed comes from the
              first two.
            </p>
          </div>
          <Plate name="alexandrian-fathers" className="belief-split__plate" />
        </div>
      </section>

      <section className="band band--sunken belief-articles" aria-labelledby="line-by-line">
        <div className="wrap">
          <header className="belief-articles__head">
            <h2 id="line-by-line">The Creed, line by line</h2>
            <p className="lede">
              What the church is saying when it says it. The order is the Creed&rsquo;s own.
            </p>
          </header>

          <ol className="belief-articles__list">
            {ARTICLES.map((article) => (
              <li
                key={article.id}
                id={article.id}
                className={`belief-article${article.picture ? ' belief-article--plated' : ''}`}
              >
                <div className="belief-article__body prose">
                  <p className="belief-article__line">{article.line}</p>
                  <h3 className="belief-article__heading">{article.heading}</h3>
                  {article.body}
                </div>
                {article.picture && (
                  <Plate name={article.picture} className="belief-article__plate" />
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band belief-see" aria-labelledby="the-see">
        <div className="wrap belief-see__inner">
          <header className="belief-see__head">
            <h2 id="the-see">Whose confession this is</h2>
          </header>

          <WidePlate name="st-mark-preaching" />

          <div className="belief-see__body prose">
            <p>
              St. Mark the Evangelist brought the Gospel to Alexandria in the middle of the first
              century and was martyred there. The Church he founded has had an unbroken line of
              successors in that see ever since; its patriarch is the Pope of Alexandria, and this
              church in Wayland belongs to it. The catechetical school of that city — where
              Pantaenus, Clement, Origen and Didymus the Blind taught — is the oldest Christian
              school on record.
            </p>
            <p>
              Egypt&rsquo;s calendar remembers what that cost. The Coptic year is not counted from
              the birth of Christ but from the year 284, the year Diocletian took the throne; the
              persecution he went on to launch cost Egypt more Christians than any other province of
              the empire. The years are numbered <i>Anno Martyrum</i>, the Year of the Martyrs. It is the
              Church&rsquo;s way of saying which fact it organises time around. And it was into that
              same desert that St. Antony went out around 270, and where St. Pachomius gathered the
              first communities a generation later — every monastery in the world descends from
              them.
            </p>
            <p>
              In 451 the Council of Chalcedon defined Christ as known &ldquo;in two natures&rdquo;.
              Alexandria held to St. Cyril&rsquo;s formula — one incarnate nature of God the Word —
              and did not receive that council, and the Church has been called <i>monophysite</i>{' '}
              ever since by people who take the word to mean that Christ&rsquo;s humanity was
              swallowed up in His divinity. It does not teach that and never has: it confesses Him
              perfect in divinity and perfect in humanity, united without mingling, without
              confusion and without alteration. In the twentieth century that was said formally from
              both sides — with the Roman Catholic Church in 1973, and with the Eastern Orthodox
              churches in the agreed statements of 1989 and 1990, which found the two families
              confessing one faith in two vocabularies.
            </p>
          </div>

          {/*
            The picture credits, hidden. See `Credits` — they stay in the markup
            because three of the pictures are licensed, but Tommy asked for them
            off the page, so they hang here rather than in a band of their own.
          */}
          <Credits />
        </div>
      </section>

    </div>
  );
}
