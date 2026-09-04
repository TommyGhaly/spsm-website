import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';

// Half these tests assert a denial, and the SDK logs every one at error level.
// Left on, a green run prints dozens of PERMISSION_DENIED stack traces and a
// real failure is impossible to spot in the scrollback.
setLogLevel('silent');

/**
 * Shared harness for the behavioural rules tests.
 *
 * ---------------------------------------------------------------------------
 * ## Every suite gets its own project id, and it is not optional
 *
 * These files run in parallel, each one clears Firestore in its own
 * `beforeAll`, and the emulator scopes both the data and the loaded ruleset **by
 * project id**. Sharing one id therefore means one suite's `clearFirestore()`
 * lands in the middle of another's run and deletes its fixtures.
 *
 * That was survivable while the only fixtures were the documents under test: a
 * missing document fails an `assertSucceeds` loudly, and the ruleset is
 * identical whoever uploads it. It stopped being survivable when the role
 * ladder was removed, because **a permission is now a document**. Every
 * `hasScreen()` check reads `members/{uid}`, so a stray clear does not fail one
 * assertion — it silently revokes every grant in the suite, and thirty tests
 * report `permission-denied` on rules that are correct.
 *
 * Measured: 282 passing with `--fileParallelism=false`, 254 passing without,
 * before this argument existed.
 *
 * So pass the suite's own name. The id must start with `demo-` — that is what
 * lets the emulator run without real credentials — and it matches
 * `npm run rules:check`.
 * ---------------------------------------------------------------------------
 */
const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const STORAGE_RULES_PATH = fileURLToPath(new URL('../../storage.rules', import.meta.url));

/**
 * @param suite This file's own name, for the project id. See above.
 * @param withStorage Load storage.rules too. **Opt-in, and it has to be.**
 *
 * Every suite that calls this uploads its rulesets to the emulator on setup and
 * tears them down again in `cleanup()`. The emulator held one ruleset per
 * service for the whole project, so a suite tearing down a service it never
 * used pulled it out from under whichever suite was using it — which surfaced
 * as "no Storage ruleset is currently loaded" in a suite whose own setup
 * succeeded, several files away from the cause.
 *
 * Per-suite project ids remove that hazard as well as the data one, so this
 * argument is now belt and braces: only one suite needs Storage, and loading a
 * ruleset it will never consult costs a round trip for nothing.
 */
export async function createTestEnv(
  suite: string,
  withStorage = false,
): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    // Lower-cased, because a project id may not contain capitals and the
    // emulator's answer to one that does is `{"code":500,"status":"UNKNOWN"}`
    // from `loadFirestoreRules` — which says nothing at all about the cause.
    projectId: `demo-spsm-${suite.toLowerCase()}`,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    /*
     * Storage joined this harness when program galleries opened the first
     * anonymous upload path on the site. Until then storage.rules said only
     * "public read, staff write" and had nothing worth asserting; now the
     * claim it makes — that the quarantine prefix is writable by the world and
     * readable by nobody — is the thing standing between an approval queue and
     * an open file host.
     *
     * `npm run test:rules` starts both emulators for this reason.
     */
    ...(withStorage
      ? {
          storage: {
            rules: readFileSync(STORAGE_RULES_PATH, 'utf8'),
            host: '127.0.0.1',
            port: 9199,
          },
        }
      : {}),
  });
}

/**
 * Claim shapes matching packages/shared/src/claims.ts.
 *
 * ---------------------------------------------------------------------------
 * There are two claims now, and only one of them decides anything.
 *
 * The role ladder (`member < servant < staff < admin`) and the `groups` claims
 * are gone, so a context is one of exactly three things:
 *
 *   `asAnon`       no session. Sees the public site.
 *   `asSignedIn`   a session and no allocation. **This is what almost every
 *                  account in the parish is**, and what most of these tests
 *                  measure against — it can read the servants' rota and
 *                  nothing else.
 *   `asSuper`      the one boolean claim. Passes every check.
 *
 * Everything between those two is a **screen or program grant on a member
 * document**, which means a test that wants one has to seed
 * `members/{uid}` under `withSecurityRulesDisabled` rather than pass a claim.
 * That is the whole point of the change and it makes these tests slower to
 * write; `access.test.ts` is the pattern to copy.
 *
 * `asScreens` is the exception, and it is for `storage.rules` only. Storage
 * rules cannot read Firestore, so the grants are mirrored into a `screens`
 * claim by `mirrorGrantsToClaims` — see the note in claims.ts. A Firestore test
 * that reaches for `asScreens` is testing the wrong thing: firestore.rules
 * ignores that claim entirely, on purpose, because it lags.
 * ---------------------------------------------------------------------------
 */
export const asAnon = (env: RulesTestEnvironment): RulesTestContext =>
  env.unauthenticatedContext();

/**
 * A visitor who is holding a token and is still nobody: the anonymous session
 * a gallery upload runs under.
 *
 * ---------------------------------------------------------------------------
 * **This is not `asAnon`, and the two names are the trap in this file.**
 * `asAnon` above is a request with *no* credential at all. This one has passed
 * `request.auth != null` since 2026-09-04, when the Anonymous provider was
 * enabled on the project so that parishioners without accounts could send
 * photographs to the galleries (`lib/uploadSession.ts`,
 * docs/gallery-console-setup.md §6).
 *
 * Every rule that said "signed in" was written when that was impossible, and
 * therefore meant "in the parish's Entra tenant" — sign-in was Microsoft-only,
 * so the two were the same sentence. They are not any more, and an anonymous
 * uid is free: anybody can mint one from a browser console with the web API
 * key, which is in the public bundle by design.
 *
 * So this fixture sits *between* `asAnon` and `asSignedIn`, and it is the one
 * that catches the rule which confuses them. `isPerson()` in both rulesets is
 * the predicate that keeps them apart, and every `assertFails` below that uses
 * this context is an assertion that an upload session bought nothing except
 * the right to upload.
 *
 * `firebase.sign_in_provider` has to be set by hand. `createMockUserToken`
 * defaults it to `'custom'` and spreads the caller's options *after* its own
 * payload, so overriding it works — but a context built with `{}` looks like a
 * real sign-in to `isPerson()` and would pass every test here for the wrong
 * reason.
 * ---------------------------------------------------------------------------
 */
export const asAnonymousSession = (
  env: RulesTestEnvironment,
  uid = 'anon-session-1',
): RulesTestContext =>
  env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous', identities: {} },
  });

/**
 * Somebody from the parish directory, holding nothing.
 *
 * Sign-in is Microsoft-only and tenant-restricted, so this is not "a stranger
 * with an account" — it is a servant of the church who has not been allocated
 * an area. The single most important fixture in these files: every `assertFails`
 * that uses it is an assertion that signing in bought nothing.
 */
export const asSignedIn = (env: RulesTestEnvironment, uid = 'servant-1'): RulesTestContext =>
  env.authenticatedContext(uid, {});

/**
 * The same thing, named for what the rota rules call it.
 *
 * Kept as its own export rather than collapsed into `asSignedIn` because the
 * `servantEvents` and `calendar` rules genuinely are about servants, and a test
 * that reads `asSignedIn` there loses the reason the rule is as wide as it is.
 */
export const asServant = asSignedIn;

/** The parish's site administrator. The only claim that grants anything. */
export const asSuper = (env: RulesTestEnvironment, uid = 'admin-1'): RulesTestContext =>
  env.authenticatedContext(uid, { superadmin: true });

/**
 * A `screens` mirror, for `storage.rules` and nothing else.
 *
 * See the note above: firestore.rules does not read this claim, so asserting a
 * Firestore rule with it will pass or fail for reasons unrelated to the grant.
 */
export const asScreens = (
  env: RulesTestEnvironment,
  screens: readonly string[],
  uid = 'granted-1',
): RulesTestContext => env.authenticatedContext(uid, { screens });
