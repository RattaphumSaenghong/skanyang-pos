import * as XLSX from 'xlsx';
import {
  BillInput,
  PoolItemInput,
  ParsedBillSheet,
  ParsedItemSheet,
} from '../../bill-matcher/engine/types';

/**
 * Parse the bill sheet (เตรียมยอดอย่างย่อ).
 *
 * Layout: four column-groups laid out side by side:
 * - Group 1: cols A(0), B(1), C(2)
 * - Group 2: cols E(4), F(5), G(6)
 * - Group 3: cols I(8), J(9), K(10)
 * - Group 4: cols M(12), N(13), O(14)
 *
 * Each group has: seq, date, amount
 * Groups run 1-34, 35-68, 69-102, 103-136
 */
export function parseBillSheet(
  buffer: Buffer,
  sheetName: string,
): ParsedBillSheet {
  const warnings: string[] = [];
  const bills: BillInput[] = [];

  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false });
    const ws = wb.Sheets[sheetName];

    if (!ws) {
      warnings.push(`Sheet "${sheetName}" not found`);
      return { bills: [], warnings };
    }

    const data = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as (unknown[] | null)[];

    if (!data || data.length === 0) {
      warnings.push(`Sheet "${sheetName}" is empty`);
      return { bills: [], warnings };
    }

    // Prefer whatever the header row says; fall back to the original workbook's
    // fixed four-group layout when the sheet has no recognisable header.
    const detected = findBillHeaderRow(data);
    const groups: BillGroup[] = detected?.groups ?? [
      { seq: 0, date: 1, amount: 2 },
      { seq: 4, date: 5, amount: 6 },
      { seq: 8, date: 9, amount: 10 },
      { seq: 12, date: 13, amount: 14 },
    ];
    if (!detected) {
      warnings.push(
        'ไม่พบหัวตาราง — ใช้รูปแบบคอลัมน์เดิม (วันที่/จำนวน 4 ชุด)',
      );
    }

    // Where no sequence column exists, number the bills in reading order.
    const hasSeqColumn = groups.some((g) => g.seq !== null);
    let running = 0;

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;

      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        const dateVal = row[group.date];
        const amountVal = row[group.amount];

        // A bill is real only when amount is a positive number.
        const amount = toNumber(amountVal);
        if (amount === null || amount <= 0) continue;

        // The sequence number is what separates a real bill row from stray
        // values parked below the table — require it whenever the sheet has one.
        let seq: number;
        if (hasSeqColumn) {
          const parsedSeq =
            group.seq === null ? null : toNumber(row[group.seq]);
          if (parsedSeq === null || parsedSeq <= 0) continue;
          seq = parsedSeq;
        } else {
          seq = ++running;
        }

        // Parse only explicit dates here. Carry-forward happens after sorting
        // by sequence because the source lays consecutive bill ranges across
        // several column groups and repeated vertical blocks.
        let billDate: Date | null = null;
        if (dateVal !== null && dateVal !== undefined && dateVal !== '') {
          const parsed = parseThaiDate(dateVal);
          if (parsed) {
            billDate = parsed;
          } else {
            warnings.push(
              `Could not parse date "${dateVal}" at row ${r + 1}, group ${gi + 1}`,
            );
          }
        }

        bills.push({ seq, date: billDate, amount });
      }
    }

    // Sort by sequence
    bills.sort((a, b) => a.seq - b.seq);
    let carriedDate: Date | null = null;
    for (const bill of bills) {
      if (bill.date) carriedDate = bill.date;
      else bill.date = carriedDate;
    }

    return { bills, warnings };
  } catch (e) {
    warnings.push(
      `Error parsing bill sheet: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { bills: [], warnings };
  }
}

/**
 * Parse the item/stock sheet (มิถุนา 69, etc).
 *
 * Row 1: title
 * Row 2: header
 * Row 3+: data
 *
 * Columns (0-based):
 * 0: ลำดับ (sortOrder)
 * 1: รายการสินค้า (category)
 * 2: ยี่ห้อ (brand)
 * 3: รุ่น (model)
 * 4: ขนาด (size)
 * 5: ยกมา (ignore)
 * 6: ซื้อ (ignore)
 * 7: ขาย (manual marker; ignore)
 * 8: ขายรวม (known sold quantity)
 * 9: ยอดคงเหลือ (ignore)
 * 10: ราคาขาย (unitPrice)
 * 11: 0.03 markup (ignore)
 * 12: ราคาต้นทุนไม่รวม vat (costExVat)
 * 13: ยอดเงินคงเหลือ (ignore)
 */
export function parseItemSheet(
  buffer: Buffer,
  sheetName: string,
): ParsedItemSheet {
  const warnings: string[] = [];
  const items: PoolItemInput[] = [];

  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false });
    const ws = wb.Sheets[sheetName];

    if (!ws) {
      warnings.push(`Sheet "${sheetName}" not found`);
      return { items: [], warnings };
    }

    const data = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as (unknown[] | null)[];

    // A header row plus one data row is enough; the old three-row minimum
    // assumed the source workbook's title row, which hand-made files lack.
    if (!data || data.length < 2) {
      warnings.push(`Sheet "${sheetName}" is empty or too short`);
      return { items: [], warnings };
    }

    // Locate the columns by header; fall back to the original fixed layout.
    const detected = findHeaderRow(data);
    const cols: ItemColumns = detected?.cols ?? {
      sortOrder: 0,
      category: 1,
      brand: 2,
      model: 3,
      size: 4,
      soldQty: 8,
      unitPrice: 10,
      costExVat: 12,
    };
    const firstDataRow = detected ? detected.row + 1 : 2;

    if (!detected) {
      warnings.push('ไม่พบหัวตาราง — ใช้รูปแบบคอลัมน์เดิมของชีทสต็อก');
    } else if (cols.unitPrice === undefined) {
      warnings.push('ไม่พบคอลัมน์ราคา — ตรวจสอบหัวตาราง (เช่น "ราคาขาย")');
      return { items, warnings };
    }

    const cell = (row: unknown[], col: number | undefined) =>
      col === undefined ? null : row[col];
    const text = (row: unknown[], col: number | undefined) =>
      String(cell(row, col) ?? '').trim();

    if (cols.soldQty === undefined) {
      warnings.push('ไม่พบคอลัมน์ขายรวม — ถือว่าจำนวนขายเป็น 0 ทุกรายการ');
    }

    for (let r = firstDataRow; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;

      const unitPrice = toNumber(cell(row, cols.unitPrice));
      if (unitPrice === null || unitPrice <= 0) continue;

      // Column I is a fact supplied by the user, not a quantity for the engine
      // to infer from opening stock, purchases, or remaining stock.
      const soldQty = Math.max(
        0,
        Math.round(toNumberZero(cell(row, cols.soldQty))),
      );

      const costExVat = toNumber(cell(row, cols.costExVat));

      items.push({
        id: String(r),
        sortOrder: items.length,
        category: text(row, cols.category),
        brand: text(row, cols.brand),
        model: text(row, cols.model),
        size: text(row, cols.size),
        soldQty,
        unitPrice: Math.round(unitPrice),
        costExVat: costExVat !== null ? Math.round(costExVat) : null,
      });
    }

    return { items, warnings };
  } catch (e) {
    warnings.push(
      `Error parsing item sheet: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { items: [], warnings };
  }
}

/**
 * List all sheet names in the workbook.
 */
export function listSheetNames(buffer: Buffer): string[] {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames;
  } catch {
    return [];
  }
}

// ============================================================================
// Header detection
//
// The original workbook has a fixed layout, but hand-made sheets won't. Rather
// than pin column positions, find them by header name and keep the fixed layout
// only as a fallback for sheets with no usable header row.
// ============================================================================

/** Lowercase, strip spaces and punctuation, so "ราคา ขาย" matches "ราคาขาย". */
function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s ._/()-]+/g, '')
    .trim();
}

type ItemField =
  | 'sortOrder'
  | 'category'
  | 'brand'
  | 'model'
  | 'size'
  | 'soldQty'
  | 'unitPrice'
  | 'costExVat';

/**
 * Synonyms per field. A column is awarded to whichever field has the LONGEST
 * matching synonym, so "ราคาต้นทุนไม่รวม vat" goes to cost rather than being
 * grabbed by the shorter "ราคา" of unitPrice.
 */
const ITEM_SYNONYMS: Array<[ItemField, string[]]> = [
  [
    'unitPrice',
    ['ราคาขาย', 'ราคาต่อหน่วย', 'ราคาหน่วย', 'unitprice', 'price', 'ราคา'],
  ],
  [
    'costExVat',
    ['ราคาต้นทุนไม่รวมvat', 'ต้นทุนไม่รวมvat', 'ราคาต้นทุน', 'ต้นทุน', 'cost'],
  ],
  [
    'category',
    [
      'รายการสินค้า',
      'ประเภทสินค้า',
      'ชื่อสินค้า',
      'รายการ',
      'ประเภท',
      'สินค้า',
      'category',
      'description',
      'item',
    ],
  ],
  ['brand', ['ยี่ห้อ', 'แบรนด์', 'brand']],
  ['model', ['รุ่น', 'model']],
  ['size', ['ขนาด', 'size']],
  [
    'soldQty',
    [
      'จำนวนขาย',
      'จํานวนขาย',
      'ขายรวม',
      'quantitysold',
      'soldquantity',
      'soldqty',
      'qtysold',
    ],
  ],
  ['sortOrder', ['ลำดับ', 'ลําดับ', 'no']],
];

type ItemColumns = Partial<Record<ItemField, number>>;

function detectItemColumns(row: unknown[]): ItemColumns {
  const claims = new Map<ItemField, { col: number; len: number }>();

  for (let c = 0; c < row.length; c++) {
    const h = normalizeHeader(row[c]);
    if (!h) continue;

    let bestField: ItemField | null = null;
    let bestLen = 0;
    for (const [field, syns] of ITEM_SYNONYMS) {
      for (const s of syns) {
        if (h.includes(s) && s.length > bestLen) {
          bestField = field;
          bestLen = s.length;
        }
      }
    }
    if (!bestField) continue;

    const prev = claims.get(bestField);
    if (!prev || bestLen > prev.len)
      claims.set(bestField, { col: c, len: bestLen });
  }

  const out: ItemColumns = {};
  for (const [field, { col }] of claims) out[field] = col;
  return out;
}

/** Scan the first rows for the one that looks most like a header. */
function findHeaderRow(
  data: (unknown[] | null)[],
  limit = 12,
): { row: number; cols: ItemColumns } | null {
  let best: { row: number; cols: ItemColumns; score: number } | null = null;

  for (let r = 0; r < Math.min(limit, data.length); r++) {
    const row = data[r];
    if (!row) continue;
    const cols = detectItemColumns(row);
    const score = Object.keys(cols).length;
    // A real header names a price plus at least one descriptive column.
    if (score >= 2 && (!best || score > best.score))
      best = { row: r, cols, score };
  }
  return best ? { row: best.row, cols: best.cols } : null;
}

const DATE_SYNONYMS = ['วันที่', 'วันทึ่', 'date'];
const AMOUNT_SYNONYMS = [
  'จำนวนเงิน',
  'จํานวนเงิน',
  'ยอดเงิน',
  'จำนวน',
  'จํานวน',
  'ยอด',
  'amount',
  'total',
];

interface BillGroup {
  seq: number | null;
  date: number;
  amount: number;
}

/**
 * Find every (date, amount) column pair. The source sheet repeats the pair four
 * times across the page; a simple hand-made sheet has it once.
 */
function detectBillGroups(row: unknown[]): BillGroup[] {
  const dateCols: number[] = [];
  const amountCols: number[] = [];

  for (let c = 0; c < row.length; c++) {
    const h = normalizeHeader(row[c]);
    if (!h) continue;
    if (DATE_SYNONYMS.some((s) => h.includes(s))) dateCols.push(c);
    else if (AMOUNT_SYNONYMS.some((s) => h.includes(s))) amountCols.push(c);
  }

  const groups: BillGroup[] = [];
  for (const d of dateCols) {
    // Nearest amount column to the right, within a few columns.
    const amount = amountCols.find((a) => a > d && a - d <= 3);
    if (amount === undefined) continue;
    groups.push({ seq: d > 0 ? d - 1 : null, date: d, amount });
  }
  return groups;
}

function findBillHeaderRow(
  data: (unknown[] | null)[],
  limit = 12,
): { row: number; groups: BillGroup[] } | null {
  for (let r = 0; r < Math.min(limit, data.length); r++) {
    const row = data[r];
    if (!row) continue;
    const groups = detectBillGroups(row);
    if (groups.length) return { row: r, groups };
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a value to a number, or return null if not parseable.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;
  const n = Number(String(value).trim().replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * Convert a value to a number, defaulting to 0.
 */
function toNumberZero(value: unknown): number {
  return toNumber(value) ?? 0;
}

/**
 * Parse a Thai date in various formats and convert to CE.
 *
 * Formats:
 * - "01/06/69" = dd/mm/yy in Buddhist era (2569) → 2026-06-01
 * - JS Date object
 * - Excel serial number
 *
 * Returns null if unparseable.
 */
function parseThaiDate(value: unknown): Date | null {
  if (!value) return null;

  // Already a Date
  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }

  // Excel serial number (whole number or float)
  if (typeof value === 'number') {
    return excelSerialToDate(value);
  }

  // String parsing
  const str = String(value).trim();

  // dd/mm/yy format
  const match = str.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const yy = parseInt(match[3], 10);

    // BE to CE: assume 2569 = yy 69 → 2026
    // Formula: ceYear = 2500 + yy - 543
    // But that only works for yy >= 43 (year 2500+). For yy 69: 2500 + 69 - 543 = 2026. ✓
    // For yy < 43, assume year 2700+ (e.g., yy 20 → 2543, but more likely 2620).
    // Conservative approach: yy + 1900 or yy + 2000 depending on context.
    // Given the sheet is "ปี 2569", assume all dates are within 2500-2599.
    const ceYear = 2500 + yy - 543;

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const date = new Date(ceYear, month - 1, day);
    return isValidDate(date) ? date : null;
  }

  return null;
}

/**
 * Check if a Date object is valid (not Invalid Date).
 */
function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Convert an Excel serial number to a JS Date.
 * Excel epoch is 1899-12-30.
 * (JS epoch is 1970-01-01.)
 */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 0) return null;

  // Excel serial for 1970-01-01 is 25569
  const excelEpoch = new Date(1899, 11, 30); // month is 0-based
  const jsDate = new Date(excelEpoch.getTime() + serial * 86400000);

  return isValidDate(jsDate) ? jsDate : null;
}
