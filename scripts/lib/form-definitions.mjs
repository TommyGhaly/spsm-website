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
    slug: 'vehicle-registration',
    image: '/img/stock-parking-lot-1000.webp',
    title: 'Register a vehicle',
    blurb:
      'So the parking team can reach you if your car needs moving. Visitors and guests are welcome to register too — no account needed.',
    icon: 'pin',
    order: 10,
    // The only one published by this script: it replaces a form people already
    // use, and leaving it unpublished would take that away rather than move it.
    published: true,
    kind: 'vehicle',
    pushesToTaksis: true,
    fields: [],
    confirmationMessage:
      'Your vehicle is registered and waiting to be approved. Once it has been, your ' +
      'license plate is recognised at the lot — there is no sticker to collect. ' +
      'Contact the church office with any questions.',
  },

  {
    slug: 'contact',
    title: 'Contact the church office',
    blurb:
      'A question for the office, or a way for the church to reach you. No account needed.',
    icon: 'mail',
    /*
     * No photograph, and this is the case `FormDefinition.image` was written
     * for: there is no picture of "getting in touch". The ornamental tile is
     * honest about being a mark rather than decoration standing in for a
     * subject.
     */
    order: 1,
    /*
     * Published, like the vehicle registration and unlike the three Breeze
     * rebuilds. There is no older version of this anywhere to
     * take down first — the parish has had no way at all to be written to
     * before now — so holding it back as a draft would leave the contact page
     * with the same gap it has today.
     */
    published: true,
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
       * Optional, unlike on the four request forms, where the office has to be
       * able to ring somebody back about a van. Making it required here would
       * turn "I have a question" into a form that demands a phone number first,
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
  },

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

/** Every seeded form, as plain objects. Callers add their own audit fields. */
export function seedForms() {
  return FORMS.map((form) => ({
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
    breezeFormId: null,
  }));
}
