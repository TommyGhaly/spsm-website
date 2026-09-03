'use client';

import { useState } from 'react';
import { NO_PAYMENT, isKnownFormHost, toFormSlug, type FormDraft } from '@spsm/shared';
import { PicturePicker } from './PicturePicker';
import { uploadFormPicture } from '../uploads';
import { writeForm } from './adminData';

/**
 * Bringing somebody else's form onto the site.
 *
 * ---------------------------------------------------------------------------
 * An address and a picture, and deliberately nothing else.
 *
 * This replaces a Breeze importer that tried to do much more: it read a form's
 * fields out of Breeze through a Function holding the API key, mapped their
 * field types onto ours, and wrote a native draft for somebody to check. The
 * long comment it carried was about why that was a *copy* rather than a mirror
 * — Breeze's forms API is read and delete only, so a Breeze form rendered
 * natively would collect answers Breeze never hears about while the office
 * carried on checking Breeze and finding it empty.
 *
 * Neither host this replaces it for can do better. Tithe.ly has no forms API
 * at all (decisions.md §2), and Breeze's is read-and-delete — so with either,
 * the questions stay theirs and the answers stay theirs.
 *
 * What that leaves is the thing the parish actually wanted, which the Breeze
 * importer never gave them: the form appearing **on our page**, under the
 * church's masthead and its own photograph, rather than as a card that throws
 * somebody out to a site with a different header. The frame is ours; everything
 * inside it is theirs.
 *
 * So this asks for three things and stores three things — where the form is,
 * what to call it, and what it looks like on the hub.
 *
 * ## What it costs, stated once so it is not discovered later
 *
 * **Nothing an embedded form collects is stored here.** No submissions row, no
 * notification email, no total. Whoever holds the Tithe.ly or Breeze account
 * reads the answers there. That is not a limitation of this screen — it is what
 * "still theirs" means, and the form list says so beside every embedded card.
 *
 * A framed page can also always refuse to be framed. `FormScreen` renders an
 * "open in a new tab" link beside every embed for exactly that, which is the
 * same escape hatch the giving overlay carries and for the same reason.
 * ---------------------------------------------------------------------------
 */
export function EmbedImport({ onImported }: { onImported: () => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [blurb, setBlurb] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = url.trim();
  const ready = trimmed.length > 0 && title.trim().length > 0;
  /*
   * A warning rather than a refusal. See `isKnownFormHost` for the argument:
   * the escape hatch on the page covers a frame that does not work, and this
   * covers the likelier problem, which is a typo or a link to the wrong page.
   */
  const offHost = trimmed.length > 0 && !isKnownFormHost(trimmed);

  async function add() {
    setBusy(true);
    setError(null);

    /*
     * The slug is the document id, which is what `readFormBySlug` is built
     * around: it tries an exact `get` on the id first and only falls back to a
     * query when that misses. Creating these as `form-<timestamp>` with a
     * different slug made every one of them take the slow path — and, until the
     * `catch` there was added, fail outright for anybody not signed in.
     */
    const id = toFormSlug(title) || `form-${Date.now().toString(36)}`;
    try {
      await writeForm(id, {
        slug: id,
        title: title.trim(),
        blurb: blurb.trim(),
        icon: 'file',
        image,
        order: 100,
        /*
         * Published straight away, unlike the Breeze field-copier that came
         * before.
         *
         * That one arrived as a draft because it produced a *guess* — Breeze's
         * compound field types do not map cleanly onto ours, so an import was a
         * first draft somebody had to read through. There is no guess here.
         * Everything this screen collects has just been typed on this screen,
         * and the questions are Tithe.ly's own. Holding it back as a draft
         * would mean finding it in the list and ticking a box to finish a job
         * that is already finished.
         *
         * Undoing it is one tick in the same list.
         */
        published: true,
        open: true,
        closedMessage: null,
        kind: 'embed',
        externalUrl: trimmed,
        pushesToTaksis: false,
        fields: [],
        payment: { ...NO_PAYMENT },
        // Nothing arrives here to be notified about. See the note above.
        notifyEmails: [],
        confirmationMessage: '',
        confirmationEmailBody: '',
      } satisfies FormDraft);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : 'That form could not be added.');
      return;
    }

    await onImported();
  }

  return (
    <>
      <p className="note">
        Puts a Tithe.ly or Breeze form on a page of ours, with the church&apos;s
        header and a picture around it. The form stays theirs — answers are kept
        where the form is hosted and do not appear under Submissions here.
      </p>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      <label className="field">
        <span>The form&apos;s address</span>
        <input
          type="url"
          value={url}
          placeholder="https://stphilopaterstmina.breezechms.com/form/…"
          onChange={(event) => setUrl(event.target.value)}
        />
        <small>
          Open the form in Tithe.ly or Breeze and copy the address out of the
          browser&apos;s bar, or use the share link they give you.
        </small>
      </label>

      {offHost && (
        <div className="notice">
          <p>
            That is not a Tithe.ly or Breeze address. It can still be added, but a
            page that is not built to be embedded may refuse to appear inside ours —
            open it on /forms afterwards and check.
          </p>
        </div>
      )}

      <label className="field">
        <span>Title</span>
        <input
          value={title}
          placeholder="Festival volunteer sign-up"
          onChange={(event) => setTitle(event.target.value)}
        />
        <small>What the card on /forms says. /forms/{toFormSlug(title) || '…'}</small>
      </label>

      <label className="field">
        <span>Blurb</span>
        <textarea rows={2} value={blurb} onChange={(event) => setBlurb(event.target.value)} />
        <small>One or two sentences, shown on the card and above the form.</small>
      </label>

      <PicturePicker
        value={image}
        onChange={setImage}
        upload={(file) => uploadFormPicture(toFormSlug(title) || 'embed', file)}
      />

      <button type="button" className="button" disabled={!ready || busy} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add the form'}
      </button>
    </>
  );
}
