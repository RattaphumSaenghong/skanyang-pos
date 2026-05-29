import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

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
  const byRim: any[] = data?.byRim ?? [];
  const movements: any[] = data?.movements ?? [];

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">รายงานสต็อกประจำวัน</h2>
          <p className="text-sm text-gray-500 mt-0.5">ยางเข้า-ออกแต่ละรุ่นในวันที่เลือก</p>
        </div>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'ยางขายออก', value: summary.tiresOut, unit: 'เส้น', icon: '📤', cls: 'text-red-600' },
          { label: 'ยางรับเข้า', value: summary.tiresIn,  unit: 'เส้น', icon: '📥', cls: 'text-green-600' },
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
      ) : byRim.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-gray-400">
          ไม่มีความเคลื่อนไหวในวันนี้
        </div>
      ) : (
        <>
          {/* By rim section */}
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">แยกตามขอบล้อ</h3>
          <div className="space-y-4 mb-8">
            {byRim.map((group) => (
              <div key={group.rim} className="bg-white rounded-xl border overflow-hidden">
                {/* Rim header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
                  <span className="font-bold text-gray-800">ขอบ {group.rim}"</span>
                  <div className="flex gap-4 text-sm">
                    {group.tiresOut > 0 && (
                      <span className="text-red-600 font-medium">📤 ออก {group.tiresOut} เส้น</span>
                    )}
                    {group.tiresIn > 0 && (
                      <span className="text-green-600 font-medium">📥 เข้า {group.tiresIn} เส้น</span>
                    )}
                  </div>
                </div>
                {/* Models table */}
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase border-b bg-white">
                    <tr>
                      <th className="px-4 py-2 text-left">รุ่น / ขนาด</th>
                      <th className="px-4 py-2 text-center text-red-500">ขายออก</th>
                      <th className="px-4 py-2 text-center text-green-600">รับเข้า</th>
                      <th className="px-4 py-2 text-center text-yellow-600">ปรับแต่ง</th>
                      <th className="px-4 py-2 text-center text-gray-600">สุทธิ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {group.models.map((m: any) => {
                      const net = m.in - m.out + m.adjust;
                      return (
                        <tr key={m.productId} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-gray-800">{m.brand} {m.model}</p>
                            <p className="text-xs text-gray-400">{m.sizeNormalized}</p>
                          </td>
                          <td className="px-4 py-2.5 text-center font-mono">
                            {m.out > 0 ? <span className="text-red-500 font-semibold">-{m.out}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-center font-mono">
                            {m.in > 0 ? <span className="text-green-600 font-semibold">+{m.in}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-center font-mono">
                            {m.adjust !== 0 ? <span className="text-yellow-600 font-semibold">{m.adjust > 0 ? '+' : ''}{m.adjust}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-center font-mono font-bold">
                            <span className={net > 0 ? 'text-green-600' : net < 0 ? 'text-red-500' : 'text-gray-400'}>
                              {net > 0 ? '+' : ''}{net}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Movements log */}
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
        </>
      )}
    </div>
  );
}
