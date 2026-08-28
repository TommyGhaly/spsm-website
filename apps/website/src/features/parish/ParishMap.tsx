import { type ParishConfig } from '@spsm/shared';

/**
 * Where the church is, on Google's map.
 *
 * ---------------------------------------------------------------------------
 * This was Leaflet and OpenStreetMap until Aug 27 2026, and the reason it moved
 * is a name.
 *
 * OpenStreetMap's own label for 169 Rice Rd is "Church of the Holy Spirit" —
 * almost certainly the congregation that had the building before this one. The
 * coordinate was right and the marker was on the right roof; the *tiles* said
 * somebody else's name under it, and no amount of work on our side fixes data
 * that lives in a public database upstream. Google already lists the building
 * correctly, so the map now comes from Google.
 *
 * **The Maps Embed API, not the Maps JavaScript API.** The embed is an iframe,
 * it needs no key and costs nothing, and it is the same map Google's own
 * "Share → Embed a map" button hands out. It is also interactive in every way
 * that matters: drag, pinch, zoom, Street View, satellite.
 *
 * What it cannot do is take a custom marker — the pin is Google's red teardrop
 * and there is no parameter that changes it. So the parish's Coptic cross is
 * off this map, and that is the whole price of the switch. Getting it back
 * means the Maps JavaScript API, which needs a billing-enabled key restricted
 * to our domains (Tommy provisions those by hand) and bills per map
 * load. If that key ever exists, this file is the only one that
 * changes; the artwork is still at `/img/cross-coptic-112.webp`.
 * ---------------------------------------------------------------------------
 *
 * No `use client` and no dynamic import any more. This is an iframe built from
 * config on the server, so the whole map costs the browser one element and none
 * of the 40KB of Leaflet it used to.
 */

/** Street level: close enough to read the road names, wide enough to show the turning. */
const ZOOM = 17;

/** What the parish is called, in the places a stranger's map app has to match. */
const CHURCH_NAME = 'St. Philopater Mercurius & St. Mina Coptic Orthodox Church';

/**
 * The address as an address — commas, one line, no decoration.
 *
 * Deliberately *not* `formatAddress`, which joins the parts with a middle dot
 * for display. "169 Rice Rd · Wayland, MA · 01778" is a fine thing to read and
 * a poor thing to hand a geocoder.
 */
function postalAddress(address: ParishConfig['address']): string {
  const street = [address.line1, address.line2].filter(Boolean).join(', ');
  const region = [address.city, address.state].filter(Boolean).join(', ');
  return [street, [region, address.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}

/**
 * Whether there is a map to show — the address, not the coordinates.
 *
 * `/contact` asks this before it applies its two-column class, so that the
 * details do not end up in a narrow column beside an empty half.
 */
export function hasParishMap(parish: ParishConfig): boolean {
  return Boolean(postalAddress(parish.address));
}

export function ParishMap({ parish }: { parish: ParishConfig }) {
  const address = postalAddress(parish.address);

  /*
   * No address, no map — not a placeholder and not a map of somewhere
   * approximate. The whole section simply does not exist until somebody fills
   * `config/parish` in; a pin dropped on a guessed point looks exactly as
   * authoritative as a right one.
   */
  if (!address) return null;

  /*
   * Name *and* address. The address alone resolves to the building, which
   * Google titles "169 Rice Rd"; the name alone resolves to a listing whose
   * address it has to trust. Together they land on the church's own place —
   * verified against Google Maps on Aug 27 2026 — and the pin carries the
   * church's name rather than a street number.
   */
  const query = `${CHURCH_NAME}, ${address}`;
  const embed = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=${ZOOM}&hl=en&output=embed`;

  return (
    <div className="pmap">
      <div className="pmap__canvas">
        <iframe
          /*
           * The title is the accessible name of the frame, and it is what a
           * screen reader announces when its user lands here. "Google Maps"
           * would say what the widget is and not what it shows.
           */
          title={`Map of the church at ${address}`}
          src={embed}
          loading="lazy"
          /*
           * Google's own embed snippet asks for this: the tile requests need
           * the referrer to attribute the load, and the default policy sends
           * nothing at all cross-origin in some browsers.
           */
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>

      {/*
        The links are not a fallback for the map; they are the better answer for
        anyone who wants to *go* there.

        Both carry the street address now, and neither carries the coordinates.
        Coordinates are what a geocoder cannot get wrong, which is why they were
        here first, and they are also what nobody can read: you tapped
        "Directions" and the destination field said "42.345742,-71.3331069".

        The two links are not the same shape, and that is deliberate. Google
        takes the search Google itself answers with the church's listing.
        Apple gets `address`, which is documented to *place* an address rather
        than search for one — a search on Apple's side that finds nothing leaves
        the reader on a spinner, and this cannot. `q` alongside it is the label
        on the pin. Both were checked against the live apps on Aug 27 2026.
      */}
      <p className="pmap__actions">
        <a
          className="button button--quiet"
          href={`https://maps.apple.com/?address=${encodeURIComponent(address)}&q=${encodeURIComponent(CHURCH_NAME)}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          Directions in Apple Maps
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        <a
          className="button button--quiet"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          Directions in Google Maps
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}
