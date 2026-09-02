'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeTotalCents,
  submissionAnswers,
  validateSubmission,
  validateSubmissionFields,
  visibleFields,
  type FieldProblem,
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

/**
 * @param initialAnswers Answers the form opens with, rather than an empty set.
 *   Read once, on mount — a later change does not reach back into a form
 *   somebody has started filling in, which is the only safe reading of it: the
 *   one caller passes a subject lifted from the URL, and a form that reset a
 *   half-typed message because the address bar changed would be a bug nobody
 *   would find twice. Unknown keys are harmless; `submissionAnswers` drops
 *   anything not on a visible field on the way out.
 */
export function FormRenderer({
  form,
  initialAnswers,
}: {
  form: FormDefinition;
  initialAnswers?: FormAnswers;
}) {
  const [answers, setAnswers] = useState<FormAnswers>(() => ({ ...initialAnswers }));
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [stage, setStage] = useState<Stage>({ kind: 'filling' });
  /** The summary, so focus can be moved to it after a failed submit. */
  const summary = useRef<HTMLDivElement>(null);
  /**
   * Bumped on each rejected submit, and the only thing that moves focus.
   *
   * A counter rather than "problems is non-empty", because problems also appear
   * on blur — and a form that yanks focus to the top of the page every time you
   * tab out of an empty box is unusable. Only a submit steals focus, and a
   * second identical submit still bumps the count, so the summary is re-focused
   * rather than silently ignored.
   */
  const [rejectedAt, setRejectedAt] = useState(0);

  useEffect(() => {
    /*
     * In an effect, not in the submit handler.
     *
     * The handler runs before React has rendered the summary, so focusing there
     * finds nothing. The first attempt deferred with `requestAnimationFrame`,
     * which is worse than it looks: it works in a browser and never fires in a
     * hidden or backgrounded document, so the focus move silently does not
     * happen in exactly the cases where it is hardest to notice. An effect runs
     * after commit, always.
     */
    if (rejectedAt > 0) summary.current?.focus();
  }, [rejectedAt]);

  /** Message per field key, for the inline errors. */
  const messages = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const problem of problems) {
      if (problem.key && !byKey.has(problem.key)) byKey.set(problem.key, problem.message);
    }
    return byKey;
  }, [problems]);

  const shown = useMemo(() => visibleFields(form.fields, answers), [form.fields, answers]);
  const total = useMemo(() => computeTotalCents(form, answers), [form, answers]);

  function set(key: string, value: FormAnswer) {
    setAnswers((previous) => ({ ...previous, [key]: value }));
    // Clear this field's error the moment it is touched. Leaving it red while
    // someone is actively fixing it is the form arguing with them.
    setProblems((previous) =>
      previous.some((problem) => problem.key === key)
        ? previous.filter((problem) => problem.key !== key)
        : previous,
    );
  }

  /**
   * Check one field when the person leaves it.
   *
   * On blur rather than on every keystroke: validating as someone types tells
   * them their email is invalid when they have got as far as "m@", which is
   * true and useless. This only ever *adds* a problem for the field being left
   * — it cannot clear another field's error or introduce one for a box the
   * person has not reached yet.
   */
  function checkOne(key: string) {
    const found = validateSubmissionFields(form, answers).filter(
      (problem) => problem.key === key,
    );
    setProblems((previous) => [...previous.filter((problem) => problem.key !== key), ...found]);
  }

  /** Validate, and either take a payment or send it straight off. */
  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateSubmissionFields(form, answers);
    setProblems(found);
    if (found.length > 0) {
      /*
       * Move focus to the summary, not just scroll to it.
       *
       * Scrolling helps whoever is looking at the page and nobody else: a
       * keyboard or screen-reader user is left wherever they pressed submit,
       * with the announcement happening somewhere they are not. Focusing the
       * container both scrolls it into view and puts the caret at the top of
       * the list, so the next Tab walks into the first broken field.
       */
      setRejectedAt((n) => n + 1);
      return;
    }

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
      /*
       * The server's objections have no field keys — it answers with sentences,
       * because a key means nothing to a page that may have been edited since.
       * They go in the summary unattached, which is right: these are usually
       * about the submission as a whole rather than about one box.
       */
      setProblems(result.errors.map((message) => ({ key: null, message })));
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
      {problems.length > 0 && (
        /*
         * A summary that is reachable, announced, and linked.
         *
         * `tabIndex={-1}` makes it focusable by script without putting it in the
         * tab order; `role="alert"` announces it when it appears. Each item that
         * belongs to a field is an anchor to that field, so the list is a way to
         * get to the problem rather than a description of it — which is the
         * difference between a summary that helps on a sixteen-question form and
         * one that makes you hunt.
         */
        <div
          className="notice notice--alarm fx__errors"
          role="alert"
          tabIndex={-1}
          ref={summary}
          aria-labelledby="fx-errors-title"
        >
          <h2 id="fx-errors-title">Please check the following</h2>
          <ul>
            {problems.map((problem) => (
              <li key={`${problem.key ?? ''}:${problem.message}`}>
                {problem.key ? (
                  <a href={`#f-${problem.key}`}>{problem.message}</a>
                ) : (
                  problem.message
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {shown.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={answers[field.key]}
          error={messages.get(field.key) ?? null}
          onChange={(value) => set(field.key, value)}
          onBlur={() => checkOne(field.key)}
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
