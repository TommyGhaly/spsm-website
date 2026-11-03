'use client';

import { useEffect, useState } from 'react';
import {
  ORDINATION_ANSWER_MAX,
  ORDINATION_MAX_NOMINEES,
  ORDINATION_MAX_SIGNATURES,
  ORDINATION_QUESTIONS,
  ORDINATION_RANK_INFO,
  ageOn,
  formDay,
  isCalendarDay,
  longDay,
  ordinationRankLabel,
  ordinationTitle,
  validateOrdinationApproval,
  type Ordination,
  type OrdinationApplication,
  type OrdinationSignature,
  type OrdinationSignatureProfile,
  type OrdinationStatus,
} from '@spsm/shared';
import {
  deleteApplication,
  deleteOrdination,
  readSignatureProfile,
  saveReview,
  updateOrdination,
  watchApplications,
  watchOrdination,
  type WithId,
} from './data';
import { OrdinationError, OrdinationShell } from './OrdinationShell';

/*
 * pdf-lib is a few hundred kilobytes and only needed when somebody prints, so
 * it is fetched then rather than with the screen.
 */
const packet = () => import('./packet');

/** Opened synchronously in the click, so it is not a blocked pop-up. See `reserveTab` in ./packet. */
function reserveTab(): Window | null {
  const tab = window.open('', '_blank');
  tab?.document.write('<p style="font-family:system-ui;padding:2rem">Preparing the form…</p>');
  return tab;
}
import { useOrdinationAdmin, type OrdinationAdminSession } from './useOrdinationAdmin';

/**
 * /admin/ordination/nominations?id=… — one ordination and everybody nominated
 * for it.
 *
 * ---------------------------------------------------------------------------
 * The whole review happens here:
 *
 *   - **Waiting** nominations open into the diocese's questions, which the
 *     parish answers, and a Sign button that adds the signed-in priest's
 *     signature from /admin/ordination/signature. Approving needs every answer
 *     and at least one signature; rejecting needs neither.
 *   - **Approved** ones can be printed one at a time, gain a second or third
 *     priest's signature, or be moved back.
 *   - The **application** button at the top prints the diocese's full packet:
 *     the cover page naming every approved nominee, the requirements signed by
 *     every priest who signed any of them, and a page per nominee.
 *
 * The id is read off `location` rather than `useSearchParams`, which would
 * take the route out of the static export; see `GalleryShell`.
 * ---------------------------------------------------------------------------
 */
export function NominationsScreen() {
  const session = useOrdinationAdmin();
  const [id, setId] = useState<string | null>(null);
  const [ordination, setOrdination] = useState<WithId<Ordination> | null | undefined>(undefined);
  const [applications, setApplications] = useState<WithId<OrdinationApplication>[] | null>(null);
  const [mine, setMine] = useState<OrdinationSignatureProfile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id') ?? '');
  }, []);

  useEffect(() => {
    if (!session.canEdit || !id) return;
    const stopOrdination = watchOrdination(id, setOrdination, (cause) => setError(cause.message));
    const stopApplications = watchApplications(id, setApplications, (cause) => setError(cause.message));
    return () => {
      stopOrdination();
      stopApplications();
    };
  }, [session.canEdit, id]);

  useEffect(() => {
    if (!session.canEdit || !session.uid) return;
    readSignatureProfile(session.uid)
      .then(setMine)
      .catch((cause: Error) => console.warn('[ordination] could not read your signature', cause));
  }, [session.canEdit, session.uid]);

  const approved = (applications ?? []).filter((row) => row.status === 'approved');

  async function printApplication(mode: 'open' | 'download') {
    if (!ordination || approved.length === 0) return;
    const tab = mode === 'open' ? reserveTab() : null;
    setBusy(true);
    try {
      const { buildOrdinationPacket, downloadPdf, openPdf, packetFilename } = await packet();
      const bytes = await buildOrdinationPacket(ordination, approved);
      if (mode === 'open') openPdf(bytes, tab);
      else downloadPdf(bytes, packetFilename(ordination.rank, ordination.date, 'application'));
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (id === '' || ordination === null) {
    return (
      <OrdinationShell session={session} tab="home" title="Nominations">
        <section className="band camp-band">
          <div className="wrap camp-wrap">
            <h3>No such ordination</h3>
            <p>
              It may have been deleted. Go back to <a href="/admin/ordination">the ordinations</a>.
            </p>
          </div>
        </section>
      </OrdinationShell>
    );
  }

  const groups: { status: OrdinationStatus; title: string; empty: string }[] = [
    { status: 'pending', title: 'Waiting for review', empty: 'Nothing waiting.' },
    { status: 'approved', title: 'Approved', empty: 'Nobody approved yet.' },
    { status: 'rejected', title: 'Not approved', empty: '' },
  ];

  return (
    <OrdinationShell
      session={session}
      tab="home"
      title={ordination ? ordinationTitle(ordination) : 'Nominations'}
      actions={
        approved.length > 0 ? (
          <>
            <button type="button" className="button" disabled={busy} onClick={() => void printApplication('open')}>
              {busy ? 'Building…' : `Print application (${approved.length})`}
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void printApplication('download')}
            >
              Download
            </button>
          </>
        ) : null
      }
    >
      {error ? <OrdinationError error={error} /> : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <p className="note">
            <a href="/admin/ordination">← All ordinations</a>
          </p>
          {ordination === undefined || applications === null ? (
            <p className="note">Loading…</p>
          ) : (
            <>
              <OrdinationSettings
                ordination={ordination}
                uid={session.uid}
                hasApplications={applications.length > 0}
                onError={setError}
              />

              {mine && !mine.image ? (
                <div className="notice">
                  <p>
                    You have no signature on file, so you cannot sign nominations yet.{' '}
                    <a href="/admin/ordination/signature">Draw one</a> — parish priests only.
                  </p>
                </div>
              ) : null}

              {groups.map((group) => {
                const rows = applications.filter((row) => row.status === group.status);
                if (rows.length === 0 && !group.empty) return null;
                return (
                  <section key={group.status} className="ordination-group">
                    <h3>
                      {group.title} <span className="ordination-count">{rows.length}</span>
                    </h3>
                    {rows.length === 0 ? <p className="note">{group.empty}</p> : null}
                    {rows.map((row) => (
                      <Nomination
                        key={row.id}
                        application={row}
                        ordination={ordination}
                        session={session}
                        mine={mine}
                        approvedCount={approved.length}
                        onError={setError}
                      />
                    ))}
                  </section>
                );
              })}
            </>
          )}
        </div>
      </section>
    </OrdinationShell>
  );
}

/* -------------------------------------------------------------------------- */

function OrdinationSettings({
  ordination,
  uid,
  hasApplications,
  onError,
}: {
  ordination: WithId<Ordination>;
  uid: string | null;
  hasApplications: boolean;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(ordination.date);
  const [churchName, setChurchName] = useState(ordination.churchName);
  const [churchAddress, setChurchAddress] = useState(ordination.churchAddress);

  async function run(work: () => Promise<void>) {
    try {
      await work();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const deadline = (() => {
    if (!isCalendarDay(ordination.date)) return '';
    const day = new Date(`${ordination.date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 3);
    return longDay(day.toISOString().slice(0, 10));
  })();

  return (
    <section className="camp-step ordination-settings">
      <h3>{ordinationRankLabel(ordination.rank)}</h3>
      <p>
        {longDay(ordination.date)} · {ordination.open ? 'Taking nominations on the Forms page' : 'Closed to new nominations'}
        {deadline ? ` · Due at the diocese by ${deadline}` : ''}
      </p>
      <p className="ordination-actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => uid && void run(() => updateOrdination(ordination.id, { open: !ordination.open }, uid))}
        >
          {ordination.open ? 'Close nominations' : 'Reopen nominations'}
        </button>
        <button type="button" className="button button--ghost" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit details'}
        </button>
        {!hasApplications ? (
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              if (!window.confirm('Delete this ordination? It has no nominations.')) return;
              void run(async () => {
                await deleteOrdination(ordination.id);
                window.location.href = '/admin/ordination';
              });
            }}
          >
            Delete
          </button>
        ) : null}
      </p>
      {editing ? (
        <>
          <div className="camp-grid">
            <label className="camp-field">
              <span className="camp-field__label">Date of ordination</span>
              <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="camp-field">
              <span className="camp-field__label">Church name</span>
              <input className="input" value={churchName} onChange={(event) => setChurchName(event.target.value)} />
            </label>
            <label className="camp-field">
              <span className="camp-field__label">Address, city, state</span>
              <input className="input" value={churchAddress} onChange={(event) => setChurchAddress(event.target.value)} />
            </label>
          </div>
          <p>
            <button
              type="button"
              className="button"
              disabled={!isCalendarDay(date)}
              onClick={() =>
                uid &&
                void run(async () => {
                  await updateOrdination(
                    ordination.id,
                    { date, churchName: churchName.trim(), churchAddress: churchAddress.trim() },
                    uid,
                  );
                  setEditing(false);
                })
              }
            >
              Save details
            </button>
          </p>
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function today(): string {
  // The parish's day, not UTC's — a priest signing at nine in the evening in
  // Wayland signed on that day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** The father of confession's answer starts from the name the nominee gave. */
function startingAnswers(application: OrdinationApplication): Record<string, string> {
  const answers = { ...(application.review?.answers ?? {}) };
  if (!answers['fatherOfConfession'] && application.nominee.fatherOfConfession) {
    answers['fatherOfConfession'] = `${application.nominee.fatherOfConfession} — `;
  }
  return answers;
}

function Nomination({
  application,
  ordination,
  session,
  mine,
  approvedCount,
  onError,
}: {
  application: WithId<OrdinationApplication>;
  ordination: WithId<Ordination>;
  session: OrdinationAdminSession;
  mine: OrdinationSignatureProfile | null;
  approvedCount: number;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(application.status === 'pending');
  const [answers, setAnswers] = useState(() => startingAnswers(application));
  const [note, setNote] = useState(application.review?.note ?? '');
  const [signatures, setSignatures] = useState<OrdinationSignature[]>(application.signatures);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // A second admin's save arrives through the listener; take it unless this
  // card has been edited, in which case the person typing wins until they save.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setAnswers(startingAnswers(application));
    setNote(application.review?.note ?? '');
    setSignatures(application.signatures);
  }, [application, dirty]);

  const { nominee, rank } = application;
  const info = ORDINATION_RANK_INFO[rank];
  const age = ageOn(nominee.dateOfBirth, ordination.date);
  const signedByMe = signatures.some((signature) => signature.uid === session.uid);
  const canSign = Boolean(mine?.image) && !signedByMe && signatures.length < ORDINATION_MAX_SIGNATURES;

  function sign() {
    if (!session.uid || !mine?.image) return;
    setSignatures([
      ...signatures,
      { uid: session.uid, name: mine.name || session.name, image: mine.image, signedOn: today() },
    ]);
    setDirty(true);
  }

  function unsign() {
    setSignatures(signatures.filter((signature) => signature.uid !== session.uid));
    setDirty(true);
  }

  async function decide(status: OrdinationStatus) {
    if (!session.uid) return;
    if (status === 'approved') {
      const errors = validateOrdinationApproval(rank, answers, signatures);
      if (application.status !== 'approved' && approvedCount >= ORDINATION_MAX_NOMINEES) {
        errors.push(`The diocese's cover page has room for ${ORDINATION_MAX_NOMINEES} nominees, and this ordination already has that many.`);
      }
      setProblems(errors);
      if (errors.length > 0) return;
    } else {
      setProblems([]);
    }
    setSaving(true);
    try {
      await saveReview(
        application.id,
        {
          status,
          review: {
            answers: Object.fromEntries(
              Object.entries(answers).map(([key, value]) => [key, value.trim().slice(0, ORDINATION_ANSWER_MAX)]),
            ),
            note: note.trim(),
            decidedByUid: session.uid,
            decidedByName: session.name,
            decidedOn: today(),
          },
          signatures,
        },
        session.uid,
      );
      setDirty(false);
      if (status !== 'pending') setOpen(false);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function print(mode: 'open' | 'download') {
    const tab = mode === 'open' ? reserveTab() : null;
    try {
      const { buildNomineePacket, downloadPdf, openPdf, packetFilename } = await packet();
      const bytes = await buildNomineePacket({ ...application, signatures });
      if (mode === 'open') openPdf(bytes, tab);
      else downloadPdf(bytes, packetFilename(rank, ordination.date, nominee.name));
    } catch (cause) {
      tab?.close();
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <article className={`ordination-nominee ordination-nominee--${application.status}`}>
      <button type="button" className="ordination-nominee__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ordination-nominee__name">{nominee.name}</span>
        <span className="ordination-nominee__meta">
          {age !== null ? `${age} on the day` : 'No date of birth'}
          {signatures.length > 0 ? ` · ${signatures.length} signature${signatures.length === 1 ? '' : 's'}` : ''}
        </span>
      </button>

      {open ? (
        <div className="ordination-nominee__body">
          {age !== null && age < info.minimumAge ? (
            <p className="ordination-problem">
              {age} on {longDay(ordination.date)} — the diocese asks that a {info.title.toLowerCase()} has
              completed {info.minimumAge} years.
            </p>
          ) : null}

          <dl className="ordination-details">
            <dt>Address</dt>
            <dd>{nominee.address || '—'}</dd>
            <dt>Date of birth</dt>
            <dd>{formDay(nominee.dateOfBirth) || '—'}</dd>
            <dt>{info.minor ? 'School grade' : 'Study or profession'}</dt>
            <dd>{(info.minor ? nominee.schoolGrade : nominee.occupation) || '—'}</dd>
            <dt>Telephone</dt>
            <dd>{nominee.phone || '—'}</dd>
            <dt>Email</dt>
            <dd>{nominee.email || '—'}</dd>
            <dt>Father of confession</dt>
            <dd>{nominee.fatherOfConfession || '—'}</dd>
            {application.parents
              .filter((parent) => parent.name || parent.phone || parent.email)
              .map((parent, index) => (
                <div key={index} className="ordination-details__pair">
                  <dt>Parent {index + 1}</dt>
                  <dd>{[parent.name, parent.phone, parent.email].filter(Boolean).join(' · ')}</dd>
                </div>
              ))}
            {application.submittedBy ? (
              <>
                <dt>Sent by</dt>
                <dd>{application.submittedBy}</dd>
              </>
            ) : null}
            {application.message ? (
              <>
                <dt>Their note</dt>
                <dd>{application.message}</dd>
              </>
            ) : null}
          </dl>

          {application.status !== 'rejected' ? (
            <>
              <h4>The parish&rsquo;s answers</h4>
              <p className="note">Printed on the nominee&rsquo;s page of the diocese&rsquo;s form.</p>
              {ORDINATION_QUESTIONS[rank].map((question) => (
                <label key={question.key} className="camp-field">
                  <span className="camp-field__label">{question.label}</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={ORDINATION_ANSWER_MAX}
                    value={answers[question.key] ?? ''}
                    onChange={(event) => {
                      setAnswers({ ...answers, [question.key]: event.target.value });
                      setDirty(true);
                    }}
                  />
                </label>
              ))}

              <h4>Signatures</h4>
              {signatures.length === 0 ? <p className="note">Not signed yet.</p> : null}
              <ul className="ordination-signatures">
                {signatures.map((signature) => (
                  <li key={signature.uid}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise. */}
                    <img src={signature.image} alt={`${signature.name}'s signature`} />
                    <span>
                      {signature.name} · {formDay(signature.signedOn)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="ordination-actions">
                {canSign ? (
                  <button type="button" className="button button--ghost" onClick={sign}>
                    Sign as {mine?.name || session.name}
                  </button>
                ) : null}
                {signedByMe ? (
                  <button type="button" className="button button--quiet" onClick={unsign}>
                    Remove my signature
                  </button>
                ) : null}
              </p>
            </>
          ) : null}

          <label className="camp-field">
            <span className="camp-field__label">Note for the admins (not printed)</span>
            <textarea
              className="input"
              rows={2}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setDirty(true);
              }}
            />
          </label>

          {problems.length > 0 ? (
            <div className="notice notice--warn">
              <ul>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="ordination-actions">
            {application.status === 'pending' ? (
              <>
                <button type="button" className="button" disabled={saving} onClick={() => void decide('approved')}>
                  Approve
                </button>
                <button type="button" className="button button--ghost" disabled={saving} onClick={() => void decide('pending')}>
                  Save without deciding
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  disabled={saving}
                  onClick={() => {
                    if (window.confirm(`Reject the nomination of ${nominee.name}? Nobody is emailed.`)) void decide('rejected');
                  }}
                >
                  Reject
                </button>
              </>
            ) : null}
            {application.status === 'approved' ? (
              <>
                <button type="button" className="button" onClick={() => void print('open')}>
                  Print
                </button>
                <button type="button" className="button button--ghost" onClick={() => void print('download')}>
                  Download
                </button>
                {dirty ? (
                  <button type="button" className="button button--ghost" disabled={saving} onClick={() => void decide('approved')}>
                    Save changes
                  </button>
                ) : null}
                <button type="button" className="button button--quiet" disabled={saving} onClick={() => void decide('pending')}>
                  Move back to waiting
                </button>
              </>
            ) : null}
            {application.status === 'rejected' ? (
              <>
                <button type="button" className="button button--ghost" disabled={saving} onClick={() => void decide('pending')}>
                  Move back to waiting
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => {
                    if (!window.confirm(`Delete the nomination of ${nominee.name} for good?`)) return;
                    void deleteApplication(application.id).catch((cause: Error) => onError(cause.message));
                  }}
                >
                  Delete
                </button>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </article>
  );
}
