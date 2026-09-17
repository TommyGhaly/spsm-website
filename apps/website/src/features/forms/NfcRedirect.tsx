'use client';

import { useEffect } from 'react';
import { CAMP_FORM_SLUG } from '@spsm/shared';
import { readFormsPageConfig } from './data';

/**
 * Sends a tap onward to whichever form the office has made the priority one.
 *
 * ---------------------------------------------------------------------------
 * Headless, and it renders nothing on purpose.
 *
 * The page it sits on draws the vehicle registration immediately, as it always
 * has, and this reads `config/forms` beside it. The alternative — hold the page
 * blank until the read answers, then draw the right form — was rejected: the
 * setting is the vehicle registration on every parish that has not changed it,
 * so that trade spends a spinner on everybody in the car park to spare a
 * redirect for the fortnight of the year the tag means something else.
 *
 * What it costs is a flash: when the destination *has* been changed, somebody
 * sees the vehicle form for as long as one world-readable document takes to
 * arrive. That is the right way round. A person standing at the tag with the
 * setting unchanged — which is nearly all of them, nearly all the time — gets
 * the page instantly.
 *
 * `window.location.replace` rather than a router push, for two reasons. The
 * site is a static export, so there is no server-side redirect to reach for;
 * and *replace* keeps the tag's own URL out of the history, so Back from the
 * form goes wherever the phone was before the tap rather than bouncing through
 * this page and being redirected again.
 *
 * A destination that names this page's own form is not a redirect at all, and
 * neither is one that names nothing — `parseFormsPageConfig` resolves an unset
 * or blank setting to the vehicle registration, which is what the tag has
 * always done and what must happen when Firestore cannot be reached.
 * ---------------------------------------------------------------------------
 */
export function NfcRedirect({ thisForm }: { thisForm: string }) {
  useEffect(() => {
    let cancelled = false;

    void readFormsPageConfig().then(({ nfcFormSlug }) => {
      if (cancelled || nfcFormSlug === thisForm) return;
      /*
       * The camp's sign-up is at `/forms/summer-camp` like any other card, so
       * one shape covers both. It is spelled out rather than folded into the
       * line below only because the constant is what names it everywhere else,
       * and a reader should not have to work out that they agree.
       */
      const href =
        nfcFormSlug === CAMP_FORM_SLUG
          ? `/forms/${CAMP_FORM_SLUG}`
          : `/forms/${nfcFormSlug}`;
      window.location.replace(href);
    });

    return () => {
      cancelled = true;
    };
  }, [thisForm]);

  return null;
}
