import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  ExportBatch,
  buildBatchWorkbook,
  exportFilename,
  formatThaiDate,
} from './bill-export';

/** Read the workbook back out, so the assertions are on a real parsed file. */
function readBack(batch: ExportBatch) {
  const wb = XLSX.read(buildBatchWorkbook(batch), { type: 'buffer' });
  const rows = (name: string): any[][] =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true });
  return { names: wb.SheetNames, rows };
}

const batch: ExportBatch = {
  label: 'มิถุนายน 2569',
  periodMonth: 6,
  periodYear: 2569,
  bills: [
    {
      seq: 1,
      billDate: new Date(2026, 5, 3),
      amount: 16300,
      locked: true,
      status: 'MATCHED',
      lines: [
        {
          kind: 'ITEM',
          description: 'ยางนอก MICHELIN XCD2 205/55-16',
          qty: 4,
          unitPrice: 4000,
          lineTotal: 16000,
        },
        {
          kind: 'SERVICE',
          description: 'ตั้งศูนย์',
          qty: 1,
          unitPrice: 300,
          lineTotal: 300,
        },
      ],
    },
    {
      seq: 2,
      billDate: new Date(2026, 5, 4),
      amount: 900,
      locked: false,
      status: 'MATCHED',
      lines: [
        {
          kind: 'FREEFORM',
          description: 'ค่าบริการ',
          qty: 1,
          unitPrice: 900,
          lineTotal: 900,
        },
      ],
    },
    {
      seq: 3,
      billDate: null,
      amount: 500,
      locked: false,
      status: 'UNMATCHED',
      lines: [],
    },
  ],
};

describe('formatThaiDate', () => {
  it('writes zero-padded Buddhist-era text', () => {
    expect(formatThaiDate(new Date(2026, 5, 3))).toBe('03/06/2569');
    expect(formatThaiDate(new Date(2026, 10, 30))).toBe('30/11/2569');
  });

  it('reads the date in Bangkok, not in the server timezone', () => {
    // How Postgres hands back a bill the parser dated 1 June: local midnight in
    // +07 stored as UTC. A server running in UTC reading this off the host clock
    // would say 31/05 and put every date on the sheet a day early.
    const firstOfJune = new Date(Date.UTC(2026, 4, 31, 17, 0, 0));
    expect(formatThaiDate(firstOfJune)).toBe('01/06/2569');

    // Same instant, the other side of midnight: 30 June 23:00 Bangkok is still
    // June, though it is already 1 July in UTC.
    expect(formatThaiDate(new Date(Date.UTC(2026, 5, 30, 16, 0, 0)))).toBe(
      '30/06/2569',
    );
  });

  it('rolls the Buddhist year on the Bangkok new year, not the UTC one', () => {
    // 1 January 2570 BE in Bangkok is still 31 December in UTC.
    expect(formatThaiDate(new Date(Date.UTC(2026, 11, 31, 17, 0, 0)))).toBe(
      '01/01/2570',
    );
  });

  it('leaves a missing date empty rather than inventing one', () => {
    expect(formatThaiDate(null)).toBe('');
  });

  it('zero-pads so text still sorts chronologically', () => {
    const dates = [new Date(2026, 5, 11), new Date(2026, 5, 3)]
      .map(formatThaiDate)
      .sort();
    expect(dates).toEqual(['03/06/2569', '11/06/2569']);
  });
});

describe('buildBatchWorkbook', () => {
  it('produces both sheets', () => {
    expect(readBack(batch).names).toEqual(['สรุปบิล', 'รายการ']);
  });

  it('summarises one row per bill and totals to the batch value', () => {
    const rows = readBack(batch).rows('สรุปบิล');

    expect(rows[0]).toEqual([
      'ลำดับ',
      'วันที่',
      'ยอดบิล',
      'จำนวนรายการ',
      'ค่าบริการไม่ระบุ',
      'สถานะ',
    ]);
    expect(rows[1]).toEqual([1, '03/06/2569', 16300, 2, 0, 'ล็อก']);
    expect(rows[2]).toEqual([2, '04/06/2569', 900, 1, 900, 'จับคู่แล้ว']);
    expect(rows[3]).toEqual([3, '', 500, 0, 0, 'ยังไม่จับคู่']);

    // Blank spacer, then the total — 16300 + 900 + 500.
    const total = rows[rows.length - 1];
    expect(total[0]).toBe('รวม');
    expect(total[2]).toBe(17700);
    expect(total[5]).toBe('3 บิล');
  });

  it('repeats the bill columns on every line so the sheet stays filterable', () => {
    const rows = readBack(batch).rows('รายการ');

    expect(rows[1]).toEqual([
      1,
      '03/06/2569',
      16300,
      'สินค้า',
      'ยางนอก MICHELIN XCD2 205/55-16',
      4,
      4000,
      16000,
    ]);
    // Second line of the same bill carries the header values again, not blanks.
    expect(rows[2].slice(0, 3)).toEqual([1, '03/06/2569', 16300]);
    expect(rows[2][3]).toBe('ค่าบริการ');
  });

  it('keeps an unmatched bill in the detail sheet instead of dropping it', () => {
    const rows = readBack(batch).rows('รายการ');
    const orphan = rows.find((r) => r[0] === 3);

    // Losing it would quietly remove 500 baht from a file used for filing.
    expect(orphan).toBeDefined();
    expect(orphan![2]).toBe(500);
    expect(orphan![4]).toBe('(ยังไม่จับคู่)');
  });

  it('distinguishes a real service line from an unattributed one', () => {
    const rows = readBack(batch).rows('รายการ');
    expect(rows.find((r) => r[0] === 2)![3]).toBe('ค่าบริการ (ไม่ระบุ)');
    expect(rows[2][3]).toBe('ค่าบริการ');
  });

  it('survives an empty batch', () => {
    const rows = readBack({ ...batch, bills: [] }).rows('สรุปบิล');
    expect(rows[0][0]).toBe('ลำดับ');
    expect(rows[rows.length - 1][2]).toBe(0);
  });
});

describe('exportFilename', () => {
  it('stays ASCII and carries the period', () => {
    expect(exportFilename(batch)).toBe('bills-2569-06.xlsx');
    expect(exportFilename({ ...batch, periodMonth: 12 })).toBe(
      'bills-2569-12.xlsx',
    );
  });
});
