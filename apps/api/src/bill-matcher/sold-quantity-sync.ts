/**
 * Pairing a re-read stock sheet against the pool items already in a batch.
 *
 * Pure, because the interesting part is the pairing rather than the writing.
 * Row position is not usable as identity — a month's sheet gains rows as new
 * things sell, so the row that was line 400 in June is somewhere else by the
 * time ขายรวม is filled in. What does identify a SKU is its description and its
 * price, and the sheet genuinely repeats that pair, so repeats are matched off
 * in sheet order rather than collapsed.
 */

export interface SoldQtyRow {
  category: string;
  brand: string;
  model: string;
  size: string;
  unitPrice: number;
  soldQty: number;
}

export interface SoldQtyTarget extends SoldQtyRow {
  id: string;
  matchedQty: number;
}

export interface SoldQtySync {
  updates: { id: string; soldQty: number }[];
  /**
   * Items whose bills already allocate more than the sheet now says was sold.
   * Reported, never corrected — the bills were built by hand and only the
   * operator can say which side is wrong.
   */
  overAllocated: {
    description: string;
    soldQty: number;
    matchedQty: number;
  }[];
  /** Pool items the sheet no longer has a row for. */
  missingFromFile: number;
  /** Sheet rows with no counterpart in the batch — SKUs added since import. */
  unmatchedInFile: number;
}

const describe = (r: SoldQtyRow): string =>
  [r.category, r.brand, r.model, r.size]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');

const keyOf = (r: SoldQtyRow): string =>
  [r.category, r.brand, r.model, r.size]
    .map((s) => (s ?? '').trim())
    .join('|') + `|${r.unitPrice}`;

export function syncSoldQuantities(
  targets: SoldQtyTarget[],
  rows: SoldQtyRow[],
): SoldQtySync {
  const fromFile = new Map<string, number[]>();
  for (const row of rows) {
    const k = keyOf(row);
    const bucket = fromFile.get(k);
    if (bucket) bucket.push(row.soldQty);
    else fromFile.set(k, [row.soldQty]);
  }

  const taken = new Map<string, number>();
  const updates: SoldQtySync['updates'] = [];
  const overAllocated: SoldQtySync['overAllocated'] = [];
  let missingFromFile = 0;

  for (const target of targets) {
    const k = keyOf(target);
    const bucket = fromFile.get(k);
    const at = taken.get(k) ?? 0;
    if (!bucket || at >= bucket.length) {
      missingFromFile++;
      continue;
    }
    taken.set(k, at + 1);

    const soldQty = bucket[at];
    if (soldQty !== target.soldQty) updates.push({ id: target.id, soldQty });
    if (soldQty < target.matchedQty) {
      overAllocated.push({
        description: describe(target),
        soldQty,
        matchedQty: target.matchedQty,
      });
    }
  }

  const unmatchedInFile = [...fromFile].reduce(
    (sum, [k, bucket]) => sum + Math.max(0, bucket.length - (taken.get(k) ?? 0)),
    0,
  );

  return { updates, overAllocated, missingFromFile, unmatchedInFile };
}
