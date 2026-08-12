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

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-spsm',
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
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
