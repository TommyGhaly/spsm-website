'use client';

import { useEffect, useState } from 'react';
import {
  ABOUT_GROUNDS,
  ABOUT_SECTION_LIMIT,
  hasPicture,
  type AboutGround,
  type AboutImage,
  type AboutSection,
  type AboutSlug,
} from '@spsm/shared';
import { PicturePicker } from '@/features/forms/admin/PicturePicker';
import { useEditMode, type Selection } from '@/features/programs/editMode';
import { ABOUT_PICTURE_CHOICES, pictureFor } from './choices';
import { codedTextOf } from './codedText';
import { RichField } from './RichField';
import { ABOUT_BANDS, type AboutBand, type AboutSlotSpec } from './slots';
import { uploadAboutPicture } from './uploads';
import type { AboutCopy, AboutSlotOps } from './context';
import type { AboutDraft } from './useAboutDraft';

/**
 * What the editing column shows, which is whatever has been clicked.
 *
 * ---------------------------------------------------------------------------
 * ## The column, kept thin
 *
 * The fields were inline once: every rewritable band grew a textarea the moment
 * Edit was pressed. Twenty of them on a fifteen-band page, which roughly
 * doubled its height and made the page unreadable while it was being judged.
 *
 * Tommy asked for the arrangement the rest of the site uses — *"move the editing
 * to the side like the other edit featured pages and force a click to edit a
 * specific section"* — then, after seeing it, *"only edit the text where it is
 * its not that many customizations lets keep it simple for the about pages"*,
 * and then settled it: *"no keep the side column"*.
 *
 * Both halves of that are honoured, and the resolution is what the column
 * *contains* rather than whether it exists. It is the same column the galleries
 * and the shop use, and what it holds for an About page is **the words and the
 * photograph, and nothing else** — no layout, no scale, no width, none of the
 * settings a gallery genuinely needs. A page of prose has one kind of thing to
 * change.
 *
 * The argument for the column at all is already written down in
 * `features/programs/editMode`: **every new thing an administrator could change
 * added a control next to the thing it changed, and that does not converge.**
 *
 * ## Selection is per *band*, not per slot
 *
 * A band is what a reader sees as one thing — a heading, its paragraphs and its
 * photograph — and it is the unit the coded pages are built out of. Clicking any
 * part of one selects the whole band and the column lists everything in it, so
 * the answer to "where do I change this?" is always "click it" and never "click
 * the exact paragraph".
 *
 * `ABOUT_BANDS` is what makes that possible: slot keys are `<band>.<part>`, so
 * the band is derivable from the slot and the column can list a band's parts
 * without anything on the page telling it.
 *
 * ## Three things can be selected
 *
 *   `page`     the page itself — the list of sections staff have added.
 *   `section`  one coded band, keyed by its id. Its words and its photograph.
 *   `level`    one appended section, keyed by its id. All of its fields.
 *
 * Those are `editMode`'s own kinds, reused rather than widened. See the note in
 * `EditColumn` about why selection is deliberately not shared between features.
 * ---------------------------------------------------------------------------
 */

/** What the column's header calls the current selection. */
export function bandTitle(
  page: AboutSlug,
  selection: Selection,
): { kind: string; title: string } {
  if (selection.kind === 'section') {
    const band = ABOUT_BANDS[page].find((row) => row.id === selection.key);
    return { kind: 'Part of the page', title: band?.label ?? 'This part' };
  }
  if (selection.kind === 'level') return { kind: 'Section you added', title: 'This section' };
  return { kind: 'About page', title: 'The whole page' };
}

export function AboutPanel({
  page,
  draft,
  editor,
}: {
  page: AboutSlug;
  draft: AboutCopy;
  editor: AboutDraft;
}) {
  const { selection } = useEditMode();
  const ops = editor.ops;
  if (!ops) return null;

  if (selection.kind === 'section') {
    const band = ABOUT_BANDS[page].find((row) => row.id === selection.key);
    if (!band) return <NotOurs />;
    return <BandFields page={page} band={band} draft={draft} ops={ops} />;
  }

  if (selection.kind === 'level') {
    const section = draft.sections.find((row) => row.id === selection.id);
    if (!section) return <NotOurs />;
    return <SectionFields page={page} section={section} editor={editor} />;
  }

  return <PageFields draft={draft} editor={editor} />;
}

function NotOurs() {
  return (
    <p className="inspector__hint">
      That part of the page is not one this editor can change. Click a heading or a paragraph.
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* One coded band                                                             */
/* -------------------------------------------------------------------------- */

function BandFields({
  page,
  band,
  draft,
  ops,
}: {
  page: AboutSlug;
  band: AboutBand;
  draft: AboutCopy;
  ops: AboutSlotOps;
}) {
  return (
    <>
      {band.slots.map((spec) => (
        <SlotField key={spec.id} page={page} spec={spec} draft={draft} ops={ops} />
      ))}

      {/*
        Said once per band, at the foot, rather than under every field. The
        reassurance is what makes the boxes safe to experiment in, and it is the
        same sentence for all of them.
      */}
      <p className="inspector__hint">
        Emptying a box puts the words that were written into the page back. Nothing here can be
        lost — ⌘Z undoes anything.
      </p>
    </>
  );
}

/**
 * What to say under a one-line box, keyed by the slot's last segment.
 *
 * Short, and about the *shape* of the answer rather than about markdown — these
 * are the fields with no formatting buttons, because a heading with emphasis in
 * it is a heading somebody will regret.
 */
const HINTS: Record<string, string> = {
  h2: 'A heading. Keep it short.',
  title: 'The page’s own title, in the opening band.',
  eyebrow: 'Two or three words, set small in gold above the heading.',
  note: 'One line under the heading, in a quieter voice.',
};

function SlotField({
  page,
  spec,
  draft,
  ops,
}: {
  page: AboutSlug;
  spec: AboutSlotSpec;
  draft: AboutCopy;
  ops: AboutSlotOps;
}) {
  const override = draft.slots[spec.id];
  const coded = useCodedText(spec.id);

  if (spec.kind === 'picture') {
    return <PictureField page={page} spec={spec} override={override} ops={ops} />;
  }

  /*
   * The value comes from the draft, never from local state.
   *
   * That matters for undo: ⌘Z moves the draft, and a field holding its own copy
   * of the text would ignore it and then overwrite it on the next keystroke.
   *
   * The "cleared box stays cleared" problem it used to solve is answered in the
   * draft instead. A slot with **no `text` key** has never been touched and
   * shows the coded words; a slot whose `text` is the empty string has been
   * deliberately cleared and shows an empty box. `hasCopy` reads both as "no
   * override", so the page shows the hand-written words either way.
   */
  const written = typeof override?.text === 'string';
  const shown = written ? (override?.text ?? '') : coded;

  return (
    <div className="ab-field">
      {spec.kind === 'heading' ? (
        <label className="field">
          <span>{spec.label}</span>
          <input value={shown} onChange={(event) => ops.setText(spec.id, event.target.value)} />
          {/*
            One line, and it has to describe *this* field. It said "A heading.
            Keep it short." under every one of them — including the eyebrow and
            the line under a heading, neither of which is a heading. A note that
            is wrong about the box it is under is worse than no note.
          */}
          <small>{HINTS[spec.id.split('.')[1] ?? ''] ?? 'One short line.'}</small>
        </label>
      ) : (
        <RichField
          label={spec.label}
          value={shown}
          rows={7}
          onChange={(next) => ops.setText(spec.id, next)}
        />
      )}

      {/* Only once there is something to put back. */}
      {written && (
        <button type="button" className="ab-slot__act" onClick={() => ops.revert(spec.id)}>
          Put the original back
        </button>
      )}
    </div>
  );
}

/**
 * The coded words for a slot, once the page has rendered its hidden mirror.
 *
 * In an effect rather than during render, because it is a DOM read and the
 * mirror belongs to a different component's output. Everything about *what* is
 * read, and the paragraph-break bug that shaped it, is in `codedText.ts`.
 */
function useCodedText(slot: string): string {
  const [coded, setCoded] = useState('');

  useEffect(() => {
    setCoded(codedTextOf(slot));
  }, [slot]);

  return coded;
}

function PictureField({
  page,
  spec,
  override,
  ops,
}: {
  page: AboutSlug;
  spec: AboutSlotSpec;
  override: AboutCopy['slots'][string] | undefined;
  ops: AboutSlotOps;
}) {
  const chosen = hasPicture(override) ? (override?.image as AboutImage) : null;

  return (
    <div className="ab-field">
      <PicturePicker
        value={chosen?.src ?? null}
        label={spec.label}
        note="Everything the site already ships is in this list, with the words written for it. Upload only for a photograph the site has not got."
        choices={ABOUT_PICTURE_CHOICES}
        upload={(file) => uploadAboutPicture(page, file)}
        onChange={(src) => {
          if (src === null) {
            ops.setImage(spec.id, null);
            return;
          }
          // A library picture brings its own alt text and caption. An upload
          // matches nothing in the list and gets whatever staff type below.
          const known = pictureFor(src);
          const image: AboutImage = { src };
          if (known?.alt) image.alt = known.alt;
          if (known?.caption) image.caption = known.caption;
          if (known?.width) image.width = known.width;
          if (known?.height) image.height = known.height;
          ops.setImage(spec.id, image);
        }}
      />

      {chosen && (
        <>
          <label className="field">
            <span>What is in the photograph</span>
            <textarea
              rows={2}
              value={chosen.alt ?? ''}
              onChange={(event) => ops.setImage(spec.id, { ...chosen, alt: event.target.value })}
            />
            <small>
              Read aloud instead of the picture to somebody who cannot see it. Describe it, do not
              caption it.
            </small>
          </label>
          <label className="field">
            <span>Caption</span>
            <textarea
              rows={2}
              value={chosen.caption ?? ''}
              onChange={(event) =>
                ops.setImage(spec.id, { ...chosen, caption: event.target.value })
              }
            />
          </label>
          <button type="button" className="ab-slot__act" onClick={() => ops.revert(spec.id)}>
            Use the photograph that was in the page
          </button>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The page: the list of appended sections                                    */
/* -------------------------------------------------------------------------- */

function blankSection(kind: AboutSection['kind'], order: number): AboutSection {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = { id, order, ground: 'plain' as AboutGround, heading: '' };
  if (kind === 'list') return { ...base, kind: 'list', items: [{ term: '', detail: '' }] };
  if (kind === 'picture') {
    return { ...base, kind: 'picture', body: '', image: { src: '' }, side: 'right' };
  }
  return { ...base, kind: 'prose', body: '' };
}

const KIND_LABELS: Record<AboutSection['kind'], string> = {
  prose: 'Words',
  picture: 'Words and a photograph',
  list: 'A list',
};

const GROUND_LABELS: Record<AboutGround, string> = {
  plain: 'Paper',
  sunken: 'Slightly darker',
  tinted: 'Tinted',
  deep: 'Deep (white words)',
};

function PageFields({ draft, editor }: { draft: AboutCopy; editor: AboutDraft }) {
  const { select } = useEditMode();
  const { editSections } = editor;
  const sections = draft.sections;

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= sections.length) return;
    editSections((was) => {
      const next = [...was];
      const [row] = next.splice(index, 1);
      if (row) next.splice(to, 0, row);
      return next;
    }, `section-move:${Date.now()}`);
  }

  return (
    <>
      <p className="inspector__hint">
        Click any heading or paragraph on the page to change its words. Listed here are the
        sections you have added, which sit at the foot of the page.
      </p>

      {sections.length === 0 && <p className="inspector__hint">Nothing added to this page yet.</p>}

      {/*
        A hairlined list, not a pile of cards — the camp screens settled this: a
        border and a shadow round every row turns a list of four things into four
        objects and the column stops reading as one thing.
      */}
      <ol className="ab-list">
        {sections.map((section, index) => (
          <li key={section.id} className="ab-list__row">
            {/*
              The whole row is the way in, rather than a name with an Edit
              beside it — a separate control for "open this" was invisible twice
              running on the camp screens.
            */}
            <button
              type="button"
              className="ab-list__open"
              onClick={() => select({ kind: 'level', id: section.id })}
            >
              <strong>{section.heading || 'Untitled section'}</strong>
              <small>{KIND_LABELS[section.kind]}</small>
            </button>
            <div className="ab-list__moves">
              <button
                type="button"
                className="ab-slot__act"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${section.heading || 'this section'} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="ab-slot__act"
                disabled={index === sections.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${section.heading || 'this section'} down`}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>

      {sections.length < ABOUT_SECTION_LIMIT && (
        <div className="ab-add">
          <p className="ab-add__label">Add a section</p>
          {(['prose', 'picture', 'list'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="button button--ghost"
              onClick={() => {
                const made = blankSection(kind, (sections.length + 1) * 10);
                editSections((was) => [...was, made], `section-add:${Date.now()}`);
                // Straight into the new section's fields. Adding one and then
                // having to find it in the list is two steps for one intention.
                select({ kind: 'level', id: made.id });
              }}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* One appended section                                                       */
/* -------------------------------------------------------------------------- */

function SectionFields({
  page,
  section,
  editor,
}: {
  page: AboutSlug;
  section: AboutSection;
  editor: AboutDraft;
}) {
  const { select } = useEditMode();
  const { editSections } = editor;

  function patch(change: Partial<AboutSection>, tag: string) {
    editSections(
      (was) =>
        was.map((row) => (row.id === section.id ? ({ ...row, ...change } as AboutSection) : row)),
      tag,
    );
  }

  return (
    <>
      <label className="field">
        <span>What this section is called</span>
        <input
          value={section.heading}
          onChange={(event) =>
            patch({ heading: event.target.value }, `section-text:${section.id}:heading`)
          }
        />
      </label>

      <label className="field">
        <span>The small line above</span>
        <input
          value={section.eyebrow ?? ''}
          onChange={(event) =>
            patch({ eyebrow: event.target.value }, `section-text:${section.id}:eyebrow`)
          }
        />
        <small>Optional.</small>
      </label>

      <label className="field">
        <span>Background</span>
        <select
          value={section.ground}
          onChange={(event) =>
            patch({ ground: event.target.value as AboutGround }, `section-ground:${section.id}`)
          }
        >
          {ABOUT_GROUNDS.map((ground) => (
            <option key={ground} value={ground}>
              {GROUND_LABELS[ground]}
            </option>
          ))}
        </select>
        <small>Alternate it from the section above so the two read apart.</small>
      </label>

      {section.kind === 'list' ? (
        <ListRows section={section} patch={patch} />
      ) : (
        <>
          <RichField
            label="Words"
            value={section.body}
            rows={7}
            onChange={(next) => patch({ body: next }, `section-text:${section.id}:body`)}
          />
          {section.kind === 'picture' && (
            <SectionPicture page={page} section={section} patch={patch} />
          )}
        </>
      )}

      <button
        type="button"
        className="ab-slot__act ab-remove"
        onClick={() => {
          editSections(
            (was) => was.filter((row) => row.id !== section.id),
            `section-remove:${section.id}`,
          );
          // Back to the page, because what was selected no longer exists.
          select({ kind: 'page' });
        }}
      >
        Remove this section
      </button>
      <p className="inspector__hint">Undo brings it back — ⌘Z, or the arrow at the top.</p>
    </>
  );
}

function ListRows({
  section,
  patch,
}: {
  section: Extract<AboutSection, { kind: 'list' }>;
  patch: (change: Partial<AboutSection>, tag: string) => void;
}) {
  function items(next: typeof section.items, tag: string) {
    patch({ items: next } as Partial<AboutSection>, tag);
  }

  return (
    <div className="ab-rows">
      {section.items.map((item, index) => (
        <div key={index} className="ab-rows__row">
          <label className="field">
            <span>Term</span>
            <input
              value={item.term}
              onChange={(event) =>
                items(
                  section.items.map((row, at) =>
                    at === index ? { ...row, term: event.target.value } : row,
                  ),
                  `section-text:${section.id}:term:${index}`,
                )
              }
            />
          </label>
          <label className="field">
            <span>What is said about it</span>
            <textarea
              rows={2}
              value={item.detail}
              onChange={(event) =>
                items(
                  section.items.map((row, at) =>
                    at === index ? { ...row, detail: event.target.value } : row,
                  ),
                  `section-text:${section.id}:detail:${index}`,
                )
              }
            />
          </label>
          <button
            type="button"
            className="ab-slot__act"
            onClick={() =>
              items(
                section.items.filter((_row, at) => at !== index),
                `section-row-remove:${section.id}:${index}`,
              )
            }
          >
            Remove this row
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button--ghost"
        onClick={() =>
          items([...section.items, { term: '', detail: '' }], `section-row-add:${Date.now()}`)
        }
      >
        Add a row
      </button>
    </div>
  );
}

function SectionPicture({
  page,
  section,
  patch,
}: {
  page: AboutSlug;
  section: Extract<AboutSection, { kind: 'picture' }>;
  patch: (change: Partial<AboutSection>, tag: string) => void;
}) {
  function image(next: AboutImage, tag: string) {
    patch({ image: next } as Partial<AboutSection>, tag);
  }

  return (
    <>
      <PicturePicker
        value={section.image.src || null}
        label="Photograph"
        note="Everything the site already ships is in this list, with the words written for it."
        choices={ABOUT_PICTURE_CHOICES}
        upload={(file) => uploadAboutPicture(page, file)}
        onChange={(src) => {
          if (src === null) {
            image({ src: '' }, `section-image:${section.id}`);
            return;
          }
          const known = pictureFor(src);
          const next: AboutImage = { src };
          if (known?.alt) next.alt = known.alt;
          if (known?.caption) next.caption = known.caption;
          if (known?.width) next.width = known.width;
          if (known?.height) next.height = known.height;
          image(next, `section-image:${section.id}`);
        }}
      />

      <label className="field">
        <span>What is in the photograph</span>
        <textarea
          rows={2}
          value={section.image.alt ?? ''}
          onChange={(event) =>
            image({ ...section.image, alt: event.target.value }, `section-text:${section.id}:alt`)
          }
        />
        <small>
          Read aloud instead of the picture to somebody who cannot see it. Describe it, do not
          caption it.
        </small>
      </label>

      <label className="field">
        <span>Caption</span>
        <textarea
          rows={2}
          value={section.image.caption ?? ''}
          onChange={(event) =>
            image(
              { ...section.image, caption: event.target.value },
              `section-text:${section.id}:caption`,
            )
          }
        />
      </label>

      <label className="field">
        <span>Which side the photograph takes</span>
        <select
          value={section.side}
          onChange={(event) =>
            patch(
              { side: event.target.value === 'left' ? 'left' : 'right' } as Partial<AboutSection>,
              `section-side:${section.id}`,
            )
          }
        >
          <option value="right">Right of the words</option>
          <option value="left">Left of the words</option>
        </select>
        <small>Stacked on a phone either way, words first.</small>
      </label>
    </>
  );
}
