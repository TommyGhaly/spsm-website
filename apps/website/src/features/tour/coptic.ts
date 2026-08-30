/**
 * Writing a visitor's name in Coptic letters.
 *
 * ---------------------------------------------------------------------------
 * This is the passport-card activity from the in-person tour: a child gives a
 * servant their name and gets it back written in Coptic script. It is a
 * *transliteration* — letter for letter, sound for sound — and emphatically not
 * a translation. "Michael" comes back as the Coptic letters that spell the
 * sounds of "Michael", not as Ⲙⲓⲭⲁⲏⲗ, the saint's name as the Church actually
 * writes it. The two coincide often enough to be misleading, so the component
 * says so on screen; see `CopticName`.
 *
 * Why the caveat is load-bearing: this is a Coptic Orthodox parish's website,
 * and a visitor who is handed "your name in Coptic" will believe it. Being
 * clear that a machine spelled it out phonetically is the difference between a
 * good activity and a small lie printed under the church's name.
 *
 * The alphabet is Greek-derived — twenty-four Greek letters, then seven more
 * (ϣ ϥ ϧ ϩ ϫ ϭ ϯ) taken from Demotic for Egyptian sounds Greek could not spell.
 * Those seven are why English maps onto it as well as it does: "sh" and "j"
 * have letters here that Greek alone could not have supplied.
 * ---------------------------------------------------------------------------
 */

/**
 * Latin sequences to Coptic letters, longest first.
 *
 * Order is the whole algorithm — `transliterate` walks the string trying each
 * entry in turn, so every multi-letter sequence has to precede the single
 * letters it starts with or it can never match. "sh" must come before "s", or
 * Shenouda gets ⲥ-ϩ and not ϣ.
 *
 * Choices worth defending, since a reader who knows Coptic will check them:
 *
 *   ch → ⲭ    Khi, not ϭ. English "ch" in a name is nearly always the /k/ of
 *             Christopher or Michael rather than the /tʃ/ of Charles, and Khi
 *             is what the Church itself writes in Ⲡⲓⲭⲣⲓⲥⲧⲟⲥ.
 *   th → ⲑ    Theta, one letter, as in Ⲧⲓⲙⲟⲑⲉⲟⲥ.
 *   ph, f → ⲫ Phi for both. ϥ (Fai) also exists and is the native Egyptian
 *             letter, but Greek-derived names carrying an "f" — Philopater,
 *             Sophia — are written with Phi, and those are the names people
 *             standing at this station are most likely to type.
 *   c        → ⲥ before e, i, y (Cecilia) and ⲕ elsewhere (Carol). Handled in
 *             `transliterate`, not here, because it depends on what follows.
 *   q  → ⲕ    No Coptic letter for /kw/; qu becomes ⲕⲟⲩ via this plus "u".
 *   w  → ⲟⲩ   The Coptic digraph for the /u/ and /w/ sounds.
 *   x  → ⲝ    Ksi.
 *   v  → ⲃ    Vida, which is the /v/ sound in Coptic pronunciation anyway.
 *
 * Anything unmapped — a digit, an apostrophe, a letter from another script — is
 * passed through untouched rather than dropped, so "O'Brien" keeps its
 * apostrophe and a name this table cannot spell is visibly not spelled rather
 * than silently shortened.
 */
const COPTIC: readonly (readonly [string, string])[] = [
  ['sch', 'ⲥⲭ'],
  ['tch', 'ϭ'],
  ['sh', 'ϣ'],
  ['ch', 'ⲭ'],
  ['th', 'ⲑ'],
  ['ph', 'ⲫ'],
  ['ps', 'ⲯ'],
  ['kh', 'ϧ'],
  ['ou', 'ⲟⲩ'],
  ['a', 'ⲁ'],
  ['b', 'ⲃ'],
  ['d', 'ⲇ'],
  ['e', 'ⲉ'],
  ['f', 'ⲫ'],
  ['g', 'ⲅ'],
  ['h', 'ϩ'],
  ['i', 'ⲓ'],
  ['j', 'ϫ'],
  ['k', 'ⲕ'],
  ['l', 'ⲗ'],
  ['m', 'ⲙ'],
  ['n', 'ⲛ'],
  ['o', 'ⲟ'],
  ['p', 'ⲡ'],
  ['q', 'ⲕ'],
  ['r', 'ⲣ'],
  ['s', 'ⲥ'],
  ['t', 'ⲧ'],
  ['u', 'ⲟⲩ'],
  ['v', 'ⲃ'],
  ['w', 'ⲟⲩ'],
  ['x', 'ⲝ'],
  ['y', 'ⲓ'],
  ['z', 'ⲍ'],
];

/** The letters that make a preceding "c" soft. */
const SOFTENERS = new Set(['e', 'i', 'y']);

/**
 * Spell `input` in Coptic letters.
 *
 * Case is folded before matching and no capitals are emitted. Coptic does have
 * capital forms, but a name set in mixed case in a script the reader cannot
 * read gains nothing from them, and the lowercase forms are the ones on the
 * printed passport cards.
 */
export function transliterate(input: string): string {
  const source = input.toLowerCase();
  let out = '';
  let at = 0;

  while (at < source.length) {
    // "c" first: it is the one letter whose value depends on the next one, and
    // folding that into the table would need two entries per softener.
    if (source[at] === 'c') {
      out += SOFTENERS.has(source[at + 1] ?? '') ? 'ⲥ' : 'ⲕ';
      at += 1;
      continue;
    }

    const hit = COPTIC.find(([latin]) => source.startsWith(latin, at));
    if (hit) {
      out += hit[1];
      at += hit[0].length;
      continue;
    }

    // Unmapped: keep the original character, not the lowercased one, so a
    // space stays a space and an apostrophe stays an apostrophe.
    out += input[at];
    at += 1;
  }

  return out;
}

/**
 * The Coptic year, as the Church keeps it.
 *
 * Thirteen months: twelve of thirty days each, then five or six days over. The
 * three seasons are the agricultural year of the Nile, and the month names are
 * the ancient Egyptian ones — each named for the god held to govern that part
 * of the year — carried across into a Christian calendar without being
 * renamed. That is the detail worth stopping on at this station: the Church
 * kept the farmer's calendar it found, and only changed where the count starts.
 */
export type CopticSeason = {
  id: string;
  name: string;
  gloss: string;
  months: string[];
  note: string;
};

export const COPTIC_SEASONS: readonly CopticSeason[] = [
  {
    id: 'flood',
    name: 'The Flood of the Nile',
    gloss: 'Tute → Kiahk',
    months: ['Tute', 'Baba', 'Hatur', 'Kiahk'],
    note: 'The river rises and covers the fields. The year begins here, in September, with the water.',
  },
  {
    id: 'vegetation',
    name: 'Vegetation',
    gloss: 'Tubah → Baramoudah',
    months: ['Tubah', 'Amshir', 'Baramhat', 'Baramoudah'],
    note: 'The water goes down and leaves the silt behind it. Everything that was sown comes up.',
  },
  {
    id: 'harvest',
    name: 'Reaping and Harvesting',
    gloss: 'Bashans → Misra',
    months: ['Bashans', 'Baounah', 'Abib', 'Misra'],
    note: 'The crop is cut and carried in, through the hottest part of the Egyptian year.',
  },
  {
    id: 'short',
    name: 'The Little Month',
    gloss: 'Nasie',
    months: ['Nasie'],
    note: 'Five days, or six in a leap year, left over when the twelve months of thirty are counted out. A time for feasts.',
  },
];

/**
 * The Paschal praise, as it is sung.
 *
 * The transliteration and the English are from the parish's own tour notes. The
 * Coptic column is deliberately absent: setting liturgical text in Coptic from
 * memory is how a church website ends up publishing a misspelled hymn under its
 * own name, and a missing column is a smaller fault than a wrong one. `coptic`
 * is optional on purpose — fill it in from the parish's service book and the
 * third column appears with no other change. See `HymnTable` in `content.tsx`.
 */
export type HymnLine = {
  coptic?: string;
  transliteration: string;
  english: string;
};

export const PASCHAL_PRAISE: readonly HymnLine[] = [
  {
    transliteration:
      'Pa-shois Esos Pikhrestos, fe-etaf-tonf evol-khenni-ethmo-oot, khen pi-eho-oo emah-shomt, ek-e-too-nosten khen tek-gom.',
    english:
      'O my Lord Jesus Christ, who rose from the dead, on the third day, You shall raise us with Your power.',
  },
  {
    transliteration:
      'Ni-She-robim nem ni-Seraphim, ni-angelos nem ni-arshi-angelos, ni-sete-rateia nem ni-e-exso-seia, ni-eth-ronos ni-met chois ni-gom.',
    english:
      'The Cherubim and the Seraphim, the angels and the archangels, the principalities and the authorities, the thrones and the powers.',
  },
  {
    transliteration:
      'Evosh evol evgo emmos, je ekowab owoh ekowab, ekowab epshois en-ni-e-on, ekhristos anisti ek-nekron.',
    english:
      'Proclaim saying, "Holy, holy, holy, O Lord of the ages, Christ is risen from the dead."',
  },
];
