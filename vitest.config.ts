import { defineConfig } from 'vitest/config';

/**
 * Two projects, deliberately separated, because they have different costs and
 * different failure meanings.
 *
 *   unit   — pure functions from @spsm/shared. No emulator, no network, no
 *            credentials. Runs in about a second. `npm test`.
 *   rules  — firestore.rules evaluated against a real emulator. Needs a JVM and
 *            `firebase emulators:exec`, so it is its own script and its own
 *            command. `npm run test:rules`.
 *
 * Why both exist at all, in one sentence: `npm run rules:check` compiles the
 * rules and passed a policy that denied every public list query in the site,
 * and it took building a page to notice. See docs/decisions.md #10.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'rules',
          environment: 'node',
          include: ['tests/rules/**/*.test.ts'],
          // The emulator is shared mutable state. Parallel suites clearing it
          // out from under each other produces failures that look like rules
          // bugs and are not.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
