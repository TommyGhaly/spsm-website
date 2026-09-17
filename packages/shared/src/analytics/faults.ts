/**
 * A fault: what the app was doing at the moment it broke.
 *
 * ---------------------------------------------------------------------------
 * The church's own crash reporter, and the reason it is the church's own.
 *
 * The obvious thing to reach for is Crashlytics — the Firebase project is
 * already there, the SDK is one `expo install`, and it gives native stack
 * traces this cannot. It was turned down, and not lightly. The app's privacy
 * notice tells parishioners, in plain words and twice over, that there is "no
 * analytics service, no crash reporter, no advertising identifier" in it. That
 * sentence is the reason somebody trusts a church app with a photograph of
 * their child, and it is worth more than a vendor dashboard. So a fault is one
 * document in the church's own database, read by the people who run the church,
 * and no third party is involved at any point.
 *
 * What that costs is real and should be named: a JavaScript error is all this
 * can see. A native crash — a signal in Objective-C or a Java exception — kills
 * the process before any of this runs, and is invisible here. Those show up as
 * Apple's and Google's own crash reports in App Store Connect and the Play
 * Console, which are not third-party analytics and need no disclosure, and that
 * is where to look when this collection is silent and the phone is not.
 *
 * ## The shape is small on purpose
 *
 * Everything here is either about the failure or about the build. Nothing
 * identifies a person: no uid, no device id, no email. A uid was offered and
 * turned down — it would make this collection a log of who was using the app
 * and when, which is precisely what the privacy notice says the app does not
 * keep, and it would not help anybody fix a bug. `route` is the screen's path,
 * which is a fact about the app rather than about the reader.
 *
 * **This file and the `faults` block in firestore.rules must agree field for
 * field.** A document the rule rejects is invisible: the write fails inside a
 * reporter that swallows its own errors by design — a crash reporter that
 * throws is worse than none — and nothing anywhere says why.
 * ---------------------------------------------------------------------------
 */

/**
 * How long a fault is kept, in days.
 *
 * Shorter than `EVENT_TTL_DAYS`' ninety, because a fault is only useful while
 * the build that produced it is still the build people are running, and a stack
 * trace is more revealing than a shop statistic. Thirty days is long enough to
 * notice a pattern across a release and short enough that this never becomes an
 * archive. Enforced by the rule and swept by a Firestore TTL policy on
 * `expiresAt`.
 */
export const FAULT_TTL_DAYS = 30;

/** The longest message and stack this will store, in characters. */
export const FAULT_MESSAGE_MAX = 500;
export const FAULT_STACK_MAX = 4000;

/**
 * Where the failure was caught.
 *
 *   - `render`  a React tree threw and the route's error boundary caught it.
 *   - `handler` the global handler caught what nothing else did — an error
 *               thrown outside React, or a rejected promise nobody awaited.
 */
export type FaultSource = 'render' | 'handler';

export interface FaultReport {
  /** The error's message, trimmed to `FAULT_MESSAGE_MAX`. */
  message: string;
  /** The stack, trimmed to `FAULT_STACK_MAX`. Empty when the error had none. */
  stack: string;
  /** Where it was caught. */
  source: FaultSource;
  /** The route the reader was on — a path, never a person. */
  route: string;
  /** `ios` or `android`. */
  platform: string;
  /** The app's `version` from app.config.ts, so a fault names its release. */
  version: string;
  /** Whether this came from a dev build, so local noise can be filtered out. */
  dev: boolean;
}

/** Every key a `faults` document may carry, including the two server fields. */
export const FAULT_FIELDS = [
  'message',
  'stack',
  'source',
  'route',
  'platform',
  'version',
  'dev',
  'at',
  'expiresAt',
] as const;

export const FAULT_SOURCES: readonly FaultSource[] = ['render', 'handler'];

/**
 * Cut a string to a limit without throwing on a null or an object.
 *
 * Defensive because the input is an error that has already escaped every other
 * guard in the app, and `error.message` is only a string by convention — a
 * rejected promise carries whatever it was rejected with, which is routinely
 * `undefined`, a number, or a whole response object.
 */
export function faultText(value: unknown, max: number): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (value === null || value === undefined) return '';
  try {
    return String(value).slice(0, max);
  } catch {
    return '';
  }
}
