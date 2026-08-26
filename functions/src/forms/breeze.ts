import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import {
  MAX_FIELDS,
  toFormSlug,
  type FormField,
  type FormFieldType,
  type FormOption,
} from '@spsm/shared';
import { callerOf, hasRole } from '../httpAuth.js';

/**
 * Reading the parish's Breeze forms, so nobody retypes one.
 *
 * ---------------------------------------------------------------------------
 * Import, not mirror — and Breeze's API is what decides that.
 *
 * The forms surface of the Breeze API is **read and delete only**:
 * `list_forms`, `list_form_fields`, `list_form_entries`, `remove_form_entry`.
 * There is no endpoint that creates an entry.
 *
 * So a Breeze form rendered natively on the parish site would collect answers
 * Breeze never hears about, while the office carried on checking Breeze and
 * finding it empty. That is worse than either honest option, and the two honest
 * options are what the feature offers instead: leave a form in Breeze and link
 * out to it (`kind: 'external'`), or copy it across once and accept that new
 * answers arrive on our side from then on. This Function is the second one.
 *
 * ## The key never reaches a browser
 *
 * A Breeze API key reads the whole member database — addresses, giving records,
 * everyone's contact details. It is a bearer credential with no scoping
 * available, which is exactly why these two endpoints exist rather than the page
 * calling Breeze directly. They return forms and field definitions, nothing
 * else, and they require a verified `staff` claim to do it.
 *
 * ## Inert until configured
 *
 * `BREEZE_API_KEY` unset is a 503 with a sentence the parish can act on, not an
 * error. Nothing else in the forms feature depends on this.
 * ---------------------------------------------------------------------------
 */

export const BREEZE_API_KEY = defineSecret('BREEZE_API_KEY');

/**
 * The parish's Breeze subdomain — `stphilopaterstmina` in
 * `stphilopaterstmina.breezechms.com`. Not a secret; it is in every form URL.
 */
const BREEZE_SUBDOMAIN = defineString('BREEZE_SUBDOMAIN', { default: '' });

interface BreezeSetup {
  base: string;
  headers: Record<string, string>;
}

/**
 * The value that means "there is no key yet".
 *
 * ---------------------------------------------------------------------------
 * Why a placeholder exists at all, rather than the secret simply being absent.
 *
 * `firebase deploy` resolves **every** secret declared anywhere in the codebase
 * during its discovery step — not just the ones belonging to the functions being
 * deployed. So with `BREEZE_API_KEY` missing, even
 * `--only functions:formSubmit` fails:
 *
 *     Error: In non-interactive mode but have no value for the secret: BREEZE_API_KEY
 *
 * That is a hard coupling: an optional, unconfigured integration blocks the
 * deploy of every unrelated function. The options were to stop using Secret
 * Manager for this key — unacceptable, it reads the parish's entire member
 * database including addresses and giving records — or to let the secret exist
 * while holding nothing usable. This is the second.
 *
 * So `BREEZE_API_KEY` is set to `unset` until the parish has a real key. Both
 * Breeze endpoints then answer 503 with a sentence explaining what to add, which
 * is exactly what they did when the secret was genuinely absent. Replacing it is
 * an ordinary `firebase functions:secrets:set BREEZE_API_KEY`; the new version
 * supersedes this one and nothing here needs changing.
 * ---------------------------------------------------------------------------
 */
const NO_KEY_YET = 'unset';

function breezeSetup(): BreezeSetup | null {
  const key = BREEZE_API_KEY.value().trim();
  const subdomain = BREEZE_SUBDOMAIN.value().trim();
  if (!key || key === NO_KEY_YET || !subdomain) return null;

  return {
    base: `https://${subdomain}.breezechms.com/api`,
    // Breeze accepts the key as a header. Not as a query parameter, deliberately
    // — a credential in a URL ends up in access logs and proxy caches.
    headers: { 'Api-Key': key, Accept: 'application/json' },
  };
}

const NOT_CONFIGURED =
  'Breeze is not connected. A staff member needs to add BREEZE_API_KEY and ' +
  'BREEZE_SUBDOMAIN — the key is in Breeze under Account Settings → Extensions → API.';

/** Staff only, and the claim comes from a verified ID token. */
async function requireStaff(req: Parameters<typeof callerOf>[0]): Promise<boolean> {
  return hasRole(await callerOf(req), 'staff');
}

/* ------------------------------------------------------------------------ */

export const breezeListForms = onRequest(
  { cors: false, secrets: [BREEZE_API_KEY] },
  async (req, res) => {
    if (!(await requireStaff(req))) {
      res.status(403).json({ error: 'Staff only.' });
      return;
    }

    const setup = breezeSetup();
    if (!setup) {
      res.status(503).json({ error: NOT_CONFIGURED });
      return;
    }

    try {
      const response = await fetch(`${setup.base}/forms/list_forms`, { headers: setup.headers });
      if (!response.ok) {
        res.status(502).json({ error: `Breeze answered ${response.status}.` });
        return;
      }

      const raw = (await response.json()) as unknown;
      const list = Array.isArray(raw) ? raw : [];

      res.json({
        forms: list.map((entry) => {
          const form = (entry ?? {}) as Record<string, unknown>;
          const slug = String(form['url_slug'] ?? form['id'] ?? '');
          return {
            id: String(form['id'] ?? ''),
            name: String(form['name'] ?? 'Untitled'),
            url: `https://${BREEZE_SUBDOMAIN.value()}.breezechms.com/form/${slug}`,
            // Breeze uses "1"/"0" strings rather than booleans throughout.
            archived: String(form['is_archived'] ?? '0') === '1',
          };
        }),
      });
    } catch (error) {
      console.error('[breeze] list_forms failed', error);
      res.status(502).json({ error: 'Breeze could not be reached.' });
    }
  },
);

export const breezeImportForm = onRequest(
  { cors: false, secrets: [BREEZE_API_KEY] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (!(await requireStaff(req))) {
      res.status(403).json({ error: 'Staff only.' });
      return;
    }

    const setup = breezeSetup();
    if (!setup) {
      res.status(503).json({ error: NOT_CONFIGURED });
      return;
    }

    const body = (req.body ?? {}) as { breezeFormId?: unknown };
    const formId = typeof body.breezeFormId === 'string' ? body.breezeFormId.trim() : '';
    if (!formId) {
      res.status(400).json({ error: 'No Breeze form was named.' });
      return;
    }

    try {
      const [fieldsRes, formsRes] = await Promise.all([
        fetch(`${setup.base}/forms/list_form_fields?form_id=${encodeURIComponent(formId)}`, {
          headers: setup.headers,
        }),
        fetch(`${setup.base}/forms/list_forms`, { headers: setup.headers }),
      ]);

      if (!fieldsRes.ok) {
        res.status(502).json({ error: `Breeze answered ${fieldsRes.status}.` });
        return;
      }

      const rawFields = (await fieldsRes.json()) as unknown;
      const rawForms = formsRes.ok ? ((await formsRes.json()) as unknown) : [];

      const title =
        (Array.isArray(rawForms) ? rawForms : [])
          .map((entry) => (entry ?? {}) as Record<string, unknown>)
          .find((form) => String(form['id'] ?? '') === formId)?.['name'] ?? 'Imported form';

      res.json({
        title: String(title),
        fields: mapFields(Array.isArray(rawFields) ? rawFields : []),
      });
    } catch (error) {
      console.error('[breeze] list_form_fields failed', error);
      res.status(502).json({ error: 'Breeze could not be reached.' });
    }
  },
);

/* ------------------------------------------------------------------------ */

/**
 * Breeze's field types, onto ours.
 *
 * Not one to one, and the mismatches are the reason an import lands as an
 * unpublished draft rather than a finished form:
 *
 *   - Breeze's `name` and `address` are **compound** — one Breeze field is
 *     several boxes. They expand into several of ours, which is a guess at how
 *     the parish wants them split.
 *   - Breeze has no notion of a conditional field in what the API returns, so
 *     any "only show this when…" logic on the Breeze side is lost and has to be
 *     rebuilt in the builder. This is the most commonly missed part of an
 *     import, and the reason nothing is published automatically.
 *   - Breeze's `required` is a "1"/"0" string, like all its booleans.
 *
 * Anything unrecognised becomes short text, which is lossy but never wrong in a
 * way that loses an answer — the question is still asked and still stored.
 */
function mapFields(raw: unknown[]): FormField[] {
  const fields: FormField[] = [];
  const taken = new Set<string>();

  const key = (base: string): string => {
    let candidate = toFormSlug(base) || `field-${fields.length + 1}`;
    let n = 2;
    while (taken.has(candidate)) candidate = `${toFormSlug(base)}-${n++}`;
    taken.add(candidate);
    return candidate;
  };

  const push = (
    label: string,
    type: FormFieldType,
    required: boolean,
    options: FormOption[] = [],
  ) => {
    if (fields.length >= MAX_FIELDS) return;
    fields.push({
      key: key(label),
      type,
      label,
      help: null,
      placeholder: null,
      required,
      options,
      showWhen: null,
      unitPriceCents: 0,
      min: null,
      max: null,
    });
  };

  // Breeze returns `position` as a string; sorted numerically so the imported
  // form reads in the order it was built rather than in string order, where
  // "10" sorts before "2".
  const sorted = [...raw]
    .map((entry) => (entry ?? {}) as Record<string, unknown>)
    .sort((a, b) => Number(a['position'] ?? 0) - Number(b['position'] ?? 0));

  for (const field of sorted) {
    const label = String(field['name'] ?? '').trim() || 'Question';
    const breezeType = String(field['field_type'] ?? '').toLowerCase();
    const required = String(field['required'] ?? '0') === '1';

    const options: FormOption[] = (Array.isArray(field['options']) ? field['options'] : [])
      .map((entry) => (entry ?? {}) as Record<string, unknown>)
      .map((option) => {
        const optionLabel = String(option['name'] ?? option['value'] ?? '').trim();
        return {
          value: toFormSlug(optionLabel) || String(option['id'] ?? optionLabel),
          label: optionLabel,
          priceCents: 0,
        };
      })
      .filter((option) => option.label);

    switch (breezeType) {
      case 'name':
        // Compound on Breeze's side. Split rather than dropped, and the parish
        // can merge them back into one box in the builder if they prefer.
        push('First name', 'shortText', required);
        push('Last name', 'shortText', required);
        break;

      case 'address':
        push('Street address', 'shortText', required);
        push('City', 'shortText', required);
        push('State', 'shortText', required);
        push('Postal code', 'shortText', required);
        break;

      case 'email':
        push(label, 'email', required);
        break;

      case 'phone':
        push(label, 'phone', required);
        break;

      case 'date':
      case 'birthdate':
        push(label, 'date', required);
        break;

      case 'paragraph':
      case 'textarea':
      case 'multiple_lines':
        push(label, 'longText', required);
        break;

      case 'dropdown':
      case 'select':
        push(label, 'select', required, options);
        break;

      case 'radio':
        push(label, 'radio', required, options);
        break;

      case 'checkbox':
      case 'checkboxes':
        /*
         * A single-option checkbox in Breeze is almost always a policy
         * acknowledgement — two of the parish's three forms open with one. Ours
         * has a type for that, and it is not the same as a one-item choice
         * group: `required` there means "answer it", here it means "agree".
         */
        if (options.length <= 1) push(options[0]?.label || label, 'consent', required);
        else push(label, 'checkboxes', required, options);
        break;

      case 'header':
      case 'section':
        push(label, 'heading', false);
        break;

      default:
        push(label, 'shortText', required);
        break;
    }
  }

  return fields;
}
