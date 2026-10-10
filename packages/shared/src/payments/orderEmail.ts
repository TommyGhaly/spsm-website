/**
 * The parish's own confirmation email for a bookstore order.
 *
 * ---------------------------------------------------------------------------
 * Why this exists when Square already emails a receipt.
 *
 * The checkout Function sets `buyer_email_address`, so Square does send one —
 * but a Square receipt is a record of a *payment*. It says an amount went to
 * "St. Philopater Mercurius & St. Mina" and stops. It cannot say that the book
 * will be waiting in the bookstore after Liturgy, or that a parcel is being
 * packed by hand, because Square does not know which of those was chosen and
 * has no vocabulary for either. That is parish fulfilment, and it is the half
 * the buyer actually needs in writing.
 *
 * So the two do not overlap: Square's receipt is the proof of payment, this is
 * the instruction for collecting. Neither replaces the other.
 * ---------------------------------------------------------------------------
 *
 * A pure builder, deliberately. It composes strings and nothing else — no
 * transport, no Firestore, no network — so the wording can be unit-tested
 * without an emulator, and so the Function that calls it stays responsible for
 * *when* an email is enqueued rather than *what* it says.
 *
 * The tone follows the rest of the site: state what the Church does, plainly.
 * No thanking someone three times, no exhortation, no exclamation marks.
 */

export interface OrderEmailLine {
  name: string;
  quantity: number;
  /** Line total in integer minor units — quantity already applied. */
  amount: number;
  /** `SPSM-0007`, so a buyer writing about a book can name it exactly. */
  sku?: string | null;
}

export interface OrderEmailInput {
  orderId: string;
  email: string;
  /** Who the order is for. Omitted on orders taken before this was asked. */
  buyerName?: string;
  /** True when the order is being delivered rather than collected. */
  shipping: boolean;
  lines: readonly OrderEmailLine[];
  /** Order total in integer minor units. */
  total: number;
  currency?: string;
  /** Where to send someone who has a question. Omitted from the copy if unset. */
  parishEmail?: string;
  /** Delivered orders: the service paid for and what it cost, shown as its own line. */
  shippingService?: string;
  shippingCents?: number;
  /** Sales tax Square charged, with the label to print beside it. */
  taxCents?: number;
  taxLabel?: string;
}

/** The shape the Trigger Email extension reads out of the `mail` collection. */
export interface MailDocument {
  to: string[];
  message: { subject: string; text: string; html: string };
}

function currencyFormat(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

/**
 * Escapes text that is about to be interpolated into the HTML part.
 *
 * Book titles come from Square's catalog, which parish staff type by hand — an
 * ampersand in a title is ordinary and would otherwise produce invalid markup,
 * and a stray angle bracket should never become an element in an email nobody
 * can re-issue.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOrderEmail(input: OrderEmailInput): MailDocument {
  const currency = input.currency ?? 'USD';
  const money = (amount: number) => currencyFormat(amount, currency);

  // The one sentence the Square receipt cannot carry.
  const fulfilment = input.shipping
    ? 'Your order will be delivered to you. The church packs orders by hand, so allow a few days.'
    : 'Your order will be waiting for you at the bookstore. You can collect it after any Liturgy.';

  /*
   * The name the order is filed under, on a collection order only.
   *
   * On a delivery it says nothing the address does not already say. On a
   * collection it is the string the volunteer at the table is looking for, so
   * the buyer should be able to see which name to give — particularly when
   * somebody ordered on behalf of a relative.
   */
  const filedUnder =
    !input.shipping && input.buyerName ? `It is put aside under ${input.buyerName}.` : '';

  /*
   * "Write to", never "reply to" — and the difference is not pedantry.
   *
   * These go out from `no-reply@mail.spsmwayland.org`: a send-only subdomain
   * with no mailbox behind it, chosen because the root domain's SPF record ends
   * in `-all` and names Microsoft 365 alone, so nothing else may send as
   * `@spsmwayland.org`. See extensions/firestore-send-email.env.
   *
   * A reply to that address bounces. So an email that says "reply to us" has
   * arranged for the one thing it asks the reader to do to fail silently — the
   * buyer thinks they have reported a wrong order and the church never hears
   * it. Naming the address and the verb separately is what makes the sentence
   * survive the no-reply arrangement.
   *
   * `unmonitored` leads rather than trails, because a reader who has already
   * hit reply has stopped reading the paragraph.
   */
  const unmonitored = 'This address is not monitored.';

  // The postage line, when there was postage — so the lines add up to the total.
  const postage =
    input.shipping && typeof input.shippingCents === 'number'
      ? { label: input.shippingService ?? 'Delivery', cents: input.shippingCents }
      : null;
  const tax =
    typeof input.taxCents === 'number' && input.taxCents > 0
      ? { label: input.taxLabel ?? 'Sales tax', cents: input.taxCents }
      : null;

  const question = input.parishEmail
    ? `${unmonitored} If anything is wrong with this order, write to ${input.parishEmail} and quote the reference above.`
    : `${unmonitored} If anything is wrong with this order, contact the church office and quote the reference above.`;

  const text = [
    'Your order from the church bookstore is placed.',
    '',
    fulfilment,
    ...(filedUnder ? [filedUnder] : []),
    '',
    ...input.lines.map(
      (l) => `${l.quantity} x ${l.name}${l.sku ? ` (${l.sku})` : ''} — ${money(l.amount)}`,
    ),
    ...(postage ? [`${postage.label} — ${money(postage.cents)}`] : []),
    ...(tax ? [`${tax.label} — ${money(tax.cents)}`] : []),
    '',
    `Total paid: ${money(input.total)}`,
    `Reference: ${input.orderId}`,
    '',
    question,
    '',
    'St. Philopater Mercurius & St. Mina Coptic Orthodox Church',
    'Wayland, Massachusetts',
  ].join('\n');

  /*
   * Tables and inline styles, which is not how anything else in this repo is
   * written and is correct here anyway: email clients have no cascade worth
   * relying on, Outlook still lays out with tables, and a <style> block is
   * routinely stripped. Kept to a few colours and no images so it degrades to
   * something legible wherever the stylesheet does not survive.
   */
  const rows =
    input.lines
      .map(
        (l) => `
          <tr>
            <td style="padding:6px 0;color:#4b413e;">${l.quantity} &times; ${escapeHtml(l.name)}${
              l.sku ? ` <span style="color:#6f5f5a;font-size:12px;">${escapeHtml(l.sku)}</span>` : ''
            }</td>
            <td style="padding:6px 0;text-align:right;color:#1c1614;white-space:nowrap;">${money(l.amount)}</td>
          </tr>`,
      )
      .join('') +
    [postage, tax]
      .filter((row): row is { label: string; cents: number } => row !== null)
      .map(
        (row) => `
          <tr>
            <td style="padding:6px 0;color:#4b413e;">${escapeHtml(row.label)}</td>
            <td style="padding:6px 0;text-align:right;color:#1c1614;white-space:nowrap;">${money(row.cents)}</td>
          </tr>`,
      )
      .join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6e8e3;font-family:Georgia,'Times New Roman',serif;color:#1c1614;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#fdf7f4;border:1px solid #e0cac3;border-top:3px solid #b08d43;">
      <tr>
        <td style="padding:24px;">
          <h1 style="margin:0 0 12px;font-size:22px;font-weight:normal;">Your order is placed</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#4b413e;">${escapeHtml(fulfilment)}${
            filedUnder ? ` ${escapeHtml(filedUnder)}` : ''
          }</p>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px;border-top:1px solid #e0cac3;">${rows}
            <tr>
              <td style="padding:12px 0 0;border-top:1px solid #e0cac3;color:#4b413e;">Total paid</td>
              <td style="padding:12px 0 0;border-top:1px solid #e0cac3;text-align:right;font-size:18px;">${money(input.total)}</td>
            </tr>
          </table>

          <p style="margin:20px 0 0;font-size:12px;color:#6f5f5a;">Reference ${escapeHtml(input.orderId)}</p>
          <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#6f5f5a;">${escapeHtml(question)}</p>

          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6f5f5a;">
            St. Philopater Mercurius &amp; St. Mina Coptic Orthodox Church<br />Wayland, Massachusetts
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: [input.email],
    message: {
      subject: input.shipping
        ? 'Your bookstore order is on its way'
        : 'Your bookstore order is ready to collect',
      text,
      html,
    },
  };
}
