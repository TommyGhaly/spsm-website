import {
  longDay,
  ordinationRankLabel,
  type Ordination,
  type OrdinationApplication,
  type OrdinationEmailKind,
} from '../schema/ordination.js';

/**
 * The wording of the ordination emails, as plain text.
 *
 * The received email is sent as written. The three decision emails are only
 * where the admin starts: the screen shows this text in an editable box and
 * nothing goes out until they press Send, so the parish can say it its own way
 * each time.
 */

type Nomination = Pick<OrdinationApplication, 'rank' | 'nominee'>;
type When = Pick<Ordination, 'date'>;

function firstName(application: Nomination): string {
  return application.nominee.name.trim().split(/\s+/)[0] || 'there';
}

function forWhat(application: Nomination, ordination: When): string {
  return `${ordinationRankLabel(application.rank)} at the ordination on ${longDay(ordination.date)}`;
}

export function ordinationReceivedEmail(
  application: Nomination,
  ordination: When,
): { subject: string; text: string } {
  return {
    subject: `Nomination received: ${application.nominee.name}`,
    text:
      `The parish has received the nomination of ${application.nominee.name} for ${forWhat(application, ordination)}.\n\n` +
      'The parish priests will review it and you will hear back by email once a decision is made. ' +
      'There is nothing else you need to do for now.\n\n' +
      'St. Philopater Mercurius & St. Mina Coptic Orthodox Church',
  };
}

export function ordinationDecisionEmail(
  kind: OrdinationEmailKind,
  application: Nomination,
  ordination: When,
  reason = '',
): { subject: string; text: string } {
  const hello = `Dear ${firstName(application)},\n\n`;
  const sign = '\n\nIn Christ,\nThe parish priests';
  const what = forWhat(application, ordination);

  if (kind === 'approved') {
    return {
      subject: `Nomination approved: ${application.nominee.name}`,
      text:
        hello +
        `The nomination of ${application.nominee.name} for ${what} has been approved.\n\n` +
        'The parish will send the signed form to the diocese. We will be in touch with the details of the day.' +
        sign,
    };
  }

  if (kind === 'needsFather') {
    return {
      subject: `Nomination: your father of confession needs to sign`,
      text:
        hello +
        `Thank you for the nomination of ${application.nominee.name} for ${what}.\n\n` +
        `Because ${application.nominee.fatherOfConfession || 'the nominee’s father of confession'} is not one of the parish priests, ` +
        'the nomination cannot be approved online. The form is attached: please print it, ask your father of confession to sign it, ' +
        `and return it to the church before ${longDay(ordination.date)}.` +
        sign,
    };
  }

  return {
    subject: `Nomination: ${application.nominee.name}`,
    text:
      hello +
      `Thank you for the nomination of ${application.nominee.name} for ${what}. ` +
      'After review, the parish is not able to put it forward this time.' +
      (reason.trim() ? `\n\n${reason.trim()}` : '') +
      sign,
  };
}

/** Plain text into the HTML part: escaped, paragraphs kept. */
export function ordinationEmailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
