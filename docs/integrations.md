# Cross-project integrations

Two external Firebase projects with opposite permissions, plus one third-party
SaaS that predates this repo and was documented nowhere until 2026-08-12.

| Integration | Direction | Where | Status |
|---|---|---|---|
| Weekly announcements | **read only** | `weeklyannouncements-1d046` | **live** — read directly at build time |
| Taksis pending vehicles | **write only** | `taksis-a8ba7` | **live** — pushed by `formSubmit`; shape pinned in `schema/taksis.ts` |
| Church calendar | **read only** | Breeze ChMS | **live** — scraped by the `calendar` Function, rendered natively on `/calendar` |
| Embedded forms | **embed only** | tithe.ly, breezechms.com | **live** — a form's address is framed on `/forms/<slug>`; its host keeps the answers, nothing is stored here |

The Breeze **forms API** importer was removed on 2026-09-01 and with it the last
user of `BREEZE_API_KEY`. It copied a Breeze form's questions across as a native
draft. What the parish wanted instead was somebody else's form appearing on a
*parish* page, which is what `kind: 'embed'` does — one address, framed under
the church's masthead and picture, with an "open in a new tab" link above it
because a framed page can always refuse. Both hosts were checked and send no
`X-Frame-Options` and no CSP `frame-ancestors` on their form pages.

The calendar row above is unaffected — it has never used the API.

## Breeze ChMS — the church calendar

The parish keeps its calendar in [Breeze](https://www.breezechms.com/) and
publishes it as an embeddable calendar. Nothing in this repo talks to the Breeze
*API* for this; there is no API key involved and no sync. Breeze is the source of
truth, which is why the schedule is never re-entered and cannot drift.

Worth recording, because the rest of these docs discuss Tithe.ly at length and
none of it applies here: **the calendar is Breeze, not Tithe.ly.** Tithe.ly is
for giving. [Decision #2](decisions.md) evaluates Tithe.ly's ChMS (Elvanto) for
people and calendars — that evaluation is still accurate and still unused,
because the parish already had Breeze.

### Two calendars, one document

| | Firestore field | What is on it | Who sees it |
|---|---|---|---|
| Parish | `parishEmbedUrl` | Liturgies, vespers, Tasbeha, classes, Bible studies | everyone |
| Servants | `embedUrl` | The above **plus** internal logistics — tentative plans, prep days, which van is out | a verified `servant` |

The servants calendar is a superset: its Breeze token grants the parish category
as well as its own, so `dedupeOccurrences` collapses the overlap and the shared
entries stay tagged `parish`.

Both live in `servantsConfig/schedule`. Set or rotate them with:

```bash
node scripts/set-servants-schedule.mjs --parish-url '<url>' --url '<url>' --write
```

Quote the URLs — they contain `&`.

### The URL is the credential, and it no longer reaches a browser

An embed URL carries an encrypted `calendars` token, and Breeze serves the
calendar to **anyone who requests that URL** — verified against the live
endpoint: HTTP 200, no session, no referrer check, and no `X-Frame-Options` or
`Content-Security-Policy`, which is also why framing it used to work.

This used to be handed to the browser. `/servants` fetched the URL after sign-in
and assigned it to an iframe, which was a real improvement on the shared Wix
password it replaced but left an obvious ceiling: a signed-in servant could open
dev tools, copy the URL, and pass the parish rota to anyone, permanently,
undetectably, and unrevocably short of rotating the token for all forty of them.

Now the `calendar` Cloud Function holds it. It reads `servantsConfig/schedule`
through the Admin SDK, calls Breeze, and returns the **events**. Consequences:

- no bearer credential exists in any client, so there is nothing to leak;
- `firestore.rules` gates `servantsConfig` at `read: if false` — nobody, not
  even a servant, because no client needs it any more;
- revoking an account revokes access on the next request, rather than at the
  next token rotation;
- `/servants` is gone. The schedule appears inside `/calendar` for whoever signs
  in, and `firebase.json` 301s both old URLs there.

The URL still must never be committed or logged. It is now a credential held in
one place by one service account, which is the whole difference.

### How the Function actually reads Breeze

Two requests, and the first one is not optional.

1. `GET` the embed URL. It is a host page, not data: it returns a `ci_session`
   cookie and an inline script naming one `/ajax/events/details` source per
   calendar category the token grants.
2. `GET` each of those sources with that cookie, plus `start` and `end`.

Calling the ajax endpoint without step 1 returns **403 with an HTML apology**,
every time. The cookie is what it wants. A browser-shaped `User-Agent` is *not*
required and the Function does not send one — it identifies itself as the parish
website. The one User-Agent Breeze's WAF does refuse is `curl/*`, which is
recorded here because it cost an hour of looking in the wrong place.

The categories are read out of the embed page rather than hardcoded, so adding a
category in Breeze needs no code change — and so the *token* stays the thing that
decides what a URL can see.

### Two quirks in the payload, both found by reading bytes

**All-day ends are exclusive.** `Summer Camp Week 2` starts on the 3rd with an
end of `08/08/2026`, and Breeze's own `date_description` calls it "Mon Aug 3" —
it is a five-day camp, the 3rd to the 7th. Taken literally, every multi-day entry
in the calendar renders one day too long. `breezeOccurrence` subtracts the day;
timed events are *not* exclusive and are not adjusted.

**The same `end` field arrives in two date formats**, in one payload: timed
events use `2026-08-24 17:00:00` and all-day ends use `08/31/2026 00:00:00`. A
parser that reads only the first silently drops every multi-day entry's end.

Both are covered by `tests/unit/calendar.test.ts`, against fixtures copied from
real responses.

### What the Function strips

Breeze ships roughly 47 keys of `metadata` per event, including the full name and
email address of whichever member of staff last saved it. This is on its way to a
public JSON endpoint, so the field is dropped in `breezeOccurrence` rather than
merely ignored — "we do not read that field" is not the same protection as "that
field is not in the response". Descriptions arrive as HTML pasted out of Word and
are reduced to text; Breeze's literal `"No Description"` becomes empty.

### Two duplicate problems, and how each is settled

**Same event, both embeds.** The servants token grants the parish category as
well as its own, so reading both returns every liturgy twice. Measured on the
week of 2026-08-23: all 25 parish occurrences came back from the servants embed
under *identical* instance ids, with only 6 entries genuinely servants-only. The
ids match exactly, so `dedupeOccurrences` keys on `id` alone — **not**
`source:id`, which it did at first, giving the two copies different keys so
nothing collapsed and a signed-in servant saw the whole parish calendar twice.
Parish is read first, so the survivor keeps the `parish` tag and cannot end up
behind the servants gate.

**Same event, Breeze and the bulletin.** Harder, because these are two
hand-maintained systems that disagree. From the real week of 2026-08-24:

| bulletin | Breeze | |
|---|---|---|
| Mon 5:30pm Arabic Tasbeha | Mon 5:00pm Midnight Tasbeha Arabic | same service |
| Mon 7:00pm St. Maurice & St. Verina | Mon 6:00pm St. Maurice & St. Verina | same service |
| Sat 8:00am Saturday Liturgy | Sat 8:00am Divine Liturgy | same service |
| Sat 7:30pm Midnight Praises (Tesbeha) | Sat 7:30pm Tasbeha | same service |
| Fri 7:00pm College & YP Bible Study | Fri 7:00pm Mother of Mercy Meals | **different** |

Matching on title misses four of the five; matching on time merges the sixth and
hides the homeless meals; matching on both misses the two Mondays. So
`mergeCalendarSources` requires the same day, start times within an hour, and
titles overlapping on at least half the shorter one's significant words — with
one edit of slack per word, which is what "Tesbeha" and "Tasbeha" need. It only
ever merges *across* sources (Breeze runs two different Mahragan classes at 7pm
on one evening), and when unsure it keeps both: a visible duplicate is a wart
somebody reports, where a wrong merge deletes a service silently.

The bulletin wins a collision, because it is the sheet the parish published for
that week — hand-written, with the photograph and the contact on it, and with
the corrected times. Every row above is pinned in `tests/unit/calendar.test.ts`.

### The bulletin is part of the calendar now

`/calendar` fetches `/api/bulletin` once on load and folds the active week into
whatever range is showing. It is an enrichment, not a dependency: a failure is
logged and swallowed, and the Breeze schedule renders without it. What it adds
is the photographs, a contact to ring, the corrected times, and the occasional
service Breeze has never heard of — the Tuesday Liturgy, for one.

### How it is presented

Worth recording because two of these reverse an argument that is still findable
in the git history:

- **Weeks run Monday to Sunday**, matching the bulletin's own week. A
  Sunday-first grid put the parish's published week across two of ours.
- **Colour is by kind, not by source** — `occurrenceKind` in
  `schema/calendar.ts` reads it off the title. Liturgical red for services, gold
  for teaching, azure for gatherings, and no colour at all for a title it cannot
  place. It only decides a colour, which is why a heuristic is acceptable here
  and not in the merge.
- Servants-only entries are marked with a dashed rule and a badge rather than a
  colour of their own, so the marking composes with whatever kind the entry is.
- **The week view is a picker wheel** opening on today, with pips down the side.
  Slots must be uniform or the wheel never settles, and the uniformity comes
  from `grid-auto-rows: 1fr` on an auto-height track — every slot as tall as the
  busiest day, nothing clipped. Both the full card and the collapsed peek are
  always rendered and toggled with `visibility`, so the row height does not
  depend on which day happens to be centred.
- **The month view is dots, and pointing at a day opens that week in place** —
  the entries render in the squares. Only the open row grows; expanding one
  moves only the rows below it, so the row under the cursor never slides away.
  Days belonging to the neighbouring month are *not* dimmed: a week that
  straddles two months is still one week.
- **The calendar opens on the month** and runs at `PageBody wide`: the grid is
  seven columns of dates and wants the width, and the rule is to give the
  content more area rather than shrink it to fit.
- **Both views are deliberately dense.** An entry is one line (time, title,
  photo) and the page carries no visible heading, so a week and a month each fit
  without the page scrolling. The one exception is below 30rem, where a title
  wraps rather than being cut off mid-word.

### What staff may add, and what they may not

The calendar is assembled from sources the parish maintains elsewhere, so staff
get two powers over it and they are deliberately different collections:

| | Collection | What it is | May be deleted |
|---|---|---|---|
| Add | `scheduleEntries` | Something the parish is doing that no source knows about | yes — ours |
| Annotate | `calendarDetails` | A note, location, contact or link on an occurrence that already exists | the annotation only |

**Staff may only remove what staff added**, and the two-collection split is what
makes that enforceable rather than merely intended. There is no path in the UI
or in `firestore.rules` that deletes a liturgy, because a liturgy is not in
Firestore — it is in Breeze, and deleting it here would only make the website
disagree with Breeze until the next read put it back. One collection with an
"is ours" flag would have made that a boolean somebody could set.

A detail **never overwrites a title or a time.** Those belong to the source. It
fills the location Breeze always leaves empty, adds a note, a contact and a
link, and appends rather than replaces any description the source carried.

Details are keyed on `CalendarOccurrence.id`, so that id has to stay stable.
Breeze instance ids are; the bulletin regenerates weekly, so a note on a
bulletin entry is a note about *that week's* copy of it — which is usually what
"we are in the hall this week" meant.

Both are edited in place on `/calendar` — the add form under the calendar, the
detail form inside the event dialog — following the same rule as the shop and
the forms drawer. Both are `allow read: if true`, because both are part of the
public schedule.

### Caching and limits

- Parish responses: `s-maxage=600` on Hosting's CDN, so a Sunday morning's
  readers cost Breeze one request per range rather than one per visitor.
- Servant responses: `private, no-store`. A shared cache keyed on a URL must
  never hold a response that depended on an `Authorization` header.
- Five minutes of in-memory cache per warm instance, keyed by scope and range,
  which is what makes stepping back and forth through the weeks cheap.
- Requests are capped at 62 days. A year of the parish calendar is 816
  occurrences and 728KB from Breeze, and an endpoint that serves that on demand
  is a scraping tool with our name on it.

Inspect the bulletin the way the build sees it with `npm run bulletin`.

## The important caveat about "read only" and "write only"

A service account key is a **bearer credential**. Whatever IAM grants it, it can
do — and no amount of care in our code takes that back. The accessor functions
in `secondaryApp.ts` encode intent so mistakes fail fast and legibly in
development; they are *not* a security boundary.

So the restriction has to be applied where the data lives, on the other project.
You said you have admin/owner on Taksis, so you can do this yourself.

Both credentials are in `.env` and both are correctly scoped. Verified against
the live projects on 2026-08-07 with `npm run verify:scopes` — run it after any
IAM change, because "read only" is a claim about the *other* project's IAM, and a
claim nobody checks is a wish.

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

~~**This is why the Taksis path is blocked rather than guessed at.**~~ —
**resolved, Aug 25 2026.** It is Firestore, not Realtime Database, and it is
confirmed rather than inferred: the standalone form at
`~/Desktop/vehicle_registration/index.html` has been writing these records
through the **Firestore REST API**. Everything in this section about RTDB is now
historical.

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

~~3. The shape of one existing record.~~ — **answered, Aug 25 2026, and not by
asking.** A working standalone form (`~/Desktop/vehicle_registration/index.html`)
writes these records directly through the Firestore REST API, which settles the
structure exactly rather than approximately. It is now pinned in
`packages/shared/src/schema/taksis.ts`, with tests in `tests/unit/taksis.test.ts`
that exist specifically because a create-only identity cannot read back what it
wrote — a misspelled field name produces a document Taksis silently ignores and
nothing on our side ever reports it.

```
pending_registrations/<auto-id>
  church   "St. Philopater and St. Mina, Wayland, MA"   <- their spelling; do not tidy
  license  "1ABC23"                                     <- uppercased; there is NO state field
  drivers  [ { name, phone, has_taksis: bool }, … ]      <- up to 5; snake_case is theirs
  present  false
  status   "pending"
  make?    "Toyota"      <- omitted entirely when blank, never sent as ""
  model?   "Camry"
  color?   "blue"        <- one of twelve fixed values; free text will not match
```

**Dedupe: settled by choosing `add()`.** A deterministic id would be idempotent,
but the account has `create` and not `update`, so `set()` against an existing id
is an overwrite it may not be permitted to make — and we cannot read to find out.
`add()` always creates. A double-tap therefore produces two pending
registrations for one plate, which Taksis's own review queue can see and dismiss.
That is a duplicate in front of a person rather than a silent failure in nobody's
logs, which is the better of the two available outcomes.

4. Whether Taksis **watches that path** for new entries (a trigger/listener), or
polls it, or whether a human reviews it. Still open, and still not blocking: the
record is written either way, and `status: 'pending'` says what it is. Worth
knowing only if a write needs to be signalled beyond itself.

~~5. Does Taksis already have its own vehicle registration?~~ — **decided
Aug 25 2026, in the direction this question anticipated.** Writing pending
vehicles into their collection is the whole feature. Our `vehicles` collection is
not even a local cache any more: `/parking` and `/forms/vehicle-registration`
write to Taksis and **nowhere else**.

Tommy chose that with the trade-off on the table — a Taksis outage loses the
submission, where the "write ours first, then push outward" plan further down
would have queued it. What it buys is one answer to "who may park here". The
failure mode of writing both is not an outage; it is two databases disagreeing
six months later with no rule for which wins, and a parking team reading
whichever one is in front of them.

The cost is paid visibly rather than hidden: `formSubmit` returns the failure,
and the page keeps the answers on screen and says nothing was saved. It never
shows a confirmation for a write that did not land. `features/parking/` is kept
but rendered by nothing — the `vehicles` collection still holds the registrations
taken before the switch, and they are a record of something that happened.

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

~~**Taksis: write our record first, then push outward.**~~ — **superseded
Aug 25 2026. Read this as history, not as the design.**

The plan was: write our own `vehicles` document, then mirror it to Taksis, so a
Taksis outage could not lose a parishioner's registration.

What ships instead is **Taksis only, no local copy** — chosen deliberately, with
this paragraph's argument put to Tommy first. The reasoning above is not wrong
about outages; it is outweighed. Two lists of who may park here do not stay in
step, and the version that costs the parish something is not the one where a
write fails loudly, it is the one where two databases disagree quietly.

The obligation that came with choosing it is that a failure must be visible, and
that is honoured: `formSubmit` reports it and the submitter is told nothing was
saved. See `functions/src/forms/taksis.ts`.
