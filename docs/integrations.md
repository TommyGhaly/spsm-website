# Cross-project integrations

Two external Firebase projects with opposite permissions, plus one third-party
SaaS that predates this repo and was documented nowhere until 2026-08-12.

| Integration | Direction | Where | Status |
|---|---|---|---|
| Weekly announcements | **read only** | `weeklyannouncements-1d046` | **live** — read directly at build time |
| Taksis pending vehicles | **write only** | `taksis-a8ba7` | credentials verified, **still blocked** on record shape |
| Servants schedule | **embed only** | Breeze ChMS | **live** — framed on `/servants` behind sign-in |

## Breeze ChMS — the servants schedule

The parish keeps its rota in [Breeze](https://www.breezechms.com/) and publishes
it as an embeddable calendar. Nothing in this repo talks to a Breeze API; there
is no API key and no sync. Breeze is the source of truth and the website frames
it, which is why the rota is never re-entered and cannot drift.

Worth recording, because the rest of these docs discuss Tithe.ly at length and
none of it applies here: **the schedule is Breeze, not Tithe.ly.** Tithe.ly is
for giving. [Decision #2](decisions.md) evaluates Tithe.ly's ChMS (Elvanto) for
people and calendars — that evaluation is still accurate and still unused,
because the parish already had Breeze.

### The URL is the credential

The embed URL carries an encrypted `calendars` token, and Breeze serves the
calendar to **anyone who requests that URL** — verified against the live
endpoint: HTTP 200, no session, no referrer check, and no `X-Frame-Options` or
`Content-Security-Policy`, which is also why framing it works at all.

The website is a static export. Anything rendered into a page is a file on a CDN
that anyone can fetch. So the URL:

- is **not** in this repo, and must never be committed;
- is **not** in `config/*`, which is `allow read: if true`;
- lives in `servantsConfig/schedule`, gated on the `servant` claim;
- is fetched in the browser after sign-in and assigned to the iframe
  imperatively, so it is never serialised into the exported HTML.

Set or rotate it with:

```bash
node scripts/set-servants-schedule.mjs --url '<embed url>' --write
```

Quote the URL — it contains `&`.

**Be honest about the ceiling.** A signed-in servant can open dev tools, copy
the URL, and send it to anyone; Breeze's embed is a bearer URL and nothing on
our side changes that. What this replaces is a single shared Wix password that
everybody knew and nobody could rotate. Access is now per person and revocable:
disable the account and they lose the page. If the rota ever needs to be
genuinely private, that is a conversation with Breeze about their sharing model.

### One quirk worth knowing before you touch `ScheduleEmbed`

The iframe's `src` is assigned in a `useEffect` after mount, not as a JSX
attribute. Rendering `<iframe src={url}>` gives the element a src in the same
tick it is created, and Breeze then draws its toolbar and an empty grid —
reproducibly, on a clean load. Reloading the identical element with the
identical URL and identical dimensions draws it correctly, which rules out both
sizing and the `sandbox` attribute (each was suspected and cleared during
debugging). Mounting first and assigning second is what makes it deterministic.

Inspect the bulletin the way the build sees it with `npm run bulletin`.

Where to point it lives in Firestore at `config/integrations`, not in an env
file, so staff can change the project, the collection, or switch the section off
without a deploy. See [`docs/local-dev.md`](local-dev.md).

Both credentials are in `.env` and both are correctly scoped. Verified against
the live projects on 2026-08-07 with `npm run verify:scopes` — run it after any
IAM change, because "read only" is a claim about the *other* project's IAM and a
claim nobody checks is a wish.

Both run server-side in Cloud Functions. This is not a preference: a browser
client authenticated to the SPSM project **cannot** reach another project's
database regardless of what security rules say. Cross-project access requires
that project's credentials, which can only be held on a server.

Shared plumbing lives in
[`functions/src/external/secondaryApp.ts`](../../functions/src/external/secondaryApp.ts).

---

## The important caveat about "read only" and "write only"

A service account key is a **bearer credential**. Whatever IAM grants it, it can
do — and no amount of care in our code takes that back. The accessor functions
in `secondaryApp.ts` encode intent so mistakes fail fast and legibly in
development; they are *not* a security boundary.

So the restriction has to be applied where the data lives, on the other project.
You said you have admin/owner on Taksis, so you can do this yourself.

### Read-only service account (announcements project)

Grant the service account exactly one role:

- `roles/datastore.viewer`, or a custom role with only
  `datastore.entities.get` and `datastore.entities.list`

Do **not** use `roles/editor` or `roles/owner`. The default "Firebase Admin SDK"
service account that Firebase auto-creates is over-privileged for this — create
a fresh one.

### Write-only service account (Taksis) — *if Taksis is Firestore*

Custom role with only `datastore.entities.create`.

**Consequence to decide on before we build this:** a create-only identity cannot
read, which means it cannot check whether a registration already exists and
cannot run a transaction. So deduplication has to happen either:

- on the Taksis side, or
- via a **deterministic document id** (e.g. a hash of normalized plate + state +
  date) so that re-sending the same registration overwrites rather than
  duplicates. Note this needs `datastore.entities.update` too, which slightly
  widens the role.

If we instead give the account read access, dedupe is trivial but it stops being
write-only. That's a genuine trade-off, not an oversight — worth a decision.

### If Taksis is Realtime Database instead

Your phrase "a root branch in the database" sounds like **Realtime Database**
("branch"/node is RTDB vocabulary; Firestore has collections and documents).

If so, everything above changes:

- Write-only is expressed in that project's **RTDB security rules** on the path
  (`".read": false, ".write": "..."`), not in IAM.
- The Admin SDK call is `getDatabase(app).ref('/pendingVehicles').push(...)`,
  not `getFirestore`.
- RTDB has no document ids, so the dedupe story is different again — `push()`
  generates a new key every time, so idempotency needs an explicit
  deterministic key via `.child(key).set(...)`.

**This is why the Taksis path is blocked rather than guessed at.**

---

## What I need from you

### For Taksis — the walkthrough you offered

~~1. Realtime Database or Firestore?~~ — **Firestore**, confirmed: the service
account holds `datastore.*` permissions, which only exist for Firestore. RTDB is
off the table, so the IAM path applies and the RTDB rules file is moot.

~~2. The exact path of the root branch.~~ — `pending_registrations`.

**Dedupe is now decided for us, and it's the constrained option.** The deployed
account has `datastore.entities.create` and *not* `update`. So a deterministic
document id does **not** buy idempotency — a re-send is a second document, not
an overwrite. Either dedupe happens on the Taksis side, or the role needs
`datastore.entities.update` added. Nothing else works, and this is worth
settling before the sync is written rather than after it duplicates a
registration.

Still open, and the one that actually blocks the code:

3. The **shape of one existing record**, field names included. Please redact any
   real personal data; I need the structure, not the contents. This is the last
   hard blocker — we cannot read the collection to infer it ourselves, which is
   the write-only design working as intended.
4. Whether Taksis **watches that path** for new entries (a trigger/listener), or
   polls it, or whether a human reviews it. This decides whether we need to
   signal anything beyond the write.
5. Does Taksis already have its own vehicle registration? Your requirements doc
   flagged this and it's still open — if the answer is yes, writing pending
   vehicles into their branch may be the *whole* feature and our `vehicles`
   collection becomes a local cache rather than the source of truth.

### For weekly announcements

~~1. The Firebase project id.~~ — `weeklyannouncements-1d046`.
~~2. The collection path and the shape of one document.~~ — read off the live
project; see [the schema below](#what-the-announcements-project-actually-holds).

~~3. Is it still actively maintained?~~ — **Yes, and it is a singleton that gets
overwritten every week** (confirmed 2026-08-07). The collection will hold
exactly one document indefinitely.

### Decided: read through, do not mirror

An earlier version of this archived each week into a `bulletins` collection in
our own Firestore. **That was removed on request.** The website now reads the
announcements project directly during `next build` and bakes the result into
static HTML. There is no copy in `spsm-database` and no scheduled Function.

What that buys:

- One source of truth. No mirror to fall behind, no `syncedAt` to reason about,
  no scheduled job to watch, no second collection to secure.
- Editing the bulletin over there and rebuilding is the whole publishing story.

What it costs, stated plainly so nobody rediscovers it later:

- **No history, permanently.** The source keeps one document and overwrites it
  every week. Once it rolls over, that week is gone from every system that has
  ever held it. Only a build that ran while a given week was current ever saw
  it, and the built HTML is the sole surviving trace.
- **The build needs a credential.** Reading another project requires its service
  account, so `next build` no longer runs from public config alone — see
  `docs/local-dev.md`.
- **The site is as fresh as its last build.** A mid-week correction over there
  does not reach the site until something rebuilds.

If history ever matters, the archive has to be reintroduced *before* a rollover,
not after — there is no backfill. The parsing half already exists and is
reusable: `parseBulletin` in `packages/shared/src/schema/bulletin.ts` is pure and
SDK-free, so it would take a scheduled Function and a collection, nothing more.

Still open:

4. How fresh does the mirror need to be? See above — this is now partly answered
   by the risk of missing a week entirely. Hourly is cheap and safe.
5. **Who owns that app?** It writes to Telegram (`telegramMessageIds`,
   `telegramLastSent`), so a publish already fans out somewhere. Worth knowing
   whether the website becomes a second consumer or replaces that path.

### What the announcements project actually holds

Not a list of announcements. `bulletins` holds one document per **weekly
bulletin session** — the working state of a slideshow builder. This matters
because our `announcements` collection is typed for homepage/push announcements,
so the sync is a **transformation, not a copy**.

```
bulletins/{uuid}
  id                  string (uuid, duplicated from the doc id)
  type                'session'
  weekLabel           'August 3, 2026'
  presetName          'Summer Camp Week '     ← note the trailing space
  templateId          uuid

  announcements[]     { id, text, image, addedAt }
  days[]              7 × { date: '2026-08-03', day: 'Monday', duration,
                            events[]: { id, name, time, timeTo, notes, color,
                                        image, contacts[], presetId, modified } }
  multiDayEvents[]    { id, name, startDate, endDate, time, timeTo, color,
                        notes, image, contacts[], startOffset, endOffset }

  headerNotes[]  images[]  slideImages[]  slideDurations{}   ← all empty in the sample
  createdAt / updatedAt / lastPublished / telegramLastSent   ← ISO 8601 STRINGS
  telegramMessageIds[]  number
  lastAnnouncementsSent, lastPublishIncludedAnnouncements
```

Three things to design around:

- **Timestamps are ISO strings, not Firestore `Timestamp`s.** Convert at the
  mirror boundary so our side stays consistently typed and orderable.
- **`days[].events[]` is a parish weekly calendar.** It overlaps our `events`
  collection. Decide deliberately whether the mirror feeds `announcements` only,
  or whether these events also populate `events` — mirroring into both without a
  shared external id is how the same liturgy ends up on the site twice.
- **Only `announcements[]` maps cleanly to our `announcements` collection.**
  Everything else is slideshow-builder state (`slideDurations`, `templateId`,
  `presetId`) that the website has no use for. Mirror the content, not the
  editor's scratch space.

---

## Design note: the two integrations are no longer symmetric

They used to be described as one pattern — mirror everything. They aren't.

**Announcements: read through at build time.** No copy in our Firestore. A
static export reads at build time anyway, so "read through" and "mirror" collapse
into nearly the same thing for rendering; the difference is only whether history
accumulates. It doesn't. See the decision above.

One property worth noting: because the output is static HTML, an outage over
there cannot break the live site. It can only make the *next build* miss the
bulletin section — and that build logs why rather than failing.

**Taksis: write our record first, then push outward.** This half is unchanged
and the reasoning still holds. We write our own `vehicles` document, then mirror
it to Taksis, so a Taksis outage cannot lose a parishioner's registration. The
mirrored record carries the external id so a failed push is detectable rather
than silently indistinguishable from a successful one.
