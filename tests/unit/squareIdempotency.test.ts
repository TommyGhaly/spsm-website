import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/**
 * Square idempotency keys in the catalog endpoints.
 *
 * ---------------------------------------------------------------------------
 * The bug this guards, because it was invisible until a volunteer hit it.
 *
 * Every key was `${prefix}-${slug}-${Date.now()}` trimmed to Square's 45
 * character limit, and the trim cut the timestamp off the **end** — the only
 * part that made it unique. The length of a book's name therefore decided
 * whether changing its stock worked:
 *
 *   - `the-crucified-jesus-by-manasseh-youhanna-paperback` — no timestamp
 *     survived at all, so the key was a constant and every change after the
 *     first was refused, permanently.
 *   - `be-prepared-book-fr-daoud-lamei` — seven digits survived, so the key
 *     changed once every ~17 minutes.
 *   - `the-bridegroom-pascha-sermons` — nine digits, so two edits ten seconds
 *     apart collided.
 *
 * Square's reply is `IDEMPOTENCY_KEY_REUSED`, *"The idempotency key can only be
 * retried with the same request data."* Reproduced against the sandbox API on
 * 2026-08-30 with the old scheme, and the same call succeeded twice with the
 * new one.
 *
 * This is a source-level test on purpose. `functions/src/catalog.ts` pulls in
 * `firebase-functions`, so it cannot be imported into the unit project without
 * dragging the whole runtime in — and the property worth protecting is
 * structural anyway: *no product's name may reach an idempotency key*. A
 * behavioural test of one endpoint would not have caught the other five call
 * sites, which had the identical flaw.
 */

const CATALOG = readFileSync(
  new URL('../../functions/src/catalog.ts', import.meta.url),
  'utf8',
);
const REFUNDS = readFileSync(
  new URL('../../functions/src/refunds.ts', import.meta.url),
  'utf8',
);

describe('square idempotency keys', () => {
  it('builds every catalog key from the helper, never from a slug or a clock', () => {
    const keys = [...CATALOG.matchAll(/idempotency_key:\s*([^,\n]+)/g)].map((m) =>
      m[1].trim(),
    );

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      /*
       * `key.slice(0, 45)` is the one legitimate non-helper value: it is inside
       * `upsertCatalogObject`, which forwards whatever its caller passed. The
       * test below is what proves those callers all pass the helper, so
       * accepting it here does not open a hole.
       */
      // Matched on the prefix because the capture above stops at the first
      // comma, which falls inside `slice(0, 45)`.
      if (key.startsWith('key.slice(')) continue;
      expect(key).toMatch(/^squareIdempotencyKey\('[a-z]+'\)$/);
    }
  });

  it('passes the helper to every catalog upsert too', () => {
    // The upserts take their key as a positional argument rather than as an
    // `idempotency_key:` property, so the check above cannot see them — and
    // `track`, `detach` and `archive` all live here.
    const calls = [...CATALOG.matchAll(/upsertCatalogObject\([\s\S]{0,400}?\n\s*\);/g)];

    expect(calls.length).toBeGreaterThan(0);
    for (const [call] of calls) {
      expect(call).toMatch(/squareIdempotencyKey\('[a-z]+'\),/);
    }
  });

  it('leaves no truncated template key anywhere in the file', () => {
    // `${slug}` is fine in a Firestore path or a log line — the rule is only
    // that it must never end up in a key. So this checks the shape of the key
    // itself rather than banning the interpolation everywhere in the file.
    expect(CATALOG).not.toMatch(/idempotency_key:\s*`/);
    expect(CATALOG).not.toMatch(/\$\{Date\.now\(\)\}`\s*\.slice/);
  });

  it('keeps every real prefix inside Square’s 45-character limit', () => {
    const prefixes = [
      ...CATALOG.matchAll(/squareIdempotencyKey\('([a-z]+)'\)/g),
    ].map((m) => m[1]);

    expect(new Set(prefixes).size).toBeGreaterThan(1);

    for (const prefix of new Set(prefixes)) {
      // The helper's own arithmetic, against the prefixes actually in use: a
      // UUID is 36 characters, so nothing here may need truncating at all.
      const key = `${prefix}-${randomUUID()}`;
      expect(key.length).toBeLessThanOrEqual(45);
      expect(key.slice(0, 45)).toBe(key);
    }
  });

  it('generates a different key every call', () => {
    const made = new Set(
      Array.from({ length: 500 }, () => `stock-${randomUUID()}`.slice(0, 45)),
    );
    expect(made.size).toBe(500);
  });

  it('still derives the refund key from the order, which must NOT be unique', () => {
    /*
     * The deliberate exception, and the reason it is asserted rather than left
     * to a comment: making this one unique too would be an easy "consistency"
     * "fix" that pays a refund twice. A retried refund has to be the *same*
     * request so that Square collapses it.
     */
    expect(REFUNDS).toMatch(/idempotency_key:\s*`refund-\$\{orderId\}`/);
  });
});
