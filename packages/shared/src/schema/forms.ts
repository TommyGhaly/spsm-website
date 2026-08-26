import type { AuditFields } from './common.js';

/**
 * Parish forms: the definitions staff build, and what parishioners send back.
 *
 * ---------------------------------------------------------------------------
 * This file is the thing `firestore.rules` said it was waiting for.
 *
 * The rule on `formSubmissions` reads, in full: "`forms` and `formSubmissions`
 * have collection names and rules and no TypeScript type; when that type is
 * written, this rule gets written beside it and can validate against something
 * real. Until then the collection behaves like every other unopened one in this
 * file." That was correct, and it is why the collection was `allow create: if
 * false` rather than a tighter guess at a shape nobody had designed.
 *
 * So the bounds below are not decoration. `MAX_FIELDS`, `MAX_ANSWER_LENGTH` and
 * the rest exist to be transcribed into the rule, and any change to one is a
 * change to both. A bound only present here is not a bound: anything in this
 * file can be skipped by anyone willing to open a console.
 * ---------------------------------------------------------------------------
 *
 * ## Three kinds of form, because the parish genuinely has three
 *
 * `native`   — built in the drawer on /forms, submitted to us, reviewed by us.
 * `external` — a card that links out to somebody else's form. Breeze today.
 * `vehicle`  — the parking registration, which is native to look at but posts
 *              to a different Firebase project entirely. See `pushesToTaksis`.
 *
 * `external` is not a fallback or a stopgap. Breeze's API can read forms and
 * delete entries and has **no endpoint that creates one**, so a Breeze form
 * rendered natively would collect answers Breeze never hears about — while the
 * office carries on checking Breeze and finding it empty. Until a given form
 * moves across deliberately, linking out is the honest option, and the parish
 * decides that one form at a time.
 */

/* ---------------------------------------------------------------------------
 * Bounds. Keep in step with firestore.rules.
 * ------------------------------------------------------------------------ */

/** Fields in one form. A form longer than this is a document, not a form. */
export const MAX_FIELDS = 60;
/** Characters in one answer. Generous for a paragraph, hostile to a payload. */
export const MAX_ANSWER_LENGTH = 4000;
/** Options selectable in one checkbox group. */
export const MAX_SELECTIONS = 40;
/** Answers in one submission — bounded separately, since unknown keys are dropped. */
export const MAX_ANSWERS = MAX_FIELDS;
/** Ceiling on anything a form can charge, in cents. A guard against a typo'd price. */
export const MAX_PRICE_CENTS = 500_00;
/** Ceiling on a quantity-style number field, so `unitPriceCents` can't be multiplied to the moon. */
export const MAX_FORM_QUANTITY = 999;

/* ---------------------------------------------------------------------------
 * Fields
 * ------------------------------------------------------------------------ */

export type FormFieldType =
  /** One line. Names, plates, "how many vans" written as prose. */
  | 'shortText'
  /** A paragraph. */
  | 'longText'
  | 'email'
  | 'phone'
  /** A real number input. The only type that can carry `unitPriceCents`. */
  | 'number'
  | 'date'
  /** One of many, collapsed. Use over `radio` past about six options. */
  | 'select'
  /** One of many, all visible. */
  | 'radio'
  /** Any of many. */
  | 'checkboxes'
  /**
   * A single box that must be ticked — a policy acknowledgement.
   *
   * Distinct from a one-option `checkboxes` because `required` means something
   * different: there, "answer it"; here, "agree to it". Two of the parish's
   * three Breeze forms open with one of these.
   */
  | 'consent'
  /** Not an input. A section break with a title, so long forms have joints. */
  | 'heading';

/** Types that carry `options`. */
const CHOICE_TYPES = new Set<FormFieldType>(['select', 'radio', 'checkboxes']);

export function isChoiceField(type: FormFieldType): boolean {
  return CHOICE_TYPES.has(type);
}

/** Types that collect nothing and so are never validated or stored. */
export function isDecorative(type: FormFieldType): boolean {
  return type === 'heading';
}

export interface FormOption {
  /** Stored in the submission and matched by `showWhen`. Stable across renames. */
  value: string;
  label: string;
  /**
   * Added to the total when this option is chosen. Zero on almost everything.
   *
   * On a `checkboxes` field every ticked option adds; on `select` and `radio`
   * only the one. Priced options are how a registration with tiers works
   * without a second form — "Adult $40 / Child $20 / Family $90" is one field.
   */
  priceCents: number;
}

/**
 * When a field appears.
 *
 * All three Breeze forms need this and it is the reason a form builder here
 * could not be a list of labels: "which grade?" only makes sense once someone
 * has picked Sunday School, "who is driving?" only once they have asked for a
 * van, and an "other, please specify" box that is always visible is a box most
 * people wrongly try to fill in.
 *
 * Deliberately one condition against one other field, not a boolean tree. Every
 * real case in the parish's forms is exactly this shape, and a builder UI for
 * arbitrary AND/OR is a builder nobody in the office can use.
 */
export interface FieldCondition {
  /** The `key` of an earlier field. */
  field: string;
  /**
   * `equals`   — that field's answer is exactly this.
   * `includes` — that field is a checkbox group containing this.
   * `filled`   — that field has any answer at all; `value` is ignored.
   */
  test: 'equals' | 'includes' | 'filled';
  value: string;
}

export interface FormField {
  /**
   * Stable identifier, unique within the form.
   *
   * Submissions are keyed by this and `showWhen` points at it, so renaming a
   * field's *label* is free and changing its *key* orphans every answer already
   * collected. The builder generates one and never changes it afterwards.
   */
  key: string;
  type: FormFieldType;
  label: string;
  /** Shown under the input. Null, not empty string, when there is none. */
  help: string | null;
  placeholder: string | null;
  required: boolean;
  /** Empty for non-choice types. */
  options: FormOption[];
  showWhen: FieldCondition | null;
  /** `number` only: charged per unit entered. Zero means the number is just data. */
  unitPriceCents: number;
  /** `number` only. */
  min: number | null;
  max: number | null;
}

/* ---------------------------------------------------------------------------
 * Payment
 * ------------------------------------------------------------------------ */

/**
 * What a form costs.
 *
 * Two mechanisms, both live at once because the parish asked for both: a flat
 * `baseCents` charged for submitting at all, and per-option / per-unit prices
 * carried by the fields. A summer camp form is the case that needs both — a
 * registration fee plus a tier plus a per-child count.
 *
 * ---------------------------------------------------------------------------
 * The bookstore's safety property, transplanted.
 *
 * `checkout.ts` can send Square nothing but catalog ids and let Square price the
 * order, so the browser has nowhere to put a price even if it wanted to. A form
 * has no catalog behind it, so that trick is unavailable and the guarantee has
 * to be rebuilt: **the browser sends choices, never money.** The Function loads
 * the form definition from Firestore and runs `computeTotalCents` over the
 * submitted answers itself.
 *
 * The browser runs the identical function only to show a running total. If the
 * two ever disagree the server's answer is the one charged, which is why this
 * lives in @spsm/shared rather than being written twice.
 * ---------------------------------------------------------------------------
 */
export interface FormPayment {
  enabled: boolean;
  /** Charged once on any submission. Zero for a form that is priced only by its fields. */
  baseCents: number;
  /** What appears on the Square receipt. Falls back to the form title. */
  label: string;
}

export const NO_PAYMENT: FormPayment = { enabled: false, baseCents: 0, label: '' };

/* ---------------------------------------------------------------------------
 * The form
 * ------------------------------------------------------------------------ */

export type FormKind = 'native' | 'external' | 'vehicle';

export interface FormDefinition extends AuditFields {
  /** URL segment: /forms/<slug>. Lowercase, dashes. */
  slug: string;
  title: string;
  /** One or two sentences on the card and above the form. */
  blurb: string;
  /** An `IconName` from the website's icon set. Unknown names fall back. */
  icon: string;
  /** Ordering on the hub. Lower first; ties break on title. */
  order: number;

  /**
   * Draft until true. `firestore.rules` reads this field by name — an
   * unpublished form is invisible to everyone but staff, and cannot be
   * submitted to.
   */
  published: boolean;
  /**
   * Published but not accepting answers — a registration that has closed.
   *
   * Separate from `published` because the two say different things to someone
   * who follows an old link: unpublished is a 404, closed is a page that
   * explains itself. `closedMessage` is that explanation.
   */
  open: boolean;
  closedMessage: string | null;

  kind: FormKind;
  /** `external` only. Absolute URL — a Breeze form, usually. */
  externalUrl: string | null;
  /**
   * `vehicle` only. Push the submission into the Taksis project instead of
   * storing it here. See `functions/src/forms/taksis.ts`.
   */
  pushesToTaksis: boolean;

  fields: FormField[];
  payment: FormPayment;

  /** Addresses told when a submission arrives. Empty means nobody is told. */
  notifyEmails: string[];
  /** Shown after a successful submission. */
  confirmationMessage: string;
  /**
   * Emailed to the submitter when they gave an email address. Empty means no
   * confirmation is sent — which is a choice, not an oversight, for a form
   * where a copy in an inbox would be a privacy problem.
   */
  confirmationEmailBody: string;

  /** Set when this was imported from Breeze, so the provenance is not folklore. */
  breezeFormId: string | null;
}

/**
 * A form as the builder holds it: everything staff can edit, and nothing else.
 *
 * The audit fields are excluded because they are not the builder's to set —
 * `updatedAt` and `updatedBy` are stamped on write, and `createdAt` is read back
 * off the existing document so an edit cannot rewrite it. Modelling that as
 * "the draft has no timestamps" removes the whole class of bug where a save
 * quietly replaces one of them with `null`.
 */
export type FormDraft = Omit<FormDefinition, keyof AuditFields>;

/* ---------------------------------------------------------------------------
 * Submissions
 * ------------------------------------------------------------------------ */

/**
 * One answer.
 *
 * A union rather than `unknown` because the rule has to be able to check it and
 * the review table has to be able to render it. Checkbox groups are the only
 * multi-value type.
 */
export type FormAnswer = string | number | boolean | string[];

export type FormAnswers = Record<string, FormAnswer>;

export type SubmissionStatus = 'new' | 'seen' | 'handled' | 'archived';

export interface FormSubmission {
  formId: string;
  /** Denormalized so the review table reads one collection, not two. */
  formSlug: string;
  formTitle: string;

  answers: FormAnswers;

  /**
   * Pulled out of `answers` when the form has a field of that type, so staff can
   * sort and search without knowing which key held the name on which form.
   */
  submitterName: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;

  status: SubmissionStatus;
  /** Free text from whoever handled it. */
  staffNote: string | null;

  /** Zero when the form was free. Recomputed server-side; never sent by the browser. */
  totalCents: number;
  /** Square's payment id once taken. Null on a free form or a failed charge. */
  paymentId: string | null;

  /** Set when a signed-in member submitted. Null for a guest, which is the norm. */
  submitterUid: string | null;
  submittedAt: unknown;
}

/* ---------------------------------------------------------------------------
 * Reading a stored definition
 * ------------------------------------------------------------------------ */

const FIELD_TYPES = new Set<FormFieldType>([
  'shortText', 'longText', 'email', 'phone', 'number', 'date',
  'select', 'radio', 'checkboxes', 'consent', 'heading',
]);

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Clamped and integer, because a price of `12.5` cents charges nobody correctly. */
function cents(value: unknown, max = MAX_PRICE_CENTS): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(Math.max(n, 0), max);
}

function parseOption(raw: unknown): FormOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const value = str(record['value']).trim();
  if (!value) return null;
  return {
    value,
    label: str(record['label']).trim() || value,
    priceCents: cents(record['priceCents']),
  };
}

function parseCondition(raw: unknown): FieldCondition | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const field = str(record['field']).trim();
  if (!field) return null;
  const test = str(record['test']);
  return {
    field,
    test: test === 'includes' || test === 'filled' ? test : 'equals',
    value: str(record['value']),
  };
}

function parseField(raw: unknown): FormField | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const key = str(record['key']).trim();
  const type = str(record['type']) as FormFieldType;
  // A field with no key cannot be answered, referenced, or stored — it is not
  // recoverable by guessing, so it is dropped rather than repaired.
  if (!key || !FIELD_TYPES.has(type)) return null;

  const options = isChoiceField(type)
    ? (Array.isArray(record['options']) ? record['options'] : [])
        .map(parseOption)
        .filter((option): option is FormOption => option !== null)
        .slice(0, MAX_SELECTIONS)
    : [];

  const min = typeof record['min'] === 'number' ? record['min'] : null;
  const max = typeof record['max'] === 'number' ? record['max'] : null;

  return {
    key,
    type,
    label: str(record['label']).trim() || key,
    help: nullableStr(record['help']),
    placeholder: nullableStr(record['placeholder']),
    // A decorative field is never required — a heading cannot be filled in, and
    // marking one required would make the form permanently unsubmittable.
    required: !isDecorative(type) && bool(record['required']),
    options,
    showWhen: parseCondition(record['showWhen']),
    unitPriceCents: type === 'number' ? cents(record['unitPriceCents']) : 0,
    min,
    max,
  };
}

function parsePayment(raw: unknown): FormPayment {
  if (!raw || typeof raw !== 'object') return { ...NO_PAYMENT };
  const record = raw as Record<string, unknown>;
  return {
    enabled: bool(record['enabled']),
    baseCents: cents(record['baseCents']),
    label: str(record['label']).trim(),
  };
}

/**
 * Read a Firestore document into a definition, repairing what can be repaired.
 *
 * Tolerant on purpose. A form is edited by volunteers in a drawer on a phone,
 * and a half-written document should render the parts that survived rather than
 * throw and leave the page blank — which is the failure mode that makes staff
 * think they have destroyed something.
 *
 * The exception is a field with no usable `key` or `type`: that one is dropped,
 * because there is nothing to render and no honest guess to make.
 */
export function parseFormDefinition(id: string, raw: unknown): FormDefinition {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const kindRaw = str(record['kind']);
  const kind: FormKind =
    kindRaw === 'external' || kindRaw === 'vehicle' ? kindRaw : 'native';

  const fields = (Array.isArray(record['fields']) ? record['fields'] : [])
    .map(parseField)
    .filter((field): field is FormField => field !== null)
    .slice(0, MAX_FIELDS);

  return {
    slug: str(record['slug']).trim() || id,
    title: str(record['title']).trim() || 'Untitled form',
    blurb: str(record['blurb']).trim(),
    icon: str(record['icon']).trim() || 'file',
    order: typeof record['order'] === 'number' ? record['order'] : 100,

    published: bool(record['published']),
    // Absent means open. A form that has never been closed has no `open` field,
    // and defaulting that to false would close every form written before this
    // one existed.
    open: bool(record['open'], true),
    closedMessage: nullableStr(record['closedMessage']),

    kind,
    externalUrl: nullableStr(record['externalUrl']),
    pushesToTaksis: bool(record['pushesToTaksis']),

    fields,
    payment: parsePayment(record['payment']),

    notifyEmails: (Array.isArray(record['notifyEmails']) ? record['notifyEmails'] : [])
      .map((value) => str(value).trim().toLowerCase())
      .filter((value) => value.includes('@')),
    confirmationMessage:
      str(record['confirmationMessage']).trim() ||
      'Thank you — the parish office has your submission.',
    confirmationEmailBody: str(record['confirmationEmailBody']).trim(),

    breezeFormId: nullableStr(record['breezeFormId']),

    createdAt: record['createdAt'] ?? null,
    updatedAt: record['updatedAt'] ?? null,
    updatedBy: (record['updatedBy'] as string | null) ?? null,
  } as FormDefinition;
}

/* ---------------------------------------------------------------------------
 * Conditions
 * ------------------------------------------------------------------------ */

function answerOf(answers: FormAnswers, key: string): FormAnswer | undefined {
  return Object.prototype.hasOwnProperty.call(answers, key) ? answers[key] : undefined;
}

function isBlank(answer: FormAnswer | undefined): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === 'string') return answer.trim() === '';
  if (Array.isArray(answer)) return answer.length === 0;
  if (typeof answer === 'boolean') return answer === false;
  return false;
}

/**
 * Whether one field is currently showing.
 *
 * Note what this does *not* do: it does not walk the chain. If A reveals B and B
 * reveals C, and A is then unset, C's own condition still points at B — whose
 * answer may well be left over from before A was cleared. `visibleFields` below
 * is the function that resolves that properly, and it is the one to call.
 */
export function isFieldVisible(field: FormField, answers: FormAnswers): boolean {
  const condition = field.showWhen;
  if (!condition) return true;

  const other = answerOf(answers, condition.field);
  if (condition.test === 'filled') return !isBlank(other);
  if (condition.test === 'includes') {
    return Array.isArray(other) && other.includes(condition.value);
  }
  return String(other ?? '') === condition.value;
}

/**
 * The fields actually on screen, in order, with hidden chains resolved.
 *
 * ---------------------------------------------------------------------------
 * Why a single pass over `isFieldVisible` is not enough.
 *
 * Conditions may only point *backwards* — the builder enforces it — so one
 * forward pass settles every field, but only if a field hidden by its own
 * condition also stops satisfying anyone else's. Otherwise: pick Sunday School,
 * the grade dropdown appears, choose Grade 3, then change the service to Choir.
 * The grade field is hidden — but its stale answer "3" is still in `answers`, so
 * anything conditioned on `grade == 3` stays on screen, revealed by a field the
 * user can no longer see.
 *
 * Carrying a filtered answer set forward is what closes that. A hidden field
 * contributes nothing to later conditions, so the whole chain collapses at once.
 *
 * The stale answer itself is deliberately *not* deleted from state — someone who
 * flips back to Sunday School gets their grade back rather than an empty box.
 * `submissionAnswers` is where it stops mattering: that strips everything not
 * visible, so a hidden answer is never validated, never priced, never stored.
 * ---------------------------------------------------------------------------
 */
export function visibleFields(fields: FormField[], answers: FormAnswers): FormField[] {
  const live: FormAnswers = {};
  const shown: FormField[] = [];

  for (const field of fields) {
    if (!isFieldVisible(field, live)) continue;
    shown.push(field);
    const answer = answerOf(answers, field.key);
    if (answer !== undefined) live[field.key] = answer;
  }

  return shown;
}

/**
 * The answers that count: visible fields only, decoration dropped.
 *
 * Both the browser and the Function narrow through this before doing anything
 * else, so "what gets validated", "what gets priced" and "what gets stored" are
 * guaranteed to be the same set rather than three similar ones.
 */
export function submissionAnswers(fields: FormField[], answers: FormAnswers): FormAnswers {
  const result: FormAnswers = {};
  for (const field of visibleFields(fields, answers)) {
    if (isDecorative(field.type)) continue;
    const answer = answerOf(answers, field.key);
    if (answer === undefined || isBlank(answer)) continue;
    result[field.key] = answer;
  }
  return result;
}

/* ---------------------------------------------------------------------------
 * Pricing
 * ------------------------------------------------------------------------ */

/**
 * What this submission costs, in cents.
 *
 * **This is the authority, and it runs on the server.** The browser calls it too,
 * but only to show a running total; `formSubmit` calls it against the stored
 * definition and charges what it returns. Nothing in the request body is money.
 *
 * Every input is clamped at parse time — option prices and `unitPriceCents` by
 * `cents()`, quantities by `MAX_FORM_QUANTITY` here — so a mistyped price in the
 * builder is a wrong charge someone notices, not an unbounded one.
 */
export function computeTotalCents(form: FormDefinition, answers: FormAnswers): number {
  if (!form.payment.enabled) return 0;

  let total = form.payment.baseCents;
  const live = submissionAnswers(form.fields, answers);

  for (const field of form.fields) {
    const answer = answerOf(live, field.key);
    if (answer === undefined) continue;

    if (field.type === 'number' && field.unitPriceCents > 0) {
      const quantity = typeof answer === 'number' ? answer : Number(answer);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      total += field.unitPriceCents * Math.min(Math.floor(quantity), MAX_FORM_QUANTITY);
      continue;
    }

    if (!isChoiceField(field.type)) continue;

    const chosen = Array.isArray(answer) ? answer : [String(answer)];
    for (const value of chosen) {
      const option = field.options.find((candidate) => candidate.value === value);
      if (option) total += option.priceCents;
    }
  }

  return total;
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

function looksLikeAnEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Digits only, so `(508) 555-0134` and `508-555-0134` are the same number.
 * Ten or eleven digits covers US numbers with and without the country code.
 */
function looksLikeAPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 11;
}

/**
 * Everything wrong with this submission, in the words the submitter reads.
 *
 * Run in the browser to render messages beside the fields, and run again in the
 * Function against the stored definition — same list, same order. The second run
 * is the one that decides; the first only saves a round trip.
 *
 * Only visible fields are checked, which is the whole reason `visibleFields`
 * resolves chains: a required "which grade?" that is not on screen must not
 * block a submission from someone who never picked Sunday School.
 */
export function validateSubmission(form: FormDefinition, answers: FormAnswers): string[] {
  const errors: string[] = [];
  const shown = visibleFields(form.fields, answers);

  for (const field of shown) {
    if (isDecorative(field.type)) continue;

    const answer = answerOf(answers, field.key);
    const blank = isBlank(answer);

    if (field.required && blank) {
      errors.push(
        field.type === 'consent'
          ? `Please agree to “${field.label}”.`
          : `${field.label} is required.`,
      );
      continue;
    }
    if (blank) continue;

    // Length is checked on every text-bearing answer, not just long text: the
    // rule bounds the stored document and a 40,000-character "name" is the
    // cheapest way to make one big.
    const asText = Array.isArray(answer) ? answer.join(',') : String(answer);
    if (asText.length > MAX_ANSWER_LENGTH) {
      errors.push(`${field.label} is too long.`);
      continue;
    }

    switch (field.type) {
      case 'email':
        if (!looksLikeAnEmail(asText)) errors.push(`${field.label} is not an email address.`);
        break;

      case 'phone':
        if (!looksLikeAPhone(asText)) errors.push(`${field.label} is not a phone number.`);
        break;

      case 'date':
        // `<input type="date">` gives ISO, but a typed-in value on a browser
        // without the picker does not have to.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asText)) {
          errors.push(`${field.label} is not a date.`);
        }
        break;

      case 'number': {
        const value = typeof answer === 'number' ? answer : Number(asText);
        if (!Number.isFinite(value)) {
          errors.push(`${field.label} must be a number.`);
        } else if (field.min !== null && value < field.min) {
          errors.push(`${field.label} must be ${field.min} or more.`);
        } else if (field.max !== null && value > field.max) {
          errors.push(`${field.label} must be ${field.max} or less.`);
        }
        break;
      }

      case 'select':
      case 'radio': {
        // An answer that is not one of the offered options means either a stale
        // page or a hand-crafted request. Both are rejected the same way.
        if (!field.options.some((option) => option.value === asText)) {
          errors.push(`Choose one of the options for ${field.label}.`);
        }
        break;
      }

      case 'checkboxes': {
        const chosen = Array.isArray(answer) ? answer : [];
        if (chosen.length > MAX_SELECTIONS) {
          errors.push(`Too many options chosen for ${field.label}.`);
          break;
        }
        const allowed = new Set(field.options.map((option) => option.value));
        if (chosen.some((value) => !allowed.has(value))) {
          errors.push(`Choose from the options for ${field.label}.`);
        }
        break;
      }

      default:
        break;
    }
  }

  if (Object.keys(submissionAnswers(form.fields, answers)).length > MAX_ANSWERS) {
    errors.push('That is more answers than this form accepts.');
  }

  return errors;
}

/**
 * Best guess at who sent this, for the review table's columns.
 *
 * By field *type*, not by label, so it works on an imported form whose author
 * called the box "Your details" — and returns null rather than guessing when the
 * form genuinely does not ask. A form with two email fields uses the first,
 * which is the one nearer the top and so almost always the submitter's own.
 */
export function identifySubmitter(
  form: FormDefinition,
  answers: FormAnswers,
): { name: string | null; email: string | null; phone: string | null } {
  const live = submissionAnswers(form.fields, answers);

  const firstOfType = (type: FormFieldType): string | null => {
    for (const field of form.fields) {
      if (field.type !== type) continue;
      const answer = answerOf(live, field.key);
      if (typeof answer === 'string' && answer.trim()) return answer.trim();
    }
    return null;
  };

  const name = (() => {
    for (const field of form.fields) {
      if (field.type !== 'shortText') continue;
      if (!/\bname\b/i.test(field.label)) continue;
      const answer = answerOf(live, field.key);
      if (typeof answer === 'string' && answer.trim()) return answer.trim();
    }
    return null;
  })();

  return { name, email: firstOfType('email'), phone: firstOfType('phone') };
}

/** URL segment rules, shared by the builder and the slug uniqueness check. */
export function toFormSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
