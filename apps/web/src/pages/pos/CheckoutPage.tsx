import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

type PaymentMethod = 'CASH' | 'CARD' | 'ZERO_PCT' | 'TRANSFER';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'เงินสด',
  TRANSFER: 'เงินโอน',
  CARD: 'รูดบัตร',
  ZERO_PCT: '0% รูดบัตร',
};

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [customerEmail, setCustomerEmail] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const skipAutoCancel = useRef(false);
  const quotationRef = useRef<any>(null);

  const { data: quotation, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/quotations/${id}`).then((r) => r.data),
  });

  useEffect(() => { quotationRef.current = quotation; }, [quotation]);

  // Auto-cancel SENT quotation on SPA navigation away (back button, etc.)
  useEffect(() => {
    return () => {
      if (!skipAutoCancel.current && quotationRef.current?.status === 'SENT') {
        api.delete(`/quotations/${id}`).catch(() => {});
      }
    };
  }, [id]);

  // Auto-cancel on tab close or page refresh
  useEffect(() => {
    const handleUnload = () => {
      if (!skipAutoCancel.current && quotationRef.current?.status === 'SENT') {
        const token = localStorage.getItem('access_token');
        fetch(`/api/quotations/${id}`, {
          method: 'DELETE',
          keepalive: true,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [id]);

  const checkout = useMutation({
    mutationFn: () => {
      skipAutoCancel.current = true;
      return api.post('/sales', {
        quotationId: id,
        paymentMethod: method,
        ...(customerEmail ? { customerEmail } : {}),
      }).then((r) => r.data);
    },
    onSuccess: () => navigate('/pos/search'),
    onError: (err: any) => {
      skipAutoCancel.current = false;
      setCheckoutError(err.response?.data?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    },
  });

  if (isLoading) return <div className="p-6">กำลังโหลด...</div>;
  if (!quotation) return <div className="p-6 text-red-500">ไม่พบใบเสนอราคา</div>;

  const items = quotation.items ?? [];
  const unitPrice = (item: any) => {
    const isIndividual = !item.isSetPricing || item.qty % 4 !== 0;
    if (isIndividual) {
      if (method === 'ZERO_PCT') return item.unitPriceZeroPct;
      if (method === 'CARD') return item.unitPriceCard;
      return item.unitPriceCash;
    }
    if (method === 'CARD') return item.unitPriceCard;
    if (method === 'ZERO_PCT') return item.unitPriceZeroPct;
    return item.unitPriceCash;
  };

  const total = items.reduce((s: number, item: any) => s + unitPrice(item) * item.qty, 0);

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-2">ชำระเงิน</h2>
      <div className="flex gap-4 text-sm text-gray-500 mb-6">
        <span>ใบเสนอราคา <span className="font-mono font-medium text-gray-800">#{String(quotation.number).padStart(5, '0')}</span></span>
        {quotation.plateNumber && (
          <span>ทะเบียน <span className="font-medium text-gray-800">{quotation.plateNumber}</span></span>
        )}
      </div>

      <div className="bg-white rounded-xl border p-4 mb-6">
        {items.map((item: any) => (
          <div key={item.id} className="flex justify-between py-2 border-b last:border-0 text-sm">
            <div>
              <span className="font-medium">{item.product?.brand} {item.product?.model}</span>
              <span className="text-gray-500 ml-2">{item.product?.sizeNormalized} ×{item.qty}</span>
            </div>
            <span className="font-mono">{(unitPrice(item) * item.qty).toLocaleString()} ฿</span>
          </div>
        ))}
        <div className="flex justify-between pt-3 font-bold text-base">
          <span>รวมสุทธิ</span>
          <span className="font-mono text-blue-700">{total.toLocaleString()} ฿</span>
        </div>
      </div>

      <p className="font-medium mb-3">วิธีการชำระเงิน</p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`border rounded-xl py-3 text-sm font-medium transition-colors ${
              method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'
            }`}
          >
            {PAYMENT_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">อีเมลลูกค้า (ไม่บังคับ)</label>
        <input
          type="email"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="customer@email.com"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {checkoutError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {checkoutError}
        </div>
      )}

      <button
        onClick={() => { setCheckoutError(null); checkout.mutate(); }}
        disabled={checkout.isPending}
        className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-base hover:bg-green-700 disabled:opacity-50"
      >
        {checkout.isPending ? 'กำลังบันทึก...' : `ยืนยันการชำระ ${total.toLocaleString()} ฿`}
      </button>
    </div>
  );
}
