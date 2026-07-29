import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface Bay {
  id: string;
  name: string;
  mode: string;
}

interface ReportStats {
  totalJobs: number;
  completedJobs: number;
  cancelledJobs: number;
  noShowJobs: number;
  totalMinutes: number;
  averageMinutes: number;
  jobsByBay: Record<string, number>;
}

interface BayJob {
  id: string;
  bayId?: string;
  bay?: Bay;
  kind: string;
  status: string;
  plateNumber: string;
  customerName?: string;
  phone?: string;
  vehicleModel?: string;
  estimatedMinutes: number;
  startedAt?: string;
  finishedAt?: string;
  createdBy: { displayName: string };
  services: { name: string; minutes: number }[];
}

interface ReportResponse {
  stats: ReportStats;
  jobs: BayJob[];
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  bayId: string;
}

const NO_FILTERS: Filters = { dateFrom: '', dateTo: '', bayId: '' };

const STATUS_LABEL: Record<string, string> = {
  DONE: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิก',
  NO_SHOW: 'ไม่มาตามนัด',
};

const STATUS_CLASS: Record<string, string> = {
  DONE: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-yellow-100 text-yellow-800',
  NO_SHOW: 'bg-red-100 text-red-800',
};

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours} ชม. ${mins} น.` : `${mins} น.`;
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('th-TH');
}

export default function BayReportsPage() {
  const shopId = useAuthStore((s) => s.effectiveShopId());
  // Draft filters are what's in the inputs; applied filters are what the query
  // is keyed on. The ค้นหา button promotes one to the other.
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);

  const { data: bays = [] } = useQuery<Bay[]>({
    queryKey: ['bays', shopId],
    queryFn: () => api.get('/bays', { params: { shopId } }).then((r) => r.data),
  });

  const { data, isPending } = useQuery<ReportResponse>({
    queryKey: ['bay-report', shopId, applied],
    queryFn: () =>
      api
        .get('/bay-jobs/report', {
          params: {
            shopId,
            dateFrom: applied.dateFrom || undefined,
            dateTo: applied.dateTo || undefined,
            bayId: applied.bayId || undefined,
          },
        })
        .then((r) => r.data),
  });

  const stats = data?.stats;
  const jobs = data?.jobs ?? [];

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">ประวัติงานช่องบริการ</h2>

      <div className="bg-white rounded-xl border p-4 mb-4 grid grid-cols-4 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">วันที่เริ่มต้น</label>
          <input
            type="date"
            value={draft.dateFrom}
            onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">วันที่สิ้นสุด</label>
          <input
            type="date"
            value={draft.dateTo}
            onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">ช่องบริการ</label>
          <select
            value={draft.bayId}
            onChange={(e) => setDraft({ ...draft, bayId: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">ทั้งหมด</option>
            {bays.map((bay) => (
              <option key={bay.id} value={bay.id}>{bay.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => setApplied(draft)}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            ค้นหา
          </button>
        </div>
      </div>

      {isPending ? <p className="text-gray-400">กำลังโหลด...</p> : (
        <>
          {stats && (
            <>
              <div className="grid grid-cols-6 gap-3 mb-4">
                <div className="bg-white rounded-xl border p-4">
                  <p className="text-xs text-gray-500">เสร็จสิ้น</p>
                  <p className="text-2xl font-bold text-green-700">{stats.completedJobs}</p>
                </div>
                <div className="bg-white rounded-xl border p-4">
                  <p className="text-xs text-gray-500">งานทั้งหมด</p>
                  <p className="text-2xl font-bold">{stats.totalJobs}</p>
                </div>
                <div className="bg-white rounded-xl border p-4">
                  <p className="text-xs text-gray-500">ยกเลิก</p>
                  <p className="text-2xl font-bold text-yellow-700">{stats.cancelledJobs}</p>
                </div>
                <div className="bg-white rounded-xl border p-4">
                  <p className="text-xs text-gray-500">ไม่มาตามนัด</p>
                  <p className="text-2xl font-bold text-red-700">{stats.noShowJobs}</p>
                </div>
                <div className="bg-white rounded-xl border p-4">
                  <p className="text-xs text-gray-500">รวมเวลาทำงาน</p>
                  <p className="text-xl font-bold">{formatDuration(stats.totalMinutes)}</p>
                </div>
                <div className="bg-white rounded-xl border p-4">
                  <p className="text-xs text-gray-500">เฉลี่ยต่องาน</p>
                  <p className="text-xl font-bold">{formatDuration(stats.averageMinutes)}</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border p-4 mb-4">
                <p className="text-xs text-gray-500 mb-2">งานที่เสร็จสิ้นแยกตามช่อง</p>
                <div className="flex flex-wrap gap-4">
                  {bays.map((bay) => (
                    <div key={bay.id} className="flex items-baseline gap-2">
                      <span className="text-sm text-gray-600">{bay.name}</span>
                      <span className="text-lg font-bold">{stats.jobsByBay[bay.id] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ทะเบียน</th>
                  <th className="px-4 py-3 text-left">ลูกค้า</th>
                  <th className="px-4 py-3 text-left">ช่องบริการ</th>
                  <th className="px-4 py-3 text-left">บริการ</th>
                  <th className="px-4 py-3 text-center">สถานะ</th>
                  <th className="px-4 py-3 text-right">เวลาที่ใช้</th>
                  <th className="px-4 py-3 text-left">เริ่ม</th>
                  <th className="px-4 py-3 text-left">สิ้นสุด</th>
                  <th className="px-4 py-3 text-left">สร้างโดย</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((job) => {
                  // Only a job that actually ran has a real duration; for a
                  // cancelled or no-show job the estimate is all there is.
                  const actual = job.startedAt && job.finishedAt
                    ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 60000)
                    : null;

                  return (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{job.plateNumber}</td>
                      <td className="px-4 py-3">{job.customerName || '—'}</td>
                      <td className="px-4 py-3">{job.bay?.name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {job.services.map((s) => `${s.name} (${s.minutes} น.)`).join(', ')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block rounded px-2 py-1 text-xs font-semibold ${STATUS_CLASS[job.status] ?? 'bg-gray-100 text-gray-800'}`}>
                          {STATUS_LABEL[job.status] ?? job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {actual !== null ? formatDuration(actual) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">{formatTime(job.startedAt)}</td>
                      <td className="px-4 py-3 text-xs">{formatTime(job.finishedAt)}</td>
                      <td className="px-4 py-3">{job.createdBy.displayName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {jobs.length === 0 && (
              <p className="text-center text-gray-400 py-8">ไม่พบข้อมูล</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
