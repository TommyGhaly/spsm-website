'use client';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  ORDINATION_PACKET_LAYOUT,
  ORDINATION_RANKS,
  capOrdinationSignatures,
  formDay,
  nomineeAnswerLines,
  nomineeFieldValues,
  ordinationRankLabel,
  type NomineeField,
  type Ordination,
  type OrdinationApplication,
  type OrdinationRank,
  type OrdinationSignature,
  type PacketBlank,
} from '@spsm/shared';

/**
 * Filling in the diocese's ordination forms.
 *
 * ---------------------------------------------------------------------------
 * Two packets, both built from the rank's own PDF in `public/ordination/`:
 *
 *   - **One nominee's packet** — the requirements page with that nominee's
 *     priests' and deacon's signatures, their page, and the guidelines. This
 *     is the diocese's "blank" form, filled in.
 *   - **The ordination's application** — rank by rank: the rank's own cover
 *     listing the church and its approved nominees, then for each nominee
 *     their own signed requirements page and their nominee page, then the
 *     rank's guidelines. The whole submission in one file.
 *
 * Built in the browser with pdf-lib. Where each thing goes is
 * `ORDINATION_PACKET_LAYOUT` in @spsm/shared, which is pure data so the same
 * coordinates can be drawn by a Function when packets go to SharePoint.
 *
 * ## Answers that do not fit
 *
 * Each question has one ruled line and about two lines of room above it. An
 * answer is drawn on the line in 10pt, shrinks to 8pt to stay on one line, and
 * then wraps onto two at 7pt. Anything longer is cut at the end of the second line
 * with a pointer to a "continued" page added at the back, which carries every
 * long answer in full. Nothing typed is ever silently dropped.
 * ---------------------------------------------------------------------------
 */

const INK = rgb(0.05, 0.1, 0.35);

const templates = new Map<OrdinationRank, Promise<ArrayBuffer>>();

function template(rank: OrdinationRank): Promise<ArrayBuffer> {
  let pending = templates.get(rank);
  if (!pending) {
    pending = fetch(`/ordination/${rank}.pdf`).then((response) => {
      if (!response.ok) throw new Error(`Could not load the ${rank} form (${response.status}).`);
      return response.arrayBuffer();
    });
    // A failed fetch is not cached, so the next attempt tries again.
    pending.catch(() => templates.delete(rank));
    templates.set(rank, pending);
  }
  return pending;
}

/**
 * The standard PDF fonts only carry WinAnsi. A name typed with a character
 * outside it — Arabic, a Coptic letter, an emoji — would make pdf-lib throw and
 * the whole packet fail, so those characters are replaced first. The website
 * still shows exactly what was typed; only the paper is limited.
 */
function printable(font: PDFFont, value: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...value.replace(/\s+/g, ' ').trim()]
    .map((char) => (supported.has(char.codePointAt(0)!) ? char : '?'))
    .join('');
}

/** Draws one line of text in a blank, shrinking it to fit and cutting it if it still does not. */
function drawFitted(page: PDFPage, font: PDFFont, value: string, blank: PacketBlank, minSize = 7): void {
  let text = printable(font, value);
  if (!text) return;
  let size = blank.size;
  while (size > minSize && font.widthOfTextAtSize(text, size) > blank.width) size -= 0.5;
  while (text.length > 1 && font.widthOfTextAtSize(text, size) > blank.width) {
    text = `${text.slice(0, -2).trimEnd()}…`;
  }
  page.drawText(text, { x: blank.x, y: blank.y, size, font, color: INK });
}

/** Greedy word wrap at one size. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Continued {
  heading: string;
  question: string;
  answer: string;
}

/**
 * An answer on its ruled line, wrapping onto a second line above it when it
 * must. Returns false when it did not fit, having drawn as much as it could.
 */
function drawAnswer(page: PDFPage, font: PDFFont, value: string, blank: PacketBlank, note: string): boolean {
  const text = printable(font, value);
  if (!text) return true;

  for (let size = blank.size; size >= 8; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= blank.width) {
      page.drawText(text, { x: blank.x, y: blank.y, size, font, color: INK });
      return true;
    }
  }

  /*
   * Two lines at 7pt, eight points apart. The question above sits about
   * sixteen points over the rule to the bottom of its descenders, and this is
   * the largest pair that stays clear of it — 8pt on a 9.5pt leading printed
   * through the question's last word.
   */
  const size = 7;
  const lines = wrap(font, text, size, blank.width);
  const fits = lines.length <= 2;
  let shown = lines.slice(0, 2);
  if (!fits) {
    let last = shown[1]!;
    while (last && font.widthOfTextAtSize(`${last} … ${note}`, size) > blank.width) {
      last = last.split(' ').slice(0, -1).join(' ');
    }
    shown = [shown[0]!, `${last} … ${note}`];
  }
  // The first line sits above the second; the second is on the rule.
  const top = blank.y + size + 1;
  page.drawText(shown[0]!, { x: blank.x, y: shown.length === 2 ? top : blank.y, size, font, color: INK });
  if (shown[1]) page.drawText(shown[1], { x: blank.x, y: blank.y, size, font, color: INK });
  return fits;
}

/** A drawn signature fitted onto its line, or the signer's name if the image will not embed. */
async function drawSignature(
  output: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  signature: OrdinationSignature,
  line: { signature: PacketBlank; date: PacketBlank },
): Promise<void> {
  try {
    const image = await output.embedPng(signature.image);
    // Fitted into the line's width and about one and a half lines of height,
    // sitting on the rule the way a pen would.
    const scale = Math.min(line.signature.width / image.width, 26 / image.height);
    page.drawImage(image, {
      x: line.signature.x,
      y: line.signature.y - 5,
      width: image.width * scale,
      height: image.height * scale,
    });
  } catch (error) {
    console.warn('[ordination] could not draw a signature; printing the name instead', error);
    drawFitted(page, font, signature.name, line.signature);
  }
  drawFitted(page, font, formDay(signature.signedOn), line.date);
}

/** One nominee's signatures: priests on the three priest lines, the deacon on the deacon line. */
async function drawSignatures(
  output: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  rank: OrdinationRank,
  signatures: readonly OrdinationSignature[],
): Promise<void> {
  const layout = ORDINATION_PACKET_LAYOUT[rank];
  const kept = capOrdinationSignatures(signatures);
  const priests = kept.filter((signature) => signature.role === 'priest');
  for (const [index, signature] of priests.entries()) {
    await drawSignature(output, page, font, signature, layout.signatures[index]!);
  }
  const deacon = kept.find((signature) => signature.role === 'deacon');
  if (deacon) await drawSignature(output, page, font, deacon, layout.deacon);
}

function drawNominee(
  page: PDFPage,
  font: PDFFont,
  application: OrdinationApplication,
  continued: Continued[],
): void {
  const layout = ORDINATION_PACKET_LAYOUT[application.rank].nominee.fields;
  const values = nomineeFieldValues(application);
  for (const [key, value] of Object.entries(values) as [NomineeField, string][]) {
    const blank = layout[key];
    if (blank && value) drawFitted(page, font, value, blank);
  }
  for (const line of nomineeAnswerLines(application)) {
    if (!drawAnswer(page, font, line.text, line.blank, '(continued at the end)')) {
      continued.push({ heading: application.nominee.name, question: line.label, answer: line.text });
    }
  }
}

/** The "continued" pages: every answer too long for its line, in full. */
function addContinuation(output: PDFDocument, font: PDFFont, bold: PDFFont, continued: Continued[]): void {
  if (continued.length === 0) return;
  const margin = 54;
  const width = 612 - margin * 2;
  let page = output.addPage([612, 792]);
  let y = 792 - margin;

  const line = (text: string, use: PDFFont, size: number, gap: number) => {
    for (const piece of wrap(use, printable(use, text), size, width)) {
      if (y < margin + size) {
        page = output.addPage([612, 792]);
        y = 792 - margin;
      }
      page.drawText(piece, { x: margin, y, size, font: use, color: use === bold ? rgb(0, 0, 0) : INK });
      y -= size + 3;
    }
    y -= gap;
  };

  line('Answers continued', bold, 14, 10);
  let heading = '';
  for (const entry of continued) {
    if (entry.heading !== heading) {
      heading = entry.heading;
      line(heading, bold, 12, 4);
    }
    line(entry.question, bold, 10, 2);
    line(entry.answer, font, 10, 10);
  }
}

async function begin(rank: OrdinationRank) {
  const source = await PDFDocument.load(await template(rank));
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);
  return { source, output, font, bold, pages: ORDINATION_PACKET_LAYOUT[rank].pages };
}

/** One nominee's packet: requirements and signatures, their page, the guidelines. */
export async function buildNomineePacket(application: OrdinationApplication): Promise<Uint8Array> {
  const { source, output, font, bold, pages } = await begin(application.rank);
  const [signatures, nominee, guidelines] = await output.copyPages(source, [
    pages.signatures,
    pages.nominee,
    pages.guidelines,
  ]);
  const continued: Continued[] = [];

  output.addPage(signatures!);
  await drawSignatures(output, signatures!, font, application.rank, application.signatures);
  output.addPage(nominee!);
  drawNominee(nominee!, font, application, continued);
  output.addPage(guidelines!);
  addContinuation(output, font, bold, continued);

  output.setTitle(`${ordinationRankLabel(application.rank)} — ${application.nominee.name}`);
  return output.save();
}

/**
 * The whole application for one ordination, rank by rank — cantors, then
 * readers, then subdeacons — each from that rank's own form:
 *
 *   - the rank's cover, naming the church and only that rank's approved
 *     nominees (a cover holds twenty; a twenty-first starts a second copy
 *     rather than being left off),
 *   - for each nominee, the requirements page signed by *that nominee's*
 *     priests and deacon, then their nominee page,
 *   - the rank's guidelines.
 */
export async function buildOrdinationApplication(
  ordination: Ordination,
  approved: readonly OrdinationApplication[],
): Promise<Uint8Array> {
  const ranks = ORDINATION_RANKS.filter((rank) => approved.some((row) => row.rank === rank));
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);
  const continued: Continued[] = [];

  for (const rank of ranks) {
    const ofRank = approved
      .filter((row) => row.rank === rank)
      .sort((a, b) => a.nominee.name.localeCompare(b.nominee.name));
    const source = await PDFDocument.load(await template(rank));
    const layout = ORDINATION_PACKET_LAYOUT[rank];
    const { pages } = layout;
    const perCover = layout.cover.rows.length;
    const chunks = Array.from({ length: Math.ceil(ofRank.length / perCover) }, (_, at) =>
      ofRank.slice(at * perCover, (at + 1) * perCover),
    );
    /*
     * The rank's pages in one `copyPages` call. Copied one at a time, each page
     * brought its own copy of the crest and the cross, and twenty nominees made
     * a two-megabyte file; copied together they share one.
     */
    const copied = await output.copyPages(source, [
      ...chunks.map(() => pages.cover),
      ...ofRank.flatMap(() => [pages.signatures, pages.nominee]),
      pages.guidelines,
    ]);
    let at = 0;

    for (const chunk of chunks) {
      const cover = copied[at++]!;
      output.addPage(cover);
      drawFitted(cover, font, ordination.churchName, layout.cover.churchName);
      drawFitted(cover, font, ordination.churchAddress, layout.cover.churchAddress);
      chunk.forEach((application, index) => {
        const row = layout.cover.rows[index]!;
        drawFitted(cover, font, application.nominee.name, row.name);
        drawFitted(cover, font, formDay(application.nominee.dateOfBirth), row.dateOfBirth);
      });
    }

    for (const application of ofRank) {
      const signatures = copied[at++]!;
      output.addPage(signatures);
      await drawSignatures(output, signatures, font, rank, application.signatures);
      const nominee = copied[at++]!;
      output.addPage(nominee);
      drawNominee(nominee, font, application, continued);
    }

    output.addPage(copied[at]!);
  }
  addContinuation(output, font, bold, continued);

  output.setTitle(`Ordination nominations — ${formDay(ordination.date)}`);
  return output.save();
}

/** Hands a built packet to the browser as a download. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for every browser to have started the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Shows a built packet in a tab the click reserved (see `reserveTab` in NominationsScreen), where the browser's own viewer can print it. */
export function openPdf(bytes: Uint8Array, tab: Window | null): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  if (tab) tab.location.href = url;
  else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

/**
 * "Reader 2026-12-06 Mina Guirguis.pdf" for one nominee, "Ordination
 * 2026-12-06 application.pdf" for the whole thing — sorts by ordination in a folder.
 */
export function packetFilename(rank: OrdinationRank | null, date: string, name?: string): string {
  const title = rank ? ordinationRankLabel(rank).split(' ')[0] : 'Ordination';
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '').trim();
  return `${safe([title, date, name].filter(Boolean).join(' '))}.pdf`;
}
