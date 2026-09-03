'use client';

import { useEffect, useState } from 'react';
import { builtInForm, parseFormDefinition, type FormDefinition } from '@spsm/shared';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';
import { BackLink } from '@/components/BackLink';
import { FormRenderer } from './FormRenderer';
import { FormEmbed } from './FormEmbed';
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
        setState(
          form && form.published ? { kind: 'form', form } : fallbackFor(slug) ?? { kind: 'missing' },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState(fallbackFor(slug) ?? { kind: 'error' });
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
          <BackLink href="/forms" label="Forms" />
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
          <BackLink href="/forms" label="Forms" />
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
          <BackLink href="/forms" label="Forms" />
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
          The way out, above the picture. Every form on this shell was reached
          from the hub at /forms, `PageHeader` renders nothing visible, and a
          form is long — so without this the only way back is the browser's own
          button. Tommy, 2 Sep 2026: *"all of the forms need a back arrow."*

          It sits above the band rather than under it: a control below a
          photograph reads as a caption on the photograph, and the point of it
          is to be the first thing at the top of the page.
        */}
        <BackLink href="/forms" label="Forms" />
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
        {/*
          The band is skipped on an embedded form, and that is not a small
          exception — it is the difference between the page reading as ours and
          reading as a pile of headers.

          A framed Breeze or Tithe.ly form arrives with its own crest and its own
          coloured header bar, which we cannot touch. Our band on top of that put
          four pieces of chrome above the first question: masthead, photograph,
          their crest, their bar. The picture still earns its keep on the card on
          /forms, which is where it was asked for.
        */}
        {form.image && form.kind !== 'embed' && (
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
   * Somebody else's form — Tithe.ly's or Breeze's — framed under our header and
   * our picture.
   *
   * The answers belong to whoever hosts it and stay there; see `FormEmbed` for
   * what that means and why the "open in a new tab" link above the frame is not
   * optional. An `embed` form with no address falls through to the renderer
   * below and shows an empty form, which the builder lints against.
   */
  if (form.kind === 'embed' && form.externalUrl) {
    return (
      <FormEmbed url={form.externalUrl} title={form.title} host={hostOf(form.externalUrl)} />
    );
  }

  /*
   * An external form is somebody else's. Linked rather than rendered, because
   * a form we do not host cannot accept a submission from us: a native copy
   * would collect answers its owner never hears about, while the office keeps
   * checking the other system and finding it empty.
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
 * Whose page this is, for the sentence under the frame.
 *
 * The bare hostname, minus a `www.` and minus a subdomain that says nothing —
 * "tithe.ly" rather than "give.tithe.ly", but "stphilopaterstmina.breezechms.com"
 * kept whole would be worse than useless, so it is trimmed to the registrable
 * part. Wrong for a two-part public suffix like `.co.uk`; neither host is one,
 * and a full PSL for one sentence is not a trade worth making.
 */
function hostOf(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    return parts.slice(-2).join('.');
  } catch {
    return 'another website';
  }
}

/**
 * The built-in definition for this address, when there is one.
 *
 * ---------------------------------------------------------------------------
 * Two forms have a copy in the code, and it is used exactly here.
 *
 * `/forms/vehicle-registration` is on an NFC tag in the car park and
 * `/forms/contact` is behind every "ask the church office" link on the site.
 * Neither address can be corrected by editing a file, so neither may depend on
 * a Firestore document existing and being readable: a seeder that has not been
 * run, a document somebody deleted from the console, or a network that is
 * simply down would otherwise turn a physical tag into a "form not found" page
 * on a Sunday morning.
 *
 * So a *failed or empty* read of one of those two slugs falls back to
 * `builtInForm`. Note the order — the stored document wins whenever there is
 * one, because staff edit these like any other form and this must never
 * overwrite that. This is the floor, not the source of truth.
 *
 * Every other slug is unaffected: no document, no form, 404 as before.
 * ---------------------------------------------------------------------------
 */
function fallbackFor(slug: string): { kind: 'form'; form: WithId<FormDefinition> } | null {
  const draft = builtInForm(slug);
  if (!draft) return null;
  console.warn(
    `[forms] ${slug} could not be read from Firestore; showing the built-in copy. ` +
      'Run `npm run forms -- --write` if the document is missing.',
  );
  /*
   * Through the parser rather than cast, so a built-in and a stored form are
   * the same shape by construction — including the audit fields, which this
   * copy has never had because it has never been written.
   */
  return { kind: 'form', form: { id: slug, ...parseFormDefinition(slug, draft) } };
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
