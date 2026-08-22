/**
 * Read the weekly bulletin the way the site build does, and print it.
 *
 * The build swallows bulletin failures on purpose — a bad week over there
 * should cost one homepage section, not the whole deploy — which means a
 * problem shows up as a missing section and a line in the build log. This
 * prints the whole thing instead, so "why is the bulletin not showing" has a
 * one-command answer.
 *
 * Reads config from Firestore first, exactly as the build does, so it also
 * verifies that `config/integrations` says what you think it says.
 *
 * Usage: node scripts/read-bulletin.mjs
 */
import { initializeApp as initClient } from 'firebase/app';
import { getFirestore as getClientFirestore, doc, getDoc } from 'firebase/firestore';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  parseBulletin,
  parseIntegrationsConfig,
  activeBulletinId,
  ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC,
} from '../packages/shared/dist/index.js';

process.loadEnvFile('.env');

// --- 1. config, from our Firestore, anonymously ------------------------------
const clientApp = initClient({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const snapshot = await getDoc(doc(getClientFirestore(clientApp), 'config', 'integrations'));

if (!snapshot.exists()) {
  console.log('config/integrations does not exist — the build would use built-in defaults.');
  console.log('Create it with: node scripts/seed-config.mjs --write\n');
} else {
  console.log(`config/integrations (from ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}):`);
  console.log(JSON.stringify(snapshot.data(), null, 2), '\n');
}

const config = parseIntegrationsConfig(snapshot.exists() ? snapshot.data() : undefined).announcements;

if (!config.enabled) {
  console.log('Bulletin is DISABLED in config. The site will not show it.');
  process.exit(0);
}

// --- 2. the bulletin, from the announcements project -------------------------
const serviceAccount = JSON.parse(process.env.ANNOUNCEMENTS_SERVICE_ACCOUNT);
const sourceApp = initializeApp(
  { credential: cert(serviceAccount), projectId: config.projectId },
  'read-bulletin',
);
const sourceDb = config.databaseId
  ? getFirestore(sourceApp, config.databaseId)
  : getFirestore(sourceApp);

const docs = await sourceDb.collection(config.collectionPath).get();
console.log(
  `Source ${config.projectId}/${config.databaseId || '(default)'}/${config.collectionPath}: ` +
    `${docs.size} document(s)`,
);

/*
 * Which one the site shows, which is the first thing anybody running this
 * actually wants to know. The collection normally holds the week being
 * presented plus a draft of the next one, and until this line existed the
 * output was two weeks with nothing to say which was which.
 */
const pointer = await sourceDb.doc(ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC).get();
const activeId = pointer.exists ? activeBulletinId(pointer.data()) : null;
console.log(
  activeId
    ? `Active (${ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC}): ${activeId}\n`
    : `Active: ${ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC} is missing or has no "id" — the ` +
        `site falls back to the last PUBLISHED week.\n`,
);

if (docs.empty) {
  console.error('Nothing to show. Check collectionPath in config/integrations.');
  process.exit(1);
}

for (const snap of docs.docs) {
  const bulletin = parseBulletin(snap.data(), {
    project: config.projectId,
    collection: config.collectionPath,
    documentId: snap.id,
  });
  const eventCount =
    bulletin.days.reduce((sum, d) => sum + d.events.length, 0) + bulletin.multiDayEvents.length;

  const isActive = snap.id === activeId;
  console.log(`  ${isActive ? '>>' : '  '} ${snap.id}${isActive ? '   <-- ON THE SITE' : ''}`);
  console.log(`  weekOf        ${bulletin.weekOf}`);
  console.log(`  weekLabel     ${bulletin.weekLabel}`);
  console.log(`  presetName    ${bulletin.presetName ?? '—'}`);
  console.log(`  announcements ${bulletin.announcements.length}`);
  console.log(`  days          ${bulletin.days.length}  (${eventCount} events total)`);
  console.log(`  publishedAt   ${bulletin.source.publishedAt?.toISOString() ?? '—'}`);

  for (const day of bulletin.days) {
    const names = day.events.map((e) => `${e.time ?? '??'} ${e.name}`);
    console.log(`    ${day.date} ${day.day.padEnd(9)} ${names.length ? names.join(' | ') : '—'}`);
  }
  for (const event of bulletin.multiDayEvents) {
    console.log(`    ${event.startDate}..${event.endDate}  ${event.time ?? '??'} ${event.name}`);
  }
  console.log();
}
