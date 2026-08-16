/**
 * Reads the servants schedule config — in the browser, after sign-in.
 *
 * Unlike every other `data.ts` in this folder, nothing here runs at build time,
 * and that is the entire design. The Breeze embed URL is a bearer credential,
 * the site is a static export, and a build-time read would bake it into a
 * public file. See packages/shared/src/schema/servants.ts.
 *
 * It therefore does not use `safely()`: that helper exists to keep a failed
 * build-time read from blanking a page, and re-throws permission-denied so a
 * rules regression is loud. Here a permission-denied is an ordinary outcome —
 * it is what a signed-in `member` gets — so the caller handles it as a state
 * rather than an error.
 */
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  DEFAULT_SERVANTS_SCHEDULE,
  SERVANTS_DOC_SCHEDULE,
  parseServantsSchedule,
  type ServantsSchedule,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

export type ScheduleResult =
  | { kind: 'ok'; schedule: ServantsSchedule }
  /** Signed in, but without the `servant` claim. Expected, not a fault. */
  | { kind: 'denied' }
  /** The document has not been created yet. */
  | { kind: 'unset' }
  | { kind: 'error'; message: string };

export async function getServantsSchedule(): Promise<ScheduleResult> {
  try {
    const snapshot = await getDoc(
      doc(db(), COLLECTIONS.servantsConfig, SERVANTS_DOC_SCHEDULE),
    );
    if (!snapshot.exists()) return { kind: 'unset' };

    const schedule = parseServantsSchedule(snapshot.data());

    // `parseServantsSchedule` blanks a URL that fails the host allowlist, so an
    // empty string here means either "never set" or "set to something we refuse
    // to frame". Both are the same instruction to whoever maintains it.
    if (schedule.embedUrl === DEFAULT_SERVANTS_SCHEDULE.embedUrl) return { kind: 'unset' };

    return { kind: 'ok', schedule };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('permission-denied') || message.includes('Missing or insufficient')) {
      return { kind: 'denied' };
    }
    return { kind: 'error', message };
  }
}
