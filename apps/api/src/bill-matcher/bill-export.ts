import * as XLSX from 'xlsx';

/**
 * The batch as a workbook for the accountant.
 *
 * Two sheets rather than one, because there are two questions being asked of
 * this file. "What did we invoice in June?" is answered by one row per bill;
 * "what was on bill 137?" needs one row per line. Splitting them means neither
 * has to be reconstructed by eye from a sheet laid out for the other.
 *
 * Bill columns repeat on every line row rather than being written once and left
 * blank underneath. Merged-looking gaps break sorting and filtering, which is
 * the whole reason for handing over a spreadsheet instead of a stack of paper.
 */

export interface ExportLine {
  kind: 'ITEM' | 'SERVICE' | 'FREEFORM';
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ExportBill {
  seq: number;
  billDate: Date | null;
  amount: number;
  locked: boolean;
  status: string;
  lines: ExportLine[];
}

export interface ExportBatch {
  label: string;
  periodMonth: number;
  periodYear: number;
  bills: ExportBill[];
}

const KIND_LABEL: Record<ExportLine['kind'], string> = {
  ITEM: 'สินค้า',
  SERVICE: 'ค่าบริการ',
  FREEFORM: 'ค่าบริการ (ไม่ระบุ)',
};

/**
 * Dates are written as zero-padded Buddhist-era text, matching the source sheet
 * the operator already knows. Within a single month that still sorts correctly,
 * and it avoids Excel quietly showing 2026 where the shop expects 2569.
 *
 * Pinned to Bangkok rather than read off the host clock. The parser builds each
 * date at local midnight and Postgres stores it as UTC, so 1 June comes back as
 * 31 May 17:00Z — which a server running in UTC would render as 31/05, putting
 * every date on the sheet a day early. The shop is in Thailand whatever the
 * server thinks.
 */
const SHOP_TIME_ZONE = 'Asia/Bangkok';

const THAI_DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatThaiDate(date: Date | null): string {
  if (!date) return '';
  const parts = THAI_DATE_PARTS.formatToParts(date);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${Number(part('year')) + 543}`;
}

const freeformOf = (bill: ExportBill): number =>
  bill.lines
    .filter((l) => l.kind === 'FREEFORM')
    .reduce((s, l) => s + l.lineTotal, 0);

function summarySheet(batch: ExportBatch): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['ลำดับ', 'วันที่', 'ยอดบิล', 'จำนวนรายการ', 'ค่าบริการไม่ระบุ', 'สถานะ'],
  ];

  for (const bill of batch.bills) {
    rows.push([
      bill.seq,
      formatThaiDate(bill.billDate),
      bill.amount,
      bill.lines.length,
      freeformOf(bill),
      bill.lines.length === 0
        ? 'ยังไม่จับคู่'
        : bill.locked
          ? 'ล็อก'
          : 'จับคู่แล้ว',
    ]);
  }

  // A total to reconcile against the source sheet's own figure.
  rows.push([]);
  rows.push([
    'รวม',
    '',
    batch.bills.reduce((s, b) => s + b.amount, 0),
    batch.bills.reduce((s, b) => s + b.lines.length, 0),
    batch.bills.reduce((s, b) => s + freeformOf(b), 0),
    `${batch.bills.length} บิล`,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
  ];
  return sheet;
}

function detailSheet(batch: ExportBatch): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [
      'ลำดับบิล',
      'วันที่',
      'ยอดบิล',
      'ประเภท',
      'รายการ',
      'จำนวน',
      'ราคา/หน่วย',
      'รวม',
    ],
  ];

  for (const bill of batch.bills) {
    const date = formatThaiDate(bill.billDate);
    if (bill.lines.length === 0) {
      // An unmatched bill still belongs in a file used for filing. Dropping it
      // would silently lose money from the total.
      rows.push([bill.seq, date, bill.amount, '', '(ยังไม่จับคู่)', '', '', '']);
      continue;
    }
    for (const line of bill.lines) {
      rows.push([
        bill.seq,
        date,
        bill.amount,
        KIND_LABEL[line.kind],
        line.description,
        line.qty,
        line.unitPrice,
        line.lineTotal,
      ]);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 44 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
  ];
  return sheet;
}

export function buildBatchWorkbook(batch: ExportBatch): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet(batch), 'สรุปบิล');
  XLSX.utils.book_append_sheet(wb, detailSheet(batch), 'รายการ');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** ASCII-safe stem; the Thai label rides in the RFC 5987 form of the header. */
export function exportFilename(batch: ExportBatch): string {
  return `bills-${batch.periodYear}-${String(batch.periodMonth).padStart(2, '0')}.xlsx`;
}
