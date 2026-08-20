'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  hasAnyProgramGrant,
  type DocOf,
  type GalleryMedia,
  type ProgramAdmin,
  type SpsmClaims,
} from '@spsm/shared';
import {
  approve,
  listPending,
  myProgramAdmin,
  reject,
  reviewUrl,
  setCaption,
  type ReviewItem,
} from '@/features/programs/review';
import { auth } from '@/lib/auth';

/**
 * The queue where photographs sent by parishioners are approved or refused.
 *
 * Nothing a stranger uploads is visible anywhere on the site until it passes
 * through this screen. That makes it the single load-bearing piece of the
 * anonymous-upload model: `storage.rules` keeps the file unreadable,
 * `firestore.rules` keeps the document `pending`, and neither of them is a
 * decision — this is where the decision happens.
 *
 * ## Why each item is fetched with `getDownloadURL`
 *
 * Every other image on this site is an unauthenticated `?alt=media` URL built
 * by hand, and that is the right call for public files. It does not work here:
 * a pending submission lives under `submissions/`, the one prefix whose reads
 * are gated to staff, so an anonymous URL 403s by design. Each row therefore
 * resolves its own authenticated URL once, on mount, and holds it.
 */
export function GalleriesAdmin() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [grants, setGrants] = useState<ProgramAdmin | null>(null);
  const [claims, setClaims] = useState<SpsmClaims | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ids currently being written, so a second click cannot double-submit. */
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const uid = auth().currentUser?.uid ?? null;

  const load = useCallback(async () => {
    const user = auth().currentUser;
    if (!user) return;
    try {
      const [mine, token] = await Promise.all([
        myProgramAdmin(user.uid),
        user.getIdTokenResult(),
      ]);
      const resolved: SpsmClaims = {
        role: (token.claims['role'] as SpsmClaims['role']) ?? 'member',
        groups: [],
      };
      setGrants(mine);
      setClaims(resolved);
      setItems(await listPending(resolved, mine));
    } catch (caught) {
      console.error('[galleries] could not load the queue:', caught);
      setError(
        'The queue could not be loaded. If this persists, the composite index for ' +
          'pending items may not be deployed yet.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(mediaId: string, decision: 'approve' | 'reject') {
    if (!uid || busy.has(mediaId)) return;
    setBusy((previous) => new Set(previous).add(mediaId));
    try {
      if (decision === 'approve') await approve(mediaId, uid);
      else await reject(mediaId, uid);
      // Dropped from the list rather than reloaded. The write has succeeded, the
      // document no longer matches `status == pending`, and a refetch would cost
      // a round trip to learn something already known.
      setItems((previous) => previous?.filter((item) => item.media.id !== mediaId) ?? null);
    } catch (caught) {
      console.error(`[galleries] could not ${decision} ${mediaId}:`, caught);
      setError(
        `That could not be saved. You may not have a grant on this program — ` +
          `approving a photograph needs one, and being staff is not enough.`,
      );
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(mediaId);
        return next;
      });
    }
  }

  if (error && items === null) return <p className="notice">{error}</p>;
  if (items === null || claims === null) return <p className="note">Loading the queue…</p>;

  if (!hasAnyProgramGrant(claims, grants)) {
    return (
      <div className="prose">
        <h1>Photographs awaiting review</h1>
        <p className="notice">
          You do not administer any of the parish&apos;s programs, so there is nothing
          here for you. An administrator grants this per program — being staff is not
          enough on its own.
        </p>
      </div>
    );
  }

  return (
    <div className="prose">
      <h1>Photographs awaiting review</h1>
      <p className="lede">
        Sent by parishioners. Nothing here is visible anywhere on the site until it is
        approved.
      </p>

      {error && <p className="notice">{error}</p>}

      {items.length === 0 ? (
        <p className="note">
          The queue is empty. Photographs appear here when somebody sends them from a
          gallery page — see <Link href="/events">Events</Link>.
        </p>
      ) : (
        <ul className="review-queue">
          {items.map((item) => (
            <ReviewRow
              key={item.media.id}
              item={item}
              busy={busy.has(item.media.id)}
              uid={uid}
              onApprove={() => act(item.media.id, 'approve')}
              onReject={() => act(item.media.id, 'reject')}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewRow({
  item,
  busy,
  uid,
  onApprove,
  onReject,
}: {
  item: ReviewItem;
  busy: boolean;
  uid: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [caption, setCaptionText] = useState(item.media.caption);

  useEffect(() => {
    let live = true;
    void reviewUrl(item.media).then((resolved) => {
      if (!live) return;
      setUrl(resolved);
      setResolving(false);
    });
    return () => {
      live = false;
    };
  }, [item.media]);

  /*
   * A caption is saved on blur rather than behind its own button.
   *
   * The reviewer's hands are already on approve and reject; a third button per
   * row is one more thing to forget. Saved before the decision is taken, so
   * approving immediately after typing does not lose the words.
   */
  async function saveCaption() {
    if (!uid || caption === item.media.caption) return;
    try {
      await setCaption(item.media.id, caption, uid);
    } catch (error) {
      console.error('[galleries] could not save the caption:', error);
    }
  }

  return (
    <li className="review-queue__item">
      <div className="review-queue__frame">
        {resolving && <span className="meta">loading…</span>}
        {!resolving && url === null && (
          /*
            No preview. Either the transcode failed or this is a video, which
            nothing here transcodes. Approving is still allowed — the Function
            falls back to publishing the original — but the reviewer is told
            plainly that they are deciding without having seen it.
          */
          <span className="meta">
            No preview{item.media.kind === 'video' ? ' — videos are not previewed' : ''}.
          </span>
        )}
        {url !== null &&
          (item.media.kind === 'video' ? (
            <video src={url} controls preload="metadata" />
          ) : (
            // `alt=""` because the caption below is the accessible name once one
            // is written, and an un-captioned pending photograph has no honest
            // description to give.
            <img src={url} alt="" />
          ))}
      </div>

      <div className="review-queue__detail">
        <p className="meta">{item.eventTitle}</p>

        <label className="review-queue__caption">
          <span className="visually-hidden">Caption</span>
          <input
            type="text"
            value={caption}
            placeholder="Caption (shown under the photograph)"
            maxLength={300}
            onChange={(e) => setCaptionText(e.target.value)}
            onBlur={saveCaption}
          />
        </label>

        <p className="review-queue__actions">
          <button className="button" onClick={onApprove} disabled={busy}>
            {busy ? 'Saving…' : 'Approve'}
          </button>{' '}
          <button className="button button--quiet" onClick={onReject} disabled={busy}>
            Refuse
          </button>
        </p>
      </div>
    </li>
  );
}
