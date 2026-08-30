/**
 * The two dated spines on /about/who-we-are.
 *
 * ---------------------------------------------------------------------------
 * The page is a history, and a history told only in paragraphs asks the reader
 * to hold the order of events in their head while they read about them. These
 * two lists do that work instead: one for the nineteen centuries in Egypt, one
 * for the sixty years in New England. Both are terse on purpose — a line each,
 * no picture, no link. Whatever needs explaining is explained in the prose
 * beside them.
 *
 * **Data, not markup.** They live here rather than as JSX in `WhoScreen` so
 * that adding an entry is one object and the ordering is visibly the file's
 * ordering. They are not from Firestore: this is not content the church revises
 * between Sundays, and a bad read must not be able to empty a page's spine.
 * Same reasoning as `ABOUT_PAGES` in `features/content/about.ts`.
 *
 * `when` is a label, not a date. "c. 43", "641", "the 1960s" and "1985" all
 * appear, because the sources are that precise and no more, and rounding a
 * century up to a year to make a type happy would be inventing history. It is
 * rendered verbatim.
 * ---------------------------------------------------------------------------
 */

export type Moment = {
  /** The year or span, exactly as it should be printed. */
  when: string;
  /** One sentence. It has to stand alone — nothing here is a continuation. */
  what: string;
};

/**
 * Egypt, from St. Mark to the emigration.
 *
 * The councils get one line each and no more. /about/our-belief is the page
 * that explains Nicaea, Ephesus and Chalcedon, and re-arguing them here would
 * make two pages that both half-cover the same ground.
 */
export const EGYPT: readonly Moment[] = [
  {
    when: 'c. 43',
    what: 'St. Mark the Evangelist preaches in Alexandria. He is martyred there, and the line of his successors has not been broken since.',
  },
  {
    when: 'c. 270',
    what: 'St. Antony goes out into the Eastern Desert. St. Pachomius gathers the first communities a generation later; monasticism begins in Egypt and spreads from it to the whole Church.',
  },
  {
    when: '284',
    what: 'Diocletian takes the throne, and the persecution under him costs Egypt more Christians than any other province. The Coptic calendar counts its years from this one — Anno Martyrum, the Year of the Martyrs.',
  },
  {
    when: '325',
    what: 'The Council of Nicaea. Athanasius of Alexandria goes as a deacon and spends the next forty-five years defending what it wrote.',
  },
  {
    when: '431',
    what: 'The Council of Ephesus, with St. Cyril of Alexandria presiding, confesses the Virgin Mary as Theotokos.',
  },
  {
    when: '451',
    what: 'The Council of Chalcedon. Alexandria holds to St. Cyril’s formula and does not receive it, and the Coptic Orthodox Church has been a separate communion from that year on.',
  },
  {
    when: '641',
    what: 'The Arab conquest of Egypt. Over the following centuries the Christians of Egypt become a minority in their own country, and the Arabic qibṭ — from the Greek for Egyptian — becomes the word Copt.',
  },
  {
    when: '828',
    what: 'Venetian merchants take the relics of St. Mark out of Alexandria. They are in Venice for the next eleven hundred years.',
  },
  {
    when: '1900',
    what: 'Habib Girgis, a lay teacher, begins the Sunday School movement — fifteen years before Egypt had public schools. It taught the generation that would later lead the Church, and he was canonised in 2013.',
  },
  {
    when: '1959',
    what: 'Pope Kyrillos VI is enthroned. In twelve years he rebuilds the monasteries, restores the shrine of St. Mina at Mariout, and begins sending priests after Copts who have left the country.',
  },
  {
    when: '1968',
    what: 'The relics of St. Mark are returned to Cairo, and the new cathedral built to receive them is consecrated on 25 June. The same year, the American law that would bring tens of thousands of Copts to the United States takes full effect.',
  },
];

/**
 * New England, from a borrowed hall to this church.
 *
 * The dates before 2016 are St. Mark of Boston's, in Natick, because this
 * church's own history starts inside theirs — they bought this building, and
 * the priest who was set here in 2016 was serving there. Telling our sixty
 * years without their thirty would be starting the story in the middle.
 */
export const NEW_ENGLAND: readonly Moment[] = [
  {
    when: 'the 1960s',
    what: 'Visiting priests begin offering the Liturgy for Egyptian Orthodox Christians around Boston, many of them students.',
  },
  {
    when: '1972',
    what: 'The congregation starts renting Sts. Constantine and Helen, a Greek Orthodox church in Cambridge.',
  },
  {
    when: 'the late 1970s',
    what: 'Copts in Massachusetts ask for a priest of their own. Fr. Salib Ava Mina is sent, and the congregation moves into a rented Episcopal church in Newtonville.',
  },
  {
    when: '1985',
    what: 'They buy 145 Oak Street in Natick — a former Protestant church — for $300,000, and found St. Mark Coptic Orthodox Church of Boston there the following year.',
  },
  {
    when: '1990',
    what: 'Fr. Mousa Elgohary becomes the first full-time Coptic Orthodox priest in New England.',
  },
  {
    when: '2013',
    what: 'The Diocese of New York and New England is established, and Bishop David is consecrated its first bishop in Cairo that November.',
  },
  {
    when: '2016',
    what: 'St. Mark of Boston buys the Church of the Holy Spirit in Wayland, and this church begins.',
  },
];
