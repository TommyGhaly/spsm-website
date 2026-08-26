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

  /*
   * Dev tooling: somewhere else to put the build output.
   *
   * `next dev` refuses to start a second server for the same output directory,
   * and the two servers worth having at once are exactly the pair this repo
   * needs — one on the real Firestore, which is what the public pages read, and
   * one on the emulators, which is the only way to see a program gallery or
   * anything behind sign-in. Without this, working on the galleries means
   * stopping whichever server you already had.
   *
   * Unset, `distDir` is absent from the config and nothing changes. `npm run
   * dev:emulated:second` is the intended user.
   */
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

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
   * Listed one by one rather than as `/api/:fn`, because a path segment and its
   * function name are not the same string. The path is `square/checkout` and
   * the Function is `squareCheckout` — a captured param is lowercase, so the
   * pattern built `squarecheckout` and the emulator rejected it. These are a
   * mirror of the rewrites in firebase.json; add to both together.
   */
  nextConfig.rewrites = async () => ({
    /*
     * `/forms/<slug>` → the `/form` shell, mirroring the Hosting rewrite in
     * firebase.json. Without it every individual form is a 404 under `next dev`,
     * because there is no `app/forms/[slug]` route — deliberately; see
     * `app/form/page.tsx`.
     *
     * `beforeFiles`, not `afterFiles`, and it matters: `/forms` is a real route
     * in this app, and an `afterFiles` rewrite runs only when nothing matched,
     * which is fine — but `beforeFiles` keeps this next to the reasoning rather
     * than depending on the order the app's own routes happen to resolve in.
     * The pattern has one segment, so `/forms` itself never matches and the hub
     * is untouched.
     */
    beforeFiles: [{ source: '/forms/:slug', destination: '/form' }],
    afterFiles: [
      /*
       * The forms endpoints. `submit` is the one every form posts to; the two
       * Breeze ones are staff-only and inert until BREEZE_API_KEY is set.
       */
      {
        source: '/api/prayer/submit',
        destination: `${origin}/${project}/${region}/prayerSubmit`,
      },
      {
        source: '/api/prayer/list',
        destination: `${origin}/${project}/${region}/prayerList`,
      },
      {
        source: '/api/forms/submit',
        destination: `${origin}/${project}/${region}/formSubmit`,
      },
      {
        source: '/api/forms/breeze-list',
        destination: `${origin}/${project}/${region}/breezeListForms`,
      },
      {
        source: '/api/forms/breeze-import',
        destination: `${origin}/${project}/${region}/breezeImportForm`,
      },
      {
        source: '/api/square/checkout',
        destination: `${origin}/${project}/${region}/squareCheckout`,
      },
      {
        source: '/api/square/webhook',
        destination: `${origin}/${project}/${region}/squareWebhook`,
      },
      /*
       * The buyer's order lookup, the staff refund, and the on-demand stats
       * rebuild. Same arrangement as the checkout above — Hosting rewrites in
       * production, nothing at all locally without these.
       */
      {
        source: '/api/square/orders',
        destination: `${origin}/${project}/${region}/orderLookup`,
      },
      {
        source: '/api/square/refund',
        destination: `${origin}/${project}/${region}/squareRefund`,
      },
      {
        source: '/api/square/product',
        destination: `${origin}/${project}/${region}/squareCreateProduct`,
      },
      {
        source: '/api/square/product-image',
        destination: `${origin}/${project}/${region}/squareProductImage`,
      },
      {
        source: '/api/square/product-image-remove',
        destination: `${origin}/${project}/${region}/squareRemoveProductImage`,
      },
      {
        source: '/api/square/product-stock',
        destination: `${origin}/${project}/${region}/squareProductStock`,
      },
      {
        source: '/api/square/product-archive',
        destination: `${origin}/${project}/${region}/squareArchiveProduct`,
      },
      {
        source: '/api/square/catalog-refresh',
        destination: `${origin}/${project}/${region}/refreshSquareCatalog`,
      },
      {
        source: '/api/square/stats-refresh',
        destination: `${origin}/${project}/${region}/refreshBookstoreStats`,
      },
      /*
       * The homepage schedule's live read. Same arrangement as the two above: a
       * Hosting rewrite in production, and nothing at all on the dev server
       * without this — which means the bulletin section silently never refreshes
       * locally and the polling cannot be exercised.
       */
      {
        source: '/api/bulletin',
        destination: `${origin}/${project}/${region}/bulletin`,
      },
      /*
       * The livestream's live check. Same arrangement again — and without it
       * the player locally can only ever show its "could not find out" state,
       * because the probe has nothing to talk to.
       */
      {
        source: '/api/live',
        destination: `${origin}/${project}/${region}/live`,
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
