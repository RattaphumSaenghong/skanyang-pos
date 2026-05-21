import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface PriceEntry {
  id: string;
  productId: string;
  priceCash: number;
  priceCard: number;
  priceZeroPct: number;
  priceBulk: number;
  costNormal: number;
  costPromo: number | null;
  marginCash: number | null;
  product: { sku: string; brand: string; model: string; sizeNormalized: string; isSetPricing: boolean };
}

export default function PosSearchPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isOwner = useAuthStore((s) => s.isOwner());
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ['price-entries', search],
    queryFn: () =>
      search.length >= 3
        ? api.get(`/products/search?q=${encodeURIComponent(search)}`).then((r) => r.data)
        : Promise.resolve([]),
    enabled: search.length >= 3,
  });

  const entries: PriceEntry[] = data ?? [];

  const createQuotation = useMutation({
    mutationFn: (items: { priceEntryId: string; qty: number }[]) =>
      api.post('/quotations', { items }).then((r) => r.data),
    onSuccess: (q) => navigate(`/pos/quotation/${q.id}`),
  });

  const handleAddToQuote = async () => {
    const items = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([priceEntryId, q]) => ({ priceEntryId, qty: q }));
    if (!items.length) return;
    setCreating(true);
    createQuotation.mutate(items);
  };

  const effectiveCost = (e: PriceEntry) => e.costPromo ?? e.costNormal;
  const margin = (e: PriceEntry) => {
    const cost = effectiveCost(e);
    return cost > 0 ? ((e.priceCash - cost) / cost) * 100 : 0;
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">ค้นหาสินค้า</h2>
      <div className="flex gap-3 mb-6">
        <input
          className="flex-1 border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="พิมพ์ขนาดยาง เช่น 205/55-16 หรือ ยี่ห้อ/รุ่น..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button
          onClick={handleAddToQuote}
          disabled={creating || !Object.values(qty).some((q) => q > 0)}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          สร้างใบเสนอราคา
        </button>
      </div>

      {isFetching && <p className="text-gray-400 text-sm">กำลังค้นหา...</p>}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">สินค้า</th>
                <th className="px-4 py-3 text-right">เงินสด</th>
                <th className="px-4 py-3 text-right">บัตร</th>
                <th className="px-4 py-3 text-right">0%</th>
                <th className="px-4 py-3 text-right">ราคาหน้าร้าน</th>
                {isOwner && <th className="px-4 py-3 text-right">กำไร%</th>}
                <th className="px-4 py-3 text-center">จำนวน</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => {
                const m = margin(e);
                const warning = m < 5;
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{e.product.brand} {e.product.model}</p>
                      <p className="text-gray-500 text-xs">{e.product.sizeNormalized}{e.product.isSetPricing ? ' (ชุด 4 เส้น)' : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{e.priceCash.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{e.priceCard.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{e.priceZeroPct.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-400">{e.priceBulk.toLocaleString()}</td>
                    {isOwner && (
                      <td className={`px-4 py-3 text-right font-mono text-xs ${warning ? 'text-red-500' : 'text-green-600'}`}>
                        {m.toFixed(1)}%
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          disabled={!qty[e.id] || qty[e.id] <= 4}
                          onClick={() =>
                            setQty((q) => {
                              const next = (q[e.id] ?? 0) - 4;
                              if (next <= 0) {
                                const { [e.id]: _, ...rest } = q;
                                return rest;
                              }
                              return { ...q, [e.id]: next };
                            })
                          }
                          className="w-7 h-7 border rounded text-sm font-medium hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm tabular-nums">
                          {qty[e.id] ?? 0}
                        </span>
                        <button
                          onClick={() =>
                            setQty((q) => ({ ...q, [e.id]: (q[e.id] ?? 0) + 4 }))
                          }
                          className="w-7 h-7 border rounded text-sm font-medium hover:bg-gray-100"
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
    </div>
  );
}
