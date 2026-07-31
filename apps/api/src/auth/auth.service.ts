import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string, ip: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) {
      try {
        await this.prisma.auditLog.create({
          data: { userId: null, username, event: 'LOGIN_FAILED', ip, userAgent, success: false },
        });
      } catch {}
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      try {
        await this.prisma.auditLog.create({
          data: { userId: null, username, event: 'LOGIN_FAILED', ip, userAgent, success: false },
        });
      } catch {}
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    await this.prisma.auditLog.create({
      data: { userId: user.id, username, event: 'LOGIN', ip, userAgent, success: true },
    });

    return this.issueTokens(user.id, user.username, user.role, user.shopId);
  }

  async refresh(token: string) {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new UnauthorizedException('Token service unavailable');
    try {
      const payload = this.jwt.verify(token, { secret });
      return this.issueTokens(payload.sub, payload.username, payload.role, payload.shopId);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private issueTokens(sub: string, username: string, role: string, shopId: string | null) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!refreshSecret) throw new UnauthorizedException('Token service unavailable');
    const payload = { sub, username, role, shopId };
    return {
      accessToken: this.jwt.sign(payload),
      refreshToken: this.jwt.sign(payload, {
        secret: refreshSecret,
        // See auth.module.ts — env-supplied ms-style literal.
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
          '7d') as JwtSignOptions['expiresIn'],
      }),
      user: { id: sub, username, role, shopId },
    };
  }
}
