import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';

interface Shop { id: string; name: string }

const navItems = [
  { to: '/pos/search', label: 'POS', icon: '🛒' },
  { to: '/bays/board', label: 'ช่องบริการ', icon: '🔧' },
  { to: '/stock/dashboard', label: 'คลังสินค้า', icon: '📦' },
  { to: '/products/list', label: 'Upload', icon: '📤' },
];

const ownerItems = [
  { to: '/reports/margins', label: 'รายงาน', icon: '📊' },
  { to: '/reports/sales', label: 'ยอดขาย', icon: '💰' },
  { to: '/reports/stock', label: 'สต็อกรายวัน', icon: '📋' },
  { to: '/bills/matcher', label: 'จับคู่บิล', icon: '📝' },
  { to: '/settings/users', label: 'ตั้งค่า', icon: '⚙️' },
  { to: '/settings/bays', label: 'ตั้งค่าช่อง', icon: '🛠️' },
];

export default function Layout() {
  const { user, logout, isOwner, isSuperOwner, setSelectedShopId } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  const { data: shops = [] } = useQuery<Shop[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
    enabled: isSuperOwner(),
  });

  // Default to first shop when super-owner logs in or shops load
  useEffect(() => {
    if (isSuperOwner() && shops.length > 0 && !user?.shopId) {
      setSelectedShopId(shops[0].id);
    }
  }, [shops, user?.shopId, isSuperOwner, setSelectedShopId]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleOpenDisplay = async () => {
    const shopId = user?.shopId ?? shops[0]?.id;
    if (!shopId || !user?.id) return;
    // The display screen has no login, so it carries the shop's display token
    const { data } = await api.get(`/display/${shopId}/token`);
    window.open(`/display/${shopId}/${user.id}?t=${encodeURIComponent(data.displayToken)}`, '_blank');
  };

  const selectedShop = shops.find((s) => s.id === user?.shopId);

  return (
    <div className="flex h-screen bg-gray-100">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={closeSidebar} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-56 flex-col bg-white border-r
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:translate-x-0`}
      >
        <div className="p-4 border-b">
          <p className="font-bold text-lg">{selectedShop?.name ?? 'POS'}</p>
          <p className="text-xs text-gray-500">{user?.username} · {user?.role === 'OWNER' ? 'Super Admin' : user?.role === 'SHOP_OWNER' ? 'เจ้าของร้าน' : 'พนักงาน'}</p>
          {isSuperOwner() && shops.length > 0 && (
            <select
              value={user?.shopId ?? ''}
              onChange={(e) => setSelectedShopId(e.target.value)}
              className="mt-2 w-full text-xs border rounded px-2 py-1 bg-gray-50 font-medium text-gray-700"
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {!isSuperOwner() && user?.shopId && (
            <p className="text-xs text-blue-600 mt-1 font-medium">{selectedShop?.name ?? ''}</p>
          )}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
          {isOwner() && ownerItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t space-y-1">
          <button
            onClick={handleOpenDisplay}
            className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <span>🖥️</span>
            จอลูกค้า
          </button>
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
          >
            ออกจากระบบ
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b bg-white p-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="เปิดเมนู"
            className="rounded-lg p-3 -ml-1 text-xl leading-none hover:bg-gray-100 active:bg-gray-200"
          >
            ☰
          </button>
          <p className="truncate font-bold text-base">{selectedShop?.name ?? 'POS'}</p>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
