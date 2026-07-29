import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  parseBillSheet,
  parseItemSheet,
} from '../../common/excel/bill-batch-parser';
import { match } from './matcher';
import {
  BillInput,
  MatchedBill,
  PoolItemInput,
  ServiceFeeInput,
} from './types';

/** The shop's real catalogue, as supplied by the owner. */
const FEES: ServiceFeeInput[] = [
  {
    id: 'f-patch',
    name: 'ปะยาง',
    minPrice: 100,
    maxPrice: 200,
    maxQty: 4,
    group: 'patch',
  },
  {
    id: 'f-align',
    name: 'ตั้งศูนย์',
    minPrice: 150,
    maxPrice: 300,
    maxQty: 1,
    group: 'wheel',
  },
  {
    id: 'f-rot',
    name: 'สลับยางถ่วงล้อ',
    minPrice: 100,
    maxPrice: 250,
    maxQty: 1,
    group: 'wheel',
  },
  {
    id: 'f-rotalign',
    name: 'สลับยางถ่วงล้อ + ตั้งศูนย์',
    minPrice: 250,
    maxPrice: 400,
    maxQty: 1,
    group: 'wheel',
  },
  {
    id: 'f-brake',
    name: 'เจียจานเบรก',
    minPrice: 250,
    maxPrice: 250,
    maxQty: 4,
    group: 'brake',
  },
  {
    id: 'f-bal',
    name: 'ถ่วงล้อ',
    minPrice: 100,
    maxPrice: 200,
    maxQty: 1,
    group: 'wheel',
  },
];

function tire(
  id: string,
  price: number,
  qty: number,
  size = '205/55-16',
): PoolItemInput {
  return {
    id,
    sortOrder: Number(id.replace(/\D/g, '')) || 0,
    category: 'ยางนอก',
    brand: 'MICHELIN',
    model: 'XCD2',
    size,
    soldQty: qty,
    unitPrice: price,
    costExVat: null,
  };
}

function part(
  id: string,
  price: number,
  qty: number,
  category = 'อะไหล่',
): PoolItemInput {
  return {
    id,
    sortOrder: 0,
    category,
    brand: 'OEM',
    model: 'GEN',
    size: '-',
    soldQty: qty,
    unitPrice: price,
    costExVat: null,
  };
}

const bill = (
  seq: number,
  amount: number,
  extra: Partial<BillInput> = {},
): BillInput => ({
  seq,
  date: null,
  amount,
  ...extra,
});

/** Reusable invariant battery — every result must satisfy all of these. */
function checkInvariants(
  result: { bills: MatchedBill[]; matchedByPoolItem: Record<string, number> },
  pool: PoolItemInput[],
) {
  const byId = new Map(pool.map((p) => [p.id, p]));

  for (const b of result.bills) {
    if (b.matched) {
      const sum = b.lines.reduce((s, l) => s + l.lineTotal, 0);
      expect(sum, `bill ${b.seq} lines must sum to its amount`).toBe(b.amount);
    }

    for (const l of b.lines) {
      expect(
        l.qty * l.unitPrice,
        `bill ${b.seq} line "${l.description}" must multiply out`,
      ).toBe(l.lineTotal);
      expect(
        Number.isInteger(l.lineTotal),
        `bill ${b.seq} line must be whole baht`,
      ).toBe(true);
      expect(l.lineTotal).toBeGreaterThan(0);
    }

    // Tyres leave in ones, twos or fours. Three identical tyres is the tell.
    const tires = b.lines.filter(
      (l) => l.kind === 'ITEM' && /ยางนอก|ยางใน/.test(l.description),
    );
    for (const t of tires) {
      expect(
        [1, 2, 4],
        `bill ${b.seq} tyre qty ${t.qty} is not a real-world quantity`,
      ).toContain(t.qty);
    }

    // Nobody patches tyres they just bought — at most four wheels in total.
    const patch = b.lines.find((l) => l.description === 'ปะยาง');
    if (patch && tires.length) {
      const newTires = tires.reduce((s, t) => s + t.qty, 0);
      expect(
        newTires + patch.qty,
        `bill ${b.seq}: ${newTires} new tyres + ${patch.qty} patches`,
      ).toBeLessThanOrEqual(4);
    }

    // One wheel-group fee per bill.
    const wheelFees = b.lines.filter((l) =>
      [
        'ตั้งศูนย์',
        'สลับยางถ่วงล้อ',
        'สลับยางถ่วงล้อ + ตั้งศูนย์',
        'ถ่วงล้อ',
      ].includes(l.description),
    );
    expect(
      wheelFees.length,
      `bill ${b.seq} has ${wheelFees.length} wheel services`,
    ).toBeLessThanOrEqual(1);
  }

  for (const [id, qty] of Object.entries(result.matchedByPoolItem)) {
    const item = byId.get(id);
    expect(item, `sold an unknown pool item ${id}`).toBeDefined();
    expect(
      qty,
      `allocated more than the known sold quantity for ${id}`,
    ).toBeLessThanOrEqual(item!.soldQty);
  }
}

describe('bill matcher engine', () => {
  const opts = { timeBudgetMs: 200, seed: 1 };

  it('backs a set-of-four bill with four identical tyres', () => {
    const pool = [tire('t1', 4000, 40)];
    const res = match([bill(1, 16000)], pool, FEES, opts);

    expect(res.stats.matchedBills).toBe(1);
    expect(res.bills[0].freeform).toBe(0);
    const item = res.bills[0].lines.find((l) => l.kind === 'ITEM');
    expect(item?.qty).toBe(4);
    checkInvariants(res, pool);
  });

  it('closes an odd remainder with a ranged service fee', () => {
    // 16,000 of tyres + 230 that only a range can express — no fee has a fixed
    // 230 price, but ถ่วงล้อ spans 100-200 and สลับยางถ่วงล้อ spans 100-250.
    const pool = [tire('t1', 4000, 40)];
    const res = match([bill(1, 16230)], pool, FEES, opts);

    expect(res.bills[0].freeform).toBe(0);
    const svc = res.bills[0].lines.filter((l) => l.kind === 'SERVICE');
    expect(svc.length).toBeGreaterThan(0);
    expect(svc.reduce((s, l) => s + l.lineTotal, 0)).toBe(230);
    checkInvariants(res, pool);
  });

  it('never puts ปะยาง on a bill carrying four new tyres', () => {
    const pool = [tire('t1', 4000, 40)];
    // 16,800 = 4x4000 + 800, and 800 is exactly 4x ปะยาง at max price.
    const res = match([bill(1, 16800)], pool, FEES, opts);
    const tyreQty = res.bills[0].lines
      .filter((l) => l.kind === 'ITEM')
      .reduce((s, l) => s + l.qty, 0);
    const patch = res.bills[0].lines.find((l) => l.description === 'ปะยาง');
    if (tyreQty === 4) expect(patch).toBeUndefined();
    checkInvariants(res, pool);
  });

  it('pairs a second SKU when no single SKU can reach the amount', () => {
    // 38,000 is out of reach of 4x4000 plus any service, but 4x4000 + 4x5500 lands it.
    const pool = [tire('t1', 4000, 40), tire('t2', 5500, 40, '225/45-17')];
    const res = match([bill(1, 38000)], pool, FEES, opts);

    expect(res.bills[0].freeform).toBe(0);
    expect(res.bills[0].lines.filter((l) => l.kind === 'ITEM').length).toBe(2);
    checkInvariants(res, pool);
  });

  it('bills a small amount as services only', () => {
    const pool = [tire('t1', 4000, 40)];
    const res = match([bill(1, 150)], pool, FEES, opts);

    expect(res.bills[0].lines.every((l) => l.kind !== 'ITEM')).toBe(true);
    expect(res.bills[0].freeform).toBe(0);
    checkInvariants(res, pool);
  });

  it('prefers a known sold item over an equally valid service-only bill', () => {
    const pool = [part('p1', 200, 1)];
    const res = match([bill(1, 350)], pool, FEES, opts);

    expect(res.matchedByPoolItem['p1']).toBe(1);
    expect(res.stats.unmatchedSoldUnits).toBe(0);
    expect(res.bills[0].lines.some((line) => line.poolItemId === 'p1')).toBe(
      true,
    );
    checkInvariants(res, pool);
  });

  it('never attributes more than the known sold quantity', () => {
    const pool = [tire('t1', 4000, 6)]; // only 6 known sold units for bills wanting 12
    const bills = [bill(1, 16000), bill(2, 16000), bill(3, 16000)];
    const res = match(bills, pool, FEES, opts);

    expect(res.matchedByPoolItem['t1'] ?? 0).toBeLessThanOrEqual(6);
    expect(res.stats.unmatchedSoldUnits).toBe(0);
    checkInvariants(res, pool);
  });

  it('leaves locked bills untouched and reserves their stock first', () => {
    const pool = [tire('t1', 4000, 4)];
    const locked = bill(1, 16000, {
      locked: true,
      existingLines: [
        {
          kind: 'ITEM',
          poolItemId: 't1',
          description: 'ยางนอก MICHELIN XCD2 205/55-16',
          qty: 4,
          unitPrice: 4000,
          lineTotal: 16000,
        },
      ],
    });
    const res = match([locked, bill(2, 16000)], pool, FEES, opts);

    const kept = res.bills.find((b) => b.seq === 1)!;
    expect(kept.lines).toHaveLength(1);
    expect(kept.lines[0].poolItemId).toBe('t1');
    // All four units are spoken for, so bill 2 cannot also claim them.
    expect(res.matchedByPoolItem['t1']).toBe(4);
    checkInvariants(res, pool);
  });

  it('is deterministic for a given seed', () => {
    const pool = [
      tire('t1', 4000, 40),
      tire('t2', 3500, 40, '195/65-15'),
      part('p1', 850, 30),
    ];
    const bills = [bill(1, 16230), bill(2, 8000), bill(3, 1700), bill(4, 350)];

    const a = match(bills, pool, FEES, { timeBudgetMs: 150, seed: 7 });
    const b = match(bills, pool, FEES, { timeBudgetMs: 150, seed: 7 });
    expect(JSON.stringify(a.bills)).toBe(JSON.stringify(b.bills));
  });

  it('reports stats consistent with the bills it returned', () => {
    const pool = [tire('t1', 4000, 40), part('p1', 850, 30)];
    const bills = [bill(1, 16000), bill(2, 1700), bill(3, 250)];
    const res = match(bills, pool, FEES, opts);

    expect(res.stats.totalBills).toBe(3);
    expect(res.stats.totalBillValue).toBe(17950);
    expect(res.stats.freeformTotal).toBe(
      res.bills.reduce((s, b) => s + b.freeform, 0),
    );
    expect(res.stats.matchedSoldUnits).toBe(
      Object.values(res.matchedByPoolItem).reduce((s, q) => s + q, 0),
    );
  });

  it('reports known sold units that cannot be placed on the available bills', () => {
    const pool = [tire('t1', 4000, 8)];
    const res = match([bill(1, 16000)], pool, FEES, opts);

    expect(res.matchedByPoolItem['t1']).toBe(4);
    expect(res.stats.knownSoldUnits).toBe(8);
    expect(res.stats.matchedSoldUnits).toBe(4);
    expect(res.stats.unmatchedSoldUnits).toBe(4);
    checkInvariants(res, pool);
  });
});

// ---------------------------------------------------------------------------
// Full-scale regression against the shop's actual June 2569 workbook. Skipped
// where the file isn't present; the synthetic cases above cover the invariants.
// ---------------------------------------------------------------------------
const WORKBOOK = 'C:\\Users\\zacrt\\Downloads\\สต็อก ปี 2569 ใหม่ (1).xlsx';
const hasWorkbook = fs.existsSync(WORKBOOK);

describe('bill matcher — real June 2569 batch', () => {
  (hasWorkbook ? it : it.skip)(
    'matches every bill plausibly and fast',
    () => {
      const buf = fs.readFileSync(WORKBOOK);
      const { bills } = parseBillSheet(buf, 'เตรียมยอดอย่างย่อ');
      const { items } = parseItemSheet(buf, 'มิถุนา 69');

      // The sheet totals itself in column Q: 2,031,420 across 272 bills.
      expect(bills).toHaveLength(272);
      expect(bills.reduce((s, b) => s + b.amount, 0)).toBe(2_031_420);
      expect(items).toHaveLength(1250);

      const res = match(bills, items, FEES, { timeBudgetMs: 3000, seed: 1 });
      const s = res.stats;

      expect(s.matchedBills).toBe(272);
      // Column I is blank in this workbook, so there are no known sold units yet.
      expect(s.knownSoldUnits).toBe(0);
      expect(s.matchedSoldUnits).toBe(0);
      expect(s.unmatchedSoldUnits).toBe(0);
      expect(s.avgLinesPerBill).toBeLessThanOrEqual(2.0);
      expect(s.elapsedMs).toBeLessThan(5000);

      checkInvariants(res, items);
    },
    20_000,
  );
});
