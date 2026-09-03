'use client';

import { createContext, useContext } from 'react';
import type { AboutImage, AboutSection, AboutSlot, AboutSlug } from '@spsm/shared';

/**
 * What the copy on this page currently is, and — while editing — how to change it.
 *
 * ---------------------------------------------------------------------------
 * Two things travel together here because they answer the same question from
 * two directions. `current` is what a slot should show; `ops` is how the panel
 * and the inline textareas change it. Splitting them into two contexts would
 * mean every `<Editable>` subscribed to both.
 *
 * `current` is the *baked* copy on the first client render, always — never the
 * live one, even if the fetch has somehow already resolved. That is not an
 * oversight; it is what makes the swap hydration-safe. The server rendered from
 * the baked prop, so the first client render must too, and the live copy
 * arrives a moment later as a state update, which React is free to reconcile.
 * The bookstore's catalog does exactly this and for the same reason.
 *
 * It is only null when there is no provider at all — see `useAboutOverlay`.
 * ---------------------------------------------------------------------------
 */

export interface AboutCopy {
  slots: Record<string, AboutSlot>;
  sections: AboutSection[];
}

/** How the editor changes one declared slot. Null for everybody not editing. */
export interface AboutSlotOps {
  setText: (slot: string, text: string) => void;
  setImage: (slot: string, image: AboutImage | null) => void;
  /**
   * Forget this slot entirely, which restores the hand-written original.
   *
   * Not "write an empty string" — though that would work, because `copyOf`
   * reads a blank as no override. Removing the key keeps the document from
   * growing a tombstone every time somebody changes their mind.
   */
  revert: (slot: string) => void;
}

interface AboutOverlayValue {
  page: AboutSlug;
  /** The baked copy, then the live one, then the draft. Null with no provider. */
  current: AboutCopy | null;
  ops: AboutSlotOps | null;
}

const AboutOverlayContext = createContext<AboutOverlayValue | null>(null);

export const AboutOverlayProvider = AboutOverlayContext.Provider;

/**
 * Read the overlay.
 *
 * Returns a null-ish value rather than throwing when there is no provider: the
 * five About screens are also reachable from Storybook-ish contexts and from
 * `MoreOfAbout`, and a component that draws a paragraph should not be the thing
 * that decides a tree is malformed. With no provider every slot falls through to
 * its coded default, which is the correct behaviour.
 */
export function useAboutOverlay(): AboutOverlayValue {
  return useContext(AboutOverlayContext) ?? FALLBACK;
}

const FALLBACK: AboutOverlayValue = { page: 'who-we-are', current: null, ops: null };
