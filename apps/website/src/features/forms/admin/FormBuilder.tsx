'use client';

import { useMemo, useState } from 'react';
import {
  MAX_FIELDS,
  isChoiceField,
  isDecorative,
  toFormSlug,
  visibleFields,
  type FieldCondition,
  type FormDefinition,
  type FormDraft,
  type FormField,
  type FormFieldType,
  type FormOption,
} from '@spsm/shared';
import { FieldInput } from '../FormFields';
import { writeForm, type WithId } from './adminData';

/**
 * Building one form.
 *
 * ---------------------------------------------------------------------------
 * Explicit Save, not autosave.
 *
 * The events editor autosaves into a pending copy, and that is right for editing
 * *content* — a paragraph half-rewritten is still a paragraph. A form definition
 * is not like that. Mid-edit it is routinely invalid in ways that matter to
 * somebody else: a field whose options are half-typed, a condition pointing at a
 * key that has not been added yet, a price with a digit missing.
 *
 * A published form is a live page. Autosaving those intermediate states would
 * put each of them in front of whoever opens the form during the thirty seconds
 * it takes to finish the thought — including the one with the missing digit.
 *
 * So: edit locally, Save when it holds together. The dirty marker is what keeps
 * that honest, because the cost of explicit save is closing the drawer on
 * unsaved work, and the marker is the only thing standing between a volunteer
 * and that.
 * ---------------------------------------------------------------------------
 */

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

const TYPE_LABELS: Record<FormFieldType, string> = {
  shortText: 'Short text',
  longText: 'Paragraph',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  radio: 'Choose one',
  checkboxes: 'Choose any',
  consent: 'Agreement tickbox',
  heading: 'Section heading',
};

export function FormBuilder({
  form,
  onDone,
}: {
  /*
   * A draft, not a `FormDefinition`. The builder has no business with
   * `createdAt`, `updatedAt` or `updatedBy` — those are stamped on write and
   * read back in `writeForm` — and leaving them out of the type is what stops a
   * save from putting `null` in one of them.
   */
  form: WithId<FormDraft>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<WithId<FormDraft>>(form);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  function edit(patch: Partial<FormDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setDirty(true);
  }

  function editField(index: number, patch: Partial<FormField>) {
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field, position) =>
        position === index ? { ...field, ...patch } : field,
      ),
    }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { id, ...rest } = draft;
      await writeForm(id, rest);
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  }

  const problems = useMemo(() => lint(draft), [draft]);

  return (
    <div className="fxb">
      <div className="fxb__bar">
        <button type="button" className="button button--quiet" onClick={onDone}>
          <span aria-hidden="true">←</span> All forms
        </button>
        <span className="fxb__dirty">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <button
          type="button"
          className="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {problems.length > 0 && (
        /*
         * Warnings, not blockers. Saving stays possible with any of these
         * present, because a half-built form is a normal state to leave one in
         * — the builder should say what is wrong, not refuse to remember it.
         * `published` is the flag that decides whether anyone else sees it.
         */
        <div className="notice">
          <h2>Worth checking before you publish</h2>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="fxb__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!preview}
          className={preview ? 'bktabs__tab' : 'bktabs__tab is-on'}
          onClick={() => setPreview(false)}
        >
          Build
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={preview}
          className={preview ? 'bktabs__tab is-on' : 'bktabs__tab'}
          onClick={() => setPreview(true)}
        >
          Preview
        </button>
      </div>

      {preview ? <Preview form={draft} /> : (
        <>
          <Settings draft={draft} edit={edit} />
          {draft.kind === 'native' && (
            <FieldList
              draft={draft}
              editField={editField}
              setDraft={(fields) => {
                setDraft((previous) => ({ ...previous, fields }));
                setDirty(true);
              }}
            />
          )}
          {draft.kind === 'vehicle' && (
            <p className="note">
              The vehicle registration is built in code, not from fields — it has a
              repeating driver list and a fixed colour set that Taksis matches on.
              Its title, blurb and confirmation are editable above; its questions
              are not.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Settings({
  draft,
  edit,
}: {
  draft: FormDraft;
  edit: (patch: Partial<FormDraft>) => void;
}) {
  return (
    <div className="fxb__section">
      <h3>The form</h3>

      <label className="field">
        <span>Title</span>
        <input
          value={draft.title}
          onChange={(event) => {
            const title = event.target.value;
            /*
             * The slug follows the title only while it still matches it. Once
             * somebody edits the slug by hand it stops moving — a published
             * form's URL is on posters and in emails, and quietly rewriting it
             * because a typo in the title got fixed breaks every one of them.
             */
            const following = draft.slug === toFormSlug(draft.title);
            edit(following ? { title, slug: toFormSlug(title) } : { title });
          }}
        />
      </label>

      <label className="field">
        <span>Address</span>
        <input value={draft.slug} onChange={(event) => edit({ slug: toFormSlug(event.target.value) })} />
        <small>/forms/{draft.slug || '…'}</small>
      </label>

      <label className="field">
        <span>Blurb</span>
        <textarea rows={2} value={draft.blurb} onChange={(event) => edit({ blurb: event.target.value })} />
        <small>One or two sentences, shown on the card and above the form.</small>
      </label>

      <label className="field">
        <span>Picture</span>
        <select
          value={draft.image ?? ''}
          onChange={(event) => edit({ image: event.target.value || null })}
        >
          {PICTURES.map((picture) => (
            <option key={picture.label} value={picture.value ?? ''}>
              {picture.label}
            </option>
          ))}
        </select>
        <small>Shown on the card on /forms, and as a band above the form itself.</small>
      </label>

      {/*
        A live thumbnail, at the card's own 5:2 crop.

        Without it the picker is a list of words, and "Domes" is not something
        anyone can picture. Showing it at the aspect ratio the card actually
        uses also makes the one real failure mode visible before it ships: a tall
        image whose subject is cropped out entirely by a wide, short box.
      */}
      {draft.image && (
        <span className="fxb__thumb">
          <img src={draft.image} alt="" />
        </span>
      )}

      <div className="field-row">
        <label className="field">
          <span>Kind</span>
          {/*
            "Vehicle registration" is deliberately NOT offered here.

            `kind: 'vehicle'` is the switch that makes `formSubmit` push a
            submission into the Taksis project, and exactly one form is supposed
            to hold it. Leaving it in this dropdown meant any volunteer editing
            any form could point a second one at another organisation's
            database — and because the Taksis service account is create-only,
            nothing on our side could read back what it had written, so the
            mistake would be invisible from here.

            A form that already is one keeps its kind and shows it read-only
            below; every other form can only ever be `native` or `external`.
            Changing this is a code change, which is the right weight for it.
          */}
          {draft.kind === 'vehicle' ? (
            <>
              <input value="Vehicle registration" readOnly />
              <small>
                Writes to the Taksis parking system. Only this form does, and that
                cannot be changed here.
              </small>
            </>
          ) : (
            <select
              value={draft.kind}
              onChange={(event) => edit({ kind: event.target.value as FormDraft['kind'] })}
            >
              <option value="native">Built here</option>
              <option value="external">Links out (Breeze)</option>
            </select>
          )}
        </label>
        <label className="field field--narrow">
          <span>Order</span>
          <input
            type="number"
            value={draft.order}
            onChange={(event) => edit({ order: Number(event.target.value) || 0 })}
          />
        </label>
      </div>

      {draft.kind === 'external' && (
        <label className="field">
          <span>Link</span>
          <input
            type="url"
            value={draft.externalUrl ?? ''}
            placeholder="https://stphilopaterstmina.breezechms.com/form/…"
            onChange={(event) => edit({ externalUrl: event.target.value.trim() || null })}
          />
          <small>
            The card links straight here. Answers go to Breeze, not to the parish
            site — Breeze&apos;s API cannot accept a submission from us.
          </small>
        </label>
      )}

      <div className="field-row">
        <label className="field field--check">
          <input
            type="checkbox"
            checked={draft.published}
            onChange={(event) => edit({ published: event.target.checked })}
          />
          <span>Published</span>
        </label>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={draft.open}
            onChange={(event) => edit({ open: event.target.checked })}
          />
          <span>Accepting submissions</span>
        </label>
      </div>

      {!draft.open && (
        <label className="field">
          <span>What a closed form says</span>
          <input
            value={draft.closedMessage ?? ''}
            placeholder="Registration closed on 14 September."
            onChange={(event) => edit({ closedMessage: event.target.value || null })}
          />
          {/* Closed is not the same as unpublished, and the difference is what
              someone following an old link sees: a page that explains itself,
              rather than a 404. */}
          <small>The page still loads, and says this instead of the questions.</small>
        </label>
      )}

      <h3>After it is sent</h3>

      <label className="field">
        <span>Confirmation shown on screen</span>
        <textarea
          rows={2}
          value={draft.confirmationMessage}
          onChange={(event) => edit({ confirmationMessage: event.target.value })}
        />
      </label>

      <label className="field">
        <span>Confirmation email</span>
        <textarea
          rows={3}
          value={draft.confirmationEmailBody}
          placeholder="Leave empty to send nothing."
          onChange={(event) => edit({ confirmationEmailBody: event.target.value })}
        />
        <small>
          Sent only when the form asks for an email address. Leave empty for a form
          where a copy sitting in an inbox would be a privacy problem.
        </small>
      </label>

      <label className="field">
        <span>Tell these addresses</span>
        <input
          value={draft.notifyEmails.join(', ')}
          placeholder="office@…, deacon@…"
          onChange={(event) =>
            edit({
              notifyEmails: event.target.value
                .split(',')
                .map((entry) => entry.trim().toLowerCase())
                .filter((entry) => entry.includes('@')),
            })
          }
        />
        <small>Comma separated. Empty means nobody is emailed when one arrives.</small>
      </label>

      <h3>Payment</h3>

      <label className="field field--check">
        <input
          type="checkbox"
          checked={draft.payment.enabled}
          onChange={(event) => edit({ payment: { ...draft.payment, enabled: event.target.checked } })}
        />
        <span>This form takes a payment</span>
      </label>

      {draft.payment.enabled && (
        <>
          <div className="field-row">
            <label className="field">
              <span>Base fee</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={(draft.payment.baseCents / 100).toFixed(2)}
                onChange={(event) =>
                  edit({
                    payment: {
                      ...draft.payment,
                      baseCents: Math.round(Number(event.target.value) * 100) || 0,
                    },
                  })
                }
              />
              <small>Charged on any submission. Set 0 to charge only for chosen options.</small>
            </label>
            <label className="field">
              <span>Receipt says</span>
              <input
                value={draft.payment.label}
                placeholder={draft.title}
                onChange={(event) => edit({ payment: { ...draft.payment, label: event.target.value } })}
              />
            </label>
          </div>
          <p className="meta">
            Options and number fields can add to this — set their prices below. The
            total is worked out again on the server from this saved definition, so
            what a page displays can never change what a card is charged.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function FieldList({
  draft,
  editField,
  setDraft,
}: {
  draft: FormDraft;
  editField: (index: number, patch: Partial<FormField>) => void;
  setDraft: (fields: FormField[]) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function add(type: FormFieldType) {
    setDraft([...draft.fields, newField(type, draft.fields)]);
    setOpenIndex(draft.fields.length);
  }

  function move(index: number, by: number) {
    const next = [...draft.fields];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    setDraft(next);
    setOpenIndex(target);
  }

  return (
    <div className="fxb__section">
      <h3>Questions</h3>

      {draft.fields.length === 0 && <p className="note">No questions yet.</p>}

      <ol className="fxb__fields">
        {draft.fields.map((field, index) => (
          <li key={field.key} className="fxb__field">
            <div className="fxb__field-head">
              <button
                type="button"
                className="fxb__field-open"
                aria-expanded={openIndex === index}
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
              >
                <strong>{field.label || '(untitled)'}</strong>
                <span className="fxb__field-type">{TYPE_LABELS[field.type]}</span>
                {field.required && <span className="fxb__req">required</span>}
                {field.showWhen && <span className="fxb__cond">conditional</span>}
              </button>
              <span className="fxb__field-moves">
                <button type="button" onClick={() => move(index, -1)} aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(index, 1)} aria-label="Move down">↓</button>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => {
                    setDraft(draft.fields.filter((_, position) => position !== index));
                    setOpenIndex(null);
                  }}
                >
                  ×
                </button>
              </span>
            </div>

            {openIndex === index && (
              <FieldEditor
                field={field}
                earlier={draft.fields.slice(0, index)}
                paid={draft.payment.enabled}
                onChange={(patch) => editField(index, patch)}
              />
            )}
          </li>
        ))}
      </ol>

      {draft.fields.length < MAX_FIELDS && (
        <label className="field">
          <span>Add a question</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) add(event.target.value as FormFieldType);
            }}
          >
            <option value="">Choose a type…</option>
            {(Object.keys(TYPE_LABELS) as FormFieldType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function FieldEditor({
  field,
  earlier,
  paid,
  onChange,
}: {
  field: FormField;
  /** Only earlier fields may be conditioned on — see the note in `visibleFields`. */
  earlier: FormField[];
  paid: boolean;
  onChange: (patch: Partial<FormField>) => void;
}) {
  return (
    <div className="fxb__field-body">
      <label className="field">
        <span>Label</span>
        <input value={field.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>

      <label className="field">
        <span>Help text</span>
        <input
          value={field.help ?? ''}
          onChange={(event) => onChange({ help: event.target.value || null })}
        />
      </label>

      {!isDecorative(field.type) && (
        <label className="field field--check">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          <span>Required</span>
        </label>
      )}

      {field.type === 'number' && (
        <div className="field-row">
          <label className="field field--narrow">
            <span>Min</span>
            <input
              type="number"
              value={field.min ?? ''}
              onChange={(event) =>
                onChange({ min: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
          </label>
          <label className="field field--narrow">
            <span>Max</span>
            <input
              type="number"
              value={field.max ?? ''}
              onChange={(event) =>
                onChange({ max: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
          </label>
          {paid && (
            <label className="field field--narrow">
              <span>Price each</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={(field.unitPriceCents / 100).toFixed(2)}
                onChange={(event) =>
                  onChange({ unitPriceCents: Math.round(Number(event.target.value) * 100) || 0 })
                }
              />
            </label>
          )}
        </div>
      )}

      {isChoiceField(field.type) && (
        <OptionsEditor field={field} paid={paid} onChange={onChange} />
      )}

      <ConditionEditor field={field} earlier={earlier} onChange={onChange} />
    </div>
  );
}

function OptionsEditor({
  field,
  paid,
  onChange,
}: {
  field: FormField;
  paid: boolean;
  onChange: (patch: Partial<FormField>) => void;
}) {
  function setOption(index: number, patch: Partial<FormOption>) {
    onChange({
      options: field.options.map((option, position) =>
        position === index ? { ...option, ...patch } : option,
      ),
    });
  }

  return (
    <div className="fxb__options">
      <span className="fxb__label">Options</span>
      {field.options.map((option, index) => (
        <div className="fxb__option-row" key={index}>
          <input
            aria-label={`Option ${index + 1}`}
            value={option.label}
            onChange={(event) => {
              /*
               * The stored `value` follows the label only while it still
               * matches. Once answers exist, changing a value orphans every one
               * of them and silently breaks any condition pointing at it — so a
               * label edited after the fact renames what people read and leaves
               * what is stored alone.
               */
              const label = event.target.value;
              const following = option.value === toFormSlug(option.label);
              setOption(index, following ? { label, value: toFormSlug(label) || label } : { label });
            }}
          />
          {paid && (
            <input
              type="number"
              min={0}
              step="0.01"
              aria-label={`Price for ${option.label || `option ${index + 1}`}`}
              value={(option.priceCents / 100).toFixed(2)}
              onChange={(event) =>
                setOption(index, { priceCents: Math.round(Number(event.target.value) * 100) || 0 })
              }
            />
          )}
          <button
            type="button"
            aria-label={`Remove ${option.label || `option ${index + 1}`}`}
            onClick={() =>
              onChange({ options: field.options.filter((_, position) => position !== index) })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button--ghost"
        onClick={() =>
          onChange({
            options: [...field.options, { value: `option-${field.options.length + 1}`, label: '', priceCents: 0 }],
          })
        }
      >
        + Add option
      </button>
    </div>
  );
}

function ConditionEditor({
  field,
  earlier,
  onChange,
}: {
  field: FormField;
  earlier: FormField[];
  onChange: (patch: Partial<FormField>) => void;
}) {
  const condition = field.showWhen;
  /*
   * Only fields *above* this one are offered. `visibleFields` resolves in one
   * forward pass, so a condition pointing downwards would be evaluated against
   * an answer that has not been considered yet — it would appear to work in the
   * builder and behave unpredictably on the real form.
   */
  const candidates = earlier.filter((candidate) => !isDecorative(candidate.type));
  const target = candidates.find((candidate) => candidate.key === condition?.field);

  return (
    <div className="fxb__condition">
      <label className="field field--check">
        <input
          type="checkbox"
          checked={condition !== null}
          disabled={candidates.length === 0}
          onChange={(event) =>
            onChange({
              showWhen: event.target.checked
                ? { field: candidates[0]?.key ?? '', test: 'filled', value: '' }
                : null,
            })
          }
        />
        <span>
          Only show this when…
          {candidates.length === 0 && (
            <small> (needs a question above it)</small>
          )}
        </span>
      </label>

      {condition && (
        <div className="field-row">
          <label className="field">
            <span>Question</span>
            <select
              value={condition.field}
              onChange={(event) =>
                onChange({ showWhen: { ...condition, field: event.target.value, value: '' } })
              }
            >
              {candidates.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.label || candidate.key}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--narrow">
            <span>Test</span>
            <select
              value={condition.test}
              onChange={(event) =>
                onChange({
                  showWhen: { ...condition, test: event.target.value as FieldCondition['test'] },
                })
              }
            >
              <option value="filled">is answered</option>
              <option value="equals">is exactly</option>
              <option value="includes">includes</option>
            </select>
          </label>

          {condition.test !== 'filled' && (
            <label className="field">
              <span>Value</span>
              {/*
                A dropdown when the target has options, a text box otherwise.
                Typed values are the commonest way a condition silently never
                fires: the option stores `sunday-school` and someone types
                "Sunday School".
              */}
              {target && target.options.length > 0 ? (
                <select
                  value={condition.value}
                  onChange={(event) =>
                    onChange({ showWhen: { ...condition, value: event.target.value } })
                  }
                >
                  <option value="">Choose…</option>
                  {target.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label || option.value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={condition.value}
                  onChange={(event) =>
                    onChange({ showWhen: { ...condition, value: event.target.value } })
                  }
                />
              )}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The form as a parishioner would meet it, rendered through the real components.
 *
 * Interactive, because the thing worth checking is almost always a condition,
 * and a static rendering of a conditional form shows only the state it happens
 * to start in. Nothing here submits.
 */
function Preview({ form }: { form: FormDraft }) {
  const [answers, setAnswers] = useState<Record<string, never>>({});
  const shown = visibleFields(form.fields, answers);

  return (
    <div className="fxb__preview">
      <h3>{form.title}</h3>
      {form.blurb && <p className="note">{form.blurb}</p>}
      <div className="form fx">
        {shown.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={answers[field.key]}
            /* The preview never validates — it exists to check wording and
               conditions, and a preview that argues with the person building
               the form is noise. */
            error={null}
            onChange={(value) =>
              setAnswers((previous) => ({ ...previous, [field.key]: value as never }))
            }
          />
        ))}
      </div>
      <p className="meta">Preview only — nothing here is sent.</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/** A key that is stable, readable in the submissions table, and not already taken. */
function newField(type: FormFieldType, existing: FormField[]): FormField {
  const taken = new Set(existing.map((field) => field.key));
  // Annotated: without it TypeScript narrows `key` to the literal union of
  // `${type}-${number}` and the plain type, which is not assignable to string.
  let key: string = type;
  let n = 2;
  while (taken.has(key)) key = `${type}-${n++}`;

  return {
    key,
    type,
    label: '',
    help: null,
    placeholder: null,
    required: false,
    options: isChoiceField(type)
      ? [{ value: 'option-1', label: '', priceCents: 0 }]
      : [],
    showWhen: null,
    unitPriceCents: 0,
    min: null,
    max: null,
  };
}

/**
 * Things worth saying before this goes live.
 *
 * Warnings rather than errors — see the note where they are rendered. Each one
 * is a failure that is invisible on the built form: a condition that can never
 * fire looks exactly like a field somebody meant to hide.
 */
function lint(form: FormDraft): string[] {
  const problems: string[] = [];

  if (!form.slug) problems.push('The form has no address.');
  if (form.kind === 'external' && !form.externalUrl) {
    problems.push('This form links out, but has no link.');
  }
  if (form.kind === 'native' && form.fields.length === 0) {
    problems.push('There are no questions.');
  }

  const keys = new Map<string, number>();
  for (const field of form.fields) {
    keys.set(field.key, (keys.get(field.key) ?? 0) + 1);
    if (!field.label.trim()) problems.push(`A ${TYPE_LABELS[field.type].toLowerCase()} has no label.`);
    if (isChoiceField(field.type) && field.options.length === 0) {
      problems.push(`“${field.label || field.key}” has no options.`);
    }
    if (isChoiceField(field.type) && field.options.some((option) => !option.label.trim())) {
      problems.push(`“${field.label || field.key}” has an option with no label.`);
    }
  }
  for (const [key, count] of keys) {
    if (count > 1) problems.push(`Two questions share the key “${key}”.`);
  }

  // A condition whose value is not among the target's options can never be
  // true, so the field it guards is permanently invisible — and looks, in the
  // builder, exactly like one that works.
  for (const field of form.fields) {
    const condition = field.showWhen;
    if (!condition || condition.test === 'filled') continue;
    const target = form.fields.find((candidate) => candidate.key === condition.field);
    if (!target) {
      problems.push(`“${field.label || field.key}” depends on a question that is not here.`);
      continue;
    }
    if (target.options.length > 0 && !target.options.some((o) => o.value === condition.value)) {
      problems.push(
        `“${field.label || field.key}” will never show — “${condition.value}” is not one of “${
          target.label || target.key
        }”’s options.`,
      );
    }
  }

  if (form.payment.enabled) {
    const priced =
      form.payment.baseCents > 0 ||
      form.fields.some(
        (field) => field.unitPriceCents > 0 || field.options.some((option) => option.priceCents > 0),
      );
    if (!priced) problems.push('Payment is on, but nothing on the form costs anything.');
  }

  return problems;
}
