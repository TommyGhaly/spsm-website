/**
 * A real `.xlsx` file, written by hand, with no dependencies.
 *
 * ---------------------------------------------------------------------------
 * Why not SheetJS or ExcelJS.
 *
 * Three reasons, in order of how much they matter here.
 *
 * 1. **This site is a static export with no server.** Every byte the export
 *    button needs is a byte in somebody's browser. ExcelJS is around a megabyte
 *    of JavaScript and pulls in a stream polyfill; SheetJS's npm build is
 *    several hundred kilobytes and its publisher has moved distribution off npm
 *    entirely. Either one is larger than the entire page it would sit on, to
 *    write a spreadsheet with five sheets of plain cells in it.
 *
 * 2. **The same code has to run in a Cloud Function.** The OneDrive upload is a
 *    Function — a browser cannot hold a Microsoft Graph client secret. Anything
 *    that works in one place and not the other means writing the workbook twice
 *    and watching the two copies drift. This is plain ES2022 with a
 *    `TextEncoder` and no platform assumptions, so both callers get the same
 *    bytes.
 *
 * 3. **The format is small when the ambition is.** What follows writes cells,
 *    a bold header row, column widths, and a fill colour. It does not write
 *    formulas, merged cells, charts, or a shared string table, and it should
 *    not grow to — the moment this file wants a pivot table, it is the wrong
 *    file and a dependency is the right answer.
 *
 * ## What an .xlsx actually is
 *
 * A zip of XML. The parts written here are the minimum Excel, Numbers, Google
 * Sheets and LibreOffice all accept:
 *
 *   [Content_Types].xml        what each part in the zip is
 *   _rels/.rels                the package points at the workbook
 *   xl/workbook.xml            the sheet names, in tab order
 *   xl/_rels/workbook.xml.rels the workbook points at each sheet's XML
 *   xl/styles.xml              the two formats used: normal, and bold header
 *   xl/worksheets/sheetN.xml   the cells
 *
 * Strings are written **inline** (`t="inlineStr"`) rather than through
 * `xl/sharedStrings.xml`. The shared table exists to deduplicate repeated text
 * across a large book, which for a camp roster saves a few kilobytes and costs
 * a whole extra part, a second pass over every cell, and an index that is
 * wrong-by-one in a way nothing catches until Excel refuses the file. Inline is
 * bigger and cannot be got wrong.
 *
 * The zip entries are **stored, not deflated**. Compression would need an
 * implementation of DEFLATE, which is real work with a real bug surface, to
 * shrink a file that is already well under a megabyte and is about to be
 * emailed once. `CompressedSize` and `UncompressedSize` are therefore equal and
 * the method is 0, which every zip reader in existence handles.
 * ---------------------------------------------------------------------------
 */

/** What may go in a cell. `null` and `undefined` write an empty cell. */
export type CellValue = string | number | boolean | null | undefined;

export interface SheetColumn {
  /** Header text. Written bold in row 1. */
  header: string;
  /** Width in Excel's character units. ~8.43 is the default. */
  width?: number;
}

export interface Sheet {
  /**
   * The tab name.
   *
   * Excel's own limits, enforced in `sanitiseSheetName` rather than trusted:
   * at most 31 characters and none of `\ / ? * [ ] :`. A name that breaks
   * either produces a file Excel says is corrupt, with no indication of which
   * of thirty parts is at fault.
   */
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
  /**
   * Optional per-row fill, as `RRGGBB` with no `#`, one entry per row in
   * `rows`. This is how the group colours reach the spreadsheet — a roster that
   * is colour-coded on the screen and monochrome in the file somebody actually
   * prints has lost the thing that made it usable.
   */
  rowFills?: (string | null | undefined)[];
  /**
   * How many columns to freeze alongside the header row.
   *
   * The rosters are sixteen columns wide and the two that say *which group this
   * is* are the first two. Scrolling right to read somebody's allergies, with
   * their name and their group gone off the left edge, is the state this
   * avoids.
   */
  freezeColumns?: number;
  /**
   * Rows to write in bold, by index into `rows`.
   *
   * For a sheet that is several small tables stacked — the summary — where
   * there is no single header row to band and the titles would otherwise be
   * indistinguishable from the figures under them.
   */
  boldRows?: number[];
  /**
   * Whether to write `columns` as a bold header row. Defaults to true.
   *
   * `false` keeps the widths and drops the row, which is what a sheet holding
   * several small stacked tables needs: one header row above all of them would
   * label none of them correctly, and the autofilter it carries would filter
   * across the boundaries between them.
   */
  headerRow?: boolean;
}

/**
 * Build the workbook. Returns the bytes of a `.xlsx` file.
 *
 * A `Uint8Array` rather than a `Blob` or a `Buffer`: those are the browser's
 * and Node's own wrappers, and returning either would make this module refuse
 * to run in the other. Each caller wraps it in whatever it needs.
 */
export function buildXlsx(sheets: readonly Sheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');

  /*
   * Every distinct fill used anywhere in the book, collected first.
   *
   * `xl/styles.xml` is a set of numbered format records that cells refer to by
   * index, so the styles have to be known before any cell can be written. Two
   * fills are reserved by the format itself — index 0 is "none" and index 1 is
   * the grey Excel uses for gridline patterns — and a file that reuses either
   * for its own colour renders wrong in Excel and correctly everywhere else,
   * which is the worst way to find out.
   */
  const fills: string[] = [];
  const fillIndex = new Map<string, number>();
  for (const sheet of sheets) {
    for (const colour of sheet.rowFills ?? []) {
      const hex = normaliseHex(colour);
      if (!hex || fillIndex.has(hex)) continue;
      fillIndex.set(hex, fills.length);
      fills.push(hex);
    }
  }

  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));

  const files: ZipEntry[] = [
    { path: '[Content_Types].xml', data: encode(contentTypes(sheets.length)) },
    { path: '_rels/.rels', data: encode(packageRels()) },
    { path: 'xl/workbook.xml', data: encode(workbookXml(names)) },
    { path: 'xl/_rels/workbook.xml.rels', data: encode(workbookRels(sheets.length)) },
    { path: 'xl/styles.xml', data: encode(stylesXml(fills)) },
  ];

  sheets.forEach((sheet, index) => {
    files.push({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      data: encode(sheetXml(sheet, fillIndex)),
    });
  });

  return zip(files);
}

/* ---------------------------------------------------------------------------
 * The XML parts
 * ------------------------------------------------------------------------ */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function contentTypes(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');

  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `${overrides}</Types>`
  );
}

function packageRels(): string {
  return (
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
    `Target="xl/workbook.xml"/></Relationships>`
  );
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');

  return (
    `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRels(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
      `Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('');

  // The style part's relationship id continues the same run, so it must come
  // after every sheet's. Numbering it rId1 and pushing the sheets along would
  // also be valid and would silently disagree with workbook.xml above.
  const styles =
    `<Relationship Id="rId${sheetCount + 1}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ` +
    `Target="styles.xml"/>`;

  return (
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${sheets}${styles}</Relationships>`
  );
}

/**
 * Styles: one normal format, one bold header, and one per row colour.
 *
 * The `cellXfs` order is what the rest of this file indexes into and must not
 * be rearranged:
 *
 *   0  normal
 *   1  the header band — bold white on oxblood, with a rule under it
 *   2  plain bold, for a sheet that is several small tables stacked
 *   3… one per fill, in the order they were collected, wrapped
 */
/**
 * The header band, oxblood — the parish's own accent.
 *
 * A constant rather than a per-sheet option because a workbook whose five tabs
 * have five different header colours is not designed, it is decorated. The
 * colours that vary in this file are the *data's* — a group's colour means
 * something and has to be free to be any of the twelve.
 */
const HEADER_FILL = '992A21';

function stylesXml(fills: readonly string[]): string {
  const fillParts = fills
    .map((hex) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`)
    .join('');

  const colourXfs = fills
    .map((_, index) => `<xf numFmtId="0" fontId="0" fillId="${index + 3}" borderId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`)
    .join('');

  return (
    `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="3">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    // Bold white, for the header band.
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `</fonts>` +
    // Indices 0 and 1 are reserved by the format; index 2 is the header band
    // and ours start at 3.
    `<fills count="${fills.length + 3}">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill>` +
    `${fillParts}</fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    // A hairline under the header, so the band still reads as a band when
    // somebody prints the sheet in black and white.
    `<border><left/><right/><top/><bottom style="thin"><color rgb="FF7A5C1E"/></bottom><diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${fills.length + 3}">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `${colourXfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function sheetXml(sheet: Sheet, fillIndex: Map<string, number>): string {
  const columnCount = Math.max(
    sheet.columns.length,
    ...sheet.rows.map((row) => row.length),
    1,
  );

  const cols = sheet.columns.some((column) => column.width)
    ? `<cols>${sheet.columns
        .map((column, index) =>
          column.width
            ? `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`
            : '',
        )
        .join('')}</cols>`
    : '';

  const wantsHeader = sheet.headerRow !== false && sheet.columns.length > 0;
  // Taller than a data row, so the band has air in it and reads as a heading
  // rather than as a row that happens to be coloured in.
  const header = wantsHeader
    ? row(1, sheet.columns.map((column) => column.header), 1, 24)
    : '';
  // Without a header row the body starts at row 1, and the pane must not be
  // frozen below a row that is data.
  const firstBodyRow = wantsHeader ? 2 : 1;

  const bold = new Set(sheet.boldRows ?? []);
  const body = sheet.rows
    .map((values, index) => {
      const hex = normaliseHex(sheet.rowFills?.[index]);
      // A fill wins over bold: they cannot both be expressed by one style
      // index, and a coloured row carries more than a heavy one does.
      const filled = hex ? (fillIndex.get(hex) ?? -1) + 3 : 0;
      const style = filled >= 3 ? filled : bold.has(index) ? 2 : 0;
      return row(index + firstBodyRow, values, style);
    })
    .join('');

  /*
   * `autoFilter` over the header, and the panes frozen below it.
   *
   * Both are two attributes and both are the difference between a file somebody
   * uses and a file somebody re-sorts by hand. A 200-row roster with no frozen
   * header is unreadable past row 30 — which is the point at which whoever
   * opened it goes back to asking the camp director instead.
   */
  const lastRow = Math.max(1, sheet.rows.length + firstBodyRow - 1);
  const dimension = `<dimension ref="A1:${columnLetter(columnCount)}${lastRow}"/>`;
  const frozenCols = Math.max(0, Math.min(sheet.freezeColumns ?? 0, sheet.columns.length));
  const view = wantsHeader
    ? `<sheetViews><sheetView workbookViewId="0">` +
      `<pane${frozenCols > 0 ? ` xSplit="${frozenCols}"` : ''} ySplit="1" ` +
      `topLeftCell="${columnLetter(frozenCols + 1)}2" ` +
      `activePane="${frozenCols > 0 ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>` +
      `</sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const filter = wantsHeader
    ? `<autoFilter ref="A1:${columnLetter(sheet.columns.length)}${lastRow}"/>`
    : '';

  return (
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${dimension}${view}${cols}<sheetData>${header}${body}</sheetData>${filter}</worksheet>`
  );
}

function row(
  number: number,
  values: readonly CellValue[],
  style: number,
  height?: number,
): string {
  const cells = values
    .map((value, index) => cell(`${columnLetter(index + 1)}${number}`, value, style))
    .filter(Boolean)
    .join('');
  const tall = height ? ` ht="${height}" customHeight="1"` : '';
  return `<row r="${number}"${tall}>${cells}</row>`;
}

function cell(reference: string, value: CellValue, style: number): string {
  const s = style ? ` s="${style}"` : '';

  if (value === null || value === undefined || value === '') {
    // Still emitted when it carries a fill: an empty cell with no style is
    // worth nothing, and an empty cell in the middle of a coloured row that is
    // white is a hole in the stripe.
    return style ? `<c r="${reference}"${s}/>` : '';
  }

  if (typeof value === 'number') {
    // Non-finite numbers have no representation in the format. Writing the
    // string is honest; writing `0` would be a figure somebody could act on.
    if (!Number.isFinite(value)) return inline(reference, s, String(value));
    return `<c r="${reference}"${s}><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') return `<c r="${reference}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;

  return inline(reference, s, value);
}

function inline(reference: string, s: string, value: string): string {
  // `xml:space="preserve"` or Excel eats leading and trailing spaces — which
  // matters for the indented sub-rows in the summary sheet.
  return `<c r="${reference}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** 1 → A, 26 → Z, 27 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}

/**
 * Escape for XML text.
 *
 * The control characters matter as much as the angle brackets. XML 1.0 forbids
 * all of them except tab, newline and carriage return, and a stray form feed or
 * vertical tab pasted into a medical note — which is text somebody typed at a
 * desk, from a phone, having copied it out of a message — makes the whole
 * workbook unopenable with an error naming nothing. They are dropped rather
 * than escaped, because there is no legal escape for one. The three legal ones
 * are kept: a medical note is a paragraph and its line breaks are meaning.
 */
function escapeXml(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Everything XML 1.0 forbids, which is every control character except \t, \n
    and \r, plus the two noncharacters at the end of the BMP. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g;

/** `#1565C0`, `1565c0` → `1565C0`. Anything else → null. */
function normaliseHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : null;
}

/**
 * Excel's rules for a tab name, applied rather than assumed.
 *
 * Duplicates are the case worth spelling out: two sheets with the same name is
 * a corrupt file, and the names here are partly derived from data (a season, a
 * band), so a collision is reachable without anybody making a mistake. Numbered
 * suffixes are ugly and openable, which is the right trade.
 */
export function sanitiseSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned || 'Sheet';
}

function uniqueSheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = sanitiseSheetName(raw);
    if (!used.has(base.toLowerCase())) {
      used.add(base.toLowerCase());
      return base;
    }
    for (let n = 2; ; n += 1) {
      const suffix = ` (${n})`;
      const candidate = base.slice(0, 31 - suffix.length) + suffix;
      if (used.has(candidate.toLowerCase())) continue;
      used.add(candidate.toLowerCase());
      return candidate;
    }
  });
}

/* ---------------------------------------------------------------------------
 * The zip
 * ------------------------------------------------------------------------ */

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();
function encode(value: string): Uint8Array {
  return encoder.encode(value);
}

/**
 * A stored (uncompressed) zip.
 *
 * Written out longhand because the layout is the specification and there is
 * nothing to abstract: local header and data for each entry, then a central
 * directory repeating the headers with offsets, then the end-of-central-
 * directory record pointing at that. The one thing worth knowing if this ever
 * needs changing is that the central directory's `offset` field must be the
 * byte position of that entry's *local* header, counted from the start of the
 * file — get it wrong and every reader reports a different, unhelpful error.
 *
 * Timestamps are written as a fixed 1980-01-01, the earliest the MS-DOS date
 * format can express. A real timestamp would make the same allocation exported
 * twice produce two different files, which turns "did this change" into a
 * question nobody can answer by comparing them, and it is not information
 * anybody reads out of a zip entry anyway — the workbook's own header carries
 * the date it was generated.
 */
function zip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encode(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0, true); // flags
    localView.setUint16(8, 0, true); // method: stored
    localView.setUint16(10, 0, true); // time
    localView.setUint16(12, 0x0021, true); // date: 1980-01-01
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true); // compressed
    localView.setUint32(22, size, true); // uncompressed
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true); // extra length
    local.set(name, 30);

    locals.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true); // extra
    centralView.setUint16(32, 0, true); // comment
    centralView.setUint16(34, 0, true); // disk number
    centralView.setUint16(36, 0, true); // internal attrs
    centralView.setUint32(38, 0, true); // external attrs
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + size;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concat([...locals, ...centrals, end]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The standard CRC-32, table built once on first use. */
let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
