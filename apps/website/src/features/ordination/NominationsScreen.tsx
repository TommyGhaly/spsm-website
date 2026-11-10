'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ORDINATION_ANSWER_MAX,
  ORDINATION_MAX_SIGNATURES_BY_ROLE,
  sameOrdinationSigner,
  ORDINATION_SIGNER_ROLES,
  ORDINATION_QUESTIONS,
  ORDINATION_RANKS,
  ORDINATION_RANK_INFO,
  PARISH_TIME_ZONE,
  ageOn,
  composeOrdinationAnswer,
  formDay,
  isCalendarDay,
  ordinationDecisionEmail,
  ORDINATION_REQUIREMENTS_FILES,
  ordinationRecipients,
  longDay,
  ordinationAccepting,
  ordinationRankLabel,
  ordinationTitle,
  splitOrdinationAnswer,
  tidyOrdinationAnswer,
  todayIn,
  validateOrdinationApproval,
  type Ordination,
  type OrdinationApplication,
  type OrdinationEmailKind,
  type OrdinationRank,
  type OrdinationSignature,
  type OrdinationSignatureProfile,
  type OrdinationStatus,
} from '@spsm/shared';
import {
  deleteApplication,
  deleteOrdination,
  listSignatureProfiles,
  saveReview,
  updateOrdination,
  watchApplications,
  watchOrdination,
  type WithId,
} from './data';
import { OrdinationError, OrdinationShell } from './OrdinationShell';
import { approvalListHtml, openApprovalList } from './approvalList';
import {
  ATTACHMENTS_MAX_BYTES,
  bytesToBase64,
  fileToAttachment,
  sendDecisionEmail,
  type EmailAttachment,
} from './notify';

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
 *     parish answers by picking Yes or No (and so on) with an optional line of
 *     detail, and a button per priest or deacon with a signature on file at
 *     /admin/ordination/signature. Whoever is preparing the nomination adds
 *     them, up to the form's three priests and one deacon, so it does not take
 *     four sign-ins. Approving needs every answer and at least one priest's
 *     signature; rejecting needs neither.
 *   - **Approved** ones can be printed one at a time, gain more signatures,
 *     or be moved back.
 *   - Any nomination, whatever its status, can be deleted.
 *   - Nominations are listed by rank, and so is the **application**: each
 *     rank's own cover listing its approved nominees, then, per nominee, the
 *     requirements page carrying that nominee's own signatures and their
 *     nominee page, then the rank's guidelines.
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
  const [onFile, setOnFile] = useState<WithId<OrdinationSignatureProfile>[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Bumped by "Expand all" / "Collapse all"; every fold follows the latest. */
  const [foldAll, setFoldAll] = useState<FoldSignal>({ open: true, n: 0 });

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
    if (!session.canEdit) return;
    listSignatureProfiles()
      .then(setOnFile)
      .catch((cause: Error) => console.warn('[ordination] could not read the signatures on file', cause));
  }, [session.canEdit]);

  const approved = (applications ?? []).filter((row) => row.status === 'approved');

  async function printApplication(mode: 'open' | 'download') {
    if (!ordination || approved.length === 0) return;
    const tab = mode === 'open' ? reserveTab() : null;
    setBusy(true);
    try {
      const { buildOrdinationApplication, downloadPdf, openPdf, packetFilename } = await packet();
      const bytes = await buildOrdinationApplication(ordination, approved);
      if (mode === 'open') openPdf(bytes, tab);
      else downloadPdf(bytes, packetFilename(null, ordination.date, 'application'));
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

              {onFile && onFile.length === 0 ? (
                <div className="notice">
                  <p>
                    No signature is on file, so nothing can be signed yet.{' '}
                    <a href="/admin/ordination/signature">Add one</a> by drawing it or uploading a
                    photo of it.
                  </p>
                </div>
              ) : null}

              {applications.some((row) => row.status !== 'rejected') ? (
                <p className="ordination-actions ordination-group">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => {
                      try {
                        openApprovalList(window.open('', '_blank'), approvalListHtml(ordination, applications));
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : String(cause));
                      }
                    }}
                  >
                    Print approval list
                  </button>
                </p>
              ) : null}

              {approved.length > 0 ? (
                <p className="ordination-actions ordination-group">
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void printApplication('open')}
                  >
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
                </p>
              ) : null}

              {applications.length === 0 ? (
                <p className="note ordination-group">
                  No nominations yet. They arrive here from the Forms page while this ordination is
                  open.
                </p>
              ) : null}

              {applications.length > 0 ? (
                <p className="ordination-actions ordination-group">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setFoldAll((last) => ({ open: true, n: last.n + 1 }))}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setFoldAll((last) => ({ open: false, n: last.n + 1 }))}
                  >
                    Collapse all
                  </button>
                </p>
              ) : null}

              {ORDINATION_RANKS.map((rank) => {
                const ofRank = applications.filter((row) => row.rank === rank);
                if (ofRank.length === 0) return null;
                return (
                  <Fold
                    key={rank}
                    as="section"
                    className="ordination-group ordination-rank"
                    signal={foldAll}
                    head={
                      <h3 className="ordination-fold__title">
                        {ordinationRankLabel(rank)} <span className="ordination-count">{ofRank.length}</span>
                      </h3>
                    }
                  >
                    {groups.map((group) => {
                      const rows = ofRank.filter((row) => row.status === group.status);
                      if (rows.length === 0 && !group.empty) return null;
                      return (
                        <Fold
                          key={group.status}
                          className="ordination-status"
                          signal={foldAll}
                          head={
                            <h4 className="ordination-fold__title">
                              {group.title} <span className="ordination-count">{rows.length}</span>
                            </h4>
                          }
                        >
                          {rows.length === 0 ? <p className="note">{group.empty}</p> : null}
                          {rows.map((row) => (
                            <Nomination
                              key={row.id}
                              application={row}
                              ordination={ordination}
                              session={session}
                              onFile={onFile ?? []}
                              onError={setError}
                              signal={foldAll}
                            />
                          ))}
                        </Fold>
                      );
                    })}
                  </Fold>
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
  const [closesOn, setClosesOn] = useState(ordination.closesOn);
  const [churchName, setChurchName] = useState(ordination.churchName);
  const [churchAddress, setChurchAddress] = useState(ordination.churchAddress);

  async function run(work: () => Promise<void>) {
    try {
      await work();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const accepting = ordinationAccepting(ordination, todayIn(PARISH_TIME_ZONE));

  const deadline = (() => {
    if (!isCalendarDay(ordination.date)) return '';
    const day = new Date(`${ordination.date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 3);
    return longDay(day.toISOString().slice(0, 10));
  })();

  return (
    <section className="camp-step ordination-settings">
      <h3>{longDay(ordination.date)}</h3>
      <p>
        {accepting
          ? `Taking nominations on the Forms page${ordination.closesOn ? ` through ${longDay(ordination.closesOn)}` : ''}`
          : ordination.open && ordination.closesOn
            ? `Closed: the last day to apply was ${longDay(ordination.closesOn)}. Move it later to reopen.`
            : 'Closed to new nominations'}
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
              <span className="camp-field__label">Last day to apply</span>
              <input
                type="date"
                className="input"
                value={closesOn}
                max={date || undefined}
                onChange={(event) => setClosesOn(event.target.value)}
              />
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
              disabled={!isCalendarDay(date) || (closesOn !== '' && (!isCalendarDay(closesOn) || closesOn > date))}
              onClick={() =>
                uid &&
                void run(async () => {
                  await updateOrdination(
                    ordination.id,
                    { date, closesOn, churchName: churchName.trim(), churchAddress: churchAddress.trim() },
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
    answers['fatherOfConfession'] = application.nominee.fatherOfConfession;
  }
  return answers;
}

/** A request from "Expand all" / "Collapse all"; `n` changes on every click. */
type FoldSignal = { open: boolean; n: number };

/** A heading that folds away what is under it, and follows Expand/Collapse all. */
function Fold({
  as: Tag = 'div',
  className,
  head,
  signal,
  children,
}: {
  as?: 'div' | 'section';
  className: string;
  head: ReactNode;
  signal: FoldSignal;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (signal.n > 0) setOpen(signal.open);
  }, [signal]);
  return (
    <Tag className={className}>
      <button type="button" className="ordination-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ordination-fold__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {head}
      </button>
      {open ? children : null}
    </Tag>
  );
}

function Nomination({
  application,
  ordination,
  session,
  onFile,
  onError,
  signal,
}: {
  application: WithId<OrdinationApplication>;
  ordination: WithId<Ordination>;
  session: OrdinationAdminSession;
  onFile: WithId<OrdinationSignatureProfile>[];
  onError: (message: string) => void;
  signal: FoldSignal;
}) {
  const [open, setOpen] = useState(application.status === 'pending');
  useEffect(() => {
    if (signal.n > 0) setOpen(signal.open);
  }, [signal]);
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
  // Signers not on this nomination yet whose role still has a free line:
  // three priests and one deacon, as on the form.
  const roleFull = (role: OrdinationSignature['role']) =>
    signatures.filter((signature) => signature.role === role).length >= ORDINATION_MAX_SIGNATURES_BY_ROLE[role];
  // One signature per person, whichever of theirs on file is picked.
  const unsigned = onFile.filter(
    (profile) => !roleFull(profile.role) && !signatures.some((signature) => sameOrdinationSigner(signature, profile)),
  );

  function sign(profile: WithId<OrdinationSignatureProfile>) {
    setSignatures([
      ...signatures,
      {
        uid: profile.id,
        name: profile.name,
        image: profile.image,
        signedOn: today(),
        role: profile.role,
        ...(session.uid ? { signedByUid: session.uid, signedByName: session.name } : {}),
      },
    ]);
    setDirty(true);
  }

  /**
   * Any signature, not only the signed-in priest's: a priest who has left, or
   * a signature added to the wrong nominee, has to be removable by whoever is
   * preparing the packet. Somebody else's asks first.
   */
  function unsign(signature: OrdinationSignature) {
    if (signature.signedByUid !== session.uid && signature.uid !== session.uid && !window.confirm(`Remove ${signature.name}'s signature from this nomination?`)) {
      return;
    }
    setSignatures(signatures.filter((entry) => entry.uid !== signature.uid));
    setDirty(true);
  }

  async function decide(status: OrdinationStatus) {
    if (!session.uid) return;
    if (status === 'approved') {
      const errors = validateOrdinationApproval(rank, answers, signatures);
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
              Object.entries(answers).map(([key, value]) => {
                const question = ORDINATION_QUESTIONS[rank].find((q) => q.key === key);
                const tidy = question ? tidyOrdinationAnswer(question, value) : value.trim();
                return [key, tidy.slice(0, ORDINATION_ANSWER_MAX)];
              }),
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
                <dd style={{ whiteSpace: 'pre-wrap' }}>{application.message}</dd>
              </>
            ) : null}
          </dl>

          {application.status !== 'rejected' ? (
            <>
              <h4>The parish&rsquo;s answers</h4>
              <p className="note">Printed on the nominee&rsquo;s page of the diocese&rsquo;s form.</p>
              {ORDINATION_QUESTIONS[rank].map((question) => {
                const parts = splitOrdinationAnswer(question, answers[question.key] ?? '');
                const set = (patch: Partial<typeof parts>) => {
                  setAnswers({ ...answers, [question.key]: composeOrdinationAnswer(question, { ...parts, ...patch }) });
                  setDirty(true);
                };
                // A name is one line; anything else may want a second line or a gap.
                const detail = question.detailFirst ? (
                  <input
                    className="input"
                    placeholder={question.detailHint}
                    aria-label="Father of confession"
                    maxLength={ORDINATION_ANSWER_MAX}
                    value={parts.detail}
                    onChange={(event) => set({ detail: event.target.value })}
                  />
                ) : (
                  <textarea
                    className="input"
                    rows={2}
                    placeholder={question.detailHint}
                    aria-label={`Detail for: ${question.label}`}
                    maxLength={ORDINATION_ANSWER_MAX}
                    value={parts.detail}
                    onChange={(event) => set({ detail: event.target.value })}
                  />
                );
                return (
                  <fieldset key={question.key} className="camp-field ordination-question">
                    <legend className="camp-field__label">{question.label}</legend>
                    {question.detailFirst ? detail : null}
                    <div className="choice">
                      {question.choices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className={parts.choice === choice ? 'choice__opt is-on' : 'choice__opt'}
                          aria-pressed={parts.choice === choice}
                          onClick={() => set({ choice: parts.choice === choice ? '' : choice })}
                        >
                          <span className="choice__name">{choice}</span>
                        </button>
                      ))}
                    </div>
                    {question.detailFirst ? null : detail}
                  </fieldset>
                );
              })}

              <h4>Signatures</h4>
              {ORDINATION_SIGNER_ROLES.map((role) => {
                const ofRole = signatures.filter((signature) => signature.role === role);
                const max = ORDINATION_MAX_SIGNATURES_BY_ROLE[role];
                const canAdd = unsigned.filter((profile) => profile.role === role);
                return (
                  <div key={role} className="ordination-signer-group">
                    <h5>
                      {role === 'priest' ? 'Parish priests' : 'Parish deacon'}{' '}
                      <span className="ordination-count">
                        {ofRole.length} of {max}
                      </span>
                    </h5>
                    {ofRole.length === 0 ? (
                      <p className="note">{role === 'priest' ? 'No priest has signed yet.' : 'The deacon has not signed yet.'}</p>
                    ) : null}
                    <ul className="ordination-signatures">
                      {ofRole.map((signature) => (
                        <li key={signature.uid}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise. */}
                          <img src={signature.image} alt={`${signature.name}'s signature`} />
                          <span>
                            {signature.name} · {formDay(signature.signedOn)}
                            {signature.signedByName && !sameOrdinationSigner(signature, { name: signature.signedByName })
                              ? ` · added by ${signature.signedByName}`
                              : ''}
                          </span>
                          <button type="button" className="button button--quiet" onClick={() => unsign(signature)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                    {canAdd.length > 0 ? (
                      <p className="ordination-actions">
                        {canAdd.map((profile) => (
                          <button
                            key={profile.id}
                            type="button"
                            className="button button--ghost ordination-sign-option"
                            onClick={() => sign(profile)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise. */}
                            <img src={profile.image} alt="" />
                            Sign as {profile.name}
                          </button>
                        ))}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : null}

          <label className="camp-field">
            <span className="camp-field__label">Note for the admins (not printed)</span>
            <textarea
              className="input"
              rows={4}
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

          {application.status !== 'pending' && !dirty ? (
            <DecisionEmail
              key={application.status}
              application={application}
              ordination={ordination}
              session={session}
              onError={onError}
            />
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
                    if (window.confirm(`Reject the nomination of ${nominee.name}? Nobody is emailed until you send it.`)) void decide('rejected');
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
              </>
            ) : null}
            {/*
             * On every nomination, not only a rejected one: a duplicate, a test,
             * or one sent by mistake should not have to be rejected first to be
             * got rid of. Nobody is emailed, and nothing reads it back.
             */}
            <button
              type="button"
              className="button button--danger"
              disabled={saving}
              onClick={() => {
                const warning =
                  application.status === 'approved'
                    ? `Delete the approved nomination of ${nominee.name}? Its answers and ${signatures.length === 1 ? 'signature' : 'signatures'} go with it, and it leaves the printed application.`
                    : `Delete the nomination of ${nominee.name}? This cannot be undone.`;
                if (!window.confirm(warning)) return;
                void deleteApplication(application.id).catch((cause: Error) => onError(cause.message));
              }}
            >
              Delete
            </button>
          </p>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The email to the nominee (and whoever filled the form in) about a decision.
 *
 * Nothing is sent by approving or rejecting; this panel appears once the
 * decision is saved, starts from the parish's default wording, and sends only
 * when the admin presses Send. A rejection is one of two kinds: a reason the
 * admin types, or "the father of confession must sign the printed form", which
 * attaches that nominee's packet automatically. Either kind, and an approval,
 * can carry files of the admin's own.
 */
function DecisionEmail({
  application,
  ordination,
  session,
  onError,
}: {
  application: WithId<OrdinationApplication>;
  ordination: WithId<Ordination>;
  session: OrdinationAdminSession;
  onError: (message: string) => void;
}) {
  const approved = application.status === 'approved';
  const [kind, setKind] = useState<OrdinationEmailKind>(approved ? 'approved' : 'rejected');
  const [reason, setReason] = useState('');
  const [edited, setEdited] = useState(false);
  const starting = (k: OrdinationEmailKind, why: string) => ordinationDecisionEmail(k, application, ordination, why);
  const [subject, setSubject] = useState(() => starting(kind, '').subject);
  const [text, setText] = useState(() => starting(kind, '').text);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  const to = ordinationRecipients(application);
  const last = application.emailsSent[application.emailsSent.length - 1];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  // The packet is ~250 KB of the allowance when it goes along.
  // An approval carries the requirements PDF for the nominee's rank (up to ~60 KB).
  const requirements = ORDINATION_REQUIREMENTS_FILES[application.rank];
  const allowance = ATTACHMENTS_MAX_BYTES - (kind === 'needsFather' ? 260_000 : kind === 'approved' ? 65_000 : 0);
  const fixedCount = kind === 'needsFather' || kind === 'approved' ? 1 : 0;

  function restart(nextKind: OrdinationEmailKind, nextReason: string) {
    const draft = starting(nextKind, nextReason);
    setSubject(draft.subject);
    setText(draft.text);
    setEdited(false);
  }

  async function send() {
    if (!window.confirm(`Send this email to ${to.join(' and ')}?`)) return;
    setSending(true);
    try {
      const attachments: EmailAttachment[] = await Promise.all(files.map(fileToAttachment));
      if (kind === 'approved') {
        const response = await fetch(requirements.path);
        if (!response.ok) throw new Error(`Could not load ${requirements.filename}.`);
        attachments.unshift({
          filename: requirements.filename,
          contentType: 'application/pdf',
          content: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
        });
      }
      if (kind === 'needsFather') {
        const { buildNomineePacket, packetFilename } = await packet();
        const bytes = await buildNomineePacket(application);
        attachments.unshift({
          filename: packetFilename(application.rank, ordination.date, application.nominee.name),
          contentType: 'application/pdf',
          content: bytesToBase64(bytes),
        });
      }
      const sent = await sendDecisionEmail({
        applicationId: application.id,
        kind,
        subject,
        text,
        sentByName: session.name,
        attachments,
      });
      setSentTo(sent);
      setFiles([]);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  }

  if (to.length === 0) {
    return <p className="note">No email address was given on this nomination, so nobody can be emailed about it.</p>;
  }

  return (
    <section className="ordination-email">
      <h4>Email the nominee</h4>
      <p className="note">
        To {to.join(' and ')}.
        {last ? ` Last emailed ${formDay(last.sentOn)} by ${last.sentByName}.` : ' Nothing has been sent yet.'}
      </p>

      {!approved ? (
        <div className="choice" role="radiogroup" aria-label="Why it was not approved">
          {(
            [
              ['rejected', 'Give a reason'],
              ['needsFather', 'Father of confession must sign the printed form'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kind === value ? 'choice__opt is-on' : 'choice__opt'}
              aria-pressed={kind === value}
              onClick={() => {
                if (edited && !window.confirm('Replace the message you edited with the default for this choice?')) return;
                setKind(value);
                restart(value, reason);
              }}
            >
              <span className="choice__name">{label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {kind === 'rejected' ? (
        <label className="camp-field">
          <span className="camp-field__label">Reason (added to the message)</span>
          <textarea
            className="input"
            rows={2}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (!edited) restart('rejected', event.target.value);
            }}
          />
        </label>
      ) : null}

      <label className="camp-field">
        <span className="camp-field__label">Subject</span>
        <input
          className="input"
          maxLength={200}
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            setEdited(true);
          }}
        />
      </label>
      <label className="camp-field">
        <span className="camp-field__label">Message</span>
        <textarea
          className="input"
          rows={9}
          maxLength={10_000}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setEdited(true);
          }}
        />
      </label>

      <div className="camp-field">
        <span className="camp-field__label">Attachments</span>
        <ul className="ordination-attachments">
          {kind === 'needsFather' ? (
            <li>
              The nominee&rsquo;s printed form (PDF) <span className="note">— attached automatically</span>
            </li>
          ) : null}
          {kind === 'approved' ? (
            <li>
              {requirements.filename} <span className="note">— attached automatically</span>
            </li>
          ) : null}
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              {file.name} <span className="note">({Math.ceil(file.size / 1024)} KB)</span>{' '}
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setFiles(files.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <input
          type="file"
          multiple
          aria-label="Attach files"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = '';
            setFiles([...files, ...picked].slice(0, 5 - fixedCount));
          }}
        />
        {totalBytes > allowance ? (
          <p className="ordination-problem">
            The attachments are too large together — keep them under {Math.floor(allowance / 1024)} KB.
          </p>
        ) : null}
      </div>

      {sentTo ? <p className="notice">Sent to {sentTo.join(' and ')}.</p> : null}

      <p className="ordination-actions">
        <button
          type="button"
          className="button"
          disabled={sending || !subject.trim() || !text.trim() || totalBytes > allowance}
          onClick={() => void send()}
        >
          {sending ? 'Sending…' : 'Send email'}
        </button>
        {edited ? (
          <button type="button" className="button button--quiet" onClick={() => restart(kind, reason)}>
            Reset to default wording
          </button>
        ) : null}
      </p>
    </section>
  );
}

