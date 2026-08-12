/**
 * The servants schedule.
 *
 * The parish keeps its rota in Breeze ChMS and publishes it as an embeddable
 * calendar. We do not re-enter it: Breeze stays the source of truth, and the
 * website's only job is to put it in front of the right people.
 *
 * On the Wix site that page sat behind a single shared password. This replaces
 * that with Microsoft sign-in, which is what "servants can see the schedule
 * without needing a password" actually meant — there was a password, and it was
 * the same one for everybody.
 *
 * ## Why the URL lives in Firestore and not in the repo
 *
 * The Breeze embed URL carries an encrypted `calendars` token and **returns the
 * calendar to anyone who requests it** — no session, no referrer check, no
 * framing restriction. Verified against the live endpoint: HTTP 200, no
 * `X-Frame-Options`, no `Content-Security-Policy`. The URL *is* the credential.
 *
 * The website is a static export, so anything rendered into a page is in a file
 * on a CDN that anyone can fetch. Baking the URL into `/servants` would publish
 * it to the world while showing a sign-in form on top — security theatre, and
 * strictly worse than the Wix password it replaces.
 *
 * So it is read at runtime, from a collection only a signed-in servant may
 * read, and the built HTML never contains it.
 *
 * ## What this does and does not buy
 *
 * Be honest about the ceiling: a signed-in servant can open dev tools, copy the
 * URL, and send it to anyone. Breeze's embed is a bearer URL and nothing we do
 * on our side changes that. What this *does* fix is that access is now per
 * person and revocable — disable someone's account and they lose the page —
 * rather than one password that everybody knows and nobody can rotate without
 * telling forty people.
 *
 * If the calendar ever needs to be genuinely private, that is a conversation
 * with Breeze about their sharing model, not something this schema can solve.
 */
import type { AuditFields } from './common.js';

/** Document id within `servantsConfig`. */
export const SERVANTS_DOC_SCHEDULE = 'schedule';

export interface ServantsSchedule extends Partial<AuditFields> {
  /**
   * Full embed URL, including its query string. Empty until someone sets it,
   * and the page says so plainly rather than rendering a blank frame.
   */
  embedUrl: string;

  /** Shown to servants so an out-of-date rota has somewhere to be reported. */
  note: string;

  /**
   * Where to send someone who wants more than the read-only grid — the Breeze
   * login, usually. Optional.
   */
  manageUrl: string;
}

/**
 * Blank on purpose, like `DEFAULT_PARISH_CONFIG`.
 *
 * There is no sensible default for someone else's calendar URL, and inventing
 * one would render an iframe pointing nowhere. Blank makes the page say "not
 * set up yet", which is true and actionable.
 */
export const DEFAULT_SERVANTS_SCHEDULE: ServantsSchedule = {
  embedUrl: '',
  note: '',
  manageUrl: '',
};

/**
 * Only ever allow an https URL, and only on the host we expect.
 *
 * This value is rendered as an `iframe src`, so a bad edit is not a broken
 * layout — it is arbitrary third-party content inside a page our servants
 * trust, and `javascript:` in an src attribute is a script running as us. The
 * check is deliberately an allowlist rather than a blocklist.
 */
const ALLOWED_EMBED_HOSTS = ['breezechms.com'];

export function isAllowedEmbedUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_EMBED_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}

/** Per-field fallback, in the style of `parseIntegrationsConfig`. Never throws. */
export function parseServantsSchedule(raw: unknown): ServantsSchedule {
  const doc = asRecord(raw);
  const embedUrl = str(doc?.['embedUrl']) ?? '';

  return {
    // A URL that fails the allowlist is discarded rather than passed through,
    // so the page renders "not set up yet" instead of framing something unknown.
    embedUrl: isAllowedEmbedUrl(embedUrl) ? embedUrl : '',
    note: str(doc?.['note']) ?? DEFAULT_SERVANTS_SCHEDULE.note,
    manageUrl: str(doc?.['manageUrl']) ?? DEFAULT_SERVANTS_SCHEDULE.manageUrl,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}
