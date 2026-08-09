import { formatAddress, hasParishDetails, type ParishConfig } from '@spsm/shared';

/**
 * Address, phone, email, office hours.
 *
 * Every field degrades on its own. A parish that has published a phone number
 * but not office hours should show the phone number, not a half-empty table
 * with blank rows — so each block is conditional rather than the section being
 * all-or-nothing.
 */
export function ContactDetails({ parish }: { parish: ParishConfig }) {
  if (!hasParishDetails(parish)) {
    return (
      <div className="notice">
        <h2>Contact details aren&apos;t published yet</h2>
        <p>
          The parish&apos;s address and phone number haven&apos;t been added to the site
          yet. They&apos;ll appear here once staff fill them in.
        </p>
      </div>
    );
  }

  const address = formatAddress(parish.address);
  // Let the user's own maps app decide how to handle it, rather than hardcoding
  // a Google Maps URL that is wrong for anyone who doesn't use Google Maps.
  const mapUrl = address
    ? `https://maps.apple.com/?address=${encodeURIComponent(address)}`
    : null;

  return (
    <dl className="details">
      {address && (
        <div>
          <dt>Address</dt>
          <dd>
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
            {mapUrl && (
              <a href={mapUrl} rel="noopener noreferrer" target="_blank">
                Open in Maps →
              </a>
            )}
          </dd>
        </div>
      )}

      {parish.phone && (
        <div>
          <dt>Phone</dt>
          <dd>
            {/* tel: needs the punctuation stripped or some dialers choke. */}
            <a href={`tel:${parish.phone.replace(/[^\d+]/g, '')}`}>{parish.phone}</a>
          </dd>
        </div>
      )}

      {parish.email && (
        <div>
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${parish.email}`}>{parish.email}</a>
          </dd>
        </div>
      )}

      {parish.officeHours && (
        <div>
          <dt>Office hours</dt>
          <dd>{parish.officeHours}</dd>
        </div>
      )}
    </dl>
  );
}
