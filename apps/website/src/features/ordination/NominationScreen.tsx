'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ORDINATION_RANK_INFO,
  ageOn,
  emptyOrdinationDraft,
  ordinationRankLabel,
  ordinationTitle,
  validateOrdinationDraft,
  type Ordination,
  type OrdinationApplicationDraft,
  type OrdinationContact,
  type OrdinationNominee,
} from '@spsm/shared';
import { BackLink } from '@/components/BackLink';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { sendNomination } from './apply';
import { watchOpenOrdinations, type WithId } from './data';

const TITLE = 'Nomination for ordination';

/**
 * The public nomination form, at /forms/ordination.
 *
 * ---------------------------------------------------------------------------
 * The nominee page of the diocese's form, online. A nominee — or a parent, for
 * a cantor or a reader — picks the ordination and gives the details the page
 * asks for. Nobody signs in; the camp's servant sign-up is the model.
 *
 * What is deliberately not here is the half of the page the priest writes:
 * the questions about attendance, conduct and the father of confession's
 * approval. Those are answered on the admin screen, by the parish, when the
 * nomination is approved. The form says so, so nobody wonders where they went.
 *
 * Which fields show follows the rank of the ordination chosen: a cantor's and
 * a reader's page has a school grade and two parents, a subdeacon's has a
 * level of study or profession and no parents.
 * ---------------------------------------------------------------------------
 */
export function NominationScreen() {
  const [ordinations, setOrdinations] = useState<WithId<Ordination>[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<OrdinationApplicationDraft>(() => emptyOrdinationDraft());
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(
    () =>
      watchOpenOrdinations(
        (rows) => {
          setOrdinations(rows);
          setDraft((current) => {
            if (rows.some((row) => row.id === current.ordinationId)) return current;
            /*
             * A link may name the ordination — `?ordination=<id>` — so a priest
             * can send one family straight to the right one. Read off `location`
             * rather than `useSearchParams`, which would take this page out of
             * the static export; see `GalleryShell`.
             */
            const wanted = new URLSearchParams(window.location.search).get('ordination');
            const pick = rows.find((row) => row.id === wanted) ?? (rows.length === 1 ? rows[0] : undefined);
            return { ...current, ordinationId: pick?.id ?? '' };
          });
        },
        (error) => {
          console.error('[ordination] could not read the open ordinations', error);
          setFailed(true);
        },
      ),
    [],
  );

  const frame = (children: ReactNode) => (
    <>
      <PageHeader title={TITLE} />
      <PageBody>
        <section className="band camp-band">
          <div className="wrap camp-wrap camp-public">
            <BackLink href="/forms" label="Forms" />
            {children}
          </div>
        </section>
      </PageBody>
    </>
  );

  if (failed) {
    return frame(
      <div className="notice notice--warn">
        <h2>That did not load</h2>
        <p>The list of ordinations could not be read. Please reload the page in a moment.</p>
      </div>,
    );
  }

  if (ordinations === null) return frame(<p className="note">Loading…</p>);

  if (ordinations.length === 0) {
    return frame(
      <>
        <h2>{TITLE}</h2>
        <p>
          The church is not taking nominations for ordination at the moment. Speak to one of
          the parish priests if you would like to be considered.
        </p>
      </>,
    );
  }

  if (sent) {
    return frame(
      <>
        <h2>Thank you</h2>
        <p>
          The nomination has gone to the parish priests. They will be in touch — it is a
          nomination, not an ordination, until they have reviewed it and the diocese has
          received it.
        </p>
        <p className="note">
          Nothing you sent can be read back from this page. If something was wrong, send it
          again and say so in the note at the end.
        </p>
      </>,
    );
  }

  const ordination = ordinations.find((row) => row.id === draft.ordinationId) ?? null;
  const rank = ordination?.rank ?? null;
  const info = rank ? ORDINATION_RANK_INFO[rank] : null;
  const nominee = draft.nominee;
  const age = ordination ? ageOn(nominee.dateOfBirth, ordination.date) : null;

  const setNominee = (patch: Partial<OrdinationNominee>) =>
    setDraft({ ...draft, nominee: { ...nominee, ...patch } });
  const setParent = (index: number, patch: Partial<OrdinationContact>) =>
    setDraft({
      ...draft,
      parents: draft.parents.map((parent, at) => (at === index ? { ...parent, ...patch } : parent)),
    });

  async function send() {
    if (!ordination) {
      setErrors(['Choose the ordination this nomination is for.']);
      return;
    }
    const problems = validateOrdinationDraft(draft, ordination.rank, ordination.date);
    setErrors(problems);
    if (problems.length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSending(true);
    const result = await sendNomination(draft);
    setSending(false);
    if (result.ok) {
      setSent(true);
      window.scrollTo({ top: 0 });
    } else {
      setErrors(result.errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return frame(
    <>
      <h2>{TITLE}</h2>
      <p className="camp-public__intro">
        For a cantor, reader or subdeacon being put forward for ordination. Fill this in for
        yourself, or for your son. The parish priests review every nomination and answer the
        diocese&rsquo;s questions about the nominee themselves before anything is sent.
      </p>

      {errors.length > 0 ? (
        <div className="notice notice--warn">
          <h3>Not quite yet</h3>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="camp-step">
        <h3>Which ordination</h3>
        <label className="camp-field">
          <span className="camp-field__label">Rank and date</span>
          <select
            className="input"
            value={draft.ordinationId}
            onChange={(event) => setDraft({ ...draft, ordinationId: event.target.value })}
          >
            <option value="">Choose one</option>
            {ordinations.map((row) => (
              <option key={row.id} value={row.id}>
                {ordinationTitle(row)}
              </option>
            ))}
          </select>
          {info ? (
            <span className="camp-field__hint">
              The diocese asks that a {info.title.toLowerCase()} has completed {info.minimumAge}{' '}
              years of age.
            </span>
          ) : null}
        </label>
      </section>

      {ordination && rank && info ? (
        <>
          <section className="camp-step">
            <h3>The nominee</h3>
            <label className="camp-field">
              <span className="camp-field__label">Full name</span>
              <input
                className="input"
                autoComplete="off"
                value={nominee.name}
                onChange={(event) => setNominee({ name: event.target.value })}
              />
            </label>
            <label className="camp-field">
              <span className="camp-field__label">Address</span>
              <input
                className="input"
                placeholder="Street, city, state, ZIP"
                value={nominee.address}
                onChange={(event) => setNominee({ address: event.target.value })}
              />
            </label>
            <div className="camp-grid">
              <label className="camp-field">
                <span className="camp-field__label">Date of birth</span>
                <input
                  type="date"
                  className="input"
                  value={nominee.dateOfBirth}
                  onChange={(event) => setNominee({ dateOfBirth: event.target.value })}
                />
                {age !== null ? (
                  <span className="camp-field__hint">
                    {age} on the day of the ordination
                    {age < info.minimumAge ? ` — younger than the ${info.minimumAge} the diocese asks for` : ''}
                  </span>
                ) : null}
              </label>
              {info.minor ? (
                <label className="camp-field">
                  <span className="camp-field__label">School grade</span>
                  <input
                    className="input"
                    placeholder="e.g. 9th grade"
                    value={nominee.schoolGrade}
                    onChange={(event) => setNominee({ schoolGrade: event.target.value })}
                  />
                </label>
              ) : (
                <label className="camp-field">
                  <span className="camp-field__label">Level of study or professional position</span>
                  <input
                    className="input"
                    value={nominee.occupation}
                    onChange={(event) => setNominee({ occupation: event.target.value })}
                  />
                </label>
              )}
              <label className="camp-field">
                <span className="camp-field__label">Telephone</span>
                <input
                  type="tel"
                  className="input"
                  value={nominee.phone}
                  onChange={(event) => setNominee({ phone: event.target.value })}
                />
              </label>
              <label className="camp-field">
                <span className="camp-field__label">Email</span>
                <input
                  type="email"
                  className="input"
                  value={nominee.email}
                  onChange={(event) => setNominee({ email: event.target.value })}
                />
              </label>
            </div>
            <label className="camp-field">
              <span className="camp-field__label">Father of confession</span>
              <input
                className="input"
                placeholder="e.g. Fr. Mina"
                value={nominee.fatherOfConfession}
                onChange={(event) => setNominee({ fatherOfConfession: event.target.value })}
              />
              <span className="camp-field__hint">
                The diocese asks the parish priests whether he has approved the nomination.
              </span>
            </label>
          </section>

          {info.minor ? (
            <section className="camp-step">
              <h3>Parents</h3>
              <p className="note">
                {age !== null && age < 18
                  ? 'At least one parent, since the nominee is under 18.'
                  : 'If applicable.'}
              </p>
              {draft.parents.map((parent, index) => (
                <div className="camp-grid" key={index}>
                  <label className="camp-field">
                    <span className="camp-field__label">Parent {index + 1} name</span>
                    <input
                      className="input"
                      value={parent.name}
                      onChange={(event) => setParent(index, { name: event.target.value })}
                    />
                  </label>
                  <label className="camp-field">
                    <span className="camp-field__label">Telephone</span>
                    <input
                      type="tel"
                      className="input"
                      value={parent.phone}
                      onChange={(event) => setParent(index, { phone: event.target.value })}
                    />
                  </label>
                  <label className="camp-field">
                    <span className="camp-field__label">Email</span>
                    <input
                      type="email"
                      className="input"
                      value={parent.email}
                      onChange={(event) => setParent(index, { email: event.target.value })}
                    />
                  </label>
                </div>
              ))}
            </section>
          ) : null}

          <section className="camp-step">
            <h3>Anything else</h3>
            <label className="camp-field">
              <span className="camp-field__label">Your name, if you are not the nominee</span>
              <input
                className="input"
                value={draft.submittedBy}
                onChange={(event) => setDraft({ ...draft, submittedBy: event.target.value })}
              />
            </label>
            <label className="camp-field">
              <span className="camp-field__label">A note for the parish priests</span>
              <textarea
                className="input"
                rows={3}
                value={draft.message}
                onChange={(event) => setDraft({ ...draft, message: event.target.value })}
              />
            </label>
          </section>

          <p>
            <button
              type="button"
              className="button camp-public__send"
              disabled={sending}
              onClick={() => void send()}
            >
              {sending ? 'Sending…' : `Send the nomination for ${ordinationRankLabel(rank)}`}
            </button>
          </p>
        </>
      ) : null}
    </>,
  );
}
