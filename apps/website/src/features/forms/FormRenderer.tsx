'use client';

import { useMemo, useState } from 'react';
import {
  computeTotalCents,
  isDecorative,
  submissionAnswers,
  validateSubmission,
  visibleFields,
  type FormAnswer,
  type FormAnswers,
  type FormDefinition,
} from '@spsm/shared';
import { money } from '@/features/bookstore/money';
import { Icon } from '@/components/Icon';
import { FieldInput } from './FormFields';
import { submitForm } from './data';
import { FormPaymentStep } from './FormPaymentStep';

/**
 * A form definition, filled in and sent.
 *
 * ---------------------------------------------------------------------------
 * Answers are kept for hidden fields, and dropped on the way out.
 *
 * State holds every answer the person has ever given, including for fields that
 * a later change has hidden. `submissionAnswers` strips the hidden ones at the
 * boundary — nothing hidden is validated, priced, or stored.
 *
 * The alternative, deleting an answer the moment its field disappears, is worse
 * in the case that actually happens: someone picks Sunday School, fills in the
 * grade, wonders whether they meant Choir, looks, and switches back. Under the
 * delete rule their grade is gone and they have to notice it is gone. Here it
 * comes back.
 * ---------------------------------------------------------------------------
 */

type Stage =
  | { kind: 'filling' }
  | { kind: 'paying' }
  | { kind: 'sending' }
  | { kind: 'done'; paid: boolean };

export function FormRenderer({ form }: { form: FormDefinition }) {
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<string[]>([]);
  /** Keys that failed the last submit, so the controls themselves can be marked. */
  const [badKeys, setBadKeys] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>({ kind: 'filling' });

  const shown = useMemo(() => visibleFields(form.fields, answers), [form.fields, answers]);
  const total = useMemo(() => computeTotalCents(form, answers), [form, answers]);

  function set(key: string, value: FormAnswer) {
    setAnswers((previous) => ({ ...previous, [key]: value }));
    // Clear this field's error mark as soon as it is touched. Leaving it red
    // while someone is actively fixing it is the form arguing with them.
    setBadKeys((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }

  /** Validate, and either take a payment or send it straight off. */
  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateSubmission(form, answers);
    setErrors(found);
    if (found.length > 0) {
      setBadKeys(keysWithErrors(form, answers));
      // The summary is at the top and the page may be scrolled well past it.
      // Announcing errors somewhere nobody is looking is the same as not
      // announcing them.
      document.querySelector('.fx__errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBadKeys(new Set());

    if (total > 0) {
      setStage({ kind: 'paying' });
      return;
    }
    void send(null, null);
  }

  async function send(cardToken: string | null, verificationToken: string | null) {
    setStage({ kind: 'sending' });

    const result = await submitForm({
      slug: form.slug,
      answers: submissionAnswers(form.fields, answers),
      cardToken,
      verificationToken,
    });

    if (!result.ok) {
      setErrors(result.errors);
      // Back to the form, not back to the card. A rejected submission is
      // usually a validation disagreement, and the card step has nothing to
      // say about a missing phone number.
      setStage({ kind: 'filling' });
      return;
    }

    setStage({ kind: 'done', paid: result.paymentId !== null });
  }

  if (stage.kind === 'done') {
    return (
      /*
       * `role="status"` so the change is announced.
       *
       * The form is replaced wholesale by this panel, and for anyone not looking
       * at the screen that is silent — the page simply stops having the fields
       * they were filling in. Polite rather than assertive: nothing here is
       * urgent, it just needs to arrive.
       */
      <div className="fx__done" role="status">
        <span className="fx__done-mark" aria-hidden="true">
          <Icon name="check" size={26} />
        </span>
        <h2>Submitted</h2>
        <p>{form.confirmationMessage}</p>
        {stage.paid && (
          <p>Your card has been charged {money(total)}. Square will email you a receipt.</p>
        )}
      </div>
    );
  }

  if (stage.kind === 'paying') {
    return (
      <FormPaymentStep
        form={form}
        totalCents={total}
        onBack={() => setStage({ kind: 'filling' })}
        onToken={(cardToken, verificationToken) => void send(cardToken, verificationToken)}
      />
    );
  }

  return (
    <form className="form fx" onSubmit={onSubmit} noValidate>
      {errors.length > 0 && (
        <div className="notice notice--alarm fx__errors" role="alert">
          <h2>Please check the following</h2>
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {shown.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={answers[field.key]}
          invalid={badKeys.has(field.key)}
          onChange={(value) => set(field.key, value)}
        />
      ))}

      {form.payment.enabled && (
        /*
         * The running total sits directly above the button, not in a corner of
         * the page. It changes when a priced option is ticked, and a figure
         * that moves somewhere the reader is not looking is a figure they meet
         * for the first time on the card screen.
         *
         * Said out loud as well as shown: `aria-live` because the number
         * changing is the whole point, and `polite` so it waits for a gap
         * rather than interrupting someone mid-option.
         */
        <p className="fx__total" aria-live="polite">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </p>
      )}

      <button className="button" type="submit" disabled={stage.kind === 'sending'}>
        {stage.kind === 'sending'
          ? 'Sending…'
          : total > 0
            ? `Continue to payment — ${money(total)}`
            : 'Submit'}
      </button>

      {form.payment.enabled && total === 0 && (
        <p className="meta">
          Nothing to pay for the options chosen.
        </p>
      )}
    </form>
  );
}

/**
 * Which fields the error list is about.
 *
 * `validateSubmission` returns sentences for people, not keys for code — that is
 * the right shape for the summary and the wrong one for marking a control. Re-
 * running the check per field recovers the keys without the validator having to
 * return two parallel structures that could disagree.
 *
 * The solo copy has `showWhen` cleared. It has to: with one field in the list,
 * `visibleFields` resolves that field's condition against an empty answer set,
 * so every conditional field would look hidden and silently never be marked —
 * the exact fields most likely to be got wrong. Visibility was already decided
 * by the loop above; clearing the condition stops it being decided twice, badly.
 */
function keysWithErrors(form: FormDefinition, answers: FormAnswers): Set<string> {
  const bad = new Set<string>();

  for (const field of visibleFields(form.fields, answers)) {
    if (isDecorative(field.type)) continue;
    const solo = validateSubmission({ ...form, fields: [{ ...field, showWhen: null }] }, answers);
    if (solo.length > 0) bad.add(field.key);
  }

  return bad;
}
