/**
 * From a thing that happened to the phones that should ring.
 *
 * ---------------------------------------------------------------------------
 * This is `screenGrants.ts` run backwards, and that is the whole difficulty of
 * it. Everywhere else in this codebase the question is "here is a person, may
 * they see this" — one document read, answered by `canAdminScreen`. Here the
 * question is "here is a submission, who looks after it", which no amount of
 * reading one member document answers. It is a query across `members`, and the
 * shape of that query is the thing to get right.
 *
 * ## The one rule
 *
 * **A notification never reaches further than the grant it rides on.** The
 * audience for an event is exactly the set of people who could already open the
 * screen where that event is dealt with. That is not a nicety: these pushes
 * carry parishioners' names. "Maryam Girgis signed the baptism form" on a lock
 * screen is a disclosure, and the only defensible answer to "who may see it" is
 * "whoever was already trusted with the submission itself".
 *
 * So every resolver below is paired with a predicate in
 * `packages/shared/src/schema/notifications.ts`, and `entitledAdminNotices` is
 * re-checked at send time against the member document as it stands *now* — not
 * against whatever was true when the device registered. A servant who lost the
 * `forms` grant last week stops being told about forms without anything having
 * had to remember to delete their device row.
 *
 * ## Why the queries are shaped the way they are
 *
 * `screenAdmin` is a map field, so `where('screenAdmin.forms', '==', true)` is
 * an equality filter on a nested field and is served by the automatic
 * single-field index. Nothing to add to `firestore.indexes.json`, and that is
 * worth knowing before anybody "optimises" this into an array.
 *
 * A superadmin holds everything by claim, and a claim is not queryable. What is
 * queryable is `superadminMirror` — the display copy written by
 * `grant-admin.mjs` — so that is the second query, unioned in. The mirror is
 * described elsewhere in this codebase as cosmetic and it is, for
 * *authorization*: nothing is granted by reading it. Used here it decides only
 * who gets *told*, and the failure mode of a missing mirror is a superadmin who
 * does not receive a push they could have had. That is an acceptable way to be
 * wrong, and it is the reason this is not the mechanism anything is authorized
 * by.
 * ---------------------------------------------------------------------------
 */
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  entitledAdminNotices,
  parseAdminNoticePrefs,
  parseProgramAdmin,
  parseScreenAdmin,
  type AdminNotice,
  type AdminScreen,
} from '@spsm/shared';

/** One phone to send to, with enough about its owner to have justified it. */
export interface Recipient {
  uid: string;
  token: string;
}

/**
 * Everybody who holds a screen grant.
 *
 * Two queries and a union rather than one clever one. Firestore has no `OR`
 * across different fields that is cheaper than this, and `Filter.or` would
 * still be two index scans with a combined result — so the explicit version is
 * the same cost and says what it does.
 */
async function uidsWithScreen(screen: AdminScreen): Promise<Set<string>> {
  const members = getFirestore().collection(COLLECTIONS.members);

  const [granted, supers] = await Promise.all([
    members.where(`screenAdmin.${screen}`, '==', true).get(),
    members.where('superadminMirror', '==', true).get(),
  ]);

  return new Set([...granted.docs, ...supers.docs].map((doc) => doc.id));
}

/**
 * Everybody who looks after the program a photograph was sent to.
 *
 * Three queries, because a program grant has two halves and either is enough:
 * `programs` covers every event under a program forever, `events` covers one
 * gathering. `firestore.rules` reads exactly these two arrays in
 * `adminsProgramEvent`, which is the rule that lets somebody see the submission
 * this push is about — so matching it here is what keeps the push inside the
 * grant.
 *
 * `array-contains` is likewise served by the automatic index.
 */
async function uidsForProgramEvent(
  programId: string,
  programEventId: string,
): Promise<Set<string>> {
  const members = getFirestore().collection(COLLECTIONS.members);

  const [byProgram, byEvent, supers] = await Promise.all([
    programId
      ? members.where('programAdmin.programs', 'array-contains', programId).get()
      : Promise.resolve({ docs: [] as { id: string }[] }),
    programEventId
      ? members.where('programAdmin.events', 'array-contains', programEventId).get()
      : Promise.resolve({ docs: [] as { id: string }[] }),
    members.where('superadminMirror', '==', true).get(),
  ]);

  return new Set([...byProgram.docs, ...byEvent.docs, ...supers.docs].map((doc) => doc.id));
}

/**
 * Narrow a candidate set to the phones that have actually asked for this.
 *
 * ---------------------------------------------------------------------------
 * Two independent gates, and both are load-bearing.
 *
 *   **Entitlement** is re-derived here from the member document, even though
 *   the candidates came *from* a grant query. That looks redundant and is not:
 *   the program resolver above unions in every superadmin, and the notice being
 *   sent might be one a particular person's grants do not cover. Deriving it
 *   with the same `entitledAdminNotices` the settings screen uses means there
 *   is one definition of who may receive what, rather than a query that
 *   approximates it.
 *
 *   **Subscription** is the device's own `notices` map. These are opt-in — see
 *   `noAdminNotices` — so a grant alone sends nothing.
 *
 * A device whose owner has no member document is dropped. That is a superadmin
 * bootstrapped by `grant-admin.mjs` with no document yet, or a row left behind
 * by a deleted account; neither should be sent to on the strength of a row in
 * `pushDevices` alone, because that row is the one thing here its own owner
 * wrote.
 * ---------------------------------------------------------------------------
 */
async function devicesWanting(uids: Set<string>, notice: AdminNotice): Promise<Recipient[]> {
  if (uids.size === 0) return [];

  const db = getFirestore();
  const recipients: Recipient[] = [];

  /*
   * Chunked at ten because that is the `in` operator's limit. A parish has a
   * few dozen servants, so this is one or two round trips — but the chunking is
   * here rather than assumed away, because the alternative fails silently at
   * the eleventh servant and does so months after this was written.
   */
  const candidates = [...uids];
  for (let index = 0; index < candidates.length; index += 10) {
    const chunk = candidates.slice(index, index + 10);

    const [devices, members] = await Promise.all([
      db.collection(COLLECTIONS.pushDevices).where('uid', 'in', chunk).get(),
      db.getAll(...chunk.map((uid) => db.collection(COLLECTIONS.members).doc(uid))),
    ]);

    const entitled = new Map<string, boolean>();
    for (const member of members) {
      const data = member.data() ?? {};
      const notices = entitledAdminNotices(
        { superadmin: data['superadminMirror'] === true },
        parseScreenAdmin(data['screenAdmin']),
        parseProgramAdmin(data['programAdmin']),
      );
      entitled.set(member.id, member.exists && notices.includes(notice));
    }

    for (const device of devices.docs) {
      const uid = device.get('uid');
      if (typeof uid !== 'string' || entitled.get(uid) !== true) continue;
      if (parseAdminNoticePrefs(device.get('notices'))[notice] !== true) continue;

      const token = device.get('token');
      if (typeof token === 'string' && token !== '') recipients.push({ uid, token });
    }
  }

  return recipients;
}

/** Who to tell about something governed by a screen grant. */
export async function audienceForScreen(
  notice: AdminNotice,
  screen: AdminScreen,
): Promise<Recipient[]> {
  return devicesWanting(await uidsWithScreen(screen), notice);
}

/** Who to tell about a photograph sent to one program's gallery. */
export async function audienceForProgramEvent(
  programId: string,
  programEventId: string,
): Promise<Recipient[]> {
  return devicesWanting(await uidsForProgramEvent(programId, programEventId), 'uploads');
}
