import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

export interface ParsedPriceRow {
  sortOrder: number;
  rowIndex: number;
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
  marginCash: number | null;
  marginCard: number | null;
  marginZeroPct: number | null;
  marginBulk: number | null;
  imageUrl: string | null;
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
  ['XCD', 'Michelin'],
  ['AGI', 'Michelin'],
  ['PS', 'Michelin'],
  ['PILOT', 'Michelin'],
  ['PRIM', 'Michelin'],
  ['ENERG', 'Michelin'],
  ['CROSS', 'Michelin'],
  ['LTX', 'Michelin'],
  ['TOUR', 'Michelin'],
  ['TRAIL', 'Michelin'],
  ['BF', 'BFGoodrich'],
  ['KO', 'BFGoodrich'],
  ['TERRA', 'BFGoodrich'],
  ['DUELER', 'Bridgestone'],
  ['TURANZ', 'Bridgestone'],
];

export function inferBrand(model: string): string {
  const upper = model.toUpperCase();
  for (const [prefix, brand] of BRAND_BY_PREFIX) {
    if (upper.startsWith(prefix)) return brand;
  }
  return 'MICHELIN';
}

/** Normalize any tire size string to "205/55-16", "205/55-16*25", or "9.5R17.5" format */
export function normalizeSize(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\/\s*$/, '').trim(); // strip trailing slash
  const dotMatch = s.match(/\*(\d+)$/);
  const dotSuffix = dotMatch ? `*${dotMatch[1]}` : '';
  let base = s.replace(/\*\d+$/, '').trim();
  // Passenger R-notation (205/55R16 → 205/55-16, 385/65R22.5 → 385/65-22.5).
  // Scoped to the aspect-ratio slash so commercial sizes (9.5R17.5, 11R20)
  // keep their R for the commercial parser. Rim may be a decimal (e.g. 17.5).
  base = base.replace(/(\d{3})\s*\/\s*(\d{2})R(\d{2}(?:\.\d+)?)/, '$1/$2-$3');
  // Passenger: 205/55-16 or 385/65-22.5
  const m = base.match(/(\d{3})\s*[/]\s*(\d{2})\s*[-]\s*(\d{2}(?:\.\d+)?)/);
  if (m) return `${m[1]}/${m[2]}-${m[3]}${dotSuffix}`;
  // Commercial float format stays as-is: 9.5R17.5, 11R22.5
  return base + dotSuffix;
}

function parseSizeParts(normalized: string): { width: number; series: number; rim: number } | null {
  const base = normalized.replace(/\*\d+$/, '');
  // Passenger: 205/55-16 or 385/65-22.5
  const pm = base.match(/^(\d{3})\/(\d{2})-(\d{2}(?:\.\d+)?)$/);
  if (pm) return { width: parseInt(pm[1]), series: parseInt(pm[2]), rim: parseFloat(pm[3]) };
  // Commercial float: 9.5R17.5 or 11R22.5 — series=0 signals no aspect ratio
  const cm = base.match(/^(\d+\.?\d*)R(\d+\.?\d*)$/);
  if (cm) return { width: parseFloat(cm[1]), series: 0, rim: parseFloat(cm[2]) };
  return null;
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

  // Auto-detect data start: find first row where col D has a parseable tire size
  let dataStartRow = 3;
  for (let r = 0; r <= Math.min(15, range.e.r); r++) {
    const sizeCell = ws[XLSX.utils.encode_cell({ r, c: 3 })];
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

      const brandRaw = v(0); // A: brand name
      const modelRaw = v(1); // B: model name
      const sizeRaw  = v(3); // D: size string

      // Skip completely blank rows
      if (!brandRaw && !modelRaw && !sizeRaw) continue;
      if (!sizeRaw) { skipped++; continue; }

      const sizeStr = String(sizeRaw).trim();
      const sizeNormalized = normalizeSize(sizeStr);
      const parts = parseSizeParts(sizeNormalized);
      if (!parts) { skipped++; continue; }

      const model = modelRaw ? String(modelRaw).trim() : '';
      if (!model) { skipped++; continue; }

      const brand = brandRaw ? String(brandRaw).trim() : inferBrand(model);

      // DOT year: extracted from *NN suffix in the size string (preserved in sizeNormalized).
      const dotYear = (() => { const m = sizeStr.match(/\*(\d+)$/); return m ? m[1] : null; })();

      // Set pricing = pink fill (FF99FF) on col B (model column)
      const fillRgb = getFillRgb(ws, r, 1);
      const isSetPricing = fillRgb === PINK_RGB;

      // Prices & costs
      //   E(4)=ARP   F(5)=listed   G(6)=discPromo   H(7)=discTradeIn
      //   I(8)=discCard   J(9)=discCash
      //   K(10)=costNormal   M(12)=costPromo   AE(30)=oldCost
      //   O(14)=cashPrice   P(15)=cardPrice (may be empty → = cash)
      //   Q(16)=zeroPctPrice (may be empty → = cash)   R(17)=bulkPrice (may be empty → compute)
      const arp        = num(v(4));
      const priceListed = numZ(v(5));
      const discPromo  = numZ(v(6));
      const discTradeIn = numZ(v(7));
      const discCard   = numZ(v(8));
      const discCash   = numZ(v(9));
      const costNormal = numZ(v(10));

      // Promo cost: M column; if M empty use AE * 1.07
      const lVal = num(v(12));
      const adVal = num(v(30));
      const costPromo = (lVal && lVal > 0) ? lVal
        : (adVal && adVal > 0) ? adVal * 1.07 : null;

      const priceCash = numZ(v(14));  // O — always present
      if (priceCash === 0 && priceListed === 0) { skipped++; continue; }

      const priceCard    = num(v(15)) ?? priceCash;  // P → default to cash
      const priceZeroPct = num(v(16)) ?? priceCash;  // Q → default to cash

      // R bulk: use if present, else compute
      const qVal = num(v(17));
      let priceBulk: number;
      if (qVal && qVal > 0) {
        priceBulk = qVal;
      } else {
        const effectiveCost = (costPromo && costPromo > 0) ? costPromo : costNormal;
        const normalProfit = priceCash - effectiveCost;
        priceBulk = roundUp50(effectiveCost + normalProfit * 0.5 - 150);
        if (priceBulk <= effectiveCost) priceBulk = priceCash; // sanity floor
      }

      // Margins — read pre-computed profit-per-set from Excel (cols W/X/Y = 22/23/24)
      // and bulk gross margin ratio from col 32.
      // Formula: margin% = (profit_per_set / 4 / selling_price) * 100
      const profitCashSet  = num(v(22));
      const profitCardSet  = num(v(23));
      const profitZeroSet  = num(v(24));
      const marginBulkRaw  = num(v(32));

      const pct = (profit: number | null, price: number) =>
        profit !== null && price > 0
          ? parseFloat(((profit / 4 / price) * 100).toFixed(2))
          : null;

      const marginCash    = pct(profitCashSet, priceCash);
      const marginCard    = pct(profitCardSet, priceCard);
      const marginZeroPct = pct(profitZeroSet, priceZeroPct);
      const marginBulk    = marginBulkRaw !== null
        ? parseFloat((marginBulkRaw * 100).toFixed(2)) : null;

      // AH (col 33) — image URL (plain-text URLs only; embedded pictures are handled by extractRowImages)
      const imageUrlRaw = v(33);
      const imageUrlStr = imageUrlRaw ? String(imageUrlRaw).trim() : '';
      const imageUrl = imageUrlStr.startsWith('http') ? imageUrlStr : null;

      rows.push({
        sortOrder: rows.length,
        rowIndex: r,
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
        marginCash,
        marginCard,
        marginZeroPct,
        marginBulk,
        imageUrl,
      });
    } catch (e) {
      skipped++;
      errors.push(`แถว ${r + 1}: ${e}`);
    }
  }

  return { rows, sheetName, skipped, errors };
}

export async function extractRowImages(buffer: Buffer): Promise<Map<number, { data: Buffer; ext: string }>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const PRINT_KEYWORDS_LOWER = ['ปริ้น', 'print', 'ปริ้นท์'];
  const isPrint = (s: string) => PRINT_KEYWORDS_LOWER.some((k) => s.toLowerCase().includes(k));
  const sheet = workbook.worksheets.filter((ws) => !isPrint(ws.name)).slice(-1)[0]
    ?? workbook.worksheets[0];
  if (!sheet) return new Map();

  const imageMap = new Map<number, { data: Buffer; ext: string }>();
  for (const img of sheet.getImages()) {
    const row = img.range.tl.nativeRow;
    if (imageMap.has(row)) continue;
    const imageData = workbook.getImage(Number(img.imageId));
    if (imageData?.buffer) {
      imageMap.set(row, { data: imageData.buffer as unknown as Buffer, ext: String(imageData.extension ?? 'png') });
    }
  }
  return imageMap;
}
