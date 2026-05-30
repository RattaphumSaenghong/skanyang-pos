import { useState, useEffect } from 'react';
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
  priceListed: number;
  marginCash: number | null;
  qtyOnHand: number;
  qtyAvailable: number;
  product: { sku: string; brand: string; model: string; sizeNormalized: string; isSetPricing: boolean; dotYear?: string | null };
}

export default function PosSearchPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = useAuthStore((s) => s.isOwner());
  const effectiveShopId = useAuthStore((s) => s.effectiveShopId());
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [displayOn, setDisplayOn] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['price-entries', effectiveShopId, search],
    queryFn: () =>
      search.length >= 3
        ? api.get(`/products/search?q=${encodeURIComponent(search)}&shopId=${effectiveShopId}`).then((r) => r.data)
        : Promise.resolve([]),
    enabled: search.length >= 3,
  });

  const entries: PriceEntry[] = data ?? [];

  const shopId = effectiveShopId;
  const userId = user?.id;
  const srUrl = shopId
    ? userId
      ? `/display/${shopId}/${userId}/search-results`
      : `/display/${shopId}/search-results`
    : null;

  useEffect(() => {
    if (!srUrl) return;
    if (!displayOn || ticked.size === 0) {
      api.post(srUrl, { results: null }).catch(() => {});
      return;
    }
    const stripped = entries
      .filter((e) => ticked.has(e.id))
      .map((e) => ({
        id: e.id,
        product: e.product,
        priceCash: e.priceCash,
        priceCard: e.priceCard,
        priceZeroPct: e.priceZeroPct,
      }));
    api.post(srUrl, { results: stripped.length ? stripped : null }).catch(() => {});
  }, [entries, displayOn, ticked, srUrl]);

  // Cleanup stale drafts on mount
  useEffect(() => {
    api.post('/quotations/cleanup-stale').catch(() => {});
  }, []);

  // Clear display when leaving this page
  useEffect(() => {
    return () => {
      if (srUrl) api.post(srUrl, { results: null }).catch(() => {});
    };
  }, [srUrl]);

  const createQuotation = useMutation({
    mutationFn: (items: { priceEntryId: string; qty: number }[]) =>
      api.post('/quotations', { items, shopId: effectiveShopId }).then((r) => r.data),
    onSuccess: (q) => navigate(`/pos/quotation/${q.id}`),
    onError: (e: any) => setCreateError(e?.response?.data?.message ?? 'เกิดข้อผิดพลาด'),
  });

  const handleAddToQuote = () => {
    const items = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([priceEntryId, q]) => ({ priceEntryId, qty: q }));
    if (!items.length) return;
    setCreateError(null);
    createQuotation.mutate(items);
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
        {shopId && (
          <button
            onClick={() => setDisplayOn((v) => !v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              displayOn
                ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            🖥️ {displayOn ? 'แสดงบนจอ ON' : 'แสดงบนจอ OFF'}
          </button>
        )}
        <button
          onClick={handleAddToQuote}
          disabled={createQuotation.isPending || !Object.values(qty).some((q) => q > 0)}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {createQuotation.isPending ? 'กำลังสร้าง...' : 'สร้างใบเสนอราคา'}
        </button>
      </div>

      {createError && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{createError}</p>
      )}

      {isFetching && <p className="text-gray-400 text-sm">กำลังค้นหา...</p>}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-center">🖥️</th>
                <th className="px-4 py-3 text-left">สินค้า</th>
                <th className="px-4 py-3 text-right">เงินสด</th>
                <th className="px-4 py-3 text-right">บัตร</th>
                <th className="px-4 py-3 text-right">0%</th>
                <th className="px-4 py-3 text-right">ขายส่ง</th>
                <th className="px-4 py-3 text-right">ราคาหน้าร้าน</th>
                {isOwner && <th className="px-4 py-3 text-right">กำไร%</th>}
                <th className="px-4 py-3 text-right">สต็อก</th>
                <th className="px-4 py-3 text-center">จำนวน</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => {
                const m = e.marginCash ?? 0;
                const warning = m < 5;
                return (
                  <tr key={e.id} className={`hover:bg-gray-50 ${ticked.has(e.id) ? 'bg-indigo-50' : ''}`}>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setTicked((prev) => {
                          const next = new Set(prev);
                          next.has(e.id) ? next.delete(e.id) : next.add(e.id);
                          return next;
                        })}
                        className={`w-6 h-6 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                          ticked.has(e.id)
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-gray-300 hover:border-indigo-400'
                        }`}
                      >
                        {ticked.has(e.id) && '✓'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{e.product.brand} {e.product.model}</p>
                      <p className="text-gray-500 text-xs">{e.product.sizeNormalized}{e.product.isSetPricing ? ' (ชุด 4 เส้น)' : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{e.priceCash.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{e.priceCard.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{e.priceZeroPct.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-purple-600">{e.priceBulk > 0 ? e.priceBulk.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-400">{e.priceListed.toLocaleString()}</td>
                    {isOwner && (
                      <td className={`px-4 py-3 text-right font-mono text-xs ${warning ? 'text-red-500' : 'text-green-600'}`}>
                        {m.toFixed(1)}%
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${
                        e.qtyAvailable === 0
                          ? 'bg-red-100 text-red-600'
                          : e.qtyAvailable <= 4
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {e.qtyAvailable}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          disabled={!qty[e.id] || qty[e.id] <= 0}
                          onClick={() =>
                            setQty((q) => {
                              const next = (q[e.id] ?? 0) - 1;
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
                        <span className="w-12 text-center text-sm tabular-nums">
                          {qty[e.id] ?? 0}{e.product.isSetPricing ? ' ชุด' : ''}
                        </span>
                        <button
                          onClick={() => setQty((q) => ({ ...q, [e.id]: (q[e.id] ?? 0) + 1 }))}
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
