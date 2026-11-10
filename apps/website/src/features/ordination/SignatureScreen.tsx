'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ORDINATION_SIGNATURE_IMAGE_MAX,
  ORDINATION_SIGNER_ROLES,
  ORDINATION_SIGNER_ROLE_LABEL,
  type OrdinationSignatureProfile,
  type OrdinationSignerRole,
} from '@spsm/shared';
import { deleteSignatureProfile, readSignatureProfile, saveSignatureProfile } from './data';
import { OrdinationError, OrdinationShell } from './OrdinationShell';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { useOrdinationAdmin } from './useOrdinationAdmin';

/**
 * /admin/ordination/signature — a priest draws their signature once.
 *
 * It is kept on `ordinationSignatures/{uid}`, which only they can write, and
 * copied onto each nomination they sign. Redrawing it changes what they sign
 * from now on and nothing they have already signed — and so does deleting it:
 * the nominations keep their copies until somebody removes them there.
 */
export function SignatureScreen() {
  const session = useOrdinationAdmin();
  const pad = useRef<SignaturePadHandle>(null);
  const [profile, setProfile] = useState<OrdinationSignatureProfile | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<OrdinationSignerRole>('priest');
  const [blank, setBlank] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session.canEdit || !session.uid) return;
    let live = true;
    readSignatureProfile(session.uid)
      .then((found) => {
        if (!live) return;
        setProfile(found);
        setName(found.name || session.name);
        setRole(found.role);
      })
      .catch((cause: Error) => live && setError(cause.message));
    return () => {
      live = false;
    };
  }, [session.canEdit, session.uid, session.name]);

  async function save() {
    if (!session.uid) return;
    const image = pad.current?.toDataUrl() ?? '';
    if (!image) {
      setError('Sign in the box first.');
      return;
    }
    if (image.length > ORDINATION_SIGNATURE_IMAGE_MAX) {
      setError('That signature is too large to store. Clear it and sign a little smaller.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveSignatureProfile(session.uid, { name: name.trim() || session.name, role, image });
      setProfile({ name: name.trim() || session.name, role, image });
      pad.current?.clear();
      setSaved(true);
      setDeleted(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!session.uid) return;
    if (!window.confirm('Delete your signature on file? Nominations you have already signed keep it.')) return;
    setSaving(true);
    setError('');
    try {
      await deleteSignatureProfile(session.uid);
      setProfile({ name: profile?.name ?? '', role, image: '' });
      setSaved(false);
      setDeleted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <OrdinationShell session={session} tab="signature" title="My signature">
      {error ? <OrdinationError error={error} /> : null}
      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <section className="camp-step ordination-panel">
            <h3>Your signature on file</h3>
            {profile === null ? (
              <p className="note">Loading…</p>
            ) : profile.image ? (
              <figure className="signature-on-file">
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise. */}
                <img src={profile.image} alt={`${profile.name}'s signature`} />
                <figcaption>
                  {profile.name} · {ORDINATION_SIGNER_ROLE_LABEL[profile.role]}
                </figcaption>
              </figure>
            ) : (
              <p className="note">
                None yet. Draw one below. The diocese&rsquo;s form is signed by up to three
                parish priests and one parish deacon, so only they need one.
              </p>
            )}
            {saved ? <p className="note">Saved. It will be used on everything you sign from now on.</p> : null}
            {deleted ? (
              <p className="note">
                Deleted. Nominations you already signed still carry it; remove it from each one on
                its nomination if it should not be sent.
              </p>
            ) : null}
            {profile?.image ? (
              <p className="ordination-actions">
                <button type="button" className="button button--danger" disabled={saving} onClick={() => void remove()}>
                  Delete my signature
                </button>
              </p>
            ) : null}
          </section>

          <section className="camp-step ordination-panel">
            <h3>{profile?.image ? 'Draw a new one' : 'Draw your signature'}</h3>
            <label className="camp-field">
              <span className="camp-field__label">Your name as it should be recorded</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
              <span className="camp-field__hint">e.g. Fr. Mina Ibrahim</span>
            </label>
            <div className="camp-field">
              <span className="camp-field__label">You sign as</span>
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
            <SignaturePad ref={pad} onChange={setBlank} />
            <p className="ordination-actions">
              <button type="button" className="button" disabled={saving || blank} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save signature'}
              </button>
              <button type="button" className="button button--ghost" disabled={blank} onClick={() => pad.current?.clear()}>
                Clear
              </button>
            </p>
          </section>
        </div>
      </section>
    </OrdinationShell>
  );
}
