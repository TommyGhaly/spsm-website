'use client';

import { useRef, useState } from 'react';
import { STOCK_PICTURES, type PictureChoice } from '@/features/media/stockPictures';
import type { UploadResult } from '@/lib/uploadNaming';

/*
 * The stock list lives in `features/media/stockPictures` now — the About pages
 * choose a picture too, and a list of the photographs this site ships is not a
 * fact about forms. The four stock photographs, the parish's own images, and
 * the reasoning for both are documented there.
 */

/**
 * Choosing or uploading a form's picture.
 *
 * The dropdown is the shortlist — the four stock photographs and the parish's
 * own images. The upload beside it is the answer to "none of those is my van":
 * a parish that has a photograph of its own hall should not be limited to a
 * list a developer wrote months ago.
 *
 * The thumbnail is shown at the card's real 5:2 crop, which is the only way the
 * one genuine failure is visible before it ships: a tall photograph whose
 * subject is cropped out entirely by a wide, short box.
 *
 * ---------------------------------------------------------------------------
 * Its own module, because two screens choose a picture now.
 *
 * It was a private component inside `FormBuilder`, which was right while the
 * builder was the only place a form got one. The Tithe.ly importer is the
 * second: an imported form has no questions of ours to look at, so the picture
 * is most of what distinguishes its card from every other card — and asking
 * somebody to import a form, save it, then reopen it in the builder to give it
 * a photograph is three steps for one decision they had already made.
 *
 * Props are a value and a setter rather than a draft and a patch, which is what
 * makes it usable by a caller that has no `FormDraft` in hand yet.
 * ---------------------------------------------------------------------------
 */
export function PicturePicker({
  value,
  onChange,
  upload: send,
  choices = STOCK_PICTURES,
  label = 'Picture',
  note = 'Shown on the card on /forms, and as a band above the form itself.',
}: {
  value: string | null;
  onChange: (image: string | null) => void;
  /**
   * Where an uploaded file goes.
   *
   * A function rather than a folder name, because the two callers file into
   * prefixes with different rules behind them — `forms/` and `content/about/` —
   * and each already has a helper that knows its own path, its own size policy
   * and its own error translation. Passing the upload in keeps this component
   * ignorant of Storage entirely.
   */
  upload: (file: File) => Promise<UploadResult>;
  /** Defaults to the stock list. The About editor adds every plate the site ships. */
  choices?: readonly PictureChoice[];
  label?: string;
  note?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /* An uploaded picture is a URL that is not in the list, so the select would
     otherwise fall back to showing the first option and misreport what the form
     is actually wearing. */
  const known = choices.some((picture) => picture.value === (value ?? null));

  async function upload(chosen: File | undefined) {
    if (!chosen) return;
    setFailed(null);
    setBusy(true);
    const result = await send(chosen);
    setBusy(false);
    if (!result.ok) {
      setFailed(result.reason);
      return;
    }
    onChange(result.url);
  }

  return (
    <div className="fxb__picture">
      <label className="field">
        <span>{label}</span>
        <select
          value={known ? value ?? '' : '__uploaded'}
          onChange={(event) => onChange(event.target.value || null)}
        >
          {!known && <option value="__uploaded">Uploaded picture</option>}
          {choices.map((picture) => (
            <option key={picture.label} value={picture.value ?? ''}>
              {picture.label}
            </option>
          ))}
        </select>
        <small>{note}</small>
      </label>

      <div className="fxb__picture-actions">
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          {busy ? 'Uploading…' : 'Upload a photo…'}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>

      {failed && (
        <div className="notice notice--alarm" role="alert">
          <p>{failed}</p>
        </div>
      )}

      {value && (
        <span className="fxb__thumb">
          <img src={value} alt="" />
        </span>
      )}
    </div>
  );
}
