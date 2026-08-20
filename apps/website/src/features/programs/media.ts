import { posterUrlFor, videoUrlFor, type GalleryMedia } from '@spsm/shared';
import { publicStorageUrl, storageBucket, storageOrigin } from '@/lib/storage';

/**
 * Turning a gallery document into an image URL.
 *
 * The shared helpers take a bucket and an origin because the mobile app needs
 * them too. On the website both answers are fixed for the whole build, so
 * threading them through every component as props was only ever a way to get
 * one of them wrong — which is exactly what happened: the origin was hardcoded
 * to production, and a site running entirely on emulators still fetched every
 * photograph from the parish's real bucket.
 *
 * Both are resolved once, in `lib/storage.ts`, which event hero images read as
 * well. Keeping a private copy here is how that bug comes back.
 */

/** What to show in a grid cell: the photograph, or a video's poster frame. */
export function galleryPosterUrl(media: {
  kind: string;
  renditionPath: string | null;
  posterPath: string | null;
}): string | null {
  return posterUrlFor(storageBucket(), media, storageOrigin());
}

/** The clip itself, fetched only once somebody asks to play it. */
export function galleryVideoUrl(media: {
  kind: string;
  renditionPath: string | null;
}): string | null {
  return videoUrlFor(storageBucket(), media, storageOrigin());
}

/** A bare path, for the few callers that hold one rather than a document. */
export function galleryPathUrl(path: string): string {
  return publicStorageUrl(path);
}

export type GalleryMediaLike = Pick<GalleryMedia, 'kind' | 'renditionPath' | 'posterPath'>;
