import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  listIpWhitelist(shopId: string) {
    return this.prisma.ipWhitelist.findMany({
      where: { shopId, active: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  addIpWhitelist(shopId: string, ipAddress: string, label?: string) {
    return this.prisma.ipWhitelist.create({
      data: { shopId, ipAddress, label },
    });
  }

  async removeIpWhitelist(id: string, shopId: string) {
    const entry = await this.prisma.ipWhitelist.findFirst({
      where: { id, shopId, active: true },
    });
    if (!entry) throw new NotFoundException('IP whitelist entry not found');
    return this.prisma.ipWhitelist.update({
      where: { id },
      data: { active: false },
    });
  }

  async listAuditLog(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count(),
    ]);
    return { rows, total, page, limit };
  }
}
