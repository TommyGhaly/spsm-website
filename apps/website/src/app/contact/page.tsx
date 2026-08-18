import type { Metadata } from 'next';
import { getParishConfig } from '@/lib/config';
import { getContentPages } from '@/features/content';
import { ContactDetails, ServiceTimes } from '@/features/parish';
import { ContentPageBody } from '@/features/content';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';
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
 * the structure that lets this render a `tel:` link, a map link, and a
 * schedule. So the facts come from `config/parish`, where staff can correct
 * them without a deploy.
 *
 * Any prose staff write in the `contact` content section still renders below,
 * so "where to park" or "ring the side door" has a home.
 *
 * Because this route exists, `contact` is excluded from the `[section]` route's
 * generateStaticParams — otherwise both would try to emit `contact.html`.
 */
export default async function ContactPage() {
  const [parish, extraPages] = await Promise.all([
    getParishConfig(),
    getContentPages('contact'),
  ]);

  return (
    <>
      <PageHeader title="Contact Us" />

      <PageBody>
        <section aria-labelledby="details-heading">
          <h2 id="details-heading">The parish</h2>
          <ContactDetails parish={parish} />
        </section>

        <section aria-labelledby="services-heading">
          <h2 id="services-heading">Regular services</h2>
          <ServiceTimes services={parish.serviceTimes} />
        </section>

        {parish.notes && (
          <section aria-labelledby="notes-heading">
            <h2 id="notes-heading">Visiting</h2>
            <Prose>{parish.notes}</Prose>
          </section>
        )}

        {extraPages.map((page) => (
          <ContentPageBody key={page.id} page={page} />
        ))}
      </PageBody>
    </>
  );
}
