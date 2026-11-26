import type { Workbook, Worksheet } from 'exceljs';
import {
  ORDINATION_RANKS,
  ORDINATION_RANK_INFO,
  ageOn,
  type Ordination,
  type OrdinationApplication,
} from '@spsm/shared';

/**
 * A spreadsheet of every nominee still in the running (waiting or approved),
 * for ordering tunics: their details and their parents', then blank Height,
 * Tunic Size and Notes columns for whoever goes round measuring. A second tab
 * counts each size per rank, which is the order.
 *
 * Excel rather than a printed page because it gets filled in, sorted and
 * passed to whoever places the order. exceljs is large, so the screen imports
 * this file only when the button is pressed, as it does `./packet`.
 */

/** Offered in the Tunic Size column's dropdown, and counted on the Summary tab. Other sizes can still be typed. */
export const TUNIC_SIZES = ['Youth S', 'Youth M', 'Youth L', 'XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

const FONT = 'Arial';
const HEADER_FILL = 'FF1F3864';
const FILL_IN = 'FFFFFF00';
const WAITING = 'FFFCE4D6';
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } } as const;
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** Row of the column headers on the Tunic Sizes tab; nominees start on the next. */
const HEAD = 5;

const COLUMNS: { header: string; width: number; centre?: boolean; fillIn?: boolean }[] = [
  { header: '#', width: 5, centre: true },
  { header: 'Rank', width: 11, centre: true },
  { header: 'Name', width: 26 },
  { header: 'Date of Birth', width: 13, centre: true },
  { header: 'Age', width: 6, centre: true },
  { header: 'Grade / Occupation', width: 22 },
  { header: 'Phone', width: 15 },
  { header: 'Email', width: 30 },
  { header: 'Parent 1', width: 22 },
  { header: 'Parent 1 Phone', width: 15 },
  { header: 'Parent 2', width: 22 },
  { header: 'Parent 2 Phone', width: 15 },
  { header: 'Status', width: 10, centre: true },
  { header: 'Height', width: 10, centre: true, fillIn: true },
  { header: 'Tunic Size', width: 11, centre: true, fillIn: true },
  { header: 'Notes', width: 30, fillIn: true },
];

/** "(508) 330-8626" for a US number however it was typed; anything else as it came. */
export function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return phone.trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A `YYYY-MM-DD` day as a Date at UTC midnight. exceljs writes dates in UTC,
 * so a local midnight would land on the day before for anyone west of Greenwich.
 */
function excelDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** Waiting and approved nominees, by rank in ordination order and then by name. */
export function sizeSheetRows(applications: OrdinationApplication[]): OrdinationApplication[] {
  return applications
    .filter((row) => row.status !== 'rejected')
    .sort(
      (a, b) =>
        ORDINATION_RANKS.indexOf(a.rank) - ORDINATION_RANKS.indexOf(b.rank) ||
        a.nominee.name.trim().localeCompare(b.nominee.name.trim()),
    );
}

export async function buildSizeSheet(
  ordination: Ordination,
  applications: OrdinationApplication[],
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook: Workbook = new ExcelJS.Workbook();
  workbook.creator = 'St. Paul & St. Mark website';
  workbook.created = new Date();

  const rows = sizeSheetRows(applications);
  const sheet = workbook.addWorksheet('Tunic Sizes', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: HEAD }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEAD}:${HEAD}` },
  });
  fillNominees(sheet, ordination, rows);
  fillSummary(workbook.addWorksheet('Summary'), rows);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function fillNominees(sheet: Worksheet, ordination: Ordination, rows: OrdinationApplication[]) {
  sheet.getCell('A1').value = 'Ordination nominees: tunic sizes';
  sheet.getCell('A1').font = { name: FONT, bold: true, size: 14 };
  sheet.getCell('A2').value = 'Ordination date';
  sheet.getCell('A2').font = { name: FONT, bold: true };
  sheet.getCell('C2').value = excelDay(ordination.date);
  sheet.getCell('C2').numFmt = 'mmm d, yyyy';
  sheet.getCell('C2').font = { name: FONT };
  sheet.mergeCells(`A3:P3`);
  sheet.getCell('A3').value =
    'Fill in the yellow columns: Height, Tunic Size and Notes. For example: 5\'6", M, "needs longer sleeves". ' +
    'Everything else is from the website\'s ordination form. Age is on the ordination date above. ' +
    'Rows shaded orange are still waiting for approval.';
  sheet.getCell('A3').font = { name: FONT, italic: true, size: 9 };
  sheet.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(3).height = 30;

  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
    const cell = sheet.getCell(HEAD, index + 1);
    cell.value = column.header;
    cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BOX;
  });

  rows.forEach((row, index) => {
    const r = HEAD + 1 + index;
    const { nominee } = row;
    const [first, second] = row.parents;
    const age = ageOn(nominee.dateOfBirth, ordination.date);
    const values: unknown[] = [
      index + 1,
      ORDINATION_RANK_INFO[row.rank].title,
      nominee.name.trim(),
      excelDay(nominee.dateOfBirth),
      // A formula off the date cell, so it is right again if the date in C2 changes.
      { formula: `IF(D${r}="","",DATEDIF(D${r},$C$2,"y"))`, result: age ?? '' },
      (nominee.schoolGrade || nominee.occupation).trim(),
      formatPhone(nominee.phone),
      nominee.email.trim(),
      first?.name.trim() ?? '',
      formatPhone(first?.phone ?? ''),
      second?.name.trim() ?? '',
      formatPhone(second?.phone ?? ''),
      row.status === 'approved' ? 'Approved' : 'Waiting',
      null,
      null,
      null,
    ];
    values.forEach((value, c) => {
      const column = COLUMNS[c]!;
      const cell = sheet.getCell(r, c + 1);
      cell.value = value as never;
      cell.font = { name: FONT };
      cell.border = BOX;
      if (column.centre) cell.alignment = { horizontal: 'center' };
      const fill = column.fillIn ? FILL_IN : row.status === 'pending' ? WAITING : null;
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
    sheet.getCell(r, 4).numFmt = 'mmm d, yyyy';
    sheet.getCell(r, 15).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${TUNIC_SIZES.join(',')}"`],
      // A warning, not a refusal: a size that is not on the list can still be typed.
      showErrorMessage: false,
    };
  });

  if (rows.length > 0) sheet.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + rows.length, column: COLUMNS.length } };
}

function fillSummary(sheet: Worksheet, rows: OrdinationApplication[]) {
  const last = HEAD + Math.max(rows.length, 1);
  const range = (column: string) => `'Tunic Sizes'!$${column}$${HEAD + 1}:$${column}$${last}`;
  const ranks = ORDINATION_RANKS.map((rank) => ORDINATION_RANK_INFO[rank].title);
  const header = (r: number, labels: string[]) =>
    labels.forEach((label, c) => {
      const cell = sheet.getCell(r, c + 1);
      cell.value = label;
      cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.border = BOX;
    });
  const put = (r: number, c: number, value: unknown, bold = false) => {
    const cell = sheet.getCell(r, c);
    cell.value = value as never;
    cell.font = { name: FONT, bold };
  };

  put(1, 1, 'Summary');
  sheet.getCell('A1').font = { name: FONT, bold: true, size: 14 };

  header(3, ['Rank', 'Nominees', 'Sizes filled in', 'Still missing']);
  ranks.forEach((title, index) => {
    const r = 4 + index;
    const count = rows.filter((row) => ORDINATION_RANK_INFO[row.rank].title === title).length;
    put(r, 1, title);
    put(r, 2, { formula: `COUNTIF(${range('B')},A${r})`, result: count });
    put(r, 3, { formula: `COUNTIFS(${range('B')},A${r},${range('O')},"<>")`, result: 0 });
    put(r, 4, { formula: `B${r}-C${r}`, result: count });
  });
  const total = 4 + ranks.length;
  put(total, 1, 'Total', true);
  ['B', 'C', 'D'].forEach((column, index) =>
    put(total, index + 2, { formula: `SUM(${column}4:${column}${total - 1})`, result: index === 1 ? 0 : rows.length }, true),
  );

  const sizesHead = total + 2;
  put(sizesHead, 1, 'Tunics to order', true);
  header(sizesHead + 1, ['Size', ...ranks, 'Total']);
  TUNIC_SIZES.forEach((size, index) => {
    const r = sizesHead + 2 + index;
    put(r, 1, size);
    ranks.forEach((title, c) =>
      put(r, c + 2, { formula: `COUNTIFS(${range('B')},"${title}",${range('O')},$A${r})`, result: 0 }),
    );
    const end = String.fromCharCode('A'.charCodeAt(0) + ranks.length);
    put(r, ranks.length + 2, { formula: `SUM(B${r}:${end}${r})`, result: 0 });
  });

  [14, 12, 15, 13, 10].forEach((width, index) => (sheet.getColumn(index + 1).width = width));
}

/** "Ordination 2026-11-29 tunic sizes.xlsx". */
export function sizeSheetFilename(date: string): string {
  return `Ordination ${date} tunic sizes.xlsx`;
}

/** Hands the workbook to the browser as a download. */
export function downloadSizeSheet(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
