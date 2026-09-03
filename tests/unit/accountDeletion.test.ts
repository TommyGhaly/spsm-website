import { describe, expect, it } from 'vitest';
import {
  CONFIRM_LOCKOUT_FIELD,
  LOCKOUT_NOT_CONFIRMED,
  lockoutAcknowledged,
} from '@spsm/shared';

/**
 * The one gate between a superadmin's mis-click and an irreversible delete.
 *
 * `deleteOwnAccount` refuses a superadmin unless the request body says the
 * lockout was acknowledged, so everything worth testing here is the question
 * "does this body count as a yes" — and the answers that matter are the ones
 * that must come back **false**. A body arriving in an unexpected shape has to
 * fail closed: read as a confirmation, it deletes the only account that can
 * appoint an administrator, and the person who typed nothing gets no warning.
 */
describe('lockoutAcknowledged', () => {
  it('accepts the parsed object the browser sends', () => {
    expect(lockoutAcknowledged({ [CONFIRM_LOCKOUT_FIELD]: true })).toBe(true);
  });

  it('accepts the same thing as a raw JSON string', () => {
    // No content type, or a body parser that declined it — `onRequest` hands
    // the handler a string in both cases.
    expect(lockoutAcknowledged(JSON.stringify({ [CONFIRM_LOCKOUT_FIELD]: true }))).toBe(true);
  });

  it('refuses an ordinary delete, which sends no body at all', () => {
    // The non-superadmin path. It must stay a refusal *for a superadmin* while
    // remaining the normal request for everybody else.
    expect(lockoutAcknowledged(undefined)).toBe(false);
    expect(lockoutAcknowledged(null)).toBe(false);
    expect(lockoutAcknowledged('')).toBe(false);
    expect(lockoutAcknowledged({})).toBe(false);
  });

  it('refuses everything merely truthy', () => {
    /*
     * The heart of it. Each of these is something a loose `=== true` slip or a
     * `Boolean(...)` would wave through, and each is a body that never meant to
     * confirm anything: a form-encoded post, a serialisation that stringified
     * the boolean, a client sending a count.
     */
    for (const value of ['true', 1, 'yes', {}, [], 'on']) {
      expect(lockoutAcknowledged({ [CONFIRM_LOCKOUT_FIELD]: value })).toBe(false);
    }
  });

  it('refuses a body that is not JSON, rather than throwing', () => {
    // A `JSON.parse` throw here would surface as a 500 on a delete request,
    // which reads to the caller like "something broke mid-delete".
    expect(lockoutAcknowledged('confirmLockout=true')).toBe(false);
    expect(lockoutAcknowledged('<html>')).toBe(false);
    expect(lockoutAcknowledged('[')).toBe(false);
  });

  it('refuses a JSON body that is not an object', () => {
    expect(lockoutAcknowledged('true')).toBe(false);
    expect(lockoutAcknowledged('null')).toBe(false);
    expect(lockoutAcknowledged('7')).toBe(false);
  });

  it('ignores the field name being present without the value', () => {
    expect(lockoutAcknowledged({ [CONFIRM_LOCKOUT_FIELD]: false })).toBe(false);
    expect(lockoutAcknowledged({ [CONFIRM_LOCKOUT_FIELD]: undefined })).toBe(false);
  });

  it('names what to do in the refusal the browser shows', () => {
    // The sentence is shared so this test and the dialog cannot drift; what is
    // worth pinning is that it tells somebody how to proceed rather than only
    // that they were stopped.
    expect(LOCKOUT_NOT_CONFIRMED).toMatch(/confirm/i);
    expect(LOCKOUT_NOT_CONFIRMED).toMatch(/superadmin/i);
  });
});
