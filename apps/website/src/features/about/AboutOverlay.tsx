'use client';

import dynamic from 'next/dynamic';
import { useMemo, type ReactNode } from 'react';
import type { AboutSlug } from '@spsm/shared';
import { EditModeProvider, EditToggle, useEditMode } from '@/features/programs/editMode';
import { AboutOverlayProvider, type AboutCopy } from './context';
import { useAboutAdmin } from './useAboutAdmin';
import { useAboutDraft } from './useAboutDraft';
import { useLiveAbout } from './useLiveAbout';

/**
 * The editor is a chunk of its own, fetched the moment somebody presses Edit
 * and never before.
 *
 * `next/dynamic` rather than a plain import, and the difference is not
 * theoretical: /about/who-we-are is a page strangers arrive at from a search
 * result, and the editor pulls in the picture picker, the whole choices table
 * and `firebase/storage`. A static import would put all of it in the chunk
 * every one of those visitors downloads, to render nothing.
 *
 * `ssr: false` because it cannot render on the server — it reads Firestore with
 * the signed-in person's credentials — and because prerendering a control
 * nobody may use is work with no output.
 */
const AboutEditor = dynamic(() => import('./AboutEditor').then((m) => m.AboutEditor), {
  ssr: false,
});

/**
 * What wraps an About page: the live copy, edit mode, and the editor.
 *
 * ---------------------------------------------------------------------------
 * ## Server children as a prop
 *
 * `children` is the hand-written screen, rendered on the server, passed through
 * this client component untouched. That is what keeps `WhoScreen`,
 * `BeliefScreen` and `FutureScreen` server components: the prose, the plates,
 * the dated spines and the clergy roster are all still in the exported HTML and
 * still readable with JavaScript off. Only the slots and this shell are client
 * code.
 *
 * ## Where the copy comes from, in order
 *
 * 1. The **baked** override, read at build time and passed in by the route.
 *    This is the floor, and it has to travel through here as a prop: the slots
 *    read their words out of the context, so a `<Editable>` with nothing in the
 *    context renders its coded default no matter what the build read. That was
 *    a real bug — appended sections came through and every rewritten heading
 *    silently did not, because the sections are a server prop and the slots are
 *    not.
 * 2. The **live** override, fetched once on mount. Outranks the baked copy the
 *    moment it lands, and is null until then — which is what makes the first
 *    client render identical to the server's, and the swap hydration-safe.
 * 3. The **draft**, while somebody is editing. It outranks both, so the page
 *    updates as they type — the page *is* the preview, which is the whole
 *    reason this is edited in place rather than in a form at /admin. Undo moves
 *    the draft, so the page steps backwards with it.
 *
 * ## The live refresh stops while editing
 *
 * Deliberately: a fetch landing mid-sentence would overwrite the draft with
 * what Firestore held a moment ago, which is the person's own work minus the
 * last word they typed. `useLiveAbout` is disabled on edit, and the editor does
 * its own fresh read when it opens — see `readAboutOverride`.
 * ---------------------------------------------------------------------------
 */
export function AboutOverlay({
  page,
  baked,
  children,
}: {
  page: AboutSlug;
  /** What `getAboutOverride` read during `next build`. See point 1 above. */
  baked: AboutCopy;
  children: ReactNode;
}) {
  const admin = useAboutAdmin();

  return (
    <EditModeProvider allowed={admin.canEdit}>
      <Overlay page={page} baked={baked}>
        {children}
      </Overlay>
    </EditModeProvider>
  );
}

function Overlay({
  page,
  baked,
  children,
}: {
  page: AboutSlug;
  baked: AboutCopy;
  children: ReactNode;
}) {
  const edit = useEditMode();
  const live = useLiveAbout(page, !edit.on);

  /*
   * The draft, its writers and its undo history are one thing — see
   * `useAboutDraft`. They were inline here, and adding undo would have meant
   * threading four more props through `AboutEditor` to the bar.
   */
  const editor = useAboutDraft(edit.on);

  const value = useMemo(
    () => ({ page, current: editor.draft ?? live ?? baked, ops: editor.ops }),
    [page, editor.draft, editor.ops, live, baked],
  );

  return (
    <AboutOverlayProvider value={value}>
      {children}
      {edit.on ? (
        <AboutEditor page={page} editor={editor} />
      ) : (
        /*
          Only on the read-only branch. The editor draws its own Done inside its
          bar, and two fixed pills in the same corner is exactly the bug
          `EditorBar` was built to fix — see the note in `editMode.tsx`.
        */
        <EditToggle />
      )}
    </AboutOverlayProvider>
  );
}
