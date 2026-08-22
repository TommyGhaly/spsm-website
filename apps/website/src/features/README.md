# Features

One folder per thing the parish website does. Each owns its data access, its
components, and its domain rules; `src/app/` holds routes that stay thin and
import from here.

The reason for the split: most of these features span several pages, and the
ones that don't yet will. Organizing by kind instead — every component in one
folder, every query in another — means touching one feature edits three
directories and reviewing it means reading three. That cost compounds; this one
doesn't.

## The shape

```
features/<name>/
  data.ts          Firestore access for this feature, and nothing else's
  <Component>.tsx  UI that only this feature uses
  index.ts         the public surface — import from '@/features/<name>'
```

Import across features through `index.ts`, never by reaching into a file. If
feature A needs a file inside feature B, that file probably belongs in
`src/components/` or `src/lib/`.

## What's shared

| | Holds |
|---|---|
| `src/lib/firebase.ts` | client SDK setup, `isConfigured()` |
| `src/lib/firestore.ts` | `safely()`, `docOf()`, `withoutEmbargoed()` — used by every `data.ts` |
| `src/lib/config.ts` | runtime config from Firestore |
| `src/lib/dates.ts` | formatting, always with an explicit time zone |
| `src/components/` | UI used by more than one feature |

## Where each feature stands

| Feature | Route | State |
|---|---|---|
| `content` | `/about` `/beliefs` `/clergy` | Working. Waiting on content. |
| `events` | `/events`, `/events/[slug]`, `/staff/events` | Working, **edited in place on the page**. Typing autosaves into `pendingEdit`; a separate Publish makes it the parish's copy. `/staff/events` exists only for what has no page to be in place on — creating one, and reaching a draft the export skipped. |
| `bulletin` | homepage | **Live with real data.** |
| `announcements` | homepage | Working. Waiting on content. |
| `parish` | `/contact` | Working. Waiting on `config/parish`. |
| `livestream` | `/livestream`, homepage | **Live.** Castr player when streaming; `/livestream` falls back to a notice above the YouTube archive, the homepage section removes itself. |
| `bookstore` | `/bookstore` | Catalog reads. Checkout blocked on decision #5. |
| `parking` | `/parking` | **Working form**, writes to Firestore. |
| `prayer` | `/prayer` | Disclosure ships; form blocked on auth being enabled. |
| `giving` | `/giving` | Working. Needs `NEXT_PUBLIC_TITHELY_GIVING_URL`. |
| `servants` | `/servants` | **Live.** Breeze calendar, framed behind Microsoft sign-in. |

"Waiting on content" means the code works and the source is empty, so the page
renders its empty state. That is different from blocked.

Note `/contact` is a dedicated route, not part of the `[section]` content
template — contact details are structured (an address has parts, a phone number
is dialable) and come from `config/parish`. Because it has its own route,
`contact` is excluded from that template's `generateStaticParams`, or both would
try to emit the same HTML file.

## Two rules that are not style preferences

**Every anonymous query must filter on `published == true`.** Firestore judges a
`list` by what the query *could* return, not by what it did, so it has to prove
from the constraints alone that nothing disallowed comes back. Omit the filter
and the read fails with permission-denied even against an empty collection.
`safely()` re-throws that rather than swallowing it, because a silently empty
section hides a real authorization bug. See `docs/decisions.md` #10.

**Reads happen at build time; writes happen in the browser.** The site is a
static export, so there is no server at request time — no route handlers, no
server actions, nothing to post to. A feature that writes needs a
`'use client'` component going straight to Firestore, which is exactly why
`firestore.rules` validates every field rather than trusting the form.
`features/parking` is the worked example.

**A feature with an admin gets a second data module.** `data.ts` is build-time:
unauthenticated, and every query filters on `published == true`. `admin.ts` runs
in a signed-in browser, reads drafts, and writes. They are separate files, and
`admin.ts` is deliberately *not* re-exported from `index.ts`, so importing it is
a conscious act rather than something a public page can do by reaching for the
barrel. `features/events` is the worked example.

## Adding a feature

1. `features/<name>/data.ts` — build-time reads via `safely()`, browser writes
   as plain exported functions.
2. Components beside it. `'use client'` only where you actually need state.
3. `index.ts` exporting the surface other code may use.
4. A route in `src/app/` that fetches and composes, and holds no logic of its
   own.
5. A rule in `firestore.rules`. The catch-all at the bottom denies anything
   unmatched, so a new collection is closed until you open it deliberately.
6. Any composite index the queries need, in `firestore.indexes.json`. A missing
   one fails at runtime with a console link — cheaper to add up front.
