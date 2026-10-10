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
  /** Square subcategory ids this product is filed in. See `Product.categoryIds`. */
  categoryIds?: readonly string[] | null;
}

export interface ShopGroup<T> {
  id: string | null;
  label: string;
  items: T[];
}

export const UNSORTED_LABEL = 'Everything else';

/** A section and every section beneath it, at any depth. */
export function subtreeOf(sections: readonly BookstoreSection[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const section of sections) {
      if (section.parentId && ids.has(section.parentId) && !ids.has(section.id)) {
        ids.add(section.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** The sections directly inside `parentId` (null for the top level), in order. */
export function childSections(
  sections: readonly BookstoreSection[],
  parentId: string | null,
): BookstoreSection[] {
  const known = new Set(sections.map((section) => section.id));
  return sections.filter((section) => {
    const parent = section.parentId && known.has(section.parentId) ? section.parentId : null;
    return parent === parentId;
  });
}

/**
 * Group the products by section, for the pills and the shelf.
 *
 * ---------------------------------------------------------------------------
 * A product can be in several sections (Square allows it, and the parish asked
 * for it), so it appears in every group it belongs to. And sections nest, so a
 * group holds what is filed in it *or anywhere beneath it* — "Books" includes
 * "Arabic books". Three rules are unchanged from the flat version:
 *
 *   - an empty section is dropped,
 *   - a product filed only in sections that no longer exist is unsorted,
 *   - with no sections at all, the shop is one undivided shelf.
 *
 * Groups come out in section order (parents before their children, as the
 * list is kept), with "Everything else" last.
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
  const groups: ShopGroup<T>[] = [];
  for (const section of sections) {
    const tree = subtreeOf(sections, section.id);
    const items = products.filter((product) => (product.categoryIds ?? []).some((id) => tree.has(id)));
    if (items.length > 0) groups.push({ id: section.id, label: section.label, items });
  }

  const unsorted = products.filter((product) => !(product.categoryIds ?? []).some((id) => known.has(id)));
  if (unsorted.length > 0) {
    groups.push({ id: null, label: groups.length > 0 ? UNSORTED_LABEL : '', items: unsorted });
  }
  return groups;
}

/** How many products each section holds (subtree included), and how many none. */
export function countBySection<T extends Sortable>(
  products: readonly T[],
  sections: readonly BookstoreSection[],
): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  const groups = groupProducts(products, sections);
  for (const section of sections) counts.set(section.id, 0);
  counts.set(null, 0);
  for (const group of groups) counts.set(group.id, group.items.length);
  return counts;
}

/**
 * Square's category tree, in the order the parish arranged the pills.
 *
 * The catalog sync calls this. Square has no order for categories, so the order
 * is the parish's and lives in Firestore: categories already in `previous` keep
 * their places, new ones join after them (alphabetically, as Square lists
 * them), and ones Square no longer has are dropped. Labels and nesting always
 * come from Square.
 */
export function orderSections(
  fromSquare: readonly { id: string; label: string; parentId: string | null }[],
  previous: readonly BookstoreSection[],
): BookstoreSection[] {
  const place = new Map(previous.map((section, index) => [section.id, index]));
  const known = fromSquare
    .filter((category) => place.has(category.id))
    .sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  const added = fromSquare.filter((category) => !place.has(category.id));
  return [...known, ...added].map((category) => ({
    id: category.id,
    label: category.label,
    ...(category.parentId ? { parentId: category.parentId } : {}),
  }));
}

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
