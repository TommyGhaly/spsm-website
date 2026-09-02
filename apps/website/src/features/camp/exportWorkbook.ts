'use client';

import {
  allocationWorkbookName,
  campAllocationWorkbook,
  type AllocationWorkbookInput,
} from '@spsm/shared';

/**
 * Save the allocation as an .xlsx file.
 *
 * ---------------------------------------------------------------------------
 * The whole of the browser's half of the export, which is small on purpose: the
 * sheets are laid out in `@spsm/shared/camp/allocationWorkbook.ts` so that the
 * Cloud Function which will push the same file into OneDrive produces the same
 * bytes. This module knows how to hand bytes to a browser, and nothing else.
 *
 * ## Why a download and not OneDrive, today
 *
 * Because a browser cannot hold a Microsoft Graph client secret, and this site
 * is a static export with no server to hide one in. Uploading to the church's
 * OneDrive needs a Cloud Function with an Entra app registration behind it —
 * `Files.ReadWrite.All`, admin consent, and a secret in Secret Manager — none
 * of which exists yet. That is a provisioning job, not a coding one, and
 * shipping a button that fails against credentials nobody has created would be
 * worse than shipping the download that works.
 *
 * When the registration exists, this file gains a second function that POSTs
 * the same bytes at a Function; `campAllocationWorkbook` does not change.
 *
 * ## The object URL is revoked, and it matters here
 *
 * A roster of two hundred children is a few hundred kilobytes, and this button
 * is pressed repeatedly — after every re-shuffle, to see whether the ratios came
 * out right. An un-revoked blob URL keeps its blob alive for the life of the
 * document, so twenty exports is twenty copies of the file held in memory. The
 * revoke is deferred by a tick because Safari cancels a download whose URL is
 * revoked in the same task that started it.
 * ---------------------------------------------------------------------------
 */
export function downloadAllocationWorkbook(input: AllocationWorkbookInput): void {
  const generatedAt = input.generatedAt ?? new Date();
  const bytes = campAllocationWorkbook({ ...input, generatedAt });

  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = allocationWorkbookName(input.allocation.season, generatedAt);
  /*
   * Appended to the document before it is clicked.
   *
   * A detached anchor's click is ignored by Firefox — it fires the event and
   * does nothing with it, so the button silently does nothing on one browser
   * and works on the rest. Two lines to avoid a bug nobody would find without
   * testing on the one browser the office does not use.
   */
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
