'use client';

import { Reveal, Stepper, Subsection, Switcher } from './parts';
import { CopticName, CopticYear, HymnTable } from './widgets';

/**
 * The words of the six stations.
 *
 * ---------------------------------------------------------------------------
 * JSX rather than data, for the reason given at the top of `stations.ts`: this
 * is prose with interactive panels set into the middle of it, and the structure
 * varies from station to station. A schema general enough to hold "a paragraph,
 * then a tab set of six symbols, then a table" is a worse thing to maintain
 * than the markup itself.
 *
 * On the voice: this describes what the Coptic Orthodox Church does and why,
 * in the third person, to a visitor standing in a hall. It does not invite,
 * urge, or promise, and it does not address the reader as "you" except where
 * the reader is doing something — typing their name, pressing Next. A festival
 * tour is teaching, not recruitment, and the difference is audible in every
 * sentence.
 * ---------------------------------------------------------------------------
 */

/* ── Station 1 ───────────────────────────────────────────────────────────── */

export function StationOne() {
  return (
    <>
      <Subsection title="Two words: Coptic, and Orthodox">
        <p>
          The Coptic Church was established in the name of the Lord Jesus Christ
          by St. Mark the Evangelist, in the city of Alexandria, around 43 A.D.
        </p>
        <p>
          <strong>Coptic</strong> comes through Greek. The Greek word for Egypt
          was <em>Aigyptos</em>; when the Arabs reached Egypt in the seventh
          century they shortened it to <em>qibt</em>. Because the Egyptians they
          found there were Christians, the same word came to carry both meanings
          at once — Egyptian, and Christian.
        </p>
        <p>
          <strong>Orthodoxy</strong> means keeping the original faith. The Creed
          settled at Nicaea in 325 A.D. has been attacked repeatedly in the
          centuries since, and the Coptic Church has defended it each time. At
          Nicaea itself the defence of Christ&rsquo;s divinity was led by St.
          Athanasius, later the 20th Pope of Alexandria, who is called the Father
          of Orthodoxy and the Apostolic for it.
        </p>

        <blockquote className="tour-creed">
          <p className="tour-creed__label">The Orthodox Creed, as printed in the Agpeya</p>
          <p>
            We believe in one God, God the Father, the Pantocrator, who created
            heaven and earth, and all things, seen and unseen.
          </p>
          <p>
            We believe in one Lord Jesus Christ, the only-begotten Son of God,
            begotten of the Father before all ages. Light of Light, true God of
            true God, begotten, not created, of one essence with the Father, by
            whom all things were made; who, for us men and for our salvation,
            came down from heaven, and was incarnate of the Holy Spirit and of
            the Virgin Mary, and became man.
          </p>
          <p>
            And He was crucified for us under Pontius Pilate, suffered and was
            buried. And on the third day He rose from the dead, according to the
            scriptures, ascended into the heavens and sat at the right hand of
            His Father; and He is coming again in His glory to judge the living
            and the dead, whose kingdom shall have no end.
          </p>
          <p>
            Yes, we believe in the Holy Spirit, the Lord, the Giver of Life, who
            proceeds from the Father; who, with the Father and the Son, is
            worshipped and glorified; who spoke by the prophets.
          </p>
          <p>
            And in one holy, catholic and apostolic Church. We confess one
            baptism for the remission of sins. We look for the resurrection of
            the dead, and the life of the age to come. Amen.
          </p>
        </blockquote>
      </Subsection>

      <Subsection title="The Coptic language">
        <p>
          The first Christians in Egypt prayed in Coptic — not a borrowed
          language but their own, the ancient Egyptian of the pharaohs carried
          forward and written in Greek letters, with seven extra letters kept
          from Demotic for the sounds Greek had no use for. It remained the
          Church&rsquo;s main language until the eleventh century, and it is
          still what the hymns are sung in.
        </p>

        <p className="tour-lede-inline">Here is one of them.</p>
        <HymnTable />

        <p>Write your own name in the same letters:</p>
        <CopticName />
      </Subsection>

      <Subsection title="The Coptic calendar">
        <p>
          The Alexandrian calendar is the oldest calendar in history, and it was
          set by the stars. The Egyptians watched for the star they called
          Sothis — Sirius — to reappear at dawn, and fixed the year by it.
        </p>
        <p>
          Its count of years begins in 284 A.D. and is called{' '}
          <em>Anno Martyrum</em>, the Year of the Martyrs. That date is the start
          of the reign of the Emperor Diocletian, who is remembered for
          persecuting Christians more savagely than any emperor before him.
          Choosing it was deliberate. The Church dates itself from the worst
          thing that was ever done to it, because what the years count from is
          the point at which dying stopped being a reason to stop believing.
        </p>
        <p>
          The month names are the ancient Egyptian ones, each named for a god
          held to govern that stretch of the farming year, and the year divides
          into three seasons of the Nile with one short month left over:
        </p>
        <CopticYear />
      </Subsection>

      <Subsection title="Relics">
        <p>
          A relic is a fragment associated with a saint, kept by the Church
          because the saint is a role model and not a memory. On the
          saint&rsquo;s feast day the relics are brought out during the service
          and carried in procession while the melody belonging to that saint is
          sung.
        </p>
      </Subsection>
    </>
  );
}

/* ── Station 2 ───────────────────────────────────────────────────────────── */

export function StationTwo() {
  return (
    <>
      <Subsection title="What an icon is">
        <p>
          <em>Icon</em> is simply the Greek word for image. The first images of
          Christ were made during His lifetime, by people who had seen Him and
          followed Him; the Evangelist Luke is held to have been among the first
          to paint and to sculpt Him, and is credited by tradition with images of
          the bleeding woman who was healed by touching Him.
        </p>
        <p>
          An icon holds past, present and future at once — the way God sees
          them — which is why nothing in one is set at a particular hour of a
          particular day.
        </p>
      </Subsection>

      <Subsection title="Three images tradition says were not painted">
        <Reveal
          label="Images not made by human hands"
          items={[
            {
              id: 'veronica',
              label: 'The Veil of St. Veronica',
              aside: 'On the road to the cross',
              body: (
                <p>
                  A cloth pressed to the face of Christ as He carried the cross,
                  which kept the impression of it.
                </p>
              ),
            },
            {
              id: 'edessa',
              label: 'The Image of Edessa',
              aside: 'Sent to a king who was ill',
              body: (
                <p>
                  Christ sent a cloth marked with His own face to the King of
                  Edessa, who was suffering from an illness.
                </p>
              ),
            },
            {
              id: 'turin',
              label: 'The Shroud of Turin',
              aside: 'Fourteen feet of linen',
              body: (
                <p>
                  A linen cloth fourteen feet long bearing the image of a
                  crucified man, front and back.
                </p>
              ),
            },
          ]}
        />
      </Subsection>

      <Subsection title="Why the faces do not look like photographs">
        <p>
          Orthodox icons are not attempts at likeness, and the flatness is not a
          want of skill. During the Italian Renaissance painters were praised
          for rendering the human body convincingly — its weight, its muscle,
          its light. An icon refuses that on purpose. The subject is the
          transfigured body, not the physical one, and a painter who draws the
          eye to the physique has painted the wrong thing.
        </p>
        <p>
          Everyone perceives God differently, so an icon is drawn simply and
          leaves room. Less is more here: an icon is a diagram, not a portrait,
          and it is not claiming to show what Jesus or the saints looked like.
        </p>
      </Subsection>

      <Subsection title="The nave, and the barrier across it">
        <p>
          The nave is where the congregation stands and sits to pray. The word
          is the word for a ship — everyone in it is on a journey to the Father,
          together, in the same vessel.
        </p>
        <p>
          Between the nave and the sanctuary there is usually a wooden barrier,
          and the icons set into it are what bridge the gap: St. Mary as mother
          to Jesus, Jesus as the doorway to the Father, St. John the Baptist as
          the last of the prophets, saying <em>make a path in the wilderness and
          get ready for the Lord</em>. The barrier separates, and the icons on it
          are how you come to know the One on the other side.
        </p>
      </Subsection>

      <Subsection title="Reading one icon: St. Mark">
        <p>
          St. Mark is this church&rsquo;s founder, and his icon is the one worth
          learning to read. He was young and always close to the Lord — one of
          the seventy rather than the Twelve, but near enough that he was at the
          wedding at Cana, and near enough that he is the man carrying the jar of
          water whom two disciples were sent to follow when they went to prepare
          the Passover. The room they prepared was in his own house (Mark
          14:13&ndash;14; Luke 22:11).
        </p>
        <p>Four things in the picture, and what each is doing there:</p>
        <Reveal
          label="Symbols in the icon of St. Mark"
          items={[
            {
              id: 'sandal',
              label: 'The loose sandal strap',
              aside: 'Alexandria, on arrival',
              body: (
                <p>
                  His sandal strap broke as he came into the city. The cobbler
                  mending it, Anianos, drove the awl through his own hand and
                  cried out <em>O One God</em> — St. Mark healed the hand, and
                  Anianos was converted, and then his household, and then a great
                  many more. The Church in Egypt starts with a broken strap.
                </p>
              ),
            },
            {
              id: 'lighthouse',
              label: 'The lighthouse and the sea',
              aside: 'Alexandria itself',
              body: (
                <p>
                  The Pharos, and the harbour it stood in. It is how the icon
                  says <em>this happened in Alexandria</em>.
                </p>
              ),
            },
            {
              id: 'angel',
              label: 'The angel with a crown',
              aside: 'In some icons',
              body: (
                <p>
                  His martyrdom. An angel appeared to him in prison to tell him
                  his hour had come, and the crown is what a martyr receives.
                </p>
              ),
            },
            {
              id: 'lion',
              label: 'The lion',
              aside: 'Of the four creatures, his',
              body: (
                <>
                  <p>
                    Mark opens his Gospel with John the Baptist as a voice
                    crying in the wilderness — a lion roaring in the desert
                    (Mark 1:3).
                  </p>
                  <p>
                    There is also the story from Jordan, where a lion and a
                    lioness came at Mark and his father, and Mark&rsquo;s prayer
                    struck the beasts dead; his father was converted by it. Of
                    the four incorporeal creatures, Mark is the lion: roaring in
                    the desert with prophetic power, proclaiming Jesus as king.
                  </p>
                </>
              ),
            },
          ]}
        />
      </Subsection>
    </>
  );
}

/* ── Station 3 ───────────────────────────────────────────────────────────── */

export function StationThree() {
  return (
    <>
      <Subsection title="Who wears what">
        <p>
          Nothing worn at the altar is decoration. Every garment is a statement
          about the person wearing it, and a priest and a deacon are dressed
          differently because they are doing different things.
        </p>
        <Switcher
          label="Priest and deacon"
          sides={[
            {
              id: 'priest',
              label: 'Priest',
              body: (
                <ul className="tour-vestments">
                  <li>The Tunic — <span>Tonia</span></li>
                  <li>The Presbyterial or Episcopal Stole — <span>Sadra</span></li>
                  <li>The Sleeves — <span>Epimanikia</span></li>
                  <li>The Girdle — <span>Al Mintaqa</span></li>
                  <li>The Cope — <span>Bornos</span></li>
                  <li>The Taylassan</li>
                </ul>
              ),
            },
            {
              id: 'deacon',
              label: 'Deacon',
              body: (
                <ul className="tour-vestments">
                  <li>The Tunic — <span>Tonia</span></li>
                  <li>The Stole — <span>Badrashil</span></li>
                </ul>
              ),
            },
          ]}
        />
      </Subsection>

      <Subsection title="The garments, one at a time">
        <Reveal
          label="Vestments"
          items={[
            {
              id: 'tonia',
              label: 'The Tunic',
              aside: 'Tonia',
              body: (
                <>
                  <p>
                    The white robe. White for the purity asked of anyone serving
                    God — a colour the Bible returns to again and again for the
                    same reason.
                  </p>
                  <p>
                    It is long, from the neck to the ankles, and the length is
                    the meaning: God&rsquo;s grace covering over the sins of the
                    one who is serving.
                  </p>
                </>
              ),
            },
            {
              id: 'badrashil',
              label: 'The Stole',
              aside: 'Badrashil',
              body: (
                <>
                  <p>
                    A strip of coloured, embroidered cloth, and a sign of service
                    and obedience. The word is Greek, for a grace a person takes
                    up and carries on the shoulders.
                  </p>
                  <p>
                    Deacons and archdeacons wear it over the left shoulder,
                    brought down under the right elbow, with the ends hanging
                    front and back — a wide red ribbon around the shoulders. It
                    reverses to dark blue, purple or black for funerals and for
                    Holy Week.
                  </p>
                  <p>
                    Not everyone in the choir wears one. The Chanter{' '}
                    <em>(Epsaltos)</em> wears the tunic without it. The Reader{' '}
                    <em>(Anagnostes)</em> and the Subdeacon{' '}
                    <em>(Epi-diakon)</em> wear it crossed over the back and
                    wrapped round to the front like a belt, both ends hanging
                    from the shoulders: crossed because he shares in carrying the
                    cross with Christ, belted as a sign of readiness for service —
                    John the Baptist girding his waist.
                  </p>
                </>
              ),
            },
            {
              id: 'sadra',
              label: 'The Stole of a priest',
              aside: 'Sadra',
              body: (
                <p>
                  The presbyterial or episcopal stole, which answers to the
                  breastplate Aaron was commanded to wear (Exodus 28). It is
                  essentially the deacon&rsquo;s stole worn differently — around
                  the neck instead of over one shoulder, both ends hanging in
                  front. The two ends were later joined into a single strip down
                  the front, and the seam where they were joined is still
                  visible.
                </p>
              ),
            },
            {
              id: 'emma',
              label: 'The Hat',
              aside: "Em'ma",
              body: (
                <p>
                  Worn by bishops and priests, and originally a cap with a turban
                  wound around it. It means one thing, and it means it at the
                  person wearing it: that a bishop, a priest, a pope, however
                  much authority he has been given, is still under God&rsquo;s.
                </p>
              ),
            },
          ]}
        />
      </Subsection>
    </>
  );
}

/* ── Station 4 ───────────────────────────────────────────────────────────── */

export function StationFour() {
  return (
    <>
      <Subsection title="Two instruments, and no others">
        <p>
          The Coptic Church plays percussion and nothing else: small hand
          cymbals — <em>daff</em> in Arabic — and a metal triangle. A deacon
          plays them, with the <em>ma&rsquo;lm</em>, the cantor who leads the
          singing.
        </p>
        <p>
          They are not accompaniment in the ordinary sense. They keep the
          congregation together, mark where a hymn turns, and tell several
          hundred people when to come in — which is most of what an instrument
          is for in a church with no organ and no choir stalls.
        </p>
        <p>
          Both are scriptural. Hand cymbals appear in the Old Testament and the
          New — Psalm 150, and 1 Corinthians 13:1 — and the triangle is in the
          Book of Samuel.
        </p>
      </Subsection>

      <Subsection title="What the cymbals are, and how they are played">
        <p>
          A pair of slightly concave metal disks, five to seven inches across,
          with a cupped centre about an inch and a quarter deep. A hole through
          the middle takes a string, held in place by a pin, and the pin is the
          handle.
        </p>
        <Reveal
          label="Playing the cymbals"
          items={[
            {
              id: 'slide',
              label: 'The slide',
              aside: 'Diagonal',
              body: (
                <p>
                  The disks are drawn diagonally across each other rather than
                  struck together. It is the deeper of the two sounds.
                </p>
              ),
            },
            {
              id: 'circle',
              label: 'The circle',
              aside: 'Rim on rim',
              body: (
                <p>
                  The rims are turned against one another in a circular motion.
                  Alternating this with the slide is what gives a single pair of
                  cymbals more than one voice.
                </p>
              ),
            },
            {
              id: 'trill',
              label: 'The ending',
              aside: 'Trill, then clap',
              body: (
                <p>
                  A hymn is closed with a trill on the rims and a single clap.
                  When you hear it, the hymn has finished — that is the signal
                  the congregation is listening for.
                </p>
              ),
            },
          ]}
        />
        <p className="note">
          At the festival, the youth musicians play these here. Ask them to
          show you the difference between the two strokes.
        </p>
      </Subsection>

      <Subsection title="Tasbeha — the midnight praises">
        <p>
          Tasbeha is the praise the Church keeps at night, and part of it is sung
          with the cymbals and the triangle. It is the service that runs from
          late evening towards morning, and it is where most Copts learn the
          hymns they know by heart.
        </p>
      </Subsection>
    </>
  );
}

/* ── Station 5 ───────────────────────────────────────────────────────────── */

export function StationFive() {
  return (
    <>
      <Subsection title="The ney">
        <p>
          The ney is an end-blown flute — a length of reed with six holes in
          front and one behind, and no mouthpiece at all. It is central to
          Persian, Turkish, Jewish and Arabic music, and in several of those
          traditions it is the only wind instrument used.
        </p>
        <p>
          It has been played continuously for something between four and a half
          and five thousand years, back to ancient Egypt, which makes it one of
          the oldest instruments still in use anywhere in the world. The
          musicians painted on the walls of Egyptian tombs are playing an
          instrument a player today would recognise.
        </p>
        <p>
          Because there is no mouthpiece, the sound is made entirely by the
          player&rsquo;s lips against the rim of the reed. That is why it takes
          years to get a note out of one, and why it sounds like breath.
        </p>
      </Subsection>

      <Subsection title="And the oud">
        <p>
          The ney&rsquo;s usual companion: a short-necked lute with a bent-back
          pegbox and no frets, which is what gives it the sliding tones that a
          guitar cannot make.
        </p>
      </Subsection>
    </>
  );
}

/* ── Station 6 ───────────────────────────────────────────────────────────── */

export function StationSix() {
  return (
    <>
      <Subsection title="What is on the altar">
        <Reveal
          label="Items used during the liturgy"
          items={[
            {
              id: 'censer',
              label: 'The Censer',
              aside: 'And the incense in it',
              body: (
                <>
                  <p>
                    Three chains, for the Holy Trinity. The censer with its coal
                    is St. Mary&rsquo;s womb, carrying Jesus; the priest raising
                    it is prayer going up to heaven; and the bells on it are
                    there to keep the people praying awake to what they are
                    doing.
                  </p>
                  <p>
                    Incense runs through both Testaments — the angel appearing to
                    Zechariah in the temple as he offered it; frankincense among
                    the first gifts brought to the infant Christ; and in
                    Revelation, John seeing an angel burning incense in a golden
                    censer (Rev 8:3&ndash;4).
                  </p>
                  <ul className="tour-parts">
                    <li>
                      <strong>The upper dome</strong> heaven
                    </li>
                    <li>
                      <strong>The lower dome</strong> the womb of St. Mary
                    </li>
                    <li>
                      <strong>The coal</strong> Christ&rsquo;s humanity
                    </li>
                    <li>
                      <strong>The fire</strong> Christ&rsquo;s divinity
                    </li>
                  </ul>
                </>
              ),
            },
            {
              id: 'ark',
              label: 'The Throne',
              aside: 'The Ark',
              body: (
                <p>
                  A box at the centre of the altar — in Coptic{' '}
                  <em>pi totc</em>, a seat or a throne — cubicle-shaped with high
                  flaps, which the chalice stands in. It is called the Ark
                  because the life-giving Blood it holds answers to the pot of
                  manna kept in the Ark of the Covenant, which was itself a sign
                  of the true Body of Christ.
                </p>
              ),
            },
            {
              id: 'chalice',
              label: 'The Chalice',
              aside: 'The Communion Cup',
              body: (
                <p>
                  Wine mixed with water, consecrated into the Blood of the Lord
                  during the Liturgy of the Eucharist — following Christ&rsquo;s
                  own use of the cup (Matthew 26:26&ndash;27) and the
                  Apostles&rsquo; after Him. St. Paul calls it the Cup of
                  Blessing and the Cup of the Lord (1 Corinthians 10:16, 21).
                </p>
              ),
            },
            {
              id: 'paten',
              label: 'The Paten',
              aside: 'A plain round tray',
              body: (
                <p>
                  Silver or gold, without a stand and without engraving. It
                  stands for the Lord&rsquo;s manger and for His tomb — the two
                  places He was laid. Christ used it at the Last Supper (Matthew
                  26:26&ndash;27), and the Apostles after Him (1 Corinthians
                  10:16).
                </p>
              ),
            },
            {
              id: 'orban',
              label: 'The Orban',
              aside: 'The communion bread',
              body: (
                <>
                  <p>
                    Round, because a circle has no beginning and no end, as
                    Christ is everlasting. A large cross in the centre is Jesus
                    Christ; the twelve smaller crosses around it are the twelve
                    disciples.
                  </p>
                  <p>
                    Five holes are pierced through it, for His wounds: three for
                    the nails in the hands and the feet, one for the crown of
                    thorns, one for the spear in His side.
                  </p>
                  <p>
                    Around the edge it is printed in Coptic —{' '}
                    <em>Agios Otheos, Agios Esheros, Agios Athanatos</em>: Holy
                    God, Holy Mighty, Holy Immortal.
                  </p>
                </>
              ),
            },
          ]}
        />
      </Subsection>

      <Subsection title="The seven sacraments">
        <p className="tour-lede-inline">
          A sacrament is an invisible grace received through a visible rite — a
          sign or a substance, administered by a priest. There are seven, and
          each has its own.
        </p>
        <Reveal
          label="The seven sacraments"
          items={[
            {
              id: 'baptism',
              label: 'Baptism',
              aside: 'Water',
              body: (
                <p>
                  Instituted by Christ&rsquo;s own baptism in the Jordan, by what
                  He said to Nicodemus (John 3), and by what He commanded the
                  Apostles (Matthew 28:19).
                </p>
              ),
            },
            {
              id: 'chrismation',
              label: 'Confirmation',
              aside: 'The oil of Myron',
              body: (
                <p>
                  Rooted in John 7:37&ndash;39 and Acts 8:14&ndash;17. As the
                  believers grew too many for the Apostles to lay hands on each
                  one, the Myron was developed — oil mixed with the spices that
                  had been used to embalm the body of Christ — so that priests
                  could anoint new believers to the same effect.
                </p>
              ),
            },
            {
              id: 'confession',
              label: 'Confession',
              aside: 'The prayer of absolution',
              body: (
                <p>
                  Repentance. The sign is the confessing person receiving the
                  prayer of absolution. Matthew 18:18; John 20:21&ndash;22.
                </p>
              ),
            },
            {
              id: 'eucharist',
              label: 'Eucharist',
              aside: 'Bread and wine',
              body: (
                <p>
                  Transformed into the Body and Blood of Christ. Instituted at
                  the Last Supper (Mark 14:22&ndash;24).
                </p>
              ),
            },
            {
              id: 'unction',
              label: 'Unction of the Sick',
              aside: 'Oil',
              body: (
                <p>
                  For healing, of the body and of the mind. Matthew 10:8; Luke
                  10:8; Mark 6:13; James 5:14&ndash;15.
                </p>
              ),
            },
            {
              id: 'matrimony',
              label: 'Holy Matrimony',
              aside: 'The prayers over the couple',
              body: (
                <p>
                  The sign is the bride and groom receiving the prayers that
                  unite them in body and in spirit. Instituted by Christ&rsquo;s
                  presence at the wedding at Cana (John 2:1&ndash;11); St. Paul
                  calls marriage a great mystery, reflecting Christ and the
                  Church (Ephesians 5:32).
                </p>
              ),
            },
            {
              id: 'priesthood',
              label: 'Priesthood',
              aside: 'The laying on of hands',
              body: (
                <p>
                  The sign is the ordained person receiving the prayers and the
                  laying on of hands. Instituted when Christ chose the Twelve
                  after a night of prayer (Luke 6:12&ndash;13) and sent them out
                  (Matthew 28:19&ndash;20; John 20:23).
                </p>
              ),
            },
          ]}
        />
      </Subsection>

      <Subsection title="The liturgy, told as a wedding">
        <p>
          This is how the shape of the service is taught: not as a list of parts
          but as a courtship, in order, each stage following from the one before
          it.
        </p>
        <Stepper
          label="The liturgy as a wedding"
          steps={[
            {
              id: 'preparation',
              title: 'The Groom’s invitation',
              service: 'Vespers, Matins and the midnight praises',
              body: (
                <>
                  <p>
                    The Groom knocks, to say that the proposal is coming. The
                    bride — the Church — cannot sleep, and stays up praising Him
                    all night.
                  </p>
                  <p className="tour-quote">
                    Arise, O you children of the night, let us praise the Lord of
                    Hosts, that He may grant us the salvation of our souls.
                  </p>
                </>
              ),
            },
            {
              id: 'meeting',
              title: 'The meeting',
              service: 'The Offering of the Lamb',
              body: <p>The Groom arrives, and formally proposes.</p>,
            },
            {
              id: 'dialogue',
              title: 'The dialogue',
              service: 'The readings',
              body: (
                <p>
                  The bride&rsquo;s family asks to know Him better. The Church
                  listens — the Pauline, the Catholic, the Praxis, the
                  Synaxarium, the Psalm and the Gospel — and in them He tells
                  them His life and what He believes.
                </p>
              ),
            },
            {
              id: 'reconciliation',
              title: 'Reconciliation',
              service: 'Before the union proceeds',
              body: (
                <p>
                  Whatever stands between the Groom and the bride is taken out of
                  the way first. Nothing goes further until it is.
                </p>
              ),
            },
            {
              id: 'marriage',
              title: 'The marriage',
              service: 'The Eucharistic Liturgy',
              body: (
                <p>
                  The bride asks whether He really loves her. He answers by being
                  broken into pieces for her, in the breaking of the bread — and
                  she takes His Body and His Blood. That is the union, and it is
                  where the service has been going the whole time.
                </p>
              ),
            },
          ]}
        />
        <p className="tour-close">
          Which is why the liturgy is not called a ritual but a battle of the
          morning: something to be prepared for and taken part in, not attended.
          Servants and parents are asked to help children taste and experience
          Christ here — not simply to bring them.
        </p>
      </Subsection>
    </>
  );
}

/** Station number to its content, so `TourScreen` stays a layout and nothing
 *  else. A seventh station is a component and one line here. */
export const STATION_CONTENT: Record<string, () => React.JSX.Element> = {
  'station-1': StationOne,
  'station-2': StationTwo,
  'station-3': StationThree,
  'station-4': StationFour,
  'station-5': StationFive,
  'station-6': StationSix,
};
