# Page content

The prose pages of the website — About, Our Faith, clergy bios, Welcome — live
here as markdown and are pushed into the Firestore `content` collection by
`scripts/seed-content.mjs`.

```bash
node scripts/seed-content.mjs            # dry run: shows every change
node scripts/seed-content.mjs --write    # apply
```

**The repo is authoritative for these pages**, which is the opposite of
`config/parish` and `config/integrations`. Those hold facts about a real parish
that staff edit in the Firebase console, and `seed-config.mjs` refuses to
overwrite them. These are prose: they belong in git, get reviewed in a PR, and
have a history. So this script overwrites — after showing you what changes.

Editing a page here does not change the website until the next build. Content
changes about twice a year, so a PR workflow fits; the pages that change often
(the weekly bulletin, service times, the livestream target) are deliberately
not in this collection.

## Layout

```
content/<section>/<order>-<slug>.md
content/about/10-who-we-are.md      → section 'about', order 10, document id 'who-we-are'
```

- **Section is the directory**, and must be one of `about`, `beliefs`, `clergy`,
  `contact`, `misc`. The script rejects anything else, and that check is most of
  the reason it exists: the site queries `where('section','==',…)`, so a typo
  doesn't error — the page silently renders nowhere and nothing says why.
- **Order** drives position within the section.
- **Slug** is the document id, so re-running updates in place rather than piling
  up duplicates. It's also the URL, so keep it lowercase and hyphenated.

## Front matter

`key: value` lines between `---` fences. Dotted keys nest. No YAML parser is
involved — this is a flat list of strings and doesn't need one.

```markdown
---
title: Who We Are
published: true
seo.description: A Coptic Orthodox parish in Wayland, Massachusetts.
---

Real markdown body. Headings, lists, links all work.
```

| Key | Required | Notes |
|---|---|---|
| `title` | yes | Page heading |
| `published` | no | **Defaults to `false`.** A file existing in the repo is not the parish approving it for the website |
| `seo.description` | no | Meta description |
| `seo.ogImagePath` | no | Storage path, not a URL |
| `person.name` | clergy only | Full name including title, exactly as the parish writes it |
| `person.rank` | clergy only | "Bishop", "Priest", "Deacon" |
| `person.email` | no | |
| `person.portraitPath` | no | Storage path — uploads aren't built yet |

`true`, `false`, whole numbers, and `null` are read as themselves. Everything
else stays a string, so a title of `2024` doesn't silently become a number.

`publishAt` is not settable here and is always written as `null`. It's an
instruction to a scheduled Function that doesn't exist yet, so a future
`publishAt` on a published document is an inconsistent state — see
[decision #10](../docs/decisions.md).

## A note on the parish's name

Use the full **St. Philopater Mercurius & St. Mina** in anything a parishioner
reads. The acronym reads plausibly as several other saint pairings. St.
Philopater Mercurius is also known as Abu Sefein, and the same saint may appear
under either name in parish content — that's fine, just be consistent within a
page.
