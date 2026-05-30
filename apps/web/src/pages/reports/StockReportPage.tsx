import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

function buildReportPdf(date: string, byType: { in: any[]; out: any[]; adjust: any[] }, summary: any) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  let y = 15;

  // Title
  doc.setFontSize(14).setFont('helvetica', 'bold');
  doc.text('Stock Daily Report', W / 2, y, { align: 'center' });
  y += 7;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(`Date: ${date}   |   In: ${summary.tiresIn} pcs   |   Out: ${summary.tiresOut} pcs   |   Revenue: ${summary.totalRevenue.toLocaleString()} THB`, W / 2, y, { align: 'center' });
  y += 8;

  const sectionTable = (title: string, rows: any[], color: [number, number, number]) => {
    doc.setFontSize(11).setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(title, 14, y);
    doc.setTextColor(0, 0, 0);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Brand / Model', 'Size', 'Rim', 'Qty']],
      body: rows.map((m) => [
        `${m.brand} ${m.model}`,
        m.sizeNormalized,
        `${m.sizeRim}"`,
        m.qty > 0 ? `+${m.qty}` : `${m.qty}`,
      ]),
      headStyles: { fillColor: color, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
      theme: 'striped',
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  };

  if (byType.adjust.length > 0) sectionTable('Adjustments', byType.adjust, [180, 120, 0]);
  if (byType.in.length > 0) sectionTable('Stock In', byType.in, [22, 163, 74]);
  if (byType.out.length > 0) sectionTable('Stock Out', byType.out, [220, 38, 38]);

  return doc;
}

function buildLogsPdf(date: string, movements: any[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  let y = 15;

  doc.setFontSize(14).setFont('helvetica', 'bold');
  doc.text('Stock Movement Audit Log', W / 2, y, { align: 'center' });
  y += 7;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(`Date: ${date}   |   ${movements.length} records`, W / 2, y, { align: 'center' });
  y += 6;

  const TYPE_EN: Record<string, string> = { IN: 'IN', OUT: 'OUT', ADJUST: 'ADJUST', RETURN: 'RETURN' };
  autoTable(doc, {
    startY: y,
    head: [['Time', 'Type', 'Brand / Model', 'Size', 'Qty', 'Note']],
    body: movements.map((m) => [
      new Date(m.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      TYPE_EN[m.type] ?? m.type,
      `${m.brand} ${m.model}`,
      m.sizeNormalized,
      m.qty > 0 ? `+${m.qty}` : `${m.qty}`,
      m.note ?? '—',
    ]),
    headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 4: { halign: 'center', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
    theme: 'striped',
  });

  return doc;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  IN:     { label: '📥 รับเข้า',     cls: 'bg-green-100 text-green-700' },
  OUT:    { label: '📤 ขายออก',      cls: 'bg-red-100 text-red-600' },
  ADJUST: { label: '✏️ ปรับแต่ง',   cls: 'bg-yellow-100 text-yellow-700' },
  RETURN: { label: '↩️ คืนสินค้า',  cls: 'bg-blue-100 text-blue-700' },
};

export default function StockReportPage() {
  const { effectiveShopId } = useAuthStore();
  const shopId = effectiveShopId();
  const today = toDateStr(new Date());
  const [date, setDate] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-daily-report', shopId, date],
    queryFn: () => {
      const p = new URLSearchParams({ date });
      if (shopId) p.set('shopId', shopId);
      return api.get(`/stock/daily-report?${p}`).then((r) => r.data);
    },
    enabled: !!shopId,
  });

  const summary = data?.summary ?? { tiresOut: 0, tiresIn: 0, totalRevenue: 0, salesCount: 0 };
  const byType = data?.byType ?? { in: [], out: [], adjust: [] };
  const movements: any[] = data?.movements ?? [];

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">รายงานสต็อกประจำวัน</h2>
          <p className="text-sm text-gray-500 mt-0.5">ยางเข้า-ออกแต่ละรุ่นในวันที่เลือก</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => buildReportPdf(date, byType, summary).save(`stock-report-${date}.pdf`)}
            disabled={isLoading || movements.length === 0}
            className="border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            ⬇️ ดาวน์โหลดรายงาน
          </button>
          <button
            onClick={() => buildLogsPdf(date, movements).save(`stock-logs-${date}.pdf`)}
            disabled={isLoading || movements.length === 0}
            className="border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            ⬇️ ดาวน์โหลด Audit Log
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'ยางรับเข้า', value: summary.tiresIn,  unit: 'เส้น', icon: '📥', cls: 'text-green-600' },
          { label: 'ยางขายออก', value: summary.tiresOut, unit: 'เส้น', icon: '📤', cls: 'text-red-600' },
          { label: 'ยอดขาย',    value: summary.totalRevenue.toLocaleString(), unit: '฿', icon: '💰', cls: 'text-blue-600' },
          { label: 'จำนวนบิล',  value: summary.salesCount, unit: 'บิล', icon: '🧾', cls: 'text-gray-700' },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 mb-1">{c.icon} {c.label}</p>
            <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{c.unit}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      ) : movements.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-gray-400">
          ไม่มีความเคลื่อนไหวในวันนี้
        </div>
      ) : (
        <>
          <div className="bg-gray-50 rounded-xl p-4 mb-2">
          {/* Top row: ปรับแต่งสต็อก + ยางรับเข้า side by side */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* ปรับแต่งสต็อก */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 border-b bg-yellow-50 flex items-center justify-between">
                <span className="font-bold text-gray-800">✏️ ปรับแต่งสต็อก</span>
                <span className="font-bold text-lg text-yellow-600">{byType.adjust.length > 0 ? `${byType.adjust.length} รายการ` : '—'}</span>
              </div>
              {byType.adjust.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-gray-400">ไม่มีรายการ</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase border-b bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">รุ่น / ขนาด</th>
                      <th className="px-4 py-2 text-center">ขอบ</th>
                      <th className="px-4 py-2 text-center">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {byType.adjust.map((m: any) => (
                      <tr key={m.productId} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-800">{m.brand} {m.model}</p>
                          <p className="text-xs text-gray-400">{m.sizeNormalized}</p>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500">{m.sizeRim}"</td>
                        <td className={`px-4 py-2.5 text-center font-mono font-bold ${m.qty > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {m.qty > 0 ? '+' : ''}{m.qty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* ยางรับเข้า */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 border-b bg-green-50 flex items-center justify-between">
                <span className="font-bold text-gray-800">📥 ยางรับเข้า</span>
                <span className="font-bold text-lg text-green-600">{byType.in.length > 0 ? `${byType.in.reduce((s: number, m: any) => s + m.qty, 0)} เส้น` : '—'}</span>
              </div>
              {byType.in.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-gray-400">ไม่มีรายการ</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase border-b bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">รุ่น / ขนาด</th>
                      <th className="px-4 py-2 text-center">ขอบ</th>
                      <th className="px-4 py-2 text-center">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {byType.in.map((m: any) => (
                      <tr key={m.productId} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-800">{m.brand} {m.model}</p>
                          <p className="text-xs text-gray-400">{m.sizeNormalized}</p>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500">{m.sizeRim}"</td>
                        <td className="px-4 py-2.5 text-center font-mono font-bold text-green-600">+{m.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ยางขายออก — full width below */}
          <div className="bg-white rounded-xl border overflow-hidden mb-8">
            <div className="px-4 py-3 border-b bg-red-50 flex items-center justify-between">
              <span className="font-bold text-gray-800">📤 ยางขายออก</span>
              <span className="font-bold text-lg text-red-500">{byType.out.length > 0 ? `${byType.out.reduce((s: number, m: any) => s + m.qty, 0)} เส้น` : '—'}</span>
            </div>
            {byType.out.length === 0 ? (
              <p className="px-4 py-6 text-sm text-center text-gray-400">ไม่มีรายการ</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase border-b bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">รุ่น / ขนาด</th>
                    <th className="px-4 py-2 text-center">ขอบ</th>
                    <th className="px-4 py-2 text-center">จำนวน</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byType.out.map((m: any) => (
                    <tr key={m.productId} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800">{m.brand} {m.model}</p>
                        <p className="text-xs text-gray-400">{m.sizeNormalized}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-500">{m.sizeRim}"</td>
                      <td className="px-4 py-2.5 text-center font-mono font-bold text-red-500">-{m.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          </div>

          <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">บันทึกการเคลื่อนไหวทั้งหมด</h3>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">เวลา</th>
                  <th className="px-4 py-3 text-left">ประเภท</th>
                  <th className="px-4 py-3 text-left">สินค้า</th>
                  <th className="px-4 py-3 text-center">จำนวน</th>
                  <th className="px-4 py-3 text-left">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movements.map((m) => {
                  const t = TYPE_LABEL[m.type] ?? { label: m.type, cls: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-500 text-xs tabular-nums">
                        {new Date(m.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${t.cls}`}>{t.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{m.brand} {m.model}</p>
                        <p className="text-xs text-gray-400">{m.sizeNormalized}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono font-semibold">
                        <span className={m.qty > 0 ? 'text-green-600' : 'text-red-500'}>
                          {m.qty > 0 ? '+' : ''}{m.qty}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{m.note ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </>
      )}
    </div>
  );
}
