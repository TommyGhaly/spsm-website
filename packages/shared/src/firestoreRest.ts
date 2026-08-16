/**
 * Firestore's REST wire format, decoded — with no dependency on Node, the
 * Firebase SDK, or anything else.
 *
 * This exists so the **browser** can read a public document with a bare
 * `fetch()`. The website is a static export; loading the Firestore SDK on every
 * page to read one settings document would cost far more than the document is
 * worth, and the SDK's job — auth, listeners, offline persistence, retries — is
 * not needed for a world-readable config read.
 *
 * The decoder was previously duplicated in `scripts/lib/firestore-rest.mjs`,
 * which predicted this move in a comment: the website and the mobile app need
 * the same decoder, and it must not depend on Node by then. That script now
 * imports from here and keeps only the parts that genuinely need Node — gcloud
 * credentials and the encoder.
 *
 * Read-only on purpose. Encoding a document for a write needs credentials, and
 * nothing with credentials belongs in a browser bundle.
 */

/** One field of a Firestore document, in the REST representation. */
type FirestoreValue = Record<string, unknown>;

/**
 * The `fields` map of a REST document response → a plain object.
 *
 * Pass `document.fields`, not the document — the response wraps the map in
 * `{ name, fields, createTime, updateTime }`.
 */
export function decodeFirestoreFields(fields: unknown): Record<string, unknown> {
  if (typeof fields !== 'object' || fields === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, wrapped] of Object.entries(fields as Record<string, unknown>)) {
    out[key] = decodeFirestoreValue(wrapped);
  }
  return out;
}

/**
 * One typed value → its JavaScript equivalent.
 *
 * `integerValue` arrives as a **string**, because JSON cannot represent a 64-bit
 * integer exactly. `Number()` is right for everything this codebase stores —
 * spacing, sizes, version numbers — but would lose precision above 2^53, so do
 * not reach for this to decode an ID.
 *
 * An unrecognised wrapper returns `null` rather than the raw envelope. Handing a
 * caller `{ geoPointValue: … }` when it expected a string is how a `[object
 * Object]` ends up rendered on a page; null is at least a value every parser in
 * this repo already treats as missing.
 */
export function decodeFirestoreValue(wrapped: unknown): unknown {
  if (typeof wrapped !== 'object' || wrapped === null) return null;
  const value = wrapped as FirestoreValue;

  if ('stringValue' in value) return value['stringValue'];
  if ('booleanValue' in value) return value['booleanValue'];
  if ('integerValue' in value) return Number(value['integerValue']);
  if ('doubleValue' in value) return value['doubleValue'];
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value['timestampValue'];
  if ('mapValue' in value) {
    const map = value['mapValue'] as { fields?: unknown } | null;
    return decodeFirestoreFields(map?.fields ?? {});
  }
  if ('arrayValue' in value) {
    const array = value['arrayValue'] as { values?: unknown[] } | null;
    return (array?.values ?? []).map(decodeFirestoreValue);
  }
  return null;
}

/**
 * The REST URL for one document, readable with only a public API key.
 *
 * This works for exactly the documents whose security rules say
 * `allow read: if true` — `config/*` is the only such collection here. The API
 * key is not a secret and is not an authorization: it identifies the project for
 * quota, and the rules are what actually decide access. Firebase ships it in
 * every client bundle by design.
 *
 * @param path a document path like `config/theme`.
 */
export function publicDocumentUrl(projectId: string, path: string, apiKey: string): string {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return (
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/${encoded}?key=${encodeURIComponent(apiKey)}`
  );
}
