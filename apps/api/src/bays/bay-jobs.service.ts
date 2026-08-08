import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BayJobStatus } from '@prisma/client';
import { CreateBayJobDto } from './dto/create-bay-job.dto';
import { UpdateBayJobDto } from './dto/update-bay-job.dto';
import { BayJobServiceDto } from './dto/create-bay-job.dto';
import { isEligible } from './allocation';
import { dayRangeUtc, isValidDateString, shopDateString, shopTimeString } from './tz';

const ALLOWED: Record<BayJobStatus, BayJobStatus[]> = {
  BOOKED: ['WAITING', 'CANCELLED', 'NO_SHOW'],
  WAITING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
  NO_SHOW: [],
};

interface ResolvedService {
  serviceId: string | null;
  name: string;
  minutes: number;
}

@Injectable()
export class BayJobsService {
  constructor(private prisma: PrismaService) {}

  private canTransition(from: BayJobStatus, to: BayJobStatus): boolean {
    return ALLOWED[from].includes(to);
  }

  /**
   * Turn the requested services into rows to store. Catalog picks are
   * snapshotted by name and minutes, exactly like QuotationItem snapshots its
   * prices, so renaming or retiring a service never rewrites an existing job.
   */
  private async resolveServices(
    services: BayJobServiceDto[],
    shopId: string,
  ): Promise<ResolvedService[]> {
    if (!services || services.length === 0) {
      throw new BadRequestException('กรุณาเลือกบริการอย่างน้อย 1 รายการ');
    }

    const resolved: ResolvedService[] = [];
    for (const svc of services) {
      if (svc.serviceId) {
        const service = await this.prisma.service.findFirst({
          where: { id: svc.serviceId, shopId, active: true },
        });
        if (!service) {
          throw new BadRequestException('ไม่พบบริการนี้ หรือบริการถูกปิดใช้งาน');
        }
        resolved.push({
          serviceId: service.id,
          name: service.name,
          minutes: service.estimatedMinutes,
        });
      } else {
        if (!svc.name || svc.minutes === undefined || svc.minutes < 1) {
          throw new BadRequestException('บริการอื่นๆ ต้องระบุชื่อและเวลาอย่างน้อย 1 นาที');
        }
        resolved.push({ serviceId: null, name: svc.name, minutes: svc.minutes });
      }
    }
    return resolved;
  }

  private totalMinutes(services: ResolvedService[]): number {
    return services.reduce((sum, s) => sum + s.minutes, 0);
  }

  private async loadBookableBay(bayId: string, shopId: string, kind: 'BOOKING') {
    const bay = await this.prisma.bay.findFirst({
      where: { id: bayId, shopId, active: true },
    });
    if (!bay) throw new NotFoundException('ไม่พบช่องบริการนี้ หรือช่องถูกปิดใช้งาน');
    if (!isEligible(bay, { kind, bayId: null, estimatedMinutes: 0, startedAt: null })) {
      throw new ForbiddenException('ช่องนี้ไม่รับคิวจอง');
    }
    return bay;
  }

  /**
   * Reject a booking that would overlap another booking in the same bay.
   *
   * Two intervals overlap when each starts before the other ends. The end of a
   * booking is `scheduledAt + estimatedMinutes`, which Prisma cannot express in
   * a `where`, so candidates for the day are fetched and compared here. A
   * scheduledAt-only range filter would miss the common case: an existing
   * 14:00 booking running 60 minutes still blocks a new one at 14:30.
   */
  private async assertNoBookingClash(
    bayId: string,
    shopId: string,
    startAt: Date,
    minutes: number,
    excludeJobId?: string,
  ) {
    const endAt = startAt.getTime() + minutes * 60_000;
    const { start, end } = dayRangeUtc(shopDateString(startAt));

    const sameDay = await this.prisma.bayJob.findMany({
      where: {
        shopId,
        bayId,
        status: BayJobStatus.BOOKED,
        scheduledAt: { gte: start, lt: end },
        ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
      },
    });

    const clash = sameDay.find((other) => {
      const otherStart = other.scheduledAt!.getTime();
      const otherEnd = otherStart + other.estimatedMinutes * 60_000;
      return otherStart < endAt && otherEnd > startAt.getTime();
    });

    if (clash) {
      throw new ConflictException(
        `ช่องนี้มีคิวจองเวลา ${shopTimeString(clash.scheduledAt!)} อยู่แล้ว`,
      );
    }
  }

  async create(dto: CreateBayJobDto, userId: string, shopId: string) {
    const services = await this.resolveServices(dto.services, shopId);
    const estimatedMinutes = this.totalMinutes(services);

    let status: BayJobStatus;
    let queuedAt: Date | null = null;
    let scheduledAt: Date | null = null;
    let bayId: string | null = null;

    if (dto.kind === 'WALK_IN') {
      status = BayJobStatus.WAITING;
      queuedAt = new Date();
    } else {
      if (!dto.scheduledAt || !dto.bayId) {
        throw new BadRequestException('การจองคิวต้องระบุเวลาและช่องบริการ');
      }
      status = BayJobStatus.BOOKED;
      scheduledAt = new Date(dto.scheduledAt);
      bayId = dto.bayId;

      await this.loadBookableBay(bayId, shopId, 'BOOKING');
      await this.assertNoBookingClash(bayId, shopId, scheduledAt, estimatedMinutes);
    }

    return this.prisma.bayJob.create({
      data: {
        shopId,
        bayId,
        kind: dto.kind,
        status,
        plateNumber: dto.plateNumber,
        customerName: dto.customerName ?? null,
        phone: dto.phone ?? null,
        vehicleModel: dto.vehicleModel ?? null,
        note: dto.note ?? null,
        estimatedMinutes,
        scheduledAt,
        queuedAt,
        createdById: userId,
        services: { create: services },
      },
      include: { services: true },
    });
  }

  async update(id: string, dto: UpdateBayJobDto, shopId: string) {
    const job = await this.prisma.bayJob.findFirst({ where: { id, shopId } });
    if (!job) throw new NotFoundException('ไม่พบรายการนี้');

    if (job.status !== BayJobStatus.BOOKED && job.status !== BayJobStatus.WAITING) {
      throw new BadRequestException('แก้ไขได้เฉพาะคิวที่ยังไม่เริ่มงาน');
    }

    const updateData: any = {};
    if (dto.plateNumber !== undefined) updateData.plateNumber = dto.plateNumber;
    if (dto.customerName !== undefined) updateData.customerName = dto.customerName;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.vehicleModel !== undefined) updateData.vehicleModel = dto.vehicleModel;
    if (dto.note !== undefined) updateData.note = dto.note;

    let services: ResolvedService[] | null = null;
    if (dto.services) {
      services = await this.resolveServices(dto.services, shopId);
      updateData.estimatedMinutes = this.totalMinutes(services);
    }

    let scheduledAt: Date | undefined;
    if (dto.scheduledAt !== undefined) {
      // Requeuing a time only makes sense while the car hasn't checked in yet.
      if (job.status !== BayJobStatus.BOOKED) {
        throw new BadRequestException('แก้ไขเวลาจองได้เฉพาะคิวที่ยังไม่เช็คอิน');
      }
      scheduledAt = new Date(dto.scheduledAt);
      updateData.scheduledAt = scheduledAt;
    }

    // Changing the services or the time changes when this booking occupies its
    // bay, so it has to be re-checked against its neighbours — a longer job,
    // or a job moved later, can grow into the next booking's slot.
    if (job.status === BayJobStatus.BOOKED && job.bayId && (services || scheduledAt)) {
      await this.assertNoBookingClash(
        job.bayId,
        shopId,
        scheduledAt ?? job.scheduledAt!,
        updateData.estimatedMinutes ?? job.estimatedMinutes,
        job.id,
      );
    }

    // Replacing the services is a delete followed by a create; without the
    // transaction a failed update would leave the job with no services at all.
    return this.prisma.$transaction(async (tx) => {
      if (services) {
        await tx.bayJobService.deleteMany({ where: { jobId: id } });
        updateData.services = { create: services };
      }
      return tx.bayJob.update({
        where: { id },
        data: updateData,
        include: { services: true },
      });
    });
  }

  async checkIn(id: string, shopId: string) {
    const job = await this.prisma.bayJob.findFirst({ where: { id, shopId } });
    if (!job) throw new NotFoundException('ไม่พบรายการนี้');
    if (!this.canTransition(job.status, BayJobStatus.WAITING)) {
      throw new BadRequestException('เช็คอินได้เฉพาะคิวที่จองไว้');
    }

    return this.prisma.bayJob.update({
      where: { id },
      data: { status: BayJobStatus.WAITING, queuedAt: new Date() },
      include: { services: true },
    });
  }

  async assign(id: string, bayId: string, shopId: string) {
    const job = await this.prisma.bayJob.findFirst({ where: { id, shopId } });
    if (!job) throw new NotFoundException('ไม่พบรายการนี้');
    if (!this.canTransition(job.status, BayJobStatus.IN_PROGRESS)) {
      throw new BadRequestException('จัดคิวได้เฉพาะรถที่รออยู่');
    }

    const bay = await this.prisma.bay.findFirst({
      where: { id: bayId, shopId, active: true },
    });
    if (!bay) throw new NotFoundException('ไม่พบช่องบริการนี้ หรือช่องถูกปิดใช้งาน');
    if (!isEligible(bay, job)) {
      throw new ForbiddenException('ช่องนี้รับเฉพาะคิวจอง');
    }

    // The board is polled, so two staff can both see this bay free and both
    // click. The partial unique index BayJob_bay_in_progress_key is what
    // actually decides the winner; a pre-flight SELECT would lose the race.
    try {
      return await this.prisma.bayJob.update({
        where: { id },
        data: { status: BayJobStatus.IN_PROGRESS, bayId, startedAt: new Date() },
        include: { services: true },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('ช่องนี้มีรถอยู่แล้ว');
      throw err;
    }
  }

  async complete(id: string, shopId: string) {
    const job = await this.prisma.bayJob.findFirst({ where: { id, shopId } });
    if (!job) throw new NotFoundException('ไม่พบรายการนี้');
    if (!this.canTransition(job.status, BayJobStatus.DONE)) {
      throw new BadRequestException('ปิดงานได้เฉพาะรถที่กำลังซ่อมอยู่');
    }

    return this.prisma.bayJob.update({
      where: { id },
      data: { status: BayJobStatus.DONE, finishedAt: new Date() },
      include: { services: true },
    });
  }

  async cancel(id: string, shopId: string, noShow?: boolean) {
    const job = await this.prisma.bayJob.findFirst({ where: { id, shopId } });
    if (!job) throw new NotFoundException('ไม่พบรายการนี้');

    const target = noShow ? BayJobStatus.NO_SHOW : BayJobStatus.CANCELLED;
    if (!this.canTransition(job.status, target)) {
      throw new BadRequestException('ไม่สามารถยกเลิกคิวนี้ได้');
    }

    // finishedAt is what the history report filters and sorts on, so a job that
    // ends by being cancelled needs one too — otherwise it is invisible to any
    // date range and sorts unpredictably against jobs that have one.
    return this.prisma.bayJob.update({
      where: { id },
      data: { status: target, finishedAt: new Date() },
      include: { services: true },
    });
  }

  async getBookingsByDate(date: string, shopId: string) {
    if (!isValidDateString(date)) {
      throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง');
    }
    const { start, end } = dayRangeUtc(date);

    return this.prisma.bayJob.findMany({
      where: {
        shopId,
        status: BayJobStatus.BOOKED,
        scheduledAt: { gte: start, lt: end },
      },
      include: { services: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async getJobsReport(
    shopId: string,
    dateFrom?: string,
    dateTo?: string,
    bayId?: string,
  ) {
    const whereClause: any = { shopId, status: { in: [BayJobStatus.DONE, BayJobStatus.CANCELLED, BayJobStatus.NO_SHOW] } };

    if (dateFrom && isValidDateString(dateFrom)) {
      const { start } = dayRangeUtc(dateFrom);
      whereClause.finishedAt = { gte: start };
    }

    if (dateTo && isValidDateString(dateTo)) {
      const { end } = dayRangeUtc(dateTo);
      if (whereClause.finishedAt) {
        whereClause.finishedAt.lt = end;
      } else {
        whereClause.finishedAt = { lt: end };
      }
    }

    if (bayId) {
      whereClause.bayId = bayId;
    }

    const jobs = await this.prisma.bayJob.findMany({
      where: whereClause,
      include: { bay: true, services: true, createdBy: true },
      orderBy: { finishedAt: 'desc' },
    });

    const completedJobs = jobs.filter((j) => j.status === BayJobStatus.DONE);

    const stats = {
      totalJobs: jobs.length,
      completedJobs: completedJobs.length,
      cancelledJobs: jobs.filter((j) => j.status === BayJobStatus.CANCELLED).length,
      noShowJobs: jobs.filter((j) => j.status === BayJobStatus.NO_SHOW).length,
      totalMinutes: completedJobs.reduce((sum, j) => {
        if (!j.startedAt || !j.finishedAt) return sum;
        return sum + Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 60000);
      }, 0),
      averageMinutes:
        completedJobs.length > 0
          ? Math.round(
              completedJobs.reduce((sum, j) => {
                if (!j.startedAt || !j.finishedAt) return sum;
                return sum + (j.finishedAt.getTime() - j.startedAt.getTime());
              }, 0) / completedJobs.length / 60000,
            )
          : 0,
      jobsByBay: {} as Record<string, number>,
    };

    completedJobs.forEach((job) => {
      if (job.bay) {
        stats.jobsByBay[job.bay.id] = (stats.jobsByBay[job.bay.id] || 0) + 1;
      }
    });

    return { stats, jobs };
  }
}
