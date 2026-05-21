import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

type PaymentRow = {
  label: string;
  unitPrice: number;
  discCard: number;
  discCash: number;
  discPromo: number;
  note: string;
};

function buildPaymentRows(item: any): PaymentRow[] {
  return [
    {
      label: '0%',
      unitPrice: item.unitPriceZeroPct,
      discCard: 0,
      discCash: 0,
      discPromo: 0,
      note: '0% 10เดือน',
    },
    {
      label: 'บัตร',
      unitPrice: item.unitPriceCard,
      discCard: item.discCard ?? 0,
      discCash: 0,
      discPromo: 0,
      note: 'รูดบัตรเต็มจำนวน',
    },
    {
      label: 'สด/โอน',
      unitPrice: item.unitPriceCash,
      discCard: 0,
      discCash: item.discCash ?? 0,
      discPromo: item.discPromo ?? 0,
      note: 'เงินสด/เงินโอน',
    },
  ];
}

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [plateNumber, setPlateNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [displayToast, setDisplayToast] = useState(false);

  const { data: quotation, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/quotations/${id}`).then((r) => r.data),
  });

  const updateItem = useMutation({
    mutationFn: (payload: { itemId: string; unitPriceCash: number; qty: number }) =>
      api.patch(`/quotations/${id}/items/${payload.itemId}`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotation', id] }),
  });

  const proceed = useMutation({
    mutationFn: () =>
      api.patch(`/quotations/${id}`, { plateNumber, notes, status: 'SENT' }).then((r) => r.data),
    onSuccess: () => navigate(`/pos/checkout/${id}`),
  });

  const pushDisplay = useMutation({
    mutationFn: () =>
      api
        .post(`/display/${user?.shopId}/active-quotation`, { quotationId: id })
        .then((r) => r.data),
    onSuccess: () => {
      setDisplayToast(true);
      setTimeout(() => setDisplayToast(false), 3000);
    },
  });

  if (isLoading) return <div className="p-6">กำลังโหลด...</div>;
  if (!quotation) return <div className="p-6 text-red-500">ไม่พบใบเสนอราคา</div>;

  const items = quotation.items ?? [];

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">ใบเสนอราคา #{id?.slice(-6).toUpperCase()}</h2>
        <div className="flex items-center gap-3">
          {displayToast && (
            <span className="text-sm text-green-700 bg-green-100 px-3 py-1 rounded-full font-medium">
              แสดงบนจอแล้ว ✓
            </span>
          )}
          {user?.shopId && (
            <button
              onClick={() => pushDisplay.mutate()}
              disabled={pushDisplay.isPending}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              แสดงบนจอลูกค้า
            </button>
          )}
          <button
            onClick={() => navigate('/pos/search')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← ค้นหาต่อ
          </button>
        </div>
      </div>

      {/* Plate + Notes */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">ทะเบียนรถ</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            placeholder="เช่น กข 1234 กรุงเทพ"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">หมายเหตุ</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Paper-format table */}
      <div className="bg-white rounded-xl border overflow-x-auto mb-6">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-gray-50 text-gray-600 uppercase">
            <tr>
              <th className="border px-2 py-2 text-center">No</th>
              <th className="border px-2 py-2 text-left">ยี่ห้อ/รุ่น/ขนาด</th>
              <th className="border px-2 py-2 text-right">ราคาปก</th>
              <th className="border px-2 py-2 text-right">ลดยางเก่า</th>
              <th className="border px-2 py-2 text-right">ลดบัตร/ลดสด</th>
              <th className="border px-2 py-2 text-right">ลดโปรฯ</th>
              <th className="border px-2 py-2 text-right">ราคา/เส้น</th>
              <th className="border px-2 py-2 text-center">จำนวน</th>
              <th className="border px-2 py-2 text-right">รวม(ชุด)</th>
              <th className="border px-2 py-2 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const rows = buildPaymentRows(item);
              return rows.map((row, rowIdx) => (
                <tr key={`${item.id}-${rowIdx}`} className="hover:bg-gray-50">
                  {/* No — rowspan 3 */}
                  {rowIdx === 0 && (
                    <td
                      rowSpan={3}
                      className="border px-2 py-2 text-center align-middle font-medium"
                    >
                      {idx + 1}
                    </td>
                  )}
                  {/* ยี่ห้อ/รุ่น/ขนาด — rowspan 3 */}
                  {rowIdx === 0 && (
                    <td rowSpan={3} className="border px-2 py-2 align-middle">
                      <p className="font-medium">
                        {item.product?.brand} {item.product?.model}
                      </p>
                      <p className="text-gray-500">{item.product?.sizeNormalized}</p>
                    </td>
                  )}
                  {/* ราคาปก — rowspan 3 */}
                  {rowIdx === 0 && (
                    <td
                      rowSpan={3}
                      className="border px-2 py-2 text-right align-middle font-mono"
                    >
                      {(item.priceListed ?? 0).toLocaleString()}
                    </td>
                  )}
                  {/* ลดยางเก่า — rowspan 3 */}
                  {rowIdx === 0 && (
                    <td
                      rowSpan={3}
                      className="border px-2 py-2 text-right align-middle font-mono"
                    >
                      {(item.discTradeIn ?? 0) > 0
                        ? (item.discTradeIn ?? 0).toLocaleString()
                        : '-'}
                    </td>
                  )}
                  {/* ลดบัตร/ลดสด — per sub-row */}
                  <td className="border px-2 py-1.5 text-right font-mono">
                    {(row.discCard + row.discCash) > 0
                      ? (row.discCard + row.discCash).toLocaleString()
                      : '-'}
                  </td>
                  {/* ลดโปรฯ — per sub-row */}
                  <td className="border px-2 py-1.5 text-right font-mono">
                    {row.discPromo > 0 ? row.discPromo.toLocaleString() : '-'}
                  </td>
                  {/* ราคา/เส้น — per sub-row */}
                  <td className="border px-2 py-1.5 text-right font-mono font-semibold">
                    {row.unitPrice.toLocaleString()}
                  </td>
                  {/* จำนวน — rowspan 3 with stepper */}
                  {rowIdx === 0 && (
                    <td rowSpan={3} className="border px-2 py-2 text-center align-middle">
                      <div className="inline-flex items-center gap-1 justify-center">
                        <button
                          disabled={item.qty <= 4}
                          onClick={() =>
                            updateItem.mutate({
                              itemId: item.id,
                              unitPriceCash: item.unitPriceCash,
                              qty: item.qty - 4,
                            })
                          }
                          className="w-6 h-6 border rounded text-xs font-medium hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          −
                        </button>
                        <span className="w-6 text-center tabular-nums">{item.qty}</span>
                        <button
                          onClick={() =>
                            updateItem.mutate({
                              itemId: item.id,
                              unitPriceCash: item.unitPriceCash,
                              qty: item.qty + 4,
                            })
                          }
                          className="w-6 h-6 border rounded text-xs font-medium hover:bg-gray-100"
                        >
                          +
                        </button>
                      </div>
                    </td>
                  )}
                  {/* รวม(ชุด) — per sub-row */}
                  <td className="border px-2 py-1.5 text-right font-mono font-semibold">
                    {(row.unitPrice * item.qty).toLocaleString()}
                  </td>
                  {/* หมายเหตุ — per sub-row */}
                  <td className="border px-2 py-1.5 text-gray-600">{row.note}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={() => proceed.mutate()}
          disabled={proceed.isPending}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          ดำเนินการชำระเงิน →
        </button>
      </div>
    </div>
  );
}
