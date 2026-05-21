import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const shop1 = await prisma.shop.upsert({
    where: { id: 'shop-1' },
    create: {
      id: 'shop-1',
      name: 'ส.การยาง สาขา 1 (ตรงข้ามโฮมโปร)',
      address: 'พิษณุโลก',
      phone: '0-5522-1161',
    },
    update: {},
  });

  const shop2 = await prisma.shop.upsert({
    where: { id: 'shop-2' },
    create: {
      id: 'shop-2',
      name: 'ส.การยาง สาขา 2',
      address: 'พิษณุโลก',
      phone: '097-9185556',
    },
    update: {},
  });

  const ownerHash = await bcrypt.hash('owner1234', 10);
  await prisma.user.upsert({
    where: { username: 'owner' },
    create: { username: 'owner', displayName: 'เจ้าของ', passwordHash: ownerHash, role: 'OWNER', shopId: null },
    update: {},
  });

  const staffHash = await bcrypt.hash('staff1234', 10);
  await prisma.user.upsert({
    where: { username: 'staff1' },
    create: { username: 'staff1', displayName: 'พนักงาน สาขา 1', passwordHash: staffHash, role: 'STAFF', shopId: shop1.id },
    update: {},
  });
  await prisma.user.upsert({
    where: { username: 'staff2' },
    create: { username: 'staff2', displayName: 'พนักงาน สาขา 2', passwordHash: staffHash, role: 'STAFF', shopId: shop2.id },
    update: {},
  });

  console.log('Seed complete.');
  console.log('  owner / owner1234  (full access, both shops)');
  console.log('  staff1 / staff1234 (shop 1 only)');
  console.log('  staff2 / staff1234 (shop 2 only)');
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
