'use client';

import { useSyncExternalStore } from 'react';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { getServerSnapshot, getSnapshot, signIn, subscribe } from '@/lib/authStore';
import { useAdminAccess } from './sections';

/**
 * The admin screen, at /admin.
 *
 * ---------------------------------------------------------------------------
 * A list of the screens this person may use, and nothing else. No statistics,
 * no shortcuts, no summary of the parish — a landing page that tries to be
 * useful in its own right is a page somebody has to read past on the way to the
 * thing they came for.
 *
 * It is reached from the account menu, above Sign out, and only for people who
 * have something in it. See `sections.ts` for what belongs here and, more
 * importantly, what does not: nothing that can be edited in place has moved,
 * and nothing should.
 * ---------------------------------------------------------------------------
 */
export function AdminScreen() {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const access = useAdminAccess();

  if (auth.kind === 'restoring' || auth.kind === 'signing-in' || !access.ready) {
    return (
      <>
        <PageHeader title="Admin" />
        <PageBody>
          <p className="note">Loading…</p>
        </PageBody>
      </>
    );
  }

  if (auth.kind !== 'signed-in') {
    return (
      <>
        <PageHeader title="Admin" />
        <PageBody>
          <div className="notice">
            <h2>Sign in first</h2>
            <p>These screens are for the people who run the church&rsquo;s ministries.</p>
            <p>
              <button type="button" className="button" onClick={() => void signIn()}>
                Sign in with Microsoft
              </button>
            </p>
          </div>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Admin" />
      <PageBody>
        <section className="band">
          <div className="wrap">
            <h1 className="admin-hub__title">Admin</h1>

            {access.sections.length === 0 ? (
              /*
               * Signed in, and nothing here. Said plainly rather than hidden or
               * 404ed: somebody who followed a link they were sent needs to know
               * the difference between "you have not been given this" and "this
               * is broken", and only one of those is worth ringing the office
               * about.
               */
              <div className="notice">
                <h2>Nothing here for you yet</h2>
                <p>
                  These screens open when you are given a ministry to run. Most of the
                  site&rsquo;s editing is not here at all — it is on the page being edited, and
                  appears when you may use it.
                </p>
              </div>
            ) : (
              <ul className="admin-hub__list">
                {access.sections.map((section) => (
                  <li key={section.href}>
                    <a className="admin-hub__card" href={section.href}>
                      <h2>{section.title}</h2>
                      <p>{section.blurb}</p>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </PageBody>
    </>
  );
}
