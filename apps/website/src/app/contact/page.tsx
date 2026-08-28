import type { Metadata } from 'next';
import { getParishConfig } from '@/lib/config';
import { getContentPages } from '@/features/content';
import { ContactDetails, hasParishMap, ParishMap, ServiceTimes } from '@/features/parish';
import { ContactForm } from '@/features/forms';
import { ContentPageBody } from '@/features/content';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeading } from '@/components/SectionHeading';
import { Prose } from '@/components/Prose';

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    'Address, phone, service times, and how to reach St. Philopater Mercurius & St. Mina Coptic Orthodox Church in Wayland, MA.',
};

/**
 * A dedicated route rather than the `[section]` content template.
 *
 * Contact information is structured — an address has parts, a phone number is
 * dialable, a service repeats weekly. Flattening that into a prose page loses
 * the structure that lets this render a `tel:` link, a map, and a schedule. So
 * the facts come from `config/parish`, where staff can correct them without a
 * deploy.
 *
 * Any prose staff write in the `contact` content section still renders below,
 * so "where to park" or "ring the side door" has a home.
 *
 * ---------------------------------------------------------------------------
 * Full-bleed bands, not a single column — and that is what this page was
 * missing.
 *
 * It used to be `PageBody` with three `<section>`s in it, 40px apart, opening
 * hard against the masthead because `PageHeader` renders nothing visible and so
 * the `* + *` rule that spaces a page's blocks never fired on the first one.
 * Tommy: *"it is very squished"*, *"less bland"*. Both are the same problem —
 * the page had no structure a reader could see, only gaps.
 *
 * So it now uses the homepage's own vocabulary: alternating `paper` and
 * `sunken` grounds, each band `--space-section` deep, each opening with a gold
 * eyebrow over its heading. Nothing here is new; it is the arrangement the rest
 * of the site already uses, applied to the page that had been left out of it.
 *
 * The order changed too, at Tommy's direction: **the weekly schedule now closes
 * the page** rather than sitting between the address and the form. It is the
 * least urgent thing here — somebody who wants liturgy times has the homepage's
 * bulletin, and somebody on /contact wants the address or a way to write — and
 * it makes a good last word, being the one block on the page with real colour
 * in it.
 * ---------------------------------------------------------------------------
 *
 * Because this route exists, `contact` is excluded from the `[section]` route's
 * generateStaticParams — otherwise both would try to emit `contact.html`.
 */
export default async function ContactPage() {
  const [parish, extraPages] = await Promise.all([
    getParishConfig(),
    getContentPages('contact'),
  ]);

  /*
   * Grounds alternate, and the count has to be computed rather than written
   * down, because the "Visiting" band only exists on a parish that has written
   * notes. Hardcoding `band--sunken` on the schedule would put two sunken bands
   * back to back the moment somebody fills that field in — and two bands of the
   * same ground with no seam between them read as one very tall section.
   */
  let ground = 0;
  const band = () => (ground++ % 2 === 0 ? 'band' : 'band band--sunken');

  const hasNotes = Boolean(parish.notes) || extraPages.length > 0;

  return (
    <>
      <PageHeader title="Contact Us" />

      {/*
        The details and the map as one band, not two stacked blocks.

        They are the same statement — where the parish is and how to reach it —
        and read as one when they are side by side. The map is the wide half
        because a map is only useful at size; the details are the narrow half
        because an address, a phone number and an email address are three short
        lines and do not want the full measure.

        `ParishMap` renders nothing at all until `config/parish` has a street
        address, so the two-column class is only applied when there is a map to
        put in the second column. Without that check the details would sit in a
        20rem column with an empty 40rem hole beside them.
      */}
      <section className={band()} aria-labelledby="details-heading">
        <div className={`wrap${hasParishMap(parish) ? ' contact-band' : ''}`}>
          <div className="contact-band__facts">
            <SectionHeading
              id="details-heading"
              eyebrow="Wayland, Massachusetts"
              title="Our church"
            />
            <ContactDetails parish={parish} />
          </div>

          <ParishMap parish={parish} />
        </div>
      </section>

      <section className={band()} aria-labelledby="write-heading">
        <div className="wrap contact-write">
          <SectionHeading
            id="write-heading"
            eyebrow="The office"
            title="Write to the church office"
          />
          <ContactForm parish={parish} />
        </div>
      </section>

      {hasNotes && (
        <section className={band()} aria-labelledby="notes-heading">
          <div className="wrap">
            <SectionHeading id="notes-heading" eyebrow="Before you come" title="Visiting" />
            {parish.notes && <Prose>{parish.notes}</Prose>}
            {extraPages.map((page) => (
              <ContentPageBody key={page.id} page={page} />
            ))}
          </div>
        </section>
      )}

      <section className={band()} aria-labelledby="services-heading">
        <div className="wrap">
          <SectionHeading id="services-heading" eyebrow="Every week" title="Regular services" />
          <ServiceTimes services={parish.serviceTimes} />
        </div>
      </section>
    </>
  );
}
