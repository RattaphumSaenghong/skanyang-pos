import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface PriceList {
  id: string;
  name: string;
  month: number;
  year: number;
  isActive: boolean;
  importedAt: string;
  importedBy: string;
  fileUrl: string | null;
  _count: { entries: number };
}

interface Shop {
  id: string;
  name: string;
}

interface DisplayImage {
  id: string;
  url: string;
  sortOrder: number;
}

interface ImportResult {
  priceListId: string;
  name: string;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  sheetName: string;
  errors: string[];
  hasStorage: boolean;
}

interface ActiveEntry {
  id: string;
  priceCash: number;
  priceCard: number;
  priceZeroPct: number;
  priceListed: number;
  costNormal: number;
  costPromo: number | null;
  marginCash: number | null;
  product: { id: string; sku: string; brand: string; model: string; sizeNormalized: string; isSetPricing: boolean; isNonPromo: boolean; dotYear: string | null };
}

export default function ProductsImportPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const effectiveShopId = useAuthStore((s) => s.effectiveShopId());
  const isOwner = user?.role === 'OWNER' || user?.role === 'SHOP_OWNER';
  const isSuperOwner = user?.role === 'OWNER';

  const inputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [bannerDragging, setBannerDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [bannerShopId, setBannerShopId] = useState<string>(user?.shopId ?? '');
  const [bannerUploading, setBannerUploading] = useState(false);
  const [entrySearch, setEntrySearch] = useState('');
  const [localEdits, setLocalEdits] = useState<Record<string, Record<string, string>>>({});

  const { data: lists = [], isLoading } = useQuery<PriceList[]>({
    queryKey: ['price-lists', effectiveShopId],
    queryFn: () => api.get(`/price-lists?shopId=${effectiveShopId}`).then((r) => r.data),
    enabled: !!effectiveShopId,
  });

  const { data: shops = [] } = useQuery<Shop[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
    enabled: isSuperOwner,
  });

  // Fall back to the first shop until one is picked. This used to be an
  // `onSuccess` on the query above, which React Query v5 removed — it never ran,
  // so the dropdown showed a shop (browsers display the first option when the
  // value matches none) while the id stayed empty and the panel below it stayed
  // disabled.
  const selectedBannerShopId = bannerShopId || shops[0]?.id || '';

  const effectiveBannerShopId = isOwner ? selectedBannerShopId : (user?.shopId ?? '');

  const { data: banners = [], refetch: refetchBanners } = useQuery<DisplayImage[]>({
    queryKey: ['banners', effectiveBannerShopId],
    queryFn: () =>
      effectiveBannerShopId
        ? api.get(`/display/${effectiveBannerShopId}/images`).then((r) => r.data)
        : Promise.resolve([]),
    enabled: !!effectiveBannerShopId,
  });

  const deleteBanner = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/display/${effectiveBannerShopId}/images/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banners', effectiveBannerShopId] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post(`/price-lists/import?shopId=${effectiveShopId}`, form).then((r) => r.data);
    },
    onSuccess: (data: ImportResult) => {
      setResult(data);
      setImportError(null);
      qc.invalidateQueries({ queryKey: ['price-lists'] });
    },
    onError: (e: any) => {
      setImportError(e?.response?.data?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      setResult(null);
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.patch(`/price-lists/${id}/activate`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-lists'] });
      qc.invalidateQueries({ queryKey: ['active-entries'] });
    },
  });

  const purgeOrphans = useMutation({
    mutationFn: () => api.post(`/price-lists/purge-orphans?shopId=${effectiveShopId}`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['active-entries', effectiveShopId] });
      qc.invalidateQueries({ queryKey: ['price-lists', effectiveShopId] });
      alert(`ลบแล้ว ${data.deactivated} รายการที่ไม่อยู่ในใบราคาปัจจุบัน`);
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/price-lists/${id}/deactivate`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-lists'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/price-lists/${id}`).then((r) => r.data),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['price-lists'] });
    },
    onError: (e: any) => {
      alert(e?.response?.data?.message ?? 'ลบไม่ได้');
      setConfirmDelete(null);
    },
  });

  const handleFile = (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      setImportError('กรุณาเลือกไฟล์ .xlsx หรือ .xls');
      return;
    }
    setResult(null);
    setImportError(null);
    importMutation.mutate(file);
  };

  const handleBannerFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!arr.length || !effectiveBannerShopId) return;
    setBannerUploading(true);
    const form = new FormData();
    arr.forEach((f) => form.append('files', f));
    await api.post(`/display/${effectiveBannerShopId}/images/batch`, form).catch(() => {});
    await refetchBanners();
    setBannerUploading(false);
  };

  const { data: activeEntriesData } = useQuery<{ priceList: { id: string; name: string }; entries: ActiveEntry[] }>({
    queryKey: ['active-entries', effectiveShopId],
    queryFn: () => api.get(`/price-lists/active/entries?shopId=${effectiveShopId}`).then((r) => r.data),
    enabled: isOwner && !!effectiveShopId,
  });

  const updateEntry = useMutation({
    mutationFn: ({ entryId, ...data }: { entryId: string; priceCash?: number; priceCard?: number; priceZeroPct?: number }) =>
      api.patch(`/price-lists/entries/${entryId}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-entries'] });
      qc.invalidateQueries({ queryKey: ['price-entries'] });
    },
  });

  const getEditVal = (entryId: string, field: string, original: number) =>
    localEdits[entryId]?.[field] ?? original.toString();

  const handleEntryChange = (entryId: string, field: string, value: string) => {
    setLocalEdits((prev) => ({ ...prev, [entryId]: { ...prev[entryId], [field]: value } }));
  };

  const handleEntryBlur = (entryId: string, field: 'priceCash' | 'priceCard' | 'priceZeroPct', original: number) => {
    const raw = localEdits[entryId]?.[field];
    if (raw === undefined) return;
    const val = parseFloat(raw);
    if (isNaN(val) || val === original) return;
    updateEntry.mutate({ entryId, [field]: val });
  };

  const filteredEntries = (activeEntriesData?.entries ?? []).filter((e) => {
    const q = entrySearch.toLowerCase();
    return !q || e.product.brand.toLowerCase().includes(q) || e.product.model.toLowerCase().includes(q) || e.product.sizeNormalized.toLowerCase().includes(q);
  });

  const activeList = lists.find((l) => l.isActive);

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-bold mb-2">จัดการรายการราคา</h2>
      <p className="text-sm text-gray-500 mb-6">นำเข้าไฟล์ราคา Excel และเลือกรายการที่ต้องการใช้งาน (ใช้งานได้ครั้งละ 1 รายการเท่านั้น)</p>

      {/* Active badge */}
      {activeList && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-green-600 font-semibold uppercase tracking-wide mb-1">ใช้งานอยู่</p>
            <p className="font-semibold text-green-800">{activeList.name}</p>
            <p className="text-xs text-green-600">{activeList._count.entries} รายการ · นำเข้าโดย {activeList.importedBy}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => purgeOrphans.mutate()}
              disabled={purgeOrphans.isPending}
              title="ลบสินค้าที่ไม่มีในใบราคานี้ออกจากระบบ (แก้ไขรายการซ้ำ)"
              className="text-sm text-orange-600 border border-orange-200 rounded-lg px-3 py-1.5 hover:bg-orange-50"
            >
              ล้างรายการซ้ำ
            </button>
            <button
              onClick={() => deactivate.mutate(activeList.id)}
              disabled={deactivate.isPending}
              className="text-sm text-gray-500 border rounded-lg px-3 py-1.5 hover:bg-gray-100"
            >
              ยกเลิกการใช้งาน
            </button>
          </div>
        </div>
      )}

      {/* Upload area */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors mb-4 ${
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
        }`}
      >
        <p className="text-3xl mb-2">📤</p>
        <p className="font-medium text-gray-700">ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</p>
        <p className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls · ข้อมูลเริ่มแถว 4</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
      </div>

      {/* Import status */}
      {importMutation.isPending && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-sm text-blue-700">
          กำลังอ่านและนำเข้าข้อมูล...
        </div>
      )}

      {importError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700 whitespace-pre-wrap">
          ❌ {importError}
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-sm">
          <p className="font-semibold text-green-800 mb-1">✅ นำเข้าสำเร็จ: <span className="font-mono">{result.name}</span></p>
          <div className="flex gap-4 text-green-700">
            <span>บันทึก: <strong>{result.rowsImported}</strong></span>
            <span>ข้าม: <strong>{result.rowsSkipped}</strong></span>
            {result.rowsFailed > 0 && <span className="text-orange-600">ล้มเหลว: <strong>{result.rowsFailed}</strong></span>}
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-orange-600 cursor-pointer">ดูข้อผิดพลาด ({result.errors.length})</summary>
              <pre className="text-xs mt-1 text-gray-600 whitespace-pre-wrap">{result.errors.join('\n')}</pre>
            </details>
          )}
          <p className="text-xs text-gray-500 mt-2">ต้องการให้รายการนี้มีผล กดปุ่ม "เปิดใช้งาน" ด้านล่าง</p>
        </div>
      )}

      {/* Banner upload */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold">แบนเนอร์จอลูกค้า</h3>
          {isSuperOwner && shops.length > 0 && (
            <select
              value={selectedBannerShopId}
              onChange={(e) => setBannerShopId(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white"
            >
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">อัปโหลดรูปภาพ PNG หลายรูปพร้อมกันได้ — จะแสดงสไลด์เลื่อนบนจอลูกค้า</p>

        <div
          onClick={() => bannerInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setBannerDragging(true); }}
          onDragLeave={() => setBannerDragging(false)}
          onDrop={(e) => { e.preventDefault(); setBannerDragging(false); if (e.dataTransfer.files.length) handleBannerFiles(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
            bannerDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          {bannerUploading ? (
            <p className="text-blue-600 text-sm font-medium">กำลังอัปโหลด...</p>
          ) : (
            <>
              <p className="text-2xl mb-1">🖼️</p>
              <p className="font-medium text-gray-700">ลากรูปมาวาง หรือคลิกเพื่อเลือก (เลือกหลายรูปได้)</p>
              <p className="text-xs text-gray-400 mt-1">PNG, JPG · สูงสุด 5 MB ต่อรูป</p>
            </>
          )}
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) handleBannerFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {banners.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {banners.map((img) => (
              <div key={img.id} className="relative group rounded-lg overflow-hidden border bg-gray-50 aspect-video">
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => deleteBanner.mutate(img.id)}
                  className="absolute top-1 right-1 bg-black/60 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ลบ
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inline price editor for active sheet */}
      {isOwner && activeEntriesData && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold">แก้ไขราคา — {activeEntriesData.priceList.name}</h3>
            <input
              className="border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ค้นหา ยี่ห้อ / รุ่น / ขนาด..."
              value={entrySearch}
              onChange={(e) => setEntrySearch(e.target.value)}
            />
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
                <tr>
                  <th className="px-3 py-2 text-left">สินค้า</th>
                  <th className="px-3 py-2 text-left">ขนาด</th>
                  <th className="px-3 py-2 text-right">เงินสด</th>
                  <th className="px-3 py-2 text-right">บัตร</th>
                  <th className="px-3 py-2 text-right">0%</th>
                  <th className="px-3 py-2 text-right">กำไร%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredEntries.map((e) => {
                  const cost = e.costPromo ?? e.costNormal;
                  const cashVal = parseFloat(getEditVal(e.id, 'priceCash', e.priceCash));
                  const liveMargin = cost > 0 ? ((cashVal - cost) / cost) * 100 : 0;
                  const warning = liveMargin < 5;
                  return (
                    <tr key={e.id} className={`hover:bg-gray-50 ${e.product.isSetPricing ? 'bg-pink-50' : ''}`}>
                      <td className="px-3 py-2">
                        <p className="font-medium">{e.product.brand} {e.product.model}</p>
                        {e.product.dotYear && <p className="text-xs text-gray-400">DOT {e.product.dotYear}</p>}
                        {e.product.isSetPricing && (
                          <span className="text-xs bg-pink-100 text-pink-700 border border-pink-200 font-bold px-1.5 rounded">ชุด 4 เส้น</span>
                        )}
                        {e.product.isNonPromo && (
                          <span className="text-xs bg-red-100 text-red-700 border border-red-200 font-bold px-1.5 rounded">Non Promo</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{e.product.sizeNormalized}</td>
                      {(['priceCash', 'priceCard', 'priceZeroPct'] as const).map((field) => (
                        <td key={field} className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="w-24 text-right border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={getEditVal(e.id, field, e[field])}
                            onChange={(ev) => handleEntryChange(e.id, field, ev.target.value)}
                            onBlur={() => handleEntryBlur(e.id, field, e[field])}
                          />
                        </td>
                      ))}
                      <td className={`px-3 py-2 text-right font-mono text-xs ${warning ? 'text-red-500' : 'text-green-600'}`}>
                        {liveMargin.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ใบราคา */}
      <h3 className="text-lg font-bold mt-10 mb-4">ใบราคา</h3>
      {isLoading ? (
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      ) : lists.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">ยังไม่มีรายการราคา — นำเข้าไฟล์ Excel เพื่อเริ่มต้น</p>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-4 py-3 text-left">ชื่อไฟล์</th>
                <th className="px-4 py-3 text-center">สินค้า</th>
                <th className="px-4 py-3 text-center">สถานะ</th>
                <th className="px-4 py-3 text-right">นำเข้าเมื่อ</th>
                <th className="px-4 py-3 text-right">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lists.map((pl) => (
                <tr key={pl.id} className={pl.isActive ? 'bg-green-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{pl.name}</p>
                    <p className="text-xs text-gray-400">โดย {pl.importedBy}</p>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-sm">
                    {pl._count.entries > 0 ? pl._count.entries : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {pl.isActive ? (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                        ● ใช้งานอยู่
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">ไม่ได้ใช้</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    {new Date(pl.importedAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {pl.fileUrl && (
                        <a href={pl.fileUrl} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-500 hover:underline">
                          ดาวน์โหลด
                        </a>
                      )}
                      {!pl.isActive && (
                        <button
                          onClick={() => activate.mutate(pl.id)}
                          disabled={activate.isPending}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          เปิดใช้งาน
                        </button>
                      )}
                      {!pl.isActive && (
                        confirmDelete === pl.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => deleteMutation.mutate(pl.id)}
                              disabled={deleteMutation.isPending}
                              className="text-xs bg-red-600 text-white px-2 py-1.5 rounded-lg hover:bg-red-700"
                            >
                              ยืนยันลบ
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs border px-2 py-1.5 rounded-lg hover:bg-gray-100"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(pl.id)}
                            className="text-xs text-red-500 hover:text-red-700 px-1"
                          >
                            ลบ
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
