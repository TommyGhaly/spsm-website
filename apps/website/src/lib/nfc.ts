/**
 * The website's half of the NFC tag statistics: the steps after a tap that
 * opened `public/c/<slug>.html` — the `web` path.
 *
 * ---------------------------------------------------------------------------
 * The fallback page itself is static HTML written by
 * `scripts/make-clip-pages.mjs`, and it is that page's inline script which
 * mints the visit, reports the scan and leaves the visit in `sessionStorage`
 * under `STORAGE_KEY`. Same origin, same tab: when the person follows the
 * page's button to /bookstore or /forms, this module finds it there.
 *
 * From then on, for `NFC_VISIT_WINDOW_MINUTES` after the last thing they did,
 * the steps this site reports are credited to that tap, and the checkout and
 * the form carry it so the server credits the money too. No visit — anybody
 * who arrived any other way — and every call here does nothing.
 *
 * `sessionStorage` rather than `localStorage`, so the visit dies with the tab
 * and never becomes an id that recognises somebody next week. Do Not Track is
 * honoured, for the reason `features/bookstore/track.ts` gives.
 *
 * The model is packages/shared/src/analytics/nfc.ts. This file and the inline
 * script in make-clip-pages.mjs must agree on the key and the record's shape.
 * ---------------------------------------------------------------------------
 */
import {
  NFC_VISIT_WINDOW_MINUTES,
  parseNfcAttribution,
  type NfcAttribution,
  type NfcClientAction,
} from '@spsm/shared';

/** Shared with the inline script in scripts/make-clip-pages.mjs. */
export const NFC_STORAGE_KEY = 'spsm.nfc';

const WINDOW_MS = NFC_VISIT_WINDOW_MINUTES * 60_000;

function allowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const dnt =
      navigator.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack;
    if (dnt === '1' || dnt === 'yes') return false;
  } catch {
    /* No such property. Nothing to honour. */
  }
  return true;
}

/**
 * The visit in force, or null. Each call that finds one keeps it alive, so the
 * window runs from the last thing the person did rather than from the tap.
 */
export function nfcAttribution(): NfcAttribution | null {
  if (!allowed()) return null;
  try {
    const raw = window.sessionStorage.getItem(NFC_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { nfc?: unknown; lastActive?: unknown };
    const nfc = parseNfcAttribution(stored.nfc);
    const lastActive = typeof stored.lastActive === 'number' ? stored.lastActive : 0;
    if (!nfc || Date.now() - lastActive > WINDOW_MS) {
      window.sessionStorage.removeItem(NFC_STORAGE_KEY);
      return null;
    }
    window.sessionStorage.setItem(NFC_STORAGE_KEY, JSON.stringify({ nfc, lastActive: Date.now() }));
    return nfc;
  } catch {
    // Storage refused — a private window, a blocked site. No visit.
    return null;
  }
}

/** `{ nfc }` to spread into a checkout or form body, or nothing. */
export function nfcBody(): { nfc?: NfcAttribution } {
  const nfc = nfcAttribution();
  return nfc ? { nfc } : {};
}

/**
 * Report one step of the visit in force. Never awaited, never throws.
 *
 * `keepalive`, because several of these fire on a click that leaves the page
 * — the give button, a store badge — and an ordinary fetch is cancelled with
 * the page that started it.
 */
export function reportNfc(action: Exclude<NfcClientAction, 'scan'>): void {
  const nfc = nfcAttribution();
  if (!nfc) return;
  void fetch('/api/nfc/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...nfc, action }),
    keepalive: true,
  }).catch(() => {
    /* Offline, or refused. A statistic, not a sale. */
  });
}
