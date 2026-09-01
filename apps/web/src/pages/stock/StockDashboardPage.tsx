import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
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
  shop: { id: string; name: string };
  product: { id: string; sku: string; brand: string; model: string; sizeNormalized: string; dotYear: string | null; isSetPricing: boolean; isNonPromo: boolean };
}

interface SnapshotMovement {
  qty: number;
  type: string;
  note: string | null;
  createdAt: string;
}

interface SnapshotEntry {
  id: string;
  snapshotId: string;
  productId: string;
  sku: string;
  brand: string;
  model: string;
  sizeNormalized: string;
  dotYear: string | null;
  qtyActual: number;
  qtySystem: number;
  prevQtySystem: number | null;
  movements: SnapshotMovement[];
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
  const globalShopId = useAuthStore((s) => s.effectiveShopId());
  const isOwner = user?.role === 'OWNER';
  const canEdit = user?.role !== 'STAFF'; // STAFF can view stock but not adjust it
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [sortByEdited, setSortByEdited] = useState(false);
  const [shopFilter, setShopFilter] = useState<string>(globalShopId ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [displayDeltas, setDisplayDeltas] = useState<Record<string, number>>({});
  const accDeltas = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'add' | 'remove'>('add');
  const [editValue, setEditValue] = useState('');

  // Snapshot tab state
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [localQty, setLocalQty] = useState<Record<string, number>>({});

  const { data: shops = [] } = useQuery<Shop[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
    enabled: isOwner,
  });

  const effectiveShopId = isOwner ? shopFilter : (user?.shopId ?? '');
  useEffect(() => { setPage(1); }, [search, effectiveShopId]);

  const { data, isLoading, error } = useQuery<StockItem[]>({
    queryKey: ['stock', effectiveShopId],
    queryFn: () =>
      api.get('/stock' + (effectiveShopId ? `?shopId=${effectiveShopId}` : '')).then((r) => r.data),
    enabled: activeTab === 'today',
  });

  const handleAdjust = (item: StockItem, qty: number) => {
    const shopId = isOwner ? (shopFilter || item.shopId) : (user?.shopId ?? item.shopId);
    const key = `${shopId}_${item.product.id}`;

    // Floor: don't let display go below zero
    const currentDisplay = item.qtyOnHand + (accDeltas.current[key] ?? 0);
    const clamped = qty < 0 ? Math.max(qty, -currentDisplay) : qty;
    if (clamped === 0) return;

    accDeltas.current[key] = (accDeltas.current[key] ?? 0) + clamped;
    setDisplayDeltas({ ...accDeltas.current });

    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      const total = accDeltas.current[key];
      if (!total) return;
      accDeltas.current[key] = 0;
      try {
        await api.post('/stock/adjust', { productId: item.product.id, shopId, qty: total, note: 'ปรับจากหน้าสต็อก' });
      } finally {
        await qc.invalidateQueries({ queryKey: ['stock'] });
        setDisplayDeltas((prev) => { const n = { ...prev }; delete n[key]; return n; });
      }
    }, 600);
  };

  const items = data ?? [];
  const PAGE_SIZE = 30;
  const q = search.trim().toLowerCase();
  const filteredItems = q
    ? items.filter((item) =>
        `${item.product.brand} ${item.product.model} ${item.product.sizeNormalized}`.toLowerCase().includes(q)
      )
    : items;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
      api.patch(`/stock/snapshots/${id}`, { shopId: effectiveShopId || undefined, entries }).then((r) => r.data),
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
            <>
            <div className="mb-4">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา ยี่ห้อ / รุ่น / ขนาด..."
                className="w-full max-w-sm border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {q && (
                <span className="ml-3 text-xs text-gray-400">
                  พบ {filteredItems.length} รายการ
                </span>
              )}
            </div>
            <div className="bg-white rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">สินค้า</th>
                    <th className="px-4 py-3 text-left">ขนาด</th>
                    {!effectiveShopId && <th className="px-4 py-3 text-left">สาขา</th>}
                    <th className="px-4 py-3 text-right">คงเหลือ</th>
                    {canEdit && <th className="px-4 py-3 text-center">ปรับ</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedItems.map((item) => {
                    const optimisticQty = Math.max(0, item.qtyOnHand + (displayDeltas[`${item.shopId}_${item.product.id}`] ?? 0));
                    return (
                      <tr key={item.id} className={`hover:bg-gray-50 ${item.product.isSetPricing ? 'bg-pink-50' : ''}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{item.product.brand} {item.product.model}</p>
                          {item.product.dotYear && (
                            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-mono">DOT {item.product.dotYear}</span>
                          )}
                          {item.product.isSetPricing && (
                            <span className="ml-1 text-xs text-pink-700 bg-pink-100 border border-pink-200 rounded px-1.5 py-0.5 font-bold">ชุด 4</span>
                          )}
                          {item.product.isNonPromo && (
                            <span className="ml-1 text-xs text-red-700 bg-red-100 border border-red-200 rounded px-1.5 py-0.5 font-bold">Non Promo</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-gray-700">
                          {item.product.sizeNormalized}
                        </td>
                        {!effectiveShopId && (
                          <td className="px-4 py-3 text-sm text-gray-500">{item.shop.name}</td>
                        )}
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {optimisticQty}
                        </td>
                        {canEdit && (
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
                            {editingKey === `${item.shopId}_${item.product.id}` ? (
                              <input
                                type="number"
                                min={1}
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const val = parseInt(editValue, 10);
                                    if (!isNaN(val) && val !== 0) {
                                      handleAdjust(item, editMode === 'add' ? val : -val);
                                    }
                                    setEditingKey(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingKey(null);
                                  }
                                }}
                                onBlur={() => setEditingKey(null)}
                                placeholder="จำนวน"
                                className={`w-20 text-center border-2 rounded-lg px-2 py-0.5 text-sm font-mono focus:outline-none ${editMode === 'add' ? 'border-emerald-400' : 'border-red-400'}`}
                              />
                            ) : (
                              <>
                                <button
                                  onClick={() => { setEditMode('add'); setEditingKey(`${item.shopId}_${item.product.id}`); setEditValue(''); }}
                                  className="px-2 py-0.5 text-xs font-medium rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
                                >
                                  เพิ่ม
                                </button>
                                <button
                                  onClick={() => { setEditMode('remove'); setEditingKey(`${item.shopId}_${item.product.id}`); setEditValue(''); }}
                                  className="px-2 py-0.5 text-xs font-medium rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  ลบ
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gray-400">
                  หน้า {page} / {totalPages} ({filteredItems.length} รายการ)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-30"
                  >
                    ก่อนหน้า
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-30"
                  >
                    ถัดไป
                  </button>
                </div>
              </div>
            )}
            </>
          )}
        </>
      )}

      {activeTab === 'snapshot' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
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
                onClick={() => setSortByEdited((v) => !v)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  sortByEdited
                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                    : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {sortByEdited ? 'เรียงตามแก้ไข ✓' : 'เรียงตามแก้ไข'}
              </button>
            </div>
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
                      <th className="px-4 py-3 text-left">สินค้า</th>
                      <th className="px-4 py-3 text-left">ขนาด</th>
                      <th className="px-4 py-3 text-center">นับจริง</th>
                      <th className="px-4 py-3 text-right">ระบบ</th>
                      <th className="px-4 py-3 text-right">ผลต่าง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(sortByEdited
                      ? [...selectedSnapshot.entries].sort((a, b) => (b.movements?.length ?? 0) - (a.movements?.length ?? 0))
                      : selectedSnapshot.entries
                    ).map((entry) => {
                      const actual = localQty[entry.id] ?? entry.qtyActual;
                      const diff = actual - entry.qtySystem;
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">{entry.model}</p>
                            {entry.dotYear && (
                              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-mono">DOT {entry.dotYear}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-sm text-gray-700">{entry.sizeNormalized}</td>
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
                          <td className="px-4 py-3 text-right font-mono">
                            {entry.prevQtySystem != null && entry.movements.length > 0 ? (
                              <div className="flex items-center justify-end gap-1 flex-wrap text-xs">
                                <span className="text-gray-500">{entry.prevQtySystem}</span>
                                {entry.movements.map((m, mi) => (
                                  <span
                                    key={mi}
                                    title={m.note ?? m.type}
                                    className={`font-semibold ${m.qty > 0 ? 'text-emerald-600' : 'text-red-500'}`}
                                  >
                                    {m.qty > 0 ? `+${m.qty}` : m.qty}
                                  </span>
                                ))}
                                <span className="text-gray-400">=</span>
                                <span className="font-bold text-gray-800">{entry.qtySystem}</span>
                              </div>
                            ) : (
                              entry.qtySystem
                            )}
                          </td>
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
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-5 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg border hover:bg-gray-200"
                >
                  🖨️ พิมพ์
                </button>
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
