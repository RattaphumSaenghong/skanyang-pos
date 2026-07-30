import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import BillMatchWorkspace from './BillMatchWorkspace';
import { Batch, BatchDetail, ServiceFee } from './types';

type Tab = 'import' | 'match' | 'fees';

export default function BillMatcherPage() {
  const qc = useQueryClient();
  const effectiveShopId = useAuthStore((s) => s.effectiveShopId());

  const [activeTab, setActiveTab] = useState<Tab>('import');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // Import tab state. Bills and stock normally arrive as two separate
  // workbooks; dropping only the bills file falls back to picking both sheets
  // out of it.
  const billInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [billSheets, setBillSheets] = useState<string[]>([]);
  const [itemSheets, setItemSheets] = useState<string[]>([]);
  const [importForm, setImportForm] = useState({
    label: '',
    periodMonth: new Date().getMonth() + 1,
    periodYear: new Date().getFullYear() + 543,
    billSheet: '',
    itemSheet: '',
  });
  const [importSuccess, setImportSuccess] = useState<any>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['bill-batches', effectiveShopId],
    queryFn: () =>
      api.get(`/bill-batches?shopId=${effectiveShopId}`).then((r) => r.data),
    enabled: !!effectiveShopId,
  });

  const { data: batchDetail } = useQuery<BatchDetail>({
    queryKey: ['bill-batch', selectedBatchId],
    queryFn: () =>
      api.get(`/bill-batches/${selectedBatchId}`).then((r) => r.data),
    enabled: !!selectedBatchId,
  });

  const { data: serviceFees = [] } = useQuery<ServiceFee[]>({
    queryKey: ['service-fees', effectiveShopId],
    queryFn: () =>
      api.get(`/service-fees?shopId=${effectiveShopId}`).then((r) => r.data),
    enabled: !!effectiveShopId && activeTab === 'fees',
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const readSheets = async (file: File): Promise<string[]> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post('/bill-batches/sheets', form);
    return data.sheetNames ?? [];
  };

  const importBatch = useMutation({
    mutationFn: () => {
      if (!billFile || !effectiveShopId) return Promise.reject();
      const form = new FormData();
      form.append('billFile', billFile);
      if (itemFile) form.append('itemFile', itemFile);
      form.append('label', importForm.label);
      form.append('periodMonth', String(importForm.periodMonth));
      form.append('periodYear', String(importForm.periodYear));
      if (importForm.billSheet) form.append('billSheet', importForm.billSheet);
      if (importForm.itemSheet) form.append('itemSheet', importForm.itemSheet);
      form.append('shopId', effectiveShopId);
      return api.post('/bill-batches/import', form).then((r) => r.data);
    },
    onSuccess: (data) => {
      setImportSuccess(data);
      qc.invalidateQueries({ queryKey: ['bill-batches'] });
      setBillFile(null);
      setItemFile(null);
      if (billInputRef.current) billInputRef.current.value = '';
      if (itemInputRef.current) itemInputRef.current.value = '';
      setImportForm({
        label: '',
        periodMonth: new Date().getMonth() + 1,
        periodYear: new Date().getFullYear() + 543,
        billSheet: '',
        itemSheet: '',
      });
      setBillSheets([]);
      setItemSheets([]);
      setTimeout(() => {
        setImportSuccess(null);
        setActiveTab('match');
      }, 2000);
    },
  });

  const deleteBatch = useMutation({
    mutationFn: (id: string) => api.delete(`/bill-batches/${id}`),
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ['bill-batches'] });
      if (selectedBatchId === deletedId) setSelectedBatchId(null);
    },
  });

  const saveServiceFee = useMutation({
    mutationFn: (fee: ServiceFee) => {
      return api.patch(`/service-fees/${fee.id}`, fee).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-fees'] });
    },
  });

  const deleteServiceFee = useMutation({
    mutationFn: (id: string) => api.delete(`/service-fees/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-fees'] });
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const handleBillFile = async (file: File) => {
    setBillFile(file);
    const names = await readSheets(file);
    setBillSheets(names);
    // One sheet needs no choosing. Two sheets in a single file is the old
    // one-workbook layout, so pre-fill the stock side from it too.
    setImportForm((f) => ({
      ...f,
      billSheet: names[0] ?? '',
      itemSheet: !itemFile && names.length > 1 ? (names[1] ?? '') : f.itemSheet,
    }));
    if (!itemFile) setItemSheets(names);
  };

  const handleItemFile = async (file: File) => {
    setItemFile(file);
    const names = await readSheets(file);
    setItemSheets(names);
    setImportForm((f) => ({ ...f, itemSheet: names[0] ?? '' }));
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'import', label: 'นำเข้า' },
    { key: 'match', label: 'จับคู่' },
    { key: 'fees', label: 'ค่าบริการ' },
  ];

  // The match tab is two panels side by side and needs the room.
  const width = activeTab === 'match' ? 'max-w-[1500px]' : 'max-w-6xl';

  return (
    <div className={`p-6 ${width}`}>
      <h2 className="text-xl font-bold mb-4">จับคู่บิล</h2>

      <div className="flex gap-1 mb-6 border-b">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Import Tab ── */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* Existing batches */}
          <div className="bg-white rounded-xl border p-5">
            <p className="font-medium mb-3">แบตช์ที่นำเข้า</p>
            {batches.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                ยังไม่มีแบตช์
              </p>
            ) : (
              <div className="grid gap-2">
                {batches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm">{batch.label}</p>
                      <p className="text-xs text-gray-500">
                        {batch.periodMonth}/{batch.periodYear} ·{' '}
                        {batch._count.bills} บิล
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedBatchId(batch.id);
                          setActiveTab('match');
                        }}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs"
                      >
                        ดู
                      </button>
                      <button
                        onClick={() => deleteBatch.mutate(batch.id)}
                        disabled={deleteBatch.isPending}
                        className="bg-red-100 text-red-600 px-3 py-1 rounded text-xs hover:bg-red-200"
                      >
                        ลบ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload form */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <p className="font-medium">นำเข้าแบตช์ใหม่</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  ไฟล์บิล <span className="text-red-500">*</span>
                </label>
                <input
                  ref={billInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) =>
                    e.target.files?.[0] && handleBillFile(e.target.files[0])
                  }
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                {billSheets.length > 1 && (
                  <select
                    value={importForm.billSheet}
                    onChange={(e) =>
                      setImportForm((f) => ({
                        ...f,
                        billSheet: e.target.value,
                      }))
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-2"
                  >
                    {billSheets.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  ไฟล์สินค้า/สต็อก
                </label>
                <input
                  ref={itemInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) =>
                    e.target.files?.[0] && handleItemFile(e.target.files[0])
                  }
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                {itemSheets.length > 1 && (
                  <select
                    value={importForm.itemSheet}
                    onChange={(e) =>
                      setImportForm((f) => ({
                        ...f,
                        itemSheet: e.target.value,
                      }))
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-2"
                  >
                    {itemSheets.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">
              อัปโหลดสองไฟล์แยกกันได้ · ถ้ามีไฟล์เดียวที่มีทั้งสองชีท
              ให้ใส่เฉพาะไฟล์บิลแล้วเลือกชีท · ระบบอ่านคอลัมน์จากหัวตาราง
              (วันที่ / จำนวน / ราคาขาย)
            </p>

            {billSheets.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    ชื่อแบตช์
                  </label>
                  <input
                    type="text"
                    placeholder="เช่น มิถุนายน 2569"
                    value={importForm.label}
                    onChange={(e) =>
                      setImportForm((f) => ({ ...f, label: e.target.value }))
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      เดือน (1-12)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={importForm.periodMonth}
                      onChange={(e) =>
                        setImportForm((f) => ({
                          ...f,
                          periodMonth: Number(e.target.value),
                        }))
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      ปี (พุทธศักราช)
                    </label>
                    <input
                      type="number"
                      value={importForm.periodYear}
                      onChange={(e) =>
                        setImportForm((f) => ({
                          ...f,
                          periodYear: Number(e.target.value),
                        }))
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <button
                  onClick={() => importBatch.mutate()}
                  disabled={
                    !importForm.label || !billFile || importBatch.isPending
                  }
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm w-full disabled:opacity-50"
                >
                  {importBatch.isPending ? 'กำลังนำเข้า...' : 'นำเข้า'}
                </button>
              </>
            )}

            {importBatch.isError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                <p className="font-medium mb-1">นำเข้าไม่สำเร็จ</p>
                <p className="text-xs">
                  {(importBatch.error as any)?.response?.data?.message ??
                    (importBatch.error as any)?.message ??
                    'เกิดข้อผิดพลาด'}
                </p>
              </div>
            )}

            {importSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                <p className="font-medium mb-1">นำเข้าสำเร็จ</p>
                <p>
                  บิล {importSuccess.billCount} เอกสาร · สต็อก{' '}
                  {importSuccess.itemCount} รายการ
                </p>
                {importSuccess.warnings?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {importSuccess.warnings
                      .slice(0, 3)
                      .map((w: string, i: number) => (
                        <p key={i} className="text-xs text-amber-700">
                          ⚠ {w}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Match Tab ── */}
      {activeTab === 'match' && (
        <div className="space-y-4">
          {!selectedBatchId ? (
            <p className="text-center text-gray-500 py-6">
              เลือกแบตช์เพื่อดูรายละเอียด
            </p>
          ) : batchDetail ? (
            <>
              {/* Stats */}
              {batchDetail.bills.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <div className="bg-white rounded-lg border p-3">
                    <p className="text-xs text-gray-500">บิลทั้งหมด</p>
                    <p className="text-lg font-bold">
                      {batchDetail.bills.length}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg border p-3">
                    <p className="text-xs text-gray-500">
                      จับคู่สินค้า / ขายรวม (ชิ้น)
                    </p>
                    <p className="text-lg font-bold">
                      {batchDetail.poolItems
                        .reduce((sum, item) => sum + item.matchedQty, 0)
                        .toLocaleString()}
                      {' / '}
                      {batchDetail.poolItems
                        .reduce((sum, item) => sum + item.soldQty, 0)
                        .toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg border p-3">
                    <p className="text-xs text-gray-500">ยอดบิล (฿)</p>
                    <p className="text-lg font-bold">
                      {batchDetail.bills
                        .reduce((sum, b) => sum + b.amount, 0)
                        .toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg border p-3">
                    <p className="text-xs text-gray-500">ส่วนต่าง (฿)</p>
                    <p className="text-lg font-bold text-red-600">
                      {batchDetail.bills
                        .reduce(
                          (sum, b) =>
                            sum +
                            (b.lines.find((l) => l.kind === 'FREEFORM')
                              ?.lineTotal ?? 0),
                          0,
                        )
                        .toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              <BillMatchWorkspace
                batchId={selectedBatchId}
                batch={batchDetail}
              />
            </>
          ) : (
            <p className="text-center text-gray-500 py-6">กำลังโหลด...</p>
          )}
        </div>
      )}

      {/* ── Service Fees Tab ── */}
      {activeTab === 'fees' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            ช่วงราคาต่ำสุด-สูงสุด ใช้สำหรับให้อัลกอริทึมจับคู่อยู่ในช่วงนั้น
          </p>

          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ชื่อ</th>
                  <th className="px-4 py-3 text-right">ต่ำสุด</th>
                  <th className="px-4 py-3 text-right">สูงสุด</th>
                  <th className="px-4 py-3 text-right">จำนวนสูงสุด</th>
                  <th className="px-4 py-3 text-left">กลุ่ม</th>
                  <th className="px-4 py-3 text-center">ใช้งาน</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {serviceFees.map((fee) => (
                  <tr key={fee.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{fee.name}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        value={fee.minPrice}
                        onChange={(e) =>
                          saveServiceFee.mutate({
                            ...fee,
                            minPrice: Number(e.target.value),
                          })
                        }
                        className="w-24 border rounded px-2 py-1 text-sm text-right"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        value={fee.maxPrice}
                        onChange={(e) =>
                          saveServiceFee.mutate({
                            ...fee,
                            maxPrice: Number(e.target.value),
                          })
                        }
                        className="w-24 border rounded px-2 py-1 text-sm text-right"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        value={fee.maxQty}
                        onChange={(e) =>
                          saveServiceFee.mutate({
                            ...fee,
                            maxQty: Number(e.target.value),
                          })
                        }
                        className="w-20 border rounded px-2 py-1 text-sm text-right"
                      />
                    </td>
                    <td className="px-4 py-3">{fee.group}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={fee.active}
                        onChange={(e) =>
                          saveServiceFee.mutate({
                            ...fee,
                            active: e.target.checked,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteServiceFee.mutate(fee.id)}
                        disabled={deleteServiceFee.isPending}
                        className="text-xs text-red-600 hover:underline"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
