'use client';

import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_CAMP,
  allFinanceScopes,
  defaultCampConfig,
  defaultProgramAdmin,
  defaultScreenAdmin,
  parseCampConfig,
  parseFinanceScopes,
  parseProgramAdmin,
  parseScreenAdmin,
  type AdminScreen,
  type FinanceScopes,
  type FinanceSource,
  type ProgramAdmin,
  type ScreenAdmin,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { forgetScreenGrants } from '@/lib/screenGrants';

/**
 * Reading and writing the parish's allocations.
 *
 * ---------------------------------------------------------------------------
 * ## What this deliberately cannot do
 *
 * **It cannot make anybody a superadmin.** Not an oversight and not a to-do:
 * `superadmin` lives in a Firebase Auth custom claim, claims are settable only
 * by the Admin SDK, and `scripts/grant-admin.mjs` is the one path. This module
 * writes the two maps on the member document, `screenAdmin` and `programAdmin`,
 * and those are enough to say who administers what precisely *because* they are
 * not claims: they take effect on the grantee's next page load rather than on
 * their next token refresh, which is up to an hour away. `programAdmin.ts`
 * makes the same argument at more length.
 *
 * So this page hands out areas and never promotes. That is the shape the whole
 * model rests on — the one privilege that bypasses every flag on this page is
 * the one privilege this page cannot grant, and it is set from a terminal by
 * somebody who meant to.
 *
 * ## Why the writes are field-scoped
 *
 * `updateDoc` with two keys, never `setDoc`. A member document holds a
 * displayName, an email, a photo, notification preferences and the claim
 * mirrors, and the allocation screen has read none of them — a whole-document
 * write from here would blank whatever it had not bothered to load. The same
 * mistake as the live catalogue swap that turned eleven book covers into
 * placeholders because it believed an absence.
 * ---------------------------------------------------------------------------
 */

/** One person, as the allocation screen needs them. */
export interface AllocatableMember {
  uid: string;
  displayName: string;
  email: string;
  /**
   * The claim *mirror*, not the claim.
   *
   * Shown so an administrator can see that ticking boxes for a superadmin
   * changes nothing they can observe — a superadmin already passes every check
   * before a flag is consulted. It is a display value and is labelled as one on
   * screen; `firestore.rules` reads the token and never this field, and claims
   * are not readable across accounts from a browser at all, which is why a
   * mirror has to exist for this one question.
   *
   * Written `false` at sign-in by `enforceTenantOnCreate` and set by
   * `grant-admin.mjs` when it promotes somebody. If the two disagree the claim
   * wins and this screen is wrong, which is cosmetic by construction.
   */
  superadmin: boolean;
  screenAdmin: ScreenAdmin;
  /**
   * Which parts of the money the `finance` flag reaches for this person.
   *
   * A complete map always, even for the many documents that carry no
   * `financeScopes` field — `parseFinanceScopes` reads an absent one as all
   * three, because that is what `finance` meant before it could be narrowed and
   * reading it as nothing would revoke every treasurer in the parish. Saving
   * from this screen always writes all three keys, which is what makes
   * "unticked everything" distinguishable from "never narrowed".
   */
  financeScopes: FinanceScopes;
  programAdmin: ProgramAdmin;
}

/** One ministry, for the per-program picker. */
export interface AllocatableProgram {
  id: string;
  name: string;
}

/**
 * Everybody with a member document.
 *
 * No pagination and no search-as-you-type against Firestore. The parish's
 * directory is the people with a church Microsoft account — clergy, staff and
 * servants, a few dozen — so the whole collection is one read and filtering
 * happens in memory, where it is instant and costs nothing. If that ever stops
 * being true the fix is a `limit` and a cursor, not an index.
 *
 * Ordered by `displayName` in the query rather than in JS so the list is stable
 * across reloads. A member whose document predates the field sorts wherever
 * Firestore puts it, which is fine — the filter box is how anybody actually
 * finds a person.
 */
export async function listMembers(): Promise<AllocatableMember[]> {
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.members), orderBy('displayName')),
  );

  return snapshot.docs.map((row) => {
    const data = row.data();
    return {
      uid: row.id,
      displayName: str(data['displayName']) || str(data['email']) || 'Unnamed',
      email: str(data['email']),
      superadmin: data['superadminMirror'] === true,
      // Both parsers drop unknown keys and default absent ones to closed, so a
      // document written before a screen existed reads as "not granted" rather
      // than as a hole the UI has to special-case.
      screenAdmin: parseScreenAdmin(data['screenAdmin']),
      financeScopes: parseFinanceScopes(data['financeScopes']),
      programAdmin: parseProgramAdmin(data['programAdmin']),
    };
  });
}

/**
 * The parish's ministries, for the per-program picker.
 *
 * Unpublished programs are included on purpose. A ministry is set up before it
 * is announced, and the servant who will run it needs the grant during exactly
 * that window — a picker that showed only published programs would hide the one
 * the administrator came here to delegate.
 */
export async function listPrograms(): Promise<AllocatableProgram[]> {
  const snapshot = await getDocs(query(collection(db(), COLLECTIONS.programs), orderBy('name')));
  return snapshot.docs.map((row) => ({
    id: row.id,
    name: str(row.data()['name']) || row.id,
  }));
}

/**
 * Which program id is the camp's, according to the camp itself.
 *
 * Read rather than hardcoded because `useCampAdmin` checks the grant against
 * this same document, and a second copy of the id in this file is how the
 * allocation screen comes to grant `summercamp` while the camp screen is
 * looking for `summer-camp-2027`. Falls back to the committed default, which is
 * what `parseCampConfig` would have produced anyway.
 */
export async function readCampProgramId(): Promise<string> {
  try {
    const snapshot = await getDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_CAMP));
    if (!snapshot.exists()) return defaultCampConfig().programId;
    return parseCampConfig(snapshot.data()).programId;
  } catch (error) {
    console.warn('[access] could not read the camp settings; using the default program id', error);
    return defaultCampConfig().programId;
  }
}

/**
 * Write one person's allocation.
 *
 * Both maps go in one `updateDoc` rather than two, so a save is one write and
 * cannot half-apply — an administrator who grants the bookstore and a ministry
 * in the same sitting should not be able to end up with one of them.
 *
 * The cached copy of the grantee's map is dropped afterwards. Without that, an
 * administrator adjusting their *own* grants sees the stale answer until a full
 * reload, which is indistinguishable from the write having failed.
 */
export async function saveAllocation(
  uid: string,
  next: { screenAdmin: ScreenAdmin; financeScopes: FinanceScopes; programAdmin: ProgramAdmin },
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.members, uid), {
    // Rebuilt through the parsers on the way out as well as on the way in. The
    // editor holds a complete map and should never produce anything else, but
    // this is the last point before a permission reaches Firestore, and a
    // stray key written here is a key `firestore.rules` would then read.
    screenAdmin: parseScreenAdmin(next.screenAdmin),
    /*
     * All three keys, every time, and that is load-bearing rather than tidy.
     *
     * An absent `financeScopes` means "all three" — see `FINANCE_SOURCES` in
     * packages/shared/src/screens.ts — so an administrator who unticks every
     * source has to leave behind a map that *names* them, or the next read
     * would treat their choice as no choice and hand back everything.
     * `parseFinanceScopes` of a complete map is that map, so this is the
     * guarantee rather than a re-parse for its own sake.
     */
    financeScopes: parseFinanceScopes(next.financeScopes),
    programAdmin: parseProgramAdmin(next.programAdmin),
  });
  forgetScreenGrants(uid);
}

/* ---- small helpers ------------------------------------------------------ */

/** A member document with no allocation yet reads as one with nothing granted. */
export function emptyAllocation(): {
  screenAdmin: ScreenAdmin;
  financeScopes: FinanceScopes;
  programAdmin: ProgramAdmin;
} {
  // All three sources, which is not a grant: `finance` is false beside it, and
  // the sources narrow that flag rather than standing in for it.
  return {
    screenAdmin: defaultScreenAdmin(),
    financeScopes: allFinanceScopes(),
    programAdmin: defaultProgramAdmin(),
  };
}

/** Flip one finance source, returning a new map rather than mutating the old. */
export function withFinanceSource(
  scopes: FinanceScopes,
  source: FinanceSource,
  granted: boolean,
): FinanceScopes {
  return { ...scopes, [source]: granted };
}

/** Flip one screen flag, returning a new map rather than mutating the old. */
export function withScreen(
  screens: ScreenAdmin,
  screen: AdminScreen,
  granted: boolean,
): ScreenAdmin {
  return { ...screens, [screen]: granted };
}

/**
 * Add or remove one program id, returning a new grant rather than mutating.
 *
 * Deduplicated on the way in, because the camp row and the ministries picker
 * can both write the same id — the camp *is* one of the programs — and a list
 * holding it twice would show the checkbox as on, take two clicks to turn off,
 * and look like a bug in the checkbox.
 */
export function withProgram(
  grants: ProgramAdmin,
  programId: string,
  granted: boolean,
): ProgramAdmin {
  const without = grants.programs.filter((id) => id !== programId);
  return {
    ...grants,
    programs: granted ? [...without, programId] : without,
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
