import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

type SaleFlag = 'NORMAL' | 'BELOW_COST' | 'APPROVED' | 'SPECIAL';
type Tab = 'history' | 'review' | 'quotations';

interface Quotation {
  id: string;
  number: number;
  createdAt: string;
  status: string;
  plateNumber: string | null;
  shopId: string;
  items: { qty: number; product: { sizeNormalized: string; brand: string; model: string } }[];
}

interface Sale {
  id: string;
  number: number;
  createdAt: string;
  servedBy?: { username: string };
  totalAmount: number;
  grossProfit: number;
  paymentMethod: string;
  flag: SaleFlag;
}

function realMarginPct(sale: Sale): number {
  if (sale.totalAmount === 0) return 0;
  let fee = 0;
  if (sale.paymentMethod === 'CARD') fee = sale.totalAmount * 0.025;
  else if (sale.paymentMethod === 'ZERO_PCT') fee = sale.totalAmount * 0.0581;
  return ((sale.grossProfit - fee) / sale.totalAmount) * 100;
}

const FLAG_ROW_CLASS: Record<SaleFlag, string> = {
  NORMAL: '',
  BELOW_COST: 'bg-yellow-100',
  APPROVED: 'bg-green-100',
  SPECIAL: 'bg-blue-100',
};

const FLAG_BADGE: Record<string, { label: string; cls: string } | undefined> = {
  BELOW_COST: { label: 'ต่ำกว่าต้นทุน', cls: 'bg-yellow-200 text-yellow-800' },
  APPROVED:   { label: 'อนุมัติแล้ว',   cls: 'bg-green-200 text-green-800' },
  SPECIAL:    { label: 'พิเศษ',          cls: 'bg-blue-200 text-blue-800' },
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH:     'เงินสด',
  CARD:     'บัตรเครดิต',
  ZERO_PCT: '0% 10 เดือน',
  TRANSFER: 'โอนเงิน',
};

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function SalesReportPage() {
  const { isOwner, effectiveShopId } = useAuthStore();
  const queryClient = useQueryClient();
  const owner = isOwner();
  const shopId = effectiveShopId();

  const today = toDateStr(new Date());
  const thirtyAgo = toDateStr(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const [tab, setTab] = useState<Tab>('history');
  const [dateFrom, setDateFrom] = useState(thirtyAgo);
  const [dateTo, setDateTo] = useState(today);

  const { data, isLoading } = useQuery<Sale[]>({
    queryKey: ['sales', shopId, dateFrom, dateTo],
    queryFn: () => {
      const p = new URLSearchParams();
      if (shopId) p.set('shopId', shopId);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      const qs = p.toString();
      return api.get(`/sales${qs ? `?${qs}` : ''}`).then((r) => r.data);
    },
  });

  const cancelQuotationMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/quotations/${id}/cancel`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quotations-report'] }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/sales/${id}/approve`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sales'] }),
  });

  const sales = data ?? [];
  const flagged = sales.filter((s) => s.flag !== 'NORMAL');

  const { data: quotationsData, isLoading: qLoading } = useQuery<Quotation[]>({
    queryKey: ['quotations-report', shopId, dateFrom, dateTo],
    queryFn: () => {
      const p = new URLSearchParams();
      if (shopId) p.set('shopId', shopId);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      return api.get(`/quotations/report?${p}`).then((r) => r.data);
    },
    enabled: tab === 'quotations',
  });
  const quotations = quotationsData ?? [];
  const qConverted = quotations.filter((q) => q.status === 'CONVERTED').length;
  const qCancelled = quotations.filter((q) => q.status === 'CANCELLED').length;
  const qPending = quotations.filter((q) => q.status !== 'CONVERTED' && q.status !== 'CANCELLED').length;
  const conversionRate = quotations.length > 0 ? ((qConverted / quotations.length) * 100).toFixed(1) : '—';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">ยอดขาย</h2>
        {tab === 'history' && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border rounded-lg px-2 py-1.5 bg-white"
            />
            <span className="text-gray-400">—</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={today}
              onChange={(e) => setDateTo(e.target.value)}
              className="border rounded-lg px-2 py-1.5 bg-white"
            />
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['history', ...(owner ? ['review'] : []), 'quotations'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'history' ? 'ประวัติการขาย' : t === 'review' ? 'ตรวจสอบ' : 'ใบเสนอราคา'}
          </button>
        ))}
      </div>

      {tab !== 'quotations' && isLoading ? (
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      ) : tab !== 'quotations' ? (
        <>
          {tab === 'history' && <SalesTable sales={sales} />}
          {tab === 'review' && owner && (
            <SalesTable
              sales={flagged}
              showFlags
              onApprove={(id) => approveMutation.mutate(id)}
              approvingId={approveMutation.isPending ? approveMutation.variables : undefined}
            />
          )}
        </>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'ทั้งหมด', value: quotations.length, cls: 'text-gray-700' },
              { label: 'แปลงเป็นขาย', value: qConverted, cls: 'text-green-600' },
              { label: 'ยกเลิก', value: qCancelled, cls: 'text-red-500' },
              { label: 'Conversion Rate', value: `${conversionRate}%`, cls: 'text-blue-600' },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </div>
          {qLoading ? (
            <p className="text-gray-400 text-sm">กำลังโหลด...</p>
          ) : (
            <QuotationTable quotations={quotations} onCancel={(id) => cancelQuotationMutation.mutate(id)} cancellingId={cancelQuotationMutation.isPending ? cancelQuotationMutation.variables : undefined} />
          )}
        </>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',    cls: 'bg-gray-100 text-gray-600' },
  SENT:      { label: 'ส่งแล้ว',   cls: 'bg-blue-100 text-blue-700' },
  CONVERTED: { label: 'ขายแล้ว',  cls: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'ยกเลิก',   cls: 'bg-red-100 text-red-600' },
};

function QuotationTable({ quotations, onCancel, cancellingId }: {
  quotations: Quotation[];
  onCancel: (id: string) => void;
  cancellingId?: string;
}) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
          <tr>
            <th className="px-4 py-3 text-left">เลขที่</th>
            <th className="px-4 py-3 text-left">วันที่</th>
            <th className="px-4 py-3 text-left">ยางที่เสนอ</th>
            <th className="px-4 py-3 text-left">ทะเบียน</th>
            <th className="px-4 py-3 text-center">สถานะ</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {quotations.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">ไม่มีข้อมูล</td></tr>
          ) : (
            quotations.map((q) => {
              const tires = q.items.map((i) => `${i.product.brand} ${i.product.sizeNormalized}`).join(', ');
              const badge = STATUS_BADGE[q.status] ?? { label: q.status, cls: 'bg-gray-100 text-gray-600' };
              const canCancel = q.status !== 'CONVERTED' && q.status !== 'CANCELLED';
              return (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium">#{String(q.number).padStart(5, '0')}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(q.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={tires}>{tires || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{q.plateNumber ?? '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canCancel && (
                      <button
                        disabled={cancellingId === q.id}
                        onClick={() => onCancel(q.id)}
                        className="px-3 py-1 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                      >
                        {cancellingId === q.id ? '...' : 'ยกเลิก'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function SalesTable({
  sales,
  showFlags = false,
  onApprove,
  approvingId,
}: {
  sales: Sale[];
  showFlags?: boolean;
  onApprove?: (id: string) => void;
  approvingId?: string;
}) {
  const colSpan = showFlags ? 8 : 6;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
          <tr>
            <th className="px-4 py-3 text-left">เลขที่</th>
            <th className="px-4 py-3 text-left">วันที่</th>
            <th className="px-4 py-3 text-left">พนักงาน</th>
            <th className="px-4 py-3 text-right">รวม (฿)</th>
            <th className="px-4 py-3 text-left">วิธีชำระ</th>
            <th className="px-4 py-3 text-right">กำไร%</th>
            {showFlags && <th className="px-4 py-3 text-left">สถานะ</th>}
            {showFlags && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sales.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-gray-400">
                ไม่มีข้อมูล
              </td>
            </tr>
          ) : (
            sales.map((sale) => {
              const badge = FLAG_BADGE[sale.flag];
              return (
                <tr key={sale.id} className={showFlags ? FLAG_ROW_CLASS[sale.flag] : ''}>
                  <td className="px-4 py-3 font-mono font-medium">#{String(sale.number).padStart(5, '0')}</td>
                  <td className="px-4 py-3">
                    {new Date(sale.createdAt).toLocaleDateString('th-TH', {
                      day: '2-digit', month: 'short', year: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">{sale.servedBy?.username ?? '-'}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {sale.totalAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-green-700">
                    {realMarginPct(sale).toFixed(1)}%
                  </td>
                  {showFlags && (
                    <td className="px-4 py-3">
                      {badge && (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                    </td>
                  )}
                  {showFlags && (
                    <td className="px-4 py-3 text-right">
                      {sale.flag === 'BELOW_COST' && onApprove && (
                        <button
                          disabled={approvingId === sale.id}
                          onClick={() => onApprove(sale.id)}
                          className="px-3 py-1 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {approvingId === sale.id ? '...' : 'อนุมัติ'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
