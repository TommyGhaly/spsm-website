'use client';

/**
 * The editing column, down the right, with the page narrowed to fit beside it.
 *
 * ## This is the third arrangement, and the first that keeps its promise
 *
 * It was a 22rem column, then a 272px band across the foot, then a panel that
 * appeared beside whatever you clicked. Tommy has asked for the column back —
 * *"instead of trying to create a pop up the edit settings show up on the right
 * side and the whole screen shrinks to fit in the rest of the space"* — and it is
 * worth doing again rather than inventing a fourth idea, because what made it fail
 * the first time was a bug rather than the shape.
 *
 * **The bug:** `.rail--bleed` is `width: 100vw; margin-inline: calc(50% - 50vw)`,
 * so a full-bleed rail measures itself against the *window*. `padding-right` on
 * the page did nothing to it, and the galleries are mostly full-bleed rails — so
 * the part of the gallery that ran under the panel was the part being judged. That
 * is what "the column took a third of the horizontal space" actually meant.
 *
 * It is fixed by making the gutter a value both sides can read: `--edit-gutter` on
 * `body`, set by `usePanelWidth`, subtracted inside that `calc`. The rails now end
 * where the panel begins, so nothing is hidden and the width is honest.
 *
 * ## Always there while editing, and never empty
 *
 * The band died of being permanently present and mostly full of help text, so an
 * always-present column has to earn its space every moment it is on screen. Two
 * things make that true: the page-wide selection shows the page's *own* settings
 * rather than instructions, and `aside` folds in the list of what is inside this
 * level — which used to be a separate floating shelf in the corner. One column,
 * where there was a panel, a shelf and a pill.
 *
 * ## Under 60rem it is a sheet
 *
 * A 288px column beside a 375px phone is two unusable halves. There the panel
 * comes up from the bottom over the page instead, and nothing is narrowed. See
 * `.inspector-col` in globals.css.
 *
 * ## The markup now lives in `components/EditColumn`
 *
 * Lifted there on 2026-09-01 so the bookstore could be edited the same way, at
 * Tommy's request. This file is what is left: the gallery's *selection* — which
 * is the part that is genuinely this feature's, and is nothing like the shop's
 * flat list of books. Everything above still applies to the column itself and is
 * kept here because this is where anyone looking for it will come.
 */

import type { ReactNode } from 'react';
import { EditColumn } from '@/components/EditColumn';
import { useEditMode } from './editMode';

export function Inspector({
  title,
  kind,
  saving = false,
  aside,
  children,
}: {
  title: string;
  kind: string;
  saving?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { on, selection, select, setOn, refusal } = useEditMode();

  return (
    <EditColumn
      on={on}
      title={title}
      kind={kind}
      saving={saving}
      /* Absent when the page is already what is selected — there is nowhere up
         to go, and a control that does nothing is worse than none. */
      onBack={selection.kind === 'page' ? undefined : () => select({ kind: 'page' })}
      onDone={() => setOn(false)}
      aside={aside}
    >
      {refusal && (
        <div className="notice notice--alarm inspector__refusal" role="alert">
          <p>{refusal}</p>
        </div>
      )}
      {children}
    </EditColumn>
  );
}
