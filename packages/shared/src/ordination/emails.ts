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
      subject: `Ordination approved: ${application.nominee.name}`,
      text:
        'Hello, your ordination application has been reviewed by the priests and the deacons and you have been approved.\n\n' +
        'Please review the requirements and duties for your rank. I have attached the files for all ranks. ' +
        'These are the expectations for all new ordinations coming from the diocese.\n\n' +
        'As a reminder, you must have a diocese tonia for the ordination. HG Bishop David has made it clear that ordinations require diocese-approved tonias. ' +
        'If you will be ordained a reader or subdeacon, you will also need an epitrachelion (patrasheel). ' +
        'If you do not have one, please see someone at the bookstore to purchase one.\n\n' +
        'If you or your child were approved for the rank of chanter and you/he is/are under 8 years of age, ' +
        'you/he will have to have your father attend liturgy with you as a deacon. ' +
        'You will only be able to dress as a deacon if your/his father who is a deacon attends and watches over you/him.\n\n' +
        'If you have any questions, please contact Deacon Severus Ghaly or Deacon Peter Awadalla or Deacon Kyrillos Bebawy.\n\n' +
        'God bless.\n\n' +
        'SPSM Coptic Deacon Service Committee',
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

/** The diocese's requirements and duties for every rank, attached to each approval email. */
export const ORDINATION_REQUIREMENTS_FILES = [
  { path: '/ordination/requirements/cantor-epsaltos-requirements-and-duties.pdf', filename: 'Cantor (Epsaltos) - Requirements and Duties.pdf' },
  { path: '/ordination/requirements/reader-anaghnostis-requirements-and-duties.pdf', filename: 'Reader (Anaghnostis) - Requirements and Duties.pdf' },
  { path: '/ordination/requirements/subdeacon-epidiacon-requirements-and-duties.pdf', filename: 'Subdeacon (Epidiacon) - Requirements and Duties.pdf' },
] as const;
