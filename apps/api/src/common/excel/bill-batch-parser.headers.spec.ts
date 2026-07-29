import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseBillSheet, parseItemSheet } from './bill-batch-parser';

/**
 * The original workbook has a fixed layout, but bills and stock now arrive as
 * two hand-made files whose columns sit wherever the user put them. These cover
 * that: columns are found by header name, not position.
 */
function book(rows: unknown[][], sheet = 'Sheet1'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('header-driven bill sheet', () => {
  it('reads a plain two-column bills file', () => {
    const buf = book([
      ['วันที่', 'จำนวน'],
      ['01/06/69', 350],
      ['01/06/69', 16000],
      ['02/06/69', 1200],
    ]);
    const { bills } = parseBillSheet(buf, 'Sheet1');

    expect(bills).toHaveLength(3);
    expect(bills.map((b) => b.amount)).toEqual([350, 16000, 1200]);
    // No sequence column, so bills are numbered in reading order.
    expect(bills.map((b) => b.seq)).toEqual([1, 2, 3]);
    expect(bills[0].date?.getFullYear()).toBe(2026);
    expect(bills[0].date?.getMonth()).toBe(5); // June
  });

  it('carries the date down when left blank', () => {
    const buf = book([
      ['วันที่', 'ยอดเงิน'],
      ['03/06/69', 500],
      [null, 700],
      [null, 900],
    ]);
    const { bills } = parseBillSheet(buf, 'Sheet1');
    expect(bills).toHaveLength(3);
    expect(bills.every((b) => b.date?.getDate() === 3)).toBe(true);
  });

  it('finds the header even with junk rows above it', () => {
    const buf = book([
      ['รายงานบิลเดือนมิถุนายน 2569'],
      [],
      ['ลำดับ', 'วันที่', 'จำนวน'],
      [1, '01/06/69', 250],
      [2, null, 4000],
    ]);
    const { bills } = parseBillSheet(buf, 'Sheet1');
    expect(bills).toHaveLength(2);
    expect(bills.map((b) => b.seq)).toEqual([1, 2]);
  });

  it('ignores stray values parked below the table', () => {
    const buf = book([
      ['ลำดับ', 'วันที่', 'จำนวน'],
      [1, '01/06/69', 250],
      [2, null, 400],
      [],
      [null, null, 999999], // a stray total, not a bill
    ]);
    const { bills } = parseBillSheet(buf, 'Sheet1');
    expect(bills).toHaveLength(2);
    expect(bills.reduce((s, b) => s + b.amount, 0)).toBe(650);
  });

  it('carries dates by bill sequence across horizontal column groups', () => {
    const buf = book([
      ['ลำดับ', 'วันที่', 'จำนวน', null, 'ลำดับ', 'วันที่', 'จำนวน'],
      [1, '01/06/69', 500, null, 3, null, 700],
      [2, null, 600, null, 4, '02/06/69', 800],
    ]);
    const { bills } = parseBillSheet(buf, 'Sheet1');

    expect(bills.map((b) => b.seq)).toEqual([1, 2, 3, 4]);
    expect(bills.slice(0, 3).every((b) => b.date?.getDate() === 1)).toBe(true);
    expect(bills[3].date?.getDate()).toBe(2);
  });
});

describe('header-driven item sheet', () => {
  it('reads a minimal name / price / qty file', () => {
    const buf = book([
      ['รายการสินค้า', 'ราคาขาย', 'ขายรวม'],
      ['ยางนอก MICHELIN', 4000, 8],
      ['แบตเตอรี่', 2500, 2],
    ]);
    const { items } = parseItemSheet(buf, 'Sheet1');

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      category: 'ยางนอก MICHELIN',
      unitPrice: 4000,
      soldQty: 8,
    });
    expect(items[1]).toMatchObject({ unitPrice: 2500, soldQty: 2 });
  });

  it('handles columns in any order', () => {
    const buf = book([
      ['ขนาด', 'ราคาขาย', 'ยี่ห้อ', 'จำนวนขาย', 'รุ่น', 'รายการ'],
      ['205/55-16', 3200, 'MICHELIN', 4, 'XCD2', 'ยางนอก'],
    ]);
    const { items } = parseItemSheet(buf, 'Sheet1');

    expect(items[0]).toMatchObject({
      category: 'ยางนอก',
      brand: 'MICHELIN',
      model: 'XCD2',
      size: '205/55-16',
      unitPrice: 3200,
      soldQty: 4,
    });
  });

  it('does not confuse ราคาต้นทุน with ราคาขาย', () => {
    const buf = book([
      ['รายการ', 'ราคาต้นทุนไม่รวม vat', 'ราคาขาย', 'ขายรวม'],
      ['ยางนอก', 2672, 2950, 3],
    ]);
    const { items } = parseItemSheet(buf, 'Sheet1');
    expect(items[0].unitPrice).toBe(2950);
    expect(items[0].costExVat).toBe(2672);
  });

  it('treats a missing sold-quantity column as zero', () => {
    const buf = book([
      ['รายการสินค้า', 'ราคาขาย'],
      ['ยางนอก MICHELIN', 4000],
      ['ยางนอก BF', 5500],
    ]);
    const { items, warnings } = parseItemSheet(buf, 'Sheet1');

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.soldQty === 0)).toBe(true);
    expect(warnings.join(' ')).toContain('ขายรวม');
  });

  it('reports a missing price column instead of returning nothing silently', () => {
    const buf = book([
      ['รายการสินค้า', 'ยี่ห้อ', 'ขายรวม'],
      ['ยางนอก', 'MICHELIN', 4],
    ]);
    const { items, warnings } = parseItemSheet(buf, 'Sheet1');
    expect(items).toHaveLength(0);
    expect(warnings.join(' ')).toContain('ราคา');
  });

  it('uses ขายรวม and ignores ยกมา ซื้อ ขาย-marker and คงเหลือ', () => {
    const buf = book([
      ['รายการ', 'ยกมา', 'ซื้อ', 'ขาย', 'ขายรวม', 'ยอดคงเหลือ', 'ราคาขาย'],
      ['ยางนอก', 10, 4, '✓', 3, 11, 3000],
    ]);
    const { items } = parseItemSheet(buf, 'Sheet1');
    expect(items[0]).toMatchObject({ soldQty: 3, unitPrice: 3000 });
  });
});
