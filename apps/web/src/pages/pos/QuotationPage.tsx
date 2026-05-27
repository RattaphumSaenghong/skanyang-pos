import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

type PaymentRow = {
  label: string;
  unitPrice: number;
  discCard: number;
  discCash: number;
  discPromo: number;
  note: string;
};

function buildPaymentRows(item: any): PaymentRow[] {
  if (!item.isSetPricing && item.qty % 4 !== 0) {
    return [{
      label: 'สด',
      unitPrice: item.unitPriceCash,
      discCard: 0,
      discCash: 0,
      discPromo: 0,
      note: 'ขายเส้น (ราคาสด)',
    }];
  }
  return [
    {
      label: '0%',
      unitPrice: item.unitPriceZeroPct,
      discCard: 0,
      discCash: 0,
      discPromo: 0,
      note: '0% 10เดือน',
    },
    {
      label: 'บัตร',
      unitPrice: item.unitPriceCard,
      discCard: item.discCard ?? 0,
      discCash: 0,
      discPromo: 0,
      note: 'รูดบัตรเต็มจำนวน',
    },
    {
      label: 'สด/โอน',
      unitPrice: item.unitPriceCash,
      discCard: 0,
      discCash: item.discCash ?? 0,
      discPromo: item.discPromo ?? 0,
      note: 'เงินสด/เงินโอน',
    },
  ];
}

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [plateNumber, setPlateNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [displayToast, setDisplayToast] = useState(false);
  const [emailToast, setEmailToast] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const skipAutoCancel = useRef(false);
  const quotationRef = useRef<any>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const downloadPng = async () => {
    if (!printRef.current) return;
    printRef.current.style.display = 'block';
    const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    printRef.current.style.display = '';
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `quotation-${String(quotation?.number ?? '').padStart(5, '0')}.png`;
    a.click();
  };

  const { data: quotation, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/quotations/${id}`).then((r) => r.data),
  });

  const { data: shop } = useQuery({
    queryKey: ['shop', quotation?.shopId],
    queryFn: () => api.get(`/shops/${quotation.shopId}`).then((r) => r.data),
    enabled: !!quotation?.shopId,
  });

  // Keep ref in sync so cleanup closures always read the latest status
  useEffect(() => { quotationRef.current = quotation; }, [quotation]);

  // Auto-cancel on SPA navigation away (back button, sidebar link, etc.)
  useEffect(() => {
    return () => {
      if (!skipAutoCancel.current && quotationRef.current?.status === 'DRAFT') {
        api.delete(`/quotations/${id}`).catch(() => {});
      }
    };
  }, [id]);

  // Auto-cancel on tab close or page refresh
  useEffect(() => {
    const handleUnload = () => {
      if (!skipAutoCancel.current && quotationRef.current?.status === 'DRAFT') {
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

  const [updateItemError, setUpdateItemError] = useState<string | null>(null);
  const updateItem = useMutation({
    mutationFn: (payload: { itemId: string; qty?: number; isIndividual?: boolean }) =>
      api.patch(`/quotations/${id}/items/${payload.itemId}`, payload).then((r) => r.data),
    onSuccess: (updated) => {
      setUpdateItemError(null);
      qc.setQueryData(['quotation', id], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item: any) =>
            item.id === updated.id ? { ...item, qty: updated.qty, isIndividual: updated.isIndividual } : item
          ),
        };
      });
    },
    onError: (e: any) => setUpdateItemError(e?.response?.data?.message ?? 'อัพเดทไม่สำเร็จ'),
  });

  const proceed = useMutation({
    mutationFn: () => {
      skipAutoCancel.current = true;
      return api.patch(`/quotations/${id}`, { plateNumber, notes, status: 'SENT' }).then((r) => r.data);
    },
    onSuccess: () => navigate(`/pos/checkout/${id}`),
    onError: () => { skipAutoCancel.current = false; },
  });

  const pushDisplay = useMutation({
    mutationFn: () =>
      api
        .post(`/display/${quotation?.shopId ?? user?.shopId}/active-quotation`, { quotationId: id })
        .then((r) => r.data),
    onSuccess: () => {
      setDisplayToast(true);
      setTimeout(() => setDisplayToast(false), 3000);
    },
  });

  const stopDisplay = useMutation({
    mutationFn: () =>
      api.delete(`/display/${quotation?.shopId ?? user?.shopId}/active-quotation`).then((r) => r.data),
  });

  const cancelQuotation = useMutation({
    mutationFn: () => {
      skipAutoCancel.current = true;
      return api.delete(`/quotations/${id}`).then((r) => r.data);
    },
    onSuccess: () => navigate('/pos/search'),
    onError: (e: any) => {
      skipAutoCancel.current = false;
      setCancelError(e?.response?.data?.message ?? 'ยกเลิกไม่สำเร็จ');
    },
  });

  const sendEmail = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/send-email`, { email }).then((r) => r.data),
    onSuccess: () => { setEmailToast(true); setEmailError(null); setTimeout(() => setEmailToast(false), 3000); },
    onError: (e: any) => setEmailError(e?.response?.data?.message ?? 'ส่งอีเมลไม่สำเร็จ'),
  });

  if (isLoading) return <div className="p-6">กำลังโหลด...</div>;
  if (!quotation) return <div className="p-6 text-red-500">ไม่พบใบเสนอราคา</div>;

  const items = quotation.items ?? [];

  const qNum = String(quotation.number).padStart(5, '0');

  // ─── Print-only view (matches customer display card) ─────────────────────
  const printView = (
    <div ref={printRef} className="hidden print:block p-8 font-sans">
      <div style={{ maxWidth: 900, margin: '0 auto', border: '1px solid #e5e7eb', borderRadius: 12, padding: '2rem 2.5rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>ใบเสนอราคา</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#111', margin: '4px 0' }}>ส.การยาง</p>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>#{qNum}</p>
          {plateNumber && <p style={{ fontSize: '1rem', color: '#374151', marginTop: 4 }}>ทะเบียน: <strong>{plateNumber}</strong></p>}
          {notes && <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 2 }}>หมายเหตุ: {notes}</p>}
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              {['No', 'รุ่น / ขนาด', 'ราคาปก', 'ลดยางเก่า', 'ลดบัตร/ลดสด', 'ลดโปรฯ', 'ราคา/เส้น', 'จำนวน', 'รวม(ชุด)', 'หมายเหตุ'].map((h) => (
                <th key={h} style={{ border: '1px solid #e5e7eb', padding: '7px 9px', textAlign: h === 'No' || h === 'จำนวน' ? 'center' : h === 'รุ่น / ขนาด' || h === 'หมายเหตุ' ? 'left' : 'right', color: '#6b7280', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const rows = buildPaymentRows(item);
              return rows.map((row, rowIdx) => (
                <tr key={`print-${item.id}-${rowIdx}`} style={{ background: item.isSetPricing ? '#fdf2f8' : 'transparent' }}>
                  {rowIdx === 0 && <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '7px 9px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 600 }}>{idx + 1}</td>}
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '8px 10px', verticalAlign: 'middle' }}>
                      <p style={{ fontWeight: 700 }}>{item.product?.model}</p>
                      <p style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: 2 }}>
                        {item.product?.sizeNormalized}
                        {item.isSetPricing && <span style={{ marginLeft: 6, background: '#fce7f3', color: '#be185d', border: '1px solid #fbcfe8', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px' }}>ชุด 4 เส้น</span>}
                      </p>
                    </td>
                  )}
                  {rowIdx === 0 && <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '7px 9px', textAlign: 'right', verticalAlign: 'middle', fontFamily: 'monospace' }}>{(item.priceListed ?? 0).toLocaleString()}</td>}
                  {rowIdx === 0 && <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '7px 9px', textAlign: 'right', verticalAlign: 'middle', fontFamily: 'monospace' }}>{(item.discTradeIn ?? 0) > 0 ? (item.discTradeIn).toLocaleString() : '—'}</td>}
                  <td style={{ border: '1px solid #e5e7eb', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace' }}>{(row.discCard + row.discCash) > 0 ? (row.discCard + row.discCash).toLocaleString() : '—'}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace' }}>{row.discPromo > 0 ? row.discPromo.toLocaleString() : '—'}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{row.unitPrice.toLocaleString()}</td>
                  {rowIdx === 0 && <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '7px 9px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 700 }}>{item.qty}</td>}
                  <td style={{ border: '1px solid #e5e7eb', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: rowIdx === rows.length - 1 ? '#15803d' : '#111' }}>{(row.unitPrice * item.qty).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '5px 9px', color: '#6b7280', fontSize: '0.75rem' }}>{row.note}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>

        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.7rem', marginTop: '1rem' }}>
          ราคารวมค่าบริการเปลี่ยน จุ๊ป ถ่วงล้อ ตั้งศูนย์ ลมไนโตรเจน (เปลี่ยน 4 เส้น)
        </p>
        {shop?.promoText && (
          <p style={{ textAlign: 'center', color: '#374151', fontSize: '0.8rem', marginTop: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {shop.promoText}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
    <div className="print:hidden p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">ใบเสนอราคา #{String(quotation.number).padStart(5, '0')}</h2>
        <div className="flex items-center gap-3">
          {displayToast && (
            <span className="text-sm text-green-700 bg-green-100 px-3 py-1 rounded-full font-medium">
              แสดงบนจอแล้ว ✓
            </span>
          )}
          {emailToast && (
            <span className="text-sm text-green-700 bg-green-100 px-3 py-1 rounded-full font-medium">
              ส่งอีเมลแล้ว ✓
            </span>
          )}
          <button
            onClick={() => pushDisplay.mutate()}
            disabled={pushDisplay.isPending}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
          >
            แสดงบนจอลูกค้า
          </button>
          <button
            onClick={() => stopDisplay.mutate()}
            disabled={stopDisplay.isPending}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 disabled:opacity-60"
          >
            หยุดแสดง
          </button>
          <button
            onClick={() => navigate('/pos/search')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← ค้นหาต่อ
          </button>
        </div>
      </div>

      {/* Plate + Notes + Email */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">ทะเบียนรถ</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            placeholder="เช่น กข 1234 กรุงเทพ"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">หมายเหตุ</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">อีเมลลูกค้า <span className="text-gray-400 font-normal">(ไม่บังคับ)</span></label>
          <div className="flex gap-2">
            <input
              type="email"
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@email.com"
            />
            <button
              onClick={() => sendEmail.mutate()}
              disabled={!email || sendEmail.isPending}
              className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40"
            >
              {sendEmail.isPending ? '...' : 'ส่ง'}
            </button>
          </div>
          {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
        </div>
      </div>

      {updateItemError && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{updateItemError}</p>
      )}

      {/* Paper-format table */}
      <div className="bg-white rounded-xl border overflow-x-auto mb-6">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-gray-50 text-gray-600 uppercase">
            <tr>
              <th className="border px-2 py-2 text-center">No</th>
              <th className="border px-2 py-2 text-left">ยี่ห้อ/รุ่น/ขนาด</th>
              <th className="border px-2 py-2 text-right">ราคาปก</th>
              <th className="border px-2 py-2 text-right">ลดยางเก่า</th>
              <th className="border px-2 py-2 text-right">ลดบัตร/ลดสด</th>
              <th className="border px-2 py-2 text-right">ลดโปรฯ</th>
              <th className="border px-2 py-2 text-right">ราคา/เส้น</th>
              <th className="border px-2 py-2 text-center">จำนวน</th>
              <th className="border px-2 py-2 text-right">รวม(ชุด)</th>
              <th className="border px-2 py-2 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const rows = buildPaymentRows(item);
              return rows.map((row, rowIdx) => (
                <tr key={`${item.id}-${rowIdx}`} className="hover:bg-gray-50">
                  {rowIdx === 0 && (
                    <td
                      rowSpan={rows.length}
                      className="border px-2 py-2 text-center align-middle font-medium"
                    >
                      {idx + 1}
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} className={`border px-2 py-2 align-middle ${item.isSetPricing ? 'bg-pink-50' : ''}`}>
                      <p className="font-medium">
                        {item.product?.brand} {item.product?.model}
                      </p>
                      <p className="text-gray-500">
                        {item.product?.sizeNormalized}
                        {item.isSetPricing && (
                          <span className="ml-1.5 inline-block bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold px-1.5 py-0.5 rounded">
                            ชุด 4 เส้น
                          </span>
                        )}
                      </p>
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td
                      rowSpan={rows.length}
                      className="border px-2 py-2 text-right align-middle font-mono"
                    >
                      {(item.priceListed ?? 0).toLocaleString()}
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td
                      rowSpan={rows.length}
                      className="border px-2 py-2 text-right align-middle font-mono"
                    >
                      {(item.discTradeIn ?? 0) > 0
                        ? (item.discTradeIn ?? 0).toLocaleString()
                        : '-'}
                    </td>
                  )}
                  <td className="border px-2 py-1.5 text-right font-mono">
                    {(row.discCard + row.discCash) > 0
                      ? (row.discCard + row.discCash).toLocaleString()
                      : '-'}
                  </td>
                  <td className="border px-2 py-1.5 text-right font-mono">
                    {row.discPromo > 0 ? row.discPromo.toLocaleString() : '-'}
                  </td>
                  <td className="border px-2 py-1.5 text-right font-mono font-semibold">
                    {row.unitPrice.toLocaleString()}
                  </td>
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} className="border px-2 py-2 text-center align-middle">
                      <div className="inline-flex items-center gap-1 justify-center">
                        <button
                          disabled={item.qty <= 1}
                          onClick={() => updateItem.mutate({ itemId: item.id, qty: item.qty - 1 })}
                          className="w-6 h-6 border rounded text-xs font-medium hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          −
                        </button>
                        <span className="w-10 text-center tabular-nums text-xs">
                          {item.qty}{item.isSetPricing ? ' ชุด' : ''}
                        </span>
                        <button
                          onClick={() => updateItem.mutate({ itemId: item.id, qty: item.qty + 1 })}
                          className="w-6 h-6 border rounded text-xs font-medium hover:bg-gray-100"
                        >
                          +
                        </button>
                      </div>
                    </td>
                  )}
                  <td className="border px-2 py-1.5 text-right font-mono font-semibold">
                    {(row.unitPrice * item.qty).toLocaleString()}
                  </td>
                  <td className="border px-2 py-1.5 text-gray-600">{row.note}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div className="flex gap-3 justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => {
              setCancelError(null);
              if (confirm('ยืนยันการยกเลิกใบเสนอราคานี้?')) cancelQuotation.mutate();
            }}
            disabled={cancelQuotation.isPending || quotation.status === 'CONVERTED' || quotation.status === 'CANCELLED'}
            className="border border-red-300 text-red-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-40"
          >
            ยกเลิกใบเสนอราคา
          </button>
          {cancelError && <p className="text-xs text-red-500 self-center">{cancelError}</p>}
          <button
            onClick={() => window.print()}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            ดาวน์โหลด PDF
          </button>
          <button
            onClick={downloadPng}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            ดาวน์โหลด PNG
          </button>
        </div>
        <button
          onClick={() => proceed.mutate()}
          disabled={proceed.isPending}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          ดำเนินการชำระเงิน →
        </button>
      </div>
    </div>
    {printView}
    </>
  );
}
