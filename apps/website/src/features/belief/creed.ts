/**
 * The Nicene Creed, as the Coptic Orthodox Church says it in English.
 *
 * The text is `content/beliefs/30-nicene-creed.md` word for word. That file is
 * a `content` draft that has never been published, and this page does not read
 * the `content` collection — but the words a church says are not a thing to
 * retype from memory, so they are copied rather than re-translated, and the two
 * must be kept in step if either is ever corrected.
 *
 * Two properties of this English are deliberate and are not to be "fixed":
 *
 *   - **"Who proceeds from the Father"**, with no *and the Son*. The Filioque
 *     is a later Western addition; the Coptic Orthodox Church says the article
 *     as the Council of Constantinople wrote it in 381.
 *   - **"Yes, we believe in the Holy Spirit"**. The Coptic text opens that
 *     article with an affirmation, and every English service book the church
 *     uses keeps the word.
 *
 * Split into stanzas because the Creed is said in breaths, not in one block,
 * and because the page walks back through it clause by clause afterwards. The
 * `id`s are what those later sections point at.
 */

export type CreedStanza = {
  id: string;
  /** What this stanza is about, for the section that walks back through it. */
  about: string;
  /** One line per line of the Creed, exactly as it is said. */
  lines: readonly string[];
};

export const CREED: readonly CreedStanza[] = [
  {
    id: 'creed-father',
    about: 'the Father',
    lines: [
      'We believe in one God, the Father Almighty,',
      'Who created Heaven and earth, and all things seen and unseen;',
    ],
  },
  {
    id: 'creed-son',
    about: 'the Son',
    lines: [
      'We believe in one Lord, Jesus Christ,',
      'The Only-Begotten Son of God,',
      'begotten of the Father before all ages,',
      'Light of Light, True God of True God,',
      'begotten, not created;',
      'Of one essence with the Father;',
      'By Whom all things were made:',
      'Who for us men and for our salvation came down from Heaven',
      'And was incarnate of the Holy Spirit and the Virgin Mary,',
      'And was made man;',
    ],
  },
  {
    id: 'creed-cross',
    about: 'the Cross and the Resurrection',
    lines: [
      'And He was crucified for us under Pontius Pilate,',
      'He suffered and was buried;',
      'The third day He rose from the dead, according to the Scriptures;',
      'And ascended into Heaven, and sits at the right hand of the Father;',
      'And He shall come again in His glory to judge the living and the dead;',
      'Whose Kingdom shall have no end.',
    ],
  },
  {
    id: 'creed-spirit',
    about: 'the Holy Spirit, the Church and the age to come',
    lines: [
      'Yes, we believe in the Holy Spirit, the Lord and Giver of Life,',
      'Who proceeds from the Father, Who with the Father and the Son',
      'Together is worshiped and glorified, Who spoke in the prophets.',
      'And in One Holy Catholic and Apostolic Church.',
      'We acknowledge one Baptism for the remission of sins.',
      'We look for the Resurrection of the dead',
      'And the life of the coming age. Amen.',
    ],
  },
];
