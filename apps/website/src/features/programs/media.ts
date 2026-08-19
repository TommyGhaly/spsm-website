import {
  FIREBASE_STORAGE_ORIGIN,
  posterUrlFor,
  videoUrlFor,
  type GalleryMedia,
} from '@spsm/shared';
import { usingEmulators } from '@/lib/firebase';

/**
 * Where this build's gallery images actually come from.
 *
 * The shared helpers take a bucket and an origin because the mobile app needs
 * them too. On the website both answers are fixed for the whole build, so
 * threading them through every component as props was only ever a way to get
 * one of them wrong — which is exactly what happened: the origin was hardcoded
 * to production, and a site running entirely on emulators still fetched every
 * photograph from the parish's real bucket.
 *
 * Both are resolved once, here.
 */

/**
 * Next inlines `process.env.NEXT_PUBLIC_*` by literal textual match, so the
 * name is spelled out rather than looked up.
 */
function bucket(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
}

/**
 * The Storage emulator serves the same `/v0/b/{bucket}/o/{path}` shape as the
 * real thing, so pointing at it is a host swap and nothing more.
 *
 * `connectStorageEmulator` in `lib/firebase.ts` only redirects calls made
 * *through the SDK*. These URLs are built by hand — deliberately, to avoid a
 * `getDownloadURL` round trip per photograph — so they bypass that entirely and
 * have to be redirected here as well.
 */
function origin(): string {
  return usingEmulators() ? 'http://127.0.0.1:9199' : FIREBASE_STORAGE_ORIGIN;
}

/** What to show in a grid cell: the photograph, or a video's poster frame. */
export function galleryPosterUrl(media: {
  kind: string;
  renditionPath: string | null;
  posterPath: string | null;
}): string | null {
  return posterUrlFor(bucket(), media, origin());
}

/** The clip itself, fetched only once somebody asks to play it. */
export function galleryVideoUrl(media: {
  kind: string;
  renditionPath: string | null;
}): string | null {
  return videoUrlFor(bucket(), media, origin());
}

/** A bare path, for the few callers that hold one rather than a document. */
export function galleryPathUrl(path: string): string {
  return posterUrlFor(bucket(), { kind: 'photo', renditionPath: path, posterPath: null }, origin())!;
}

export type GalleryMediaLike = Pick<GalleryMedia, 'kind' | 'renditionPath' | 'posterPath'>;
