export { GivingPanel } from './GivingPanel';

/**
 * Public config, so it is read from the environment rather than Firestore —
 * Next inlines `NEXT_PUBLIC_*` by literal textual match, which is why the name
 * is spelled out here instead of looked up dynamically.
 */
export function givingUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_TITHELY_GIVING_URL;
  return url && !url.startsWith('REPLACE_ME') ? url : null;
}
