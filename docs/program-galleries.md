# Program galleries

The parish's standing programs — Summercamp, St. Simon for Seniors, College and
Young Professionals, Mother of Mercy, Iconography — shown in photographs, with
the parish itself supplying the photographs.

**A tree, as deep as the parish wants it.** A program is the root; beneath it
every level is a `programEvents` document naming the one above it in `parentId`,
and every one of them has its own page, its own gallery, its own arrangement and
its own submission queue.

```
Program              Summercamp                ← /events/summercamp
  └ Level            2026                      ← /events/summercamp/2026
      └ Level        Week 1                     …/2026/week-1
          └ Level    Day 1 · Day 2 · Talent Show
              └ Level    The hike               …/2026/week-1/day-2/the-hike
                  └ Media
```

### Every level summarises everything beneath it

This is the whole idea, and it is what the structure exists to serve. Summercamp
shows photographs drawn from every year of camp. Week 1 2026 shows photographs
drawn from each of its days. Day 1 shows Day 1.

So no page here renders "its own" photographs — every page renders a summary of a
*subtree*, and the deepest level is only special in that its subtree is one node.
Which photographs is an editorial choice at each level (`featuredMediaIds`,
chosen in a picker that offers everything beneath that level); left alone, the
summary is generated, and a generated one **spreads across the children** rather
than taking the newest twenty. See §8.

### What this replaced, and why it had to change

There were three fixed levels — program, event, and inline `groups` on the event
— and the third had no page of its own. Two things were wrong with it, and only
the second is about depth:

- **A level could not summarise below itself.** "Week 1" counted only the
  photographs filed directly on it, so a week whose four days held fifty each
  reported "0 photographs" and rendered as an empty camp.
- **There was no fourth level.** A subgroup was a name in an array, so "the hike
  on the afternoon of Day 2" had nowhere to go.

`scripts/migrate-gallery-tree.mjs` converts the old shape: each group becomes a
child document and its photographs are re-filed onto it. `ProgramEvent.groups`
and `GalleryMedia.groupId` are both left in place, deprecated and read nowhere —
they are the only record of where a photograph used to sit.

Anyone may submit photographs without signing in. Nothing they submit is
visible to anybody until an administrator approves it.

---

## 1. This is not the calendar, and it is reached through the calendar

`events` answers *what is coming up*. A Wednesday Liturgy lives there. It has a
start time, a location, and no photographs.

A gallery level answers *what we did*, and it is mostly photographs. It has
children, a layout, a submission queue, and a presentation mode. Putting both in
one collection would give every Wednesday Liturgy a `parentId` and a
`submissionsOpen` flag it will never use.

So: **two collections, one entrance.** There is no "Ministries" link in the
navigation. `/events` grows a strip of program cards above the upcoming list,
and the galleries live underneath it:

```
/events                                          the programs strip
/events/summercamp                               the program
/events/summercamp/2026                          a level
/events/summercamp/2026/week-1/day-2/the-hike    …and any depth below it
```

Every segment after the program is one level's `slug`, and a slug is unique among
its **siblings** only — four camps may each have a `day-1`. So a URL is resolved
by *walking* the tree (`resolveTrail`), never by matching the last segment: that
is the difference between showing a visitor the camp they asked for and showing
them a different one under a URL that looks right.

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

## 6. Presentation is a kiosk, and it is a collage

**Built:** `features/programs/Presentation.tsx`.

Started on a laptop in the hall and left alone for an evening. Every decision
follows from that sentence: it starts by itself, it never ends, a file that fails
to load costs nothing, and the chrome and the mouse pointer disappear after a few
seconds.

It runs at any level of the tree, because "present Day 2", "present Week 1" and
"present Summercamp" are all things somebody will want on a given evening. **The
level is the path**, so a kiosk is pointed at whatever page it should present and
restarted unattended.

| URL | What it shows |
|---|---|
| `/events/summercamp?present=all` | every camp in the ministry |
| `/events/summercamp/2026?present=all` | that year |
| `/events/summercamp/2026/week-1/day-2?present=all` | that day, and the hike inside it |

The query used to name a subgroup — `?present=day-2` — because the third level had
no URL of its own to be presented from. Every level has one now, so all the query
still says is *that* the page is being presented. An old kiosk bookmark carrying a
subgroup id still works: it presents the level in its path rather than failing.

**Everything approved in the subtree appears**, at Tommy's direction. There was a
`placement.slideshow` flag and it is no longer read — the field is still on the
documents and the switch that set it is off the properties panel, because a
control that changes nothing is worse than no control.

The argument it was built on was real and still wrong here: a page tells its story
in twenty photographs and a hall screen fills an evening with two hundred, so the
two sets should not be one. But the *page* set is already chosen —
`featuredMediaIds` at every level, and `placement.onPage` under it — and a hall
screen wanting everything needs no second flag to say so. What the flag actually
bought was a third thing to remember to tick, and its ordinary failure was a camp
approved on Saturday and a blank screen in the hall on Sunday.

### It is not a slideshow, and that is the point

The first version was one photograph at a time, held for eight seconds,
cross-fading. Two things were wrong with it and they are worth writing down,
because "just show the next picture" is the obvious design and it is the bad one:

- **Nothing was happening.** For seven of every eight seconds the screen was
  still. On a wall, that reads as a screensaver.
- **`object-fit: contain` put every picture in a void.** The screen is 16:9 and
  almost no photograph is, so each one floated in bands of empty ground.

It is now **several columns of photographs filling the screen, drifting
continuously, with neighbouring columns moving in opposite directions.** Each tile
is the shape of its own picture, so filling the tile crops nothing — the box and
the photograph agree. There is no slide, no timer and no index, which also
removed the entire class of bug where the advance timer and a video disagreed
about whose turn it was.

Each column is a `DragRail axis="y"` — the same component a `column` section uses
on a public page. The endless loop, the sub-pixel drift accumulation, the
tab-away clamp and the `prefers-reduced-motion` opt-out are all subtle and all
already solved there. A negative `speed` is all "drift the other way" takes.

**Video autoplays, loops, and is muted.** Muted is not a compromise: an
unattended page has no user gesture behind it, so an unmuted clip is *refused*
and the tile sits on its poster frame. The lightbox, which only ever opens from a
click, does have sound.

Two things worth knowing before changing it:

- **It reads the query without `useSearchParams`.** That hook suspends, and under
  `output: 'export'` a suspending hook opts the whole route out of prerendering.
  `isPresenting` in `route.ts` reads `location.search` instead, and is
  unit-tested for it.
- **Real fullscreen needs a gesture.** `requestFullscreen` is refused outside a
  user gesture, so an unattended kiosk cannot ask for it on load. It fills the
  viewport regardless — the browser's own chrome is all that remains — and a
  button, or `f`, asks for the rest.

Leaving drops the query with `history.replaceState` rather than navigating: the
gallery behind it is already mounted, and a route change would re-run every
Firestore read to show a page that is already in memory.

## 7. A photograph opens

**Built:** `features/programs/Lightbox.tsx`.

The grid crops every picture to a cell — it has to, or an arrangement is
impossible — so a click has to be able to show the whole thing. Wrapping arrows,
`Esc`, swipe, the neighbours preloaded, and the caption underneath.

Video plays with the browser's own controls **and with sound**, unlike the
presentation, which is muted. A lightbox only ever opens from a click, and a
click is the gesture an autoplay policy wants; an unattended slideshow has no
gesture behind it, so an unmuted clip there is simply refused and the slide sits
on its poster frame.

## 8. Every level shows pictures, chosen from anywhere beneath it

**Built:** `packages/shared/src/gallery/tree.ts` — pure, shared with the mobile
app, and unit-tested in `tests/unit/galleryTree.test.ts`.

`featuredMediaIds` is an **ordered list of ids**, on the program and on every
level under it, and the order is the content: it is the order the page draws them
in.

Not a fourth `placement` flag, and not a boolean per document. Two reasons:

- A set of booleans across fifteen documents cannot hold an order, and
  arranging the page *is* choosing the order.
- It is one write. A flag per photograph is fifteen writes that can fail on the
  third, leaving a page half-arranged.

The picker (`MediaPicker.tsx`) offers **every approved photograph beneath the
level being edited** — on Summercamp that is every year; on Week 1 2026 it is
every day of that week. Each option is headed by its whole trail ("Week 1 2026 ·
Day 1") rather than its own title, because four camps each have a "Day 1" and a
list of four identical headings is a list of four guesses.

### Left alone, the summary is generated — and it spreads

An empty list is the ordinary state, and what happens then depends on whether the
level has anything under it:

- **A leaf** shows everything filed on it, uncapped, in `order`. That is the
  gallery, and it is why the deepest level is worth opening without anybody
  curating anything.
- **A branch** takes the head of each child's own summary in turn, round by
  round, plus its own directly-filed pictures as one more pool in that rotation.

The spread is the part that matters. "Newest first" does not summarise: a
Summercamp page filled from a flat newest-first list is twenty photographs of one
afternoon of the most recent camp — a summary of that afternoon. Round-robin means
every camp is represented before any camp is represented twice, and because each
child summarised *itself* the same way, the top of the tree shows the whole tree.

Within an uncurated pool the showcase photographs (`placement.homepage`) lead,
that being the nearest thing to an editorial judgement that exists without asking
anybody. A **curated** child's order is left exactly as chosen — its order is an
editorial statement, and re-sorting it would overrule the person who made it.

Ids that no longer resolve are dropped on read rather than cleaned up on write: a
photograph can be rejected long after it was featured, and a page must not go
blank because one of six pictures went away.

### Anything filed on a branch that the summary did not show

…gets a closing block, headed "Also from here". Not "Unfiled" or "Other": this is
a public page, and a heading naming an administrator's filing state tells a
parishioner looking for a photograph of their child nothing at all.

It exists because a submission arrives filed against the level it was uploaded to
and stays there until somebody files it deeper — so on a live gallery this is the
common case, and a branch whose summary is a spread across its children has room
for only a few of its own.

### Counts are of the subtree, always

A card saying "Week 1 2026 — 4 parts · 214 photographs" counts the whole subtree.
The per-document count it replaced said "0 photographs" about that same week and
read as an empty camp. So does the cover: an administrator may choose one from
anywhere beneath, and the automatic one is found the same way — which is what
makes a cover possible at all for a week that has no photographs of its own.

### Two reads per page, whatever the depth

`getGalleryLevel` makes them, in this order because the second depends on the
first:

1. **The whole tree** for the program, in one query. Not one generation — a page
   that summarises what is beneath it has to know what is beneath it, and a
   generation-at-a-time read is a query per level per page that gets slower every
   year the parish runs camp.
2. **The subtree's photographs.** Up to thirty levels is one `in` query, exact and
   uncapped: every photograph in that week comes back however many years sit
   beside it in the collection. Wider than that — a ministry with a decade under
   it — falls back to one capped `programId` query filtered in memory, and the cap
   is an honest cost: a level with nothing inside the window shows no cover and no
   count, the same as one that truly has no photographs.

There is deliberately **no stored `path` or `depth`** beside `parentId`, though
both would shorten some reads. They are derived facts, and a derived fact stored
on every descendant has to be rewritten for all of them when a level moves — an
unbounded client-side cascade that can stop halfway, leaving a tree that
disagrees with itself about where a camp lives. `parentId` alone cannot be
half-right.

A level whose parent is missing from the tree is **lifted to the top of its
ministry, not dropped**. That is the ordinary state rather than an error: the
public read filters on `published`, so an unpublished "2026" with three published
weeks under it is a real shape, and dropping those weeks would make the parish's
photographs invisible because of a switch on a document nobody can see.

## 9. Every section arranges itself

**Built:** `packages/shared/src/schema/sectionLayout.ts`,
`features/programs/GallerySection.tsx`.

A "section" is a titled block of photographs, and **every level arranges its own
independently**:

```
Program          Summercamp            → Program.sectionLayout
  └ Level        2026                  → ProgramEvent.sectionLayout
      └ Level    Week 1                → ProgramEvent.sectionLayout
          └ …    at any depth
```

One field on one document per level, which is what made the third case of
`setSectionLayout` disappear: a subgroup's layout lived inside an array, and
Firestore cannot address an array element — so changing one meant read, replace,
write back the whole array, which could silently lose a concurrent edit to a
*different* subgroup of the same gathering. Two administrators arranging two
different days now write two different documents.

The reason a layout belongs at every level rather than only at the top: "Day 1"
and "Talent Show" are not the same kind of set. Forty snapshots of an afternoon
want a sideways rail; six posed photographs want a composition. Forcing them to
share one arrangement makes one of them wrong.

### Three displays

| `display` | What it is |
|---|---|
| `grid` | the twelve-column canvas — the only one that can hold a composition. The default. |
| `rail` | one row, scrolling sideways, drifting on its own |
| `column` | a tall frame with a single column drifting upward inside it |

`rail` and `column` are the **same mechanism on different axes** — `DragRail`
takes an `axis` — which is why they are two values and not two features.

A vertical rail deliberately claims **fewer gestures** than a horizontal one: it
takes neither touch nor the wheel, only a mouse drag. On the axis the page scrolls
on, the gesture a reader means and the gesture the rail wants are the same one, so
a column filling most of a phone screen would stop the page scrolling. There is no
threshold that gets out of that. The horizontal rail has no such problem, which is
why it can take the axis it is on.

### Presets, never numbers

Every field is a name from a short list — `'large'`, `'beside'`, `'center'` — and
never a pixel value. Two reasons:

- The person using the editor is a parish volunteer a few times a year. A named
  choice cannot produce something broken; a font-size box can.
- **The mobile app has to render the same section and has no CSS.** A stored
  `1.375rem` means nothing to it; `'large'` is a key it maps to its own type
  scale. Same contract as the design tokens, for the same reason.

`scale` sets **one variable per display, and the variable differs** — a grid
counts in row heights, a rail in tile height, a column in frame height. The four
names are the contract; the numbers are per display, in globals.css.

### `width`: how blocks come to share a row

`scale` is the size of the *pictures*. `width` is the size of the *block*, and it
is the only reason two blocks can sit beside each other. Tommy asked for it as
"a grid next to a vertical scroll wheel", which was not expressible: every block
took the whole measure, so a page of blocks was a stack and nothing else.

Four names — `full`, `two-thirds`, `half`, `third` — over a twelve-column page
grid, `.blocks` in globals.css. Nothing pairs two blocks and there is no row
object: they flow into the columns in their own order and a pair that fits shares
a row. Auto-placement never runs backwards, so the order blocks are written in is
the order they appear in, and one that does not fit starts a new row.

Below 700px — `GALLERY_COLLAPSE_BELOW`, the same line the canvas inside a block
collapses on — every block is full width. A third of a phone is about 110px,
which is narrower than one legible photograph.

`full` is the default, so adding the field changed no existing page.

#### The control is the block's own edge

Not a row of preset buttons in the block bar, at Tommy's direction. The bar
already carries seven controls, and four more would have made the width the
loudest thing about a block while being the thing you set once — so it is a
handle on the right edge that snaps to the four positions as it travels, the same
argument that made *moving* a block a drag rather than a pair of buttons.

The snapping is `nearestSectionWidth`, in shared rather than in the handle, so the
mobile app's own editor lands on exactly the same four places. A drag has no
keyboard, so the handle is a focusable `role="slider"` and takes ← and → as well.

**Built:** `SECTION_WIDTHS` in `schema/sectionLayout.ts`, the handle in
`BlockFrame`, `.blocks` and `.block__resize` in globals.css.

### Nothing reads the raw field

Every collection here predates this, seeds write partial documents, and a
hand-edited console entry can hold anything. So readers call
`resolveSectionLayout`, which fills every gap from the defaults and **replaces**
anything it does not recognise rather than carrying it through. The defaults are
the arrangement these pages already had, so adding the field to a document changes
nothing about how it renders.

### The editor: one mode, one properties column, every level

Every level of the tree is edited the same way — `/events`, a ministry, a
gathering, a subsection, a photograph — and there is **one way in**: an *Edit this
page* button in the corner. Nothing else appears for an administrator until they
press it. With edit mode off they see exactly what a visitor sees, which is the
only honest way to judge a change.

Pressing it docks a properties column on the right. It has two parts, and the split
matters:

- **A menu of the page's parts**, at the top, *independent of the selection*. On
  `/events` that is the ministries; on a ministry, its gatherings; on a gathering,
  its parts. Add, reorder, rename and remove live here, because they are
  operations on the list rather than on any one member of it. It used to appear
  only when the page itself was selected, so choosing a part replaced the list you
  chose it from — a menu you navigate from has to stay put.
- **The properties of whatever is selected**, below it.

Selection is by clicking the thing itself *or* by picking it from the menu — which
also scrolls it into view, because selecting something three screens down that you
cannot see is not selecting it.

#### The controls are on the things

**Built:** `features/programs/BlockFrame.tsx`, `features/programs/PictureStrip.tsx`.

Tommy said the editing was too complicated four times. The first three answers
were all panel work — controls off the page into a properties column, the column
into collapsed rows, the rows into a list, the list to the bottom of the screen.
Each was a smaller panel. None was the point. The fourth time:

> it should be easy to simply drag a scrollwheel to where I want it to be and
> delete it when I don't want it anymore same with the rest of the pictures and
> videos

**Moving a block is a gesture, and no arrangement of a settings list makes a
gesture out of a button labelled "Move up the page."** So:

| On a **block** | On a **photograph** |
|---|---|
| a grip — drag it up or down the page | drag it to reorder, in a wheel or on the grid |
| three shape buttons — grid, sideways, upright | × — take it out of this block |
| × — remove the block | ⤢ — open it |
| **Add pictures** — choose from any subsection | |
| **Back to automatic** — follow the page again | |

The toolbar sits over the block's own top-right corner. *Over*, not beside: a bar
in the flow would push every block down by its height the moment edit mode came
on, and the premise of editing in place is that the page does not move when you
start. It is `opacity: 0; pointer-events: none` for a visitor, so the markup is
inert rather than conditional.

The first block has **no grip and no bin**, and draws neither. It is the page's
own block — stored in `sectionLayout` rather than in `bands`, always present — and
a disabled grip is a control that exists to say no.

Adding a block is three buttons at the *end of the blocks*, on the page. What it
makes appears right there, and a button that makes a thing belongs next to where
the thing lands. It was a properties row whose whole body was these buttons — a
click spent to reveal a click.

#### A wheel gets its own editing view

A grid has the canvas: drag a tile, resize it, the packer routes the rest around
it. A wheel has no canvas because its layout is not a set of positions, it is an
**order** — so the only meaningful arrangement is "this one before that one".

While editing, a wheel is therefore a **still, scrollable strip** rather than the
drifting rail. Two reasons, both hard:

- The rail renders its children two or three times to hide the loop's seam, so a
  duplicate tile carries the same id as its original and "which one did you grab"
  has no answer.
- A strip moving under the hand cannot be aimed at.

Same tiles, same size, same order, held still. Unlike the blocks — which move one
place per drag, because a page has at most four — a wheel can hold hundreds, so
the gap opens wherever the pointer is: the target is whichever tile's midpoint it
has passed, recomputed from live boxes on every move (tiles are each the shape of
their own photograph, so a panorama and a portrait are nowhere near the same
width).

Both drags are pointer events, not HTML5 drag-and-drop, which does not fire on
touch at all.

#### Each block carries its own pictures

**Built:** `GalleryBand.picks` / `.hidden`, `pagePictures`, `BlockFrame`'s footer.

This has now been both ways round, and the middle version is the one that reads
best on paper. Each block once carried a `source` — a *rule* for which photographs
it drew — and that went, rightly: a page became several independent galleries
stacked, each answering a question the page had already answered. What replaced it
was **one set per page, many ways to show it**.

Tommy, on that:

> the settings in the editing are still getting pretty confusing … for each
> section I want an add button that lets the admin pick from all subsections and I
> want an x at the corner of every picture to simply delete it

Which is a block owning its pictures again. What makes it right this time is that
it is no longer a rule to configure. Two lists per block, and both are the record
of a gesture:

- **`picks`** — what somebody ticked in the picker under that block. The picker
  opens with the block's current photographs *already ticked*, so the first click
  is "change this one" rather than "start a list", and it offers every approved
  photograph in every subsection, grouped and headed by its whole trail.
- **`hidden`** — what somebody pressed × on.

Three states, not two, and the third is load-bearing in both directions:

| `picks` | means |
|---|---|
| `null` | nobody has picked. Follows the page — the automatic spread, or everything beneath when `showAllPictures` is on. |
| `[]` | empty on purpose. A block just added, or one emptied by ×. |
| `[…]` | exactly those, in that order. |

`null` is what every band written before the field reads as, so adding it changed
no existing page. And `[]` had to stop meaning "follow the page" twice over:
*"adding a new block should add empty"* — a block that arrives full of the page's
photographs is one you must empty before you can fill it — and in the other
direction, × on the last picture in a picked block used to make twenty-four
reappear.

The page's own first block keeps its pair in `featuredMediaIds` and
`hiddenMediaIds` on the program or the node, with only **two** states: empty has
meant automatic there since long before any of this, and it is never a block
anybody *adds*. Both homes resolve through the same `pagePictures`, with the call
site saying which it means — better than a second resolver that could disagree.

#### The × is a hide, not a delete

Applied **last** by `pagePictures`, and a separate list from the picks for a
concrete reason: a block in "all of them" can be showing two hundred photographs,
and a picked list is capped at twenty-four. Expressing "these two hundred minus
one" as a picked list would silently throw away a hundred and seventy-five.

The × therefore writes **both** lists — off the picks, onto the hidden — which is
what makes it behave the same however the block got its pictures. A picked block
loses one; an automatic block loses one and stays automatic.

Applied *last* also matters: filtering before the summary runs would let the
automatic spread **replace** each removed picture with another one, so taking off
a photograph you did not want would produce a different photograph you had not
asked for. Afterwards, a removal leaves a block of one fewer.

Put back with **Back to automatic** in the block's own footer, which clears both
lists. It was a button in the properties panel, on the reasoning that a hidden
picture draws nothing and so has no thing to put a control on — true of the
picture, and the *block* is a thing, right there, and is what the control is
actually about.

Every write here is the whole list, not `arrayUnion` of one member. That reverses
an earlier call and the reason is not concurrency between people but concurrency
inside one click run: React batches a run of quick ×s into one re-render, so the
page's copy of the list has to be built with functional state updates or every ×
in the run starts from the same stale list and the last one wins. Driving the
picker from a script found exactly that. The cost is that two people tidying the
same page in the same second lose one click; the bug was a run of six ticks adding
one photograph.

#### What is left in the panel

**Two rows.** Everything that is a position or a deletion went to the page.

| Selected | The rows |
|---|---|
| a level, or a ministry | Which photographs · This gathering |
| a level *inside* this one | none — one panel |
| a photograph | Caption · What must stay in frame · Where it goes |
| a block | Heading — the only thing about it that is words |

A panel is good for two things and those are what is in it: **a decision with no
gesture** and **text in fields** (a name, dates, a caption).

The only such decision left is page-wide by nature: whether a block *nobody has
picked for* summarises this level or shows every photograph in it. Which
photographs any particular block draws is no longer in here at all — it is an
**Add pictures** button under that block, and an × on every picture in it. See
[Each block carries its own pictures](#each-block-carries-its-own-pictures).

#### The panel's own shape

#### The properties are a list of the things on the page

**Built:** `features/programs/Disclosure.tsx`.

Closed, a row is its name and the value it currently holds. Open, it is the
controls. One at a time.

| Selected | The rows |
|---|---|
| a level, or a ministry | Photographs · one per scroll wheel · This gathering |
| a level *inside* this one | none — one panel |
| a photograph | Caption · What must stay in frame · Where it goes |

**The list is of things, not of settings, and that is the third version of this
panel.** It went 6 rows → 6 rows → 2. Tommy said it was confusing three separate
times; the first two answers *reorganised* — controls off the page into a
properties column, then the column into collapsed rows — which made the panel
shorter twice and never smaller once, because the count never went down.

What changed the third time is the question the panel asks. A list of settings
multiplies: every new capability is another row, for ever. A list of *the things
on the page* — this block, that wheel, the page itself — cannot grow more rows
than the page has blocks, and each thing holds everything about itself.

So the rows that were about no particular thing went into the thing they belong
to:

- **"Arrangement"** is inside the block it arranges.
- **"Its card picture"** is with the page's own name and dates, because it is
  about how this level is represented elsewhere, not about anything on this page.
- **"Add a scroll wheel"** is two buttons under the list. Adding is not a property
  of anything, and a row whose whole body is two buttons is a click spent to
  reveal a click.
- **A photograph's "Where it appears", "Its place in the block" and "Filed
  under"** were three rows asking three parts of one question. One row.

One line of instruction sits permanently between the list and the properties:
*click a photograph, or a picture card, to change that one*. Deleting settings
cannot answer "I have no idea how to edit anything" — that is a question about
discoverability, and the one thing the panel cannot say by being well arranged is
that the way to edit a photograph is to press the photograph.

This replaced every property being expanded at once, and the numbers are the
argument. A gathering page's panel held **78 controls and 36 photograph tiles in a
column 435px tall that scrolled 2,567px** — two eighteen-tile picture pickers, each
with its own filter chips, stacked on an 800px form. Closed, the same panel is
403px and four rows.

The collapse is not the interesting half. **The values are.** "Pictures on this
page · chosen for you", "Arrangement · Sideways rail, large", "This level · 18–26
July" states the condition of the page in four lines, which the expanded version
never did however far you scrolled it — a wall of controls shows you what you
*could* change, not what is currently true.

Two details:

- **A closed row is absent from the DOM, not hidden.** So nothing in it is
  tabbable, nothing is read by a screen reader, and — the reason that matters most
  here — it is not fetching eighteen thumbnails.
- **Nothing is open by default on a level**, because somebody who has just pressed
  Edit has not yet said which of the four they came for, and guessing a picker
  would open a grid of thumbnails on a page they may only have wanted to rename. A
  *photograph* opens on its caption, which is the exception that earns itself: an
  item arrives from the approval queue with none, and the caption is also its alt
  text.

Why not `<details name="">`, which does exclusive groups natively: it drives them
from the DOM, and this panel re-renders from React state on every write and every
selection change. The two disagree, and the disagreement looks like a row that
will not stay open.

#### A block has two settings, not seven

**Built:** `layoutForLook` in `schema/sectionLayout.ts`.

`SectionDesigner` had seven rows and twenty-two chips — Layout, Size, Movement,
Title size, Title position, Title alignment, Captions — and there is one of these
per block on a page that can carry four. That was the bulk of "wayyyy too many
settings".

It has two rows and seven chips: **Shape** (Grid, Sideways wheel, Upright wheel)
and **Size** (Small, Medium, Large, Full). A block's *width* is deliberately not
a third row — it is the handle on the block's own edge; see above.

The typography is set by the shape, one house style each:

- **The title is always small caps above.** That is the eyebrow every other
  section of the site uses, and a gallery is not the place to invent a second
  heading style. Configurable, it bought nothing but the chance of a 40px serif
  title over a strip of camp photographs.
- **Captions show on hover in a grid and not at all in a wheel.** A grid tile
  holds still long enough to read; a caption on a strip moving past at 150px a
  second is not a caption. It is the alt text either way, so a screen reader
  loses nothing.
- **A wheel drifts.** That was the "Movement" row, and a wheel that arrives
  motionless is the one thing nobody asks for.

The names changed with it: `rail` and `column` were this codebase's words. Nobody
looking for the thing that goes round sideways scans a list for "rail".

**Nothing was migrated and nothing was lost from the documents.** Every field is
still in `SectionLayout` and still rendered — `titlePlacementFor`, `driftsFor`,
`title.scale` and `caption.placement` are all read by `GallerySection` exactly as
before. A page that had its title beside its pictures still does, until somebody
picks a shape. Only the controls went.

#### Nothing has a Save button

Every change draws immediately and is written behind it; a quiet `Saved` /
`Saving…` in the panel's corner answers the only question that leaves. Text
commits on blur and on Enter — a write per keystroke is a write per keystroke —
and everything else commits on the change.

That was *almost* true before. The level and ministry forms were the exception:
type, press Save, wait, read an error. They also had a **Cancel**, which in a
panel where every other control is already committed means nothing at all.

The reason they were forms is gone rather than argued away. They were also the
*create* forms, and a create genuinely is a commit — there is no document to write
a field to until you press something. Creating happens in the side menu now, at
every level including a ministry: you type a name and it exists. So what is left
only ever edits.

The one thing that went with the create form was its slug preview — the "Address:
/events/summercamp" it showed under the name, because that becomes the public URL
and is permanent. That now sits under the name field itself, permanently, which is
more use than a preview somebody sees once.

Choices that do not apply are **hidden, not shown and refused** — a grid gets no
Movement row and no "On the pictures" title placement, because `titlePlacementFor`
would ignore it.

Dragging is on the page, not in the panel. In edit mode a `grid` section becomes a
canvas: drag a picture to move it, its corner to resize, arrow keys to nudge,
Shift with them to resize, `Auto` to hand one back to the packer. A press that does
not travel is a click, and a click selects — otherwise pressing a photograph to
ask about it would silently *pin* it.

Reordering is arrows in the menu, not drag. The ministries rail used to support
tile dragging and it is gone: HTML5 drag does not fire for touch at all, so it was
mouse-only, and it fought the rail it was inside — dragging a tile that is drifting
away is not usable, which is why the whole rail had to be frozen while an editor
was open. Two buttons per row work by thumb and by keyboard and need nothing to
hold still. The *pictures* are what wanted dragging; a list of four names did not.

#### Why this shape, and what it replaced

Ten controls scattered down the page and four panels that expanded inline: a
"Ministry tools" box between the photographs and the gatherings, "Arrange this
section" and "Move the pictures" under every subsection, "Edit" and "Cover" on
every gathering card, a "Gallery tools" box, and a picture chooser that pushed a
thousand pixels of page aside when it opened. On `/events`, separately: an Edit
button and two reorder arrows on every tile of a drifting rail, a "+ New ministry"
bar, and a form that opened underneath. Tommy's words were "very confusing and
busy".

Each control was reasonable alone. The problem was structural: **every new thing an
administrator could change added a button next to the thing it changed**, and that
does not converge. Three levels of one tree had grown three different editing
surfaces. A properties column costs a row in a panel instead.

Two details are load-bearing rather than cosmetic:

- **Room is made by padding the page, not by overlaying it.** An overlay would
  cover the right-hand third of the arrangement being judged — including, on a
  full-bleed rail, the part that runs off the edge. The rail's width has to be
  narrowed too, because it measures against the viewport and would otherwise run
  under the panel. That is why `is-editing` goes on `body`: it has to be above
  everything.
- **Selection is a context, not props.** A photograph is four levels down — a
  figure inside a strip inside a rail inside a section — and threading
  `selected`/`onSelect` through all of them would put an editing concern in the
  signature of every component that draws a picture, including on the public page.

#### A page can carry more than one block

**Built:** `GalleryBand` in `schema/sectionLayout.ts`, rendered by `LevelView`.

A level's page has one block of its own, and an administrator can add up to three
more under it: a grid, a sideways rail or an upright column. The controls are three
buttons, each drawn as bars lying down or standing up, because `rail` and `column`
are this codebase's words and nobody else's.

A band once carried a `source` — `beneath` for the whole subtree uncapped, `here`
for only what was filed on this level. Both are gone. What `beneath` was *for* is
now `showAllPictures`, a property of the page, because "show everything from every
day of this camp" was never really a fact about one block — and as a per-block
setting it let one wheel disagree with the grid above it about what the page was
for. Which photographs a block draws is now its own two lists; see
[Each block carries its own pictures](#each-block-carries-its-own-pictures).

The reason a page wants both a capped grid and an uncapped wheel is what the
displays are. Four hundred pictures in a grid is a page nobody reaches the bottom
of; four hundred in a rail is one strip the height of a photograph that turns for
as long as somebody watches. So the cap belongs on the grid and not on the archive.
`tests/unit/galleryTree.test.ts` asserts the pair: the same set gives `nodeSummary`
twenty-four and `subtreeMedia` all seventy-two.

Bands render **straight after the first block**, above the cards. They sat below
them once, on the reasoning that a band was the archive and the cards were the way
to one particular day — which stopped being true when the blocks became a set of
ways to look at one level's photographs. A grid and a wheel are two halves of one
thing to look at, and putting the navigation between them separates them for no
reason.

An empty `title` draws no heading at all, which is the ordinary case. The page's
own first block has none either: it was a hardcoded "Photographs" over every
gallery in the parish, removed at Tommy's direction, and it was the only heading on
the site that named the medium rather than the thing — the page is already titled
"Day 2" and everything under it is photographs of Day 2. The section keeps an
accessible name from `label`, because "region" with no name is what a screen reader
announces otherwise.

The write path is a read-modify-write on one `bands` array, which is the shape the
tree deliberately removed for `groups`. Worth saying why it is fine here: groups
were the *structure* — every photograph pointed into that array and a lost write
unfiled a day of a camp. A band is one block's styling on one page. Nothing points
at it, a lost write is a wheel somebody re-adds, and removing one destroys
nothing, which is why it is the only destructive-looking control here with no
confirmation.

#### Dragging a photograph

The tile **follows the pointer**, and a dashed marker shows the cell it will land
in.

It did not, and the reason it looked broken rather than coarse is worth recording.
A drag is measured in pixels and stored in grid cells (§3), and the old version
applied the *snapped* placement to the tile on every pointer move — so a picture
did not track the hand at all. It sat still until the pointer crossed half a cell
and then teleported a whole one. On a section whose rows are 260px tall that is a
photograph jumping 260px under a hand moving smoothly.

So the box now stays in the cell it started in and is `translate3d`-ed by the raw
delta, which is a compositor transform rather than a re-layout of the grid on
every move. The snapping is unchanged — it still stores a column and a row, for
all the reasons §3 gives — it simply stopped being the thing the eye follows.

That trade needs the marker to be honest: once the picture is no longer sitting in
the cell it is bound for, a smooth drag is *less* informative than the jumpy one
unless something says where it is going. Nobody eyeballs a twelve-column grid to
the column. The marker is a hole in the grid rather than a translucent copy of the
photograph — it is the shape of the space about to be taken, and a second copy of
the same picture floating under the first is what reads as a rendering fault.

The lift is three things together, because any one alone reads as a glitch: the
tile is above its neighbours, it casts a shadow onto them, and it is 1.5% larger
than the space it came from. `grid-column` has no interpolated form, so a drop is
always an instant reposition; what eases is the lift coming off, over 160ms, which
is what turns the snap into a placement.

#### Three things the schema had and the editor did not

Each of these was a field the site *read* everywhere and nothing anywhere wrote,
which is a specific and quiet kind of broken: the feature looks implemented, the
default looks like a choice, and nobody reports it.

**What must stay in frame** — `GalleryMedia.focal`. In the schema since it was
written, with a note saying exactly what it is for: *"what must survive a crop, as
a fraction of width and height. Square thumbnails of a group photograph cut off
faces without it."* Honoured by the grid, the card covers, the picker tiles and
the presentation, all through `focalPosition`. The only writer was `submit.ts`,
putting the literal centre on every upload — so every photograph in the parish was
`{ x: 0.5, y: 0.5 }`, every crop was centred, and the one case the field was added
for was exactly the case that came out wrong.

Set by clicking the photograph (`FocalPicker.tsx`), with a square crop of it
beside the whole frame. Two fractions have no arrangement of number boxes that
means a face; pressing the face is the whole interaction. Arrow keys nudge, Shift
with them moves further.

**Dates** — `startAt` / `endAt`. Absent from the editor entirely, and the note
saying why was honest about the cost: *"the form does not read the existing dates
back into its state … so writing the form's `null` would silently erase a date
somebody set."* Which meant nothing on the site could set a date, on a collection
that **sorts by date** and prints one on every card. A week created in the editor
was undated for ever.

Both halves turn out to be one line each. Reading is `dayKey`, already written for
the calendar and already correct about the parish's civil date. Writing is **noon
UTC** — `new Date('2026-07-22')` parses as midnight UTC, which in the parish's
zone is eight in the evening on the 21st, so the obvious version stores the day
before the one that was typed.

**Its place in the block** — `reorderMedia` had **no caller at all**; this
document listed reordering under "still to come". It is the only way to arrange a
`rail` or a `column`, whose layout is an *order* rather than a position, so those
two displays were unarrangeable beyond their overall style. Two buttons on the
selected photograph, scoped to the block it is drawn in — because the same picture
sits at a different position in its own level's gallery and in its parent's
summary, and "earlier" has to mean earlier *on screen*.

#### Levels, in the side menu

Add, rename, reorder, remove, and **move**, at every depth, with no cap. The list
in the properties column is the children of the page being looked at; adding one
means "inside this", because somebody standing on Week 1 pressing *Add a part*
means inside Week 1 and a select asking them to confirm that would be a puzzle.

Five behaviours worth knowing:

- **A new level is a draft, and open for submissions.** It is made in order to
  collect photographs of it, and it should not be public before it has any.
- **`order` is what makes "Day 1, Day 2, Day 3" come out in that order.** It is
  written on creation as last + 10, and rewritten 10/20/30… whenever one is moved.
  A level nobody has reordered has 0 and falls back to its date, newest first —
  exactly what this collection did before the field existed. Both orderings are
  right at different levels, which is why `compareNodes` reads two fields: weeks
  and years want their dates; days want the sequence somebody typed, and "Day 2
  after Day 1 and before Day 10" is neither a date nor an alphabet.
- **Moving a level is its own control**, in the level's own properties. It is the
  one operation the fixed three levels made impossible: somebody who added "Day 1"
  to the ministry instead of to the week had no way out but to delete it and lose
  its photographs' filing. The list it offers excludes the level itself and its own
  descendants — a level inside itself is a cycle, and while every walk in
  `tree.ts` is depth-guarded against one, the guard is there so a cycle is a
  mis-drawn page rather than a hung tab, not so that one may be created.
- **Removing a level refuses while anything is inside it.** Exactly as deleting a
  program refuses while it still has levels, and for the same reason: a
  client-side cascade is a loop of deletes that can stop halfway, and the half that
  survives is a set of days pointing at a week that no longer exists.
- **Removing a level keeps its photographs.** They are `galleryMedia` documents
  with public files behind them, and deleting a level must not quietly destroy the
  parish's only copy of a camp. They are orphaned, which is recoverable; deleted is
  not.

Re-filing a photograph writes `programEventId` — one field, any depth — where it
used to write a `groupId` beside an unchanged one, which could only ever move a
picture within a single gathering. The control offers this level and everything
under it, and not the whole ministry: moving a picture to a level the current page
does not show is a change nobody can see the result of.

Note what that means for an **event-scoped** grant. The rules check the level the
photograph is on *before* the write, so a volunteer given one week can move a
photograph out of it and cannot move it back. That is the right way round of the
two — checking the destination instead would let a grant on one day pull the whole
ministry's photographs into it — and program-scoped grants, which is what these
volunteers normally hold, are unaffected.

### Still to come

Dragging a photograph from one section onto another, or onto a level's card, would
be the natural gesture for re-filing; today that is a dropdown in the properties
column instead. Same for reordering within a rail, which is two buttons.

Nothing paginates. Every read here is one query and the wide-subtree fallback is a
300-item window, which is several years of camps and will one day not be.

The captions are the largest remaining gap and they are not a code one: a
photograph with no caption is one a screen reader announces as nothing at all, and
the field is the alt text as well as the visible line. The editor now opens on it
for every photograph selected, which is as far as software can push it.
