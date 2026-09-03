'use client';

/**
 * The event's photograph, at the size it will actually be.
 *
 * ## The band is the same height whether there is a photograph or not
 *
 * This is the decision that changed, at Tommy's direction, and it is worth
 * saying which trade it makes. The version before this kept the empty chooser to
 * a single 95px strip, to avoid moving the page when Edit was pressed on an
 * event with no picture. The cost was that the strip looked nothing like a hero,
 * and *adding* a photograph then shoved the entire page down by 300px — so the
 * reflow was not avoided, only moved to the worse moment. Pressing Edit is a
 * moment you expect something to happen; choosing a picture is a moment you are
 * trying to judge a crop.
 *
 * So the empty state occupies exactly the space the photograph will, and adding
 * one changes no geometry at all.
 *
 * ## Choosing a file uploads it immediately
 *
 * Before anything is published, and that has always been true here. A 6MB
 * photograph over the church hall's wifi is tens of seconds, and hanging that
 * off a later button means somebody presses it, sees nothing, and presses it
 * again. The consequence is stated rather than discovered: a photograph chosen
 * and then never published leaves an orphan object in the bucket. That is the
 * trade — a stray file nobody sees, against a save that appears to hang.
 *
 * `next/image` is not used, and cannot be: `output: 'export'` has no optimiser
 * at runtime and the source is a Storage URL this build has never been told
 * about. Same as the public page, which renders the same `img`.
 */

import { type DragEvent as ReactDragEvent, useRef, useState } from 'react';
import { publicStorageUrl } from '@/lib/storage';
import { Icon } from '@/components/Icon';

export type HeroStatus =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'error'; message: string };

export function HeroBand({
  path,
  status,
  onPick,
  onClear,
}: {
  path: string | null;
  status: HeroStatus;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = status.kind === 'uploading';

  /*
   * How deep into the band the drag currently is.
   *
   * `dragleave` fires every time the pointer crosses from the band onto one of
   * its own children — the button, the icon, the `strong`, the tools — and the
   * version before this cleared the highlight on every one of them. Dragging a
   * photograph across the band therefore flashed the drop state on and off
   * several times a second, which is the flicker being complained about rather
   * than anything to do with the upload.
   *
   * Counting enters against leaves is the standard fix and the only one that
   * works without knowing what is inside the band: the count only reaches zero
   * when the drag has genuinely left the outer element. A ref rather than
   * state, because the count is bookkeeping and must not repaint on its own.
   */
  const depth = useRef(0);

  function take(file: File | undefined) {
    if (file) onPick(file);
  }

  /**
   * Whether this drag is carrying files at all.
   *
   * Dragging selected text, or a link, across the editor should not light up a
   * photograph target it cannot satisfy. `types` is the one part of
   * `dataTransfer` readable during a drag — `files` is empty until the drop —
   * so it is what the test has to be made of.
   */
  function hasFiles(event: ReactDragEvent) {
    return Array.from(event.dataTransfer.types ?? []).includes('Files');
  }

  return (
    <div
      className={over ? 'ee-hero ee-hero--over' : 'ee-hero'}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        // Both of these are required for a drop to be allowed at all, and the
        // cursor is set explicitly so the reader is told this copies a file
        // rather than moving something out of the page.
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        if (!busy) take(event.dataTransfer.files?.[0]);
      }}
    >
      {path ? (
        <img className="ee-hero__shot" src={publicStorageUrl(path)} alt="" />
      ) : (
        /*
          A button filling the band, so the whole area is the target rather than
          a link in the middle of a large inert rectangle.
        */
        <button
          type="button"
          className="ee-hero__empty"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Icon name="photos" size={28} />
          <strong>{busy ? 'Uploading…' : 'Add a photograph'}</strong>
          <small>
            Drop one here or choose a file. JPEG, PNG or WebP — a wide one works best.
          </small>
        </button>
      )}

      {/*
        The controls over the photograph rather than beside it, and only when
        there is one. Beside it would be a column of buttons in the page's
        gutter, which is the one place a full-bleed band does not have.
      */}
      {path && (
        <div className="ee-hero__tools">
          <button
            type="button"
            className="ee-hero__tool"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Icon name="photos" size={13} />
            {busy ? 'Uploading…' : 'Replace'}
          </button>
          <button type="button" className="ee-hero__tool" onClick={onClear}>
            <Icon name="close" size={13} />
            Remove
          </button>
        </div>
      )}

      {over && (
        <p className="ee-hero__drop" aria-hidden="true">
          <Icon name="photos" size={20} />
          {busy ? 'Wait for this upload to finish' : 'Drop to use this photograph'}
        </p>
      )}

      {status.kind === 'error' && (
        <p className="ee-hero__bad" role="alert">
          {status.message}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file twice, after a failed upload,
          // still fires a change event.
          event.target.value = '';
          take(file);
        }}
      />
    </div>
  );
}
