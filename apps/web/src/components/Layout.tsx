import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

const navItems = [
  { to: '/pos/search', label: 'POS', icon: '🛒' },
  { to: '/stock/dashboard', label: 'คลังสินค้า', icon: '📦' },
  { to: '/products/list', label: 'สินค้า', icon: '🔍' },
];

const ownerItems = [
  { to: '/reports/margins', label: 'รายงาน', icon: '📊' },
  { to: '/reports/sales', label: 'ยอดขาย', icon: '💰' },
  { to: '/settings/users', label: 'ตั้งค่า', icon: '⚙️' },
];

export default function Layout() {
  const { user, logout, isOwner } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-56 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <p className="font-bold text-lg">ส.การยาง</p>
          <p className="text-xs text-gray-500">{user?.username} · {user?.role === 'OWNER' ? 'เจ้าของ' : 'พนักงาน'}</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
        <div className="p-2 border-t">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
          >
            ออกจากระบบ
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
