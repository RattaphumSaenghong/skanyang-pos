import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface Shop {
  id: string;
  name: string;
}

interface StockItem {
  id: string;
  shopId: string;
  qtyOnHand: number;
  qtyReserved: number;
  alertThreshold: number;
  shop: { id: string; name: string };
  product: { id: string; brand: string; model: string; sizeNormalized: string };
}

interface AdjustModal {
  productId: string;
  shopId: string;
  label: string;
  currentQty: number;
}

export default function StockDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'OWNER';
  const qc = useQueryClient();

  const [shopFilter, setShopFilter] = useState<string>(user?.shopId ?? '');
  const [adjust, setAdjust] = useState<AdjustModal | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const { data: shops = [] } = useQuery<Shop[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
    enabled: isOwner,
  });

  const { data, isLoading, error } = useQuery<StockItem[]>({
    queryKey: ['stock', shopFilter],
    queryFn: () =>
      api.get('/stock' + (shopFilter ? `?shopId=${shopFilter}` : '')).then((r) => r.data),
  });

  const adjustMutation = useMutation({
    mutationFn: (body: { productId: string; shopId: string; qty: number; note: string }) =>
      api.post('/stock/adjust', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      setAdjust(null);
      setAdjustQty('');
      setAdjustNote('');
    },
  });

  const items = data ?? [];
  const alerts = items.filter((s) => s.qtyOnHand - s.qtyReserved <= s.alertThreshold);

  const handleAdjustSubmit = () => {
    if (!adjust) return;
    const qty = parseInt(adjustQty);
    if (isNaN(qty) || qty === 0) return;
    adjustMutation.mutate({ productId: adjust.productId, shopId: adjust.shopId, qty, note: adjustNote });
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">คลังสินค้า</h2>
        {isOwner && shops.length > 0 && (
          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="">ทุกสาขา</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
          <p className="font-semibold text-orange-700 mb-2">สินค้าใกล้หมด ({alerts.length} รายการ)</p>
          {alerts.map((s) => (
            <p key={s.id} className="text-sm text-orange-600">
              {s.product.brand} {s.product.model} {s.product.sizeNormalized} — คงเหลือ {s.qtyOnHand - s.qtyReserved} เส้น
            </p>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      ) : error ? (
        <p className="text-red-500 text-sm">โหลดข้อมูลไม่ได้ กรุณาลองใหม่</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📦</p>
          <p className="font-medium text-gray-500">ยังไม่มีข้อมูลสต็อก</p>
          <p className="text-sm mt-1">ปรับสต็อกครั้งแรกโดยกดปุ่ม + ที่ตารางสินค้าด้านล่าง</p>
          {isOwner && (
            <p className="text-xs mt-2 text-gray-400">เจ้าของสามารถค้นหาสินค้าและเพิ่มสต็อกได้จากหน้านี้</p>
          )}
          <InitStockSection shopFilter={shopFilter} shops={shops} isOwner={isOwner} onDone={() => qc.invalidateQueries({ queryKey: ['stock'] })} />
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-4 py-3 text-left">สินค้า</th>
                {isOwner && !shopFilter && <th className="px-4 py-3 text-left">สาขา</th>}
                <th className="px-4 py-3 text-right">คงเหลือ</th>
                <th className="px-4 py-3 text-right">จองแล้ว</th>
                <th className="px-4 py-3 text-right">พร้อมขาย</th>
                <th className="px-4 py-3 text-right">แจ้งเตือน</th>
                {isOwner && <th className="px-4 py-3 text-right">ปรับ</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((s) => {
                const available = s.qtyOnHand - s.qtyReserved;
                const low = available <= s.alertThreshold;
                return (
                  <tr key={s.id} className={low ? 'bg-orange-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{s.product.brand} {s.product.model}</p>
                      <p className="text-xs text-gray-500">{s.product.sizeNormalized}</p>
                    </td>
                    {isOwner && !shopFilter && (
                      <td className="px-4 py-3 text-xs text-gray-500">{s.shop.name}</td>
                    )}
                    <td className="px-4 py-3 text-right font-mono">{s.qtyOnHand}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-400">{s.qtyReserved}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${low ? 'text-red-600' : 'text-green-700'}`}>
                      {available}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{s.alertThreshold}</td>
                    {isOwner && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setAdjust({ productId: s.product.id, shopId: s.shopId, label: `${s.product.brand} ${s.product.model} ${s.product.sizeNormalized}`, currentQty: s.qtyOnHand })}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          ปรับ
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust modal */}
      {adjust && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-1">ปรับสต็อก</h3>
            <p className="text-sm text-gray-500 mb-4">{adjust.label}</p>
            <p className="text-xs text-gray-400 mb-3">สต็อกปัจจุบัน: <strong>{adjust.currentQty}</strong> เส้น</p>
            <label className="text-sm font-medium block mb-1">จำนวนที่ปรับ (+ เพิ่ม / - ลด)</label>
            <input
              type="number"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="เช่น +4 หรือ -2"
            />
            <label className="text-sm font-medium block mb-1">หมายเหตุ</label>
            <input
              type="text"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="เช่น รับของวันนี้"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdjustSubmit}
                disabled={adjustMutation.isPending || !adjustQty || adjustQty === '0'}
                className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {adjustMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button
                onClick={() => { setAdjust(null); setAdjustQty(''); setAdjustNote(''); }}
                className="flex-1 border py-2 rounded-xl text-sm hover:bg-gray-50"
              >
                ยกเลิก
              </button>
            </div>
            {adjustMutation.error && (
              <p className="text-red-500 text-xs mt-2">{(adjustMutation.error as any)?.response?.data?.message ?? 'เกิดข้อผิดพลาด'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Quick-add first stock entries when the table is empty
function InitStockSection({ shopFilter, shops, isOwner, onDone }: {
  shopFilter: string; shops: Shop[]; isOwner: boolean; onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedShop, setSelectedShop] = useState(shopFilter);
  const [qty, setQty] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const qc = useQueryClient();

  const { data: results = [] } = useQuery({
    queryKey: ['product-search-stock', search],
    queryFn: () => search.length >= 2 ? api.get(`/products/search?q=${encodeURIComponent(search)}`).then(r => r.data) : [],
    enabled: search.length >= 2,
  });

  const addMutation = useMutation({
    mutationFn: (body: any) => api.post('/stock/adjust', body).then(r => r.data),
    onSuccess: () => { setSearch(''); setQty(''); setSelectedEntry(null); onDone(); },
  });

  if (!isOwner) return null;

  return (
    <div className="mt-8 max-w-md mx-auto text-left">
      <p className="text-sm font-semibold text-gray-600 mb-3">เพิ่มสต็อกครั้งแรก</p>
      {shops.length > 0 && (
        <select value={selectedShop} onChange={e => setSelectedShop(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-2">
          <option value="">เลือกสาขา</option>
          {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setSelectedEntry(null); }}
        placeholder="ค้นหาสินค้า (เช่น Pri 5, 205/55)"
        className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
      />
      {results.length > 0 && !selectedEntry && (
        <div className="border rounded-lg mb-2 max-h-48 overflow-y-auto bg-white shadow text-left">
          {results.map((e: any) => (
            <button key={e.id} onClick={() => { setSelectedEntry(e); setSearch(`${e.product.brand} ${e.product.model} ${e.product.sizeNormalized}`); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-0">
              {e.product.brand} {e.product.model} <span className="text-gray-500">{e.product.sizeNormalized}</span>
            </button>
          ))}
        </div>
      )}
      {selectedEntry && (
        <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="จำนวน (เส้น)" className="w-full border rounded-lg px-3 py-2 text-sm mb-2" min="1" />
      )}
      <button
        disabled={!selectedEntry || !qty || !selectedShop || addMutation.isPending}
        onClick={() => addMutation.mutate({ productId: selectedEntry.product.id, shopId: selectedShop, qty: parseInt(qty), note: 'รับเข้าครั้งแรก' })}
        className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
      >
        {addMutation.isPending ? 'กำลังบันทึก...' : 'เพิ่มสต็อก'}
      </button>
    </div>
  );
}
