'use client';

import Markdown from 'react-markdown';
import type { AboutGround, AboutSection } from '@spsm/shared';
import { DefinitionSpine } from '@/components/DefinitionSpine';
import { SectionHeading } from '@/components/SectionHeading';
import { useEditMode } from '@/features/programs/editMode';
import { useAboutOverlay } from './context';

/**
 * The bands staff added, at the foot of an About page.
 *
 * ---------------------------------------------------------------------------
 * ## At the foot, and not spliced between the coded bands
 *
 * This was the one real choice in the block half of the feature. Inserting a
 * staff band *between* two hand-written ones means either splicing into five
 * hand-written JSX trees — an insertion point after every band on every page,
 * for a case nobody has asked for yet — or breaking each screen into an array
 * of bands, which is exactly the rewrite into a generic block model that the
 * overlay was chosen instead of.
 *
 * So: appended, in an order staff control. Every coded page already ends on the
 * thing it wants to end on and then hands over to `MoreOfAbout`, and a new band
 * between those two is a perfectly ordinary place for one.
 *
 * ## Three kinds
 *
 * Prose, prose with a photograph beside it, and a list of terms. Between them
 * they cover every band on the five coded pages that is not a bespoke widget,
 * which is the test that decided the vocabulary. See `schema/about.ts` and the
 * long argument in `schema/sectionLayout.ts` about why this is a short list of
 * names rather than a canvas.
 *
 * ## Grounds
 *
 * Each section names its own, defaulting to `plain`. Not alternated
 * automatically here, and that is a change of mind worth recording: the coded
 * pages alternate with a computed counter, but this list starts after a band
 * whose ground this component does not know, so a counter starting at zero
 * would put two `plain` bands together as often as not. Naming it is one
 * dropdown and it is always right.
 * ---------------------------------------------------------------------------
 */

function groundClass(ground: AboutGround): string {
  switch (ground) {
    case 'sunken':
      return 'band band--sunken';
    case 'tinted':
      return 'band band--tinted';
    case 'deep':
      return 'band band--deep';
    case 'plain':
      return 'band';
  }
}

export function AboutSections({ baked }: { baked: readonly AboutSection[] }) {
  const { current } = useAboutOverlay();
  /*
   * The live list replaces the baked one whole rather than merging: a section
   * staff deleted has to disappear, and there is no id-wise merge that both
   * drops a deletion and survives a failed fetch. `current` is null until
   * something fresher exists, which is what makes the baked list the default
   * and a failed refresh a no-op.
   */
  const sections = current?.sections ?? baked;
  if (sections.length === 0) return null;

  return (
    <>
      {sections.map((section) => (
        <AboutBandSection key={section.id} section={section} />
      ))}
    </>
  );
}

function AboutBandSection({ section }: { section: AboutSection }) {
  // `aria-labelledby` on every band, like the coded ones — an unlabelled
  // `<section>` is invisible to landmark navigation.
  const headingId = `${section.id}-heading`;
  const { ops } = useAboutOverlay();
  const { select, isSelected } = useEditMode();
  const selected = isSelected({ kind: 'level', id: section.id });

  /*
   * Clickable while editing, exactly like a coded band — otherwise the sections
   * staff added would be the one part of the page they could not reach by
   * pointing at it, and they are the part most likely to be wrong.
   *
   * `kind: 'level'` rather than `'section'`: a coded band is identified by a key
   * from the manifest and one of these by its own id, and conflating them would
   * mean a staff section whose id happened to match a band id opened the wrong
   * fields. See `AboutPanel`.
   */
  const editing = ops
    ? {
        className: `wrap about-sec ab-target${selected ? ' is-selected' : ''}`,
        role: 'button',
        tabIndex: 0,
        'aria-pressed': selected,
        onClick: (event: { target: EventTarget | null }) => {
          if (event.target instanceof Element && event.target.closest('a, button')) return;
          select({ kind: 'level', id: section.id });
        },
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          select({ kind: 'level', id: section.id });
        },
      }
    : { className: 'wrap about-sec' };

  return (
    <section className={groundClass(section.ground)} aria-labelledby={headingId}>
      <div {...editing}>
        <SectionHeading
          id={headingId}
          eyebrow={section.eyebrow || undefined}
          /* A section being written has no name yet, and an empty `h2` is an
             unlabelled landmark. Placeholder text only while editing. */
          title={section.heading || (ops ? 'Untitled section' : '')}
        />
        <AboutBandBody section={section} />
      </div>
    </section>
  );
}

function AboutBandBody({ section }: { section: AboutSection }) {
  if (section.kind === 'list') {
    return <DefinitionSpine rows={section.items} />;
  }

  if (section.kind === 'picture') {
    return (
      <div
        className={`about-sec__split${
          section.side === 'left' ? ' about-sec__split--flipped' : ''
        }`}
      >
        <div className="about-sec__words prose">
          <Markdown>{section.body}</Markdown>
        </div>
        <figure className="about-plate about-sec__plate">
          <img
            className="about-plate__img"
            src={section.image.src}
            alt={section.image.alt ?? ''}
            {...(section.image.width ? { width: section.image.width } : {})}
            {...(section.image.height ? { height: section.image.height } : {})}
            loading="lazy"
            decoding="async"
          />
          {section.image.caption && (
            <figcaption className="about-plate__caption">{section.image.caption}</figcaption>
          )}
        </figure>
      </div>
    );
  }

  return (
    <div className="about-sec__words prose">
      <Markdown>{section.body}</Markdown>
    </div>
  );
}
