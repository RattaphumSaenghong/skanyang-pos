import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Service {
  name: string;
  minutes: number;
}

interface CurrentJob {
  id: string;
  plateNumber: string;
  customerName: string | null;
  services: Service[];
  startedAt: string;
  estimatedMinutes: number;
  estimatedFinish: string;
  overdueMinutes: number;
}

interface Bay {
  id: string;
  name: string;
  mode: 'GENERAL' | 'BOOKING_ONLY';
  active: boolean;
  sortOrder: number;
  currentJob: CurrentJob | null;
}

interface WaitingJob {
  id: string;
  kind: 'WALK_IN' | 'BOOKING';
  plateNumber: string;
  customerName: string | null;
  services: Service[];
  estimatedMinutes: number;
  queuedAt: string | null;
  scheduledAt: string | null;
  waitingMinutes: number;
  suggestedBayId: string | null;
}

interface Booking {
  id: string;
  plateNumber: string;
  customerName: string | null;
  scheduledAt: string;
  bayId: string | null;
  status: string;
  estimatedMinutes: number;
}

interface BoardResponse {
  now: string;
  bays: Bay[];
  waiting: WaitingJob[];
  bookingsToday: Booking[];
}

interface CatalogService {
  id: string;
  name: string;
  estimatedMinutes: number;
  requiresBay: boolean;
  active: boolean;
  sortOrder: number;
}

type ModalMode = 'WALK_IN' | 'BOOKING' | null;
type SelectedService = { serviceId?: string; name: string; minutes: number };

// ── Shared helpers ─────────────────────────────────────────────────────────────

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

// datetime-local wants local wall-clock time, not UTC.
const toDatetimeLocal = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const localDateString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const errMessage = (err: any) => err?.response?.data?.message ?? 'เกิดข้อผิดพลาด';

// Ticks on its own second-by-second — board.now only updates on the 5s poll,
// which reads as a stalled clock to anyone watching it on the shop floor.
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-2xl font-bold tabular-nums text-gray-800">
      {now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

// ── Bay card ───────────────────────────────────────────────────────────────────

function BayCard({
  bay,
  now,
  orientation,
  onComplete,
}: {
  bay: Bay;
  now: string;
  orientation: 'portrait' | 'landscape';
  onComplete: (jobId: string) => void;
}) {
  const job = bay.currentJob;
  const overdue = (job?.overdueMinutes ?? 0) > 0;
  const isPortrait = orientation === 'portrait';

  const accent = !bay.active
    ? 'border-gray-200 bg-gray-50'
    : overdue
      ? 'border-red-300 bg-red-50/40'
      : job
        ? 'border-gray-300 bg-white'
        : 'border-gray-300 bg-white';

  let remaining = 0;
  let elapsedPct = 0;
  if (job) {
    const total = job.estimatedMinutes * 60_000;
    const elapsed = new Date(now).getTime() - new Date(job.startedAt).getTime();
    elapsedPct = Math.max(0, Math.min(100, (elapsed / total) * 100));
    remaining = Math.max(0, Math.ceil((total - elapsed) / 60_000));
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-gray-700">{bay.name}</span>
      {bay.mode === 'BOOKING_ONLY' && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          จองเท่านั้น
        </span>
      )}
    </div>
  );

  if (!bay.active) {
    return (
      <div className={`flex h-full flex-col rounded-2xl border-2 p-4 ${accent}`}>
        {header}
        <div className="flex flex-1 items-center justify-center py-6">
          <span className="text-sm text-gray-400">ปิดใช้งาน</span>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className={`flex h-full flex-col rounded-2xl border-2 p-4 ${accent}`}>
        {header}
        <div className="flex flex-1 items-center justify-center py-8">
          <span className="text-xl font-medium tracking-wide text-gray-300">ว่าง</span>
        </div>
      </div>
    );
  }

  const plateBlock = (
    <div className="min-w-0">
      <p className="truncate text-2xl font-bold leading-tight text-gray-900">
        {job.plateNumber}
      </p>
      {job.customerName && (
        <p className="truncate text-xs text-gray-500">{job.customerName}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {job.services.map((s, i) => (
          <span
            key={i}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600"
          >
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );

  const progressBlock = (
    <div className={isPortrait ? 'mt-auto pt-3' : 'flex w-40 shrink-0 flex-col justify-center'}>
      <div className="mb-1 flex items-baseline justify-between">
        <span
          className={`text-sm font-semibold tabular-nums ${overdue ? 'text-red-600' : 'text-gray-800'}`}
        >
          {overdue ? `เกิน ${job.overdueMinutes} นาที` : `เหลือ ${remaining} นาที`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all ${overdue ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${overdue ? 100 : elapsedPct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-400 tabular-nums">
        เสร็จ ~{timeOf(job.estimatedFinish)}
      </p>
      <button
        onClick={() => onComplete(job.id)}
        className="mt-3 w-full rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700"
      >
        เสร็จสิ้น
      </button>
    </div>
  );

  return (
    <div className={`flex h-full flex-col rounded-2xl border-2 p-4 ${accent}`}>
      {header}
      {isPortrait ? (
        <div className="mt-3 flex flex-1 flex-col">
          {plateBlock}
          {progressBlock}
        </div>
      ) : (
        <div className="mt-3 flex flex-1 items-stretch gap-4">
          <div className="flex flex-1 items-center">{plateBlock}</div>
          {progressBlock}
        </div>
      )}
    </div>
  );
}

// ── Add / book modal ───────────────────────────────────────────────────────────

function AddJobModal({
  mode,
  onClose,
  bays,
  onSubmit,
  isPending,
  error,
}: {
  mode: ModalMode;
  onClose: () => void;
  bays: Bay[];
  onSubmit: (data: any) => void;
  isPending: boolean;
  error: string | null;
}) {
  const shopId = useAuthStore((s) => s.effectiveShopId());
  const [form, setForm] = useState({
    plateNumber: '',
    customerName: '',
    phone: '',
    vehicleModel: '',
    note: '',
    scheduledAt: '',
    bayId: '',
  });
  const [picked, setPicked] = useState<SelectedService[]>([]);
  const [adHocName, setAdHocName] = useState('');
  const [adHocMinutes, setAdHocMinutes] = useState('');

  const { data: catalog = [] } = useQuery<CatalogService[]>({
    queryKey: ['service-catalog', shopId],
    queryFn: () =>
      api
        .get('/service-catalog', { params: shopId ? { shopId } : undefined })
        .then((r) => r.data),
  });

  const isPicked = (id: string) => picked.some((s) => s.serviceId === id);

  const toggle = (svc: CatalogService) =>
    setPicked((p) =>
      isPicked(svc.id)
        ? p.filter((s) => s.serviceId !== svc.id)
        : // Keep name and minutes for the running total; the API re-reads them
          // from the Service row anyway.
          [...p, { serviceId: svc.id, name: svc.name, minutes: svc.estimatedMinutes }],
    );

  const addAdHoc = () => {
    const minutes = parseInt(adHocMinutes, 10);
    if (!adHocName.trim() || !Number.isFinite(minutes) || minutes < 1) return;
    setPicked((p) => [...p, { name: adHocName.trim(), minutes }]);
    setAdHocName('');
    setAdHocMinutes('');
  };

  const total = picked.reduce((sum, s) => sum + s.minutes, 0);
  const bookingIncomplete = mode === 'BOOKING' && (!form.scheduledAt || !form.bayId);
  const canSubmit = !!form.plateNumber.trim() && picked.length > 0 && !bookingIncomplete;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      kind: mode,
      plateNumber: form.plateNumber.trim(),
      customerName: form.customerName || undefined,
      phone: form.phone || undefined,
      vehicleModel: form.vehicleModel || undefined,
      note: form.note || undefined,
      services: picked,
      ...(mode === 'BOOKING'
        ? {
            // The picker is browser-local; the API stores a real UTC instant.
            scheduledAt: new Date(form.scheduledAt).toISOString(),
            bayId: form.bayId,
          }
        : {}),
    });
  };

  const field = (
    label: string,
    key: 'plateNumber' | 'customerName' | 'phone' | 'vehicleModel',
    placeholder: string,
  ) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        className="w-full rounded-lg border px-3 py-2 text-sm"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6">
        <h3 className="mb-4 text-lg font-bold">
          {mode === 'WALK_IN' ? 'เพิ่มคิวหน้าร้าน' : 'จองคิว'}
        </h3>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {field('ทะเบียนรถ *', 'plateNumber', 'เช่น กท 1234')}
          {field('ชื่อลูกค้า', 'customerName', 'ไม่บังคับ')}
          {field('เบอร์โทรศัพท์', 'phone', 'ไม่บังคับ')}
          {field('รุ่นรถ', 'vehicleModel', 'ไม่บังคับ')}
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">หมายเหตุ</label>
          <textarea
            rows={2}
            className="w-full resize-none rounded-lg border px-3 py-2 text-sm"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="ไม่บังคับ"
          />
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-xs font-medium text-gray-600">บริการ *</label>
          {catalog.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              ยังไม่มีบริการในระบบ — เพิ่มได้ที่ ตั้งค่าช่อง → บริการ
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {catalog.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => toggle(svc)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isPicked(svc.id)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {svc.name}
                  <span className="ml-1 opacity-60">{svc.estimatedMinutes}′</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              placeholder="บริการอื่นๆ"
              value={adHocName}
              onChange={(e) => setAdHocName(e.target.value)}
            />
            <input
              type="number"
              min="1"
              className="w-20 rounded-lg border px-3 py-2 text-sm"
              placeholder="นาที"
              value={adHocMinutes}
              onChange={(e) => setAdHocMinutes(e.target.value)}
            />
            <button
              onClick={addAdHoc}
              className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
            >
              เพิ่ม
            </button>
          </div>

          {picked.length > 0 && (
            <div className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2">
              {picked.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs"
                >
                  <span>
                    {s.name} · {s.minutes} นาที
                  </span>
                  <button
                    onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}
                    className="text-red-500 hover:text-red-700"
                  >
                    ลบ
                  </button>
                </div>
              ))}
              <p className="border-t pt-1 text-right text-sm font-semibold tabular-nums">
                รวม {total} นาที
              </p>
            </div>
          )}
        </div>

        {mode === 'BOOKING' && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">เวลาจอง *</label>
              <input
                type="datetime-local"
                step={900}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">ช่องบริการ *</label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.bayId}
                onChange={(e) => setForm((f) => ({ ...f, bayId: e.target.value }))}
              >
                <option value="">-- เลือกช่อง --</option>
                {bays
                  .filter((b) => b.active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        <div className="mt-5 flex gap-2 border-t pt-4">
          <button
            onClick={submit}
            disabled={!canSubmit || isPending}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border px-4 py-2 text-sm text-gray-600 disabled:opacity-40"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BayBoardPage() {
  const qc = useQueryClient();
  // A super-OWNER's token has shopId null and it picks a shop from the header
  // dropdown, so every call has to name the shop.
  const shopId = useAuthStore((s) => s.effectiveShopId());
  const scope = shopId ? { shopId } : undefined;
  const boardKey = ['bay-board', shopId];

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [bookingDate, setBookingDate] = useState(() => localDateString(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [editScheduledAt, setEditScheduledAt] = useState('');

  const {
    data: board,
    isLoading,
    error: boardError,
  } = useQuery<BoardResponse>({
    queryKey: boardKey,
    queryFn: () => api.get('/bays/board', { params: scope }).then((r) => r.data),
    refetchInterval: 5000,
    staleTime: 0,
  });

  const bookingsKey = ['bay-bookings', bookingDate, shopId];
  const { data: bookings = [] } = useQuery<Booking[]>({
    queryKey: bookingsKey,
    queryFn: () =>
      api
        .get('/bay-jobs/bookings', { params: { date: bookingDate, ...scope } })
        .then((r) => r.data),
  });

  // Board mutations below apply their change to the cache immediately and roll
  // back on failure. Rollback is what makes this safe: two staff can both click
  // the same free bay, and the loser's card snaps back with the Thai 409
  // ("ช่องนี้มีรถอยู่แล้ว") explaining why.

  const createJob = useMutation({
    mutationFn: (data: any) => api.post('/bay-jobs', { ...data, ...scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bay-board'] });
      qc.invalidateQueries({ queryKey: ['bay-bookings'] });
      setModalMode(null);
      setError(null);
    },
    onError: (err: any) => setError(errMessage(err)),
  });

  const assignJob = useMutation({
    mutationFn: ({ jobId, bayId }: { jobId: string; bayId: string }) =>
      api.post(`/bay-jobs/${jobId}/assign`, { bayId }, { params: scope }),
    onMutate: async ({ jobId, bayId }: { jobId: string; bayId: string }) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const prev = qc.getQueryData<BoardResponse>(boardKey);
      if (prev) {
        const job = prev.waiting.find((w) => w.id === jobId);
        if (job) {
          const startedAt = new Date();
          qc.setQueryData<BoardResponse>(boardKey, {
            ...prev,
            waiting: prev.waiting.filter((w) => w.id !== jobId),
            bays: prev.bays.map((b) =>
              b.id === bayId
                ? {
                    ...b,
                    currentJob: {
                      id: job.id,
                      plateNumber: job.plateNumber,
                      customerName: job.customerName,
                      services: job.services,
                      startedAt: startedAt.toISOString(),
                      estimatedMinutes: job.estimatedMinutes,
                      estimatedFinish: new Date(
                        startedAt.getTime() + job.estimatedMinutes * 60_000,
                      ).toISOString(),
                      overdueMinutes: 0,
                    },
                  }
                : b,
            ),
          });
        }
      }
      setError(null);
      return { prev };
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);
      setError(errMessage(err));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['bay-board'] }),
  });

  const completeJob = useMutation({
    mutationFn: (jobId: string) =>
      api.post(`/bay-jobs/${jobId}/complete`, {}, { params: scope }),
    onMutate: async (jobId: string) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const prev = qc.getQueryData<BoardResponse>(boardKey);
      if (prev) {
        qc.setQueryData<BoardResponse>(boardKey, {
          ...prev,
          bays: prev.bays.map((b) =>
            b.currentJob?.id === jobId ? { ...b, currentJob: null } : b,
          ),
        });
      }
      setError(null);
      return { prev };
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);
      setError(errMessage(err));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['bay-board'] }),
  });

  const cancelWaiting = useMutation({
    mutationFn: (jobId: string) =>
      api.post(`/bay-jobs/${jobId}/cancel`, { noShow: false }, { params: scope }),
    onMutate: async (jobId: string) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const prev = qc.getQueryData<BoardResponse>(boardKey);
      if (prev) {
        qc.setQueryData<BoardResponse>(boardKey, {
          ...prev,
          waiting: prev.waiting.filter((w) => w.id !== jobId),
        });
      }
      setError(null);
      return { prev };
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);
      setError(errMessage(err));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['bay-board'] }),
  });

  // Booking-row actions all remove the row from the bookings list.
  const bookingAction = (
    call: (id: string) => Promise<unknown>,
  ) => ({
    mutationFn: call,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: bookingsKey });
      const prev = qc.getQueryData<Booking[]>(bookingsKey);
      if (prev) {
        qc.setQueryData<Booking[]>(
          bookingsKey,
          prev.filter((b) => b.id !== id),
        );
      }
      setError(null);
      return { prev };
    },
    onError: (err: any, _vars: string, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(bookingsKey, ctx.prev);
      setError(errMessage(err));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['bay-bookings'] });
      qc.invalidateQueries({ queryKey: ['bay-board'] });
    },
  });

  const checkInJob = useMutation(
    bookingAction((id) => api.post(`/bay-jobs/${id}/check-in`, {}, { params: scope })),
  );
  const noShowJob = useMutation(
    bookingAction((id) =>
      api.post(`/bay-jobs/${id}/cancel`, { noShow: true }, { params: scope }),
    ),
  );
  const cancelBooking = useMutation(
    bookingAction((id) =>
      api.post(`/bay-jobs/${id}/cancel`, { noShow: false }, { params: scope }),
    ),
  );

  const requeueBooking = useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      api.patch(`/bay-jobs/${id}`, { scheduledAt: new Date(scheduledAt).toISOString() }, { params: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bay-bookings'] });
      qc.invalidateQueries({ queryKey: ['bay-board'] });
      setEditingBookingId(null);
      setError(null);
    },
    onError: (err: any) => setError(errMessage(err)),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-400">กำลังโหลด...</div>;
  }

  // Show what actually went wrong. A bare "no data" here hides the real cause —
  // most often a 400 because no shop is selected, or a 403 from the IP whitelist.
  if (boardError || !board) {
    return (
      <div className="p-6">
        <h2 className="mb-4 text-xl font-bold">ช่องบริการ</h2>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(boardError as any)?.response?.data?.message ??
            (boardError ? 'โหลดข้อมูลไม่สำเร็จ' : 'ไม่พบข้อมูล')}
        </div>
      </div>
    );
  }

  const freeCount = board.bays.filter((b) => b.active && !b.currentJob).length;

  // The shop floor: two bays nose-in side by side, two along the right wall.
  // Falls back to a plain grid if the bay count is ever not four.
  const isFloorPlan = board.bays.length === 4;

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold">ช่องบริการ</h2>
        <p className="text-xs text-gray-500">
          ว่าง {freeCount} จาก {board.bays.filter((b) => b.active).length} ช่อง ·
          รอคิว {board.waiting.length} คัน
        </p>
      </div>

      {error && modalMode === null && (
        <div className="mb-5 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      )}

      {/* Floor plan */}
      <div
        className={
          isFloorPlan
            ? 'mb-8 grid gap-4 lg:grid-cols-[1fr_1fr_1.3fr] lg:grid-rows-2'
            : 'mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'
        }
      >
        {board.bays.map((bay, i) => {
          const portrait = !isFloorPlan || i < 2;
          return (
            <div key={bay.id} className={isFloorPlan && i < 2 ? 'lg:row-span-2' : ''}>
              <div className="h-full min-h-[9rem]">
                <BayCard
                  bay={bay}
                  now={board.now}
                  orientation={portrait ? 'portrait' : 'landscape'}
                  onComplete={(jobId) => completeJob.mutate(jobId)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Waiting list */}
      <section className="mb-8">
        <div className="mb-2 flex justify-end">
          <LiveClock />
        </div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            รอคิว
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setError(null);
                setModalMode('WALK_IN');
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + เพิ่มคิว
            </button>
            <button
              onClick={() => {
                setError(null);
                setModalMode('BOOKING');
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              + จองคิว
            </button>
          </div>
        </div>
        {board.waiting.length === 0 ? (
          <div className="rounded-2xl border-2 border-gray-200 bg-white py-8 text-center text-sm text-gray-400">
            ไม่มีรถรอคิว
          </div>
        ) : (
          <div className="space-y-2">
            {board.waiting.map((job) => (
              <div
                key={job.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-gray-200 bg-white p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-gray-900">
                      {job.plateNumber}
                    </span>
                    {job.kind === 'BOOKING' && job.scheduledAt && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                        จอง {timeOf(job.scheduledAt)}
                      </span>
                    )}
                  </div>
                  {job.customerName && (
                    <p className="truncate text-xs text-gray-500">{job.customerName}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {job.services.map((s, i) => (
                      <span
                        key={i}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600"
                      >
                        {s.name}
                      </span>
                    ))}
                    <span className="ml-1 text-[11px] text-gray-400 tabular-nums">
                      รวม {job.estimatedMinutes} นาที · รอ {job.waitingMinutes} นาที
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {board.bays.map((bay) => {
                    const blockedReason = !bay.active
                      ? 'ช่องนี้ปิดใช้งาน'
                      : bay.currentJob
                        ? 'ช่องนี้มีรถอยู่'
                        : bay.mode === 'BOOKING_ONLY' && job.kind === 'WALK_IN'
                          ? 'ช่องนี้รับเฉพาะคิวจอง'
                          : '';
                    const disabled = !!blockedReason;
                    const suggested = bay.id === job.suggestedBayId && !disabled;
                    return (
                      <button
                        key={bay.id}
                        onClick={() => assignJob.mutate({ jobId: job.id, bayId: bay.id })}
                        disabled={disabled}
                        title={blockedReason || `จัดเข้า ${bay.name}`}
                        className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          disabled
                            ? 'cursor-not-allowed bg-gray-50 text-gray-300'
                            : suggested
                              ? 'bg-blue-600 text-white ring-2 ring-blue-200 hover:bg-blue-700'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {bay.name}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => cancelWaiting.mutate(job.id)}
                    className="ml-1 px-2 text-xs text-gray-400 hover:text-red-600"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bookings */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">คิวจอง</h3>
          <input
            type="date"
            className="rounded-lg border px-3 py-1.5 text-sm"
            value={bookingDate}
            onChange={(e) => setBookingDate(e.target.value)}
          />
        </div>

        {bookings.length === 0 ? (
          <div className="rounded-2xl border-2 border-gray-200 bg-white py-8 text-center text-sm text-gray-400">
            ไม่มีคิวจองในวันที่เลือก
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2 border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">เวลา</th>
                  <th className="px-4 py-3 text-left">ทะเบียน</th>
                  <th className="px-4 py-3 text-left">ลูกค้า</th>
                  <th className="px-4 py-3 text-left">ช่อง</th>
                  <th className="px-4 py-3 text-center">นาที</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {editingBookingId === b.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="datetime-local"
                            step={900}
                            autoFocus
                            className="rounded-lg border px-2 py-1 text-sm"
                            value={editScheduledAt}
                            onChange={(e) => setEditScheduledAt(e.target.value)}
                          />
                          <button
                            onClick={() =>
                              requeueBooking.mutate({ id: b.id, scheduledAt: editScheduledAt })
                            }
                            disabled={!editScheduledAt || requeueBooking.isPending}
                            className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40"
                          >
                            บันทึก
                          </button>
                          <button
                            onClick={() => setEditingBookingId(null)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setError(null);
                            setEditingBookingId(b.id);
                            setEditScheduledAt(toDatetimeLocal(b.scheduledAt));
                          }}
                          className="hover:underline"
                          title="แก้ไขเวลาจอง"
                        >
                          {timeOf(b.scheduledAt)}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{b.plateNumber}</td>
                    <td className="px-4 py-3 text-gray-500">{b.customerName ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {board.bays.find((x) => x.id === b.bayId)?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      {b.estimatedMinutes}
                    </td>
                    <td className="space-x-3 px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => checkInJob.mutate(b.id)}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        เช็คอิน
                      </button>
                      <button
                        onClick={() => noShowJob.mutate(b.id)}
                        className="text-xs text-amber-600 hover:underline"
                      >
                        ไม่มา
                      </button>
                      <button
                        onClick={() => cancelBooking.mutate(b.id)}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        ยกเลิก
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalMode && (
        <AddJobModal
          key={modalMode}
          mode={modalMode}
          onClose={() => setModalMode(null)}
          bays={board.bays}
          onSubmit={(data) => createJob.mutate(data)}
          isPending={createJob.isPending}
          error={error}
        />
      )}
    </div>
  );
}
