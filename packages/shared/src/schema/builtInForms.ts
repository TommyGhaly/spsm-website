import { NO_PAYMENT, type FormDraft, type FormField, type FormFieldType } from './forms.js';

/**
 * The two forms the church always has.
 *
 * ---------------------------------------------------------------------------
 * Why these two are code and every other form is data.
 *
 * The whole point of the builder on /forms is that the office adds a form
 * without a deploy, and a hardcoded list is what that work exists to remove. So
 * a hardcoded pair needs a reason, and it is not "these are important". It is
 * that both of them are **pointed at from outside this codebase, by things that
 * cannot be edited**:
 *
 *   vehicle-registration — an NFC tag in the car park and a printed card. The
 *                          tag cannot be reprinted by changing a file.
 *   contact              — every "ask the church office" link on the site,
 *                          including the one at the bottom of the forms hub
 *                          itself, and the address on the parish's own
 *                          stationery.
 *
 * A form whose address is printed on a physical object cannot be a document
 * somebody can delete from a drawer at eleven at night. What that costs is
 * stated in `isBuiltInForm`: delete and unpublish are not offered for these
 * two, and the rules refuse the delete regardless of what any page draws.
 *
 * ## They are still documents, and still editable
 *
 * These are the *defaults*, not the live copies. `seed-forms.mjs` writes them
 * into Firestore once, and after that staff edit them like any other form —
 * the blurb, the picture, the notification address, the confirmation email, the
 * questions on the contact form. Nothing here overwrites that; the seeder
 * refuses to clobber, and the site reads the stored document when there is one.
 *
 * What this file is for is the case where there *isn't* one: a fresh project
 * before the seeder has run, or a Firestore read that failed. The hub and the
 * form page fall back to these, so the car park tag and the contact link keep
 * working on a site whose database is unreachable. An empty page at those two
 * addresses is the failure worth this much code to avoid.
 *
 * `scripts/lib/form-definitions.mjs` imports these rather than repeating them,
 * because two copies of a form definition is how the local /forms and the real
 * one start disagreeing about which questions a form asks.
 * ---------------------------------------------------------------------------
 */

/** The document ids — which are also the slugs, and also the URLs. */
export const BUILT_IN_FORM_IDS = ['contact', 'vehicle-registration'] as const;
export type BuiltInFormId = (typeof BUILT_IN_FORM_IDS)[number];

/**
 * Whether this form is one the church always has.
 *
 * Takes the **document id**, not the slug. The slug is editable and the id is
 * not, and a check on the editable one is a check somebody can walk out of by
 * renaming a field — which for these two would mean a car park tag pointing at
 * a 404, discovered on a Sunday.
 */
export function isBuiltInForm(id: string): id is BuiltInFormId {
  return (BUILT_IN_FORM_IDS as readonly string[]).includes(id);
}

/**
 * The contact form's subject for "I cannot sign in" and "I need an account".
 *
 * ---------------------------------------------------------------------------
 * Two exported constants for one option in one select, and both are earned.
 *
 * The sign-in help at the foot of /calendar links here with the subject already
 * chosen — `/contact?about=<value>` — so that a servant who needs a church
 * account arrives at a form that already knows what they are asking for, and so
 * that the office can pick those requests out of the submissions table by
 * reading one column. That link and this option have to agree on a string, and
 * a string written out twice in two features is a string that drifts.
 *
 * The value is what `options()` below produces from the label. It is written
 * out rather than computed because it is a stored answer: renaming the label
 * would otherwise silently change the value, and every submission taken before
 * the rename would stop matching. Change the label freely; leave the value.
 *
 * **This file is the default, not the live form.** The stored `forms/contact`
 * document is what the site renders and what the server validates against, and
 * the seeder never clobbers it — so adding an option here changes nothing on a
 * project that has already been seeded. `scripts/sync-contact-subjects.mjs` is
 * the second write, and it exists for exactly this.
 * ---------------------------------------------------------------------------
 */
export const ACCOUNT_SUBJECT_LABEL = 'Signing in, or a church account';
export const ACCOUNT_SUBJECT_VALUE = 'signing-in-or-a-church-account';

/** A field, with the defaults every field carries so the shape never varies. */
function field(
  key: string,
  type: FormFieldType,
  label: string,
  extra: Partial<FormField> = {},
): FormField {
  return {
    key,
    type,
    label,
    help: null,
    placeholder: null,
    required: false,
    options: [],
    showWhen: null,
    unitPriceCents: 0,
    min: null,
    max: null,
    ...extra,
  };
}

/** Plain option labels into `{value,label,priceCents}`, values slugged. */
function options(...labels: string[]) {
  return labels.map((label) => ({
    value: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60),
    label,
    priceCents: 0,
  }));
}

function base(): Omit<FormDraft, 'slug' | 'title' | 'blurb' | 'icon' | 'order' | 'kind'> {
  return {
    image: null,
    published: true,
    open: true,
    closedMessage: null,
    externalUrl: null,
    pushesToTaksis: false,
    fields: [],
    payment: { ...NO_PAYMENT },
    /*
     * Empty, deliberately. A notification address is a real address belonging to
     * a real person, and guessing one here would either bounce or send parish
     * submissions somewhere nobody agreed to. Staff add theirs in the builder.
     */
    notifyEmails: [],
    confirmationMessage: 'Thank you — the church office has your submission.',
    confirmationEmailBody: '',
  };
}

/**
 * The vehicle registration.
 *
 * `kind: 'vehicle'` is the switch that makes `formSubmit` push the answers into
 * the Taksis project instead of storing them here, and `fields: []` is honest
 * rather than unfinished — `VehicleForm` is a hand-written component, because a
 * repeating driver list and a fixed colour set are things the builder has no
 * vocabulary for.
 */
function vehicleRegistration(): FormDraft {
  return {
    ...base(),
    slug: 'vehicle-registration',
    title: 'Register a vehicle',
    blurb:
      'So the parking team can reach you if your car needs moving. Visitors and guests are welcome to register too — no account needed.',
    icon: 'pin',
    image: '/img/stock-parking-lot-1000.webp',
    order: 10,
    kind: 'vehicle',
    pushesToTaksis: true,
    confirmationMessage:
      'Your vehicle is registered and waiting to be approved. Once it has been, your ' +
      'license plate is recognised at the lot — there is no sticker to collect. ' +
      'Contact the church office with any questions.',
  };
}

/**
 * The contact form.
 *
 * Rendered inside /contact rather than on a bare page — see `FORMS_WITH_A_HOME`
 * in `FormsHub` — under the address, the map and the service times, which is
 * where somebody looking for a way to reach the office actually goes.
 */
function contact(): FormDraft {
  return {
    ...base(),
    slug: 'contact',
    title: 'Contact the church office',
    blurb:
      'A question for the office, or a way for the church to reach you. No account needed.',
    icon: 'mail',
    /*
     * A telephone, a pen and a notepad — `stock-office`, licensed and recorded
     * in `assets/README.md`.
     *
     * This said "no photograph" until 2 Sep 2026, on the argument that there is
     * no picture of *getting in touch* and an ornamental tile is honest about
     * being a mark. Tommy asked for a photograph, and the argument was weaker
     * than it read: there is no picture of getting in touch, but there is a
     * very clear picture of **the desk you are writing to**, which is what this
     * form actually reaches. The tile remains what a form with no picture gets.
     */
    image: '/img/stock-office-1000.webp',
    order: 1,
    kind: 'native',
    fields: [
      /*
       * Name and email are the whole point: this form exists as much to build a
       * list the office can write back to as to carry any one question. Both
       * required, and both are the *typed* field rather than free text —
       * `identifySubmitter` finds the submitter by field type, not by label, and
       * an email typed into a `shortText` box would leave the review table's
       * Email column empty on every row.
       */
      field('name', 'shortText', 'Your name', { required: true }),
      field('email', 'email', 'Email address', {
        required: true,
        help: 'Where the church will reply.',
      }),
      /*
       * Optional, unlike on the request forms, where the office has to be able
       * to ring somebody back about a van. Making it required here would turn
       * "I have a question" into a form that demands a phone number first,
       * which is how a contact form stops being used.
       */
      field('phone', 'phone', 'Phone number', {
        help: 'Only if you would rather be called than emailed.',
      }),
      field('subject', 'select', 'What is this about?', {
        required: true,
        options: options(
          'A general question',
          'Baptism, marriage, or a funeral',
          'Confession or a visit from a father',
          'Joining a service or a ministry',
          'Donations and giving',
          'Hall or facility booking',
          ACCOUNT_SUBJECT_LABEL,
          'Something else',
        ),
      }),
      field('message', 'longText', 'Your message', {
        required: true,
        placeholder: 'Tell the office what you need.',
      }),
    ],
    confirmationMessage:
      'Thank you — the church office has your message and will reply to the address you gave.',
    /*
     * A copy to the sender, which most of these forms deliberately do without.
     *
     * Nothing here is sensitive — a name, an address to reply to, and a question
     * somebody chose to send — so a copy in their inbox is a record that they
     * asked and when, which is exactly what they will want in a fortnight if
     * nobody has replied.
     */
    confirmationEmailBody:
      'Thank you for writing to St. Philopater Mercurius & St. Mina. ' +
      'Your message has reached the church office, and a reply will come to this address.',
  };
}

/** The built-in defaults, in hub order. Fresh objects each call — a caller that
    edits one must not be editing every other caller's copy. */
export function builtInForms(): { id: BuiltInFormId; draft: FormDraft }[] {
  return [
    { id: 'contact', draft: contact() },
    { id: 'vehicle-registration', draft: vehicleRegistration() },
  ];
}

/** One built-in default by id, or null. */
export function builtInForm(id: string): FormDraft | null {
  return builtInForms().find((entry) => entry.id === id)?.draft ?? null;
}
