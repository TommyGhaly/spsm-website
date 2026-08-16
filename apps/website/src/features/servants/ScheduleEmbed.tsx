'use client';

import { useEffect, useRef, useState } from 'react';
import { getServantsSchedule, type ScheduleResult } from './data';

/**
 * The Breeze calendar, fetched and framed after sign-in.
 *
 * The iframe `src` arrives from Firestore at runtime and is never rendered into
 * the exported HTML — see the note in schema/servants.ts for why that matters.
 *
 * `sandbox` is set because this frames a third party. Breeze needs scripts and
 * same-origin to render its own grid, but nothing here should be able to
 * navigate the parent page or open a popup, and `allow-top-navigation` is
 * exactly how an embed turns into a redirect nobody authorised.
 */
export function ScheduleEmbed() {
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    void getServantsSchedule().then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Assign the src *after* the iframe is in the document, never as a JSX
   * attribute.
   *
   * Rendering `<iframe src={url}>` creates the element and gives it a src in
   * the same tick, and Breeze's calendar then draws its toolbar and no grid —
   * reproducibly, on a clean load. Reloading the very same element with the
   * very same URL and identical dimensions draws it correctly, which rules out
   * both sizing and the sandbox attribute (each was suspected and cleared).
   * Mounting first and assigning second reproduces the sequence that works.
   *
   * It also means the URL is never an attribute React could serialise into the
   * exported HTML — belt and braces on top of it being fetched at runtime.
   */
  useEffect(() => {
    if (result?.kind === 'ok' && frame.current) {
      frame.current.src = result.schedule.embedUrl;
    }
  }, [result]);

  if (result === null) return <p className="note">Loading the schedule…</p>;

  if (result.kind === 'denied') {
    return (
      <div className="notice notice--alarm">
        <h2>Not available to your account</h2>
        <p>
          You&apos;re signed in, but your account isn&apos;t marked as a servant. Ask the
          parish office to add you.
        </p>
      </div>
    );
  }

  if (result.kind === 'unset') {
    return (
      <div className="notice">
        <h2>Not set up yet</h2>
        <p>
          The schedule link hasn&apos;t been configured. An administrator sets it in{' '}
          <code>servantsConfig/schedule</code>.
        </p>
      </div>
    );
  }

  if (result.kind === 'error') {
    return (
      <div className="notice notice--alarm" role="alert">
        <h2>Couldn&apos;t load the schedule</h2>
        <p>{result.message}</p>
      </div>
    );
  }

  const { note, manageUrl } = result.schedule;

  return (
    <>
      {note && <p className="note">{note}</p>}

      {/* Breeze serves a fixed-width grid, so the frame scrolls rather than
          reflows on a phone. Better than scaling it into illegibility. */}
      <div className="embed embed--calendar">
        <iframe
          ref={frame}
          title="Servants schedule"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>

      {manageUrl && (
        <p className="note">
          <a href={manageUrl} target="_blank" rel="noopener noreferrer">
            Open it in Breeze
          </a>{' '}
          to change an assignment.
        </p>
      )}
    </>
  );
}
