import { describe, it, expect } from 'vitest';
import {
  parseGalleryPath,
  programHref,
  programEventHref,
  presentHref,
} from '../../apps/website/src/features/programs/route.js';

/**
 * The gallery URL parser.
 *
 * This is routing, done by hand, in the browser — normally the framework's job.
 * It is here because `output: 'export'` cannot emit a route for a camp created
 * after the last deploy, so the shell reads the address bar itself.
 *
 * Worth real tests because the failure is not a crash. A parser that takes one
 * segment too many shows a visitor the wrong parish program under a URL that
 * looks right, and nothing anywhere reports it.
 */

describe('parseGalleryPath', () => {
  it('reads a program', () => {
    expect(parseGalleryPath('/events/summercamp')).toEqual({
      kind: 'program',
      programSlug: 'summercamp',
    });
  });

  it('reads an event', () => {
    expect(parseGalleryPath('/events/summercamp/week-1-2027')).toEqual({
      kind: 'event',
      programSlug: 'summercamp',
      eventSlug: 'week-1-2027',
    });
  });

  it('ignores a trailing slash', () => {
    expect(parseGalleryPath('/events/summercamp/')).toEqual({
      kind: 'program',
      programSlug: 'summercamp',
    });
  });

  it('ignores a query string, which the presentation always carries', () => {
    expect(parseGalleryPath('/events/summercamp/week-1-2027?present=day-2')).toEqual({
      kind: 'event',
      programSlug: 'summercamp',
      eventSlug: 'week-1-2027',
    });
  });

  it('survives doubled slashes', () => {
    expect(parseGalleryPath('//events//summercamp//week-1-2027')).toEqual({
      kind: 'event',
      programSlug: 'summercamp',
      eventSlug: 'week-1-2027',
    });
  });

  it('decodes an escaped slug', () => {
    expect(parseGalleryPath('/events/st%20simon')).toEqual({
      kind: 'program',
      programSlug: 'st simon',
    });
  });

  /** Reachable by typing in the address bar; `decodeURIComponent` throws. */
  it('does not throw on a malformed escape', () => {
    expect(parseGalleryPath('/events/%zz')).toEqual({ kind: 'unknown' });
    expect(parseGalleryPath('/events/ok/%')).toEqual({ kind: 'unknown' });
  });

  it('rejects anything deeper than program/event', () => {
    expect(parseGalleryPath('/events/summercamp/week-1-2027/day-1')).toEqual({ kind: 'unknown' });
  });

  it('rejects paths outside /events', () => {
    for (const path of ['/', '/calendar', '/giving/summercamp', '/admin/events/x']) {
      expect(parseGalleryPath(path)).toEqual({ kind: 'unknown' });
    }
  });

  it('rejects /events itself, which is a real static page', () => {
    expect(parseGalleryPath('/events')).toEqual({ kind: 'unknown' });
    expect(parseGalleryPath('/events/')).toEqual({ kind: 'unknown' });
  });

  it('refuses the shell\'s own route as a program', () => {
    expect(parseGalleryPath('/events/gallery')).toEqual({ kind: 'unknown' });
  });
});

describe('href builders', () => {
  it('round-trips a program through parse', () => {
    expect(parseGalleryPath(programHref('summercamp'))).toEqual({
      kind: 'program',
      programSlug: 'summercamp',
    });
  });

  it('round-trips an event through parse', () => {
    expect(parseGalleryPath(programEventHref('summercamp', 'week-1-2027'))).toEqual({
      kind: 'event',
      programSlug: 'summercamp',
      eventSlug: 'week-1-2027',
    });
  });

  /** A slug with a space must survive being written into a link and read back. */
  it('round-trips a slug that needs escaping', () => {
    const href = programEventHref('st simon', 'outing 2027');
    expect(href).not.toContain(' ');
    expect(parseGalleryPath(href)).toEqual({
      kind: 'event',
      programSlug: 'st simon',
      eventSlug: 'outing 2027',
    });
  });

  it('builds presentation links at all three levels', () => {
    expect(presentHref('summercamp')).toBe('/events/summercamp?present=all');
    expect(presentHref('summercamp', 'week-1-2027')).toBe(
      '/events/summercamp/week-1-2027?present=all',
    );
    expect(presentHref('summercamp', 'week-1-2027', 'day-2')).toBe(
      '/events/summercamp/week-1-2027?present=day-2',
    );
  });

  it('leaves a presentation link parseable', () => {
    expect(parseGalleryPath(presentHref('summercamp', 'week-1-2027', 'day-2'))).toEqual({
      kind: 'event',
      programSlug: 'summercamp',
      eventSlug: 'week-1-2027',
    });
  });
});
