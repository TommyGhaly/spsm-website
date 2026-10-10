import { describe, expect, it } from 'vitest';
import { buildOrderEmail } from '@spsm/shared';

const base = {
  orderId: 'Kz4rELBQ9lTUO2cxMsFmnn28MMUZY',
  email: 'buyer@example.com',
  lines: [
    { name: 'Holy Bible', quantity: 1, amount: 1500 },
    { name: 'Come and See', quantity: 2, amount: 1600 },
  ],
  total: 3100,
};

describe('buildOrderEmail', () => {
  it('addresses the buyer and nobody else', () => {
    const mail = buildOrderEmail({ ...base, shipping: false });
    expect(mail.to).toEqual(['buyer@example.com']);
  });

  /*
   * The whole reason this email exists alongside Square's receipt. If the
   * collection/delivery sentence ever stops differing, the parish is sending two
   * payment receipts and one of them is redundant.
   */
  it('says where the books come from, differently for each choice', () => {
    const collect = buildOrderEmail({ ...base, shipping: false });
    const delivered = buildOrderEmail({ ...base, shipping: true });

    expect(collect.message.text).toContain('collect it after any Liturgy');
    expect(collect.message.subject).toContain('collect');

    // "posted" until 2026-08-19: the parish's word for this is "delivered", and
    // "posted" was reading as "put up on a noticeboard" to enough people to be
    // worth changing everywhere. See `orderEmail.ts`.
    expect(delivered.message.text).toContain('delivered to you');
    expect(delivered.message.subject).not.toContain('collect');
  });

  it('prints money with cents, in both parts', () => {
    const mail = buildOrderEmail({ ...base, shipping: false });
    for (const part of [mail.message.text, mail.message.html]) {
      expect(part).toContain('$15.00');
      expect(part).toContain('$16.00');
      expect(part).toContain('$31.00');
    }
  });

  it('carries the reference, which is the handle for a complaint', () => {
    const mail = buildOrderEmail({ ...base, shipping: false });
    expect(mail.message.text).toContain(base.orderId);
    expect(mail.message.html).toContain(base.orderId);
  });

  it('names the parish address when there is one, and does not invent one', () => {
    const withAddress = buildOrderEmail({
      ...base,
      shipping: false,
      parishEmail: 'office@spsmwayland.org',
    });
    expect(withAddress.message.text).toContain('office@spsmwayland.org');

    const without = buildOrderEmail({ ...base, shipping: false });
    expect(without.message.text).toContain('contact the church office');
    expect(without.message.text).not.toContain('@spsmwayland.org');
  });

  /*
   * These are sent from no-reply@mail.spsmwayland.org — a send-only subdomain
   * with no mailbox — so a reply bounces into nothing. The copy is the only
   * thing standing between that arrangement and a buyer who believes they have
   * reported a wrong order.
   *
   * Asserted on both parts, because they are built separately and the HTML one
   * is where a future edit is most likely to drop the sentence: it interpolates
   * `question` into a <p> three quarters of the way down a wall of table markup.
   */
  it('never invites a reply, in either part', () => {
    for (const parishEmail of [undefined, 'office@spsmwayland.org']) {
      const mail = buildOrderEmail({ ...base, shipping: false, parishEmail });

      for (const part of [mail.message.text, mail.message.html]) {
        expect(part).toContain('This address is not monitored.');
        expect(part).not.toMatch(/reply/i);
      }
    }
  });

  /*
   * Titles are typed by hand into Square. An ampersand is ordinary in a book
   * title and would otherwise produce invalid markup; an angle bracket must
   * never become an element in a message that cannot be re-issued.
   */
  it('escapes titles before putting them in the HTML part', () => {
    const mail = buildOrderEmail({
      ...base,
      shipping: false,
      lines: [{ name: 'Faith & <script>alert(1)</script> Works', quantity: 1, amount: 500 }],
    });

    expect(mail.message.html).not.toContain('<script>');
    expect(mail.message.html).toContain('&amp;');
    expect(mail.message.html).toContain('&lt;script&gt;');
    // The plain-text part is not markup and should read as typed.
    expect(mail.message.text).toContain('Faith & <script>alert(1)</script> Works');
  });

  it('handles a single-line order without trailing separators', () => {
    const mail = buildOrderEmail({
      ...base,
      shipping: true,
      lines: [{ name: 'Holy Bible', quantity: 1, amount: 1500 }],
      total: 1500,
    });
    expect(mail.message.text).toContain('1 x Holy Bible — $15.00');
    expect(mail.message.text).toContain('Total paid: $15.00');
  });

  it('names each SKU and lists postage, so the lines add up to what was paid', () => {
    const mail = buildOrderEmail({
      ...base,
      shipping: true,
      lines: [{ name: 'Holy Bible', quantity: 1, amount: 1500, sku: 'SPSM-0007' }],
      total: 2335,
      shippingService: 'USPS Ground Advantage',
      shippingCents: 835,
    });
    expect(mail.message.text).toContain('1 x Holy Bible (SPSM-0007) — $15.00');
    expect(mail.message.text).toContain('USPS Ground Advantage — $8.35');
    expect(mail.message.html).toContain('SPSM-0007');
    expect(mail.message.html).toContain('USPS Ground Advantage');
  });

  it('has no postage line on a collection', () => {
    const mail = buildOrderEmail({ ...base, shipping: false, shippingService: 'x', shippingCents: 835 });
    expect(mail.message.text).not.toContain('$8.35');
  });

  it('lists sales tax as its own line when there was some', () => {
    const mail = buildOrderEmail({ ...base, shipping: false, taxCents: 94, taxLabel: 'Sales tax (6.25%)' });
    expect(mail.message.text).toContain('Sales tax (6.25%) — $0.94');
    expect(mail.message.html).toContain('Sales tax (6.25%)');
    expect(buildOrderEmail({ ...base, shipping: false, taxCents: 0 }).message.text).not.toContain('Sales tax');
  });
});
