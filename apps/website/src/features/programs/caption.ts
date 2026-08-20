/**
 * One short line saying what a program is, for under its name in the menu.
 *
 * Its own module, importing nothing. `nav.ts` reaches Firestore, and a pure
 * string function should not need an emulator or a path alias to be tested —
 * which is exactly what happened when this lived there: the unit test could not
 * even load the file.
 */

/**
 * One short line saying what a program is, for under its name in the menu.
 *
 * Taken from the program's own description rather than stored separately: a
 * second field would be one more thing for an administrator to fill in, and one
 * more thing to fall out of step with the page it describes.
 *
 * First sentence only, and cut hard. A dropdown is not the place to read a
 * paragraph, and an over-long caption pushes the next item down the list.
 */
const MAX_CAPTION = 62;

export function captionOf(description: string): string {
  const [firstParagraph = ''] = description.split(/\n\s*\n/);

  const plain = firstParagraph
    // Markdown marks, and link syntax reduced to its text.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // The seeded descriptions carry a "REPLACE — …" note explaining what is still
  // missing. That is a message to whoever writes the copy, not to a visitor, so
  // it never becomes a caption.
  if (plain.startsWith('REPLACE')) return '';

  const sentence = firstSentence(plain);
  if (sentence.length <= MAX_CAPTION) return sentence;

  // Cut on a word boundary rather than mid-word.
  const cut = sentence.slice(0, MAX_CAPTION);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')}…`;
}

/**
 * Titles whose full stop does not end a sentence.
 *
 * Naively splitting on ". " turned "St. Simon for Seniors offers care..." into
 * the caption "St." \u2014 which would hit most of the parish's ministries, since
 * half are named after a saint and the rest are run by a Fr. somebody. Caught
 * by reading the rendered HTML, not by any test that existed at the time.
 */
const ABBREVIATIONS = [
  'St', 'Ss', 'Fr', 'Mr', 'Mrs', 'Ms', 'Dr', 'Rev', 'Abp', 'Bp', 'approx', 'etc', 'vs',
];

/** Stands in for an abbreviation's dot while splitting. Never in real prose. */
const DOT_PLACEHOLDER = '\u0000';

function firstSentence(text: string): string {
  const guard = new RegExp(`\\b(${ABBREVIATIONS.join('|')})\\.`, 'gi');
  const masked = text.replace(guard, `$1${DOT_PLACEHOLDER}`);

  // A sentence ends at .!? followed by whitespace and a capital -- so it does
  // not break on a decimal point, and no longer on a masked abbreviation.
  const [first = masked] = masked.split(/(?<=[.!?])\s+(?=["\u2018\u201c]?[A-Z])/);

  return first.split(DOT_PLACEHOLDER).join('.').trim();
}
