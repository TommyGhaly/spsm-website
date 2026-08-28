/**
 * Put the church on the map: write `config/parish.geo`.
 *
 * ---------------------------------------------------------------------------
 * Why this is a script and not a build step.
 *
 * The map on /contact needs a latitude and a longitude, and the obvious way to
 * get them is to geocode the parish's address during `next build`. That puts a
 * third-party network call and a rate limit on the critical path of every
 * deploy, and — worse — it means the marker silently moves the day a geocoder
 * changes its mind about which building on Rice Road is the church. Nobody would
 * notice, because a marker two doors down looks exactly like a right one.
 *
 * So the coordinates are a fact, stored once, that somebody looked at. This
 * script does the looking-up; a person does the looking.
 * ---------------------------------------------------------------------------
 *
 * A field-masked PATCH, not a PUT. `config/parish` holds the address, the phone
 * number, the office hours and the service times, all of which staff maintain by
 * hand — a whole-document write here would take somebody's afternoon with it.
 * `updateMask.fieldPaths=geo` touches the one field and leaves the rest alone.
 *
 * Usage:
 *   node scripts/set-parish-geo.mjs                       # geocode the stored address, dry run
 *   node scripts/set-parish-geo.mjs --write               # …and apply
 *   node scripts/set-parish-geo.mjs --lat 42.3 --lng -71.3 --write
 *
 * Check the result on /contact before you believe it. A swapped pair is a legal
 * point somewhere else in the world and no validation can catch it — see
 * `parseGeo` in packages/shared/src/schema/config.ts.
 */
import { accessToken, documentUrl, fromFirestore, toValue } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1];
};

const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };
const url = documentUrl(project, 'config/parish');

/* ── What is there now ──────────────────────────────────────────────────── */

const read = await fetch(url, { headers: authHeader });
if (!read.ok) {
  console.error(
    read.status === 404
      ? 'config/parish does not exist yet. Create it first — see docs, or npm run config.'
      : `Could not read config/parish: HTTP ${read.status}`,
  );
  process.exit(1);
}

const parish = fromFirestore((await read.json()).fields ?? {});
const address = parish.address ?? {};
const oneLine = [address.line1, address.line2, address.city, address.state, address.postalCode]
  .filter(Boolean)
  .join(', ');

console.log(`Address on file: ${oneLine || '(blank)'}`);
console.log(
  `geo on file:     ${parish.geo ? `${parish.geo.lat}, ${parish.geo.lng}` : '(none — no map is drawn)'}`,
);
console.log('');

/* ── What it should be ──────────────────────────────────────────────────── */

let point;

if (flag('--lat') !== null || flag('--lng') !== null) {
  point = { lat: Number(flag('--lat')), lng: Number(flag('--lng')) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    console.error('--lat and --lng must both be numbers.');
    process.exit(1);
  }
  console.log(`Using the pair you gave: ${point.lat}, ${point.lng}`);
} else {
  if (!oneLine) {
    console.error(
      'No address on file to geocode, and no --lat/--lng given. Fill in the address first.',
    );
    process.exit(1);
  }

  /*
   * Nominatim, OpenStreetMap's own geocoder — the same project whose tiles the
   * map draws, so the coordinates and the picture agree about where things are.
   * Its terms ask for a real User-Agent identifying the caller and no more than
   * one request a second; this script makes exactly one, by hand, rarely.
   */
  const query = new URLSearchParams({ format: 'jsonv2', limit: '1', q: oneLine });
  const geocode = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
    headers: { 'User-Agent': `spsm-website/1.0 (${project}; scripts/set-parish-geo.mjs)` },
  });

  if (!geocode.ok) {
    console.error(`Geocoder returned HTTP ${geocode.status}. Try again, or pass --lat/--lng.`);
    process.exit(1);
  }

  const [best] = await geocode.json();
  if (!best) {
    console.error(`The geocoder does not know "${oneLine}". Pass --lat/--lng instead.`);
    process.exit(1);
  }

  point = { lat: Number(best.lat), lng: Number(best.lon) };
  console.log(`Geocoder matched: ${best.display_name}`);
  console.log(`                  ${point.lat}, ${point.lng}  (${best.type})`);
}

console.log('');
console.log(`Check it yourself: https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=18/${point.lat}/${point.lng}`);
console.log('');

if (!write) {
  console.log('Dry run. Re-run with --write to apply.');
  process.exit(0);
}

/* ── Write the one field ────────────────────────────────────────────────── */

const patch = await fetch(`${url}?updateMask.fieldPaths=geo`, {
  method: 'PATCH',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { geo: toValue(point) } }),
});

if (!patch.ok) {
  console.error(`Write failed: HTTP ${patch.status} ${(await patch.text()).slice(0, 300)}`);
  process.exit(1);
}

console.log(`Written. config/parish.geo = ${point.lat}, ${point.lng}`);
console.log('Now open /contact and confirm the cross is on the church.');
