import * as XLSX from 'xlsx';

export interface ParsedPriceRow {
  model: string;
  brand: string;
  sizeRaw: string;
  sizeNormalized: string;
  sizeWidth: number;
  sizeSeries: number;
  sizeRim: number;
  dotYear: string | null;
  isSetPricing: boolean;
  arp: number | null;
  priceListed: number;
  costNormal: number;
  costPromo: number | null;
  priceCash: number;
  priceCard: number;
  priceZeroPct: number;
  priceBulk: number;
  discPromo: number;
  discTradeIn: number;
  discCard: number;
  discCash: number;
}

export interface ParseResult {
  rows: ParsedPriceRow[];
  sheetName: string;
  skipped: number;
  errors: string[];
}

// Rows with this fill color are "sell as set of 4"
const PINK_RGB = 'FF99FF';

// Keywords that identify print/layout sheets to skip
const PRINT_KEYWORDS = ['ปริ้น', 'print', 'ปริ้นท์'];

// Col A model prefix → brand name
const BRAND_BY_PREFIX: Array<[string, string]> = [
  ['XCD', 'MICHELIN'],
  ['AGI', 'MICHELIN'],
  ['PS', 'MICHELIN'],
  ['PILOT', 'MICHELIN'],
  ['PRIM', 'MICHELIN'],
  ['ENERG', 'MICHELIN'],
  ['CROSS', 'MICHELIN'],
  ['LTX', 'MICHELIN'],
  ['TOUR', 'MICHELIN'],
  ['TRAIL', 'MICHELIN'],
  ['BF', 'BF GOODRICH'],
  ['KO', 'BF GOODRICH'],
  ['TERRA', 'BF GOODRICH'],
  ['DUELER', 'BRIDGESTONE'],
  ['TURANZ', 'BRIDGESTONE'],
];

export function inferBrand(model: string): string {
  const upper = model.toUpperCase();
  for (const [prefix, brand] of BRAND_BY_PREFIX) {
    if (upper.startsWith(prefix)) return brand;
  }
  return 'MICHELIN';
}

/** Normalize any tire size string to "205/55-16" format */
export function normalizeSize(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/\*\d+$/, '').trim();
  // Replace R separator with -
  s = s.replace(/R(\d{2})\b/, '-$1');
  // Match: 3-digit width / 2-digit series - 2-digit rim
  const m = s.match(/(\d{3})\s*[/]\s*(\d{2})\s*[-]\s*(\d{2})/);
  if (m) return `${m[1]}/${m[2]}-${m[3]}`;
  return s;
}

function parseSizeParts(normalized: string): { width: number; series: number; rim: number } | null {
  const m = normalized.match(/^(\d{3})\/(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { width: parseInt(m[1]), series: parseInt(m[2]), rim: parseInt(m[3]) };
}

export function roundUp50(x: number): number {
  return Math.ceil(x / 50) * 50;
}

export function getProfitPerTire(model: string, rim: number, cost: number): number {
  if (model.toUpperCase().includes('XCD')) return cost / 0.95 - cost;
  if (rim <= 15) return 550;
  if (rim <= 17) return 625;
  if (rim === 18) return 675;
  // R19+
  if (cost <= 2000) return 625;
  if (cost <= 2500) return 625;
  if (cost <= 3000) return 675;
  if (cost <= 3500) return 750;
  if (cost <= 4000) return 825;
  if (cost <= 4500) return 875;
  if (cost <= 5000) return 950;
  if (cost <= 6000) return 1000;
  if (cost <= 8000) return 1125;
  return 1250;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function numZ(v: unknown): number {
  return num(v) ?? 0;
}

/** Pick the best data sheet to parse (most recent non-print sheet) */
function pickDataSheet(wb: XLSX.WorkBook): string {
  const THAI_MONTHS = ['มกรา', 'กุมภา', 'มีนา', 'เมษา', 'พฤษภา', 'มิถุนา', 'กรกฎา', 'สิงหา', 'กันยา', 'ตุลา', 'พฤศจิกา', 'ธันวา'];
  const isPrint = (s: string) => PRINT_KEYWORDS.some((k) => s.toLowerCase().includes(k.toLowerCase()));
  const dataSheets = wb.SheetNames.filter((s) => !isPrint(s));

  // Prefer the last sheet that contains a Thai month name
  const monthSheets = dataSheets.filter((s) => THAI_MONTHS.some((m) => s.includes(m)));
  if (monthSheets.length) return monthSheets[monthSheets.length - 1];

  // Fall back to last non-print sheet
  return dataSheets[dataSheets.length - 1] ?? wb.SheetNames[0];
}

/** Get the fill RGB of a cell (handles both ARGB 8-char and RGB 6-char) */
function getFillRgb(ws: XLSX.WorkSheet, r: number, c: number): string {
  try {
    const cell = ws[XLSX.utils.encode_cell({ r, c })] as any;
    const fg: string = cell?.s?.fgColor?.rgb ?? '';
    // Strip leading FF alpha channel if 8-char ARGB
    return fg.length === 8 ? fg.slice(2).toUpperCase() : fg.toUpperCase();
  } catch {
    return '';
  }
}

export function parsePriceListExcel(buffer: Buffer): ParseResult {
  const errors: string[] = [];
  let wb: XLSX.WorkBook;

  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true, codepage: 874 });
  } catch {
    try {
      wb = XLSX.read(buffer, { type: 'buffer', codepage: 874 });
    } catch (e) {
      throw new Error(`ไม่สามารถอ่านไฟล์ Excel ได้: ${e}`);
    }
  }

  const sheetName = pickDataSheet(wb);
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) return { rows: [], sheetName, skipped: 0, errors: ['Sheet ว่างเปล่า'] };

  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows: ParsedPriceRow[] = [];
  let skipped = 0;

  // Auto-detect data start: find first row where col C has a parseable tire size
  let dataStartRow = 3;
  for (let r = 0; r <= Math.min(15, range.e.r); r++) {
    const sizeCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    if (sizeCell?.v) {
      const norm = normalizeSize(String(sizeCell.v));
      if (parseSizeParts(norm)) {
        dataStartRow = r;
        break;
      }
    }
  }

  for (let r = dataStartRow; r <= range.e.r; r++) {
    try {
      const v = (c: number) => ws[XLSX.utils.encode_cell({ r, c })]?.v;

      const modelRaw = v(0); // A: model name
      const sizeRaw = v(2);  // C: size string

      // Skip completely blank rows
      if (!modelRaw && !sizeRaw) continue;
      if (!sizeRaw) { skipped++; continue; }

      const sizeStr = String(sizeRaw).trim();
      const sizeNormalized = normalizeSize(sizeStr);
      const parts = parseSizeParts(sizeNormalized);
      if (!parts) { skipped++; continue; }

      const model = modelRaw ? String(modelRaw).trim() : '';
      if (!model) { skipped++; continue; }

      const brand = inferBrand(model);

      // DOT year: prefer col B, fallback to *NN suffix in size
      const dotColB = v(1) ? String(v(1)).trim() : null;
      const dotFromSize = (() => { const m = sizeStr.match(/\*(\d+)$/); return m ? m[1] : null; })();
      const dotYear = dotColB || dotFromSize || null;

      // Set pricing = pink fill (FF99FF)
      const fillRgb = getFillRgb(ws, r, 0);
      const isSetPricing = fillRgb === PINK_RGB;

      // Prices & costs
      //   D(3)=ARP   E(4)=listed   F(5)=discPromo   G(6)=discTradeIn
      //   H(7)=discCard   I(8)=discCash
      //   J(9)=costNormal   L(11)=costPromo   AD(29)=oldCost
      //   N(13)=cashPrice   O(14)=cardPrice (may be empty → = cash)
      //   P(15)=zeroPctPrice (may be empty → = cash)   Q(16)=bulkPrice (may be empty → compute)
      const arp        = num(v(3));
      const priceListed = numZ(v(4));
      const discPromo  = numZ(v(5));
      const discTradeIn = numZ(v(6));
      const discCard   = numZ(v(7));
      const discCash   = numZ(v(8));
      const costNormal = numZ(v(9));

      // Promo cost: L column; if L empty use AD * 1.07
      const lVal = num(v(11));
      const adVal = num(v(29));
      const costPromo = (lVal && lVal > 0) ? lVal
        : (adVal && adVal > 0) ? adVal * 1.07 : null;

      const priceCash = numZ(v(13));  // N — always present
      if (priceCash === 0 && priceListed === 0) { skipped++; continue; }

      const priceCard    = num(v(14)) ?? priceCash;  // O → default to cash
      const priceZeroPct = num(v(15)) ?? priceCash;  // P → default to cash

      // Q bulk: use if present, else compute
      const qVal = num(v(16));
      let priceBulk: number;
      if (qVal && qVal > 0) {
        priceBulk = qVal;
      } else {
        const effectiveCost = (costPromo && costPromo > 0) ? costPromo : costNormal;
        const normalProfit = priceCash - effectiveCost;
        priceBulk = roundUp50(effectiveCost + normalProfit * 0.5 - 150);
        if (priceBulk <= effectiveCost) priceBulk = priceCash; // sanity floor
      }

      rows.push({
        model,
        brand,
        sizeRaw: sizeStr,
        sizeNormalized,
        sizeWidth: parts.width,
        sizeSeries: parts.series,
        sizeRim: parts.rim,
        dotYear,
        isSetPricing,
        arp,
        priceListed,
        costNormal,
        costPromo: (costPromo && costPromo > 0) ? costPromo : null,
        priceCash,
        priceCard,
        priceZeroPct,
        priceBulk,
        discPromo,
        discTradeIn,
        discCard,
        discCash,
      });
    } catch (e) {
      skipped++;
      errors.push(`แถว ${r + 1}: ${e}`);
    }
  }

  return { rows, sheetName, skipped, errors };
}
