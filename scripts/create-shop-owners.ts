/**
 * Creates Skan_owner (shop-1) and Rich_owner (shop-2) with SHOP_OWNER role.
 * Run: npx ts-node scripts/create-shop-owners.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const shops = await prisma.shop.findMany({ orderBy: { createdAt: 'asc' } });
  if (shops.length < 2) {
    console.error(`Expected at least 2 shops, found ${shops.length}`);
    process.exit(1);
  }

  const shop1 = shops[0];
  const shop2 = shops[1];
  const hash = await bcrypt.hash('owner1234', 10);

  const accounts = [
    { username: 'Skan_owner', shopId: shop1.id, shopName: shop1.name },
    { username: 'Rich_owner', shopId: shop2.id, shopName: shop2.name },
  ];

  for (const acc of accounts) {
    const existing = await prisma.user.findUnique({ where: { username: acc.username } });
    if (existing) {
      console.log(`⚠️  ${acc.username} already exists — skipping`);
      continue;
    }
    await prisma.user.create({
      data: {
        username: acc.username,
        displayName: acc.username,
        passwordHash: hash,
        role: 'SHOP_OWNER',
        shopId: acc.shopId,
        active: true,
      },
    });
    console.log(`✅ Created ${acc.username} → ${acc.shopName} (${acc.shopId})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
