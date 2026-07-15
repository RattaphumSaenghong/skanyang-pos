import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

interface DisplayImage { id: string; url: string; }

interface QuotationItem {
  id: string;
  qty: number;
  isSetPricing: boolean;
  unitPriceCash: number;
  unitPriceCard: number;
  unitPriceZeroPct: number;
  priceListed: number;
  discTradeIn: number;
  discCard: number;
  discCash: number;
  discPromo: number;
  product: { brand: string; model: string; sizeNormalized: string; isSetPricing: boolean; isNonPromo: boolean; imageUrl: string | null };
}

interface ActiveQuotation {
  id: string;
  plateNumber: string | null;
  customer: { name: string } | null;
  items: QuotationItem[];
}

interface SearchEntry {
  id: string;
  product: { brand: string; model: string; sizeNormalized: string; isSetPricing: boolean; isNonPromo: boolean };
  priceCash: number;
  priceCard: number;
  priceZeroPct: number;
}

type PaymentRow = { label: string; unitPrice: number; discCard: number; discCash: number; discPromo: number; note: string };

function buildPaymentRows(item: QuotationItem): PaymentRow[] {
  if (!item.isSetPricing && item.qty % 4 !== 0) {
    return [
      { label: '0%', unitPrice: item.unitPriceZeroPct, discCard: 0, discCash: 0, discPromo: 0, note: '0% 4เดือน' },
      { label: 'บัตร', unitPrice: item.unitPriceCard, discCard: item.discCard ?? 0, discCash: 0, discPromo: 0, note: 'รูดบัตรเต็มจำนวน' },
      { label: 'สด', unitPrice: item.unitPriceCash, discCard: 0, discCash: item.discCash ?? 0, discPromo: 0, note: 'ขายเส้น (ราคาสด)' },
    ];
  }
  return [
    { label: '0%', unitPrice: item.unitPriceZeroPct, discCard: 0, discCash: 0, discPromo: item.discPromo ?? 0, note: '0% 10 เดือน' },
    { label: 'บัตร', unitPrice: item.unitPriceCard, discCard: item.discCard ?? 0, discCash: 0, discPromo: item.discPromo ?? 0, note: 'รูดบัตรเต็มจำนวน' },
    { label: 'สด/โอน', unitPrice: item.unitPriceCash, discCard: 0, discCash: item.discCash ?? 0, discPromo: item.discPromo ?? 0, note: 'เงินสด/เงินโอน' },
  ];
}

const SCROLL_PX_PER_SEC = 80;

// Pink badge for set-pricing items
function SetBadge() {
  return (
    <span style={{
      display: 'inline-block', background: '#fce7f3', color: '#be185d',
      border: '1px solid #fbcfe8', borderRadius: 6, fontSize: '0.72rem',
      fontWeight: 700, padding: '1px 7px', marginLeft: 6, verticalAlign: 'middle',
    }}>
      ชุด 4 เส้น
    </span>
  );
}

// Red badge for non-promo items
function NonPromoBadge() {
  return (
    <span style={{
      display: 'inline-block', background: '#fee2e2', color: '#b91c1c',
      border: '1px solid #fecaca', borderRadius: 6, fontSize: '0.72rem',
      fontWeight: 700, padding: '1px 7px', marginLeft: 6, verticalAlign: 'middle',
    }}>
      Non Promo
    </span>
  );
}

// Blue badge for DOT year
function DotBadge({ year }: { year: string }) {
  return (
    <span style={{
      display: 'inline-block', background: '#eff6ff', color: '#1d4ed8',
      border: '1px solid #bfdbfe', borderRadius: 6, fontSize: '0.72rem',
      fontWeight: 700, padding: '1px 7px', marginLeft: 6, verticalAlign: 'middle',
    }}>
      DOT {year}
    </span>
  );
}

export default function CustomerDisplayPage() {
  const { shopId, staffId } = useParams<{ shopId: string; staffId?: string }>();
  const [images, setImages] = useState<DisplayImage[]>([]);
  const [quotation, setQuotation] = useState<ActiveQuotation | null>(null);
  const [promoText, setPromoText] = useState<string | null>(null);
  const [searchEntries, setSearchEntries] = useState<SearchEntry[] | null>(null);
  const [shopInfo, setShopInfo] = useState<{ name: string; phone?: string; address?: string } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const posRef = useRef(0);

  const stateUrl = staffId
    ? `/api/display/${shopId}/${staffId}/state`
    : `/api/display/${shopId}/state`;
  const searchUrl = staffId
    ? `/api/display/${shopId}/${staffId}/search-results`
    : `/api/display/${shopId}/search-results`;

  // Poll images every 8s
  useEffect(() => {
    const go = () =>
      fetch(`/api/display/${shopId}/images`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: DisplayImage[] | null) => { if (d !== null) setImages(Array.isArray(d) ? d : []); })
        .catch(() => {});
    go();
    const t = setInterval(go, 8000);
    return () => clearInterval(t);
  }, [shopId]);

  // Fetch shop info once on mount
  useEffect(() => {
    fetch(`/api/shops/${shopId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setShopInfo({ name: d.name, phone: d.phone, address: d.address }); })
      .catch(() => {});
  }, [shopId]);

  // Poll display state every 3s — switches between slideshow and quotation view
  useEffect(() => {
    const go = () =>
      fetch(stateUrl)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { mode: string; quotation?: ActiveQuotation; promoText?: string | null } | null) => {
          if (d !== null) {
            setQuotation(d?.mode === 'quotation' ? (d.quotation ?? null) : null);
            setPromoText(d?.promoText ?? null);
          }
        })
        .catch(() => {});
    go();
    const t = setInterval(go, 3000);
    return () => clearInterval(t);
  }, [stateUrl]);

  // Poll search results every 3s (shown when no active quotation)
  useEffect(() => {
    const go = () =>
      fetch(searchUrl)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { results: SearchEntry[] | null } | null) => { if (d !== null) setSearchEntries(d?.results ?? null); })
        .catch(() => {});
    go();
    const t = setInterval(go, 3000);
    return () => clearInterval(t);
  }, [searchUrl]);

  // Continuous horizontal scroll
  useEffect(() => {
    const track = trackRef.current;
    if (!track || images.length === 0) return;
    cancelAnimationFrame(animRef.current);
    posRef.current = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const halfW = track.scrollWidth / 2;
      if (halfW > 0) {
        posRef.current += SCROLL_PX_PER_SEC * dt;
        if (posRef.current >= halfW) posRef.current -= halfW;
        track.style.transform = `translateX(-${posRef.current}px)`;
      }
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, [images]);

  // ─── Base layer: banner scroll ───────────────────────────────────────────
  const bannerLayer = (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      {images.length === 0 ? (
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <span style={{ color: '#fff', fontSize: '4rem', fontWeight: 800, letterSpacing: 2 }}>{shopInfo?.name ?? '—'}</span>
        </div>
      ) : (
        <div ref={trackRef} style={{ display: 'flex', willChange: 'transform' }}>
          {[...images, ...images].map((img, i) => (
            <img key={`${img.id}-${i}`} src={img.url} alt=""
              style={{ height: '100vh', width: 'auto', maxWidth: '100vw', objectFit: 'cover', flexShrink: 0 }} />
          ))}
        </div>
      )}
    </div>
  );

  // ─── Search results overlay ───────────────────────────────────────────────
  const searchLayer = searchEntries && searchEntries.length > 0 && !quotation ? (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.96)',
      display: 'flex', flexDirection: 'column', padding: '2.5rem',
      fontFamily: 'sans-serif',
    }}>
      <p style={{ color: '#94a3b8', fontSize: '1rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: '1.5rem' }}>
        รายการสินค้า
      </p>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.15rem', color: '#f1f5f9' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #334155' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>สินค้า</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8', fontWeight: 600 }}>เงินสด</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8', fontWeight: 600 }}>บัตรเครดิต</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8', fontWeight: 600 }}>0% รูดบัตร</th>
            </tr>
          </thead>
          <tbody>
            {searchEntries.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '14px 16px' }}>
                  <p style={{ fontWeight: 700, fontSize: '1.2rem' }}>
                    {e.product.brand} {e.product.model}
                    {e.product.isSetPricing && <SetBadge />}
                    {e.product.isNonPromo && <NonPromoBadge />}
                    {e.product.dotYear && <DotBadge year={e.product.dotYear} />}
                  </p>
                  <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginTop: 2 }}>{e.product.sizeNormalized}</p>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.3rem', color: '#4ade80', fontWeight: 700 }}>
                  {e.priceCash.toLocaleString()} ฿
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.2rem' }}>
                  {e.priceCard.toLocaleString()} ฿
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.2rem' }}>
                  {e.priceZeroPct.toLocaleString()} ฿
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  const dismissUrl = staffId
    ? `/api/display/${shopId}/${staffId}/active-quotation/dismiss`
    : `/api/display/${shopId}/active-quotation/dismiss`;

  function handleDismiss() {
    fetch(dismissUrl, { method: 'DELETE' }).catch(() => {});
    setQuotation(null);
  }

  // ─── Quotation overlay (highest priority) ────────────────────────────────
  const quotationLayer = quotation ? (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', fontFamily: 'sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '2rem 2.5rem',
        width: '100%', maxWidth: 1000, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)', position: 'relative',
      }}>
        <button
          onClick={handleDismiss}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: '#ef4444', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 16px', fontSize: '0.95rem',
            fontWeight: 700, cursor: 'pointer', zIndex: 10,
          }}
        >
          ✕ ปิด
        </button>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>ใบเสนอราคา</p>
          <p style={{ fontSize: '1.9rem', fontWeight: 900, color: '#111', margin: '2px 0' }}>{shopInfo?.name ?? '—'}</p>
          {shopInfo?.address && <p style={{ fontSize: '1rem', color: '#6b7280', marginBottom: 2 }}>{shopInfo.address}</p>}
          {shopInfo?.phone && <p style={{ fontSize: '0.95rem', color: '#374151' }}>โทร. {shopInfo.phone.split('\n').map((p: string) => p.trim()).filter(Boolean).join(' · ')}</p>}
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'center', gap: '2.5rem', fontSize: '1rem' }}>
            <span style={{ color: '#6b7280' }}>
              วันที่: <strong style={{ color: '#111' }}>{new Date().toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
            </span>
            {quotation.plateNumber && (
              <span style={{ color: '#6b7280' }}>ทะเบียน: <strong style={{ color: '#111' }}>{quotation.plateNumber}</strong></span>
            )}
          </div>
        </div>

        {/* Same table structure as staff QuotationPage — read-only */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              {['No', 'รูป', 'ยี่ห้อ / รุ่น / ขนาด', 'ราคาปกติ', 'ลดยางเก่า', 'ลดบัตร/ลดสด', 'ลดโปรฯ', 'ราคา/เส้น', 'จำนวน', 'รวม(ชุด)', 'วิธีการชำระ'].map((h) => (
                <th key={h} style={{ border: '1px solid #e5e7eb', padding: '8px 10px', textAlign: h === 'No' || h === 'จำนวน' ? 'center' : h === 'ยี่ห้อ / รุ่น / ขนาด' || h === 'วิธีการชำระ' ? 'left' : 'right', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item, idx) => {
              const rows = buildPaymentRows(item);
              const isSet = item.isSetPricing || item.product.isSetPricing;
              const isNonPromo = item.product.isNonPromo;
              return rows.map((row, rowIdx) => (
                <tr key={`${item.id}-${rowIdx}`} style={{ background: row.label === '0%' ? '#fdf2f8' : row.label === 'บัตร' ? '#f0f9ff' : '#f0fdf4' }}>
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 600 }}>
                      {idx + 1}
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle', width: 80 }}>
                      {item.product.imageUrl ? (
                        <img src={item.product.imageUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 6, background: '#f3f4f6', display: 'block', margin: '0 auto' }} />
                      ) : (
                        <div style={{ width: 72, height: 72, background: '#f3f4f6', borderRadius: 6, margin: '0 auto' }} />
                      )}
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '10px 12px', verticalAlign: 'middle' }}>
                      <p style={{ fontWeight: 700, fontSize: '1rem' }}>{item.product.brand} {item.product.model}</p>
                      <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: 2 }}>
                        {item.product.sizeNormalized}
                        {isSet && <SetBadge />}
                        {isNonPromo && <NonPromoBadge />}
                        {item.product.dotYear && <DotBadge year={item.product.dotYear} />}
                      </p>
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle', fontFamily: 'monospace' }}>
                      {(item.priceListed ?? 0).toLocaleString()}
                    </td>
                  )}
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle', fontFamily: 'monospace' }}>
                      {(item.discTradeIn ?? 0) > 0 ? (item.discTradeIn).toLocaleString() : '—'}
                    </td>
                  )}
                  <td style={{ border: '1px solid #e5e7eb', padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {(row.discCard + row.discCash) > 0 ? (row.discCard + row.discCash).toLocaleString() : '—'}
                  </td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {row.discPromo > 0 ? row.discPromo.toLocaleString() : '—'}
                  </td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '1rem' }}>
                    {row.unitPrice.toLocaleString()}
                  </td>
                  {rowIdx === 0 && (
                    <td rowSpan={rows.length} style={{ border: '1px solid #e5e7eb', padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 700, fontSize: '1.1rem' }}>
                      {item.qty}
                    </td>
                  )}
                  <td style={{ border: '1px solid #e5e7eb', padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: rowIdx === rows.length - 1 ? '#15803d' : '#111' }}>
                    {(row.unitPrice * item.qty).toLocaleString()}
                  </td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '6px 10px', color: '#6b7280', fontSize: '0.82rem' }}>{row.note}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>

        {/* Fixed disclaimer + payment icons */}
        <div style={{ marginTop: '1.2rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
          {promoText && (
            <p style={{ color: '#374151', fontSize: '0.85rem', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e5e7eb', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {promoText}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1.5rem' }}>
            <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.8 }}>
              <li>ราคาสินค้า อาจมีการเปลี่ยนแปลงตามโปรโมชั่นต่างๆ</li>
              <li>ราคาตีเทิร์นยางเก่า อาจเปลี่ยนแปลงตามการสึกหรอของยางในวันที่มาเปลี่ยน</li>
              <li>ราคานี้รวมค่าบริการเปลี่ยน จุ๊ป-ถ่วงล้อ-ตั้งศูนย์-ลมไนโตรเจน สำหรับลูกค้าเปลี่ยนยาง 4 เส้นเท่านั้น</li>
            </ol>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              <img src="/payment-icons/krungsri.png" alt="krungsri" style={{ height: 36, width: 'auto', objectFit: 'contain', borderRadius: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <img src="/payment-icons/aeon.png" alt="aeon" style={{ height: 36, width: 'auto', objectFit: 'contain', borderRadius: 6 }} />
                <img src="/payment-icons/ktc.png" alt="ktc" style={{ height: 36, width: 'auto', objectFit: 'contain', borderRadius: 6 }} />
              </div>
              <img src="/payment-icons/kbank-smartpay.png" alt="kbank-smartpay" style={{ height: 36, width: 'auto', objectFit: 'contain', borderRadius: 6 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {bannerLayer}
      {searchLayer}
      {quotationLayer}
    </div>
  );
}
