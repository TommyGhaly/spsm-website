import { builtInForms } from '@spsm/shared';

/**
 * The parish's forms, as one definition both seeders read.
 *
 * Split out of `seed-forms.mjs` so the emulator seeder writes exactly the same
 * documents. Two copies of a form definition is how the local /forms and the
 * real one start disagreeing about which questions a form asks — and a
 * conditional field that behaves one way on a laptop and another way on Sunday
 * is the worst possible version of that.
 *
 * The field definitions were read off the live Breeze forms. Where Breeze asked
 * for something as free text that is plainly a date or a number, it is typed
 * properly here — "What is the date of the event?" is a date field rather than a
 * text box, which is most of the point of rebuilding rather than mirroring.
 *
 * The array below holds only the three rebuilt request forms. The contact form
 * and the vehicle registration are in `@spsm/shared` — see `builtInForms` and
 * `seedForms` at the foot of this file for why they had to move.
 */

/** A field, with the defaults every field carries so the shape never varies. */
function field(key, type, label, extra = {}) {
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

/** A section break. `heading` collects nothing; it exists to split a long form. */
function section(key, label) {
  return field(key, 'heading', label);
}

/** Plain option labels into `{value,label,priceCents}`, values slugged. */
function options(...labels) {
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

/** The four questions every one of these forms opens with. */
const WHO = [
  field('name', 'shortText', 'Your name', { required: true }),
  field('phone', 'phone', 'Phone number', { required: true }),
  field('email', 'email', 'Email address', {
    required: true,
    help: 'The confirmation is sent here.',
  }),
];

const SERVICES = options(
  'Adult Choir',
  'Arabic Bible Study',
  'Arabic Class',
  'College & Young Professionals',
  'Coptic Class',
  'English Bible Study',
  'Hymns',
  'Iconography',
  'Mother of Mercy',
  'Preservants',
  'St. Simon for Seniors',
  'Sunday School',
  'Summer Camp',
  'Sports',
  'Youth Meeting',
  'Servants Meeting',
  'Festival',
  'OTHER',
);

const GRADES = options(
  'Pre-K',
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Grade 7',
  'Grade 8',
  'High School',
);

/* ------------------------------------------------------------------------ */

const FORMS = [
  {
    slug: 'van-request',
    image: '/img/stock-passenger-van-1000.webp',
    title: 'Request a church van',
    blurb: 'For a service or an event that needs one of the church vans.',
    icon: 'file',
    order: 20,
    fields: [
      ...WHO,
      field('people', 'number', 'How many people?', { required: true, min: 1, max: 200 }),
      field('driver', 'shortText', 'Who will be driving?', { required: true }),
      field('date', 'date', 'Date of the event', { required: true }),
      field('vans', 'radio', 'How many vans do you need?', {
        required: true,
        options: options('One', 'Two', 'More than two — a rental will be needed'),
      }),
    ],
  },

  {
    slug: 'new-service-request',
    image: '/img/stock-small-group-1000.webp',
    title: 'Request a new service',
    blurb: 'To start a new service or meeting in the church.',
    icon: 'file',
    order: 30,
    fields: [
      field('policy', 'consent', 'I have read the church policy for new services', {
        required: true,
      }),
      section('sec_who', 'Who is asking'),
      field('today', 'date', 'Today’s date', { required: true }),
      ...WHO,
      section('sec_service', 'The service'),
      field('purpose', 'longText', 'What is the service for?', { required: true }),
      field('servants', 'shortText', 'Which servants will run it?', { required: true }),
      field('audience', 'shortText', 'Who is it for?', { required: true }),
      field('frequency', 'shortText', 'How often will it meet?', {
        required: true,
        placeholder: 'e.g. every other Friday',
      }),
      field('venue', 'checkboxes', 'Where will it meet?', {
        required: true,
        options: options(
          'Church Dining Hall',
          'Classrooms / church basement',
          'Online',
          'OTHER',
        ),
      }),
      /*
       * The conditional Breeze had as a plain always-visible box. An "if other,
       * please specify" that is on screen whatever you picked is a box most
       * people wrongly try to fill in — which is most of the reason these three
       * were worth rebuilding rather than linking.
       */
      field('venue_other', 'shortText', 'Where else?', {
        showWhen: { field: 'venue', test: 'includes', value: 'other' },
      }),
    ],
  },

  {
    slug: 'events-request',
    image: '/img/stock-gathering-1000.webp',
    title: 'Request an event',
    blurb: 'To put an event on the church calendar and book what it needs.',
    icon: 'calendar',
    order: 40,
    fields: [
      field('policy', 'consent', 'I have read the church policy for events', {
        required: true,
      }),
      section('sec_who', 'Who is asking'),
      field('today', 'date', 'Today’s date', { required: true }),
      ...WHO,
      section('sec_event', 'The event'),
      field('service', 'select', 'Which service is this for?', {
        required: true,
        options: SERVICES,
      }),
      field('service_other', 'shortText', 'Which service?', {
        showWhen: { field: 'service', test: 'equals', value: 'other' },
      }),
      field('grade', 'select', 'Which grade?', {
        options: GRADES,
        showWhen: { field: 'service', test: 'equals', value: 'sunday-school' },
      }),
      field('venue', 'shortText', 'Where is it being held?', { required: true }),
      field('contact', 'shortText', 'Who is the contact on the day?', {
        required: true,
        help: 'Name and phone number.',
      }),
      field('duration', 'shortText', 'How long will it run?', { required: true }),
      field('date', 'date', 'Proposed date', { required: true }),
      field('alt_date', 'date', 'Alternative date', { required: true }),
      section('sec_transport', 'Transport'),
      field('vans', 'select', 'Do you need a church van?', {
        required: true,
        options: options('No vans', '1 van', '2 vans'),
      }),
      field('van_driver', 'shortText', 'Who will drive?', {
        // Two conditions would be needed to catch both van options, and the
        // schema deliberately allows only one. Keyed to "1 van" because that is
        // the overwhelmingly common case; somebody asking for two will see it
        // once they have picked one. Worth revisiting if the parish minds.
        showWhen: { field: 'vans', test: 'equals', value: '1-van' },
      }),
      field('rental', 'radio', 'Would you rent a van if the church ones are taken?', {
        required: true,
        options: options('Yes', 'No'),
      }),
    ],
  },
];

/**
 * Every seeded form, as plain objects. Callers add their own audit fields.
 *
 * The two the church always has — the contact form and the vehicle
 * registration — come from `@spsm/shared` rather than from the array above,
 * because the site falls back to those same definitions when Firestore has no
 * document for them. Defining them twice is how the seeded contact form and the
 * fallback one start asking different questions.
 */
export function seedForms() {
  const builtIn = builtInForms().map(({ id, draft }) => ({ ...draft, slug: draft.slug || id }));

  return builtIn.concat(FORMS.map((form) => ({
    slug: form.slug,
    title: form.title,
    blurb: form.blurb,
    icon: form.icon,
    image: form.image ?? null,
    order: form.order,
    published: form.published ?? false,
    open: true,
    closedMessage: null,
    kind: form.kind ?? 'native',
    externalUrl: null,
    pushesToTaksis: form.pushesToTaksis ?? false,
    fields: form.fields,
    payment: { enabled: false, baseCents: 0, label: '' },
    /*
     * Empty, deliberately. A notification address is a real address belonging to
     * a real person, and guessing one here would either bounce or send parish
     * submissions somewhere nobody agreed to. Staff add theirs in the builder.
     */
    notifyEmails: [],
    confirmationMessage:
      form.confirmationMessage ?? 'Thank you — the church office has your request.',
    confirmationEmailBody: '',
  })));
}
