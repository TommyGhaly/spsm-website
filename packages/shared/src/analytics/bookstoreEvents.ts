/**
 * Shaping a bookstore event before it is written, and the limits that shape it.
 *
 * ---------------------------------------------------------------------------
 * This file and the `bookstoreEvents` block in firestore.rules must agree.
 *
 * The collection is `allow create` for unauthenticated callers — it has to be,
 * because the people being counted are not signed in and never will be on this
 * site. That makes the rule the only real boundary, and this module the
 * client-side mirror of it. Every bound below (`MAX_SLUG`, `MAX_TERM`,
 * `VISITOR_LENGTH`, the exact field set) is enforced twice: here so a normal
 * write is well-formed, and there so an abnormal one is refused.
 *
 * If you add a field, add it to the rule in the same commit. A document the
 * rule rejects is invisible — the write fails inside a fire-and-forget batch
 * that deliberately swallows errors, and the statistic simply stops moving.
 * ---------------------------------------------------------------------------
 */
import { BOOKSTORE_EVENT_KINDS, type BookstoreEventKind } from '../schema/analytics.js';

/** Slugs are Square catalog names; this is far above the longest real one. */
export const MAX_SLUG = 120;
/** A search box, not a document. Longer input is truncated, not rejected. */
export const MAX_TERM = 80;
/** 16 hex characters. Enough that two browsers colliding is not a concern. */
export const VISITOR_LENGTH = 16;
/** Matches `MAX_QUANTITY` in squareCheckout.ts — the cart cannot exceed it. */
export const MAX_EVENT_QUANTITY = 20;

/** How long raw events live before the TTL policy deletes them. */
export const EVENT_TTL_DAYS = 90;

/** The client's half of an event: everything except the timestamps. */
export interface BookstoreEventInput {
  kind: BookstoreEventKind;
  slug?: string | null;
  term?: string | null;
  quantity?: number;
  visitor: string;
  day: string;
}

/** What actually gets written, timestamps aside. */
export interface NormalizedBookstoreEvent {
  kind: BookstoreEventKind;
  slug: string | null;
  term: string | null;
  quantity: number;
  visitor: string;
  day: string;
}

const SEARCH_KINDS = new Set<BookstoreEventKind>(['search', 'searchZero']);

function isKind(value: unknown): value is BookstoreEventKind {
  return typeof value === 'string' && (BOOKSTORE_EVENT_KINDS as readonly string[]).includes(value);
}

/** `YYYY-MM-DD`, checked as a shape rather than as a real calendar date. */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isVisitorId(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${VISITOR_LENGTH}}$`).test(value);
}

/**
 * A search term reduced to the form two people typing the same thing share.
 *
 * Lowercased and whitespace-collapsed so `"St Mary"`, `"st  mary"`, and
 * `"ST MARY "` are one row in the report rather than three. Truncated rather
 * than rejected: someone pasting a paragraph into the search box still asked a
 * question worth counting.
 */
export function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_TERM);
}

/**
 * Validate and shape one event, or return null.
 *
 * Null rather than throwing, and the caller drops it silently. Nothing about
 * recording a statistic is worth an error in a buyer's console, let alone a
 * broken interaction — every call site here is a side effect of something the
 * person was actually doing.
 */
export function normalizeBookstoreEvent(
  input: BookstoreEventInput,
): NormalizedBookstoreEvent | null {
  if (!isKind(input?.kind)) return null;
  if (!isVisitorId(input.visitor)) return null;
  if (!isDayKey(input.day)) return null;

  const search = SEARCH_KINDS.has(input.kind);

  /*
   * The two shapes are mutually exclusive, and enforced as such.
   *
   * A `view` carries a slug and no term; a `search` carries a term and no slug.
   * Letting both be present would mean the rollup has to decide which one the
   * event "really" was, and it would decide differently from whoever reads the
   * report.
   */
  const term = search && typeof input.term === 'string' ? normalizeTerm(input.term) : '';
  if (search && !term) return null;

  const slug = !search && typeof input.slug === 'string' ? input.slug.trim().slice(0, MAX_SLUG) : '';
  if (!search && !slug) return null;

  const raw = Number(input.quantity ?? 1);
  const quantity =
    Number.isInteger(raw) && raw >= 1 && raw <= MAX_EVENT_QUANTITY ? raw : 1;

  return {
    kind: input.kind,
    slug: search ? null : slug,
    term: search ? term : null,
    quantity,
    visitor: input.visitor,
    day: input.day,
  };
}
