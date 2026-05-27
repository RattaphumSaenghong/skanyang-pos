import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

export default function MarginsReportPage() {
  const shopId = useAuthStore((s) => s.effectiveShopId());
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'margins', shopId],
    queryFn: () => api.get(`/reports/margins${shopId ? `?shopId=${shopId}` : ''}`).then((r) => r.data),
  });

  const rows = data ?? [];

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">รายงานกำไร</h2>
      {isLoading ? <p className="text-gray-400">กำลังโหลด...</p> : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">สินค้า</th>
                <th className="px-4 py-3 text-right">ยอดขาย</th>
                <th className="px-4 py-3 text-right">ต้นทุน</th>
                <th className="px-4 py-3 text-right">กำไรสุทธิ</th>
                <th className="px-4 py-3 text-right">กำไร%</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row: any) => (
                <tr key={row.productId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.brand} {row.model}</p>
                    <p className="text-xs text-gray-500">{row.sizeNormalized}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{row.totalRevenue?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.totalCost?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-700">{row.totalProfit?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono">{(row.marginPct * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
