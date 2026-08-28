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
 * So it lives here, and **only the `calendar` Cloud Function ever reads it**,
 * through the Admin SDK. The URL does not reach a browser at all: the Function
 * calls Breeze, reduces the answer to the fields in `schema/calendar.ts`, and
 * sends the schedule rather than the credential.
 *
 * ## What changed, and what that bought
 *
 * This used to be fetched by the *browser* after sign-in and assigned to an
 * iframe `src` — which was a real improvement on the shared Wix password, but
 * left the ceiling in plain sight: a signed-in servant could open dev tools,
 * copy the URL, and hand the parish rota to anyone, permanently, with no way to
 * tell it had happened short of rotating the token for everybody.
 *
 * Serving the *events* instead of the *URL* removes that. A servant now
 * receives 7 or 42 days of JSON, scoped to what they asked for, from an
 * endpoint that checks their ID token on every request. There is no bearer
 * credential in the client to leak, revoking an account revokes access
 * immediately rather than until the next rotation, and the servants calendar
 * stops being something the site merely declines to show.
 *
 * What it does not change: Breeze still serves that URL to anyone who has it,
 * so the token remains a credential and must never be committed or logged. It
 * is now a credential held in one place by one service account, which is the
 * whole difference.
 */
import type { AuditFields } from './common.js';

/** Document id within `servantsConfig`. */
export const SERVANTS_DOC_SCHEDULE = 'schedule';

export interface ServantsSchedule extends Partial<AuditFields> {
  /**
   * The **servants** calendar's embed URL, query string included.
   *
   * Still named `embedUrl` rather than `servantsEmbedUrl`: it is the field
   * `set-servants-schedule.mjs` writes, the field `firestore.rules` and
   * `docs/integrations.md` name, and the one already in the emulator seed. A
   * rename would be three edits and a migration to buy a better name for a
   * value whose meaning has not changed.
   */
  embedUrl: string;

  /**
   * The **parish** calendar's embed URL — the public church schedule.
   *
   * A second URL rather than a second document, because they are one setting:
   * both are Breeze embed tokens for the same subdomain, rotated in the same
   * sitting, and read by the same Function in the same request.
   *
   * Worth being clear that this one is not a secret in the way the other is.
   * The parish calendar is the public schedule; the token grants exactly what
   * the website publishes anyway. It lives here regardless, because the
   * Function is the only thing that needs it and a value no browser ever
   * receives cannot be scraped out of the exported HTML.
   */
  parishEmbedUrl: string;

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
  parishEmbedUrl: '',
  note: '',
  manageUrl: '',
};

/**
 * Only ever allow an https URL, and only on the host we expect.
 *
 * This value is now fetched server-side rather than rendered as an `iframe
 * src`, which changes what a bad edit costs but not whether the check is
 * needed. A URL nobody validated is a server-side request to wherever the last
 * person to write this document pointed it — the Function runs with the parish's
 * service-account identity and will happily fetch an internal metadata endpoint
 * if told to. An allowlist of one host is the whole defence, and it is why this
 * is an allowlist rather than a blocklist.
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
  const parishEmbedUrl = str(doc?.['parishEmbedUrl']) ?? '';

  return {
    // A URL that fails the allowlist is discarded rather than passed through,
    // so the page renders "not set up yet" instead of framing something unknown.
    embedUrl: isAllowedEmbedUrl(embedUrl) ? embedUrl : '',
    parishEmbedUrl: isAllowedEmbedUrl(parishEmbedUrl) ? parishEmbedUrl : '',
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
