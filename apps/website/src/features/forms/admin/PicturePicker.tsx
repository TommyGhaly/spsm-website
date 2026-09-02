'use client';

import { useRef, useState } from 'react';
import { uploadFormPicture } from '../uploads';

/**
 * Pictures a form may wear.
 *
 * The four stock photographs first: each one says what a form is *for* — a car
 * park, a van, a group meeting, a gathering — which is the job a generic
 * photograph can do honestly. Their licence and photo ids are recorded in
 * `assets/README.md`, unlike every other stock image this repo inherited.
 *
 * The parish's own images follow, for a form where they genuinely fit.
 *
 * A fixed list rather than a free text box, because a box here is how a form
 * ends up hotlinking a photograph from somebody else's website.
 *
 * Notable absence: the Crucifixion icon. It is genuine and beautiful, and an
 * icon is venerated rather than used as page furniture — nobody should meet it
 * at the top of a form about parking a car.
 */
const PICTURES: { value: string | null; label: string }[] = [
  { value: '/img/stock-parking-lot-1000.webp', label: 'Car park' },
  { value: '/img/stock-passenger-van-1000.webp', label: 'Passenger van' },
  { value: '/img/stock-small-group-1000.webp', label: 'Small group' },
  { value: '/img/stock-gathering-1000.webp', label: 'Gathering' },
  { value: '/img/home-sanctuary-1000.webp', label: 'The sanctuary (ours)' },
  { value: '/img/cross-coptic-360.webp', label: 'Coptic cross (ours)' },
  { value: '/img/hero-glass-1000.webp', label: 'Stained glass' },
  { value: null, label: 'No picture' },
];

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
  slug,
  value,
  onChange,
}: {
  /** Where an uploaded file is filed under. The form's slug, or its id before
      it has one. */
  slug: string;
  value: string | null;
  onChange: (image: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /* An uploaded picture is a URL that is not in the list, so the select would
     otherwise fall back to showing the first option and misreport what the form
     is actually wearing. */
  const known = PICTURES.some((picture) => picture.value === (value ?? null));

  async function upload(chosen: File | undefined) {
    if (!chosen) return;
    setFailed(null);
    setBusy(true);
    const result = await uploadFormPicture(slug || 'form', chosen);
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
        <span>Picture</span>
        <select
          value={known ? value ?? '' : '__uploaded'}
          onChange={(event) => onChange(event.target.value || null)}
        >
          {!known && <option value="__uploaded">Uploaded picture</option>}
          {PICTURES.map((picture) => (
            <option key={picture.label} value={picture.value ?? ''}>
              {picture.label}
            </option>
          ))}
        </select>
        <small>Shown on the card on /forms, and as a band above the form itself.</small>
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
