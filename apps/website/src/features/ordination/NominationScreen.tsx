'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ORDINATION_RANKS,
  ORDINATION_RANK_INFO,
  ageOn,
  isOrdinationRank,
  emptyOrdinationDraft,
  longDay,
  ordinationRankLabel,
  validateOrdinationDraft,
  type Ordination,
  type OrdinationApplicationDraft,
  type OrdinationContact,
  type OrdinationNominee,
  type OrdinationRank,
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
 * The nominee page of the diocese's form, online. It is written to the nominee,
 * since that is who fills it in nearly every time; a parent filling it in for
 * a son says so in one optional field. Nobody signs in; the camp's servant
 * sign-up is the model.
 *
 * There is no choosing the ordination. The parish holds one a year, so the
 * form takes the open one — the soonest, should two ever be open at once.
 *
 * What is deliberately not here is the half of the page the priest writes:
 * the questions about attendance, conduct and the father of confession's
 * approval. Those are answered on the admin screen, by the parish, when the
 * nomination is approved. The form says so, so nobody wonders where they went.
 *
 * Which fields show follows the rank chosen: a cantor's and a reader's page
 * has a school grade and two parents, a subdeacon's has a level of study or
 * profession and no parents. One ordination takes every rank, so the rank is
 * the sender's choice rather than the ordination's.
 * ---------------------------------------------------------------------------
 */
export function NominationScreen() {
  const [ordination, setOrdination] = useState<WithId<Ordination> | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<OrdinationApplicationDraft>(() => emptyOrdinationDraft());

  // `?rank=reader` preselects the rank. Read off `location` rather than
  // `useSearchParams`, which would take this page out of the static export.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('rank');
    if (isOrdinationRank(wanted)) setDraft((current) => ({ ...current, rank: wanted }));
  }, []);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(
    () =>
      watchOpenOrdinations(
        (rows) => {
          const soonest = [...rows].sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
          setOrdination(soonest);
          setDraft((current) => ({ ...current, ordinationId: soonest?.id ?? '' }));
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

  if (ordination === undefined) return frame(<p className="note">Loading…</p>);

  if (ordination === null) {
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

  const rank = draft.rank || null;
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
    if (!ordination) return;
    const problems = validateOrdinationDraft(draft, ordination.date);
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
        For the ordination on {longDay(ordination.date)}, please fill out this form by choosing
        the deacon rank you are asking for. Then the priests will review every nomination. You
        will be notified of their decision through one of the church deacons.
      </p>
      {ordination.closesOn ? (
        <p className="notice">
          <strong>Last day to apply: {longDay(ordination.closesOn)}.</strong> Nominations close at
          the end of that day.
        </p>
      ) : null}

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
        <h3>Which rank</h3>
        <div className="camp-grid">
          <label className="camp-field">
            <span className="camp-field__label">Rank</span>
            <select
              className="input"
              value={draft.rank}
              onChange={(event) =>
                setDraft({ ...draft, rank: event.target.value as OrdinationRank | '' })
              }
            >
              <option value="">Choose one</option>
              {ORDINATION_RANKS.map((value) => (
                <option key={value} value={value}>
                  {ordinationRankLabel(value)}
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
        </div>
      </section>

      {rank && info ? (
        <>
          <section className="camp-step">
            <h3>About you</h3>
            <label className="camp-field">
              <span className="camp-field__label">Your full name</span>
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
                The diocese asks the parish priests whether he has approved your nomination.
              </span>
            </label>
          </section>

          {info.minor ? (
            <section className="camp-step">
              <h3>Parents</h3>
              <p className="note">
                {age !== null && age < 18
                  ? 'At least one parent, since you are under 18.'
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
              <span className="camp-field__label">Filling this in for your son? Your name</span>
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

          {/* The camp sign-up's send panel: a full accent button on a soft
              ground. The panel class goes on the wrapper, not the button —
              on the button it replaced the accent fill with the pale wash. */}
          <div className="camp-public__send">
            <p>
              <button
                type="button"
                className="button"
                disabled={sending}
                onClick={() => void send()}
              >
                {sending ? 'Sending…' : `Send my nomination for ${ordinationRankLabel(rank)}`}
              </button>
            </p>
            <p className="note">
              It goes straight to the parish priests. You will not be able to read it back or
              change it here.
            </p>
          </div>
        </>
      ) : null}
    </>,
  );
}
