import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BayJobStatus } from '@prisma/client';
import { CreateBayDto } from './dto/create-bay.dto';
import { UpdateBayDto } from './dto/update-bay.dto';
import { estimatedFinish, overdueMinutes, suggestBay } from './allocation';
import { dayRangeUtc, shopDateString } from './tz';

@Injectable()
export class BaysService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateBayDto, shopId: string) {
    return this.prisma.bay.create({
      data: {
        shopId,
        name: dto.name,
        mode: dto.mode,
        sortOrder: dto.sortOrder,
      },
    });
  }

  findAll(shopId: string) {
    return this.prisma.bay.findMany({
      where: { shopId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async update(id: string, dto: UpdateBayDto, shopId: string) {
    const bay = await this.prisma.bay.findFirst({ where: { id, shopId } });
    if (!bay) throw new NotFoundException('ไม่พบช่องบริการนี้');

    return this.prisma.bay.update({ where: { id }, data: dto as any });
  }

  async delete(id: string, shopId: string) {
    const bay = await this.prisma.bay.findFirst({ where: { id, shopId } });
    if (!bay) throw new NotFoundException('ไม่พบช่องบริการนี้');

    const occupied = await this.prisma.bayJob.findFirst({
      where: { bayId: id, status: BayJobStatus.IN_PROGRESS },
    });
    if (occupied) throw new ConflictException('ช่องนี้มีรถอยู่ ไม่สามารถปิดใช้งานได้');

    return this.prisma.bay.update({ where: { id }, data: { active: false } });
  }

  /**
   * Everything the board screen needs, in one round trip — the same shape of
   * deal as GET /display/:shopId/snapshot, because the page polls it every 5s.
   * Deliberately holds no in-memory state: unlike the display caches, this has
   * to stay correct if the API ever runs more than one replica.
   */
  async getBoard(shopId: string) {
    const now = new Date();
    const { start, end } = dayRangeUtc(shopDateString(now));

    const [bays, waiting, bookingsToday] = await Promise.all([
      this.prisma.bay.findMany({
        where: { shopId },
        orderBy: { sortOrder: 'asc' },
        include: {
          jobs: {
            where: { status: BayJobStatus.IN_PROGRESS },
            include: { services: { select: { name: true, minutes: true } } },
          },
        },
      }),
      this.prisma.bayJob.findMany({
        where: { shopId, status: BayJobStatus.WAITING },
        include: { services: { select: { name: true, minutes: true } } },
      }),
      this.prisma.bayJob.findMany({
        where: {
          shopId,
          status: BayJobStatus.BOOKED,
          scheduledAt: { gte: start, lt: end },
        },
        select: {
          id: true,
          plateNumber: true,
          customerName: true,
          scheduledAt: true,
          bayId: true,
          status: true,
          estimatedMinutes: true,
        },
        orderBy: { scheduledAt: 'asc' },
      }),
    ]);

    // At most one IN_PROGRESS job per bay — the partial unique index guarantees it.
    const occupying = bays
      .filter((bay) => bay.jobs.length > 0)
      .map((bay) => ({ ...bay.jobs[0], bayId: bay.id }));

    // Checked-in bookings go above walk-ins; within each group, first come first served.
    const sortedWaiting = [...waiting].sort((a, b) => {
      const aBooked = a.kind === 'BOOKING';
      const bBooked = b.kind === 'BOOKING';
      if (aBooked !== bBooked) return aBooked ? -1 : 1;
      if (aBooked && a.scheduledAt && b.scheduledAt) {
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
      }
      return (a.queuedAt?.getTime() ?? 0) - (b.queuedAt?.getTime() ?? 0);
    });

    return {
      now: now.toISOString(),
      bays: bays.map((bay) => {
        const job = bay.jobs[0];
        return {
          id: bay.id,
          name: bay.name,
          mode: bay.mode,
          active: bay.active,
          sortOrder: bay.sortOrder,
          currentJob: job
            ? {
                id: job.id,
                plateNumber: job.plateNumber,
                customerName: job.customerName,
                services: job.services,
                startedAt: job.startedAt,
                estimatedMinutes: job.estimatedMinutes,
                estimatedFinish: estimatedFinish(job),
                overdueMinutes: overdueMinutes(job, now),
              }
            : null,
        };
      }),
      waiting: sortedWaiting.map((job) => ({
        id: job.id,
        kind: job.kind,
        plateNumber: job.plateNumber,
        customerName: job.customerName,
        phone: job.phone,
        vehicleModel: job.vehicleModel,
        note: job.note,
        services: job.services,
        estimatedMinutes: job.estimatedMinutes,
        queuedAt: job.queuedAt,
        scheduledAt: job.scheduledAt,
        waitingMinutes: Math.floor(
          (now.getTime() - (job.queuedAt ?? now).getTime()) / 60_000,
        ),
        suggestedBayId: suggestBay(bays, occupying, job)?.bayId ?? null,
      })),
      bookingsToday,
    };
  }
}
