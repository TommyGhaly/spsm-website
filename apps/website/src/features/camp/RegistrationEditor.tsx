'use client';

import { useMemo, useRef, useState } from 'react';
import {
  CAMP_GRADES,
  CAMP_PAYMENT_METHODS,
  MAX_CHILDREN,
  SHIRT_SIZES,
  blankChild,
  campAge,
  campBill,
  campGradeLabel,
  campLineId,
  campPaymentMethodLabel,
  clearDesiredRolesForSection,
  shirtSizeLabel,
  validateCampRegistration,
  type CampChild,
  type CampConfig,
  type CampDiscount,
  type CampPaymentRecord,
  type CampRegistrationDraft,
} from '@spsm/shared';
import { DayGrid } from './DayGrid';
import { deleteRegistration, writeRegistration } from './data';

/**
 * One registration, top to bottom.
 *
 * ---------------------------------------------------------------------------
 * A page, not a drawer, and one form rather than a stack of panels.
 *
 * Both halves of that were decided the hard way. The drawer went first — *"I
 * don't want the form to be on the side I want it to be like any other form"* —
 * because a drawer is for *reviewing* what the page behind it shows, and this
 * is a form somebody fills in with a parent standing at the desk. The panels
 * went in the rebuild: the old editor had the billing behind its own toggle and
 * the waiver behind another, so taking a registration meant finding three
 * screens, and the one most often forgotten was the one that takes the money.
 *
 * What is on screen is what has to be answered, in the order it is asked at a
 * desk: who they are, who to ring, the children, what they agreed to, what they
 * owe. Nothing folds. See [[spsm-no-accordions-open-the-page]].
 *
 * ## Saving
 *
 * One Save button, deliberately unlike the settings page next door. A
 * registration is a single record filled in over several minutes and a
 * half-typed phone number written to Firestore on every keystroke is a record
 * that is wrong more often than it is right. `status` is the exception a camp
 * needs — a draft can be saved with almost nothing in it, and only publishing
 * it as `registered` runs the full check. That was a deliberate loosening; see
 * [[spsm-draft-needs-only-name-and-day]].
 * ---------------------------------------------------------------------------
 */

export interface RegistrationEditorProps {
  id: string;
  draft: CampRegistrationDraft;
  config: CampConfig;
  uid: string | null;
  /**
   * True when the fees ledger may be shown — `finance` narrowed to `camp`.
   *
   * False is the registrar: they get one control for recording a payment as it
   * is handed over, and no totals, no balance, no discounts and no history. See
   * `Billing` below, and `canSeeMoney` on `useCampAdmin` for why this is a
   * preference in a browser rather than a rule.
   */
  canSeeMoney: boolean;
  /** True when this document has never been written. Changes the delete copy. */
  isNew: boolean;
  onDone: () => void;
}

export function RegistrationEditor({
  id,
  draft: initial,
  config,
  uid,
  canSeeMoney,
  isNew,
  onDone,
}: RegistrationEditorProps) {
  const [draft, setDraft] = useState<CampRegistrationDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<CampRegistrationDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  const bill = useMemo(() => campBill(draft), [draft]);

  /*
   * Checked as you type, shown only against Save.
   *
   * Running the validator live and drawing its output live are two different
   * decisions: a form that turns red while somebody is halfway through typing a
   * name is a form that is shouting at them for not having finished. The list
   * appears when they press the button, and then updates as they fix it.
   */
  /*
   * What is still missing, said and never enforced.
   *
   * ---------------------------------------------------------------------------
   * This used to gate the save: a registration that was not a `draft` could not
   * be written until every problem was fixed, and the way out was to put the
   * status back to **Draft**. Two states, a picker to move between them, a badge
   * on every row, and a save that sometimes silently did nothing — all to
   * express "this form is not finished yet", which the list of problems already
   * says perfectly well.
   *
   * So the list stays and the gate goes. A registrar at a desk types a name and
   * a phone number, presses Save, and it saves; the panel underneath says what
   * the camp still needs from them. Nothing about a half-filled registration is
   * dangerous — it is on no register until somebody puts them in a group, and
   * the allocation board already draws "no days" and "no grade" loudly.
   * ---------------------------------------------------------------------------
   */
  const problems = useMemo(
    () => validateCampRegistration(draft, { waiverInForce: config.waiverText.trim().length > 0 }),
    [draft, config.waiverText],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await writeRegistration(id, draft, uid);
      onDone();
    } catch (cause) {
      setError((cause as Error)?.message ?? 'The save did not go through.');
      setSaving(false);
    }
  }

  async function remove() {
    const who = draft.contact.name.trim() || 'this registration';
    if (
      !window.confirm(
        `Delete ${who}? This is for a row typed twice by mistake. A family that pulled ` +
          `out should be marked Withdrawn instead — they may have paid, and the camp has ` +
          `to be able to answer for it in six months.`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await deleteRegistration(id);
      onDone();
    } catch (cause) {
      setError((cause as Error)?.message ?? 'The delete did not go through.');
      setSaving(false);
    }
  }

  /*
   * Always true now, and kept as a name rather than removed.
   *
   * A servant's registration is read, never edited — `RegistrationsScreen`
   * sends those to `ServantSheet` — so the servant half of this form is gone
   * and this editor only ever sees a family. The flag stays because the labels
   * that read it ("Parent or guardian", "The family") would otherwise be
   * asserting the same thing in prose, and because deleting it would hide from
   * the next reader that this file used to do both.
   */
  const family = draft.kind === 'family';

  return (
    <div className="camp-editor">
      <header className="camp-editor__head">
        <div>
          <button type="button" className="camp-back" onClick={onDone}>
            ← All registrations
          </button>
          <h2>{draft.contact.name.trim() || (family ? 'New family' : 'New servant')}</h2>
        </div>
        <div className="camp-editor__headActions">
          {/*
            One switch, not a four-value picker.
            ------------------------------------------------------------------
            `draft` and `waitlisted` are gone — see `CAMP_STATUSES`. What is
            left is the only one that ever meant anything: they pulled out. It
            is a switch rather than a delete because a withdrawn family may have
            paid, and the camp has to be able to answer for it in six months.
          */}
          <label className="camp-tick camp-tick--tight">
            <input
              type="checkbox"
              checked={draft.status === 'withdrawn'}
              onChange={(event) =>
                edit({ status: event.target.checked ? 'withdrawn' : 'registered' })
              }
            />
            <span>{family ? 'Withdrawn from camp' : 'No longer serving'}</span>
          </label>
          <button type="button" className="button" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {error ? <p className="camp-settings__error">{error}</p> : null}

      {problems.length > 0 ? (
        <div className="camp-problems">
          <h3>Still to come from them</h3>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="note">
            None of this stops you saving. It is what the camp still needs before they turn up.
          </p>
        </div>
      ) : null}

      <Section title={family ? 'The family' : 'The servant'}>
        <div className="camp-grid">
          <Text
            label={family ? 'Parent or guardian' : 'Name'}
            value={draft.contact.name}
            onChange={(name) => edit({ contact: { ...draft.contact, name } })}
          />
          <Text
            label="Phone"
            type="tel"
            value={draft.contact.phone}
            onChange={(phone) => edit({ contact: { ...draft.contact, phone } })}
          />
          <Text
            label="Email"
            type="email"
            value={draft.contact.email}
            onChange={(email) => edit({ contact: { ...draft.contact, email } })}
          />
          {family ? (
            <>
              <Text
                label="Second parent (optional)"
                value={draft.contact.altName}
                onChange={(altName) => edit({ contact: { ...draft.contact, altName } })}
              />
              <Text
                label="Their phone (optional)"
                type="tel"
                value={draft.contact.altPhone}
                onChange={(altPhone) => edit({ contact: { ...draft.contact, altPhone } })}
              />
            </>
          ) : null}
        </div>
        <Text
          label="Address"
          multiline
          value={draft.contact.address}
          onChange={(address) => edit({ contact: { ...draft.contact, address } })}
        />
      </Section>

      <Section
        title="If something happens"
        hint="Somebody other than the parent standing here, ideally."
      >
        <div className="camp-grid">
          <Text
            label="Emergency contact"
            value={draft.emergency.name}
            onChange={(name) => edit({ emergency: { ...draft.emergency, name } })}
          />
          <Text
            label="Their phone"
            type="tel"
            value={draft.emergency.phone}
            onChange={(phone) => edit({ emergency: { ...draft.emergency, phone } })}
          />
          <Text
            label="Relationship"
            value={draft.emergency.relationship}
            onChange={(relationship) => edit({ emergency: { ...draft.emergency, relationship } })}
          />
        </div>
      </Section>

      {family ? (
        <Section
          title="Children"
          hint="The grade they are entering in September, not the one they have just finished."
        >
          {draft.children.map((child, index) => (
            <ChildCard
              key={child.id}
              child={child}
              index={index}
              config={config}
              canRemove={draft.children.length > 1}
              onChange={(next) =>
                edit({
                  children: draft.children.map((entry) => (entry.id === child.id ? next : entry)),
                })
              }
              onRemove={() =>
                edit({ children: draft.children.filter((entry) => entry.id !== child.id) })
              }
            />
          ))}
          {draft.children.length < MAX_CHILDREN ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => edit({ children: [...draft.children, blankChild()] })}
            >
              Add another child
            </button>
          ) : (
            <p className="note">
              That is {MAX_CHILDREN} children — the most one registration holds. Start a second
              one for the rest.
            </p>
          )}
        </Section>
      ) : null}

      <Section title="Waiver">
        {config.waiverText.trim() ? (
          <>
            <div className="camp-waiver">
              {config.waiverText.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <label className="camp-tick">
              <input
                type="checkbox"
                checked={draft.waiver.agreed}
                onChange={(event) =>
                  edit({
                    waiver: {
                      ...draft.waiver,
                      agreed: event.target.checked,
                      // The version in force at the moment of agreeing, so what
                      // was signed in June stays legible after September's edit.
                      version: event.target.checked ? config.waiverVersion : '',
                      signedAt: event.target.checked ? new Date() : null,
                      signedByUid: event.target.checked ? draft.takenByUid : null,
                    },
                  })
                }
              />
              <span>They have read this and agree to it.</span>
            </label>
            <div className="camp-grid">
              <Text
                label="Typed name"
                value={draft.waiver.signedName}
                onChange={(signedName) => edit({ waiver: { ...draft.waiver, signedName } })}
              />
              <Text
                label="Their relationship to the child"
                value={draft.waiver.signedRelationship}
                onChange={(signedRelationship) =>
                  edit({ waiver: { ...draft.waiver, signedRelationship } })
                }
              />
            </div>
          </>
        ) : (
          <p className="note">
            The camp has no waiver text yet, so nothing is being agreed to. Add it in the
            settings on <a href="/admin/camp">the camp screen</a> and it will appear here.
          </p>
        )}
      </Section>

      {family ? (
        <Billing
          draft={draft}
          onChange={edit}
          uid={uid}
          bill={bill}
          canSeeMoney={canSeeMoney}
        />
      ) : null}

      <Section title="Anything else" hint="Only the camp sees this.">
        <Text
          label="Note"
          multiline
          value={draft.note}
          onChange={(note) => edit({ note })}
        />
      </Section>

      <footer className="camp-editor__foot">
        <button type="button" className="button" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button button--quiet" onClick={onDone}>
          Cancel
        </button>
        {!isNew ? (
          <button
            type="button"
            className="camp-danger"
            disabled={saving}
            onClick={() => void remove()}
          >
            Delete
          </button>
        ) : null}
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Children
 * ------------------------------------------------------------------------ */

function ChildCard({
  child,
  index,
  config,
  canRemove,
  onChange,
  onRemove,
}: {
  child: CampChild;
  index: number;
  config: CampConfig;
  canRemove: boolean;
  onChange: (child: CampChild) => void;
  onRemove: () => void;
}) {
  const age = campAge(child.dateOfBirth);

  return (
    <article className="camp-child">
      <header className="camp-child__head">
        <h4>{[child.firstName, child.lastName].filter(Boolean).join(' ') || `Child ${index + 1}`}</h4>
        {canRemove ? (
          <button type="button" className="camp-danger camp-danger--small" onClick={onRemove}>
            Remove
          </button>
        ) : null}
        {child.groupName ? <span className="camp-chip">{child.groupName}</span> : null}
      </header>

      <div className="camp-grid">
        <Text
          label="First name"
          value={child.firstName}
          onChange={(firstName) => onChange({ ...child, firstName })}
        />
        <Text
          label="Last name"
          value={child.lastName}
          onChange={(lastName) => onChange({ ...child, lastName })}
        />
        <label className="camp-field">
          <span className="camp-field__label">Date of birth</span>
          <input
            type="date"
            className="input"
            value={child.dateOfBirth}
            onChange={(event) => onChange({ ...child, dateOfBirth: event.target.value })}
          />
          <span className="camp-field__hint">{age === null ? 'Optional' : `${age} years old`}</span>
        </label>
        <label className="camp-field">
          <span className="camp-field__label">Grade entering</span>
          <select
            className="input"
            value={child.grade}
            onChange={(event) => onChange({ ...child, grade: event.target.value as CampChild['grade'] })}
          >
            {CAMP_GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {campGradeLabel(grade)}
              </option>
            ))}
          </select>
        </label>
        <label className="camp-field">
          <span className="camp-field__label">Shirt</span>
          <select
            className="input"
            value={child.shirtSize}
            onChange={(event) =>
              onChange({ ...child, shirtSize: event.target.value as CampChild['shirtSize'] })
            }
          >
            {SHIRT_SIZES.map((size) => (
              <option key={size} value={size}>
                {shirtSizeLabel(size)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DayGrid
        label={`Which days ${child.firstName || 'this child'} is coming`}
        weeks={config.weeks}
        weekStarts={config.weekStarts}
        days={child.days}
        onChange={(days) => onChange({ ...child, days })}
      />

      <div className="camp-grid">
        <Text
          label="Allergies"
          multiline
          value={child.allergies}
          onChange={(allergies) => onChange({ ...child, allergies })}
        />
        <Text
          label="Anything medical the camp should know"
          multiline
          value={child.medicalNotes}
          onChange={(medicalNotes) => onChange({ ...child, medicalNotes })}
        />
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------------------
 * Money
 * ------------------------------------------------------------------------ */

/**
 * What they owe, what has come in, and what is left — or, for a registrar, one
 * box for taking a payment.
 *
 * ---------------------------------------------------------------------------
 * The fee is **per child per week**, and the itemised lines are here because
 * this is read aloud to somebody standing at a desk: "two children, three weeks
 * between them, $525" invites the question a single total cannot answer.
 *
 * A payment is recorded as it arrives, in cash or by check or through Zelle,
 * and none of it goes through Square — see the camp's decisions. A refund is a
 * negative payment rather than a deletion, so a family who paid and pulled out
 * reads as a family who paid and was refunded.
 *
 * ## Two versions of this section, and the split is deliberate
 *
 * The camp's money is the treasurer's, not the camp's: it is read on
 * /admin/finance, under `finance` narrowed to `camp`, and *this* screen is a
 * camp screen. But a registration is taken at a desk with a family standing at
 * it holding a check, and a camp that cannot write that down is a camp with a
 * shoebox of checks nobody reconciles. So the two grants divide by verb rather
 * than by area — **the camp records, finance corrects**:
 *
 *   `camp` alone      the payment box, and the lines it has just added
 *   with `finance`    the charges, the balance, the discounts, the history
 *
 * A payment typed here can be taken back until the registration is saved,
 * because that is fixing a typo rather than editing a ledger. After the save it
 * belongs to whoever holds the money, and this screen offers no way at it.
 *
 * What this is not is a wall. `billing` is a field on a document the `camp`
 * flag opens, so anybody on this screen could read the ledger with a console;
 * rules grant documents and not fields, which is the whole reason
 * `financeRollups` exists. This decides what the screen shows, and the note on
 * `canSeeMoney` in ./useCampAdmin.ts is where that is spelled out.
 * ---------------------------------------------------------------------------
 */
function Billing({
  draft,
  onChange,
  uid,
  bill,
  canSeeMoney,
}: {
  draft: CampRegistrationDraft;
  onChange: (patch: Partial<CampRegistrationDraft>) => void;
  uid: string | null;
  bill: ReturnType<typeof campBill>;
  canSeeMoney: boolean;
}) {
  const { billing } = draft;

  /*
   * Which payments were already on the record when this editor opened.
   *
   * A registrar sees only what they have added since — with no history and no
   * total, a payment box that swallows a number and shows nothing is a box
   * somebody types into twice. A ref rather than state because it is answered
   * once per opened registration and must not follow the draft.
   */
  const openedWith = useRef<Set<string>>(new Set(billing.payments.map((entry) => entry.id)));
  const justAdded = billing.payments.filter((entry) => !openedWith.current.has(entry.id));

  if (!canSeeMoney) {
    return (
      <Section
        title="Payment"
        hint="Recorded here, reconciled by whoever keeps the church's books."
      >
        <p className="note">
          What this family has been charged and what they still owe is on{' '}
          <a href="/admin/finance">the finance screen</a>, which is a separate permission.
          Write down what is handed over and it will reach the treasurer.
        </p>

        {justAdded.length > 0 && (
          <>
            <h4>Taken just now</h4>
            <table className="camp-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>How</th>
                  <th>Reference</th>
                  <th className="camp-table__num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {justAdded.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.receivedOn || '—'}</td>
                    <td>{campPaymentMethodLabel(payment.method)}</td>
                    <td>{payment.reference || '—'}</td>
                    <td className="camp-table__num">{money(payment.amountCents)}</td>
                    <td>
                      {/* Only what has not been saved yet — a typo, not history. */}
                      <button
                        type="button"
                        className="camp-danger camp-danger--small"
                        onClick={() =>
                          onChange({
                            billing: {
                              ...billing,
                              payments: billing.payments.filter(
                                (entry) => entry.id !== payment.id,
                              ),
                            },
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              Nothing is recorded until this registration is saved.
            </p>
          </>
        )}

        <AddPayment
          onAdd={(payment) =>
            onChange({ billing: { ...billing, payments: [...billing.payments, payment] } })
          }
          uid={uid}
        />
      </Section>
    );
  }

  return (
    <Section title="Money">
      {bill.lines.length === 0 ? (
        <p className="note">Nothing to charge yet — no child has any days chosen.</p>
      ) : (
        <table className="camp-table">
          <thead>
            <tr>
              <th>Child</th>
              <th>Weeks</th>
              <th className="camp-table__num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((line) => (
              <tr key={line.childId}>
                <td>{line.name || 'Unnamed child'}</td>
                <td>{line.weeks}</td>
                <td className="camp-table__num">{money(line.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ul className="camp-ledger">
        <li>
          <span>Subtotal</span>
          <strong>{money(bill.subtotalCents)}</strong>
        </li>
        {billing.discounts.map((discount) => (
          <li key={discount.id} className="camp-ledger__line">
            <span>
              {discount.reason || 'Discount'}{' '}
              <em>{discount.kind === 'percent' ? `${discount.value}%` : money(discount.value)}</em>
            </span>
            <button
              type="button"
              className="camp-danger camp-danger--small"
              onClick={() =>
                onChange({
                  billing: {
                    ...billing,
                    discounts: billing.discounts.filter((entry) => entry.id !== discount.id),
                  },
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
        <li>
          <span>Due</span>
          <strong>{money(bill.dueCents)}</strong>
        </li>
        <li>
          <span>Paid</span>
          <strong>{money(bill.paidCents)}</strong>
        </li>
        <li className={bill.balanceCents > 0 ? 'camp-ledger__owing' : 'camp-ledger__clear'}>
          <span>{bill.balanceCents < 0 ? 'Overpaid by' : 'Balance'}</span>
          <strong>{money(Math.abs(bill.balanceCents))}</strong>
        </li>
      </ul>

      <AddDiscount
        onAdd={(discount) =>
          onChange({ billing: { ...billing, discounts: [...billing.discounts, discount] } })
        }
        uid={uid}
      />

      <h4>Payments</h4>
      {billing.payments.length === 0 ? (
        <p className="note">Nothing recorded yet.</p>
      ) : (
        <table className="camp-table">
          <thead>
            <tr>
              <th>When</th>
              <th>How</th>
              <th>Reference</th>
              <th className="camp-table__num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {billing.payments.map((payment) => (
              <tr key={payment.id}>
                <td>{payment.receivedOn || '—'}</td>
                <td>{campPaymentMethodLabel(payment.method)}</td>
                <td>{payment.reference || '—'}</td>
                <td className="camp-table__num">{money(payment.amountCents)}</td>
                <td>
                  <button
                    type="button"
                    className="camp-danger camp-danger--small"
                    onClick={() =>
                      onChange({
                        billing: {
                          ...billing,
                          payments: billing.payments.filter((entry) => entry.id !== payment.id),
                        },
                      })
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddPayment
        onAdd={(payment) =>
          onChange({ billing: { ...billing, payments: [...billing.payments, payment] } })
        }
        uid={uid}
      />
    </Section>
  );
}

function AddDiscount({
  onAdd,
  uid,
}: {
  onAdd: (discount: CampDiscount) => void;
  uid: string | null;
}) {
  const [kind, setKind] = useState<'amount' | 'percent'>('amount');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="camp-add">
      <select
        className="input input--narrow"
        value={kind}
        aria-label="Kind of discount"
        onChange={(event) => setKind(event.target.value as 'amount' | 'percent')}
      >
        <option value="amount">Take off $</option>
        <option value="percent">Take off %</option>
      </select>
      <input
        className="input input--narrow"
        inputMode="decimal"
        value={value}
        placeholder={kind === 'percent' ? '10' : '25.00'}
        aria-label="How much"
        onChange={(event) => setValue(event.target.value)}
      />
      <input
        className="input"
        value={reason}
        placeholder="Why — third child, hardship, staff family"
        aria-label="Reason"
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          const parsed = Number(value.replace(/[$,%]/g, ''));
          if (!Number.isFinite(parsed) || parsed <= 0) return;
          onAdd({
            id: campLineId('discount'),
            kind,
            value: kind === 'percent' ? Math.round(parsed) : Math.round(parsed * 100),
            reason: reason.trim(),
            childId: null,
            appliedByUid: uid,
            appliedAt: new Date(),
          });
          setValue('');
          setReason('');
        }}
      >
        Add discount
      </button>
    </div>
  );
}

function AddPayment({
  onAdd,
  uid,
}: {
  onAdd: (payment: CampPaymentRecord) => void;
  uid: string | null;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CampPaymentRecord['method']>('cash');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="camp-add">
      <input
        className="input input--narrow"
        inputMode="decimal"
        value={amount}
        placeholder="150.00"
        aria-label="Amount"
        onChange={(event) => setAmount(event.target.value)}
      />
      <select
        className="input input--narrow"
        value={method}
        aria-label="How it was paid"
        onChange={(event) => setMethod(event.target.value as CampPaymentRecord['method'])}
      >
        {CAMP_PAYMENT_METHODS.map((entry) => (
          <option key={entry} value={entry}>
            {campPaymentMethodLabel(entry)}
          </option>
        ))}
      </select>
      <input
        type="date"
        className="input input--narrow"
        value={receivedOn}
        aria-label="When it came in"
        onChange={(event) => setReceivedOn(event.target.value)}
      />
      <input
        className="input"
        value={reference}
        placeholder="Check number, or who sent the Zelle"
        aria-label="Reference"
        onChange={(event) => setReference(event.target.value)}
      />
      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          // Negative is allowed and is how a refund is recorded — see the note
          // on `signedCents`. Zero is not a payment.
          const parsed = Number(amount.replace(/[$,]/g, ''));
          if (!Number.isFinite(parsed) || parsed === 0) return;
          onAdd({
            id: campLineId('payment'),
            amountCents: Math.round(parsed * 100),
            method,
            reference: reference.trim(),
            receivedOn,
            note: '',
            recordedByUid: uid,
            recordedAt: new Date(),
          });
          setAmount('');
          setReference('');
        }}
      >
        Record payment
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Small parts
 * ------------------------------------------------------------------------ */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="camp-section">
      <h3>{title}</h3>
      {hint ? <p className="note">{hint}</p> : null}
      {children}
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  type,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <label className="camp-field">
      <span className="camp-field__label">{label}</span>
      {multiline ? (
        <textarea
          className="input"
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="input"
          type={type ?? 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <span className="camp-field__hint">{hint}</span> : null}
    </label>
  );
}

export function statusLabel(status: CampRegistrationDraft['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'registered':
      return 'Registered';
    case 'waitlisted':
      return 'Waiting list';
    default:
      return 'Withdrawn';
  }
}

export function money(cents: number): string {
  return `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
