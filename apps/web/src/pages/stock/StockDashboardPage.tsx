import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  product: { id: string; sku: string; sizeNormalized: string; brand: string; model: string };
}

type Tab = 'today' | 'snapshot';

export default function StockDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'OWNER';
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [shopFilter, setShopFilter] = useState<string>(user?.shopId ?? '');
  // Track optimistic qty deltas per productId
  const [pending, setPending] = useState<Record<string, number>>({});

  const { data: shops = [] } = useQuery<Shop[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
    enabled: isOwner,
  });

  const effectiveShopId = isOwner ? shopFilter : (user?.shopId ?? '');

  const { data, isLoading, error } = useQuery<StockItem[]>({
    queryKey: ['stock', effectiveShopId],
    queryFn: () =>
      api.get('/stock' + (effectiveShopId ? `?shopId=${effectiveShopId}` : '')).then((r) => r.data),
    enabled: activeTab === 'today',
  });

  const adjustMutation = useMutation({
    mutationFn: (body: { productId: string; shopId: string; qty: number; note: string }) =>
      api.post('/stock/adjust', body).then((r) => r.data),
    onMutate: ({ productId, qty }) => {
      setPending((prev) => ({ ...prev, [productId]: (prev[productId] ?? 0) + qty }));
    },
    onSettled: (_data, _err, { productId, qty }) => {
      setPending((prev) => {
        const next = { ...prev, [productId]: (prev[productId] ?? 0) - qty };
        if (next[productId] === 0) delete next[productId];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });

  const handleAdjust = (item: StockItem, qty: number) => {
    const shopId = isOwner ? (shopFilter || item.shopId) : (user?.shopId ?? item.shopId);
    adjustMutation.mutate({
      productId: item.product.id,
      shopId,
      qty,
      note: 'ปรับจากหน้าสต็อก',
    });
  };

  const items = data ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">คลังสินค้า</h2>
        {isOwner && activeTab === 'today' && shops.length > 0 && (
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

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b">
        {(['today', 'snapshot'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'today' ? 'Today Stock' : 'Table Sheet'}
          </button>
        ))}
      </div>

      {activeTab === 'today' && (
        <>
          {isLoading ? (
            <p className="text-gray-400 text-sm">กำลังโหลด...</p>
          ) : error ? (
            <p className="text-red-500 text-sm">โหลดข้อมูลไม่ได้ กรุณาลองใหม่</p>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-400 py-16">ยังไม่มีข้อมูลสต็อก</p>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-left">ขนาด</th>
                    <th className="px-4 py-3 text-right">คงเหลือ</th>
                    <th className="px-4 py-3 text-center">ปรับ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => {
                    const optimisticQty = item.qtyOnHand + (pending[item.product.id] ?? 0);
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {item.product.sku}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {item.product.sizeNormalized}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {optimisticQty}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleAdjust(item, -1)}
                              disabled={optimisticQty <= 0}
                              className="w-7 h-7 rounded-lg border text-gray-700 font-bold hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              −
                            </button>
                            <span className="w-8 text-center font-mono text-sm">{optimisticQty}</span>
                            <button
                              onClick={() => handleAdjust(item, 1)}
                              className="w-7 h-7 rounded-lg border text-gray-700 font-bold hover:bg-gray-100"
                            >
                              +
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'snapshot' && (
        <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
          กำลังพัฒนา — stock snapshots จะมาเร็วๆ นี้
        </div>
      )}
    </div>
  );
}
