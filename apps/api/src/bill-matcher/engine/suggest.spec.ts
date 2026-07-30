import { describe, expect, it } from 'vitest';
import { closeGap, contextFromLines, suggestForBill } from './suggest';
import { MatchLine, PoolItemInput, ServiceFeeInput } from './types';

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
    id: 'f-brake',
    name: 'เจียจานเบรก',
    minPrice: 250,
    maxPrice: 250,
    maxQty: 4,
    group: 'brake',
  },
];

function tire(id: string, price: number, qty: number): PoolItemInput {
  return {
    id,
    sortOrder: 0,
    category: 'ยางนอก',
    brand: 'MICHELIN',
    model: 'XCD2',
    size: '205/55-16',
    soldQty: qty,
    unitPrice: price,
    costExVat: null,
  };
}

const full = (pool: PoolItemInput[]) => pool.map((p) => p.soldQty);

describe('suggestForBill', () => {
  it('offers the exact set-of-four first', () => {
    const pool = [tire('t1', 4000, 40), tire('t2', 3000, 8)];
    const [top] = suggestForBill(16000, pool, full(pool), FEES);

    expect(top.freeform).toBe(0);
    expect(top.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(16000);
    const item = top.lines.find((l) => l.kind === 'ITEM');
    expect(item?.poolItemId).toBe('t1');
    expect(item?.qty).toBe(4);
  });

  it('returns distinct baskets, not spellings of one', () => {
    const pool = [
      tire('t1', 4000, 40),
      tire('t2', 3000, 40),
      tire('t3', 2000, 40),
    ];
    const out = suggestForBill(16000, pool, full(pool), FEES);

    const baskets = out.map((s) =>
      s.lines
        .filter((l) => l.kind === 'ITEM')
        .map((l) => `${l.poolItemId}x${l.qty}`)
        .join('+'),
    );
    expect(new Set(baskets).size).toBe(baskets.length);
  });

  it('every option balances to the bill amount', () => {
    const pool = [tire('t1', 3150, 12), tire('t2', 890, 30)];
    for (const s of suggestForBill(7480, pool, full(pool), FEES)) {
      expect(s.lines.reduce((sum, l) => sum + l.lineTotal, 0)).toBe(7480);
      for (const l of s.lines) expect(l.qty * l.unitPrice).toBe(l.lineTotal);
    }
  });

  it('honours the capacity the caller passes', () => {
    const pool = [tire('t1', 4000, 40)];
    // Only one unit free — a four-tyre option must not be offered.
    const out = suggestForBill(16000, pool, [1], FEES);

    for (const s of out) {
      for (const l of s.lines) {
        if (l.kind === 'ITEM') expect(l.qty).toBeLessThanOrEqual(1);
      }
    }
  });

  it('respects the requested limit', () => {
    const pool = [tire('t1', 4000, 40), tire('t2', 2000, 40)];
    expect(suggestForBill(16000, pool, full(pool), FEES, 2).length).toBe(2);
  });
});

describe('closeGap', () => {
  const poolById = new Map([['t1', tire('t1', 4000, 40)]]);
  const itemLine: MatchLine = {
    kind: 'ITEM',
    poolItemId: 't1',
    description: 'ยางนอก MICHELIN',
    qty: 2,
    unitPrice: 4000,
    lineTotal: 8000,
  };

  it('closes a reachable gap exactly with service lines', () => {
    const lines = closeGap(300, contextFromLines([itemLine], poolById), FEES);

    expect(lines).not.toBeNull();
    expect(lines!.reduce((s, l) => s + l.lineTotal, 0)).toBe(300);
    expect(lines!.every((l) => l.kind === 'SERVICE')).toBe(true);
  });

  it('returns null when the fee ranges cannot express the gap', () => {
    expect(closeGap(999999, contextFromLines([], poolById), FEES)).toBeNull();
  });

  it('never suggests patching tyres the bill just sold four of', () => {
    const four: MatchLine = { ...itemLine, qty: 4, lineTotal: 16000 };
    const lines = closeGap(400, contextFromLines([four], poolById), FEES);

    expect(lines?.some((l) => l.description === 'ปะยาง')).not.toBe(true);
  });

  it('reads the dearest item line as the bill shape', () => {
    const cheap: MatchLine = {
      kind: 'ITEM',
      poolItemId: 'unknown-in-pool',
      description: 'อื่นๆ',
      qty: 1,
      unitPrice: 100,
      lineTotal: 100,
    };
    const ctx = contextFromLines([cheap, itemLine], poolById);

    expect(ctx.hasItem).toBe(true);
    expect(ctx.isTire).toBe(true);
    expect(ctx.qty).toBe(2);
  });
});
