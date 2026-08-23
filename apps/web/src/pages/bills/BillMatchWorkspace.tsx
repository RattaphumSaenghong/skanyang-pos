import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import {
  BatchDetail,
  Bill,
  DraftLine,
  PoolItem,
  ServiceFee,
  Suggestion,
  itemLabel,
} from './types';

/**
 * Matching as a two-panel workbench: what was sold on the left, the bills on the
 * right, one bill open at a time.
 *
 * The engine used to just do this and hand back an answer. What the shop actually
 * needs is help — they know which customer bought what, so they drive and the
 * engine offers. Auto-match is still here as a first pass, but a bill the
 * operator saves by hand is locked so the next run can't overwrite it.
 */

interface Props {
  batchId: string;
  batch: BatchDetail;
  shopId: string;
}

const toDraft = (lines: Bill['lines']): DraftLine[] =>
  lines.map((l) => ({
    kind: l.kind,
    poolItemId: l.poolItemId,
    serviceFeeId: l.serviceFeeId ?? null,
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
  }));

/**
 * The real stock sheet runs to 1,250 SKUs, and with no recorded quantities there
 * is nothing to narrow it down — so the list is capped and the search box does
 * the rest rather than mounting every row.
 */
const POOL_RENDER_CAP = 200;

const LINE_STYLE: Record<DraftLine['kind'], string> = {
  ITEM: 'bg-blue-50 text-blue-900',
  SERVICE: 'bg-emerald-50 text-emerald-900',
  FREEFORM: 'bg-red-50 text-red-800',
};

export default function BillMatchWorkspace({ batchId, batch, shopId }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [openBillId, setOpenBillId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [onlyRemaining, setOnlyRemaining] = useState(true);
  const [sortBySeq, setSortBySeq] = useState(false);

  const openBill = batch.bills.find((b) => b.id === openBillId) ?? null;

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalSold = batch.poolItems.reduce((s, i) => s + i.soldQty, 0);
  const totalMatched = batch.poolItems.reduce((s, i) => s + i.matchedQty, 0);

  /**
   * A stock sheet imported with ขายรวม blank carries soldQty 0 everywhere. Zero
   * there means "not recorded", so there is no remaining count to show and no
   * ceiling to enforce — every SKU stays pickable. The server agrees; see
   * hasNoSoldQuantities.
   */
  const unconstrained = totalSold === 0;
  /**
   * Units still free per SKU, live against the draft.
   *
   * `matchedQty` already counts the open bill's saved lines, so those are handed
   * back before the draft's own usage is taken off — otherwise reopening a bill
   * would show its own stock as spoken for.
   */
  const remaining = useMemo(() => {
    const left = new Map<string, number>();
    for (const item of batch.poolItems) {
      left.set(item.id, item.soldQty - item.matchedQty);
    }
    if (openBill) {
      for (const l of openBill.lines) {
        if (l.poolItemId) {
          left.set(l.poolItemId, (left.get(l.poolItemId) ?? 0) + l.qty);
        }
      }
      for (const l of draft) {
        if (l.poolItemId) {
          left.set(l.poolItemId, (left.get(l.poolItemId) ?? 0) - l.qty);
        }
      }
    }
    return left;
  }, [batch.poolItems, openBill, draft]);

  const draftTotal = draft.reduce((s, l) => s + l.lineTotal, 0);
  const gap = openBill ? openBill.amount - draftTotal : 0;

  /**
   * Items the open draft is using. Exempt from the "still remaining" filter, or
   * taking the last unit of a SKU would make it vanish from under the operator's
   * cursor mid-edit. Dimmed at 0 left says "you have all of these" far better
   * than the row disappearing.
   */
  const inDraft = useMemo(
    () =>
      new Set(
        draft.filter((l) => l.poolItemId).map((l) => l.poolItemId as string),
      ),
    [draft],
  );

  const filteredPool = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    return batch.poolItems.filter((item) => {
      // Without recorded quantities every item reads as 0 left, so this filter
      // would empty the panel and hide the whole catalogue.
      if (
        !unconstrained &&
        onlyRemaining &&
        !inDraft.has(item.id) &&
        (remaining.get(item.id) ?? 0) <= 0
      )
        return false;
      if (!q) return true;
      return itemLabel(item).toLowerCase().includes(q);
    });
  }, [
    batch.poolItems,
    itemQuery,
    onlyRemaining,
    remaining,
    unconstrained,
    inDraft,
  ]);

  const sortedBills = useMemo(() => {
    const bills = [...batch.bills];
    if (sortBySeq) return bills.sort((a, b) => a.seq - b.seq);
    // Worst first: bills leaning on a free-form line, then unmatched, then rest.
    const freeformOf = (b: Bill) =>
      b.lines
        .filter((l) => l.kind === 'FREEFORM')
        .reduce((s, l) => s + l.lineTotal, 0);
    return bills.sort(
      (a, b) =>
        freeformOf(b) - freeformOf(a) ||
        Number(a.status !== 'UNMATCHED') - Number(b.status !== 'UNMATCHED') ||
        a.seq - b.seq,
    );
  }, [batch.bills, sortBySeq]);

  // ── Server calls ───────────────────────────────────────────────────────────
  const { data: suggestData, isFetching: loadingSuggestions } = useQuery<{
    suggestions: Suggestion[];
  }>({
    queryKey: ['bill-suggestions', batchId, openBillId],
    queryFn: () =>
      api
        .get(
          `/bill-batches/${batchId}/bills/${openBillId}/suggestions?shopId=${shopId}`,
        )
        .then((r) => r.data),
    enabled: !!openBillId,
  });

  const { data: serviceFees = [] } = useQuery<ServiceFee[]>({
    queryKey: ['service-fees', shopId],
    queryFn: () =>
      api.get(`/service-fees?shopId=${shopId}`).then((r) => r.data),
  });
  const activeFees = useMemo(
    () =>
      serviceFees
        .filter((f) => f.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [serviceFees],
  );

  const invalidateBatch = () => {
    qc.invalidateQueries({ queryKey: ['bill-batch', batchId] });
    qc.invalidateQueries({ queryKey: ['bill-suggestions', batchId] });
  };

  const runMatch = useMutation({
    mutationFn: () =>
      api
        .post(`/bill-batches/${batchId}/match?shopId=${shopId}`, {
          timeBudgetMs: 3000,
        })
        .then((r) => r.data),
    onSuccess: invalidateBatch,
  });

  const fillGap = useMutation({
    mutationFn: () =>
      api
        .post(
          `/bill-batches/${batchId}/bills/${openBillId}/close-gap?shopId=${shopId}`,
          { lines: draft },
        )
        .then((r) => r.data as { gap: number; lines: DraftLine[] }),
    onSuccess: (data) => {
      if (data.lines.length) {
        setDraft((d) => [...d, ...data.lines]);
      } else if (data.gap > 0) {
        // No combination of fee ranges reaches this figure, so it has to sit on
        // a bare ค่าบริการ line — which is exactly what the operator should see.
        setDraft((d) => [
          ...d,
          {
            kind: 'FREEFORM',
            description: 'ค่าบริการ',
            qty: 1,
            unitPrice: data.gap,
            lineTotal: data.gap,
          },
        ]);
      }
    },
  });

  const saveBill = useMutation({
    mutationFn: () =>
      api
        .patch(
          `/bill-batches/${batchId}/bills/${openBillId}?shopId=${shopId}`,
          {
            lines: draft,
            // Hand-matched bills are locked, or the next auto-match run would
            // delete these lines and reassign the stock.
            locked: true,
          },
        )
        .then((r) => r.data),
    onSuccess: () => {
      invalidateBatch();
      setOpenBillId(null);
      setDraft([]);
    },
  });

  const exportBatch = useMutation({
    mutationFn: async () => {
      const res = await api.get(
        `/bill-batches/${batchId}/export?shopId=${shopId}`,
        { responseType: 'blob' },
      );
      // Named from the batch rather than parsed out of Content-Disposition —
      // the label is already here and survives the Thai characters intact.
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${batch.label}.xlsx`;
      // Attached before clicking, and revoked a tick later: Firefox ignores a
      // click on an anchor that is not in the document, and revoking the url in
      // the same tick can pull it out from under a download that has not
      // started yet. Chrome forgives both, so this fails on one browser only.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });

  const toggleLock = useMutation({
    mutationFn: (bill: Bill) =>
      api
        .patch(`/bill-batches/${batchId}/bills/${bill.id}?shopId=${shopId}`, {
          locked: !bill.locked,
        })
        .then((r) => r.data),
    onSuccess: invalidateBatch,
  });

  // ── Draft edits ────────────────────────────────────────────────────────────
  const open = (bill: Bill) => {
    if (bill.id === openBillId) {
      setOpenBillId(null);
      setDraft([]);
      return;
    }
    setOpenBillId(bill.id);
    setDraft(toDraft(bill.lines));
    saveBill.reset();
  };

  const addItem = (item: PoolItem) => {
    if (!openBill) return;
    if (!unconstrained && (remaining.get(item.id) ?? 0) <= 0) return;
    setDraft((d) => {
      const at = d.findIndex(
        (l) => l.kind === 'ITEM' && l.poolItemId === item.id,
      );
      if (at >= 0) {
        const next = [...d];
        const qty = next[at].qty + 1;
        next[at] = { ...next[at], qty, lineTotal: qty * next[at].unitPrice };
        return next;
      }
      return [
        ...d,
        {
          kind: 'ITEM',
          poolItemId: item.id,
          description: itemLabel(item),
          qty: 1,
          unitPrice: item.unitPrice,
          lineTotal: item.unitPrice,
        },
      ];
    });
  };

  /** Services aren't stock, so there's no shared ceiling — just the fee's own maxQty. */
  const addService = (fee: ServiceFee) => {
    if (!openBill) return;
    setDraft((d) => {
      const at = d.findIndex(
        (l) => l.kind === 'SERVICE' && l.serviceFeeId === fee.id,
      );
      if (at >= 0) {
        if (d[at].qty >= fee.maxQty) return d;
        const next = [...d];
        const qty = next[at].qty + 1;
        next[at] = { ...next[at], qty, lineTotal: qty * next[at].unitPrice };
        return next;
      }
      return [
        ...d,
        {
          kind: 'SERVICE',
          serviceFeeId: fee.id,
          description: fee.name,
          qty: 1,
          unitPrice: fee.minPrice,
          lineTotal: fee.minPrice,
        },
      ];
    });
  };

  const setQty = (idx: number, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1) return;
    setDraft((d) => {
      const line = d[idx];
      // Clamp to what's actually free, or the save would come back rejected —
      // `remaining` already has this line's own units taken off. No recorded
      // quantities means no ceiling to clamp to.
      const ceiling =
        line.poolItemId && !unconstrained
          ? line.qty + (remaining.get(line.poolItemId) ?? 0)
          : qty;
      const next = Math.min(qty, Math.max(1, ceiling));
      return d.map((l, i) =>
        i === idx ? { ...l, qty: next, lineTotal: next * l.unitPrice } : l,
      );
    });
  };

  const removeLine = (idx: number) =>
    setDraft((d) => d.filter((_, i) => i !== idx));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={() => runMatch.mutate()}
          disabled={runMatch.isPending}
          className="border border-blue-600 text-blue-600 px-3 py-1.5 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50"
        >
          {runMatch.isPending ? 'กำลังจับคู่...' : 'จับคู่อัตโนมัติทั้งชุด'}
        </button>
        <button
          onClick={() => exportBatch.mutate()}
          disabled={exportBatch.isPending}
          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {exportBatch.isPending ? 'กำลังสร้างไฟล์...' : 'ส่งออก Excel'}
        </button>
        <span className="text-xs text-gray-500">
          เป็นตัวช่วยตั้งต้น · บิลที่ล็อกไว้จะไม่ถูกแก้
        </span>
        {exportBatch.isError && (
          <span className="text-xs text-red-600">ส่งออกไม่สำเร็จ</span>
        )}
        <label className="flex items-center gap-2 text-sm ml-auto">
          <input
            type="checkbox"
            checked={sortBySeq}
            onChange={(e) => setSortBySeq(e.target.checked)}
          />
          จัดเรียงตามลำดับ
        </label>
      </div>

      <div className="grid lg:grid-cols-5 gap-4 items-start">
        {/* ── Left: what was sold, and the services that can go with it ── */}
        <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-4">
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">สินค้าที่ขาย</p>
                {unconstrained ? (
                  <p className="text-xs text-gray-500">
                    {batch.poolItems.length.toLocaleString()} รายการในสต็อก
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">
                    จับคู่แล้ว {totalMatched.toLocaleString()} /{' '}
                    {totalSold.toLocaleString()} ชิ้น
                  </p>
                )}
              </div>
              {unconstrained && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  ไฟล์สต็อกนี้ไม่ได้กรอกคอลัมน์ ขายรวม (I)
                  ระบบจึงไม่จำกัดจำนวนต่อรายการ — เลือกสินค้าได้ทุกตัว
                </p>
              )}
              <input
                type="text"
                placeholder="ค้นหาสินค้า..."
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex items-center justify-between">
                {unconstrained ? (
                  <span />
                ) : (
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={onlyRemaining}
                      onChange={(e) => setOnlyRemaining(e.target.checked)}
                    />
                    เฉพาะที่ยังเหลือ
                  </label>
                )}
                <p className="text-xs text-gray-400">
                  {filteredPool.length} รายการ
                </p>
              </div>
              <p className="text-xs text-gray-500">
                {openBill
                  ? `กดสินค้าเพื่อใส่ในบิล ${String(openBill.seq).padStart(3, '0')}`
                  : 'เลือกบิลด้านขวาก่อน แล้วกดสินค้าเพื่อใส่ในบิล'}
              </p>
            </div>

            <div className="max-h-[60vh] overflow-y-auto divide-y">
              {filteredPool.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  ไม่มีรายการ
                </p>
              ) : (
                filteredPool.slice(0, POOL_RENDER_CAP).map((item) => {
                  const left = remaining.get(item.id) ?? 0;
                  const pickable = !!openBill && (unconstrained || left > 0);
                  const dim = !unconstrained && left <= 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => addItem(item)}
                      disabled={!pickable}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 ${
                        pickable
                          ? 'hover:bg-blue-50 cursor-pointer'
                          : 'cursor-default'
                      } ${dim ? 'opacity-40' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{itemLabel(item)}</p>
                        <p className="text-xs text-gray-500">
                          {item.unitPrice.toLocaleString()} ฿/ชิ้น
                        </p>
                      </div>
                      {!unconstrained && (
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded whitespace-nowrap ${
                            left > 0
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          เหลือ {left} / {item.soldQty}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
              {filteredPool.length > POOL_RENDER_CAP && (
                <p className="text-xs text-gray-500 text-center py-3">
                  แสดง {POOL_RENDER_CAP} จาก{' '}
                  {filteredPool.length.toLocaleString()} รายการ — ใช้ช่องค้นหา
                </p>
              )}
            </div>
          </div>

          {/* ── Services: not stock, so no remaining count — just the fee's own maxQty ── */}
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
              <p className="font-medium">บริการ</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {openBill
                  ? `กดบริการเพื่อใส่ในบิล ${String(openBill.seq).padStart(3, '0')}`
                  : 'เลือกบิลด้านขวาก่อน แล้วกดบริการเพื่อใส่ในบิล'}
              </p>
            </div>
            <div className="divide-y">
              {activeFees.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  ไม่มีบริการ
                </p>
              ) : (
                activeFees.map((fee) => {
                  const qtyInDraft =
                    draft.find(
                      (l) => l.kind === 'SERVICE' && l.serviceFeeId === fee.id,
                    )?.qty ?? 0;
                  const pickable = !!openBill && qtyInDraft < fee.maxQty;
                  return (
                    <button
                      key={fee.id}
                      onClick={() => addService(fee)}
                      disabled={!pickable}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 ${
                        pickable
                          ? 'hover:bg-emerald-50 cursor-pointer'
                          : 'cursor-default'
                      } ${qtyInDraft >= fee.maxQty ? 'opacity-40' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{fee.name}</p>
                        <p className="text-xs text-gray-500">
                          {fee.minPrice === fee.maxPrice
                            ? `${fee.minPrice.toLocaleString()} ฿`
                            : `${fee.minPrice.toLocaleString()}–${fee.maxPrice.toLocaleString()} ฿`}
                        </p>
                      </div>
                      {qtyInDraft > 0 && (
                        <span className="text-xs font-medium px-2 py-1 rounded whitespace-nowrap bg-emerald-100 text-emerald-800">
                          ใส่แล้ว ×{qtyInDraft}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Right: bills ── */}
        <div className="lg:col-span-3 bg-white rounded-xl border divide-y">
          <div className="p-4 flex items-baseline justify-between">
            <p className="font-medium">บิล</p>
            <p className="text-xs text-gray-500">
              {batch.bills.length.toLocaleString()} ใบ
            </p>
          </div>

          {sortedBills.map((bill) => {
            const isOpen = bill.id === openBillId;
            const freeform = bill.lines
              .filter((l) => l.kind === 'FREEFORM')
              .reduce((s, l) => s + l.lineTotal, 0);
            return (
              <div key={bill.id}>
                <button
                  onClick={() => open(bill)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 ${
                    isOpen ? 'bg-blue-50' : bill.locked ? 'bg-yellow-50' : ''
                  }`}
                >
                  <span className="text-gray-400 text-xs w-3">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span className="font-medium text-sm w-10">
                    {String(bill.seq).padStart(3, '0')}
                  </span>
                  <span className="text-xs text-gray-500 w-24">
                    {bill.billDate
                      ? new Date(bill.billDate).toLocaleDateString('th-TH')
                      : '—'}
                  </span>
                  <span className="text-sm font-medium flex-1 text-right">
                    {bill.amount.toLocaleString()} ฿
                  </span>
                  {bill.lines.length === 0 ? (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded whitespace-nowrap">
                      ยังไม่จับคู่
                    </span>
                  ) : freeform > 0 ? (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded whitespace-nowrap">
                      ค่าบริการ {freeform.toLocaleString()} ฿
                    </span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded whitespace-nowrap">
                      ครบ
                    </span>
                  )}
                  <span className="text-base w-6 text-center">
                    {bill.locked ? '🔒' : ''}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-blue-50/40 space-y-4">
                    {/* Draft lines */}
                    <div className="space-y-1">
                      {draft.length === 0 ? (
                        <p className="text-sm text-gray-500 py-3">
                          ยังไม่มีรายการ — กดสินค้าจากด้านซ้าย
                          หรือเลือกข้อเสนอด้านล่าง
                        </p>
                      ) : (
                        draft.map((line, i) => (
                          <div
                            key={i}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${LINE_STYLE[line.kind]}`}
                          >
                            <span className="flex-1 truncate">
                              {line.description}
                            </span>
                            {line.kind === 'ITEM' ? (
                              <input
                                type="number"
                                min="1"
                                value={line.qty}
                                onChange={(e) =>
                                  setQty(i, Number(e.target.value))
                                }
                                className="w-14 border rounded px-2 py-0.5 text-sm text-right bg-white"
                              />
                            ) : (
                              <span className="w-14 text-right">
                                ×{line.qty}
                              </span>
                            )}
                            <span className="w-20 text-right text-xs">
                              @{line.unitPrice.toLocaleString()}
                            </span>
                            <span className="w-24 text-right font-medium">
                              {line.lineTotal.toLocaleString()}
                            </span>
                            <button
                              onClick={() => removeLine(i)}
                              className="text-gray-400 hover:text-red-600 px-1"
                              title="ลบรายการ"
                            >
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Gap + actions */}
                    <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                      <div className="text-sm">
                        <span className="text-gray-500">รวม </span>
                        <span className="font-medium">
                          {draftTotal.toLocaleString()}
                        </span>
                        <span className="text-gray-400">
                          {' '}
                          / {bill.amount.toLocaleString()} ฿
                        </span>
                      </div>
                      {gap === 0 ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-medium">
                          ตรงยอด
                        </span>
                      ) : gap > 0 ? (
                        <>
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-medium">
                            ขาด {gap.toLocaleString()} ฿
                          </span>
                          <button
                            onClick={() => fillGap.mutate()}
                            disabled={fillGap.isPending}
                            className="border border-emerald-600 text-emerald-700 px-3 py-1 rounded-lg text-xs hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {fillGap.isPending
                              ? 'กำลังคำนวณ...'
                              : 'ปิดส่วนต่างด้วยค่าบริการ'}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-medium">
                          เกินยอด {Math.abs(gap).toLocaleString()} ฿
                        </span>
                      )}

                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() =>
                            navigate(`/bills/${batchId}/print/${bill.id}`)
                          }
                          className="text-xs text-blue-600 hover:underline px-2"
                        >
                          พิมพ์
                        </button>
                        <button
                          onClick={() => toggleLock.mutate(bill)}
                          disabled={toggleLock.isPending}
                          className="text-xs text-gray-600 hover:underline px-2"
                        >
                          {bill.locked ? 'ปลดล็อก' : 'ล็อก'}
                        </button>
                        <button
                          onClick={() => {
                            setOpenBillId(null);
                            setDraft([]);
                          }}
                          className="text-xs text-gray-600 px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                        >
                          ยกเลิก
                        </button>
                        <button
                          onClick={() => saveBill.mutate()}
                          disabled={saveBill.isPending}
                          className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs disabled:opacity-50"
                        >
                          {saveBill.isPending
                            ? 'กำลังบันทึก...'
                            : 'บันทึกและล็อก'}
                        </button>
                      </div>
                    </div>

                    {saveBill.isError && (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                        {(saveBill.error as any)?.response?.data?.message ??
                          'บันทึกไม่สำเร็จ'}
                      </p>
                    )}

                    {/* Suggestions */}
                    <div className="border-t pt-3">
                      <p className="text-xs font-medium text-gray-600 mb-2">
                        ข้อเสนอจากระบบ
                        {loadingSuggestions && ' · กำลังคำนวณ...'}
                      </p>
                      {!loadingSuggestions &&
                      !suggestData?.suggestions?.length ? (
                        <p className="text-xs text-gray-400">
                          ไม่มีข้อเสนอสำหรับยอดนี้
                        </p>
                      ) : (
                        <div className="grid gap-2">
                          {(suggestData?.suggestions ?? []).map((s, si) => (
                            <button
                              key={si}
                              onClick={() => setDraft(s.lines)}
                              className="text-left border rounded-lg p-2.5 bg-white hover:border-blue-500 hover:bg-blue-50"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-gray-500">
                                  ตัวเลือก {si + 1}
                                </span>
                                {s.freeform === 0 ? (
                                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                    ครบทุกบรรทัด
                                  </span>
                                ) : (
                                  <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                    ค่าบริการ {s.freeform.toLocaleString()} ฿
                                  </span>
                                )}
                                <span className="text-xs text-gray-400">
                                  ใช้สต็อก {s.units} ชิ้น
                                </span>
                              </div>
                              <div className="text-xs text-gray-700 space-y-0.5">
                                {s.lines.map((l, li) => (
                                  <div key={li} className="flex gap-2">
                                    <span className="flex-1 truncate">
                                      {l.description} ×{l.qty}
                                    </span>
                                    <span className="text-gray-500">
                                      {l.lineTotal.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
