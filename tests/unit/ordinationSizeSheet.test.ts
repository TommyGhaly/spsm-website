import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSizeSheet, formatPhone, sizeSheetRows } from '@/features/ordination/sizeSheet';
import { parseOrdination, parseOrdinationApplication } from '@spsm/shared';

const ordination = parseOrdination({ date: '2026-11-29', open: false });

function application(name: string, rank: string, status: string, dateOfBirth = '2012-08-15') {
  return parseOrdinationApplication({
    ordinationId: 'o1',
    rank,
    status,
    nominee: { name, dateOfBirth, phone: '774-502-9674', email: 'n@example.com', schoolGrade: '9th grade' },
    parents: [{ name: 'Parent One', phone: '+1 978 660 7270', email: '' }, { name: '', phone: '', email: '' }],
  });
}

const applications = [
  application('Zed Reader', 'reader', 'approved'),
  application('Mina Sub', 'subdeacon', 'pending', '1990-12-01'),
  application('Abe Cantor', 'cantor', 'approved'),
  application('No Thanks', 'cantor', 'rejected'),
  application('Bea Cantor', 'cantor', 'approved'),
];

describe('formatPhone', () => {
  it('formats US numbers however they were typed', () => {
    expect(formatPhone('7745029674')).toBe('(774) 502-9674');
    expect(formatPhone('+1 (978) 660-7270')).toBe('(978) 660-7270');
  });
  it('leaves anything else alone', () => {
    expect(formatPhone(' 12345 ')).toBe('12345');
    expect(formatPhone('')).toBe('');
  });
});

describe('sizeSheetRows', () => {
  it('drops rejected nominees and orders by rank, then name', () => {
    expect(sizeSheetRows(applications).map((row) => row.nominee.name)).toEqual([
      'Abe Cantor',
      'Bea Cantor',
      'Zed Reader',
      'Mina Sub',
    ]);
  });
});

describe('buildSizeSheet', () => {
  it('writes a workbook Excel can read back, with blank size columns and a summary', async () => {
    const bytes = await buildSizeSheet(ordination, applications);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);

    const sheet = workbook.getWorksheet('Tunic Sizes')!;
    expect(sheet.getRow(5).getCell(15).value).toBe('Tunic Size');
    const first = sheet.getRow(6);
    expect(first.getCell(2).value).toBe('Cantor');
    expect(first.getCell(3).value).toBe('Abe Cantor');
    expect((first.getCell(4).value as Date).toISOString().slice(0, 10)).toBe('2012-08-15');
    expect(first.getCell(5).value).toMatchObject({ formula: 'IF(D6="","",DATEDIF(D6,$C$2,"y"))', result: 14 });
    expect(first.getCell(10).value).toBe('(978) 660-7270');
    expect(first.getCell(15).value).toBeNull();
    expect(sheet.getRow(9).getCell(3).value).toBe('Mina Sub');
    expect(sheet.getRow(9).getCell(13).value).toBe('Waiting');
    expect(sheet.getRow(10).getCell(3).value).toBeNull();

    const summary = workbook.getWorksheet('Summary')!;
    expect(summary.getCell('B4').value).toMatchObject({ formula: "COUNTIF('Tunic Sizes'!$B$6:$B$9,A4)", result: 2 });
    expect(summary.getCell('A7').value).toBe('Total');
  });
});
