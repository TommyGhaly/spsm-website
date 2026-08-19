import { describe, it, expect } from 'vitest';
import {
  FIREBASE_STORAGE_ORIGIN,
  focalPosition,
  mediaUrl,
  posterUrlFor,
  videoUrlFor,
} from '@spsm/shared';

const BUCKET = 'spsm-database.firebasestorage.app';
const EMULATOR = 'http://127.0.0.1:9199';

describe('mediaUrl', () => {
  /**
   * Slashes included. The Firebase media API takes the whole object name as a
   * single path parameter, so an unencoded `/` reads as a URL separator and the
   * request 404s — on every photograph, since every gallery path is nested.
   */
  it('encodes the path, slashes and all', () => {
    expect(mediaUrl(BUCKET, 'galleries/summercamp/week-1/a.webp')).toBe(
      `${FIREBASE_STORAGE_ORIGIN}/v0/b/${BUCKET}/o/galleries%2Fsummercamp%2Fweek-1%2Fa.webp?alt=media`,
    );
  });

  it('encodes a space and an apostrophe in a filename', () => {
    const url = mediaUrl(BUCKET, "galleries/x/fr mina's blessing.webp");
    expect(url).not.toMatch(/ /);
    expect(url).toContain('%20');
  });

  it('defaults to the production origin', () => {
    expect(mediaUrl(BUCKET, 'galleries/a.webp').startsWith(FIREBASE_STORAGE_ORIGIN)).toBe(true);
  });

  /**
   * The regression this parameter exists for.
   *
   * The origin was hardcoded. With the whole site running on emulators, every
   * `<img>` still pointed at `firebasestorage.googleapis.com` — so no gallery
   * image could load locally, and a developer's machine quietly fetched from
   * the parish's real bucket while believing it was isolated. Caught by looking
   * at a rendered page, not by any test that existed at the time.
   */
  it('honours an explicit origin, so local development can reach the emulator', () => {
    expect(mediaUrl(BUCKET, 'galleries/a.webp', EMULATOR)).toBe(
      `${EMULATOR}/v0/b/${BUCKET}/o/galleries%2Fa.webp?alt=media`,
    );
  });
});

describe('posterUrlFor', () => {
  const photo = { kind: 'photo', renditionPath: 'galleries/a.webp', posterPath: null };
  const video = { kind: 'video', renditionPath: 'galleries/a.mp4', posterPath: 'galleries/a.jpg' };

  it('uses the rendition for a photograph', () => {
    expect(posterUrlFor(BUCKET, photo)).toContain('a.webp');
  });

  /** A grid shows a still; megabytes are only fetched when somebody plays it. */
  it('uses the poster frame for a video, never the clip', () => {
    const url = posterUrlFor(BUCKET, video)!;
    expect(url).toContain('a.jpg');
    expect(url).not.toContain('a.mp4');
  });

  /**
   * Approval and transcoding are two steps seconds apart. In between, the
   * document is approved and publicly readable with no file — a real state the
   * grid renders as "Processing…" rather than a broken image.
   */
  it('returns null while a rendition is still being made', () => {
    expect(posterUrlFor(BUCKET, { kind: 'photo', renditionPath: null, posterPath: null })).toBeNull();
  });

  it('returns null for a video whose poster is not ready', () => {
    expect(posterUrlFor(BUCKET, { kind: 'video', renditionPath: 'x.mp4', posterPath: null })).toBeNull();
  });

  it('passes the origin through', () => {
    expect(posterUrlFor(BUCKET, photo, EMULATOR)!.startsWith(EMULATOR)).toBe(true);
  });
});

describe('videoUrlFor', () => {
  it('is null for a photograph', () => {
    expect(videoUrlFor(BUCKET, { kind: 'photo', renditionPath: 'a.webp' })).toBeNull();
  });

  it('is the clip for a video', () => {
    expect(videoUrlFor(BUCKET, { kind: 'video', renditionPath: 'galleries/a.mp4' })).toContain('a.mp4');
  });
});

describe('focalPosition', () => {
  it('centres when nobody has said otherwise', () => {
    expect(focalPosition(null)).toBe('50.00% 50.00%');
    expect(focalPosition(undefined)).toBe('50.00% 50.00%');
  });

  it('expresses a focal point as percentages', () => {
    expect(focalPosition({ x: 0.25, y: 0.75 })).toBe('25.00% 75.00%');
  });

  /** A hand-edited document, or a drag that ended outside the frame. */
  it('clamps out-of-range values instead of emitting invalid CSS', () => {
    expect(focalPosition({ x: -3, y: 9 })).toBe('0.00% 100.00%');
  });

  it('falls back to centre on NaN rather than writing "NaN%" into a style', () => {
    expect(focalPosition({ x: Number.NaN, y: 0.5 })).toBe('50.00% 50.00%');
  });
});
