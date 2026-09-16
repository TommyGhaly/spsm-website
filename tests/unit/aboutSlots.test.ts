import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABOUT_BANDS } from '../../apps/website/src/features/about/slots';
import { ABOUT_SLUGS } from '../../packages/shared/dist/schema/about.js';

/**
 * The manifest and the pages have to agree, exactly.
 *
 * ---------------------------------------------------------------------------
 * Two ways for this feature to be quietly broken, and neither shows up in a
 * typecheck or in a screenshot:
 *
 *  - **A slot wired into a page with no row in the manifest.** The band renders
 *    a dotted outline and takes the click, and the column then lists everything
 *    *except* the thing that was clicked. The words look editable and are not.
 *  - **A row in the manifest with nothing wired into a page.** The column offers
 *    a box that saves happily and changes nothing on the page — which is the
 *    exact failure the five deleted `/access` rows were deleted for.
 *
 * `slots.ts` says so in prose: *"a row with no wrap is a control that saves and
 * changes nothing on the page."* This is that sentence, enforced.
 *
 * It reads the five screens as text rather than rendering them. Crude, and
 * right: what it is checking is that two hand-maintained lists match, so the
 * cheapest thing that can compare them is the correct tool.
 * ---------------------------------------------------------------------------
 */

/**
 * Where each page's slots are actually written.
 *
 * The screen **and** the parts it renders. Most of the words on these pages are
 * not in the screen file at all — the dated spines, the feast days, the area
 * schedule, the clergy roster and every figure caption are rendered by a
 * `parts.tsx`, and a test that read only the screen reported fifty perfectly
 * good slots as dead. `DefinitionSpine` is shared by two pages, so it is listed
 * under both.
 */
const SOURCES: Record<string, readonly string[]> = {
  'who-we-are': [
    'apps/website/src/features/who/WhoScreen.tsx',
    'apps/website/src/features/who/parts.tsx',
    'apps/website/src/components/DefinitionSpine.tsx',
  ],
  'our-belief': [
    'apps/website/src/features/belief/BeliefScreen.tsx',
    'apps/website/src/features/belief/parts.tsx',
  ],
  'patron-saints': [
    'apps/website/src/app/about/patron-saints/page.tsx',
    'apps/website/src/features/saints/parts.tsx',
  ],
  'welcome-newcomers': ['apps/website/src/features/tour/TourScreen.tsx'],
  'future-plans': [
    'apps/website/src/features/future/FutureScreen.tsx',
    'apps/website/src/features/future/parts.tsx',
  ],
  // Not an About page, and edited by the same overlay on the same flag. The
  // whole page is in its route file — no screen, no `parts.tsx` — which is why
  // this row is one path where the others are two or three.
  privacy: ['apps/website/src/app/privacy/page.tsx'],
};

const root = fileURLToPath(new URL('../../', import.meta.url));

function sourceFor(page: string): string {
  return (SOURCES[page] ?? []).map((path) => readFileSync(root + path, 'utf8')).join('\n');
}

/**
 * Every slot id a page actually wires up.
 *
 * `slot="…"` is an `Editable` or an `EditablePicture`; `captionSlot="…"` is a
 * plate's caption. The tour's stations are templated —
 * `slot={`${station.id}.h2`}` — so those are matched separately below.
 */
function wiredIn(source: string): Set<string> {
  const ids = new Set<string>();
  for (const m of source.matchAll(/(?:caption)?[sS]lot="([a-z0-9.-]+)"/g)) ids.add(m[1] as string);
  /*
   * `EditableHeading` takes a `band` and derives `<band>.eyebrow`, `<band>.h2`
   * and `<band>.note` itself — one prop instead of three, because it renders
   * `SectionHeading`, which owns all three lines and their document outline.
   *
   * Which of the three it actually renders depends on which props it was given,
   * so the element's own attributes are read rather than assuming all three. It
   * matters in both directions: `both-heading` has no third line, and three
   * saints bands have an eyebrow that went undeclared until this test looked.
   */
  for (const m of source.matchAll(/<EditableHeading\b([\s\S]*?)\/>/g)) {
    const props = m[1] as string;
    const band = /band="([a-z0-9-]+)"/.exec(props)?.[1];
    if (!band) continue;
    ids.add(`${band}.h2`);
    if (/\beyebrow=/.test(props)) ids.add(`${band}.eyebrow`);
    if (/\bnote=/.test(props)) ids.add(`${band}.note`);
  }
  return ids;
}

/**
 * Slots whose id is built at render time, as regexes that match what they build.
 *
 * Two shapes, and both are load-bearing rather than incidental: the tour's six
 * stations share one `Editable` per part (`${station.id}.h2`), and every
 * data-driven table — the dated spines, the Creed's stanzas, the feasts, the
 * area schedule — wires one slot per row (`in-egypt.moment-${index}-when`).
 * Neither can be a literal, and both have to be checked against the manifest or
 * the whole point of this file is lost.
 *
 * `${…}` becomes a wildcard. Loose on purpose: this is checking that a declared
 * slot has *something* rendering it, and a template that is close but wrong will
 * be caught by the reverse direction — the page's own literal ids are compared
 * against the manifest too.
 */
function templatesIn(source: string): RegExp[] {
  const out: RegExp[] = [];
  for (const m of source.matchAll(/(?:caption)?[sS]lot=\{`([^`]+)`\}/g)) {
    const shape = (m[1] as string)
      // Escape the literal parts, then punch a wildcard through each hole.
      .split(/\$\{[^}]*\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      // A dot is in the class because a hole is often filled by a slot
      // *prefix* — `slotPrefix="in-egypt.moment"` — and not just by an index.
      .join('[A-Za-z0-9_.-]+');
    out.push(new RegExp(`^${shape}$`));
  }
  return out;
}

describe('every declared slot is wired into its page', () => {
  for (const page of ABOUT_SLUGS) {
    it(page, () => {
      const source = sourceFor(page);
      const wired = wiredIn(source);
      const templates = templatesIn(source);

      const dead = ABOUT_BANDS[page]
        .flatMap((band) => band.slots.map((slot) => slot.id))
        .filter((id) => !wired.has(id) && !templates.some((shape) => shape.test(id)));

      expect(dead, `declared but nothing on the page uses them: ${dead.join(', ')}`).toEqual([]);
    });
  }
});

describe('every wired slot is declared in the manifest', () => {
  for (const page of ABOUT_SLUGS) {
    it(page, () => {
      const declared = new Set(
        ABOUT_BANDS[page].flatMap((band) => band.slots.map((slot) => slot.id)),
      );
      const undeclared = [...wiredIn(sourceFor(page))].filter((id) => !declared.has(id));

      expect(
        undeclared,
        `on the page but the column will not offer them: ${undeclared.join(', ')}`,
      ).toEqual([]);
    });
  }
});

describe('every slot prefix has rows behind it', () => {
  /*
   * The hole the two directions above leave, and it cost a real bug.
   *
   * A component that takes a `slotPrefix` and builds its own ids —
   * `DefinitionSpine`, `FeastList` — is wired by one literal prop on the page
   * and matched by a wildcard template in the component. So if the *manifest*
   * never declares any of those rows, "declared but unused" finds nothing to
   * complain about (they are not declared) and "wired but undeclared" finds
   * nothing either (the ids are not literals anywhere). The nineteen-century
   * spine and the clergy roster were generated, exported, and attached to no
   * band at all — a hundred-odd rows that rendered a dotted outline and opened
   * a column listing none of them.
   *
   * So: every `slotPrefix="X"` on a page must have at least one declared id
   * beginning `X-`.
   */
  for (const page of ABOUT_SLUGS) {
    it(page, () => {
      const declared = ABOUT_BANDS[page].flatMap((band) =>
        band.slots.map((slot) => slot.id),
      );
      const source = sourceFor(page);
      const empty = [...source.matchAll(/slotPrefix="([a-z0-9.-]+)"/g)]
        .map((m) => m[1] as string)
        .filter((prefix) => !declared.some((id) => id.startsWith(`${prefix}-`)));

      expect(
        empty,
        `these prefixes render rows the column will not offer: ${empty.join(', ')}`,
      ).toEqual([]);
    });
  }
});

describe('the band ids line up with the slot keys', () => {
  it('every slot key starts with its own band id', () => {
    /*
     * `EditableTarget` derives the band from `slot.split('.')[0]`, so a slot
     * filed under the wrong band would select a band that does not contain it —
     * the column would open on the wrong part of the page.
     */
    const wrong: string[] = [];
    for (const page of ABOUT_SLUGS) {
      for (const band of ABOUT_BANDS[page]) {
        for (const slot of band.slots) {
          if (!slot.id.startsWith(`${band.id}.`)) wrong.push(`${page}: ${slot.id} in ${band.id}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('no slot id is declared twice', () => {
    for (const page of ABOUT_SLUGS) {
      const ids = ABOUT_BANDS[page].flatMap((band) => band.slots.map((slot) => slot.id));
      expect(new Set(ids).size, `${page} has a duplicate slot`).toBe(ids.length);
    }
  });
});
