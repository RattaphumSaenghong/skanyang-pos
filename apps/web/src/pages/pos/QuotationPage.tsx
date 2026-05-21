import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isOwner = useAuthStore((s) => s.isOwner());
  const [plateNumber, setPlateNumber] = useState('');
  const [notes, setNotes] = useState('');

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

  if (isLoading) return <div className="p-6">กำลังโหลด...</div>;
  if (!quotation) return <div className="p-6 text-red-500">ไม่พบใบเสนอราคา</div>;

  const items = quotation.items ?? [];
  const totalCash = items.reduce((s: number, item: any) => s + item.unitPriceCash * item.qty, 0);
  const totalCard = items.reduce((s: number, item: any) => s + item.unitPriceCard * item.qty, 0);
  const totalZero = items.reduce((s: number, item: any) => s + item.unitPriceZeroPct * item.qty, 0);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">ใบเสนอราคา #{id?.slice(-6).toUpperCase()}</h2>
        <button onClick={() => navigate('/pos/search')} className="text-sm text-gray-500 hover:text-gray-700">
          ← ค้นหาต่อ
        </button>
      </div>

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

      <div className="bg-white rounded-xl border overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">สินค้า</th>
              <th className="px-4 py-3 text-right">จำนวน</th>
              <th className="px-4 py-3 text-right">เงินสด/เส้น</th>
              <th className="px-4 py-3 text-right">บัตร/เส้น</th>
              <th className="px-4 py-3 text-right">0%/เส้น</th>
              <th className="px-4 py-3 text-right">รวม(สด)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item: any) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{item.product?.brand} {item.product?.model}</p>
                  <p className="text-xs text-gray-500">{item.product?.sizeNormalized}</p>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1 justify-end">
                    <button
                      disabled={item.qty <= 4}
                      onClick={() =>
                        updateItem.mutate({ itemId: item.id, unitPriceCash: item.unitPriceCash, qty: item.qty - 4 })
                      }
                      className="w-7 h-7 border rounded text-sm font-medium hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm tabular-nums">{item.qty}</span>
                    <button
                      onClick={() =>
                        updateItem.mutate({ itemId: item.id, unitPriceCash: item.unitPriceCash, qty: item.qty + 4 })
                      }
                      className="w-7 h-7 border rounded text-sm font-medium hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono">{item.unitPriceCash.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono">{item.unitPriceCard.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono">{item.unitPriceZeroPct.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">
                  {(item.unitPriceCash * item.qty).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold">
            <tr>
              <td colSpan={5} className="px-4 py-3 text-right">รวมสุทธิ</td>
              <td className="px-4 py-3 text-right font-mono text-blue-700 text-base">{totalCash.toLocaleString()} ฿</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-3 justify-end">
        <button
          onClick={() => proceed.mutate()}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          ดำเนินการชำระเงิน →
        </button>
      </div>
    </div>
  );
}
