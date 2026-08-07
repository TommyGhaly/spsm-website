/**
 * Primitives every document shares.
 *
 * Timestamps are modelled as `unknown`-ish via `TimestampLike` because the
 * client SDK, the Admin SDK, and plain JSON (static export / PWA cache) each
 * represent them differently. Convert at the edge with `toDate`, never in
 * business logic.
 */
export interface TimestampLike {
  toDate(): Date;
}

/** What a timestamp field can actually hold depending on who read the doc. */
export type Timestamped = TimestampLike | { seconds: number; nanoseconds: number } | string | Date;

export function toDate(value: Timestamped | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if ('toDate' in value && typeof value.toDate === 'function') return value.toDate();
  if ('seconds' in value) return new Date(value.seconds * 1000);
  return null;
}

/** Written by Firestore rules/triggers on every document. */
export interface AuditFields {
  createdAt: Timestamped;
  updatedAt: Timestamped;
  /** uid of the last writer. Null for anonymous/guest writes. */
  updatedBy: string | null;
}

/** Anything that can be hidden from the public site without deleting it. */
export interface Publishable {
  published: boolean;
  /** Optional embargo — render only once this passes. */
  publishAt: Timestamped | null;
}

export type DocOf<T> = T & { id: string };
