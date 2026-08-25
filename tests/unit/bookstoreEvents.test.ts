import { describe, expect, it } from 'vitest';
import {
  MAX_TERM,
  normalizeBookstoreEvent,
  normalizeTerm,
  type BookstoreEventInput,
} from '@spsm/shared';

/**
 * The client-side half of the `bookstoreEvents` boundary.
 *
 * The rule in firestore.rules is the boundary that matters — this only shapes a
 * document so the rule will accept it. But the two must agree field for field,
 * and this suite pins the half that can be checked without an emulator: a
 * document this rejects should never be built, and a document this builds must
 * satisfy every bound the rule checks.
 */

const base: BookstoreEventInput = {
  kind: 'view',
  slug: 'be-prepared',
  visitor: '0123456789abcdef',
  day: '2026-08-23',
};

describe('normalizeBookstoreEvent', () => {
  it('shapes a product event', () => {
    expect(normalizeBookstoreEvent(base)).toEqual({
      kind: 'view',
      slug: 'be-prepared',
      term: null,
      quantity: 1,
      visitor: '0123456789abcdef',
      day: '2026-08-23',
    });
  });

  it('shapes a search event, with no slug', () => {
    const event = normalizeBookstoreEvent({ ...base, kind: 'search', term: '  St   MARY ' });
    expect(event).toMatchObject({ kind: 'search', term: 'st mary', slug: null });
  });

  it('rejects a kind it does not know', () => {
    expect(normalizeBookstoreEvent({ ...base, kind: 'purchase' as never })).toBeNull();
  });

  /*
   * The three shape rules the Firestore rule also enforces. Each one is a way a
   * hand-built document could otherwise get through the client and be silently
   * refused by the server, which is invisible — the write is fire-and-forget.
   */
  it('rejects a visitor id that is not 16 hex characters', () => {
    expect(normalizeBookstoreEvent({ ...base, visitor: 'nope' })).toBeNull();
    expect(normalizeBookstoreEvent({ ...base, visitor: 'ABCDEF0123456789' })).toBeNull();
    expect(normalizeBookstoreEvent({ ...base, visitor: '0123456789abcde' })).toBeNull();
  });

  it('rejects a day that is not YYYY-MM-DD', () => {
    expect(normalizeBookstoreEvent({ ...base, day: '23/08/2026' })).toBeNull();
    expect(normalizeBookstoreEvent({ ...base, day: '2026-8-23' })).toBeNull();
  });

  it('rejects a product event with no slug and a search with no term', () => {
    expect(normalizeBookstoreEvent({ ...base, slug: '   ' })).toBeNull();
    expect(normalizeBookstoreEvent({ ...base, kind: 'search', term: '   ' })).toBeNull();
  });

  it('never emits both a slug and a term', () => {
    const search = normalizeBookstoreEvent({ ...base, kind: 'searchZero', term: 'psalms' });
    expect(search).toMatchObject({ slug: null, term: 'psalms' });

    // A slug passed alongside a search kind is dropped, not kept — the rule
    // requires `slug == null` on a search and would refuse the document.
    const both = normalizeBookstoreEvent({
      ...base,
      kind: 'search',
      term: 'psalms',
      slug: 'be-prepared',
    });
    expect(both?.slug).toBeNull();
  });

  it('clamps a quantity to the range the rule allows, rather than passing it on', () => {
    expect(normalizeBookstoreEvent({ ...base, kind: 'cartAdd', quantity: 999 })?.quantity).toBe(1);
    expect(normalizeBookstoreEvent({ ...base, kind: 'cartAdd', quantity: 0 })?.quantity).toBe(1);
    expect(normalizeBookstoreEvent({ ...base, kind: 'cartAdd', quantity: 1.5 })?.quantity).toBe(1);
    expect(normalizeBookstoreEvent({ ...base, kind: 'cartAdd', quantity: 3 })?.quantity).toBe(3);
    expect(normalizeBookstoreEvent({ ...base, kind: 'cartAdd', quantity: 20 })?.quantity).toBe(20);
  });

  it('truncates rather than rejecting an over-long term', () => {
    const long = 'a'.repeat(MAX_TERM + 50);
    const event = normalizeBookstoreEvent({ ...base, kind: 'search', term: long });
    expect(event?.term).toHaveLength(MAX_TERM);
  });
});

describe('normalizeTerm', () => {
  it('collapses the ways two people type the same thing', () => {
    expect(normalizeTerm('St Mary')).toBe('st mary');
    expect(normalizeTerm('st  mary')).toBe('st mary');
    expect(normalizeTerm('  ST MARY ')).toBe('st mary');
  });
});
