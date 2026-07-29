import { BadRequestException } from '@nestjs/common';

/**
 * Which shop a request is acting on.
 *
 * A super-OWNER's token carries `shopId: null` and it picks a shop in the UI,
 * so it has to name the shop explicitly — the same deal /stock and /quotations
 * already make. Everyone else is pinned to the shop on their token and cannot
 * reach another one by passing an id.
 */
export function resolveShopId(user: any, requested?: string): string {
  const shopId = user.role === 'OWNER' ? (requested ?? user.shopId) : user.shopId;
  if (!shopId) throw new BadRequestException('กรุณาเลือกร้าน');
  return shopId;
}
