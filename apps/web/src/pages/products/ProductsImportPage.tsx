import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

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

export default function ProductsImportPage() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: lists = [], isLoading } = useQuery<PriceList[]>({
    queryKey: ['price-lists'],
    queryFn: () => api.get('/price-lists').then((r) => r.data),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post('/price-lists/import', form).then((r) => r.data);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-lists'] }),
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
          <button
            onClick={() => deactivate.mutate(activeList.id)}
            disabled={deactivate.isPending}
            className="text-sm text-gray-500 border rounded-lg px-3 py-1.5 hover:bg-gray-100"
          >
            ยกเลิกการใช้งาน
          </button>
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

      {/* List */}
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
