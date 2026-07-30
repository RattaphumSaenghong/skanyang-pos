/**
 * Shared contracts for the bills matcher.
 *
 * The engine is deliberately pure: it takes plain objects and returns plain
 * objects, so it can be unit-tested against a real workbook without a database.
 * The parser produces these types; the Nest service persists them.
 *
 * Every monetary value in this file is WHOLE BAHT as an integer.
 */

/** A bill to be backed by items — one row of the เตรียมยอดอย่างย่อ sheet. */
export interface BillInput {
  /** Position in the sheet, 1-based, running across all four column groups. */
  seq: number;
  /** Null when the sheet left it blank and no earlier row carried one down. */
  date: Date | null;
  amount: number;
  /** Locked bills keep `existingLines` and are never reassigned. */
  locked?: boolean;
  /** Only read when `locked` is true. */
  existingLines?: MatchLine[];
}

/** A SKU the matcher may draw from — one row of the monthly stock sheet. */
export interface PoolItemInput {
  /** Stable handle; the Nest service uses the BillPoolItem id, tests use the row index. */
  id: string;
  sortOrder: number;
  /** รายการสินค้า — ยางนอก, ดิสเบรค, โช๊คอัพ, กรอง, ... */
  category: string;
  brand: string;
  model: string;
  size: string;
  /** Known quantity sold from column I (ขายรวม). The matcher must allocate these units. */
  soldQty: number;
  unitPrice: number;
  costExVat: number | null;
}

/**
 * A priced service used as filler. `minPrice`/`maxPrice` are a genuine range —
 * the slack is what lets the matcher close a gap exactly.
 */
export interface ServiceFeeInput {
  id: string;
  name: string;
  minPrice: number;
  maxPrice: number;
  /** How many of this fee may appear on one bill (e.g. เจียจานเบรก up to 4). */
  maxQty: number;
  /** At most one fee per group lands on a bill. */
  group: string;
}

export type MatchLineKind = 'ITEM' | 'SERVICE' | 'FREEFORM';

export interface MatchLine {
  kind: MatchLineKind;
  /** Set when kind === 'ITEM'. */
  poolItemId?: string;
  /** Set when kind === 'SERVICE'. */
  serviceFeeId?: string;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface MatchedBill {
  seq: number;
  amount: number;
  matched: boolean;
  lines: MatchLine[];
  /** Baht left on a generic ค่าบริการ line. 0 means a clean match. */
  freeform: number;
  /** Engine score — drives the review sort so the worst bills surface first. */
  score: number;
}

export interface MatchOptions {
  /** Wall-clock ceiling for the LNS repair loop. Default 3000. */
  timeBudgetMs?: number;
  /** Deterministic runs for tests. Default 1. */
  seed?: number;
  /**
   * The pool carries no recorded sold quantities — the stock sheet's ขายรวม
   * column has not been filled in yet, which is normal before month end.
   *
   * Changes the objective, not just the ceiling. Allocating "as many known sold
   * units as possible" is meaningless when none are known, and pursuing it
   * anyway makes the engine pile items onto every bill to run the count up. So
   * unconstrained runs are judged on plausibility alone.
   */
  unconstrained?: boolean;
}

export interface MatchResult {
  bills: MatchedBill[];
  /** poolItemId → known sold units successfully allocated to bills. */
  matchedByPoolItem: Record<string, number>;
  stats: {
    totalBills: number;
    matchedBills: number;
    /** Bills closed with no free-form line at all. */
    exactBills: number;
    totalBillValue: number;
    freeformTotal: number;
    knownSoldUnits: number;
    matchedSoldUnits: number;
    unmatchedSoldUnits: number;
    avgLinesPerBill: number;
    elapsedMs: number;
  };
}

// --- Parser output -------------------------------------------------------

export interface ParsedBillSheet {
  bills: BillInput[];
  /** Non-fatal notes: skipped repeated headers, unparseable dates, etc. */
  warnings: string[];
}

export interface ParsedItemSheet {
  items: PoolItemInput[];
  warnings: string[];
}
