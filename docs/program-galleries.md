# Program galleries

The parish's standing programs — Summercamp, St. Simon for Seniors, College and
Young Professionals, Mother of Mercy, Iconography — shown in photographs, with
the parish itself supplying the photographs.

Three levels:

```
Program          Summercamp
  └ Event        Week 1 2027              ← its own page
      └ Group    Day 1 · Day 2 · Talent Show
          └ Media
```

Anyone may submit photographs without signing in. Nothing they submit is
visible to anybody until an administrator approves it.

---

## 1. This is not the calendar, and it is reached through the calendar

`events` answers *what is coming up*. A Wednesday Liturgy lives there. It has a
start time, a location, and no photographs.

A program event answers *what we did*, and it is mostly photographs. It has
groups, a layout, a submission queue, and a presentation mode. Putting both in
one collection would give every Wednesday Liturgy a `groups` array and a
`submissionsOpen` flag it will never use.

So: **two collections, one entrance.** There is no "Ministries" link in the
navigation. `/events` grows a strip of program cards above the upcoming list,
and the galleries live underneath it:

```
/events                              upcoming list + programs strip
/events/summercamp                   the program
/events/summercamp/week-1-2027       the gallery
```

A program event may name a calendar event in `calendarEventId`, so "Summercamp
Week 1 2027" can also appear on the calendar while it is still ahead. The link
is optional and one-directional.

**Supersedes** the prose page at `/ministries`. `content/ministries/*.md` holds
three unpublished drafts; their text becomes the `description` of the matching
program, after which administrators edit it in the admin screen rather than in
a markdown file. The `/projects-7-*` redirects in `firebase.json` must be
re-pointed at the new program URLs in the same commit that retires the page —
they are the only surviving addresses of those ministries on the old Wix site.

## 2. These pages are client-rendered, and that is a deliberate exception

Every other page on this site is HTML on disk (decision #6). This section is
not. An administrator approving photographs on a Sunday afternoon expects to
refresh and see them, and no amount of rebuild automation makes "create an
event, wait for a deploy" acceptable for something a volunteer does.

Static export has no route for an unknown path, so the mechanism is a Firebase
Hosting rewrite:

```jsonc
{ "source": "/events/**", "destination": "/events/gallery.html" }
```

**Why this does not break the calendar pages.** Firebase Hosting resolves in a
fixed order: redirects, then *exact static files*, then rewrites. `/events` and
`/events/some-liturgy` exist on disk as exported HTML and are served as files —
the rewrite never sees them. `/events/summercamp/week-1-2027` does not exist on
disk, falls through, and gets the shell, which reads `location.pathname` and
renders from Firestore.

The costs, stated plainly because they are permanent:

- **Gallery pages are invisible to search engines.** There is no HTML for a
  crawler to read. This was chosen knowingly over rebuild-on-publish.
- **First paint is a spinner**, not content.
- Slugs must be unique *across* `events` and `programs`, because a calendar
  event whose slug is `summercamp` would shadow the program. Enforced in the
  admin editor, not by Firestore.

## 3. Layout is stored as grid coordinates, never as CSS

The requirement is "move anywhere, resize anything." The constraint is that the
mobile app (program part 2) and every phone browser must render the same
gallery.

A layout expressed in pixels satisfies the first and makes the second
impossible — the same mistake the design tokens avoided. So the editor is a
canvas of **12 columns and uniform rows**. Dragging and resizing snap to it, and
what is stored is four integers:

```ts
layout: { col: 4, row: 2, colSpan: 6, rowSpan: 3 }
```

Twelve columns scale to any width. On a phone the grid collapses to one column
in row-then-column order. The app reads the same four numbers.

`layout: null` means *auto* — the photograph is placed by the packing algorithm
from the showcase set, and reverts to it when an administrator presses **Reset
to auto**. Auto and manual coexist: dragging one photograph pins it and the
rest flow around it.

Each item also carries `focal`, a point in `0..1` naming what must survive a
crop. Without it a square thumbnail of a group photograph cuts off faces.

## 4. Submissions are anonymous, so the defences are technical

There is no name, no email, and no account behind an upload. That is the
parish's choice, and it removes every social deterrent — so the remaining ones
have to hold on their own:

| Defence | Where |
|---|---|
| Firebase App Check | required on the upload path; the only real bar to a script |
| Size and type caps | `storage.rules`, enforced server-side |
| Quarantine prefix | `submissions/` is write-only for the public — no read, no list |
| Approval gate | nothing leaves `submissions/` without an administrator |
| Rate limit | per App Check token, in the submit Function |

**A submitter cannot read back what they uploaded.** `allow read: if false` on
`submissions/`, deliberately: a public-readable quarantine folder is an open
file host, and the approval gate would be decorative.

Uploads are transcoded on approval, not on upload — an unapproved file should
cost nothing but the bytes it sits on. iPhone photographs arrive as HEIC, which
no browser can display, so transcoding is not an optimisation; it is the
difference between a gallery that renders and one that does not.

## 5. Permission is per program, with a per-event override

`role: 'admin'` opens everything, as everywhere else. Below that, a member
document carries:

```ts
programAdmin: {
  programs: ['summercamp'],        // every event, past and future
  events:   ['week-1-2027'],       // that event alone
}
```

Granting a program rather than a list of events is what stops the superadmin
re-granting the same youth servant three weeks every June. Granting a single
event is for the volunteer who helps with one.

This is a third axis, alongside `role` and `screenAdmin`. It is not folded into
`screenAdmin.events`, because that flag means *the parish calendar* and handing
someone Summercamp photographs must not hand them the Liturgy schedule.

## 6. Presentation is a kiosk

Fullscreen, no browser chrome, auto-advancing on an interval, looping forever,
arrow keys to step, `Esc` to leave. It is meant to be started on a screen in the
hall and left alone.

It runs at any level of the tree — one group, one event, or an entire program —
because "present Day 2", "present Week 1", and "present Summercamp" are all
things somebody will want on a given evening. The level is a URL parameter, so
a kiosk can be pointed at one and restarted unattended.

Only media with `placement.slideshow` appears. That is a separate flag from
`placement.onPage`: a page tells a story in twenty photographs, a slideshow
fills twenty minutes with two hundred, and forcing them to be the same set makes
one of them wrong.

Video holds the slide for its own duration rather than being cut off by the
timer — the one place the presentation logic cannot treat the two kinds alike.
