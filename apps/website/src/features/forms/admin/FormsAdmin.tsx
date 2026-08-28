'use client';

import { useCallback, useEffect, useState } from 'react';
import { NO_PAYMENT, toFormSlug, type FormDefinition, type FormDraft } from '@spsm/shared';
import { Dialog } from '@/features/bookstore/Sheet';
import { readAllForms, type WithId } from '../data';
import { deleteForm, setFormFlags, writeForm } from './adminData';
import { FormBuilder } from './FormBuilder';
import { SubmissionsPanel } from './SubmissionsPanel';
import { BreezeImport } from './BreezeImport';

/**
 * The forms back office: a drawer down the right of /forms.
 *
 * ---------------------------------------------------------------------------
 * The bookstore's arrangement, chosen for the same reason.
 *
 * `BookstoreAdmin` records why a drawer beat a panel in the page flow: an inline
 * panel is laid out *in* the document, so opening it moves everything below, and
 * the card you were looking at before you pressed the button is somewhere else
 * when you close it again. An overlay costs that never.
 *
 * It also records the rule that a review surface should not become a place to
 * edit the thing it reviews — the bookstore's catalog tab was taken out again
 * for exactly that. This drawer does not break that rule so much as sit on the
 * other side of it: a form *definition* has no page of its own to edit in place.
 * The hub shows cards, and a card is a title and a sentence — there is nowhere
 * on it to put a conditional field, an option price, or a notification address.
 *
 * So the builder lives here, and the thing that would break the rule is absent:
 * nothing in this drawer edits a *submission's* content. Staff can advance one
 * through its statuses and attach a note, which is the same pair of writes the
 * orders queue allows, and for the same reason — both are about the record's
 * handling rather than its contents.
 * ---------------------------------------------------------------------------
 */

type View =
  | { kind: 'list' }
  | { kind: 'build'; form: WithId<FormDraft> }
  | { kind: 'submissions'; formId: string | null }
  | { kind: 'import' };

export function FormsAdmin() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="bkadmin__toggle" onClick={() => setOpen(true)}>
        Forms &amp; submissions
      </button>

      {/* Mounted only while open, so closing genuinely unmounts the builder and
          its draft state rather than leaving it hidden with unsaved edits in it. */}
      {open && <AdminDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function AdminDrawer({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [forms, setForms] = useState<WithId<FormDefinition>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setForms(await readAllForms());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The forms could not be read.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    const id = `form-${Date.now().toString(36)}`;
    const draft = blankForm(id);
    await writeForm(id, draft);
    await refresh();
    setView({ kind: 'build', form: { id, ...draft } });
  }

  return (
    <Dialog
      title="Church forms"
      className="sheet--drawer"
      screen={view.kind}
      onClose={onClose}
    >
      <div className="bkadmin">
        <div className="bktabs" role="tablist" aria-label="Forms">
          <button
            type="button"
            role="tab"
            aria-selected={view.kind === 'list' || view.kind === 'build'}
            className={view.kind === 'submissions' || view.kind === 'import' ? 'bktabs__tab' : 'bktabs__tab is-on'}
            onClick={() => setView({ kind: 'list' })}
          >
            Forms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view.kind === 'submissions'}
            className={view.kind === 'submissions' ? 'bktabs__tab is-on' : 'bktabs__tab'}
            onClick={() => setView({ kind: 'submissions', formId: null })}
          >
            Submissions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view.kind === 'import'}
            className={view.kind === 'import' ? 'bktabs__tab is-on' : 'bktabs__tab'}
            onClick={() => setView({ kind: 'import' })}
          >
            Import
          </button>
        </div>

        {error && (
          <div className="notice notice--alarm" role="alert">
            <p>{error}</p>
          </div>
        )}

        {view.kind === 'list' && (
          <FormsList
            forms={forms}
            onCreate={() => void create()}
            onEdit={(form) => setView({ kind: 'build', form })}
            onSubmissions={(formId) => setView({ kind: 'submissions', formId })}
            onChanged={() => void refresh()}
          />
        )}

        {view.kind === 'build' && (
          <FormBuilder
            form={view.form}
            onDone={() => {
              void refresh();
              setView({ kind: 'list' });
            }}
          />
        )}

        {view.kind === 'submissions' && (
          <SubmissionsPanel formId={view.formId} forms={forms ?? []} />
        )}

        {view.kind === 'import' && (
          <BreezeImport
            onImported={async () => {
              await refresh();
              setView({ kind: 'list' });
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

/**
 * Forms that are parish infrastructure rather than parish paperwork.
 *
 * One of them: vehicle registration. It is permanent because there is a
 * physical NFC tag pointing at `/parking`, a card in the car park, and it
 * cannot be reprinted by editing a file.
 *
 * That matters here because `/parking` does not check `published` — but
 * `formSubmit` does, and answers 404 to an unpublished form. So unticking
 * Published would leave the tag loading a form that silently refuses every
 * submission, with nothing on the page to say why. Deleting it is worse again.
 *
 * Neither is a decision anybody makes on purpose from a list of checkboxes, so
 * the two controls that cause it are not offered on this row.
 */
function isPermanent(form: FormDefinition): boolean {
  return form.kind === 'vehicle';
}

function FormsList({
  forms,
  onCreate,
  onEdit,
  onSubmissions,
  onChanged,
}: {
  forms: WithId<FormDefinition>[] | null;
  onCreate: () => void;
  onEdit: (form: WithId<FormDraft>) => void;
  onSubmissions: (formId: string) => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (forms === null) return <p className="note">Loading…</p>;

  return (
    <>
      <button type="button" className="button" onClick={onCreate}>
        + New form
      </button>

      {forms.length === 0 && <p className="note">No forms yet.</p>}

      <ul className="fxa__list">
        {forms.map((form) => (
          <li key={form.id} className="fxa__row">
            <div className="fxa__row-main">
              <button type="button" className="fxa__row-title" onClick={() => onEdit(form)}>
                {form.title}
              </button>
              <span className="fxa__row-meta">
                /forms/{form.slug} · {KIND_LABEL[form.kind]}
                {form.payment.enabled && ' · takes payment'}
              </span>
            </div>

            <div className="fxa__row-flags">
              {/*
                Publish and open are toggled here rather than only inside the
                builder. Closing a registration the night it fills up is the one
                edit that is urgent, and it should not require opening a form
                editor and finding the right checkbox.
              */}
              <label className="fxa__flag">
                <input
                  type="checkbox"
                  checked={form.published}
                  disabled={isPermanent(form)}
                  onChange={(event) => {
                    void setFormFlags(form.id, { published: event.target.checked }).then(onChanged);
                  }}
                />
                <span>
                  Published
                  {isPermanent(form) && <small> — always on, the car park tags use it</small>}
                </span>
              </label>
              <label className="fxa__flag">
                <input
                  type="checkbox"
                  checked={form.open}
                  onChange={(event) => {
                    void setFormFlags(form.id, { open: event.target.checked }).then(onChanged);
                  }}
                />
                <span>Open</span>
              </label>
            </div>

            <div className="fxa__row-actions">
              <button type="button" className="button button--quiet" onClick={() => onEdit(form)}>
                Edit
              </button>
              {form.kind !== 'external' && (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => onSubmissions(form.id)}
                >
                  Submissions
                </button>
              )}
              {isPermanent(form) ? null : confirming === form.id ? (
                <>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => {
                      void deleteForm(form.id).then(() => {
                        setConfirming(null);
                        onChanged();
                      });
                    }}
                  >
                    Really delete
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setConfirming(form.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="meta">
        Deleting a form leaves its submissions in place — they are a record of
        something that happened. Unpublish instead to take a form off the site
        while keeping it.
      </p>
    </>
  );
}

const KIND_LABEL: Record<FormDefinition['kind'], string> = {
  native: 'built here',
  external: 'links out',
  vehicle: 'vehicle registration',
};

/**
 * A new form, unpublished.
 *
 * `published: false` is the important default. A form created by a mis-click
 * should not be a live page with no questions on it, and the builder's warnings
 * are written on the assumption that the thing being warned about is not yet
 * in front of anybody.
 */
function blankForm(id: string): FormDraft {
  return {
    slug: toFormSlug(id),
    title: 'New form',
    blurb: '',
    icon: 'file',
    image: null,
    order: 100,
    published: false,
    open: true,
    closedMessage: null,
    kind: 'native',
    externalUrl: null,
    pushesToTaksis: false,
    fields: [],
    payment: { ...NO_PAYMENT },
    notifyEmails: [],
    confirmationMessage: 'Thank you — the church office has your submission.',
    confirmationEmailBody: '',
    breezeFormId: null,
  };
}
