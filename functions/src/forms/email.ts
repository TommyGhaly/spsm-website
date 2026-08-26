import type { FormAnswers, FormDefinition } from '@spsm/shared';

/**
 * The two emails a submission can produce.
 *
 * A pure builder — strings and nothing else, no Firestore and no transport — so
 * the wording can be tested without an emulator and `formSubmit` stays
 * responsible for *when* a message is queued rather than what it says. Same
 * arrangement as `payments/orderEmail.ts`.
 *
 * The tone follows the rest of the site: state what is happening, plainly. No
 * thanking anyone three times, no exclamation marks.
 */

/** The shape the Trigger Email extension reads out of the `mail` collection. */
export interface MailDocument {
  to: string[];
  message: { subject: string; text: string; html: string };
}

export function buildFormEmails(input: {
  form: FormDefinition;
  answers: FormAnswers;
  submitter: { name: string | null; email: string | null; phone: string | null };
  totalCents: number;
  submissionId: string;
}): MailDocument[] {
  const { form, answers, submitter, totalCents } = input;
  const messages: MailDocument[] = [];

  const lines = readableAnswers(form, answers);

  /* ── To the parish ─────────────────────────────────────────────────────── */
  if (form.notifyEmails.length > 0) {
    const text = [
      `A ${form.title} was submitted.`,
      '',
      ...lines.map(([label, value]) => `${label}: ${value}`),
      ...(totalCents > 0 ? ['', `Paid: ${dollars(totalCents)}`] : []),
      '',
      // The reviewer's route back. Not a deep link to the submission — there is
      // no per-submission URL — but the drawer is two clicks from here.
      'Review it under Forms & submissions on the parish site.',
    ].join('\n');

    messages.push({
      to: [...form.notifyEmails],
      message: {
        // The submitter's name in the subject, because a mailbox full of
        // "New Events Request Form" tells whoever opens it nothing about which
        // one needs answering first.
        subject: submitter.name
          ? `${form.title} — ${submitter.name}`
          : `${form.title} — new submission`,
        text,
        html: paragraphs([
          `A <strong>${escapeHtml(form.title)}</strong> was submitted.`,
          table(lines),
          ...(totalCents > 0 ? [`Paid: ${dollars(totalCents)}`] : []),
        ]),
      },
    });
  }

  /* ── To the person who sent it ─────────────────────────────────────────── */
  /*
   * Only when there is both an address to send to and something to say.
   *
   * An empty `confirmationEmailBody` means no confirmation, and that is a
   * setting rather than an oversight: for some forms a copy of the answers
   * sitting in an inbox is a privacy problem rather than a courtesy.
   */
  if (submitter.email && form.confirmationEmailBody.trim()) {
    const body = form.confirmationEmailBody.trim();
    const text = [
      body,
      '',
      'What you sent:',
      ...lines.map(([label, value]) => `${label}: ${value}`),
      ...(totalCents > 0 ? ['', `Paid: ${dollars(totalCents)}`] : []),
    ].join('\n');

    messages.push({
      to: [submitter.email],
      message: {
        subject: form.title,
        text,
        html: paragraphs([
          escapeHtml(body).replace(/\n/g, '<br>'),
          '<strong>What you sent</strong>',
          table(lines),
          ...(totalCents > 0 ? [`Paid: ${dollars(totalCents)}`] : []),
        ]),
      },
    });
  }

  return messages;
}

/**
 * Answers as a person would read them.
 *
 * Two translations, both necessary. Keys become the question that was asked —
 * `service-2` means nothing to whoever opens the email. And option *values*
 * become option *labels*: a stored answer is `sunday-school`, because a value
 * has to survive its label being retyped, but nobody ever saw that string on the
 * form.
 */
function readableAnswers(form: FormDefinition, answers: FormAnswers): [string, string][] {
  const rows: [string, string][] = [];

  // Iterated in the form's own order rather than the object's, so the email
  // reads down the page the way the form does.
  for (const field of form.fields) {
    if (!Object.prototype.hasOwnProperty.call(answers, field.key)) continue;
    const answer = answers[field.key];
    if (answer === undefined) continue;

    const label = (value: string): string =>
      field.options.find((option) => option.value === value)?.label || value;

    const rendered = Array.isArray(answer)
      ? answer.map(label).join(', ')
      : typeof answer === 'boolean'
        ? answer
          ? 'Yes'
          : 'No'
        : typeof answer === 'number'
          ? String(answer)
          : label(answer);

    rows.push([field.label || field.key, rendered]);
  }

  return rows;
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}

/**
 * Escaped, always.
 *
 * Every value here was typed by a member of the public into a form, and it goes
 * into an HTML email read by parish staff. That is precisely the path where an
 * unescaped `<` becomes somebody else's problem.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphs(blocks: string[]): string {
  return blocks.map((block) => `<p>${block}</p>`).join('\n');
}

function table(rows: [string, string][]): string {
  // Inline styles, because email clients strip <style> blocks. A plain table
  // rather than anything clever: it has to survive Outlook.
  return [
    '<table cellpadding="6" cellspacing="0" border="0">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="color:#666;vertical-align:top">${escapeHtml(label)}</td>` +
        `<td><strong>${escapeHtml(value)}</strong></td></tr>`,
    ),
    '</table>',
  ].join('\n');
}
