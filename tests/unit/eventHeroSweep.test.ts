/**
 * Which of an event's photographs the editor is allowed to delete.
 *
 * ---------------------------------------------------------------------------
 * The one piece of the events editor that destroys anything, and the reason it
 * is tested at all is a bug that lasted two attempts.
 *
 * "Remove photograph" cleared `heroImagePath` and left the file in a bucket that
 * is `allow read: if true`, so the picture came off the page and stayed on the
 * internet. The first fix deleted the one path the document had named, from a
 * `useEffect` that waited for the autosave — and could not work, because
 * pressing Done unmounts the editor and takes the effect with it. Tommy, twice:
 * *"still not deleting from the storage when i delete in the events page."*
 *
 * What replaced it sweeps the whole `events/{slug}/` prefix, which is right —
 * the files nobody can otherwise reach are the ones no document ever named — and
 * is also the first version of this that can delete something somebody wants.
 * These are the two guards that stop it.
 * ---------------------------------------------------------------------------
 */
import { describe, expect, it } from 'vitest';
import { doomedFiles, uploadedAt } from '@/features/events/sweep';

const NOW = 1_770_000_000_000;
const GRACE = 15 * 60_000;

/** The listing shape `listAll` hands back, reduced to the two fields used. */
function object(name: string, slug = 'pascha') {
  return { name, fullPath: `events/${slug}/${name}` };
}

describe('uploadedAt', () => {
  it('reads the stamp `heroPath` writes into the name', () => {
    expect(uploadedAt(`hero-${NOW}.jpg`)).toBe(NOW);
    expect(uploadedAt('hero-1770000000000.webp')).toBe(1_770_000_000_000);
  });

  /*
   * Null, and the caller reads null as *old*. These are the files from before
   * uploads were stamped — which is to say, exactly the backlog the tidying
   * sweep was written to clear. Treating them as new would make it a no-op on
   * its only real workload.
   */
  it('gives up on a name it did not write, rather than guessing', () => {
    expect(uploadedAt('hero.jpg')).toBeNull();
    expect(uploadedAt('IMG_0042.HEIC')).toBeNull();
    expect(uploadedAt('preview-hero-1770000000000.webp')).toBeNull();
  });
});

describe('doomedFiles', () => {
  it('takes every file the event is not using', () => {
    const items = [object('hero-1.jpg'), object('hero-2.jpg'), object('hero-3.jpg')];
    const doomed = doomedFiles(items, {
      keep: 'events/pascha/hero-2.jpg',
      now: NOW,
      graceMs: 0,
    });
    expect(doomed.map((one) => one.name)).toEqual(['hero-1.jpg', 'hero-3.jpg']);
  });

  /*
   * The whole folder on a Remove. This is the sentence the feature is for: a
   * removal that leaves the predecessors behind is the bug, not a tidier
   * version of the fix.
   */
  it('empties the folder when the event is keeping nothing', () => {
    const items = [object('hero-1.jpg'), object('hero-2.jpg')];
    expect(doomedFiles(items, { keep: null, now: NOW, graceMs: 0 })).toHaveLength(2);
  });

  it('never takes the file the document names', () => {
    const items = [object('hero-9.jpg')];
    expect(
      doomedFiles(items, { keep: 'events/pascha/hero-9.jpg', now: NOW, graceMs: 0 }),
    ).toEqual([]);
  });

  /*
   * The race the grace window exists for, written out.
   *
   * The editor lists the folder when it opens, using the document it just read.
   * If somebody chooses a photograph while that listing is in flight, the new
   * object is not in the document the sweep is holding — so without a window it
   * is an orphan by every test the sweep can make, and it is deleted seconds
   * after being chosen. The person sees an upload succeed and the picture
   * vanish.
   */
  it('spares a photograph chosen while the listing was in flight', () => {
    const justNow = object(`hero-${NOW - 4_000}.jpg`);
    expect(doomedFiles([justNow], { keep: null, now: NOW, graceMs: GRACE })).toEqual([]);
  });

  it('still takes a file that has been stranded longer than the window', () => {
    const old = object(`hero-${NOW - GRACE - 1}.jpg`);
    expect(
      doomedFiles([old], { keep: null, now: NOW, graceMs: GRACE }).map((one) => one.name),
    ).toEqual([old.name]);
  });

  /*
   * A removal somebody pressed is not a race. They are looking at the event and
   * have said what they want, so the window is zero and even a file uploaded a
   * moment ago goes — which is exactly what "Replace, then Remove" means.
   */
  it('honours a removal made deliberately, however new the file is', () => {
    const fresh = object(`hero-${NOW}.jpg`);
    expect(doomedFiles([fresh], { keep: null, now: NOW, graceMs: 0 })).toHaveLength(1);
  });

  /* The backlog: unstamped names are old, so the tidying pass reaches them. */
  it('reaches the files that were stranded before uploads were stamped', () => {
    const legacy = object('hero.jpg');
    expect(doomedFiles([legacy], { keep: null, now: NOW, graceMs: GRACE })).toHaveLength(1);
  });
});
