import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

function formatPhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.split('\n').map((p) => p.trim()).filter(Boolean).join(' · ');
}

type PaymentRow = {
  label: string;
  unitPrice: number;
  discCard: number;
  discCash: number;
  discPromo: number;
  note: string;
};

function paymentRowClass(label: string): string {
  if (label === '0%') return 'bg-pink-50 hover:bg-pink-100';
  if (label === 'บัตร') return 'bg-sky-50 hover:bg-sky-100';
  return 'bg-emerald-50 hover:bg-emerald-100';
}

function buildPaymentRows(item: any): PaymentRow[] {
  if (!item.isSetPricing && item.qty % 4 !== 0) {
    return [
      {
        label: '0%',
        unitPrice: item.unitPriceZeroPct,
        discCard: 0,
        discCash: 0,
        discPromo: 0,
        note: '0% 4เดือน',
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
        label: 'สด',
        unitPrice: item.unitPriceCash,
        discCard: 0,
        discCash: item.discCash ?? 0,
        discPromo: 0,
        note: 'ขายเส้น (ราคาสด)',
      },
    ];
  }
  return [
    {
      label: '0%',
      unitPrice: item.unitPriceZeroPct,
      discCard: 0,
      discCash: 0,
      discPromo: item.discPromo ?? 0,
      note: '0% 10เดือน',
    },
    {
      label: 'บัตร',
      unitPrice: item.unitPriceCard,
      discCard: item.discCard ?? 0,
      discCash: 0,
      discPromo: item.discPromo ?? 0,
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
  const [notesMichelin, setNotesMichelin] = useState('');
  const [notesBfGoodrich, setNotesBfGoodrich] = useState('');
  const notes = [
    notesMichelin && `Michelin: ${notesMichelin}`,
    notesBfGoodrich && `BF Goodrich: ${notesBfGoodrich}`,
  ].filter(Boolean).join('\n');
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
    await document.fonts.ready;
    const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `quotation-${qNum}.png`;
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
    mutationFn: () => {
      const shopId = quotation?.shopId ?? user?.shopId;
      const path = user?.id ? `/display/${shopId}/${user.id}/active-quotation` : `/display/${shopId}/active-quotation`;
      return api.post(path, { quotationId: id }).then((r) => r.data);
    },
    onSuccess: () => {
      setDisplayToast(true);
      setTimeout(() => setDisplayToast(false), 3000);
    },
  });

  const stopDisplay = useMutation({
    mutationFn: () => {
      const shopId = quotation?.shopId ?? user?.shopId;
      const path = user?.id ? `/display/${shopId}/${user.id}/active-quotation` : `/display/${shopId}/active-quotation`;
      return api.delete(path).then((r) => r.data);
    },
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

  const qNum = `PO${String(quotation.number).padStart(5, '0')}`;

  // ─── Print-only view ─────────────────────────────────────────────────────
  const printView = (
    <div ref={printRef} className="absolute -left-[9999px] top-0 w-[1200px] print:static print:left-auto print:top-auto print:w-full print:block p-8 font-sans">
      <div style={{ maxWidth: 1150, margin: '0 auto', border: '2px solid #6b7280', borderRadius: 12, padding: '2rem 2.5rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #9ca3af', paddingBottom: '1rem' }}>
          <p style={{ fontSize: '0.68rem', color: '#374151', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>ใบเสนอราคา #{qNum}</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 900, color: '#111', margin: '2px 0' }}>{shop?.name ?? '—'}</p>
          {shop?.address && <p style={{ fontSize: '0.85rem', color: '#374151', marginBottom: 2 }}>{shop.address}</p>}
          {shop?.phone && <p style={{ fontSize: '0.82rem', color: '#111' }}>โทร. {formatPhone(shop.phone)}</p>}
          <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid #9ca3af', display: 'flex', justifyContent: 'center', gap: '2.5rem', fontSize: '0.85rem' }}>
            <span style={{ color: '#374151' }}>วันที่: <strong style={{ color: '#111' }}>{new Date(quotation.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })}</strong></span>
            {plateNumber && <span style={{ color: '#374151' }}>ทะเบียน: <strong style={{ color: '#111' }}>{plateNumber}</strong></span>}
          </div>
          {notes && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: 4, whiteSpace: 'pre-wrap' }}>{notes}</p>}
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead style={{ background: '#e5e7eb' }}>
            <tr>
              {['No', 'ยี่ห้อ/รุ่น/ขนาด', 'ราคาปกติ', 'ลดยางเก่า', 'ลดบัตร/ลดสด', 'ลดโปรฯ', 'ราคา/เส้น', 'จำนวน', 'รวม(ชุด)', 'รวม(20% promo)', 'วิธีการชำระ'].map((h) => (
                <th key={h} style={{ border: '1px solid #6b7280', padding: '7px 9px', whiteSpace: 'nowrap', textAlign: h === 'No' || h === 'จำนวน' ? 'center' : h === 'ยี่ห้อ/รุ่น/ขนาด' || h === 'วิธีการชำระ' ? 'left' : 'right', color: '#111', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const rows = buildPaymentRows(item);
              return rows.map((row, rowIdx) => {
                const mid = Math.floor(rows.length / 2);
              const last = rows.length - 1;
              const spanCell = (content: React.ReactNode, extraStyle?: React.CSSProperties, targetRow = mid) => (
                  <td style={{
                    borderLeft: '1px solid #6b7280',
                    borderRight: '1px solid #6b7280',
                    borderTop: rowIdx === 0 ? '1px solid #6b7280' : 'none',
                    borderBottom: rowIdx === last ? '1px solid #6b7280' : 'none',
                    padding: '5px 9px',
                    verticalAlign: 'middle',
                    background: '#fee2e2',
                    ...extraStyle,
                  }}>
                    {rowIdx === targetRow ? content : null}
                  </td>
                );
                return (
                  <tr key={`print-${item.id}-${rowIdx}`} style={{ background: row.label === '0%' ? '#fce7f3' : row.label === 'บัตร' ? '#dbeafe' : '#dcfce7' }}>
                    {spanCell(idx + 1, { textAlign: 'center', fontWeight: 600 })}
                    <td style={{
                      borderLeft: '1px solid #6b7280', borderRight: '1px solid #6b7280',
                      borderTop: rowIdx === 0 ? '1px solid #6b7280' : 'none',
                      borderBottom: rowIdx === last ? '1px solid #6b7280' : 'none',
                      padding: '5px 10px', background: '#fee2e2',
                    }}>
                      {rowIdx === 0 && <p style={{ fontWeight: 700 }}>{item.product?.brand} {item.product?.model}</p>}
                      {rowIdx === 1 && <p style={{ color: '#374151', fontSize: '0.75rem' }}>{item.product?.sizeNormalized}</p>}
                      {rowIdx === last && (item.isSetPricing || item.product?.isNonPromo || item.product?.dotYear) && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          {item.isSetPricing && <span style={{ background: '#fce7f3', color: '#be185d', border: '1px solid #f9a8d4', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px' }}>ชุด 4 เส้น</span>}
                          {item.product?.isNonPromo && <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px' }}>Non Promo</span>}
                          {item.product?.dotYear && <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px' }}>DOT {item.product.dotYear}</span>}
                        </p>
                      )}
                    </td>
                    {spanCell((item.priceListed ?? 0).toLocaleString(), { textAlign: 'right', fontFamily: 'monospace' })}
                    {spanCell((item.discTradeIn ?? 0) > 0 ? (item.discTradeIn).toLocaleString() : '—', { textAlign: 'right', fontFamily: 'monospace' })}
                    <td style={{ border: '1px solid #6b7280', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace' }}>{(row.discCard + row.discCash) > 0 ? (row.discCard + row.discCash).toLocaleString() : '—'}</td>
                    <td style={{ border: '1px solid #6b7280', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace' }}>{row.discPromo > 0 ? row.discPromo.toLocaleString() : '—'}</td>
                    <td style={{ border: '1px solid #6b7280', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{row.unitPrice.toLocaleString()}</td>
                    {spanCell(item.qty, { textAlign: 'center', fontWeight: 700 })}
                    <td style={{ border: '1px solid #6b7280', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: rowIdx === rows.length - 1 ? '#15803d' : '#111' }}>{(row.unitPrice * item.qty).toLocaleString()}</td>
                    <td style={{ border: '1px solid #6b7280', padding: '5px 9px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{(row.unitPrice * item.qty * 0.8).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td style={{ border: '1px solid #6b7280', padding: '5px 9px', color: '#374151', fontSize: '0.75rem' }}>{row.note}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div style={{ marginTop: '1rem', borderTop: '2px solid #9ca3af', paddingTop: '0.85rem' }}>
          {(shop?.promoTextMichelin || shop?.promoTextBfGoodrich) && (
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid #9ca3af' }}>
              {shop?.promoTextMichelin && (
                <p style={{ flex: 1, fontSize: '0.8rem', color: '#111', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  <strong>Michelin:</strong> {shop.promoTextMichelin}
                </p>
              )}
              {shop?.promoTextBfGoodrich && (
                <p style={{ flex: 1, fontSize: '0.8rem', color: '#111', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  <strong>BF Goodrich:</strong> {shop.promoTextBfGoodrich}
                </p>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
            <ol style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.72rem', color: '#374151', lineHeight: 1.9 }}>
              <li>ราคาสินค้า อาจมีการเปลี่ยนแปลงตามโปรโมชั่นต่างๆ</li>
              <li>ราคาตีเทิร์นยางเก่า อาจเปลี่ยนแปลงตามการสึกหรอของยางในวันที่มาเปลี่ยน</li>
              <li>ราคานี้รวมค่าบริการเปลี่ยน จุ๊ป-ถ่วงล้อ-ตั้งศูนย์-ลมไนโตรเจน สำหรับลูกค้าเปลี่ยนยาง 4 เส้นเท่านั้น</li>
            </ol>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <img src="/payment-icons/krungsri.png" alt="krungsri" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} />
              <div style={{ display: 'flex', gap: 4 }}>
                <img src="/payment-icons/aeon.png" alt="aeon" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} />
                <img src="/payment-icons/ktc.png" alt="ktc" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} />
              </div>
              <img src="/payment-icons/kbank-smartpay.png" alt="kbank-smartpay" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
    <div className="print:hidden p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">ใบเสนอราคา #{qNum}</h2>
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
      <div className="grid grid-cols-4 gap-4 mb-6">
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
          <label className="block text-sm font-medium mb-1">หมายเหตุ (Michelin)</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={notesMichelin}
            onChange={(e) => setNotesMichelin(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">หมายเหตุ (BF Goodrich)</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={notesBfGoodrich}
            onChange={(e) => setNotesBfGoodrich(e.target.value)}
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

      {/* Shop header */}
      <div className="bg-white rounded-xl border px-6 py-4 mb-4 text-center">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-0.5">ใบเสนอราคา</p>
        <p className="text-xl font-extrabold text-gray-900 leading-tight">{shop?.name ?? '—'}</p>
        {shop?.address && <p className="text-sm text-gray-500 mt-0.5">{shop.address}</p>}
        {shop?.phone && <p className="text-sm text-gray-600 mt-1">โทร. {formatPhone(shop.phone)}</p>}
        <div className="mt-3 pt-3 border-t flex justify-center gap-10 text-sm">
          <span className="text-gray-500">
            วันที่:{' '}
            <span className="font-semibold text-gray-800">
              {new Date(quotation.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })}
            </span>
          </span>
          <span className="text-gray-500">
            ทะเบียน:{' '}
            <span className="font-semibold text-gray-800">{plateNumber || '—'}</span>
          </span>
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
              <th className="border px-2 py-2 text-right">ราคาปกติ</th>
              <th className="border px-2 py-2 text-right">ลดยางเก่า</th>
              <th className="border px-2 py-2 text-right">ลดบัตร/ลดสด</th>
              <th className="border px-2 py-2 text-right">ลดโปรฯ</th>
              <th className="border px-2 py-2 text-right">ราคา/เส้น</th>
              <th className="border px-2 py-2 text-center">จำนวน</th>
              <th className="border px-2 py-2 text-right">รวม(ชุด)</th>
              <th className="border px-2 py-2 text-right">รวม(20% promo)</th>
              <th className="border px-2 py-2 text-left">วิธีการชำระ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const rows = buildPaymentRows(item);
              return rows.map((row, rowIdx) => (
                <tr key={`${item.id}-${rowIdx}`} className={paymentRowClass(row.label)}>
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
                      <p className="text-gray-500">{item.product?.sizeNormalized}</p>
                      {(item.isSetPricing || item.product?.isNonPromo || item.product?.dotYear) && (
                        <div className="flex gap-1 flex-wrap mt-0.5">
                          {item.isSetPricing && (
                            <span className="inline-block bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold px-1.5 py-0.5 rounded">
                              ชุด 4 เส้น
                            </span>
                          )}
                          {item.product?.isNonPromo && (
                            <span className="inline-block bg-red-100 text-red-700 border border-red-200 text-xs font-bold px-1.5 py-0.5 rounded">
                              Non Promo
                            </span>
                          )}
                          {item.product?.dotYear && (
                            <span className="inline-block bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold px-1.5 py-0.5 rounded">
                              DOT {item.product.dotYear}
                            </span>
                          )}
                        </div>
                      )}
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
                  <td className="border px-2 py-1.5 text-right font-mono font-semibold">
                    {(row.unitPrice * item.qty * 0.8).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="border px-2 py-1.5 text-gray-600">{row.note}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Fixed disclaimer + promo text + payment icons */}
      <div className="bg-white rounded-xl border px-5 py-4 mb-4">
        {(shop?.promoTextMichelin || shop?.promoTextBfGoodrich) && (
          <div className="flex gap-6 mb-3 pb-3 border-b">
            {shop?.promoTextMichelin && (
              <p className="flex-1 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                <strong>Michelin:</strong> {shop.promoTextMichelin}
              </p>
            )}
            {shop?.promoTextBfGoodrich && (
              <p className="flex-1 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                <strong>BF Goodrich:</strong> {shop.promoTextBfGoodrich}
              </p>
            )}
          </div>
        )}
        <div className="flex items-start justify-between gap-4 mt-3 pt-3 border-t">
          <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
            <li>ราคาสินค้า อาจมีการเปลี่ยนแปลงตามโปรโมชั่นต่างๆ</li>
            <li>ราคาตีเทิร์นยางเก่า อาจเปลี่ยนแปลงตามการสึกหรอของยางในวันที่มาเปลี่ยน</li>
            <li>ราคานี้รวมค่าบริการเปลี่ยน จุ๊ป-ถ่วงล้อ-ตั้งศูนย์-ลมไนโตรเจน สำหรับลูกค้าเปลี่ยนยาง 4 เส้นเท่านั้น</li>
          </ol>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <img src="/payment-icons/krungsri.png" alt="krungsri" className="h-8 w-auto object-contain rounded" />
            <div className="flex gap-1.5">
              <img src="/payment-icons/aeon.png" alt="aeon" className="h-8 w-auto object-contain rounded" />
              <img src="/payment-icons/ktc.png" alt="ktc" className="h-8 w-auto object-contain rounded" />
            </div>
            <img src="/payment-icons/kbank-smartpay.png" alt="kbank-smartpay" className="h-8 w-auto object-contain rounded" />
          </div>
        </div>
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
