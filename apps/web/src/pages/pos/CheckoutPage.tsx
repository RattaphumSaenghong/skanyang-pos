import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

type PaymentMethod = 'CASH' | 'CARD' | 'ZERO_PCT' | 'TRANSFER';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'เงินสด',
  TRANSFER: 'เงินโอน',
  CARD: 'รูดบัตร',
  ZERO_PCT: '0% 10 เดือน',
};

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [method, setMethod] = useState<PaymentMethod>('CASH');

  const { data: quotation, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/quotations/${id}`).then((r) => r.data),
  });

  const checkout = useMutation({
    mutationFn: () => api.post('/sales', { quotationId: id, paymentMethod: method }).then((r) => r.data),
    onSuccess: () => navigate('/pos/search'),
  });

  if (isLoading) return <div className="p-6">กำลังโหลด...</div>;
  if (!quotation) return <div className="p-6 text-red-500">ไม่พบใบเสนอราคา</div>;

  const items = quotation.items ?? [];
  const unitPrice = (item: any) =>
    method === 'CARD' ? item.unitPriceCard
    : method === 'ZERO_PCT' ? item.unitPriceZeroPct
    : item.unitPriceCash;

  const total = items.reduce((s: number, item: any) => s + unitPrice(item) * item.qty, 0);

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-6">ชำระเงิน</h2>

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

      <button
        onClick={() => checkout.mutate()}
        disabled={checkout.isPending}
        className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-base hover:bg-green-700 disabled:opacity-50"
      >
        {checkout.isPending ? 'กำลังบันทึก...' : `ยืนยันการชำระ ${total.toLocaleString()} ฿`}
      </button>
    </div>
  );
}
