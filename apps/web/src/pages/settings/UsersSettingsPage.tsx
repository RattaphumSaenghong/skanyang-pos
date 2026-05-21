import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function UsersSettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'STAFF', shopId: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowForm(false); setForm({ username: '', displayName: '', password: '', role: 'STAFF', shopId: '' }); },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">จัดการผู้ใช้</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
          + เพิ่มผู้ใช้
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border p-4 mb-6 space-y-3">
          {(['username', 'displayName', 'password'] as const).map((field) => (
            <div key={field}>
              <label className="block text-sm font-medium mb-1">{field === 'username' ? 'ชื่อผู้ใช้' : field === 'displayName' ? 'ชื่อแสดง' : 'รหัสผ่าน'}</label>
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
    </div>
  );
}
