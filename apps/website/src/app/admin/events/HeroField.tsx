'use client';

/**
 * The event's photograph.
 *
 * It behaves differently from every other control on the form and always has:
 * choosing a file **uploads it there and then**, before Save is pressed, because
 * a 6MB photograph over the church hall's wifi is tens of seconds and hanging
 * that off the save button means somebody presses Save, sees nothing, and presses
 * it again.
 *
 * The consequence is stated rather than discovered: an upload that is never saved
 * leaves an orphan object in the bucket. That is the trade — a stray file nobody
 * sees, against a save that appears to hang.
 *
 * What is new here is the drop target and the fact that it says so. The old
 * version was a bare `<input type="file">` that went grey with the sentence "Give
 * the event a title first" underneath, which is a disabled control explaining
 * itself in the one place people do not look.
 */

import { useRef, useState } from 'react';
import { publicStorageUrl } from '@/lib/storage';
import { Icon } from '@/components/Icon';

export type HeroStatus =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'error'; message: string };

export function HeroField({
  path,
  status,
  ready,
  onPick,
  onClear,
}: {
  path: string | null;
  status: HeroStatus;
  /** False before the event has a name, since the object is stored under it. */
  ready: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  if (path) {
    return (
      <div className="ev-hero">
        {/*
          A plain `img`, not `next/image`. Under `output: 'export'` there is no
          image optimiser at runtime and the source is a Storage URL this build
          has never seen — the loader would have to be told the bucket is a
          remote pattern, for one thumbnail on a staff-only screen.
        */}
        <img className="ev-hero__shot" src={publicStorageUrl(path)} alt="" />
        <div className="ev-hero__aside">
          <p>
            Shown across the top of the event&apos;s own page. Not on the calendar,
            where a picture in a date cell crowds out the times.
          </p>
          <div className="ev-hero__buttons">
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => input.current?.click()}
              disabled={status.kind === 'uploading'}
            >
              {status.kind === 'uploading' ? 'Uploading…' : 'Replace'}
            </button>
            <button type="button" className="button button--quiet button--small" onClick={onClear}>
              Remove
            </button>
          </div>
          {status.kind === 'error' && <p className="ev-hero__bad">{status.message}</p>}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so choosing the same file twice, after a failed upload,
            // still fires a change event.
            e.target.value = '';
            if (file) onPick(file);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={over ? 'ev-drop ev-drop--over' : 'ev-drop'}
        disabled={!ready || status.kind === 'uploading'}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && ready) onPick(file);
        }}
      >
        <Icon name="photos" size={26} />
        {status.kind === 'uploading' ? (
          <strong>Uploading…</strong>
        ) : ready ? (
          <>
            <strong>Drop a photograph here, or choose one</strong>
            <small>JPEG, PNG or WebP, up to 8MB. A wide one works best.</small>
          </>
        ) : (
          <>
            <strong>Name the event first</strong>
            <small>The photograph is filed under the event&apos;s web address.</small>
          </>
        )}
      </button>

      {status.kind === 'error' && (
        <p className="ev-hero__bad" role="alert">
          {status.message}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </div>
  );
}
