/**
 * Shared plumbing for the build-time reads each feature does.
 *
 * Lives here rather than in any one feature because every feature needs the
 * same two things: a way to fail that does not take the build down, and a way
 * to attach the document id.
 *
 * ---------------------------------------------------------------------------
 * The rule every query in this codebase has to respect
 *
 * Public collections are gated on `published == true`, so **every anonymous
 * query must filter on it**. Firestore evaluates a `list` against the query's
 * potential result set rather than the documents actually returned, so it has
 * to prove up front that nothing disallowed could come back. Drop the filter
 * and the read fails with permission-denied even against an empty collection.
 *
 * That is not a style preference — it is why `safely` re-throws on
 * permission-denied instead of swallowing it. See docs/decisions.md #10.
 * ---------------------------------------------------------------------------
 */
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { toDate, type DocOf } from '@spsm/shared';
import { isConfigured } from './firebase';

/**
 * A read that fails should not take the build down.
 *
 * A parish site whose events section is empty for one deploy is a bad
 * afternoon. A parish site that will not build is a worse one, and the failure
 * modes here — Firestore unreachable, collection not created yet, a network
 * blip — are all recoverable by fixing data rather than code.
 *
 * The exception is a rules rejection, which is re-thrown: that means the public
 * genuinely cannot read something we believe is public, so the built page would
 * be wrong rather than merely empty. Shipping it quietly would hide a real
 * authorization bug behind a blank section.
 */
export async function safely<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
  if (!isConfigured()) {
    console.warn(`[data] skipping ${what}: Firebase is not configured (see .env)`);
    return fallback;
  }
  try {
    return await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('permission-denied') || message.includes('Missing or insufficient')) {
      throw new Error(
        `[data] ${what} was denied by firestore.rules. This is not a data ` +
          `problem — the public genuinely cannot read it, so the built site ` +
          `would 403 too.\n` +
          `  Usual cause: the query is missing where('published','==',true), or ` +
          `the rule for this collection tests a field the query does not ` +
          `constrain. Firestore judges a list by what the query could return, ` +
          `not by what it did.\n  ${message}`,
      );
    }
    console.warn(`[data] ${what} failed, rendering without it: ${message}`);
    return fallback;
  }
}

/** Attach the document id, which Firestore keeps outside the data. */
export function docOf<T>(snapshot: QueryDocumentSnapshot): DocOf<T> {
  return { id: snapshot.id, ...(snapshot.data() as T) };
}

/**
 * Drop documents marked live but scheduled for later, and say so.
 *
 * Reaching this means `published: true` and a future `publishAt` on the same
 * document — the scheduler and the switch disagree. Warn rather than throw: the
 * rules already let anyone read that document, so failing the build would not
 * un-expose anything, it would only take the rest of the site down with it.
 * The fix is in the data.
 */
export function withoutEmbargoed<T extends { publishAt: unknown }>(
  what: string,
  docs: DocOf<T>[],
): DocOf<T>[] {
  const now = Date.now();
  const live = docs.filter((doc) => {
    const at = toDate(doc.publishAt as never);
    return at === null || at.getTime() <= now;
  });

  if (live.length !== docs.length) {
    const held = docs.filter((d) => !live.includes(d)).map((d) => d.id);
    console.warn(
      `[data] ${what}: ${held.length} document(s) have published:true but a ` +
        `future publishAt, so they are already publicly readable via the API ` +
        `while being held back from the site. Withheld here, but fix the data — ` +
        `set published:false and let the scheduler flip it. ids: ${held.join(', ')}`,
    );
  }
  return live;
}
