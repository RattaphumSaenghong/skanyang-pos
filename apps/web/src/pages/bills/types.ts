/** Shapes returned by /bill-batches, shared by the page and the match workspace. */

export interface Batch {
  id: string;
  label: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  createdAt: string;
  _count: { bills: number };
}

export interface BillLine {
  id: string;
  kind: 'ITEM' | 'SERVICE' | 'FREEFORM';
  poolItemId: string | null;
  serviceFeeId?: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Bill {
  id: string;
  seq: number;
  billDate: string;
  amount: number;
  locked: boolean;
  status: string;
  lines: BillLine[];
}

export interface PoolItem {
  id: string;
  sortOrder: number;
  category: string;
  brand: string;
  model: string;
  size: string;
  soldQty: number;
  matchedQty: number;
  unitPrice: number;
}

export interface BatchDetail {
  id: string;
  label: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  createdAt: string;
  bills: Bill[];
  poolItems: PoolItem[];
}

export interface ServiceFee {
  id: string;
  name: string;
  minPrice: number;
  maxPrice: number;
  maxQty: number;
  group: string;
  active: boolean;
  sortOrder: number;
}

/** A line being edited. Same as BillLine without the row id. */
export interface DraftLine {
  kind: 'ITEM' | 'SERVICE' | 'FREEFORM';
  poolItemId?: string | null;
  serviceFeeId?: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Suggestion {
  score: number;
  units: number;
  freeform: number;
  lines: DraftLine[];
}

export const itemLabel = (item: PoolItem): string =>
  [item.category, item.brand, item.model, item.size]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
