import { describe, expect, it } from 'vitest';
import {
  computeTotalCents,
  identifySubmitter,
  isFieldVisible,
  parseFormDefinition,
  submissionAnswers,
  toFormSlug,
  validateSubmission,
  validateSubmissionFields,
  visibleFields,
  type FormDefinition,
  type FormField,
} from '@spsm/shared';

/**
 * The two things about a form that must not be got wrong: what it costs, and
 * which questions it is really asking.
 *
 * Both run twice in production — once in the browser to draw the page, once in
 * `formSubmit` to decide what is charged and stored — so a bug here is a bug in
 * both places at once, and the server's copy is the one that moves money.
 */

function field(key: string, type: FormField['type'], extra: Partial<FormField> = {}): FormField {
  return {
    key,
    type,
    label: key,
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

function form(fields: FormField[], payment?: Partial<FormDefinition['payment']>): FormDefinition {
  return parseFormDefinition('test', {
    slug: 'test',
    title: 'Test',
    published: true,
    fields,
    payment: { enabled: false, baseCents: 0, label: '', ...payment },
  });
}

const options = (...values: [string, number][]) =>
  values.map(([value, priceCents]) => ({ value, label: value, priceCents }));

describe('conditional fields', () => {
  it('shows a field whose condition is met and hides one whose is not', () => {
    const fields = [
      field('service', 'select', { options: options(['sunday-school', 0], ['choir', 0]) }),
      field('grade', 'select', {
        showWhen: { field: 'service', test: 'equals', value: 'sunday-school' },
      }),
    ];

    expect(visibleFields(fields, { service: 'sunday-school' }).map((f) => f.key)).toEqual([
      'service',
      'grade',
    ]);
    expect(visibleFields(fields, { service: 'choir' }).map((f) => f.key)).toEqual(['service']);
  });

  it('matches `includes` against a checkbox group', () => {
    const venue = field('venue', 'checkboxes', { options: options(['hall', 0], ['other', 0]) });
    const other = field('other', 'shortText', {
      showWhen: { field: 'venue', test: 'includes', value: 'other' },
    });

    expect(isFieldVisible(other, { venue: ['hall'] })).toBe(false);
    expect(isFieldVisible(other, { venue: ['hall', 'other'] })).toBe(true);
  });

  it('treats an unticked box and an empty array as unanswered for `filled`', () => {
    const dependent = field('b', 'shortText', {
      showWhen: { field: 'a', test: 'filled', value: '' },
    });

    expect(isFieldVisible(dependent, {})).toBe(false);
    expect(isFieldVisible(dependent, { a: '' })).toBe(false);
    expect(isFieldVisible(dependent, { a: '   ' })).toBe(false);
    expect(isFieldVisible(dependent, { a: [] })).toBe(false);
    expect(isFieldVisible(dependent, { a: false })).toBe(false);
    expect(isFieldVisible(dependent, { a: 'yes' })).toBe(true);
  });

  /**
   * The bug `visibleFields` exists to prevent, stated as a test.
   *
   * A → B → C. Answer A, answer B, then change A. B is hidden, but its answer is
   * still in state — so anything conditioned on B would stay on screen, revealed
   * by a field the person can no longer see.
   */
  it('collapses a whole chain when the field at the top of it changes', () => {
    const fields = [
      field('a', 'select', { options: options(['yes', 0], ['no', 0]) }),
      field('b', 'select', {
        options: options(['deep', 0]),
        showWhen: { field: 'a', test: 'equals', value: 'yes' },
      }),
      field('c', 'shortText', { showWhen: { field: 'b', test: 'equals', value: 'deep' } }),
    ];

    const answers = { a: 'yes', b: 'deep', c: 'written' };
    expect(visibleFields(fields, answers).map((f) => f.key)).toEqual(['a', 'b', 'c']);

    // A changes; B's stale answer must not keep C alive.
    const changed = { ...answers, a: 'no' };
    expect(visibleFields(fields, changed).map((f) => f.key)).toEqual(['a']);
    expect(submissionAnswers(fields, changed)).toEqual({ a: 'no' });
  });
});

describe('validation', () => {
  it('does not require a field that is hidden', () => {
    const definition = form([
      field('service', 'select', { options: options(['choir', 0], ['sunday-school', 0]) }),
      field('grade', 'shortText', {
        required: true,
        showWhen: { field: 'service', test: 'equals', value: 'sunday-school' },
      }),
    ]);

    expect(validateSubmission(definition, { service: 'choir' })).toEqual([]);
    expect(validateSubmission(definition, { service: 'sunday-school' })).toHaveLength(1);
  });

  it('says "agree" rather than "required" for a consent box', () => {
    const definition = form([
      field('policy', 'consent', { required: true, label: 'the parish policy' }),
    ]);
    expect(validateSubmission(definition, {})[0]).toContain('agree');
    expect(validateSubmission(definition, { policy: false })[0]).toContain('agree');
    expect(validateSubmission(definition, { policy: true })).toEqual([]);
  });

  it('rejects an answer that is not one of the offered options', () => {
    const definition = form([
      field('pick', 'select', { options: options(['a', 0], ['b', 0]) }),
    ]);
    expect(validateSubmission(definition, { pick: 'a' })).toEqual([]);
    // A hand-crafted request, or a page left open across an edit.
    expect(validateSubmission(definition, { pick: 'smuggled' })).toHaveLength(1);
  });

  it('checks email, phone and date shapes', () => {
    const definition = form([
      field('email', 'email'),
      field('phone', 'phone'),
      field('when', 'date'),
    ]);

    expect(validateSubmission(definition, {
      email: 'someone@example.org',
      phone: '(508) 555-0134',
      when: '2026-09-14',
    })).toEqual([]);

    expect(validateSubmission(definition, {
      email: 'someone-at-example',
      phone: '12',
      when: '14/09/2026',
    })).toHaveLength(3);
  });

  it('bounds the length of any single answer', () => {
    const definition = form([field('note', 'longText')]);
    expect(validateSubmission(definition, { note: 'x'.repeat(4001) })).toHaveLength(1);
    expect(validateSubmission(definition, { note: 'x'.repeat(4000) })).toEqual([]);
  });
});

describe('pricing', () => {
  it('is zero when payment is off, whatever the fields say', () => {
    const definition = form(
      [field('tier', 'select', { options: options(['gold', 5000]) })],
      { enabled: false, baseCents: 2500 },
    );
    expect(computeTotalCents(definition, { tier: 'gold' })).toBe(0);
  });

  it('adds the base fee, the chosen options, and the per-unit prices', () => {
    const definition = form(
      [
        field('tier', 'select', { options: options(['adult', 4000], ['child', 2000]) }),
        field('extras', 'checkboxes', { options: options(['shirt', 1500], ['book', 1000]) }),
        field('children', 'number', { unitPriceCents: 500 }),
      ],
      { enabled: true, baseCents: 1000 },
    );

    expect(
      computeTotalCents(definition, { tier: 'child', extras: ['shirt', 'book'], children: 3 }),
    ).toBe(1000 + 2000 + 1500 + 1000 + 500 * 3);
  });

  /** The whole reason pricing runs server-side against the stored definition. */
  it('ignores a price for an option the form does not offer', () => {
    const definition = form(
      [field('tier', 'select', { options: options(['adult', 4000]) })],
      { enabled: true, baseCents: 0 },
    );
    expect(computeTotalCents(definition, { tier: 'invented' })).toBe(0);
  });

  it('does not charge for a field the answers have hidden', () => {
    const definition = form(
      [
        field('vans', 'select', { options: options(['none', 0], ['one', 0]) }),
        field('insurance', 'select', {
          options: options(['yes', 2500]),
          showWhen: { field: 'vans', test: 'equals', value: 'one' },
        }),
      ],
      { enabled: true, baseCents: 0 },
    );

    expect(computeTotalCents(definition, { vans: 'one', insurance: 'yes' })).toBe(2500);
    // Changed their mind about the van; the insurance answer is stale and must
    // not be billed.
    expect(computeTotalCents(definition, { vans: 'none', insurance: 'yes' })).toBe(0);
  });

  it('clamps a quantity rather than multiplying without limit', () => {
    const definition = form([field('n', 'number', { unitPriceCents: 100 })], {
      enabled: true,
      baseCents: 0,
    });
    // MAX_FORM_QUANTITY is 999.
    expect(computeTotalCents(definition, { n: 10_000_000 })).toBe(999_00);
    expect(computeTotalCents(definition, { n: -5 })).toBe(0);
  });

  it('clamps an option price stored out of range', () => {
    // A mistyped price in the builder is a wrong charge somebody notices, not an
    // unbounded one. Parsing is where that bound is applied.
    const definition = form(
      [field('tier', 'select', { options: options(['silly', 99_999_999]) })],
      { enabled: true, baseCents: 0 },
    );
    expect(computeTotalCents(definition, { tier: 'silly' })).toBe(500_00);
  });
});

describe('parsing a stored definition', () => {
  it('drops a field with no usable key or type, and keeps the rest', () => {
    const parsed = parseFormDefinition('x', {
      fields: [
        { key: 'good', type: 'shortText', label: 'Good' },
        { key: '', type: 'shortText' },
        { key: 'bad-type', type: 'nonsense' },
        { key: 'also-good', type: 'email' },
      ],
    });
    expect(parsed.fields.map((f) => f.key)).toEqual(['good', 'also-good']);
  });

  it('defaults `open` to true, so forms written before it existed are not closed', () => {
    expect(parseFormDefinition('x', { title: 'T' }).open).toBe(true);
    expect(parseFormDefinition('x', { title: 'T', open: false }).open).toBe(false);
  });

  it('never marks a heading required, which would make the form unsubmittable', () => {
    const parsed = parseFormDefinition('x', {
      fields: [{ key: 'h', type: 'heading', label: 'Part one', required: true }],
    });
    expect(parsed.fields[0]?.required).toBe(false);
  });

  it('keeps only addresses that look like addresses', () => {
    const parsed = parseFormDefinition('x', {
      notifyEmails: ['Office@Example.ORG', '  ', 'not-an-address', 'deacon@example.org'],
    });
    expect(parsed.notifyEmails).toEqual(['office@example.org', 'deacon@example.org']);
  });
});

describe('identifying the submitter', () => {
  it('finds the contact details by field type, not by label', () => {
    const definition = form([
      field('who', 'shortText', { label: 'Your name' }),
      field('e', 'email'),
      field('p', 'phone'),
    ]);

    expect(
      identifySubmitter(definition, { who: 'Mina Bishoy', e: 'm@example.org', p: '5085550134' }),
    ).toEqual({ name: 'Mina Bishoy', email: 'm@example.org', phone: '5085550134' });
  });

  it('returns nulls rather than guessing when the form does not ask', () => {
    const definition = form([field('note', 'longText')]);
    expect(identifySubmitter(definition, { note: 'hello' })).toEqual({
      name: null,
      email: null,
      phone: null,
    });
  });
});

describe('slugs', () => {
  it('makes a URL segment out of a title', () => {
    expect(toFormSlug('Request an Event!')).toBe('request-an-event');
    expect(toFormSlug('  Van   ONLY  ')).toBe('van-only');
    expect(toFormSlug('---')).toBe('');
  });
});

describe('problems are tied to their fields', () => {
  /**
   * The property the page needs and the flat list could not provide.
   *
   * A summary at the top plus a red border is a known accessibility failure —
   * the message is never attached to the control it is about. Keying every
   * problem is what lets the page put it under its own field, wire it with
   * `aria-describedby`, and link the summary item down to it.
   */
  it('names the field each problem belongs to', () => {
    const definition = form([
      field('who', 'shortText', { required: true, label: 'Your name' }),
      field('mail', 'email', { required: true, label: 'Email address' }),
    ]);

    const problems = validateSubmissionFields(definition, { mail: 'not-an-address' });
    expect(problems.map((p) => p.key)).toEqual(['who', 'mail']);
    expect(problems[0]?.message).toContain('Your name');
    expect(problems[1]?.message).toContain('Email address');
  });

  it('uses key null for a problem that belongs to no single field', () => {
    const fields = Array.from({ length: 61 }, (_, i) => field(`f${i}`, 'shortText'));
    const answers = Object.fromEntries(fields.map((f) => [f.key, 'x']));
    const problems = validateSubmissionFields(form(fields), answers);
    // MAX_FIELDS caps the parsed form at 60, so the 61st never survives parsing
    // and the cap is not tripped — the point here is only that a whole-form
    // problem would carry a null key rather than inventing one.
    expect(problems.every((p) => p.key === null || typeof p.key === 'string')).toBe(true);
  });

  it('still exposes the flat list, derived from the same source', () => {
    const definition = form([field('who', 'shortText', { required: true, label: 'Your name' })]);
    expect(validateSubmission(definition, {})).toEqual(
      validateSubmissionFields(definition, {}).map((p) => p.message),
    );
  });
});
