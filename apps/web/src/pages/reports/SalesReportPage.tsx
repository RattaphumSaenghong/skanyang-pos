import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

type SaleFlag = 'NORMAL' | 'BELOW_COST' | 'APPROVED' | 'SPECIAL';

interface Sale {
  id: string;
  createdAt: string;
  servedBy?: { username: string };
  totalAmount: number;
  paymentMethod: string;
  flag: SaleFlag;
}

const FLAG_ROW_CLASS: Record<SaleFlag, string> = {
  NORMAL: '',
  BELOW_COST: 'bg-yellow-100',
  APPROVED: 'bg-green-100',
  SPECIAL: 'bg-blue-100',
};

const FLAG_BADGE: Record<string, { label: string; class: string } | undefined> = {
  BELOW_COST: { label: 'BELOW_COST', class: 'bg-yellow-200 text-yellow-800' },
  APPROVED: { label: 'APPROVED', class: 'bg-green-200 text-green-800' },
  SPECIAL: { label: 'SPECIAL', class: 'bg-blue-200 text-blue-800' },
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  CARD: 'บัตรเครดิต',
  ZERO_PCT: '0% 10 เดือน',
  TRANSFER: 'โอนเงิน',
};

export default function SalesReportPage() {
  const { isOwner } = useAuthStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Sale[]>({
    queryKey: ['sales'],
    queryFn: () => api.get('/sales').then((r) => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/sales/${id}/approve`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });

  const sales = data ?? [];

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">ยอดขาย</h2>
      {isLoading ? (
        <p className="text-gray-400">กำลังโหลด...</p>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">วันที่</th>
                <th className="px-4 py-3 text-left">พนักงาน</th>
                <th className="px-4 py-3 text-right">รวม</th>
                <th className="px-4 py-3 text-left">วิธีชำระ</th>
                <th className="px-4 py-3 text-left">สถานะ</th>
                {isOwner() && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {sales.map((sale) => {
                const badge = FLAG_BADGE[sale.flag];
                const isPending = approveMutation.isPending && approveMutation.variables === sale.id;
                return (
                  <tr key={sale.id} className={FLAG_ROW_CLASS[sale.flag]}>
                    <td className="px-4 py-3">
                      {new Date(sale.createdAt).toLocaleDateString('th-TH')}
                    </td>
                    <td className="px-4 py-3">
                      {sale.servedBy?.username ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {sale.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod}
                    </td>
                    <td className="px-4 py-3">
                      {badge ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.class}`}>
                          {badge.label}
                        </span>
                      ) : null}
                    </td>
                    {isOwner() && (
                      <td className="px-4 py-3 text-right">
                        {sale.flag === 'BELOW_COST' && (
                          <button
                            disabled={isPending}
                            onClick={() => approveMutation.mutate(sale.id)}
                            className="px-3 py-1 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isPending ? '...' : 'อนุมัติ'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={isOwner() ? 6 : 5} className="px-4 py-8 text-center text-gray-400">
                    ไม่มีข้อมูลการขาย
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
