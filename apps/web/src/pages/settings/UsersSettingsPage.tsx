import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

type Tab = 'users' | 'passwords' | 'ip' | 'shop';

export default function UsersSettingsPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('users');

  // ── Users tab ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'STAFF', shopId: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const { data: shops = [] } = useQuery<any[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/users', { ...form, shopId: form.shopId || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm({ username: '', displayName: '', password: '', role: 'STAFF', shopId: '' });
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  // ── Passwords tab ──────────────────────────────────────────────────────────
  const [pwUserId, setPwUserId] = useState('');
  const [pwValue, setPwValue] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  const changePassword = useMutation({
    mutationFn: () => api.patch(`/users/${pwUserId}/password`, { password: pwValue }),
    onSuccess: () => { setPwSuccess(true); setPwValue(''); setTimeout(() => setPwSuccess(false), 3000); },
  });

  // ── IP Whitelist tab ───────────────────────────────────────────────────────
  const [ipShopId, setIpShopId] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [ipLabel, setIpLabel] = useState('');

  const { data: ipList = [] } = useQuery<any[]>({
    queryKey: ['ip-whitelist', ipShopId],
    queryFn: () => api.get(`/shops/${ipShopId}/ip-whitelist`).then((r) => r.data),
    enabled: !!ipShopId,
  });

  const addIp = useMutation({
    mutationFn: () => api.post(`/shops/${ipShopId}/ip-whitelist`, { ipAddress, label: ipLabel }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ip-whitelist', ipShopId] }); setIpAddress(''); setIpLabel(''); },
  });

  const removeIp = useMutation({
    mutationFn: (id: string) => api.delete(`/shops/ip-whitelist/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ip-whitelist', ipShopId] }),
  });

  // ── Shop / Quotation tab ───────────────────────────────────────────────────
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [shopForm, setShopForm] = useState<{ name: string; phone: string; address: string; email: string; promoTextMichelin: string; promoTextBfGoodrich: string } | null>(null);
  const [promoShopId, setPromoShopId] = useState('');
  const [promoTextMichelin, setPromoTextMichelin] = useState('');
  const [promoTextBfGoodrich, setPromoTextBfGoodrich] = useState('');
  const [promoSuccess, setPromoSuccess] = useState(false);

  const editShop = (s: any) => {
    setEditingShopId(s.id);
    setShopForm({ name: s.name ?? '', phone: s.phone ?? '', address: s.address ?? '', email: s.email ?? '', promoTextMichelin: s.promoTextMichelin ?? '', promoTextBfGoodrich: s.promoTextBfGoodrich ?? '' });
  };

  const saveShop = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/shops/${id}`, data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shops'] }); setShopForm(null); setEditingShopId(null); },
  });

  const savePromo = useMutation({
    mutationFn: () => api.patch(`/shops/${promoShopId}`, { promoTextMichelin, promoTextBfGoodrich }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shops'] }); setPromoSuccess(true); setTimeout(() => setPromoSuccess(false), 3000); },
  });

  // sync promo textareas when shop is selected
  const handlePromoShopChange = (id: string) => {
    setPromoShopId(id);
    const s = shops.find((s: any) => s.id === id);
    setPromoTextMichelin(s?.promoTextMichelin ?? '');
    setPromoTextBfGoodrich(s?.promoTextBfGoodrich ?? '');
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'users', label: 'ผู้ใช้งาน' },
    { key: 'passwords', label: 'รหัสผ่าน' },
    { key: 'ip', label: 'IP ไวท์ลิสต์' },
    { key: 'shop', label: 'ข้อมูลร้าน' },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-4">ตั้งค่า</h2>

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

      {/* ── Users ── */}
      {activeTab === 'users' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">จัดการผู้ใช้งานระบบ</p>
            <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              + เพิ่มผู้ใช้
            </button>
          </div>

          {showForm && (
            <div className="bg-white rounded-xl border p-4 mb-6 space-y-3">
              {(['username', 'displayName', 'password'] as const).map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1">
                    {field === 'username' ? 'ชื่อผู้ใช้' : field === 'displayName' ? 'ชื่อแสดง' : 'รหัสผ่าน'}
                  </label>
                  <input
                    type={field === 'password' ? 'password' : 'text'}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form[field]}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium mb-1">บทบาท</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                  <option value="STAFF">STAFF</option>
                  <option value="OWNER">OWNER</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ร้าน <span className="text-gray-400 font-normal">(ไม่บังคับ)</span></label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.shopId} onChange={(e) => setForm((f) => ({ ...f, shopId: e.target.value }))}>
                  <option value="">-- ไม่ระบุ --</option>
                  {shops.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => create.mutate()} disabled={create.isPending} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm w-full">
                บันทึก
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ชื่อ</th>
                  <th className="px-4 py-3 text-left">สาขา</th>
                  <th className="px-4 py-3 text-center">บทบาท</th>
                  <th className="px-4 py-3 text-center">สถานะ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{u.displayName}</p>
                      <p className="text-xs text-gray-500">@{u.username}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {u.shopId ? (shops.find((s: any) => s.id === u.shopId)?.name ?? u.shopId) : <span className="text-gray-400">ทุกสาขา</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${u.role === 'OWNER' ? 'bg-purple-100 text-purple-700' : u.role === 'SHOP_OWNER' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs ${u.active ? 'text-green-600' : 'text-gray-400'}`}>
                        {u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.active && (
                        <button onClick={() => deactivate.mutate(u.id)} className="text-xs text-red-500 hover:underline">
                          ปิดใช้งาน
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Passwords ── */}
      {activeTab === 'passwords' && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <p className="text-sm text-gray-500">เปลี่ยนรหัสผ่านของผู้ใช้งาน</p>
          <div>
            <label className="block text-sm font-medium mb-1">เลือกผู้ใช้</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={pwUserId}
              onChange={(e) => setPwUserId(e.target.value)}
            >
              <option value="">-- เลือกผู้ใช้ --</option>
              {users.filter((u: any) => u.active).map((u: any) => (
                <option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">รหัสผ่านใหม่</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              placeholder="อย่างน้อย 6 ตัวอักษร"
            />
          </div>
          {pwSuccess && <p className="text-sm text-green-600 font-medium">เปลี่ยนรหัสผ่านแล้ว ✓</p>}
          <button
            onClick={() => changePassword.mutate()}
            disabled={!pwUserId || !pwValue || changePassword.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {changePassword.isPending ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </div>
      )}

      {/* ── IP Whitelist ── */}
      {activeTab === 'ip' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">ถ้าเพิ่ม IP อย่างน้อย 1 รายการ — เฉพาะ IP นั้นเท่านั้นที่เข้าใช้งานได้ ถ้าไม่มี IP ใด — ทุกคนเข้าได้</p>
          <div>
            <label className="block text-sm font-medium mb-1">เลือกร้าน</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={ipShopId}
              onChange={(e) => setIpShopId(e.target.value)}
            >
              <option value="">-- เลือกร้าน --</option>
              {shops.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {ipShopId && (
            <>
              <div className="bg-white rounded-xl border p-4 space-y-3">
                <p className="text-sm font-medium">เพิ่ม IP ใหม่</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border rounded-lg px-3 py-2 text-sm"
                    placeholder="IP Address เช่น 203.150.1.1"
                    value={ipAddress}
                    onChange={(e) => setIpAddress(e.target.value)}
                  />
                  <input
                    className="w-36 border rounded-lg px-3 py-2 text-sm"
                    placeholder="หมายเหตุ"
                    value={ipLabel}
                    onChange={(e) => setIpLabel(e.target.value)}
                  />
                  <button
                    onClick={() => addIp.mutate()}
                    disabled={!ipAddress || addIp.isPending}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    เพิ่ม
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border overflow-x-auto">
                {ipList.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-gray-400 text-center">ยังไม่มี IP (ทุกคนเข้าได้)</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left">IP Address</th>
                        <th className="px-4 py-3 text-left">หมายเหตุ</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ipList.map((entry: any) => (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono">{entry.ipAddress}</td>
                          <td className="px-4 py-3 text-gray-500">{entry.label ?? '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => removeIp.mutate(entry.id)} className="text-xs text-red-500 hover:underline">
                              ลบ
                            </button>
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
      )}

      {/* ── Shop info + Quotation promo text ── */}
      {activeTab === 'shop' && (
        <div className="space-y-6">
          {/* Shop info */}
          {shops.map((shop: any) => (
            <div key={shop.id} className="bg-white rounded-xl border p-5">
              {shopForm && editingShopId === shop.id ? (
                <div className="space-y-3">
                  {(['name', 'phone', 'address', 'email'] as const).map((field) => (
                    <div key={field}>
                      <label className="block text-sm font-medium mb-1">
                        {field === 'name' ? 'ชื่อร้าน' : field === 'phone' ? 'เบอร์โทรศัพท์ (หลายเบอร์ได้ — กด Enter คั่น)' : field === 'address' ? 'ที่อยู่' : 'อีเมลร้าน'}
                      </label>
                      {field === 'phone' ? (
                        <textarea
                          rows={3}
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                          value={shopForm[field]}
                          onChange={(e) => setShopForm((f) => f ? { ...f, [field]: e.target.value } : f)}
                          placeholder={'0-5522-1161\n097-918-5556\n082-171-7787'}
                        />
                      ) : (
                        <input
                          type={field === 'email' ? 'email' : 'text'}
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                          value={shopForm[field]}
                          onChange={(e) => setShopForm((f) => f ? { ...f, [field]: e.target.value } : f)}
                        />
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button onClick={() => saveShop.mutate({ id: shop.id, data: shopForm })} disabled={saveShop.isPending} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
                      {saveShop.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                    <button onClick={() => { setShopForm(null); setEditingShopId(null); }} className="border px-4 py-2 rounded-lg text-sm text-gray-600">
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-base">{shop.name}</p>
                    {shop.phone && <p className="text-sm text-gray-500 mt-0.5">โทร {shop.phone}</p>}
                    {shop.address && <p className="text-sm text-gray-500">{shop.address}</p>}
                    {shop.email && <p className="text-sm text-blue-600 mt-0.5">{shop.email}</p>}
                    {!shop.email && <p className="text-xs text-amber-500 mt-1">ยังไม่ได้ตั้งค่าอีเมล</p>}
                  </div>
                  <button onClick={() => editShop(shop)} className="border px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                    แก้ไข
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Quotation promo text */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div>
              <p className="font-medium text-sm mb-0.5">ข้อความโปรโมชั่นท้ายใบเสนอราคา</p>
              <p className="text-xs text-gray-400">แสดงที่ด้านล่างของใบเสนอราคา (PDF, PNG และหน้าจอลูกค้า)</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">เลือกร้าน</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={promoShopId}
                onChange={(e) => handlePromoShopChange(e.target.value)}
              >
                <option value="">-- เลือกร้าน --</option>
                {shops.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {promoShopId && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Michelin</label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                      rows={4}
                      placeholder="เช่น โปรโมชั่นเดือนมิถุนายน: ซื้อยาง 4 เส้น แถมบริการถ่วงล้อฟรี..."
                      value={promoTextMichelin}
                      onChange={(e) => setPromoTextMichelin(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">BF Goodrich</label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                      rows={4}
                      placeholder="เช่น โปรโมชั่นเดือนมิถุนายน: ซื้อยาง 4 เส้น แถมบริการถ่วงล้อฟรี..."
                      value={promoTextBfGoodrich}
                      onChange={(e) => setPromoTextBfGoodrich(e.target.value)}
                    />
                  </div>
                </div>
                {promoSuccess && <p className="text-sm text-green-600 font-medium">บันทึกแล้ว ✓</p>}
                <button
                  onClick={() => savePromo.mutate()}
                  disabled={savePromo.isPending}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {savePromo.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
