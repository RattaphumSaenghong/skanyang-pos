import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface BillLine {
  id: string;
  kind: 'ITEM' | 'SERVICE' | 'FREEFORM';
  poolItemId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

interface Bill {
  id: string;
  seq: number;
  billDate: string;
  amount: number;
  locked: boolean;
  status: string;
  lines: BillLine[];
}

interface BatchDetail {
  id: string;
  label: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  createdAt: string;
  bills: Bill[];
}

interface Shop {
  id: string;
  name: string;
  phone?: string;
  address?: string;
}

export default function BillPrintPage() {
  const { batchId, billId } = useParams<{ batchId: string; billId: string }>();
  const shopId = useAuthStore((s) => s.effectiveShopId());

  const { data: batchDetail } = useQuery<BatchDetail>({
    queryKey: ['bill-batch', batchId],
    queryFn: () => api.get(`/bill-batches/${batchId}`).then((r) => r.data),
    enabled: !!batchId,
  });

  const { data: shops = [] } = useQuery<Shop[]>({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data),
  });

  const bill = batchDetail?.bills.find((b) => b.id === billId);
  // This prints on a tax invoice, so it has to be THIS shop — the operator runs
  // two branches and picking the first row would put the wrong name on it.
  const shop = shops.find((s) => s.id === shopId);

  if (!bill) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        <p>ไม่พบบิล</p>
      </div>
    );
  }

  return (
    <div className="p-8 bg-white">
      {/* Header */}
      <div className="text-center mb-6 border-b pb-4">
        <h1 className="text-lg font-bold">{shop?.name ?? 'ร้านยาง'}</h1>
        {shop?.phone && (
          <p className="text-xs text-gray-600">โทร {shop.phone}</p>
        )}
        {shop?.address && (
          <p className="text-xs text-gray-600">{shop.address}</p>
        )}
        <p className="text-xs text-gray-500 mt-2">ใบกำกับภาษีอย่างย่อ</p>
      </div>

      {/* Bill info */}
      <div className="mb-4 text-sm">
        <div className="flex justify-between mb-1">
          <span>บิลเลขที่:</span>
          <span className="font-bold">
            #{String(bill.seq).padStart(5, '0')}
          </span>
        </div>
        <div className="flex justify-between">
          <span>วันที่:</span>
          <span>
            {new Date(bill.billDate).toLocaleDateString('th-TH', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>

      {/* Line items table */}
      <table className="w-full border-collapse text-sm mb-6">
        <thead>
          <tr className="border-b-2 border-gray-800">
            <th className="border text-left px-2 py-1">รายการ</th>
            <th className="border text-center px-2 py-1 w-12">จำนวน</th>
            <th className="border text-right px-2 py-1 w-20">ราคา/หน่วย</th>
            <th className="border text-right px-2 py-1 w-20">รวม</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="border text-left px-2 py-1 text-xs">
                {line.description}
              </td>
              <td className="border text-center px-2 py-1">{line.qty}</td>
              <td className="border text-right px-2 py-1">
                {line.unitPrice.toLocaleString()}
              </td>
              <td className="border text-right px-2 py-1 font-medium">
                {line.lineTotal.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Total */}
      <div className="flex justify-end mb-6">
        <div className="w-48">
          <div className="flex justify-between text-sm font-bold border-t-2 border-gray-800 pt-2">
            <span>รวมทั้งสิ้น:</span>
            <span>{bill.amount.toLocaleString()} ฿</span>
          </div>
        </div>
      </div>

      {/* Print button */}
      <div className="no-print flex justify-center">
        <button
          onClick={() => window.print()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
        >
          พิมพ์
        </button>
      </div>
    </div>
  );
}
