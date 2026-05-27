import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

type Tab = 'users' | 'shop';

export default function UsersSettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'STAFF', shopId: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const { data: shops = [] } = useQuery<any[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
  });

  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [shopForm, setShopForm] = useState<{ name: string; phone: string; address: string; email: string } | null>(null);

  const editShop = (s: any) => {
    setEditingShopId(s.id);
    setShopForm({ name: s.name ?? '', phone: s.phone ?? '', address: s.address ?? '', email: s.email ?? '' });
  };

  const create = useMutation({
    mutationFn: () => api.post('/users', form),
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

  const saveShop = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/shops/${id}`, data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shops'] }); setShopForm(null); setEditingShopId(null); },
  });

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-4">ตั้งค่า</h2>

      {/* Tab bar — same style as inventory */}
      <div className="flex gap-1 mb-6 border-b">
        {(['users', 'shop'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'users' ? 'ผู้ใช้งาน' : 'ข้อมูลร้าน'}
          </button>
        ))}
      </div>

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
              <button onClick={() => create.mutate()} disabled={create.isPending} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm w-full">
                บันทึก
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ชื่อ</th>
                  <th className="px-4 py-3 text-center">บทบาท</th>
                  <th className="px-4 py-3 text-center">สถานะ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(users ?? []).map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{u.displayName}</p>
                      <p className="text-xs text-gray-500">@{u.username}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${u.role === 'OWNER' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
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

      {activeTab === 'shop' && (
        <div className="space-y-4">
          {shops.map((shop: any) => (
            <div key={shop.id} className="bg-white rounded-xl border p-5">
              {shopForm && editingShopId === shop.id ? (
                <div className="space-y-3">
                  {(['name', 'phone', 'address', 'email'] as const).map((field) => (
                    <div key={field}>
                      <label className="block text-sm font-medium mb-1">
                        {field === 'name' ? 'ชื่อร้าน' : field === 'phone' ? 'เบอร์โทรศัพท์' : field === 'address' ? 'ที่อยู่' : 'อีเมลร้าน (ใช้ส่งใบเสนอราคา)'}
                      </label>
                      <input
                        type={field === 'email' ? 'email' : 'text'}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                        value={shopForm[field]}
                        onChange={(e) => setShopForm((f) => f ? { ...f, [field]: e.target.value } : f)}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveShop.mutate({ id: shop.id, data: shopForm })}
                      disabled={saveShop.isPending}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
                    >
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
                  <button
                    onClick={() => editShop(shop)}
                    className="border px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    แก้ไข
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
