import { fileURLToPath } from 'node:url';
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
        /*
         * `@/` resolves, so a unit test can import the About-pages slot
         * manifest.
         *
         * The description above says this project is pure functions from
         * @spsm/shared, and that is still what nearly all of it is. The
         * exception earns itself: `features/about/slots.ts` is a hand-written
         * list that has to match the `slot=` props in five hand-written screens,
         * and a mismatch either offers a box that changes nothing or renders
         * words that look editable and are not — neither of which a typecheck or
         * a screenshot catches. Comparing the two needs the real list.
         *
         * It stays dependency-free in the way that matters: the manifest imports
         * `TOUR_STATIONS` and nothing else, so no React and no Firebase is
         * pulled in.
         */
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./apps/website/src', import.meta.url)),
          },
        },
        /*
         * JSX compiles, because the slot manifest reaches `belief/articles.tsx`
         * — the Creed's line-by-line articles, whose bodies are JSX and whose
         * headings are the labels the editing column needs.
         *
         * `automatic`, so nothing has to import React; it resolves
         * `react/jsx-runtime`, which is already a dependency. No component is
         * rendered in these tests — the JSX only has to *parse* for the module
         * to load its data.
         */
        esbuild: { jsx: 'automatic' },
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
