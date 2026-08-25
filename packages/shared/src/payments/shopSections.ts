/**
 * Dividing the shop into its sections.
 *
 * Pure, and separate from the components that render it, for the reason every
 * other pure module here is: "which books appear under which heading, and what
 * happens to the ones nobody sorted" is a set of decisions worth pinning in
 * tests, and none of them need a browser to check.
 *
 * The sections themselves are the parish's, stored in `config/bookstore` and
 * edited in the admin drawer. Square keeps one `Bookstore` category as the gate
 * on what is in the shop at all; it knows nothing about these divisions.
 */
import type { BookstoreSection } from '../schema/config.js';

/** The least this needs to know about a product. Deliberately not `Product`. */
export interface Sortable {
  slug: string;
  section?: string | null;
}

export interface ShopGroup<T> {
  /** The section's id, or null for the unsorted group. */
  id: string | null;
  label: string;
  items: T[];
}

/**
 * What the unsorted group is called.
 *
 * It gets a name like the others rather than being silently appended, because a
 * book that nobody has filed is still for sale and a shopper should not have to
 * work out why it is missing from every category.
 *
 * Short, because this is a *pill* now rather than a heading over a shelf — it
 * sits in a row with "All", "Books" and "Icons", and "More from the bookstore"
 * was three times the width of its neighbours.
 */
export const UNSORTED_LABEL = 'Everything else';

/**
 * Group products under their sections, in the parish's chosen order.
 *
 * ---------------------------------------------------------------------------
 * Three rules, and each exists because the alternative loses a book.
 *
 *  1. **An empty section is dropped.** A heading with nothing under it is a
 *     heading that reads as a loading failure. The section still exists in the
 *     config and comes back the moment something is filed into it.
 *
 *  2. **A product whose section was deleted is not lost.** It keeps a dangling
 *     id, matches no section, and falls into the unsorted group — where it is
 *     visible and can be re-filed. Dropping it instead would take a book off the
 *     shop as a side effect of renaming a heading.
 *
 *  3. **No sections at all means one undivided list, with no heading.** That is
 *     the state every parish starts in, and it must render exactly as the shop
 *     did before sections existed rather than growing a "More from the
 *     bookstore" heading over the entire catalog.
 * ---------------------------------------------------------------------------
 */
export function groupProducts<T extends Sortable>(
  products: readonly T[],
  sections: readonly BookstoreSection[],
): ShopGroup<T>[] {
  if (sections.length === 0) {
    return products.length > 0 ? [{ id: null, label: '', items: [...products] }] : [];
  }

  const known = new Set(sections.map((section) => section.id));
  const byId = new Map<string, T[]>();
  const unsorted: T[] = [];

  for (const product of products) {
    const id = product.section;
    if (id && known.has(id)) {
      const bucket = byId.get(id);
      if (bucket) bucket.push(product);
      else byId.set(id, [product]);
    } else {
      unsorted.push(product);
    }
  }

  const groups: ShopGroup<T>[] = [];
  for (const section of sections) {
    const items = byId.get(section.id);
    if (items && items.length > 0) {
      groups.push({ id: section.id, label: section.label, items });
    }
  }

  if (unsorted.length > 0) {
    /*
     * Only headed when there is something above it to be distinguished from. If
     * every product is unsorted, the sections that exist are all empty and the
     * shop is effectively undivided — so it gets the same bare list as a shop
     * with no sections at all.
     */
    groups.push({
      id: null,
      label: groups.length > 0 ? UNSORTED_LABEL : '',
      items: unsorted,
    });
  }

  return groups;
}

/** How many products sit in each section, for the admin's counts. */
export function countBySection<T extends Sortable>(
  products: readonly T[],
  sections: readonly BookstoreSection[],
): Map<string | null, number> {
  const known = new Set(sections.map((section) => section.id));
  const counts = new Map<string | null, number>();
  for (const section of sections) counts.set(section.id, 0);
  counts.set(null, 0);

  for (const product of products) {
    const id = product.section && known.has(product.section) ? product.section : null;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Move a section within the list, returning a new array.
 *
 * Clamped rather than wrapped: pressing Up on the first section should do
 * nothing, not send it to the bottom. A control that teleports the thing you
 * are nudging is one nobody trusts the second time.
 */
export function moveSection(
  sections: readonly BookstoreSection[],
  id: string,
  by: number,
): BookstoreSection[] {
  const from = sections.findIndex((section) => section.id === id);
  if (from < 0) return [...sections];

  const to = Math.max(0, Math.min(sections.length - 1, from + by));
  if (to === from) return [...sections];

  const next = [...sections];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}
