import type { Metadata } from 'next';
import { aboutHref, aboutPage } from '@/features/content';
import {
  FeastList,
  MERCURIUS_FEASTS,
  MINA_FEASTS,
  PictureCredits,
  SaintFigure,
  SaintTile,
} from '@/features/saints';
import { MoreOfAbout } from '@/components/MoreOfAbout';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeading } from '@/components/SectionHeading';

/**
 * Our Patron Saints — the two the church is named for.
 *
 * ---------------------------------------------------------------------------
 * **The second part of About that is not prose from the `content` collection.**
 * `app/about/[page]/page.tsx` renders a Firestore document for the parts that
 * are paragraphs; this one is paragraphs *and* seven pictures with captions,
 * two feast tables and an iconography grid, none of which a `content` document
 * can hold — its body is a single markdown string, and the pictures would
 * arrive as bare `![]()` at whatever width the prose styles happen to give
 * them, in whatever order somebody typed them.
 *
 * So the slug is listed in `NOT_PROSE` over there and this file wins, exactly
 * as `welcome-newcomers` does. If this file is ever deleted, take the slug out
 * of that list or the page 404s from a link in the masthead.
 *
 * The cost is the same one the tour pays and it should be named: staff can no
 * longer rewrite this page from the Firebase console, and fixing a word in it
 * is a deploy. It is a smaller cost here than there. A hagiography is not
 * parish news — these two lives have been told the same way since the
 * Synaxarium was compiled, and the thing on this page most likely to need
 * changing is a picture, which was never editable from the console anyway.
 *
 * **On the history.** The lives are the Coptic Synaxarium's, read against the
 * accounts the wider Church keeps, and where the two disagree — Mercurius was
 * born in Rome, or in Cappadocia — the page says that they disagree instead of
 * quietly picking one. The Julian story is given as what the Church has painted
 * rather than as something that happened, because that is its actual standing.
 * A parish website is where people come to check what the Church says, and the
 * cheapest way to lose that is to round a tradition up into a fact.
 * ---------------------------------------------------------------------------
 */

const META = aboutPage('patron-saints');
const TITLE = META?.title ?? 'Our Patron Saints';

export const metadata: Metadata = {
  title: TITLE,
  description:
    'St. Philopater Mercurius, called Abu Sefein, and St. Mina the Wonder-worker — two Roman soldiers martyred for confessing Christ, and the two names this church carries.',
  alternates: { canonical: aboutHref('patron-saints') },
};

export default function PatronSaintsPage() {
  /*
   * Grounds alternate and the count is computed, not written down — the same
   * device as `/contact`. Nothing on this page is conditional today, but a
   * hardcoded `band--sunken` is a trap for whoever adds the band that is.
   */
  let ground = 0;
  const band = () => (ground++ % 2 === 0 ? 'band' : 'band band--sunken');

  return (
    <>
      <PageHeader title={TITLE} />

      <section className={band()} aria-labelledby="both-heading">
        <div className="wrap">
          <SectionHeading
            id="both-heading"
            eyebrow="The names on this church"
            title="Two soldiers"
          />

          <div className="saints-open">
            <div className="saints-open__words">
              <p className="lede">
                Sixty years apart, two officers of the Roman army were ordered
                to sacrifice to the gods of the empire. Both refused, said why,
                and were beheaded for it. This church carries both their names.
              </p>
              <p>
                They were not bishops or theologians and neither of them wrote
                anything. What the Church has of them is how they died and what
                they said before they died, kept in the Synaxarium — the book of
                the saints, read aloud in the liturgy on the day each of them
                was killed. The Church calls that day their birth.
              </p>
              <p>
                Martyrs are not a footnote to Coptic history; they are how the
                Coptic Church counts time. Its calendar begins in the year 284,
                the year Diocletian took the throne and the persecution began
                that killed St. Mina — the Year of the Martyrs, still printed on
                every Coptic calendar. To name a church for two of them is to
                ask for their prayers, and to keep their days.
              </p>
            </div>

            {/*
              A diptych, not a hero. Two icons the same height, side by side,
              named — because "which one is which" is the first question this
              page has to answer, and a paragraph is a slow way to answer it.
              Eager, both: they are the top of the page.
            */}
            <div className="saints-open__pair">
              <SaintFigure
                slug="mercurius-icon"
                name="St. Philopater Mercurius"
                also="Abu Sefein"
                priority
              />
              <SaintFigure
                slug="mina-mosaic"
                name="St. Mina the Wonder-worker"
                also="Abu Mina"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="mercurius-heading">
        <div className="wrap saint">
          <SectionHeading
            id="mercurius-heading"
            eyebrow="About 225 to 250"
            title="St. Philopater Mercurius"
            note="Abu Sefein — father of the two swords"
          />

          <div className="saint__grid">
            <div className="saint__words">
              <p>
                Philopater is Greek for <em>lover of the Father</em>, and it is
                the name his Christian parents gave him. The accounts differ on
                where they lived: the Synaxarium read in the Coptic Church puts
                the family in Rome, and the Greek accounts put them in
                Cappadocia. From his enlistment on they agree.
              </p>
              <p>
                He joined the army at seventeen, under the emperor Decius, and
                was quickly known for it. On a campaign against the barbarians
                an angel in white stood in front of him and held out a sword,
                saying: when you have overcome your enemies, remember the Lord
                your God. The Romans won the battle, and the emperor made him a
                commander.
              </p>
              <p>
                He now had two swords — the one the army had issued him and the
                one the angel had brought. That is where the name he is usually
                called by comes from. In Egypt he is Abu Sefein,{' '}
                <span lang="ar" dir="rtl">
                  أبو سيفين
                </span>
                , the father of the two swords, and it is the two swords, not
                the sword, that the icons put in his hands.
              </p>
              <p>
                Then Decius went to the temple to burn incense and sent for him.
                He did not come. Asked why, he said that he worshipped no one
                except his Lord and his God Jesus Christ. He was stripped of his
                rank, beaten and imprisoned. The emperor did not kill him in
                Rome — the soldiers and the city were fond of him — so he was
                sent in irons to Caesarea in Cappadocia and beheaded there, on
                25 Hathor, in about the year 250. He was twenty-five.
              </p>

              <h3>The emperor under the horse</h3>
              <p>
                A hundred years later a second story attaches to him. Julian,
                the emperor who tried to give the empire back its old gods,
                marched east against Persia and did not return: he was killed by
                a spear thrown by someone nobody ever identified. What the
                Church in Cappadocia said was that St. Basil had prayed before
                the martyr's icon for the Church's deliverance, and that the
                spear in the icon came back wet.
              </p>
              <p>
                The Church has never made a doctrine of that. It has painted it
                for sixteen centuries, which is why there is a crowned man
                falling under the horse in nearly every icon of St. Mercurius,
                and a bishop watching from the edge of the frame.
              </p>

              <h3>Where he is now</h3>
              <p>
                His relics are in Old Cairo, in the church that carries his name
                inside the walled compound Egyptians call Dayr Abu Sefein. A
                convent stands beside it, and the church is one of the oldest
                still in use in the city.
              </p>

              <FeastList feasts={MERCURIUS_FEASTS} label="The Church keeps" />
            </div>

            <div className="saint__aside">
              <SaintFigure slug="mercurius-church-cairo" />
            </div>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="mina-heading">
        <div className="wrap saint">
          <SectionHeading
            id="mina-heading"
            eyebrow="About 285 to 309"
            title="St. Mina the Wonder-worker"
            note="Mari Mina el-Agaiby — Mina the miraculous"
          />

          <div className="saint__grid">
            <div className="saint__words">
              <p>
                He was born at Niceous in the Delta, the son of Eudoxius, who
                governed the town, and of Euphemia, who had no children for
                years. The Synaxarium says she prayed in front of an icon of the
                Virgin and heard the answer <em>Amen</em>, and that they took the
                boy's name from it.
              </p>
              <p>
                His father died when he was a boy. At fifteen he went into the
                army and was posted to Cotyaeum, in Phrygia. When Diocletian's
                edict against the Christians reached the garrison he handed back
                the belt of his rank and walked into the desert, where he stayed
                five years. There he saw the martyrs receiving their crowns, and
                he went back to the city.
              </p>
              <p>
                He walked into a public festival, in the middle of the crowd,
                and said out loud that he was a Christian. He was offered
                position and threatened by turns, then tortured, then beheaded,
                in about the year 309. His body was thrown on a fire and the
                fire did not consume it; his sister recovered it and brought it
                home by ship to Alexandria.
              </p>

              <h3>The camel that stopped</h3>
              <p>
                The body was loaded onto a camel to be carried out into the
                western desert. At a place near Lake Mariout the camel knelt and
                would not go on, and no other beast they loaded would go on
                either. They took that for the answer and buried him there.
              </p>
              <p>
                Later a sick animal was made well in that ground, and then
                people were, and a church was built over the grave and
                consecrated on 15 Paoni. A city grew up around it — a great
                basilica, baths, hostels, workshops, a street of shops for
                pilgrims — and the pilgrims carried the water and the oil of the
                shrine home in small clay flasks stamped with a picture of him
                standing between two kneeling camels. Those flasks have been dug
                up in Italy, in Germany, in France, which is how far the news of
                an Egyptian soldier's grave travelled.
              </p>

              <h3>Abu Mina now</h3>
              <p>
                The pilgrim city was ruined and the desert took it back. It was
                dug out again at the beginning of the twentieth century, and the
                site is a World Heritage site today — and on the list of those
                in danger, because irrigation in the fields around it has raised
                the water table under the foundations.
              </p>
              <p>
                A short distance away is the monastery Pope Cyril VI began
                building in 1959. The relics of St. Mina are kept there, and
                Pope Cyril VI is buried there himself.
              </p>

              <FeastList feasts={MINA_FEASTS} label="The Church keeps" />
            </div>

            <div className="saint__aside">
              <SaintFigure slug="mina-basilica" />
            </div>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="icons-heading">
        <div className="wrap">
          <SectionHeading
            id="icons-heading"
            eyebrow="In the icons"
            title="How to tell them apart"
            note="Both are painted as soldiers, and they are never painted the same way."
          />

          <div className="saints-look">
            <div className="saints-look__note">
              <p>
                <strong>St. Mercurius is moving.</strong> He is on a black
                horse with a sword raised in each hand, an angel over his
                shoulder holding out the second one, and a crowned man going
                down under the hooves. Everything in the frame is the moment
                after something happened.
              </p>
              <p>
                <strong>St. Mina is standing still.</strong> His hands are open
                and lifted at his sides — the way the early Church is shown
                praying, before folded hands — and a camel kneels on either side
                of him. He is almost never shown without them.
              </p>
            </div>

            {/*
              Tiles rather than figures: these three are evidence for the two
              paragraphs beside them, and a full-width plate of a museum object
              would be the biggest thing on the page for the smallest reason.
            */}
            <div className="saints-look__grid">
              <SaintTile slug="mercurius-triptych" />
              <SaintTile slug="mina-plaque" />
              <SaintTile slug="mina-ampulla" />
            </div>
          </div>
        </div>
      </section>

      {/*
        The credits are still in the document — `PictureCredits` renders them
        `visually-hidden`, which is the whole of what "hide the photo credits"
        can mean while four of the seven pictures are CC BY or CC BY-SA. See the
        note on that component before deleting anything here.

        They are no longer wrapped in a band of their own. That band existed to
        stop the "All of About" link sitting hard against the iconography grid;
        with the link gone into `MoreOfAbout` below, a band holding nothing but
        hidden text would render as an empty strip of paper.
      */}
      <PictureCredits />

      {/*
        The foot: the other four parts of About, and the way back to the index.
        It replaced a bare link — see `MoreOfAbout` for why a correct link still
        looked wrong there.
      */}
      <MoreOfAbout current="patron-saints" />
    </>
  );
}
