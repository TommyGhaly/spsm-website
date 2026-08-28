import type { Metadata } from 'next';
import { VehicleForm } from '@/features/forms';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Register a Vehicle',
  description:
    'Register your vehicle with the parking team at St. Philopater Mercurius & St. Mina.',
};

/**
 * The NFC destination for the tag by the car park door.
 *
 * ---------------------------------------------------------------------------
 * Same page, different destination: this now writes to Taksis.
 *
 * It used to render `features/parking`, which wrote a `Vehicle` document into
 * our own `vehicles` collection. That form is superseded — the parking team
 * works from Taksis, and a second list of who may park here is not a backup, it
 * is a list that disagrees with the first one six months later with no rule for
 * which wins.
 *
 * **The URL is deliberately unchanged.** There are physical tags in the car park
 * pointing at `/parking`, and they cannot be reprinted by editing a file. This
 * route stays exactly where it is and quietly does the new thing; the same form
 * is also at `/forms/vehicle-registration` for anyone who browses to it from the
 * hub.
 *
 * `robots.ts` still disallows this path, and for the original reason: a search
 * result for "register a vehicle" is only ever a wrong turn into a page that
 * assumes you are already standing in the car park. `/forms` is the indexed
 * door.
 *
 * The slug passed below is the *form definition's*, not this route's — the
 * submission is priced, validated and routed by `formSubmit` against the
 * document at `forms/vehicle-registration`, whichever URL the person came
 * through.
 * ---------------------------------------------------------------------------
 */
export default function ParkingPage() {
  return (
    <>
      <PageHeader title="Register a Vehicle" />
      <PageBody>
        <p className="note">
          So the parking team can reach you if your car needs moving. No account needed —
          visitors and guests are welcome to register too.
        </p>
        <VehicleForm
          slug="vehicle-registration"
          confirmation={
            'Your vehicle is registered and waiting to be approved. Once it has been, ' +
            'your license plate is recognised at the lot — there is no sticker to collect. ' +
            'Contact the church office with any questions.'
          }
        />
      </PageBody>
    </>
  );
}
