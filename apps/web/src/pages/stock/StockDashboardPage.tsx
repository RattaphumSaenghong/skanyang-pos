import { useState, useEffect } from 'react';
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

interface SnapshotEntry {
  id: string;
  snapshotId: string;
  productId: string;
  sku: string;
  sizeNormalized: string;
  qtyActual: number;
  qtySystem: number;
}

interface StockSnapshot {
  id: string;
  shopId: string;
  takenAt: string;
  takenBy: string;
  label: string | null;
  archived: boolean;
  entries: SnapshotEntry[];
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

  // Snapshot tab state
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [localQty, setLocalQty] = useState<Record<string, number>>({});

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

  // --- Snapshot tab ---
  const { data: snapshots = [], isLoading: snapshotsLoading } = useQuery<StockSnapshot[]>({
    queryKey: ['snapshots', effectiveShopId],
    queryFn: () =>
      api.get(`/stock/snapshots${effectiveShopId ? `?shopId=${effectiveShopId}` : ''}`).then((r) => r.data),
    enabled: activeTab === 'snapshot',
  });

  const takeSnapshotMutation = useMutation({
    mutationFn: () =>
      api.post('/stock/snapshots', { shopId: effectiveShopId || undefined, label: '' }).then((r) => r.data as StockSnapshot),
    onSuccess: (newSnapshot) => {
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      setSelectedSnapshotId(newSnapshot.id);
      const init: Record<string, number> = {};
      newSnapshot.entries.forEach((e) => { init[e.id] = e.qtyActual; });
      setLocalQty(init);
    },
  });

  const saveSnapshotMutation = useMutation({
    mutationFn: ({ id, entries }: { id: string; entries: { entryId: string; qtyActual: number }[] }) =>
      api.patch(`/stock/snapshots/${id}`, { entries }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snapshots'] });
    },
  });

  const selectedSnapshot = snapshots.find((s) => s.id === selectedSnapshotId) ?? null;

  // When snapshots load and none selected, auto-select the first (newest)
  useEffect(() => {
    if (snapshots.length > 0 && !selectedSnapshotId) {
      const first = snapshots[0];
      setSelectedSnapshotId(first.id);
      const init: Record<string, number> = {};
      first.entries.forEach((e) => { init[e.id] = e.qtyActual; });
      setLocalQty(init);
    }
  }, [snapshots, selectedSnapshotId]);

  // When selected snapshot changes, reinitialise local qty
  const handleSelectSnapshot = (id: string) => {
    setSelectedSnapshotId(id);
    const snap = snapshots.find((s) => s.id === id);
    if (snap) {
      const init: Record<string, number> = {};
      snap.entries.forEach((e) => { init[e.id] = e.qtyActual; });
      setLocalQty(init);
    }
  };

  const formatThaiDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
  };

  const handleSaveSnapshot = () => {
    if (!selectedSnapshotId) return;
    const entries = Object.entries(localQty).map(([entryId, qtyActual]) => ({ entryId, qtyActual }));
    saveSnapshotMutation.mutate({ id: selectedSnapshotId, entries });
  };

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
        <div>
          <div className="flex items-center justify-between mb-4">
            {snapshots.length > 0 ? (
              <select
                value={selectedSnapshotId ?? ''}
                onChange={(e) => handleSelectSnapshot(e.target.value)}
                className="text-sm border rounded-lg px-3 py-1.5 bg-white"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label ? s.label : 'Snapshot'} — {formatThaiDate(s.takenAt)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-gray-400">ยังไม่มีสแนปชอต</span>
            )}
            <button
              onClick={() => takeSnapshotMutation.mutate()}
              disabled={takeSnapshotMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {takeSnapshotMutation.isPending ? 'กำลังสร้าง...' : 'ถ่ายภาพสต็อก'}
            </button>
          </div>

          {snapshotsLoading ? (
            <p className="text-gray-400 text-sm">กำลังโหลด...</p>
          ) : selectedSnapshot ? (
            <>
              <div className="bg-white rounded-xl border overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left">SKU</th>
                      <th className="px-4 py-3 text-left">ขนาด</th>
                      <th className="px-4 py-3 text-center">นับจริง</th>
                      <th className="px-4 py-3 text-right">ระบบ</th>
                      <th className="px-4 py-3 text-right">ผลต่าง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedSnapshot.entries.map((entry) => {
                      const actual = localQty[entry.id] ?? entry.qtyActual;
                      const diff = actual - entry.qtySystem;
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">{entry.sku}</td>
                          <td className="px-4 py-3 text-gray-700">{entry.sizeNormalized}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min={0}
                              value={actual}
                              onChange={(e) =>
                                setLocalQty((prev) => ({
                                  ...prev,
                                  [entry.id]: Number(e.target.value),
                                }))
                              }
                              className="w-20 text-center border rounded px-2 py-1 text-sm font-mono"
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{entry.qtySystem}</td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-semibold ${
                              diff < 0 ? 'text-red-600' : diff > 0 ? 'text-green-600' : 'text-gray-400'
                            }`}
                          >
                            {diff > 0 ? `+${diff}` : diff}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveSnapshot}
                  disabled={saveSnapshotMutation.isPending}
                  className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {saveSnapshotMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-center text-gray-400 py-16">กดปุ่ม "ถ่ายภาพสต็อก" เพื่อสร้างสแนปชอตแรก</p>
          )}
        </div>
      )}
    </div>
  );
}
