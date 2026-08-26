'use client';

import { useEffect, useState } from 'react';
import { NO_PAYMENT, toFormSlug, type FormDraft } from '@spsm/shared';
import { importBreezeForm, listBreezeForms, writeForm, type BreezeForm } from './adminData';

/**
 * Bringing a Breeze form across.
 *
 * ---------------------------------------------------------------------------
 * An importer, not a live mirror — and the difference is Breeze's API.
 *
 * The obvious thing to want is for a Breeze form to be *streamed*: read its
 * definition on every page load and render it natively, so the two never drift.
 * Breeze can supply the definition — `list_forms`, `list_form_fields` — and it
 * is genuinely tempting.
 *
 * It does not work, because Breeze's forms API is read and delete only. There is
 * no endpoint that creates an entry. A Breeze form rendered natively would post
 * its answers to us and Breeze would never hear about them, while the office
 * carried on checking Breeze and finding it empty. That is a worse outcome than
 * either honest option.
 *
 * So the two honest options are the two this feature offers: leave the form in
 * Breeze and link out to it (`kind: 'external'`), or move it across for good and
 * accept that new answers arrive here from now on. This is the second one, done
 * once, with the fields carried over so nobody retypes them.
 *
 * Everything imported arrives **unpublished**. Breeze's field types do not map
 * cleanly onto ours — some of theirs are compound — so an import is a first
 * draft to check, not a finished form.
 * ---------------------------------------------------------------------------
 */

type State =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; forms: BreezeForm[] }
  | { kind: 'importing'; id: string };

export function BreezeImport({ onImported }: { onImported: () => Promise<void> }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listBreezeForms().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: 'ready', forms: result.forms }
          : { kind: 'unavailable', reason: result.reason },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function bring(breeze: BreezeForm) {
    setState({ kind: 'importing', id: breeze.id });
    setNote(null);

    const result = await importBreezeForm(breeze.id);
    if (!result.ok) {
      setNote(result.reason);
      const forms = state.kind === 'ready' ? state.forms : [];
      setState({ kind: 'ready', forms });
      return;
    }

    const id = `form-${Date.now().toString(36)}`;
    await writeForm(id, {
      slug: toFormSlug(result.title) || id,
      title: result.title,
      blurb: '',
      icon: 'file',
      image: null,
      order: 100,
      // Unpublished, always. See the note above: an import is a draft.
      published: false,
      open: true,
      closedMessage: null,
      kind: 'native',
      externalUrl: null,
      pushesToTaksis: false,
      fields: result.fields,
      payment: { ...NO_PAYMENT },
      notifyEmails: [],
      confirmationMessage: 'Thank you — the parish office has your submission.',
      confirmationEmailBody: '',
      // Provenance, so which Breeze form this came from is recorded rather than
      // remembered. It is also what a future "has Breeze changed?" check needs.
      breezeFormId: breeze.id,
    } satisfies FormDraft);

    await onImported();
  }

  if (state.kind === 'loading') return <p className="note">Asking Breeze…</p>;

  if (state.kind === 'unavailable') {
    return (
      <div className="notice">
        <h2>Breeze is not connected</h2>
        <p>{state.reason}</p>
        <p className="meta">
          The importer needs a Breeze API key in the Functions runtime. In Breeze:
          your name, top right → Account Settings → Extensions → API. Everything
          else on this page works without it — a Breeze form can always be added
          by hand as a form that links out.
        </p>
      </div>
    );
  }

  const forms = state.kind === 'ready' ? state.forms : [];

  return (
    <>
      <p className="note">
        Copies a Breeze form&apos;s questions across as a new draft here. It does not
        connect the two: answers sent to the copy arrive at the parish site, and
        answers sent in Breeze stay in Breeze.
      </p>

      {note && (
        <div className="notice notice--alarm" role="alert">
          <p>{note}</p>
        </div>
      )}

      <ul className="fxa__list">
        {forms
          .filter((breeze) => !breeze.archived)
          .map((breeze) => (
            <li key={breeze.id} className="fxa__row">
              <div className="fxa__row-main">
                <span className="fxa__row-title">{breeze.name}</span>
                <span className="fxa__row-meta">{breeze.url}</span>
              </div>
              <div className="fxa__row-actions">
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={state.kind === 'importing'}
                  onClick={() => void bring(breeze)}
                >
                  {state.kind === 'importing' && state.id === breeze.id ? 'Copying…' : 'Copy across'}
                </button>
              </div>
            </li>
          ))}
      </ul>

      {forms.length === 0 && <p className="note">Breeze has no forms to show.</p>}
    </>
  );
}
