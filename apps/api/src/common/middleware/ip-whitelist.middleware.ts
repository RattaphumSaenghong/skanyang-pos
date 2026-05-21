import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class IpWhitelistMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
      : req.ip;

    let shopId: string | null = null;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const decoded = jwt.decode(token) as Record<string, unknown> | null;
        if (decoded && typeof decoded['shopId'] === 'string') {
          shopId = decoded['shopId'];
        }
      } catch {
        // decode failure — skip check
      }
    }

    if (!shopId) {
      return next();
    }

    const count = await this.prisma.ipWhitelist.count({
      where: { shopId, active: true },
    });

    if (count === 0) {
      return next();
    }

    const match = await this.prisma.ipWhitelist.findFirst({
      where: { shopId, active: true, ipAddress: ip },
    });

    if (!match) {
      res.status(403).json({ message: 'IP not whitelisted' });
      return;
    }

    return next();
  }
}
