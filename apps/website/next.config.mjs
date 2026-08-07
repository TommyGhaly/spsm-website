import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Next only looks for .env files inside this app directory, but the repo keeps
 * one .env at the monorepo root so that Functions, the scope verifier, and the
 * website cannot drift apart on credentials. Load it here.
 *
 * Order matters: existing process.env wins, so CI secrets and shell overrides
 * still beat the file. `loadEnvFile` already behaves that way — it does not
 * overwrite variables that are already set.
 */
const here = dirname(fileURLToPath(import.meta.url));
for (const name of ['.env', '.env.local']) {
  const path = resolve(here, '../..', name);
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * Static export (Decision #6). Every page is HTML on disk at build time and
 * Firebase Hosting serves it as a file — no Node process in production.
 *
 * The consequence to keep in mind while writing pages: there is no server at
 * request time. No server components that run per-request, no route handlers,
 * no ISR, no middleware, no `cookies()` / `headers()`. Anything dynamic is
 * either a client component talking to Firestore, or a Cloud Function.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',

  // Must agree with firebase.json's hosting block, or links will 301 on every
  // navigation in production while working fine in `next dev`.
  //   firebase.json: cleanUrls true, trailingSlash false
  trailingSlash: false,

  images: {
    // next/image's default loader needs a server to resize on demand. There
    // isn't one. Firebase Storage + explicit sizes instead.
    unoptimized: true,
  },

  typescript: {
    // A type error should fail the build. This is the default; stated
    // explicitly so nobody "temporarily" flips it during a deploy scramble.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
