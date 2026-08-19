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

/*
 * Dev only: a way for the checkout POST to reach the Cloud Function.
 *
 * `/api/square/checkout` is not a route in this app and cannot be — the site is
 * a static export, so there are no route handlers at all. In production that
 * path is a Firebase Hosting rewrite onto the `squareCheckout` Function (see
 * firebase.json). The Next dev server knows nothing about that rewrite, so
 * paying on the dev server landed on Next's own 404 HTML page.
 *
 * This proxies the same path to the Functions emulator, so the whole flow —
 * fill the card, press Pay, get an order id — can be exercised locally. It
 * needs `npm run dev:backend` in another terminal; without it the proxy has
 * nothing to talk to and CardPayment says checkout is unreachable.
 *
 * **Attached here rather than set to `[]` in the config object, and that is not
 * a style choice.** `output: 'export'` writes files to disk with no server to
 * honour a rewrite at request time, and Next warns whenever the `rewrites` key
 * is *present* alongside it — even when the function returns nothing. A
 * standing warning on every production build is one people learn to scroll
 * past. Defining the key only in development means the export build never sees
 * it, and the warning is gone rather than tolerated.
 */
if (process.env.NODE_ENV === 'development') {
  const origin = process.env.FUNCTIONS_EMULATOR_ORIGIN ?? 'http://127.0.0.1:5001';
  const project = process.env.GCLOUD_PROJECT ?? 'spsm-database';
  const region = process.env.FUNCTIONS_REGION ?? 'us-central1';

  /*
   * Listed one by one rather than as `/api/square/:fn`, because the path and
   * the function name are not the same string. The path segment is `checkout`
   * and the Function is `squareCheckout` — a captured param is lowercase, so
   * the pattern built `squarecheckout` and the emulator rejected it. These are
   * a mirror of the rewrites in firebase.json; add to both together.
   */
  nextConfig.rewrites = async () => ({
    beforeFiles: [],
    afterFiles: [
      {
        source: '/api/square/checkout',
        destination: `${origin}/${project}/${region}/squareCheckout`,
      },
      {
        source: '/api/square/webhook',
        destination: `${origin}/${project}/${region}/squareWebhook`,
      },
    ],
    /*
     * Program galleries, in development only.
     *
     * In production `/events/**` is a Firebase Hosting rewrite onto the
     * exported gallery shell (see firebase.json). The dev server knows nothing
     * about Hosting, so without this every gallery URL 404s locally and the
     * whole section is undevelopable — the same problem, and the same fix, as
     * the checkout proxy above.
     *
     * `fallback` rather than `afterFiles`, and that is the entire point.
     * Fallback rewrites are applied *after* static assets and dynamic routes
     * have been checked and before the 404 — which is as close as Next gets to
     * Hosting's own order (redirects, then files, then rewrites). Under
     * `afterFiles` this would run before `/events/[slug]` and swallow every
     * calendar event page.
     *
     * What it does NOT cover is a one-segment `/events/summercamp`: that
     * matches `/events/[slug]`, so the dynamic route wins and the fallback
     * never runs. That case is handled inside that page instead — see the
     * development branch in src/app/events/[slug]/page.tsx.
     */
    fallback: [
      {
        source: '/events/:path*',
        destination: '/gallery',
      },
    ],
  });
}

export default nextConfig;
