import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUDGETS,
  callerIp,
  check,
  exclusive,
  resetLimits,
  throttled,
} from '../../functions/src/rateLimit.js';

/**
 * The throttle, tested for the behaviour that is easy to get subtly wrong.
 *
 * The counting itself is barely worth a test. What is worth one is everything
 * around it: that two endpoints cannot spend each other's allowance, that a
 * refusal carries a `Retry-After` a client can actually act on, that a 429 is
 * never cacheable — a CDN holding one would refuse the whole church wifi for as
 * long as it kept it — and that an `exclusive` hold is always given back.
 */

/** A response that records what was set on it, in the shape `throttled` needs. */
function recorder() {
  const headers: Record<string, string> = {};
  let code: number | null = null;
  let body: unknown = null;
  return {
    headers,
    get code() {
      return code;
    },
    get body() {
      return body;
    },
    set(name: string, value: string) {
      headers[name] = value;
    },
    status(next: number) {
      code = next;
      return {
        json(payload: unknown) {
          body = payload;
        },
      };
    },
  };
}

const request = (ip: string) => ({ headers: { 'x-forwarded-for': ip }, ip });

beforeEach(() => resetLimits());
afterEach(() => vi.useRealTimers());

describe('check', () => {
  it('allows exactly the budget and refuses the next', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(check('bucket', 'someone', 5).allowed, `attempt ${i + 1}`).toBe(true);
    }
    expect(check('bucket', 'someone', 5).allowed).toBe(false);
  });

  it('keeps a caller out while they keep trying, rather than letting the window carry them back in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));

    for (let i = 0; i < 3; i += 1) check('bucket', 'someone', 3);
    expect(check('bucket', 'someone', 3).allowed).toBe(false);

    // 50 seconds on: the first three are still inside the window, and so is the
    // refusal, which was recorded as it was refused.
    vi.advanceTimersByTime(50_000);
    expect(check('bucket', 'someone', 3).allowed).toBe(false);

    // Past a full window with no attempts at all, and they are welcome back.
    vi.advanceTimersByTime(61_000);
    expect(check('bucket', 'someone', 3).allowed).toBe(true);
  });

  it('counts each endpoint separately, so a form does not spend a sign-up allowance', () => {
    for (let i = 0; i < 5; i += 1) check('formSubmit', 'one-address', 5);
    expect(check('formSubmit', 'one-address', 5).allowed).toBe(false);
    expect(check('campServantRequest', 'one-address', 5).allowed).toBe(true);
  });

  it('counts each caller separately', () => {
    for (let i = 0; i < 5; i += 1) check('bucket', 'them', 5);
    expect(check('bucket', 'them', 5).allowed).toBe(false);
    expect(check('bucket', 'someone-else', 5).allowed).toBe(true);
  });

  it('reports a wait a client can act on — never zero, never longer than the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));

    check('bucket', 'someone', 1);
    vi.advanceTimersByTime(59_500);

    const verdict = check('bucket', 'someone', 1);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe('throttled', () => {
  it('lets a request through without touching the response', () => {
    const res = recorder();
    expect(throttled(request('1.2.3.4'), res, { bucket: 'b', max: 2 })).toBe(false);
    expect(res.code).toBeNull();
    expect(res.headers).toEqual({});
  });

  it('answers 429 with Retry-After, and never lets the refusal be cached', () => {
    const res = recorder();
    const req = request('1.2.3.4');
    throttled(req, res, { bucket: 'b', max: 1 });

    expect(throttled(req, res, { bucket: 'b', max: 1 })).toBe(true);
    expect(res.code).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(res.headers['RateLimit-Limit']).toBe('1');
    // The whole congregation is behind one address on a Sunday. A cached 429
    // would refuse all of them for as long as the CDN held it.
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('answers in the shape the endpoint answers in everywhere else', () => {
    const singular = recorder();
    const plural = recorder();
    throttled(request('5.6.7.8'), singular, { bucket: 'one', max: 0 });
    throttled(request('5.6.7.8'), plural, { bucket: 'two', max: 0, plural: true });

    expect(singular.body).toEqual({ error: expect.any(String) });
    expect(plural.body).toEqual({ errors: [expect.any(String)] });
  });

  it('keys on the identity it is given rather than the address', () => {
    const res = recorder();
    const sameOffice = request('9.9.9.9');

    // Two people behind one address, each with their own allowance.
    throttled(sameOffice, res, { bucket: 'b', max: 1, identity: 'uid-a' });
    expect(throttled(sameOffice, res, { bucket: 'b', max: 1, identity: 'uid-a' })).toBe(true);
    expect(throttled(sameOffice, res, { bucket: 'b', max: 1, identity: 'uid-b' })).toBe(false);
  });

  it('reads the forwarded address, not the socket, because Hosting is in front', () => {
    expect(callerIp({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }, '10.0.0.1')).toBe('203.0.113.7');
    expect(callerIp({}, '10.0.0.1')).toBe('10.0.0.1');
    expect(callerIp({}, undefined)).toBe('unknown');
  });
});

describe('exclusive', () => {
  it('gives the hold to one caller and refuses the second', () => {
    const first = exclusive('rollup');
    expect(first).not.toBeNull();
    expect(exclusive('rollup')).toBeNull();
  });

  it('hands it back on release — a leaked hold would switch the endpoint off', () => {
    const first = exclusive('rollup');
    first!();
    const second = exclusive('rollup');
    expect(second).not.toBeNull();
  });

  it('ignores a second release, so a `finally` that runs twice cannot free somebody else\'s hold', () => {
    const first = exclusive('rollup')!;
    first();
    const second = exclusive('rollup');
    expect(second).not.toBeNull();

    first(); // the stale release
    expect(exclusive('rollup')).toBeNull(); // the second hold still stands
  });

  it('is per job', () => {
    expect(exclusive('financeRollup')).not.toBeNull();
    expect(exclusive('bookstoreRollup')).not.toBeNull();
  });
});

describe('the budgets themselves', () => {
  it('keeps the order lookup the tightest public budget — it is the guessable one', () => {
    const publicBudgets = [BUDGETS.bulletin, BUDGETS.live, BUDGETS.calendar, BUDGETS.squareCheckout];
    for (const budget of publicBudgets) expect(budget).toBeGreaterThan(BUDGETS.orderLookup);
  });

  it('leaves the polled reads room for a congregation on one address', () => {
    // The homepage and the player poll once a minute each. Anything at or below
    // that many devices behind the church wifi is a limit that fails on Sunday.
    expect(BUDGETS.bulletin).toBeGreaterThanOrEqual(100);
    expect(BUDGETS.live).toBeGreaterThanOrEqual(100);
  });

  it('leaves room for a batch of photographs', () => {
    // A shelf of books at eight pictures each, in one sitting.
    expect(BUDGETS.bookstoreEdit).toBeGreaterThanOrEqual(80);
  });
});
