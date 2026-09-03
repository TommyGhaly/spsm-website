import type { Metadata } from 'next';
import Link from 'next/link';
import { getParishConfig } from '@/lib/config';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeading } from '@/components/SectionHeading';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What this website collects, who can read it, which services it relies on, and how to ask the church office about anything it holds.',
  alternates: { canonical: '/privacy' },
};

/**
 * Privacy — what the site collects, and what happens to it.
 *
 * ---------------------------------------------------------------------------
 * Written from the code rather than from a template, and that is the whole
 * point of it. Every claim below was checked against the thing that makes it
 * true, and the checkable ones are named here so the next person can re-check
 * them instead of trusting this comment:
 *
 *   - "no analytics companies" — there is no `gtag`, no Tag Manager, no
 *     Plausible, no PostHog anywhere in `apps/website/src`. The only counting
 *     the site does is `features/bookstore/track.ts` writing to our own
 *     Firestore, bounded by `shared/analytics/bookstoreEvents.ts`.
 *   - the browser-storage list — every `localStorage` key the site writes:
 *     `Shop.tsx` (basket), `track.ts` (the random visitor id), `theme.ts` and
 *     `ThemeRuntime.tsx` (cached CSS), `tour/passport.ts` (stickers),
 *     `usePanelWidth.ts` (a drag width), `authHint.ts` (the "you have signed in
 *     before" flag), and `lib/auth.ts` pinning Firebase Auth to localStorage.
 *   - "90 days" — `EVENT_TTL_DAYS` in `shared/analytics/bookstoreEvents.ts`.
 *   - "metadata removed, including location" — `sharp` drops all metadata
 *     unless told to keep it, and `functions/src/galleries.ts` only calls
 *     `.rotate()`, which applies the orientation tag and keeps nothing.
 *   - "an anonymous session … no name, no email address" —
 *     `lib/uploadSession.ts` calls `signInAnonymously`, and
 *     `enforceTenantOnCreate` returns those accounts an empty claim block and
 *     writes them no member document.
 *   - "a scrambled form of the network address … scrambled one way" —
 *     `addressKey()` in `functions/src/galleries/uploadUrl.ts` is a truncated
 *     SHA-256, and the plain address is never written.
 *   - "Both are kept for a day" — `sweepStaleQuotas` in
 *     `functions/src/galleries/orphans.ts` deletes them daily. This is the only
 *     reason that job exists; the counting works without it.
 *   - "made smaller in your browser … only ever receives the smaller copy" —
 *     `lib/downscale.ts` re-encodes onto a canvas and `features/programs/
 *     submit.ts` uploads that blob, never the original `File`.
 *   - the named third parties — `firebase.json`'s CSP is the definitive list of
 *     hosts a browser on this site can reach, plus the two integrations that
 *     are server-side only (Breeze, and the Taksis push in
 *     `functions/src/external/secondaryApp.ts`).
 *   - "we never see a card number" — `functions/src/checkout.ts` tokenises
 *     through `pci-connect.squareup.com`; the `Order` type in
 *     `shared/schema/commerce.ts` has no card field to hold one.
 *   - "delete your account from the account menu" — `HeaderAuth.tsx` calls
 *     `deleteAccount()`, which posts to `/api/account/delete`;
 *     `functions/src/account.ts` deletes the auth user and `members/{uid}` and
 *     deliberately keeps `updatedBy` audit fields, which is why this page says
 *     so out loud rather than promising erasure it does not perform.
 *
 * **So a change to any of those is a change to this page.** A privacy notice
 * that has drifted from the code is worse than none: it is a false statement
 * the church has published about people who trusted it.
 *
 * ## What this page deliberately does not do
 *
 * It does not claim GDPR or CCPA rights. Neither applies here — this is a
 * Massachusetts church, not a business, and Massachusetts has no comprehensive
 * privacy statute. Reciting a European legal basis table would be borrowed
 * authority, and it would bury the two things a parishioner actually wants: who
 * can read what they typed, and who to write to. Rights are therefore offered
 * as what the church will in fact do when asked, which is the promise it can
 * keep.
 *
 * It also does not promise a cookie banner or a consent gate. The site sets no
 * cookies of its own; the ones that exist come from an embedded YouTube player
 * or from Google's reCAPTCHA, and both are named below rather than hidden
 * behind a dialog nobody reads.
 *
 * ## Why it is code and not a `content` document
 *
 * The same trade `/about/our-belief` and `/about/future-plans` made: staff
 * cannot rewrite this from the Firebase console, and changing a word is a
 * deploy. That is the correct side of the trade for this page in particular —
 * its accuracy depends on the code it sits next to, so the person changing the
 * behaviour should be the person changing the sentence, in the same commit.
 * ---------------------------------------------------------------------------
 *
 * Bands rather than one column, for the reason in `app/contact/page.tsx`:
 * `PageHeader` renders only a hidden `h1`, so a page that opens with a
 * paragraph in a `PageBody` opens hard against the masthead. The grounds
 * alternate off a counter so the closing band cannot land on the same ground as
 * the one before it if a section is ever added or dropped.
 *
 * No `<details>` anywhere on it. A policy folded into headings is a policy
 * written not to be read — see the tour: content stays open and the layout
 * carries the length.
 */

/**
 * The date this notice last changed, written down rather than computed.
 *
 * `new Date()` at build time would re-date the page on every unrelated deploy,
 * which tells a reader who is checking whether something changed exactly the
 * wrong thing. Update it by hand when the text changes, and only then.
 */
const UPDATED = '2 September 2026';

export default async function PrivacyPage() {
  const parish = await getParishConfig();

  let ground = 0;
  const band = () => (ground++ % 2 === 0 ? 'band' : 'band band--sunken');

  return (
    <>
      <PageHeader title="Privacy" />

      {/*
        The opening band is `deep`, like the other pages that begin with a
        statement rather than with content. No links in it: `a` inside
        `.band--deep` takes the accent colour, which on the deep ground is not a
        contrast we have checked. Every link on this page is on paper.
      */}
      <section className="band band--deep" aria-labelledby="privacy-heading">
        <div className="wrap">
          <SectionHeading
            id="privacy-heading"
            eyebrow="St. Philopater Mercurius &amp; St. Mina"
            title="Privacy"
            note={`How this website handles what you tell it. Last changed ${UPDATED}.`}
          />
          <div className="prose">
            <p className="lede">
              This website is run by St. Philopater Mercurius &amp; St. Mina Coptic Orthodox
              Church in Wayland, Massachusetts. It collects nothing about you until you fill
              something in, and what it collects then is read by the church office and by the
              servants who look after that part of the church — nobody else.
            </p>
            <p>
              There is no advertising on this site, and nothing on it is sold, rented, or
              shared for anybody&rsquo;s marketing. This page says plainly what each part of
              the site asks for, where it goes, and how to ask the office about it.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="on-its-own-heading">
        <div className="wrap">
          <SectionHeading
            id="on-its-own-heading"
            eyebrow="Simply reading the site"
            title="What the site collects on its own"
          />
          <div className="prose">
            <p>
              Reading these pages does not identify you. The site carries no advertising
              trackers, no social media pixels, and no third-party analytics service — not
              Google Analytics, not any other.
            </p>
            <p>Two things happen without you doing anything:</p>
            <ul>
              <li>
                <strong>Server logs.</strong> The site is served by Google Firebase Hosting,
                which keeps its own records of requests — the page asked for, the time, the
                browser, and the network address it came from. Those are Google&rsquo;s
                operational and security logs, held under Google&rsquo;s terms; the church does
                not read them page by page and does not use them to build a picture of
                anybody.
              </li>
              <li>
                <strong>Bookstore counts.</strong> The bookstore counts which books are looked
                at and what is typed into its search box, so the people who order stock know
                what the church is actually asking for. It does this with a random
                sixteen-character identifier kept in your browser — not a name, not an email
                address, and nothing that can be traced back to a person. The individual
                records are deleted after ninety days; only the totals are kept.
              </li>
            </ul>
            <p>
              The site stores a few things in your own browser, which stay on your device.
              They are the shopping basket while you are filling it, that random bookstore
              identifier, a cached copy of the site&rsquo;s colours so pages do not flash on
              loading, which stations on the festival tour you have collected, a saved panel width
              for administrators, and — if you have signed in before — a note that you have,
              so the sign-in button does not have to guess. Clearing your browser storage
              removes all of it.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="forms-heading">
        <div className="wrap">
          <SectionHeading
            id="forms-heading"
            eyebrow="When you write to us"
            title="Forms"
          />
          <div className="prose">
            <p>
              The contact form asks for your name, an email address, a subject, your message,
              and a phone number if you would rather be called. It is stored so the office can
              answer it, and it is answered by the office.
            </p>
            <p>
              Other forms on the site ask for whatever that form is for, and some let you
              attach a photograph. Whatever you type is stored as you typed it, together with
              the date, and — if you happened to be signed in — the account you were signed in
              as. Staff who have been given the forms area can read submissions and add a note
              about how one was handled. A submission is kept until the office is finished with
              it and for as long as the church needs the record of it.
            </p>
            <p>
              <strong>Vehicle registration</strong> is different in one way worth naming: the
              plate, state, make, model and colour you enter, along with your name and a phone
              number or email address, are sent to Taksis — the church&rsquo;s own app, running
              on a separate church system — because that is where the people who need to
              identify a car in the lot look it up. It is not sent anywhere outside the church.
            </p>
            <p>
              A form that charges a fee hands the payment to Square. See below.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="money-heading">
        <div className="wrap">
          <SectionHeading
            id="money-heading"
            eyebrow="The bookstore and the offering"
            title="Buying and giving"
          />
          <div className="prose">
            <p>
              <strong>The bookstore.</strong> Cards are taken by Square. The card fields on the
              checkout page belong to Square, and a card number goes from your browser to
              Square directly — it never reaches this site&rsquo;s systems, and there is
              nowhere in them to keep one. What the church stores is the order itself: the name
              and email address you gave, what you bought, the total, and a postal address if
              you asked for the order to be posted rather than collected after the Liturgy.
              Your email address is what the receipt goes to, and giving the order number and
              that address back is how you look an order up later — the bookstore has no
              accounts and asks you to make none. Square keeps its own record of the payment
              under its own privacy policy, and a refund is made through Square by a member of
              staff.
            </p>
            <p>
              <strong>Giving.</strong> The giving page shows Tithe.ly&rsquo;s form inside our
              page, but you are dealing with Tithe.ly: what you enter there goes to them, under
              their privacy policy, and the church receives your contribution record through
              Tithe.ly rather than through this website. This site does not see or store your
              card, your bank details, or the amount.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="camp-heading">
        <div className="wrap">
          <SectionHeading
            id="camp-heading"
            eyebrow="Children"
            title="Summer camp registration"
          />
          <div className="prose">
            <p>
              When camp registration is open it asks for the most personal information on this
              site, and it asks for it because the camp cannot be run safely without it. For
              each child: their name, date of birth, the grade they are entering, shirt size,
              which days they are coming, any allergies, and any medical note the camp needs —
              an inhaler, a condition, a medication. For the family: a parent or
              guardian&rsquo;s name, email and phone number, somebody else to ring in an
              emergency and how they are related to the child, and the waiver.
            </p>
            <p>
              This is read by the administrators who run the camp — the people building groups,
              taking the register, and standing in the kitchen at lunchtime — and by nobody
              else on the site. It is not shared outside the church. It is kept for the season
              and afterwards as the church&rsquo;s own record of who attended.
            </p>
            <p>
              Permission to photograph a child for the church&rsquo;s galleries is asked
              separately, for each child, and it is recorded with that child&rsquo;s
              registration. It is not assumed from anything else on the form.
            </p>
            <p>
              Nothing on this site asks a child to fill anything in. Camp information comes
              from a parent or guardian, who can correct it or withdraw it by writing to the
              office. If you believe a child has sent us something, write and it will be
              deleted.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="photos-heading">
        <div className="wrap">
          <SectionHeading
            id="photos-heading"
            eyebrow="Galleries and the livestream"
            title="Photographs"
          />
          <div className="prose">
            <p>
              Anybody may send a photograph to a ministry&rsquo;s gallery, without signing in.
              A photograph you send stays private until an administrator has looked at it and
              approved it. Once approved it is published on a public page, which means it can
              be seen by anyone and does not require a sign-in to view.
            </p>
            <p>
              The published copy is re-encoded rather than passed on as you sent it, and that
              re-encoding removes everything the file carried besides the picture — the camera
              and phone details, and any location the photograph was tagged with.
            </p>
            <p>
              Sending photographs does create an anonymous session in your browser, even
              though you are never asked to sign in and no account of yours is involved. It
              holds no name, no email address and nothing else about you; it exists so the
              church can count how many photographs have come from one browser in a day and
              stop a flood. Alongside it the church stores a scrambled form of the network
              address they were sent from — scrambled one way, so that it counts uploads
              without recording where anybody was. Both are kept for a day.
            </p>
            <p>
              Large photographs are made smaller in your browser before they are sent. That
              happens on your own device, and the church only ever receives the smaller copy.
            </p>
            <p>
              If a photograph of you or of your child is on this site and you would rather it
              were not, write to the office and it will be taken down. You do not need to
              explain why.
            </p>
            <p>
              The Liturgy is streamed on YouTube. The camera is on the sanctuary, but a
              congregation is sometimes in frame, and a stream that has been recorded stays on
              the church&rsquo;s YouTube channel afterwards.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="accounts-heading">
        <div className="wrap">
          <SectionHeading
            id="accounts-heading"
            eyebrow="Servants and staff"
            title="Accounts"
          />
          <div className="prose">
            <p>
              Accounts on this site exist only for the servants and staff who edit it. There is
              no account for visitors, and nothing on the site asks a parishioner to make one.
            </p>
            <p>
              Signing in uses the church&rsquo;s Microsoft account. The password is typed to
              Microsoft, never to this site, and this site never receives it. What is stored is
              the account&rsquo;s identifier, the name and email address Microsoft provides, and
              which areas of the site that person has been given.
            </p>
            <p>
              A servant can delete their own account from the account menu. That deletes the
              sign-in and the record of what they were allowed to administer. It deliberately
              does not erase who edited what: the note that a page was changed, or a photograph
              approved, by a particular person stays, because it is the church&rsquo;s record of
              what was published rather than a description of anybody. Deleting the account here
              does not touch the Microsoft account itself, which belongs to the church&rsquo;s
              Microsoft tenant.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="services-heading">
        <div className="wrap">
          <SectionHeading
            id="services-heading"
            eyebrow="Named, not summarised"
            title="Services this site relies on"
          />
          <div className="prose">
            <p>
              Each of these does one job, and each holds what it needs for that job under its
              own privacy policy:
            </p>
            <ul>
              <li>
                <strong>Google Firebase</strong> — hosting, the database, file storage, and
                sign-in. Everything the site stores is stored here.
              </li>
              <li>
                <strong>Google reCAPTCHA Enterprise</strong> — how the site tells a real
                browser from a script before it will read or write anything. It runs on the
                pages you visit and sends Google signals about the browser and device; Google
                may set cookies on its own domain in the course of it. It is a check, not a
                puzzle: there is nothing to click.
              </li>
              <li>
                <strong>Square</strong> — bookstore payments and any form that charges a fee.
              </li>
              <li>
                <strong>Tithe.ly</strong> — the offering, on the giving page.
              </li>
              <li>
                <strong>Microsoft</strong> — sign-in for servants and staff.
              </li>
              <li>
                <strong>YouTube</strong> — the livestream player. Playing a video lets YouTube
                set its own cookies.
              </li>
              <li>
                <strong>Google Maps</strong> — the map on the contact page.
              </li>
              <li>
                <strong>Breeze</strong> — the church&rsquo;s own records system, which the
                calendar reads from. The reading happens on our side; nothing about you is sent
                to it by your visit.
              </li>
              <li>
                <strong>Taksis</strong> — the church&rsquo;s app, which receives vehicle
                registrations.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="keeping-heading">
        <div className="wrap">
          <SectionHeading
            id="keeping-heading"
            eyebrow="How it is held"
            title="Keeping it, and keeping it safe"
          />
          <div className="prose">
            <p>
              The site is served only over an encrypted connection, and a browser that has
              visited once is told to refuse an unencrypted one. What the pages themselves are
              allowed to load and reach is restricted to the services named above, so a script
              injected from anywhere else does not run.
            </p>
            <p>
              Access is granted one area at a time rather than by a single shared password:
              somebody given the forms area cannot read camp registrations, and somebody given
              the camp cannot read the church&rsquo;s finances. Card numbers are never in the
              church&rsquo;s systems at all.
            </p>
            <p>
              How long something is kept depends on what it is. Bookstore browsing counts are
              deleted after ninety days. A form submission is kept while the office is dealing
              with it and for as long as the record is needed afterwards. Orders and camp
              registrations are kept as the church&rsquo;s own records. Nothing is kept because
              it might be useful to somebody one day.
            </p>
          </div>
        </div>
      </section>

      <section className={band()} aria-labelledby="asking-heading">
        <div className="wrap">
          <SectionHeading
            id="asking-heading"
            eyebrow="Write to the office"
            title="Asking what we hold"
          />
          <div className="prose">
            <p>
              You may ask what this site holds about you, ask for it to be corrected, or ask for
              it to be deleted, and the church will do it. Write to the office —{' '}
              <Link href="/contact">the address and a form are on the contact page</Link>
              {parish.email ? (
                <>
                  , or email <a href={`mailto:${parish.email}`}>{parish.email}</a>
                </>
              ) : null}
              .
            </p>
            <p>
              Two honest limits. Some records the church keeps as its own history — who
              published a page, who attended a camp, what an order was for — and those are kept
              even when an account is deleted. And Square and Tithe.ly hold their own copies of
              a payment; a request about a payment record has to go to them, and the office will
              tell you how.
            </p>
            <p>
              This notice is part of the website itself, so it changes when the site does, and
              the date under the title above is the date it last changed. There is no mailing
              list to notify, and the church will not quietly weaken it: if what the site does
              with your information changes, this page changes in the same breath.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
