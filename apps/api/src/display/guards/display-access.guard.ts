import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';

// Tokens effectively never change, and these routes are polled every 3s per
// screen — re-reading the shop row each time would undo the query reduction the
// snapshot endpoint exists for. A short TTL keeps rotation from needing a restart.
const TOKEN_TTL_MS = 5 * 60 * 1000;

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, and length alone is not a secret
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Allows a request through on either credential:
 *   - a valid display token for the shop in the route (customer display screens,
 *     which nobody logs in on), or
 *   - a normal JWT (the authenticated admin UI, which shares GET :shopId/images).
 */
@Injectable()
export class DisplayAccessGuard implements CanActivate {
  private jwtGuard = new JwtAuthGuard();
  private tokenCache = new Map<string, { token: string; at: number }>();

  constructor(private prisma: PrismaService) {}

  private async tokenFor(shopId: string): Promise<string | null> {
    const hit = this.tokenCache.get(shopId);
    if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { displayToken: true },
    });
    if (!shop) return null;
    this.tokenCache.set(shopId, { token: shop.displayToken, at: Date.now() });
    return shop.displayToken;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const shopId: string | undefined = req.params?.shopId;
    const supplied = req.query?.t ?? req.headers?.['x-display-token'];

    if (shopId && typeof supplied === 'string' && supplied.length > 0) {
      const expected = await this.tokenFor(shopId);
      if (expected && safeEqual(expected, supplied)) return true;
    }

    return this.jwtGuard.canActivate(context) as Promise<boolean>;
  }
}
