import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
);

interface DisplayItem {
  product: string;
  size: string;
  qty: number;
  priceCash: number;
  priceCard: number;
  priceZeroPct: number;
}

export default function CustomerDisplayPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [total, setTotal] = useState(0);
  const [idle, setIdle] = useState(true);

  useEffect(() => {
    const channel = supabase
      .channel(`display:${shopId}`)
      .on('broadcast', { event: 'quotation' }, ({ payload }) => {
        setItems(payload.items ?? []);
        setTotal(payload.total ?? 0);
        setIdle(false);
      })
      .on('broadcast', { event: 'idle' }, () => setIdle(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shopId]);

  if (idle) {
    return (
      <div className="h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex flex-col items-center justify-center text-white">
        <p className="text-5xl font-bold mb-4">ส.การยาง</p>
        <p className="text-xl opacity-75">ไทร์พลัส พิษณุโลก</p>
        <p className="mt-8 text-sm opacity-50">โทร. 0-5522-1161</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 p-8 flex flex-col">
      <h1 className="text-3xl font-bold text-center mb-6 text-blue-800">รายการสั่งซื้อ</h1>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-lg">
          <thead>
            <tr className="border-b-2">
              <th className="text-left py-3">สินค้า</th>
              <th className="text-center py-3">จำนวน</th>
              <th className="text-right py-3">เงินสด</th>
              <th className="text-right py-3">บัตรเครดิต</th>
              <th className="text-right py-3">0% 10 เดือน</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b">
                <td className="py-4">
                  <p className="font-semibold">{item.product}</p>
                  <p className="text-gray-500">{item.size}</p>
                </td>
                <td className="text-center py-4 font-mono">{item.qty}</td>
                <td className="text-right py-4 font-mono">{item.priceCash.toLocaleString()}</td>
                <td className="text-right py-4 font-mono">{item.priceCard.toLocaleString()}</td>
                <td className="text-right py-4 font-mono">{item.priceZeroPct.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t-2 pt-4 flex justify-between items-center text-2xl font-bold">
        <span>รวมสุทธิ (เงินสด)</span>
        <span className="text-blue-700 font-mono">{total.toLocaleString()} ฿</span>
      </div>
    </div>
  );
}
