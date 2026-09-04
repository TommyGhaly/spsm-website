import { describe, it, expect } from 'vitest';
import {
  filingFor,
  filingsFor,
  keepPresent,
  keepPresentFilings,
} from '../../apps/website/src/features/programs/queueSelection';

/**
 * The approval queue's unsaved state.
 *
 * Two rules are being protected here, and both of them are rules somebody would
 * otherwise have to discover by losing work:
 *
 *   1. **A destination is not saved until it is approved.** Move a photograph to
 *      another week and walk away, and it is back where its sender put it. That
 *      is not a side effect of forgetting to persist — it is the behaviour Tommy
 *      asked for, and the absence of an entry in the map is what encodes it.
 *   2. **A live queue must not carry stale ids into a write.** The list arrives
 *      from a listener now, so a row can leave while somebody has it ticked, and
 *      a batch naming a document that is no longer pending fails whole.
 */

const present = (...ids: string[]) => new Set(ids);
const item = (id: string, programEventId: string) => ({ media: { id, programEventId } });

describe('keepPresent', () => {
  it('drops a tick whose row somebody else has already decided', () => {
    const kept = keepPresent(new Set(['a', 'b', 'c']), present('a', 'c'));
    expect([...kept]).toEqual(['a', 'c']);
  });

  /*
   * Identity, not just contents. This runs on every snapshot — which during an
   * upload of forty photographs is every second or two — and a new Set each
   * time re-renders every card of a screen being worked.
   */
  it('returns the same set when nothing left the queue', () => {
    const chosen = new Set(['a', 'b']);
    expect(keepPresent(chosen, present('a', 'b', 'c'))).toBe(chosen);
  });

  it('empties when the whole queue is cleared', () => {
    expect([...keepPresent(new Set(['a']), present())]).toEqual([]);
  });
});

describe('keepPresentFilings', () => {
  it('forgets where a departed row was going', () => {
    const filings = new Map([
      ['a', 'week-2'],
      ['gone', 'week-3'],
    ]);
    const kept = keepPresentFilings(filings, present('a'));
    expect([...kept]).toEqual([['a', 'week-2']]);
  });

  it('returns the same map when nothing left', () => {
    const filings = new Map([['a', 'week-2']]);
    expect(keepPresentFilings(filings, present('a', 'b'))).toBe(filings);
  });
});

describe('filingFor', () => {
  it("falls back to the sender's own choice", () => {
    expect(filingFor({ id: 'a', programEventId: 'week-1' }, new Map())).toBe('week-1');
  });

  it('prefers a destination the reviewer has picked', () => {
    expect(filingFor({ id: 'a', programEventId: 'week-1' }, new Map([['a', 'week-2']]))).toBe(
      'week-2',
    );
  });

  /*
   * The rule, stated as a test: nothing about a moved-but-unapproved photograph
   * survives losing the map, because the map is the only place the move ever
   * existed. A reload starts with an empty one.
   */
  it('reverts every unapproved move when the map is thrown away', () => {
    const media = { id: 'a', programEventId: 'week-1' };
    expect(filingFor(media, new Map([['a', 'week-9']]))).toBe('week-9');
    expect(filingFor(media, new Map())).toBe('week-1');
  });
});

describe('filingsFor', () => {
  it('writes each chosen row to wherever its own box says', () => {
    const items = [item('a', 'week-1'), item('b', 'week-1'), item('c', 'week-1')];
    const filings = new Map([['b', 'week-2']]);

    expect(filingsFor(items, present('a', 'b'), filings)).toEqual([
      { mediaId: 'a', programEventId: 'week-1' },
      { mediaId: 'b', programEventId: 'week-2' },
    ]);
  });

  it('leaves out anything that is not ticked', () => {
    const items = [item('a', 'week-1'), item('b', 'week-1')];
    expect(filingsFor(items, present('b'), new Map())).toEqual([
      { mediaId: 'b', programEventId: 'week-1' },
    ]);
  });

  /*
   * The structural half of rule 2. `keepPresent` should have removed a departed
   * id already, but this builds from the rows on screen rather than from the
   * selection, so a stale one cannot reach the batch even if it did not.
   */
  it('cannot put a row that is no longer in the queue into the batch', () => {
    expect(filingsFor([item('a', 'week-1')], present('a', 'ghost'), new Map())).toEqual([
      { mediaId: 'a', programEventId: 'week-1' },
    ]);
  });

  it('is empty when nothing is chosen', () => {
    expect(filingsFor([item('a', 'week-1')], present(), new Map())).toEqual([]);
  });
});
