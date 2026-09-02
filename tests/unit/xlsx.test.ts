import { describe, expect, it } from 'vitest';
import { buildXlsx, columnLetter, sanitiseSheetName } from '@spsm/shared';

/**
 * The hand-written .xlsx writer.
 *
 * ---------------------------------------------------------------------------
 * What is worth asserting here, and what is not.
 *
 * Not worth asserting: that Excel opens the file. No test in this repo can
 * establish that, and one that unzipped the result and re-implemented enough of
 * the format to check it would only be testing the writer against itself. That
 * claim was established once, by hand, by generating a workbook and opening it
 * in a real reader — see the note in `packages/shared/src/xlsx.ts` for what the
 * parts are and why each one is there.
 *
 * Worth asserting: the handful of things that would silently produce a *valid*
 * file with the wrong contents in it, or an invalid one for a reason nobody
 * would guess. XML escaping is the first — a child called O'Brien or an allergy
 * note reading "peanuts & shellfish" is not an edge case at a camp, it is
 * Tuesday, and an unescaped ampersand makes the whole workbook unopenable with
 * an error naming nothing. Duplicate sheet names are the second, because they
 * are reachable from data rather than from a mistake.
 * ---------------------------------------------------------------------------
 */

/**
 * Read one part back out of the workbook, by walking the zip's local headers.
 *
 * Fifteen lines of zip reader rather than a substring search, and the reason is
 * a bug this helper had first: `[Content_Types].xml` is the first part in the
 * file and it *lists every other part by name*, so searching the whole workbook
 * for `xl/worksheets/sheet1.xml` finds the manifest entry and returns the
 * manifest's bytes. Every assertion downstream then passes or fails for reasons
 * unrelated to the sheet it named.
 *
 * Only handles stored (method 0) entries, which is all this writer produces.
 */
function entry(bytes: Uint8Array, path: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const size = view.getUint32(at + 18, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const from = at + 30 + nameLength + extraLength;

    if (name === path) return decoder.decode(bytes.subarray(from, from + size));
    at = from + size;
  }

  throw new Error(`${path} is not in the workbook`);
}

/** Every part's path, in the order they were written. */
function paths(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const found: string[] = [];

  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const size = view.getUint32(at + 18, true);
    found.push(decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength)));
    at = at + 30 + nameLength + extraLength + size;
  }

  return found;
}

describe('buildXlsx', () => {
  it('writes every part a spreadsheet reader looks for', () => {
    const bytes = buildXlsx([{ name: 'One', columns: [{ header: 'A' }], rows: [['x']] }]);
    const text = new TextDecoder().decode(bytes);

    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(text).toContain(part);
    }

    // The zip's own signatures: a local header at the very start, and an
    // end-of-central-directory record. Neither is optional.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(text).toContain('PK');
  });

  it('escapes the five characters that would break the XML', () => {
    const bytes = buildXlsx([
      {
        name: 'One',
        columns: [{ header: 'Name' }],
        rows: [['Peanuts & "tree nuts" <urgent> — O’Brien\'s']],
      },
    ]);
    const sheet = entry(bytes, 'xl/worksheets/sheet1.xml');

    expect(sheet).toContain('&amp;');
    expect(sheet).toContain('&quot;');
    expect(sheet).toContain('&lt;urgent&gt;');
    expect(sheet).toContain('&apos;');
    // The raw forms must not survive anywhere in the cell.
    expect(sheet).not.toContain('<urgent>');
  });

  it('drops the control characters XML forbids and keeps the three it allows', () => {
    // A form feed and a vertical tab, as pasted out of a message, either side
    // of a real line break. Written as escapes so the intent survives an editor.
    const note = 'inhaler\u000Cmorning\u000B\nand evening';
    const bytes = buildXlsx([{ name: 'One', columns: [{ header: 'Notes' }], rows: [[note]] }]);
    const sheet = entry(bytes, 'xl/worksheets/sheet1.xml');

    expect(sheet).not.toContain('\u000C');
    expect(sheet).not.toContain('\u000B');
    // The newline is meaning in a medical note, not noise.
    expect(sheet).toContain('morning\nand evening');
  });

  it('writes a number as a number and a string as a string', () => {
    const bytes = buildXlsx([
      { name: 'One', columns: [{ header: 'N' }, { header: 'S' }], rows: [[12, '12']] },
    ]);
    const sheet = entry(bytes, 'xl/worksheets/sheet1.xml');

    // A count that arrives as text sorts as text, which is how "10" ends up
    // between "1" and "2" in a roster somebody sorted by group size.
    expect(sheet).toContain('<v>12</v>');
    expect(sheet).toContain('inlineStr');
  });

  it('writes a non-finite number as text rather than as a figure', () => {
    const bytes = buildXlsx([
      { name: 'One', columns: [{ header: 'Ratio' }], rows: [[Number.POSITIVE_INFINITY]] },
    ]);
    // Zero would be a number somebody could act on. The word cannot be mistaken.
    expect(entry(bytes, 'xl/worksheets/sheet1.xml')).toContain('Infinity');
  });

  it('freezes the header and adds a filter, and does neither without a header', () => {
    const withHeader = entry(
      buildXlsx([{ name: 'One', columns: [{ header: 'A' }], rows: [['x'], ['y']] }]),
      'xl/worksheets/sheet1.xml',
    );
    expect(withHeader).toContain('state="frozen"');
    expect(withHeader).toContain('<autoFilter ref="A1:A3"/>');

    const without = entry(
      buildXlsx([
        { name: 'One', headerRow: false, columns: [{ header: '', width: 20 }], rows: [['x'], ['y']] },
      ]),
      'xl/worksheets/sheet1.xml',
    );
    // A filter over a blank header row filters nothing and looks broken.
    expect(without).not.toContain('autoFilter');
    expect(without).not.toContain('state="frozen"');
    // The body starts at row 1, not row 2.
    expect(without).toContain('<row r="1">');
    // The widths are the whole point of keeping `columns` without a header.
    expect(without).toContain('width="20"');
  });

  it('gives two sheets that want the same name different ones', () => {
    // Reachable from data — a sheet named after a band, and two bands called the
    // same thing. Duplicate names are a file Excel calls corrupt.
    const bytes = buildXlsx([
      { name: 'Groups', columns: [], rows: [] },
      { name: 'Groups', columns: [], rows: [] },
    ]);
    const workbook = entry(bytes, 'xl/workbook.xml');
    expect(workbook).toContain('name="Groups"');
    expect(workbook).toContain('name="Groups (2)"');
  });

  it('refuses a workbook with no sheets', () => {
    expect(() => buildXlsx([])).toThrow();
  });
});

describe('sanitiseSheetName', () => {
  it('removes the characters Excel forbids in a tab name', () => {
    expect(sanitiseSheetName('3rd/4th [band]: groups?')).toBe('3rd 4th  band   groups');
  });

  it('cuts to 31 characters and never returns an empty name', () => {
    expect(sanitiseSheetName('x'.repeat(60))).toHaveLength(31);
    expect(sanitiseSheetName('///')).toBe('Sheet');
  });
});

describe('columnLetter', () => {
  it('counts the way spreadsheets do', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    // The one that is wrong in every naive implementation: there is no column
    // zero, so this is not plain base-26.
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(52)).toBe('AZ');
    expect(columnLetter(53)).toBe('BA');
  });
});
