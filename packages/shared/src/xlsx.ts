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
 *   _rels/.rels                the package points at the workbook and the props
 *   docProps/core.xml          who exported it, and when
 *   xl/workbook.xml            the sheet names, in tab order
 *   xl/_rels/workbook.xml.rels the workbook points at each sheet's XML
 *   xl/styles.xml              the formats used: normal, header band, colours
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
   * Rows to write as a section title: bold, in the parish's oxblood, with a
   * rule above them.
   *
   * A sheet that is several tables stacked needs its titles to outrank the
   * column labels under them. Bold alone does not do that — a bold title above
   * a bold header row reads as two header rows.
   */
  titleRows?: number[];
  /**
   * Rows to write in the header band, by index into `rows`.
   *
   * For the column labels of a table that is *inside* a sheet rather than at
   * the top of one. The same band as row 1 elsewhere in the book, so a reader
   * learns the colour once and it means the same thing on every tab.
   */
  headRows?: number[];
  /**
   * Rows to draw a rule above, by index into `rows`.
   *
   * This is how a week ends. The rosters run several weeks into one filterable
   * table, and the only thing separating them was the value in column A —
   * which a reader has to notice changing, halfway down a screen of colour.
   * A rule is a seam that does not need reading, and unlike a spacer row it
   * cannot be sorted into the middle of the data or counted by the autofilter.
   */
  separatorRows?: number[];
  /**
   * Whether Excel's own gridlines are drawn. Defaults to true.
   *
   * Off on a sheet that bands its own rows: the grey grid and the coloured
   * bands are two competing descriptions of where the rows are, and the one
   * carrying meaning should win.
   */
  gridLines?: boolean;
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
/**
 * Who made the file, and when.
 *
 * Written into `docProps/core.xml`, which is where Excel's own File → Info
 * panel reads an author and a date from. It is here because the camp workbook
 * used to spend three rows of its first sheet saying the same thing, and those
 * rows cost that sheet its header row, its frozen pane and its autofilter. The
 * provenance is worth keeping and is not worth a row.
 */
export interface WorkbookMeta {
  title?: string;
  creator?: string;
  created?: Date;
}

export function buildXlsx(sheets: readonly Sheet[], meta: WorkbookMeta = {}): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');

  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));

  /*
   * The sheets are rendered before `xl/styles.xml` is written, not after.
   *
   * `styles.xml` is a set of numbered format records that cells refer to by
   * index, and which combinations of colour, weight and rule a sheet actually
   * uses is not knowable until its rows have been walked. So one registry is
   * handed to every sheet, hands back an index for each combination it is
   * asked for, and is serialised last — which also means the file carries no
   * format nothing uses.
   */
  const styles = new Styles();
  const rendered = sheets.map((sheet) => encode(sheetXml(sheet, styles)));

  const files: ZipEntry[] = [
    { path: '[Content_Types].xml', data: encode(contentTypes(sheets.length)) },
    { path: '_rels/.rels', data: encode(packageRels()) },
    { path: 'docProps/core.xml', data: encode(coreXml(meta)) },
    { path: 'xl/workbook.xml', data: encode(workbookXml(names, sheets)) },
    { path: 'xl/_rels/workbook.xml.rels', data: encode(workbookRels(sheets.length)) },
    { path: 'xl/styles.xml', data: encode(styles.toXml()) },
  ];

  rendered.forEach((data, index) => {
    files.push({ path: `xl/worksheets/sheet${index + 1}.xml`, data });
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
    `<Override PartName="/docProps/core.xml" ` +
    `ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `${overrides}</Types>`
  );
}

function packageRels(): string {
  return (
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
    `Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" ` +
    `Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ` +
    `Target="docProps/core.xml"/></Relationships>`
  );
}

/**
 * `docProps/core.xml` — the Dublin Core part.
 *
 * The namespaces are not decoration: `dc:title`, `dc:creator` and
 * `dcterms:created` each live in a different one, and `xsi:type` on the dates
 * is required rather than conventional. Excel ignores a part it cannot parse
 * and reports nothing, so a mistake here is silent.
 */
function coreXml(meta: WorkbookMeta): string {
  const stamp = (meta.created ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  return (
    `${XML_HEAD}<cp:coreProperties ` +
    `xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:dcmitype="http://purl.org/dc/dcmitype/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    (meta.title ? `<dc:title>${escapeXml(meta.title)}</dc:title>` : '') +
    (meta.creator ? `<dc:creator>${escapeXml(meta.creator)}</dc:creator>` : '') +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
}

function workbookXml(names: readonly string[], sheets: readonly Sheet[]): string {
  const tabs = names
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');

  /*
   * Repeat row 1 at the top of every printed page.
   *
   * A two-hundred-row roster prints as six pages, five of which used to have no
   * column headings on them at all — so the fourth page was sixteen unlabelled
   * columns of names, dates and paragraphs. This is Excel's own mechanism for
   * it: a defined name scoped to one sheet, which is what `localSheetId` means.
   */
  const printTitles = names
    .map((name, index) =>
      sheets[index]!.headerRow === false || sheets[index]!.columns.length === 0
        ? ''
        : `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">` +
          `${escapeXml(quoteSheetName(name))}!$1:$1</definedName>`,
    )
    .join('');

  return (
    `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${tabs}</sheets>` +
    (printTitles ? `<definedNames>${printTitles}</definedNames>` : '') +
    `</workbook>`
  );
}

/** `Groups 2027` → `'Groups 2027'`. A formula reference to a sheet whose name
    has a space in it is quoted, and an apostrophe inside is doubled. */
function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
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
 * The header band, oxblood — the parish's own accent.
 *
 * A constant rather than a per-sheet option because a workbook whose five tabs
 * have five different header colours is not designed, it is decorated. The
 * colours that vary in this file are the *data's* — a group's colour means
 * something and has to be free to be any of the twelve.
 */
const HEADER_FILL = '992A21';

/** The gold hairline under the header band, so the band still reads as a band
    when somebody prints the sheet in black and white. */
const RULE_COLOUR = '7A5C1E';

/** The rule that ends a week. Warm and mid-weight: dark enough to find while
    scrolling, light enough not to compete with the header. */
const SEAM_COLOUR = 'B08D57';

/**
 * Body text, a soft near-black rather than `#000`.
 *
 * Two hundred rows of pure black on a pale colour fill is the contrast that
 * makes a spreadsheet tiring to read down. This is the one change in this file
 * nobody will name and everybody will feel.
 */
const TEXT_COLOUR = '2B2B2B';

/** Which font a cell is written in. Indices into `<fonts>` below. */
type FontId = 0 | 1 | 2 | 3;
/** Which border. 0 none, 1 the hairline under the header, 2 a week's seam. */
type BorderId = 0 | 1 | 2;

/**
 * The formats the workbook ends up needing, collected while it is written.
 *
 * Every combination of fill, weight and rule is one numbered record, allocated
 * on first use and reused after — so a roster with twelve group colours and a
 * seam at each week boundary costs a dozen-odd records rather than one per row.
 *
 * Three indices are fixed because the writing code names them directly:
 *
 *   0  normal
 *   1  the header band — bold white on oxblood, with a rule under it
 *   2  plain bold, for a sheet that is several small tables stacked
 */
class Styles {
  private readonly fills = new Map<string, number>();
  private readonly keys = new Map<string, number>();
  private readonly xfs: string[] = [];

  constructor() {
    this.xfs.push(xf(0, 0, 0, 'top'));
    this.xfs.push(xf(2, 2, 1, 'center'));
    this.xfs.push(xf(1, 0, 0, 'top'));
  }

  /**
   * The index for one combination, allocating it if it is new.
   *
   * Fill indices 0 and 1 are reserved by the format itself — 0 is "none" and 1
   * is the grey Excel uses for gridline patterns — and index 2 is the header
   * band, so the data's own colours start at 3. A file that reuses either
   * reserved slot for its own colour renders wrong in Excel and correctly
   * everywhere else, which is the worst way to find out.
   */
  get(options: { fill?: string | null; font?: FontId; border?: BorderId }): number {
    const fill = options.fill ?? null;
    const font = options.font ?? 0;
    const border = options.border ?? 0;
    if (!fill && font === 0 && border === 0) return 0;

    const key = `${fill ?? ''}|${font}|${border}`;
    const existing = this.keys.get(key);
    if (existing !== undefined) return existing;

    let fillId = 0;
    if (fill) {
      fillId = this.fills.get(fill) ?? this.fills.size + 3;
      this.fills.set(fill, fillId);
    }

    const index = this.xfs.length;
    this.xfs.push(xf(font, fillId, border, 'top'));
    this.keys.set(key, index);
    return index;
  }

  toXml(): string {
    const colours = [...this.fills.keys()];
    const fillParts = colours
      .map(
        (hex) =>
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/>` +
          `<bgColor indexed="64"/></patternFill></fill>`,
      )
      .join('');

    return (
      `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="4">` +
      `<font><sz val="11"/><color rgb="FF${TEXT_COLOUR}"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="11"/><color rgb="FF${TEXT_COLOUR}"/><name val="Calibri"/></font>` +
      // Bold white, for the header band.
      `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
      // Bold oxblood, a size up, for a section title.
      `<font><b/><sz val="13"/><color rgb="FF${HEADER_FILL}"/><name val="Calibri"/></font>` +
      `</fonts>` +
      `<fills count="${colours.length + 3}">` +
      `<fill><patternFill patternType="none"/></fill>` +
      `<fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${HEADER_FILL}"/>` +
      `<bgColor indexed="64"/></patternFill></fill>` +
      `${fillParts}</fills>` +
      `<borders count="3">` +
      `<border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border><left/><right/><top/><bottom style="thin">` +
      `<color rgb="FF${RULE_COLOUR}"/></bottom><diagonal/></border>` +
      `<border><left/><right/><top style="medium">` +
      `<color rgb="FF${SEAM_COLOUR}"/></top><bottom/><diagonal/></border>` +
      `</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    );
  }
}

function xf(font: FontId, fill: number, border: BorderId, vertical: 'top' | 'center'): string {
  return (
    `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" ` +
    `applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">` +
    `<alignment vertical="${vertical}" wrapText="1"/></xf>`
  );
}

function sheetXml(sheet: Sheet, styles: Styles): string {
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
  const titles = new Set(sheet.titleRows ?? []);
  const heads = new Set(sheet.headRows ?? []);
  const seams = new Set(sheet.separatorRows ?? []);

  const body = sheet.rows
    .map((values, index) => {
      const seam: BorderId = seams.has(index) ? 2 : 0;
      const hex = normaliseHex(sheet.rowFills?.[index]);

      /*
       * One style per row, in the order of what carries the most.
       *
       * A row cannot be two of these at once — there is a single style index
       * per cell — so the ranking is the design: a title outranks a column
       * label, a column label outranks a colour, and a colour outranks bold,
       * because the colour says which group this is and bold says only that
       * somebody thought it mattered.
       */
      let style: number;
      let height: number | undefined;
      if (titles.has(index)) {
        style = styles.get({ font: 3, border: 2 });
        height = 22;
      } else if (heads.has(index)) {
        style = 1;
        height = 20;
      } else if (hex) {
        style = styles.get({ fill: hex, border: seam });
      } else if (bold.has(index)) {
        style = styles.get({ font: 1, border: seam });
      } else {
        style = styles.get({ border: seam });
      }

      return row(index + firstBodyRow, values, style, height);
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
  const grid = sheet.gridLines === false ? ' showGridLines="0"' : '';
  const view = wantsHeader
    ? `<sheetViews><sheetView${grid} workbookViewId="0">` +
      `<pane${frozenCols > 0 ? ` xSplit="${frozenCols}"` : ''} ySplit="1" ` +
      `topLeftCell="${columnLetter(frozenCols + 1)}2" ` +
      `activePane="${frozenCols > 0 ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>` +
      `</sheetView></sheetViews>`
    : `<sheetViews><sheetView${grid} workbookViewId="0"/></sheetViews>`;
  const filter = wantsHeader
    ? `<autoFilter ref="A1:${columnLetter(sheet.columns.length)}${lastRow}"/>`
    : '';

  /*
   * A little more air between the rows than Excel's default 15.
   *
   * `defaultRowHeight` rather than a height on each row, because the allergy
   * and medical-note columns wrap: a fixed height on those rows would crop the
   * paragraph this whole sheet exists to carry, and a floor lets Excel grow the
   * row past it when it has to.
   */
  const format = '<sheetFormatPr defaultRowHeight="16.5"/>';

  /*
   * Printed: landscape when it is wide, scaled to the width of the page, and
   * with the margins pulled in. Left alone, a sixteen-column roster prints
   * portrait, three columns to a page, in eleven sheets of paper — and the
   * roster is a thing people hold.
   */
  const landscape = columnCount > 6;
  const print =
    `<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>` +
    `<pageSetup orientation="${landscape ? 'landscape' : 'portrait'}" ` +
    `fitToWidth="1" fitToHeight="0"/>`;

  return (
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `${dimension}${view}${format}${cols}<sheetData>${header}${body}</sheetData>` +
    `${filter}${print}</worksheet>`
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
