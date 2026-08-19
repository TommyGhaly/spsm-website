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
 * The project id must start with `demo-` — that is what lets the emulator run
 * without real credentials, and it matches `npm run rules:check`.
 */
const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const STORAGE_RULES_PATH = fileURLToPath(new URL('../../storage.rules', import.meta.url));

/**
 * @param withStorage Load storage.rules too. **Opt-in, and it has to be.**
 *
 * Every suite that calls this uploads its rulesets to the emulator on setup and
 * tears them down again in `cleanup()`. The emulator holds one ruleset per
 * service for the whole project, so a suite tearing down a service it never
 * used pulls it out from under whichever suite is using it — which surfaces as
 * "no Storage ruleset is currently loaded" in a suite whose own setup
 * succeeded, several files away from the cause.
 *
 * Firestore avoids this only because every suite loads it and the last write
 * wins with identical content. Storage is needed by exactly one suite, so that
 * suite is the only one that touches it.
 */
export async function createTestEnv(withStorage = false): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-spsm',
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
 * Claim shapes matching packages/shared/src/roles.ts. Roles come from the ID
 * token, never from a Firestore document, so these are the only inputs the
 * policy is allowed to care about.
 */
export const asAnon = (env: RulesTestEnvironment): RulesTestContext =>
  env.unauthenticatedContext();

export const asMember = (env: RulesTestEnvironment, uid = 'member-1'): RulesTestContext =>
  env.authenticatedContext(uid, { role: 'member' });

export const asServant = (env: RulesTestEnvironment, uid = 'servant-1'): RulesTestContext =>
  env.authenticatedContext(uid, { role: 'servant' });

export const asStaff = (env: RulesTestEnvironment, uid = 'staff-1'): RulesTestContext =>
  env.authenticatedContext(uid, { role: 'staff' });

export const asAdmin = (env: RulesTestEnvironment, uid = 'admin-1'): RulesTestContext =>
  env.authenticatedContext(uid, { role: 'admin' });

/** A facilities coordinator: legitimately staff, deliberately not clergy. */
export const asClergy = (env: RulesTestEnvironment, uid = 'clergy-1'): RulesTestContext =>
  env.authenticatedContext(uid, { role: 'staff', groups: ['clergy'] });

export const asParking = (env: RulesTestEnvironment, uid = 'parking-1'): RulesTestContext =>
  env.authenticatedContext(uid, { role: 'member', groups: ['parking'] });
