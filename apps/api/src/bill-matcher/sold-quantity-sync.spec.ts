import { describe, expect, it } from 'vitest';
import {
  SoldQtyRow,
  SoldQtyTarget,
  syncSoldQuantities,
} from './sold-quantity-sync';

const row = (
  size: string,
  unitPrice: number,
  soldQty: number,
): SoldQtyRow => ({
  category: 'ยางนอก',
  brand: 'MICHELIN',
  model: 'XCD2',
  size,
  unitPrice,
  soldQty,
});

const target = (
  id: string,
  size: string,
  unitPrice: number,
  soldQty = 0,
  matchedQty = 0,
): SoldQtyTarget => ({ ...row(size, unitPrice, soldQty), id, matchedQty });

describe('syncSoldQuantities', () => {
  it('fills in quantities that arrive after the batch was imported', () => {
    const targets = [
      target('t1', '205/55-16', 4000),
      target('t2', '225/45-17', 5500),
    ];
    const res = syncSoldQuantities(targets, [
      row('205/55-16', 4000, 12),
      row('225/45-17', 5500, 4),
    ]);

    expect(res.updates).toEqual([
      { id: 't1', soldQty: 12 },
      { id: 't2', soldQty: 4 },
    ]);
    expect(res.missingFromFile).toBe(0);
    expect(res.unmatchedInFile).toBe(0);
    expect(res.overAllocated).toEqual([]);
  });

  it('pairs on description and price, not on row position', () => {
    // The sheet gained a row above the one we care about.
    const targets = [target('t1', '205/55-16', 4000)];
    const res = syncSoldQuantities(targets, [
      row('195/65-15', 3000, 8), // new SKU, first in the file now
      row('205/55-16', 4000, 12),
    ]);

    expect(res.updates).toEqual([{ id: 't1', soldQty: 12 }]);
    expect(res.unmatchedInFile).toBe(1);
    expect(res.missingFromFile).toBe(0);
  });

  it('tells identical SKUs apart by price', () => {
    const targets = [
      target('t1', '215/75-14', 9600),
      target('t2', '215/75-14', 14000),
    ];
    const res = syncSoldQuantities(targets, [
      row('215/75-14', 14000, 7),
      row('215/75-14', 9600, 3),
    ]);

    expect(res.updates).toEqual([
      { id: 't1', soldQty: 3 },
      { id: 't2', soldQty: 7 },
    ]);
  });

  it('matches repeated identical rows off in sheet order', () => {
    // Same description AND same price, twice. Nothing distinguishes them, so
    // they are paired positionally within the group rather than collapsed.
    const targets = [
      target('t1', '205/55-16', 4000),
      target('t2', '205/55-16', 4000),
    ];
    const res = syncSoldQuantities(targets, [
      row('205/55-16', 4000, 5),
      row('205/55-16', 4000, 9),
    ]);

    expect(res.updates).toEqual([
      { id: 't1', soldQty: 5 },
      { id: 't2', soldQty: 9 },
    ]);
    expect(res.unmatchedInFile).toBe(0);
    expect(res.missingFromFile).toBe(0);
  });

  it('counts a batch item the sheet no longer carries', () => {
    const targets = [
      target('t1', '205/55-16', 4000),
      target('t2', '999/99-99', 1234),
    ];
    const res = syncSoldQuantities(targets, [row('205/55-16', 4000, 12)]);

    expect(res.missingFromFile).toBe(1);
    expect(res.updates).toEqual([{ id: 't1', soldQty: 12 }]);
  });

  it('reports bills that already allocate more than the sheet says was sold', () => {
    // Hand-matched 6 units before the quantities arrived; the sheet says 4.
    const targets = [target('t1', '205/55-16', 4000, 0, 6)];
    const res = syncSoldQuantities(targets, [row('205/55-16', 4000, 4)]);

    expect(res.overAllocated).toEqual([
      {
        description: 'ยางนอก MICHELIN XCD2 205/55-16',
        soldQty: 4,
        matchedQty: 6,
      },
    ]);
    // Still updated — the sheet is the source of truth for what was sold. The
    // bills are left alone and the conflict is handed to the operator.
    expect(res.updates).toEqual([{ id: 't1', soldQty: 4 }]);
  });

  it('is quiet when the sheet agrees with what is already stored', () => {
    const targets = [target('t1', '205/55-16', 4000, 12, 12)];
    const res = syncSoldQuantities(targets, [row('205/55-16', 4000, 12)]);

    expect(res.updates).toEqual([]);
    expect(res.overAllocated).toEqual([]);
  });

  it('survives the shape of the real batch: 1,250 rows, all blank', () => {
    const targets = Array.from({ length: 1250 }, (_, i) =>
      target(`t${i}`, `2${i % 90}/55-16`, 1000 + (i % 40) * 250),
    );
    const rows = targets.map((t) => ({ ...t, soldQty: 4 }));
    const res = syncSoldQuantities(targets, rows);

    expect(res.updates).toHaveLength(1250);
    expect(res.missingFromFile).toBe(0);
    expect(res.unmatchedInFile).toBe(0);
  });
});
