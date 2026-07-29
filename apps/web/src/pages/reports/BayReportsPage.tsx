import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';

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
  bay?: { id: string; name: string; type: string };
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

export default function BayReportsPage() {
  const shopId = useAuthStore().effectiveShopId() || '';
  const token = localStorage.getItem('token') || '';
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [jobs, setJobs] = useState<BayJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bayId, setBayId] = useState('');
  const [bays, setBays] = useState<{ id: string; name: string }[]>([]);

  // Fetch bays for filter dropdown
  useEffect(() => {
    const fetchBays = async () => {
      try {
        const res = await fetch(`/api/bays?shopId=${shopId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setBays(data);
        }
      } catch (err) {
        console.error('Failed to fetch bays:', err);
      }
    };
    fetchBays();
  }, [shopId]);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (bayId) params.append('bayId', bayId);
      params.append('shopId', shopId);

      const res = await fetch(`/api/bay-jobs/report?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setJobs(data.jobs);
      }
    } catch (err) {
      console.error('Failed to fetch report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [shopId]);

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('th-TH');
  };

  return (
    <div className="p-6 max-w-full">
      <h1 className="text-3xl font-bold mb-6">รายงานการใช้งานช่องบริการ</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">วันที่เริ่มต้น</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">วันที่สิ้นสุด</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ช่องบริการ</label>
          <select
            value={bayId}
            onChange={(e) => setBayId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          >
            <option value="">ทั้งหมด</option>
            {bays.map((bay) => (
              <option key={bay.id} value={bay.id}>
                {bay.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={fetchReport}
            disabled={loading}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? 'กำลังโหลด...' : 'ค้นหา'}
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-6 gap-4 mb-6">
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="text-sm text-green-700 font-medium">งานที่เสร็จสิ้น</div>
            <div className="text-3xl font-bold text-green-900">{stats.completedJobs}</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="text-sm text-blue-700 font-medium">รวมทั้งหมด</div>
            <div className="text-3xl font-bold text-blue-900">{stats.totalJobs}</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
            <div className="text-sm text-yellow-700 font-medium">ยกเลิก</div>
            <div className="text-3xl font-bold text-yellow-900">{stats.cancelledJobs}</div>
          </div>
          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <div className="text-sm text-red-700 font-medium">No-show</div>
            <div className="text-3xl font-bold text-red-900">{stats.noShowJobs}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <div className="text-sm text-purple-700 font-medium">รวมเวลา</div>
            <div className="text-2xl font-bold text-purple-900">{formatDuration(stats.totalMinutes)}</div>
          </div>
          <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
            <div className="text-sm text-indigo-700 font-medium">เฉลี่ยต่องาน</div>
            <div className="text-2xl font-bold text-indigo-900">{formatDuration(stats.averageMinutes)}</div>
          </div>
        </div>
      )}

      {/* Jobs Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">ทะเบียน</th>
                <th className="px-4 py-3 text-left font-semibold">ลูกค้า</th>
                <th className="px-4 py-3 text-left font-semibold">ช่องบริการ</th>
                <th className="px-4 py-3 text-left font-semibold">บริการ</th>
                <th className="px-4 py-3 text-center font-semibold">สถานะ</th>
                <th className="px-4 py-3 text-center font-semibold">เวลาที่ใช้ (นาที)</th>
                <th className="px-4 py-3 text-left font-semibold">เริ่มเวลา</th>
                <th className="px-4 py-3 text-left font-semibold">สิ้นสุด</th>
                <th className="px-4 py-3 text-left font-semibold">สร้างโดย</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, idx) => {
                const actualMinutes =
                  job.startedAt && job.finishedAt
                    ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 60000)
                    : job.estimatedMinutes;

                const statusColor = {
                  DONE: 'bg-green-100 text-green-800',
                  CANCELLED: 'bg-yellow-100 text-yellow-800',
                  NO_SHOW: 'bg-red-100 text-red-800',
                }[job.status] || 'bg-gray-100 text-gray-800';

                return (
                  <tr key={job.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{job.plateNumber}</td>
                    <td className="px-4 py-3">{job.customerName || '—'}</td>
                    <td className="px-4 py-3">{job.bay?.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {job.services.map((s) => `${s.name} (${s.minutes}m)`).join(', ')}
                    </td>
                    <td className={`px-4 py-3 text-center font-semibold text-xs rounded ${statusColor}`}>
                      {job.status === 'DONE' ? 'เสร็จสิ้น' : job.status === 'CANCELLED' ? 'ยกเลิก' : 'No-show'}
                    </td>
                    <td className="px-4 py-3 text-center">{actualMinutes}m</td>
                    <td className="px-4 py-3 text-xs">{formatTime(job.startedAt)}</td>
                    <td className="px-4 py-3 text-xs">{formatTime(job.finishedAt)}</td>
                    <td className="px-4 py-3">{job.createdBy.displayName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {jobs.length === 0 && !loading && (
          <div className="text-center py-8 text-gray-500">ไม่พบข้อมูล</div>
        )}
      </div>
    </div>
  );
}
