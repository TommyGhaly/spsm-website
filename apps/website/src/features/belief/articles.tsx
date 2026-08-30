import type { ReactNode } from 'react';
import type { BeliefPictureName } from './images';

/**
 * The Creed, walked back through clause by clause.
 *
 * The structure of this section is the structure of the Creed itself, and that
 * is the whole idea: the page does not hand the reader a list of doctrines that
 * happens to sit near a list of creed lines, it takes the lines they have just
 * read standing up and says what each one means. So every article carries the
 * words it is about, verbatim, and the articles are in the Creed's order.
 *
 * The prose is JSX rather than markdown strings because several of these need a
 * `<Link>` or a quotation inside a sentence, and a markdown body would either
 * lose those or need raw HTML — which `Prose` deliberately does not render.
 *
 * `picture` is the plate that hangs beside the article, and every one of the
 * seven has one. The Trinity was the hard case — the Church does not paint the
 * divine essence — and the answer is the answer iconography has always given:
 * the three visitors at Mamre. An illustration chosen to fill a slot would have
 * been worse than a slot left empty; this one is the tradition's own.
 */

export type BeliefArticle = {
  id: string;
  /** The Creed's own words, quoted. Shown above the heading. */
  line: string;
  heading: string;
  body: ReactNode;
  picture?: BeliefPictureName;
};

export const ARTICLES: readonly BeliefArticle[] = [
  {
    id: 'one-god',
    line: 'We believe in one God, the Father Almighty, Who created Heaven and earth, and all things seen and unseen.',
    heading: 'One God, in three Persons',
    body: (
      <>
        <p>
          One God — not three, and not one God appearing under three names. The Father, the Son and
          the Holy Spirit are distinct Persons of one indivisible essence, equal in glory, without
          beginning and without end. The Church has never explained this and does not try to; it
          confesses it, and guards the confession against every attempt to make it simpler than it
          is.
        </p>
        <p>
          &ldquo;Almighty&rdquo; renders <i>Pantocrator</i> — the One who holds all things
          together, not merely the One who could do anything. And everything that exists is His
          work, the unseen as much as the seen: the angels, and the soul of every person who has
          ever lived.
        </p>
      </>
    ),
    picture: 'holy-trinity',
  },
  {
    id: 'one-lord',
    line: 'Light of Light, True God of True God, begotten, not created; of one essence with the Father.',
    heading: 'True God, and not the first of the creatures',
    body: (
      <>
        <p>
          This is the line the council was called for. A son shares his father&rsquo;s nature; a
          thing made is of some other nature than its maker. To say the Son is <i>begotten, not
          created</i> is to say He is God in the same sense the Father is God — begotten of the
          Father before all ages, eternally, not at some moment before the world began.
        </p>
        <p>
          &ldquo;Light of Light&rdquo; is the image the fathers reached for when language ran out.
          You cannot have a light and not its radiance; neither comes after the other, and the two
          are one light. The Greek word the council settled on, <i>homoousios</i> — of one essence —
          is not in Scripture, and that was the objection to it at the time. It was chosen because
          every scriptural phrase the Arians were willing to sign, they signed while meaning the
          opposite.
        </p>
      </>
    ),
    picture: 'christ-pantocrator',
  },
  {
    id: 'incarnate',
    line: 'Who for us men and for our salvation came down from Heaven, and was incarnate of the Holy Spirit and the Virgin Mary, and was made man.',
    heading: 'Perfect God and perfect man',
    body: (
      <>
        <p>
          The Church confesses that our Lord Jesus Christ is perfect in His divinity and perfect in
          His humanity; that He took flesh of the Virgin Mary and made it one with His divinity
          without mingling, without confusion and without alteration; and that His divinity parted
          from His humanity not for a single moment, nor the twinkling of an eye. Those words are
          not a summary written for a website. They are said aloud in the church before communion,
          at every Liturgy.
        </p>
        <p>
          Because the One born of her is God the Word Himself, the Church calls the Virgin Mary{' '}
          <i>Theotokos</i> — the God-bearer, the Mother of God. The title is a statement about her
          Son before it is a statement about her, which is exactly why the Church fought for it.
        </p>
      </>
    ),
    picture: 'theotokos-sinai',
  },
  {
    id: 'crucified',
    line: 'And He was crucified for us under Pontius Pilate… the third day He rose from the dead, according to the Scriptures.',
    heading: 'Under Pontius Pilate',
    body: (
      <>
        <p>
          A Roman magistrate&rsquo;s name, in the middle of a creed. It is there because what the
          Church confesses happened at a datable hour, in a named province, under an official whose
          paperwork an empire kept — and not in the realm of ideas, where nothing can be checked and
          nothing is at stake.
        </p>
        <p>
          He was crucified, died and was buried; on the third day He rose, and death was broken open
          from the inside. The Church keeps that day with fifty-five days of fasting before it and
          fifty days of standing prayer after — from Easter until Pentecost nobody in the church
          kneels, because those are not days for mourning.
        </p>
      </>
    ),
    picture: 'resurrection',
  },
  {
    id: 'holy-spirit',
    line: 'Yes, we believe in the Holy Spirit, the Lord and Giver of Life… Who spoke in the prophets.',
    heading: 'The Spirit, and the Scriptures He spoke',
    body: (
      <>
        <p>
          The Holy Spirit is not a force the Church has the use of. He is the Lord and Giver of
          Life, worshipped and glorified together with the Father and the Son — the article
          Constantinople added in 381, for the reason Nicaea had added <i>of one essence</i> to the
          article on the Son.
        </p>
        <p>
          He <i>spoke in the prophets</i>, which is why the Church reads the Old Testament and the
          New as one revelation, and why Scripture is never read on its own here. It is read inside
          the tradition that carried it — the Liturgy, the fathers, the councils, the icons on the
          walls. The Church that recognised which books are Scripture is the same Church that reads
          them, and the Coptic Orthodox canon keeps the books a later Western reckoning set aside.
        </p>
      </>
    ),
    picture: 'coptic-gospel-leaf',
  },
  {
    id: 'the-church',
    line: 'And in One Holy Catholic and Apostolic Church.',
    heading: 'One, holy, catholic, apostolic',
    body: (
      <>
        <p>
          Four marks, and the Creed asks for all four at once. <b>One</b>, because Christ has one
          body and not several. <b>Holy</b>, not because its members are, but because its Head is
          and its mysteries are. <b>Catholic</b> — universal — because it holds the whole faith, for
          everyone, everywhere, and not a local portion of it. <b>Apostolic</b>, because its bishops
          stand in unbroken succession from the Apostles and its faith is the Apostles&rsquo; faith
          rather than a later improvement on it.
        </p>
        <p>
          For the Coptic Orthodox Church that succession runs through St. Mark the Evangelist, who
          brought the Gospel to Alexandria and was martyred there.
        </p>
      </>
    ),
    picture: 'hanging-church',
  },
  {
    id: 'one-baptism',
    line: 'We acknowledge one Baptism for the remission of sins. We look for the Resurrection of the dead and the life of the coming age. Amen.',
    heading: 'One baptism, and the age to come',
    body: (
      <>
        <p>
          One baptism, not repeated, because a person is born once. It is given by three immersions
          in the name of the Father and of the Son and of the Holy Spirit, to infants as well as to
          adults; the newly baptised is anointed at once with the holy Myron and receives communion
          the same day. Baptism is the first of the Church&rsquo;s seven mysteries — the others are
          Chrismation, Repentance and Confession, the Eucharist, Unction of the Sick, Matrimony and
          Priesthood.
        </p>
        <p>
          And the Creed ends by naming where all of this is going: the resurrection of the dead, and
          the life of the coming age. Not the survival of a soul somewhere — the raising of the
          whole person, body and all.
        </p>
      </>
    ),
    picture: 'coptic-baptism',
  },
];
