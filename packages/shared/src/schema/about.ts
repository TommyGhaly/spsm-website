/**
 * Staff's edits to the five About pages, and to /privacy.
 *
 * ---------------------------------------------------------------------------
 * ## What this is not
 *
 * It is not a page model. The five parts of About — `who-we-are`,
 * `our-belief`, `patron-saints`, `welcome-newcomers`, `future-plans` — are
 * hand-written React with bespoke machinery in them: a stamp passport, a
 * flythrough with captions, the Creed in stanzas, two dated spines, the feast
 * tables. They were pulled *out* of the `content` collection precisely because
 * a title and a markdown body could not hold any of that, and
 * `app/about/[page]/page.tsx` was deleted along with them.
 *
 * Nothing here reverses that. What this adds is an **overlay**: each coded band
 * declares a few named slots — a heading, a paragraph, a picture — and this
 * document may override them. The band keeps its layout, its widgets, its
 * srcsets and its alt text; only the words and the photograph inside a declared
 * slot can be replaced, and only where a developer has declared one.
 *
 * A slot nobody has declared cannot be reached, which is deliberate. The Creed
 * is not editable prose, and neither is a computed feast date.
 *
 * ## One document per page, and a closed list of pages
 *
 * `aboutOverrides/{slug}`, and the rule refuses any id not in `ABOUT_SLUGS` —
 * a new editable page is a code change, because it needs a route file that
 * `output: 'export'` can enumerate and a band manifest in
 * `features/about/slots.ts`. See `features/content/about.ts`.
 *
 * Appended sections are an array **inside** the same document rather than a
 * subcollection. Three reasons and the third decided it: the counts are tiny,
 * a reorder is one write instead of N, and the browser's live refresh is then a
 * single `GET` of one document by id — never a `list`, so the published-filter
 * trap in docs/decisions.md #10 cannot apply here at all.
 *
 * ## Absence means the coded default, and so does emptiness
 *
 * This is the load-bearing rule of the whole feature and it has been got wrong
 * on this site before: the live product swap once believed an empty
 * `imagePaths` and blanked every cover in the shop. So the merge helpers below
 * treat `undefined`, `null`, `''` and `'   '` identically — as *no override*.
 *
 * The consequence staff actually feel: clearing a box restores the original
 * words rather than emptying the page. There is no other undo, and there does
 * not need to be one.
 * ---------------------------------------------------------------------------
 */
import type { AuditFields } from './common.js';

/**
 * Every page this overlay can edit. There will not be a seventh without a route
 * file and a band manifest beside it.
 *
 * ---------------------------------------------------------------------------
 * `privacy` is not part of About and the name of this constant is now half a
 * lie, which is the honest trade and worth stating rather than renaming the
 * collection under a live document. Tommy asked for /privacy to be editable
 * *the same way* the About pages are, on *the same flag*, and the machinery
 * that does that is all keyed off this list: the rule, the slot manifest, the
 * picker, the live refresh, the appended sections. A parallel `privacyOverride`
 * collection with its own rule, its own hook and its own editor would be the
 * same feature twice, and the second copy is the one that rots.
 *
 * What makes it a good fit rather than a convenient one: /privacy is
 * hand-written React for the same reason `our-belief` is — bands, a computed
 * ground counter, no `<details>` — and its accuracy is tied to the code beside
 * it. So the overlay's central restraint applies unchanged: a developer
 * declares which sentences staff may rewrite, and the page's own structure is
 * not among them. The page's header comment carries the standing warning that
 * a change to what the site *does* is a change to what this page *says*, and
 * that warning now has to be read by whoever edits the words as well.
 * ---------------------------------------------------------------------------
 */
export const ABOUT_SLUGS = [
  'who-we-are',
  'our-belief',
  'patron-saints',
  'welcome-newcomers',
  'future-plans',
  'privacy',
] as const;

export type AboutSlug = (typeof ABOUT_SLUGS)[number];

export function isAboutSlug(value: unknown): value is AboutSlug {
  return typeof value === 'string' && (ABOUT_SLUGS as readonly string[]).includes(value);
}

/**
 * A photograph, as a slot or a section holds one.
 *
 * `src` is either a bundled path (`/img/who/coptic-family-1280.webp`, chosen
 * from the picker's list of everything the site already ships) or a Storage
 * download URL from an upload. Both are just an `<img src>`, which is why one
 * field covers both — and why nothing here tries to build a srcset: the coded
 * `<Plate>` has one because the build knew the file, and an uploaded
 * photograph has no derivatives to point at.
 *
 * `width`/`height` are carried when known so the box does not reflow. They are
 * optional because an uploaded file's dimensions are not known to the writer
 * without decoding it, and a missing pair costs a small jump rather than a
 * wrong picture.
 */
export interface AboutImage {
  src: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

/**
 * One coded band's overridable slot.
 *
 * Both fields optional, and both meaning "leave the coded one alone" when they
 * are absent or blank. A slot carries text *or* a picture depending on what the
 * developer declared it as; the shape is one type rather than two because the
 * editor writes into a single map and a union here would buy nothing but casts.
 */
export interface AboutSlot {
  text?: string | null;
  image?: AboutImage | null;
}

/**
 * Which ground an appended section sits on.
 *
 * Names, not colours — the same contract as `schema/theme.ts` and
 * `schema/sectionLayout.ts`, and for the same reason: the mobile app has no
 * CSS, and `'sunken'` is a key it can map where `#f4efe7` is noise. These four
 * are exactly the `band--*` modifiers the About pages already alternate
 * between.
 */
export const ABOUT_GROUNDS = ['plain', 'sunken', 'tinted', 'deep'] as const;
export type AboutGround = (typeof ABOUT_GROUNDS)[number];

export const ABOUT_SECTION_KINDS = ['prose', 'picture', 'list'] as const;
export type AboutSectionKind = (typeof ABOUT_SECTION_KINDS)[number];

interface AboutSectionBase {
  id: string;
  order: number;
  ground: AboutGround;
  heading: string;
  eyebrow?: string;
}

/**
 * A section staff added, at the foot of a page.
 *
 * Three kinds and no more. The argument is the one `sectionLayout.ts` makes at
 * length: the person using this is a volunteer a few times a year, and a
 * vocabulary they can choose from cannot produce something broken where a free
 * canvas can. Prose, prose with a photograph beside it, and a list of terms —
 * which between them cover every band on the five coded pages that is not a
 * bespoke widget.
 */
export type AboutSection =
  | (AboutSectionBase & { kind: 'prose'; body: string })
  | (AboutSectionBase & {
      kind: 'picture';
      body: string;
      image: AboutImage;
      /** Which side the photograph takes at desk width. Stacked on a phone. */
      side: 'left' | 'right';
    })
  | (AboutSectionBase & { kind: 'list'; items: AboutListItem[] });

export interface AboutListItem {
  term: string;
  detail: string;
}

/**
 * A cap, so a runaway editor cannot write a document a browser has to parse
 * megabytes of on every visit. Twenty-four is far past anything anybody would
 * append to a page that already has eight bands.
 */
export const ABOUT_SECTION_LIMIT = 24;

export interface AboutOverride extends AuditFields {
  slug: AboutSlug;
  /** Keyed `<bandId>.<part>` — see `features/about/slots.ts` for the manifest. */
  slots: Record<string, AboutSlot>;
  sections: AboutSection[];
}

/** What a page renders from before anything has ever been written for it. */
export function emptyAboutOverride(slug: AboutSlug): {
  slug: AboutSlug;
  slots: Record<string, AboutSlot>;
  sections: AboutSection[];
} {
  return { slug, slots: {}, sections: [] };
}

/* -------------------------------------------------------------------------- */
/* The merge. Read the header before changing any of it.                       */
/* -------------------------------------------------------------------------- */

/** A string that is actually saying something. `''` and `'  '` are not. */
function said(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : value;
}

/**
 * The words to show: the override if there is one, otherwise the coded default.
 *
 * The coded default is passed as a *sentinel* by the client component rather
 * than as the text itself — the hand-written version is JSX, with links and
 * `<i lang="ar">` in it, and flattening it to a string to pass through here
 * would lose exactly the things that make it worth keeping.
 */
export function copyOf(slot: AboutSlot | undefined | null, coded: string): string {
  return said(slot?.text) ?? coded;
}

/** True when this slot has words of its own. The client renders `children` otherwise. */
export function hasCopy(slot: AboutSlot | undefined | null): boolean {
  return said(slot?.text) !== null;
}

/** The picture to show. An override with no `src` is not an override. */
export function pictureOf(
  slot: AboutSlot | undefined | null,
  coded: AboutImage,
): AboutImage {
  return hasPicture(slot) ? (slot?.image as AboutImage) : coded;
}

export function hasPicture(slot: AboutSlot | undefined | null): boolean {
  const image = slot?.image;
  if (!image || typeof image !== 'object') return false;
  return said((image as AboutImage).src) !== null;
}

function parseImage(raw: unknown): AboutImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const src = said(row['src']);
  if (src === null) return null;

  const image: AboutImage = { src: src.trim() };
  const alt = said(row['alt']);
  if (alt !== null) image.alt = alt;
  const caption = said(row['caption']);
  if (caption !== null) image.caption = caption;
  if (typeof row['width'] === 'number' && row['width'] > 0) image.width = row['width'];
  if (typeof row['height'] === 'number' && row['height'] > 0) image.height = row['height'];
  return image;
}

function parseSlots(raw: unknown): Record<string, AboutSlot> {
  if (!raw || typeof raw !== 'object') return {};
  const slots: Record<string, AboutSlot> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const slot: AboutSlot = {};
    const text = said(row['text']);
    if (text !== null) slot.text = text;
    const image = parseImage(row['image']);
    if (image) slot.image = image;
    // An empty slot is the same as no slot, and writing it would only make the
    // document grow every time somebody cleared a box.
    if (slot.text !== undefined || slot.image !== undefined) slots[key] = slot;
  }
  return slots;
}

function parseGround(raw: unknown): AboutGround {
  return (ABOUT_GROUNDS as readonly unknown[]).includes(raw) ? (raw as AboutGround) : 'plain';
}

function parseItems(raw: unknown): AboutListItem[] {
  if (!Array.isArray(raw)) return [];
  const items: AboutListItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const term = said(row['term']) ?? '';
    const detail = said(row['detail']) ?? '';
    if (term === '' && detail === '') continue;
    items.push({ term, detail });
  }
  return items;
}

function parseSection(raw: unknown, index: number): AboutSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const id = said(row['id']);
  if (id === null) return null;
  const kind = row['kind'];
  if (!(ABOUT_SECTION_KINDS as readonly unknown[]).includes(kind)) return null;

  const heading = said(row['heading']) ?? '';
  const order = typeof row['order'] === 'number' && Number.isFinite(row['order'])
    ? row['order']
    : (index + 1) * 10;
  const base: AboutSectionBase = { id: id.trim(), order, ground: parseGround(row['ground']), heading };
  const eyebrow = said(row['eyebrow']);
  if (eyebrow !== null) base.eyebrow = eyebrow;

  if (kind === 'list') {
    const items = parseItems(row['items']);
    // A list with nothing in it and no heading says nothing; dropped, like an
    // unrecognised layout in `resolveSectionLayout`.
    if (heading === '' && items.length === 0) return null;
    return { ...base, kind: 'list', items };
  }

  const body = said(row['body']) ?? '';

  if (kind === 'picture') {
    const image = parseImage(row['image']);
    if (heading === '' && body === '' && image === null) return null;
    /*
     * A picture section whose photograph has gone is still a section — it
     * degrades to prose rather than vanishing, because the words in it are
     * somebody's writing and a missing `src` is not a reason to delete them.
     */
    if (image === null) return { ...base, kind: 'prose', body };
    return {
      ...base,
      kind: 'picture',
      body,
      image,
      side: row['side'] === 'left' ? 'left' : 'right',
    };
  }

  if (heading === '' && body === '') return null;
  return { ...base, kind: 'prose', body };
}

/**
 * Everything is optional on the way in and complete on the way out.
 *
 * Total: hand it a document, a half-written seed, `undefined`, or something a
 * console edit produced, and it returns a usable override. No caller anywhere
 * touches the raw fields — same contract as `resolveSectionLayout`, and the
 * same reason. A page whose overrides are garbage renders as the coded page,
 * which is the correct failure.
 */
export function parseAboutOverride(
  slug: string,
  raw: unknown,
): { slug: AboutSlug; slots: Record<string, AboutSlot>; sections: AboutSection[] } {
  const safeSlug: AboutSlug = isAboutSlug(slug) ? slug : ABOUT_SLUGS[0];
  if (!raw || typeof raw !== 'object') return emptyAboutOverride(safeSlug);

  const row = raw as Record<string, unknown>;
  const sections: AboutSection[] = [];
  const seen = new Set<string>();

  if (Array.isArray(row['sections'])) {
    row['sections'].forEach((entry, index) => {
      const section = parseSection(entry, index);
      // Two sections with one id would key the same React element twice and
      // make a reorder move whichever the reconciler happened to pick.
      if (section === null || seen.has(section.id)) return;
      seen.add(section.id);
      sections.push(section);
    });
  }

  sections.sort((a, b) => a.order - b.order);

  return {
    slug: safeSlug,
    slots: parseSlots(row['slots']),
    sections: sections.slice(0, ABOUT_SECTION_LIMIT),
  };
}
