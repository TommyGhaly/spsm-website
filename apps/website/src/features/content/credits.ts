import { BELIEF_CREDITS, BELIEF_PICTURES } from '@/features/belief/images';
import { SAINT_CREDITS } from '@/features/saints/saints';
import { TOUR_CREDITS } from '@/features/tour/stations';
import { WHO_CREDITS, WHO_PICTURES } from '@/features/who/images';
import { aboutHref } from './about';

/**
 * Every picture on the site that came from somebody else, in one list.
 *
 * ---------------------------------------------------------------------------
 * **Why this exists.** Four of the About pages carry photographs and icons from
 * Wikimedia Commons — forty-nine of them — and each page keeps its own credits
 * list `visually-hidden`, because Tommy asked for the credits off the page and
 * several of the pictures are CC BY or CC BY-SA and legally cannot be dropped.
 * That satisfies the licences and satisfies view-source, and it leaves a reader
 * who genuinely wants to know where a picture came from with nowhere to look.
 *
 * The drawer on /about is that place. This module is what fills it: the four
 * sets, normalised to one shape and grouped by the page they belong to.
 *
 * **The hidden lists stay where they are.** This does not replace them. A CC BY
 * licence obliges attribution *wherever the work is published*, and the works
 * are published on those four pages — a credit filed one click away on a
 * different URL is not the same undertaking. So each page keeps its own, and
 * this is the readable copy.
 *
 * **Deep imports, on purpose.** Each source is a plain data module with no React
 * in it, imported by path rather than through its feature's barrel — the tour
 * and saints barrels re-export components, and pulling those in through here
 * would drag a component tree into every page that renders the drawer.
 *
 * Adding a fifth set is one entry in `PICTURE_CREDITS` below. Nothing else.
 * ---------------------------------------------------------------------------
 */

/** One picture, named, attributed, and linked to where it is held. */
export type PictureCredit = {
  /** A few words naming the work. Never a filename or a slug. */
  what: string;
  author: string;
  license: string;
  /** The permanent description page — the link the licences require. */
  page: string;
};

/** The credits for one page, in the order that page shows the pictures. */
export type PictureCreditGroup = {
  /** The page these belong to, named as the reader knows it. */
  label: string;
  href: string;
  /** One line on what the pictures on that page are. */
  note: string;
  items: readonly PictureCredit[];
};

export const PICTURE_CREDITS: readonly PictureCreditGroup[] = [
  {
    label: 'Who We Are',
    href: aboutHref('who-we-are'),
    note: 'Photographs and prints of the Church in Egypt and of its first churches in America.',
    items: WHO_CREDITS.map((credit) => ({
      what: WHO_PICTURES[credit.name].short,
      author: credit.author,
      license: credit.license,
      page: credit.page,
    })),
  },
  {
    label: 'Our Belief',
    href: aboutHref('our-belief'),
    note: 'Icons, manuscripts and church interiors illustrating the Creed and the sacraments.',
    items: BELIEF_CREDITS.map((credit) => ({
      what: BELIEF_PICTURES[credit.name].short,
      author: credit.author,
      license: credit.license,
      page: credit.page,
    })),
  },
  {
    label: 'Our Patron Saints',
    href: aboutHref('patron-saints'),
    note: 'Icons, museum objects and the sites of the two saints this church is named for.',
    items: SAINT_CREDITS.map((credit) => ({
      what: credit.what,
      author: credit.author,
      license: credit.license,
      page: credit.page,
    })),
  },
  {
    label: 'Welcome, Newcomers',
    href: aboutHref('welcome-newcomers'),
    note: 'The vestments, instruments and furnishings the six stations of the tour explain.',
    items: TOUR_CREDITS.map((credit) => ({
      what: credit.what,
      author: credit.author,
      license: credit.license,
      page: credit.page,
    })),
  },
];

/** How many pictures the drawer is about to list. Printed on the toggle, so a
 *  reader knows whether opening it costs them a line or fifty. */
export const PICTURE_CREDIT_COUNT = PICTURE_CREDITS.reduce(
  (total, group) => total + group.items.length,
  0,
);
