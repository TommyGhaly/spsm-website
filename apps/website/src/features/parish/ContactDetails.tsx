import { formatAddress, hasParishDetails, type ParishConfig } from '@spsm/shared';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Address, phone, email, office hours.
 *
 * Every field degrades on its own. A parish that has published a phone number
 * but not office hours should show the phone number, not a half-empty table
 * with blank rows — so each block is conditional rather than the section being
 * all-or-nothing.
 *
 * ---------------------------------------------------------------------------
 * The labels carry an icon now, and it is doing work rather than decorating.
 *
 * This list is four rows of small-caps grey followed by four short values, and
 * on a page where it sits beside a map it was the dullest thing on screen.
 * The icons give each row a mark you can find without reading — which is what
 * you actually do with a contact list, scanning for the phone rather than
 * reading it top to bottom.
 *
 * `aria-hidden` on every one, because each sits immediately before the word it
 * illustrates. An icon that announces itself next to its own label makes a
 * screen reader say everything twice.
 * ---------------------------------------------------------------------------
 */
export function ContactDetails({ parish }: { parish: ParishConfig }) {
  if (!hasParishDetails(parish)) {
    return (
      <div className="notice">
        <h2>Contact details aren&apos;t published yet</h2>
        <p>
          The church&apos;s address and phone number haven&apos;t been added to the site
          yet. They&apos;ll appear here once staff fill them in.
        </p>
      </div>
    );
  }

  const address = formatAddress(parish.address);

  /*
   * No "Open in Maps" link here any more, and it was removed rather than lost.
   *
   * This used to build a `maps.apple.com/?address=…` URL from the address
   * string. `/contact` now puts a real map directly beside this list, with an
   * Apple Maps and a Google Maps button under it that carry the parish's
   * coordinates instead of a string for a geocoder to re-guess — see
   * `ParishMap`. A third link to a fourth place, six inches from the other two,
   * was noise.
   */

  return (
    <dl className="details details--marked">
      {address && (
        <Row icon="pin" label="Address">
          <address>
            {parish.address.line1}
            {parish.address.line2 && (
              <>
                <br />
                {parish.address.line2}
              </>
            )}
            <br />
            {[parish.address.city, parish.address.state].filter(Boolean).join(', ')}{' '}
            {parish.address.postalCode}
          </address>
        </Row>
      )}

      {parish.phone && (
        <Row icon="phone" label="Phone">
          {/* tel: needs the punctuation stripped or some dialers choke. */}
          <a href={`tel:${parish.phone.replace(/[^\d+]/g, '')}`}>{parish.phone}</a>
        </Row>
      )}

      {parish.email && (
        <Row icon="mail" label="Email">
          <a href={`mailto:${parish.email}`}>{parish.email}</a>
        </Row>
      )}

      {parish.officeHours && (
        <Row icon="clock" label="Office hours">
          {parish.officeHours}
        </Row>
      )}
    </dl>
  );
}

/** One labelled fact. Kept local — nothing outside this list has the shape. */
function Row({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt>
        <Icon name={icon} size={16} className="details__icon" />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
