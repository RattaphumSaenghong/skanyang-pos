import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

type Tab = 'bays' | 'services';

interface Bay {
  id: string;
  name: string;
  mode: 'GENERAL' | 'BOOKING_ONLY';
  active: boolean;
  sortOrder: number;
}

interface Service {
  id: string;
  name: string;
  estimatedMinutes: number;
  requiresBay: boolean;
  active: boolean;
  sortOrder: number;
}

export default function BaysSettingsPage() {
  const qc = useQueryClient();
  // A super-OWNER's token has shopId null and it picks a shop from the header
  // dropdown, so every call has to name the shop.
  const shopId = useAuthStore((s) => s.effectiveShopId());
  const scope = shopId ? { shopId } : undefined;
  const [activeTab, setActiveTab] = useState<Tab>('bays');
  const [error, setError] = useState('');

  // ── Bays tab ───────────────────────────────────────────────────────────────
  const [showBayForm, setShowBayForm] = useState(false);
  const [bayForm, setBayForm] = useState<{ name: string; mode: 'GENERAL' | 'BOOKING_ONLY'; sortOrder: number }>({
    name: '',
    mode: 'GENERAL',
    sortOrder: 0,
  });
  const [editingBayId, setEditingBayId] = useState<string | null>(null);
  const [editingBayName, setEditingBayName] = useState('');

  const { data: bays = [], isLoading: baysLoading } = useQuery<Bay[]>({
    queryKey: ['bays', shopId],
    queryFn: () => api.get('/bays', { params: scope }).then((r) => r.data),
  });

  const sortedBays = [...bays].sort((a, b) => a.sortOrder - b.sortOrder);

  const createBay = useMutation({
    mutationFn: () => api.post('/bays', { ...bayForm, ...scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bays'] });
      setShowBayForm(false);
      setBayForm({ name: '', mode: 'GENERAL', sortOrder: 0 });
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการเพิ่มช่อง');
    },
  });

  const updateBay = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Bay> }) =>
      api.patch(`/bays/${id}`, data, { params: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bays'] });
      setEditingBayId(null);
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตช่อง');
    },
  });

  const deactivateBay = useMutation({
    mutationFn: (id: string) => api.delete(`/bays/${id}`, { params: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bays'] });
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการปิดใช้งานช่อง');
    },
  });

  // ── Services tab ───────────────────────────────────────────────────────────
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState({
    name: '',
    estimatedMinutes: 30,
    requiresBay: true, // matches the schema default; most shop work occupies a bay
    sortOrder: 0,
  });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editingServiceName, setEditingServiceName] = useState('');
  const [editingServiceMinutes, setEditingServiceMinutes] = useState(30);

  const { data: services = [], isLoading: servicesLoading } = useQuery<Service[]>({
    queryKey: ['service-catalog', 'all', shopId],
    queryFn: () =>
      api
        .get('/service-catalog', { params: { includeInactive: true, ...scope } })
        .then((r) => r.data),
  });

  const sortedServices = [...services].sort((a, b) => a.sortOrder - b.sortOrder);

  const createService = useMutation({
    mutationFn: () => api.post('/service-catalog', { ...serviceForm, ...scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-catalog', 'all'] });
      setShowServiceForm(false);
      setServiceForm({ name: '', estimatedMinutes: 30, requiresBay: true, sortOrder: 0 });
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการเพิ่มบริการ');
    },
  });

  const updateService = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Service> }) =>
      api.patch(`/service-catalog/${id}`, data, { params: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-catalog', 'all'] });
      setEditingServiceId(null);
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตบริการ');
    },
  });

  const deactivateService = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/service-catalog/${id}`, { params: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-catalog', 'all'] });
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการปิดใช้งานบริการ');
    },
  });

  const TABS: { key: Tab; label: string }[] = [
    { key: 'bays', label: 'ช่องบริการ' },
    { key: 'services', label: 'บริการ' },
  ];

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-bold mb-4">ตั้งค่าช่องบริการ</h2>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Bays ── */}
      {activeTab === 'bays' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              ช่องแบบ "ทั่วไป" รับได้ทั้งคิวหน้าร้านและคิวจอง — ช่องแบบ "จองเท่านั้น" รับเฉพาะคิวที่จองไว้ล่วงหน้า
            </p>
            <button
              onClick={() => setShowBayForm(!showBayForm)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
            >
              + เพิ่มช่อง
            </button>
          </div>

          {showBayForm && (
            <div className="bg-white rounded-xl border p-4 mb-6 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">ชื่อช่อง</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={bayForm.name}
                  onChange={(e) => setBayForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น ช่อง 1, ช่อง 2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ประเภท</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={bayForm.mode}
                  onChange={(e) => setBayForm((f) => ({ ...f, mode: e.target.value as 'GENERAL' | 'BOOKING_ONLY' }))}
                >
                  <option value="GENERAL">ทั่วไป</option>
                  <option value="BOOKING_ONLY">จองเท่านั้น</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => createBay.mutate()}
                  disabled={createBay.isPending || !bayForm.name}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {createBay.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setShowBayForm(false)}
                  className="border px-4 py-2 rounded-lg text-sm text-gray-600"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border overflow-hidden">
            {baysLoading ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">กำลังโหลด...</p>
            ) : sortedBays.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">ยังไม่มีช่องบริการ</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">ชื่อ</th>
                    <th className="px-4 py-3 text-left">ประเภท</th>
                    <th className="px-4 py-3 text-center">สถานะ</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedBays.map((bay) => (
                    <tr key={bay.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {editingBayId === bay.id ? (
                          <input
                            autoFocus
                            type="text"
                            className="border rounded-lg px-2 py-1 text-sm w-40"
                            value={editingBayName}
                            onChange={(e) => setEditingBayName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateBay.mutate({ id: bay.id, data: { name: editingBayName } });
                              } else if (e.key === 'Escape') {
                                setEditingBayId(null);
                              }
                            }}
                          />
                        ) : (
                          <span className="font-medium">{bay.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="border rounded-lg px-2 py-1 text-sm"
                          value={bay.mode}
                          onChange={(e) =>
                            updateBay.mutate({ id: bay.id, data: { mode: e.target.value as 'GENERAL' | 'BOOKING_ONLY' } })
                          }
                        >
                          <option value="GENERAL">ทั่วไป</option>
                          <option value="BOOKING_ONLY">จองเท่านั้น</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs ${bay.active ? 'text-green-600' : 'text-gray-400'}`}>
                          {bay.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {editingBayId === bay.id ? (
                          <>
                            <button
                              onClick={() => updateBay.mutate({ id: bay.id, data: { name: editingBayName } })}
                              className="text-xs text-green-600 hover:underline"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => setEditingBayId(null)}
                              className="text-xs text-gray-500 hover:underline"
                            >
                              ยกเลิก
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingBayId(bay.id);
                                setEditingBayName(bay.name);
                              }}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              แก้ไข
                            </button>
                            {bay.active ? (
                              <button
                                onClick={() => deactivateBay.mutate(bay.id)}
                                className="text-xs text-red-500 hover:underline"
                              >
                                ปิดใช้งาน
                              </button>
                            ) : (
                              <button
                                onClick={() => updateBay.mutate({ id: bay.id, data: { active: true } })}
                                className="text-xs text-green-600 hover:underline"
                              >
                                เปิดใช้งาน
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Services ── */}
      {activeTab === 'services' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">เวลาที่ประเมินไว้ใช้คำนวณว่าช่องจะว่างเมื่อไหร่</p>
            <button
              onClick={() => setShowServiceForm(!showServiceForm)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
            >
              + เพิ่มบริการ
            </button>
          </div>

          {showServiceForm && (
            <div className="bg-white rounded-xl border p-4 mb-6 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">ชื่อบริการ</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น ล้างรถ, เปลี่ยนยาง"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">เวลาประเมิน (นาที)</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  min="1"
                  value={serviceForm.estimatedMinutes}
                  onChange={(e) => setServiceForm((f) => ({ ...f, estimatedMinutes: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="requiresBay-new"
                  className="rounded border-gray-300"
                  checked={serviceForm.requiresBay}
                  onChange={(e) => setServiceForm((f) => ({ ...f, requiresBay: e.target.checked }))}
                />
                <label htmlFor="requiresBay-new" className="text-sm font-medium">
                  ต้องใช้ช่อง
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => createService.mutate()}
                  disabled={createService.isPending || !serviceForm.name}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {createService.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setShowServiceForm(false)}
                  className="border px-4 py-2 rounded-lg text-sm text-gray-600"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border overflow-hidden">
            {servicesLoading ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">กำลังโหลด...</p>
            ) : sortedServices.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">ยังไม่มีบริการ</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">ชื่อบริการ</th>
                    <th className="px-4 py-3 text-center">เวลา (นาที)</th>
                    <th className="px-4 py-3 text-center">ต้องใช้ช่อง</th>
                    <th className="px-4 py-3 text-center">สถานะ</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedServices.map((service) => (
                    <tr key={service.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {editingServiceId === service.id ? (
                          <input
                            autoFocus
                            type="text"
                            className="border rounded-lg px-2 py-1 text-sm w-48"
                            value={editingServiceName}
                            onChange={(e) => setEditingServiceName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateService.mutate({
                                  id: service.id,
                                  data: { name: editingServiceName, estimatedMinutes: editingServiceMinutes },
                                });
                              } else if (e.key === 'Escape') {
                                setEditingServiceId(null);
                              }
                            }}
                          />
                        ) : (
                          <span className="font-medium">{service.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingServiceId === service.id ? (
                          <input
                            type="number"
                            className="border rounded-lg px-2 py-1 text-sm w-16 text-center"
                            min="1"
                            value={editingServiceMinutes}
                            onChange={(e) => setEditingServiceMinutes(parseInt(e.target.value) || 1)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateService.mutate({
                                  id: service.id,
                                  data: { name: editingServiceName, estimatedMinutes: editingServiceMinutes },
                                });
                              }
                            }}
                          />
                        ) : (
                          <span>{service.estimatedMinutes}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={service.requiresBay}
                          onChange={(e) =>
                            updateService.mutate({ id: service.id, data: { requiresBay: e.target.checked } })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs ${service.active ? 'text-green-600' : 'text-gray-400'}`}>
                          {service.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {editingServiceId === service.id ? (
                          <>
                            <button
                              onClick={() =>
                                updateService.mutate({
                                  id: service.id,
                                  data: { name: editingServiceName, estimatedMinutes: editingServiceMinutes },
                                })
                              }
                              className="text-xs text-green-600 hover:underline"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => setEditingServiceId(null)}
                              className="text-xs text-gray-500 hover:underline"
                            >
                              ยกเลิก
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingServiceId(service.id);
                                setEditingServiceName(service.name);
                                setEditingServiceMinutes(service.estimatedMinutes);
                              }}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              แก้ไข
                            </button>
                            {service.active ? (
                              <button
                                onClick={() => deactivateService.mutate(service.id)}
                                className="text-xs text-red-500 hover:underline"
                              >
                                ปิดใช้งาน
                              </button>
                            ) : (
                              <button
                                onClick={() => updateService.mutate({ id: service.id, data: { active: true } })}
                                className="text-xs text-green-600 hover:underline"
                              >
                                เปิดใช้งาน
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
