/**
 * Read `content/<section>/<order>-<slug>.md` into ContentPage-shaped documents.
 *
 * Split out of seed-content.mjs so the emulator seeder reads exactly the same
 * files by exactly the same rules. Two parsers for one file format is how the
 * local site and the real one start disagreeing about what a page looks like.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { CONTENT_SECTIONS } from '../../packages/shared/dist/index.js';

const ROOT = 'content';

function splitFrontMatter(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(`${file}: no front matter. Expected a --- fenced block at the top.`);
  }
  return { frontMatter: match[1], body: match[2].trim() };
}

/**
 * `key: value` lines into a nested object, splitting dotted keys.
 *
 * Values are strings except for the three shapes that have to survive the trip
 * as themselves: `true`/`false`, integers, and the literal `null`. Everything
 * else stays a string, deliberately — guessing types out of prose is how a
 * title of "2024" becomes a number.
 */
function parseFrontMatter(text, file) {
  const out = {};

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const at = line.indexOf(':');
    if (at === -1) {
      throw new Error(`${file}:${index + 1}: expected "key: value", got: ${line}`);
    }

    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();

    let value = raw;
    if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
    else if (raw === 'null' || raw === '') value = null;
    else if (/^-?\d+$/.test(raw)) value = Number(raw);

    // Dotted keys nest: `seo.description` -> { seo: { description } }.
    const path = key.split('.');
    let cursor = out;
    for (const segment of path.slice(0, -1)) {
      cursor[segment] ??= {};
      cursor = cursor[segment];
    }
    cursor[path.at(-1)] = value;
  }

  return out;
}

/** `10-who-we-are.md` -> { order: 10, slug: 'who-we-are' }. */
function parseFilename(file) {
  const name = basename(file, '.md');
  const match = /^(\d+)-(.+)$/.exec(name);
  if (!match) {
    throw new Error(
      `${file}: filename must be <order>-<slug>.md, e.g. 10-who-we-are.md. ` +
        `Order drives nav position; slug becomes the document id and the URL.`,
    );
  }
  return { order: Number(match[1]), slug: match[2] };
}

/** Every markdown file under content/, as a ContentPage-shaped document. */
export function collectPages() {
  let sections;
  try {
    sections = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory());
  } catch {
    console.error(`No ${ROOT}/ directory. See ${ROOT}/README.md for the layout.`);
    process.exit(1);
  }

  const pages = [];

  for (const section of sections) {
    if (!CONTENT_SECTIONS.includes(section)) {
      throw new Error(
        `${ROOT}/${section}/ is not a known section. Expected one of: ` +
          `${CONTENT_SECTIONS.join(', ')}. A section the site does not query for ` +
          `renders nowhere, and nothing reports it.`,
      );
    }

    const files = readdirSync(join(ROOT, section)).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const path = join(ROOT, section, file);
      const { order, slug } = parseFilename(file);
      const { frontMatter, body } = splitFrontMatter(readFileSync(path, 'utf8'), path);
      const meta = parseFrontMatter(frontMatter, path);

      if (!meta.title) throw new Error(`${path}: front matter needs a "title".`);
      if (!body) throw new Error(`${path}: the body is empty.`);

      pages.push({
        path,
        slug,
        document: {
          slug,
          title: String(meta.title),
          body,
          order,
          section,

          // `published` defaults to false: a file existing in the repo is not
          // the same as the parish having approved it for the website.
          published: meta.published === true,

          // Always null. `publishAt` is an instruction to a scheduled Function
          // that does not exist yet, and a future publishAt on a published
          // document is an inconsistent state that `withoutEmbargoed` reports
          // at build time. See docs/decisions.md #10.
          publishAt: null,

          person: meta.person
            ? {
                name: String(meta.person.name ?? ''),
                rank: String(meta.person.rank ?? ''),
                portraitPath: meta.person.portraitPath ?? null,
                email: meta.person.email ?? null,
              }
            : null,

          seo: {
            description: meta.seo?.description ?? null,
            ogImagePath: meta.seo?.ogImagePath ?? null,
          },

          updatedAt: new Date(),
          updatedBy: null,
        },
      });
    }
  }

  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}
