import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MarginsReportPage from './MarginsReportPage';
import SalesReportPage from './SalesReportPage';
import StockReportPage from './StockReportPage';
import BayReportsPage from './BayReportsPage';

const tabs = [
  { id: 'margins', label: 'รายงานกำไร', icon: '📊', path: '/reports/margins' },
  { id: 'sales', label: 'ยอดขาย', icon: '💰', path: '/reports/sales' },
  { id: 'stock', label: 'สต็อกรายวัน', icon: '📋', path: '/reports/stock' },
  { id: 'bays', label: 'ช่องบริการ', icon: '🔧', path: '/reports/bays' },
];

export default function ReportsPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useMemo(() => {
    const path = location.pathname;
    const tab = tabs.find(t => t.path === path);
    return tab?.id || 'margins';
  }, [location.pathname]);

  return (
    <div>
      {/* Tab navigation */}
      <div className="border-b bg-white sticky top-0 z-10">
        <div className="flex gap-1 p-4 max-w-full overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-100 text-blue-700 border-b-2 border-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-gray-50 min-h-screen">
        {activeTab === 'margins' && <MarginsReportPage />}
        {activeTab === 'sales' && <SalesReportPage />}
        {activeTab === 'stock' && <StockReportPage />}
        {activeTab === 'bays' && <BayReportsPage />}
      </div>
    </div>
  );
}
