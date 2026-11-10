'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ORDINATION_SIGNATURE_IMAGE_MAX,
  ORDINATION_SIGNER_ROLES,
  ORDINATION_SIGNER_ROLE_LABEL,
  sameOrdinationSigner,
  type OrdinationSignatureProfile,
  type OrdinationSignerRole,
} from '@spsm/shared';
import { deleteSignatureProfile, listSignatureProfiles, saveSignatureProfile, type WithId } from './data';
import { OrdinationError, OrdinationShell } from './OrdinationShell';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { SignatureUpload, type SignatureUploadHandle } from './SignatureUpload';
import { useOrdinationAdmin } from './useOrdinationAdmin';

/**
 * /admin/ordination/signature — the signatures on file.
 *
 * Any ordination admin may add as many as they like, for themselves or for
 * another priest or deacon, drawn here or uploaded from a photo and
 * digitized to black ink. Every admin can sign a nomination with any of
 * them. Whoever added one is the only one who can delete it. A nomination
 * keeps its own copy of the image, so deleting one here changes nothing
 * already signed.
 */
export function SignatureScreen() {
  const session = useOrdinationAdmin();
  const pad = useRef<SignaturePadHandle>(null);
  const upload = useRef<SignatureUploadHandle>(null);
  const [profiles, setProfiles] = useState<WithId<OrdinationSignatureProfile>[] | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<OrdinationSignerRole>('priest');
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [blank, setBlank] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    listSignatureProfiles()
      .then(setProfiles)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!session.canEdit) return;
    reload();
  }, [session.canEdit, reload]);

  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !session.name) return;
    prefilled.current = true;
    setName((current) => current || session.name);
  }, [session.name]);

  const onBlank = useCallback((empty: boolean) => setBlank(empty), []);

  function switchMode(next: 'draw' | 'upload') {
    setMode(next);
    setBlank(true);
  }

  async function save() {
    if (!session.uid) return;
    const signer = name.trim();
    if (!signer) {
      setError('Write whose signature this is.');
      return;
    }
    const image = (mode === 'draw' ? pad.current?.toDataUrl() : upload.current?.toDataUrl()) ?? '';
    if (!image) {
      setError(mode === 'draw' ? 'Sign in the box first.' : 'Choose a photo of the signature first.');
      return;
    }
    if (image.length > ORDINATION_SIGNATURE_IMAGE_MAX) {
      setError(
        mode === 'draw'
          ? 'That signature is too large to store. Clear it and sign a little smaller.'
          : 'That signature is too large to store. Move the slider left, or crop the photo closer to the ink.',
      );
      return;
    }
    // Someone already on file signs on one kind of line only.
    const existing = profiles?.find((profile) => sameOrdinationSigner(profile, { name: signer }));
    if (existing && existing.role !== role) {
      setError(`${existing.name} is already on file as ${ORDINATION_SIGNER_ROLE_LABEL[existing.role].toLowerCase()}.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveSignatureProfile(session.uid, { name: signer, role, image });
      pad.current?.clear();
      upload.current?.clear();
      setSaved(`Saved a signature for ${signer}.`);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove(profile: WithId<OrdinationSignatureProfile>) {
    if (!window.confirm(`Delete this signature of ${profile.name}? Nominations already signed with it keep it.`)) return;
    setError('');
    try {
      await deleteSignatureProfile(profile.id);
      setSaved('');
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // One heading per person, their signatures under it.
  const people: { name: string; role: OrdinationSignerRole; items: WithId<OrdinationSignatureProfile>[] }[] = [];
  for (const profile of profiles ?? []) {
    const person = people.find((entry) => sameOrdinationSigner(entry, profile));
    if (person) person.items.push(profile);
    else people.push({ name: profile.name, role: profile.role, items: [profile] });
  }

  return (
    <OrdinationShell session={session} tab="signature" title="Signatures">
      {error ? <OrdinationError error={error} /> : null}
      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <section className="camp-step ordination-panel">
            <h3>Signatures on file</h3>
            {profiles === null ? (
              <p className="note">Loading…</p>
            ) : people.length === 0 ? (
              <p className="note">
                None yet. Add one below. The diocese&rsquo;s form is signed by up to three parish
                priests and one parish deacon.
              </p>
            ) : (
              people.map((person) => (
                <div key={person.name} className="ordination-signer-group">
                  <h5>
                    {person.name} <span className="ordination-count">{ORDINATION_SIGNER_ROLE_LABEL[person.role]}</span>
                  </h5>
                  <ul className="ordination-signatures">
                    {person.items.map((profile) => (
                      <li key={profile.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise. */}
                        <img src={profile.image} alt={`${profile.name}'s signature`} />
                        <span>{profile.ownerUid === session.uid ? 'Added by you' : 'Added by another admin'}</span>
                        {profile.ownerUid === session.uid ? (
                          <button type="button" className="button button--quiet" onClick={() => void remove(profile)}>
                            Delete
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {saved ? <p className="note">{saved}</p> : null}
          </section>

          <section className="camp-step ordination-panel">
            <h3>Add a signature</h3>
            <label className="camp-field">
              <span className="camp-field__label">Whose signature</span>
              <input
                className="input"
                list="ordination-signers"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  const match = people.find((person) => sameOrdinationSigner(person, { name: event.target.value }));
                  if (match) setRole(match.role);
                }}
              />
              <datalist id="ordination-signers">
                {people.map((person) => (
                  <option key={person.name} value={person.name} />
                ))}
              </datalist>
              <span className="camp-field__hint">
                As it should be recorded, e.g. Fr. Mina Ibrahim. Use the same name to add another
                signature for someone already on file.
              </span>
            </label>
            <div className="camp-field">
              <span className="camp-field__label">Signs as</span>
              <div className="choice">
                {ORDINATION_SIGNER_ROLES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={role === option ? 'choice__opt is-on' : 'choice__opt'}
                    aria-pressed={role === option}
                    onClick={() => setRole(option)}
                  >
                    <span className="choice__name">{ORDINATION_SIGNER_ROLE_LABEL[option]}</span>
                  </button>
                ))}
              </div>
              <span className="camp-field__hint">
                Priests sign on the PARISH PRIEST(S) lines, the deacon on the PARISH DEACON/HEAD
                of DIACONATE MINISTRY line.
              </span>
            </div>
            <div className="camp-field">
              <span className="camp-field__label">How</span>
              <div className="choice">
                {(['draw', 'upload'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={mode === option ? 'choice__opt is-on' : 'choice__opt'}
                    aria-pressed={mode === option}
                    onClick={() => switchMode(option)}
                  >
                    <span className="choice__name">{option === 'draw' ? 'Draw it' : 'Upload a photo'}</span>
                  </button>
                ))}
              </div>
            </div>
            {mode === 'draw' ? (
              <SignaturePad ref={pad} onChange={onBlank} />
            ) : (
              <SignatureUpload ref={upload} onChange={onBlank} />
            )}
            <p className="ordination-actions">
              <button type="button" className="button" disabled={saving || blank} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save signature'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={blank}
                onClick={() => (mode === 'draw' ? pad.current?.clear() : upload.current?.clear())}
              >
                Clear
              </button>
            </p>
          </section>
        </div>
      </section>
    </OrdinationShell>
  );
}
