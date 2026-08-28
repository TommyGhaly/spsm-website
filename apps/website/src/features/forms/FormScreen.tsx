'use client';

import { useEffect, useState } from 'react';
import type { FormDefinition } from '@spsm/shared';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';
import { FormRenderer } from './FormRenderer';
import { VehicleForm } from './VehicleForm';
import { readFormBySlug, type WithId } from './data';

/**
 * Whichever form the URL names.
 *
 * ---------------------------------------------------------------------------
 * One exported page serves every form, and the slug comes from the address bar.
 *
 * There is no `app/forms/[slug]` route and no `generateStaticParams`. This is
 * `/form` — a single shell — and Hosting rewrites `/forms/**` onto it, the same
 * arrangement `/events/**` uses to reach `/gallery.html`. `next.config.mjs` adds
 * the matching rewrite for `next dev`, where Hosting is not in the picture.
 *
 * The reason is the requirement that staff can publish a form without a deploy.
 * Baking a page per form would mean a form created on Tuesday is a 404 until
 * somebody with deploy rights runs a build — which turns "add a form" from
 * something the office does into something it files a request for.
 *
 * What that costs: a form is not in the static HTML, so it is not indexable and
 * there is a moment of "Loading…" before it appears. Neither matters here.
 * `robots.ts` keeps these out of search on purpose — a search result for
 * "register a vehicle" is a wrong turn into a page that assumes you are already
 * in the car park — and nobody arrives at a form without following a link to it.
 *
 * The slug is read from `location.pathname` rather than a route param, because
 * under a rewrite the served file's own path is `/form` and the param would be
 * empty on every request.
 * ---------------------------------------------------------------------------
 */

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'form'; form: WithId<FormDefinition> };

export function FormScreen() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const slug = slugFromPath(window.location.pathname);
    if (!slug) {
      setState({ kind: 'missing' });
      return;
    }

    let cancelled = false;
    readFormBySlug(slug)
      .then((form) => {
        if (cancelled) return;
        // An unpublished form reads as missing rather than as an error. The
        // rules refuse the read to anyone without the staff claim, so a draft
        // is a 404 to the public — which is what it should look like.
        setState(form && form.published ? { kind: 'form', form } : { kind: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <>
        <PageHeader title="Form" />
        <PageBody>
          <p className="note">Loading…</p>
        </PageBody>
      </>
    );
  }

  if (state.kind === 'missing') {
    return (
      <>
        <PageHeader title="Form not found" />
        <PageBody>
          <p className="note">
            There is no form at this address. It may have been taken down.{' '}
            <a href="/forms">See the forms the church keeps online</a>.
          </p>
        </PageBody>
      </>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <PageHeader title="Form" />
        <PageBody>
          <p className="note">
            The form could not be loaded. Check your connection and reload the page.
          </p>
        </PageBody>
      </>
    );
  }

  const { form } = state;

  return (
    <>
      <PageHeader title={form.title} />
      <PageBody>
        {/*
          The picture, when the parish chose one, and deliberately a BAND rather
          than a hero.

          `/livestream` is the precedent and it was learned the hard way: a full
          header band there pushed the player below the fold and Tommy cut it.
          The same argument applies with more force to a form, where the point is
          the first question — so this is capped at 9rem and cropped wide, which
          is enough to set the tone and not enough to move the first field off a
          phone screen.

          Most forms have no picture and get nothing here. An empty decorative
          box would be worse than none.
        */}
        {form.image && (
          <div className="fx__banner">
            <img src={form.image} alt="" aria-hidden="true" loading="eager" decoding="async" />
          </div>
        )}
        {form.blurb && <p className="note">{form.blurb}</p>}
        <FormBody form={form} />
      </PageBody>
    </>
  );
}

function FormBody({ form }: { form: WithId<FormDefinition> }) {
  /*
   * Closed comes before everything else. A closed registration still has all
   * its fields, and rendering them with a notice above would leave a form that
   * looks fillable and refuses at the end — which wastes the ten minutes
   * somebody spent on it.
   */
  if (!form.open) {
    return (
      <div className="notice">
        <h2>This form is closed</h2>
        <p>{form.closedMessage ?? 'The church is no longer accepting submissions here.'}</p>
      </div>
    );
  }

  /*
   * An external form is somebody else's — Breeze, today. Linked rather than
   * rendered, because Breeze's API has no endpoint that accepts a submission:
   * a native copy of a Breeze form would collect answers Breeze never hears
   * about, while the office keeps checking Breeze and finding it empty.
   */
  if (form.kind === 'external' && form.externalUrl) {
    return (
      <p>
        <a className="button" href={form.externalUrl} rel="noopener noreferrer" target="_blank">
          Open the form
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
    );
  }

  if (form.kind === 'vehicle') {
    return <VehicleForm slug={form.slug} confirmation={form.confirmationMessage} />;
  }

  return <FormRenderer form={form} />;
}

/**
 * `/forms/van-request` → `van-request`.
 *
 * Tolerates the trailing slash and the `.html` a direct hit on the exported file
 * would carry, so a link written either way resolves to the same form.
 */
export function slugFromPath(pathname: string): string | null {
  const match = /^\/forms\/([^/]+?)(?:\.html)?\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
