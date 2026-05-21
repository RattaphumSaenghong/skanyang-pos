import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { parsePriceListExcel } from '../common/excel/price-list-parser';
import { createClient } from '@supabase/supabase-js';

const THAI_MONTHS: Record<string, number> = {
  มกรา: 1, กุมภา: 2, มีนา: 3, เมษา: 4, พฤษภา: 5, มิถุนา: 6,
  กรกฎา: 7, สิงหา: 8, กันยา: 9, ตุลา: 10, พฤศจิกา: 11, ธันวา: 12,
};

// Map model prefix → brand
const BRAND_MAP: Record<string, string> = {
  XCD: 'MICHELIN', AGI: 'MICHELIN', AGILIS: 'MICHELIN',
  PS: 'MICHELIN', TOUR: 'MICHELIN', PRIM: 'MICHELIN', PILOT: 'MICHELIN',
  ENERG: 'MICHELIN', CROSS: 'MICHELIN', LTX: 'MICHELIN',
  BF: 'BF GOODRICH', KO: 'BF GOODRICH', TERRA: 'BF GOODRICH',
  DUELER: 'BRIDGESTONE', TURANZ: 'BRIDGESTONE',
};

function inferBrand(model: string): string {
  const upper = model.toUpperCase();
  for (const [prefix, brand] of Object.entries(BRAND_MAP)) {
    if (upper.startsWith(prefix)) return brand;
  }
  return 'MICHELIN';
}

function detectMonth(sheetName: string, filename: string): { month: number; year: number } {
  // Try sheet name first, then filename
  const sources = [sheetName, filename];
  for (const src of sources) {
    for (const [thai, m] of Object.entries(THAI_MONTHS)) {
      if (src.includes(thai)) {
        const yearMatch = src.match(/\d{2,4}/);
        const rawYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear() % 100;
        // Thai files use 2-digit Buddhist Era shorthand (e.g. "69" = BE 2569 = CE 2026)
        // Full BE (>2400): subtract 543. 2-digit BE (<100): add 2500 then subtract 543 (= +1957). 4-digit CE: use as-is.
        const year = rawYear > 2400 ? rawYear - 543 : rawYear < 100 ? rawYear + 1957 : rawYear;
        return { month: m, year };
      }
    }
  }
  return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

@Injectable()
export class PriceListsService {
  constructor(private prisma: PrismaService) {}

  async import(file: Express.Multer.File, importedBy: string) {
    if (!file?.buffer) throw new BadRequestException('ไม่พบไฟล์');

    const { rows, sheetName, skipped, errors } = parsePriceListExcel(file.buffer);

    if (rows.length === 0) {
      throw new BadRequestException(
        `ไม่พบข้อมูลที่ถูกต้องในไฟล์ (ข้ามไป ${skipped} แถว)` +
        (errors.length ? `\n${errors.slice(0, 5).join('\n')}` : ''),
      );
    }

    const { month, year } = detectMonth(sheetName, file.originalname);
    const name = file.originalname.replace(/\.[^/.]+$/, '');

    // Upload to Supabase Storage (optional — requires SUPABASE_SERVICE_ROLE_KEY)
    let fileUrl: string | null = null;
    try {
      const supabase = getSupabase();
      if (supabase) {
        const path = `price-lists/${Date.now()}_${file.originalname}`;
        const { error } = await supabase.storage
          .from('price-lists')
          .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
        if (!error) {
          const { data } = supabase.storage.from('price-lists').getPublicUrl(path);
          fileUrl = data.publicUrl;
        }
      }
    } catch {
      // Storage upload failure is non-fatal
    }

    const priceList = await this.prisma.priceList.create({
      data: { name, month, year, importedBy, fileUrl },
    });

    let saved = 0;
    const saveErrors: string[] = [];

    for (const row of rows) {
      try {
        const sku = `${row.model.toUpperCase()}-${row.sizeNormalized}`;
        const brand = inferBrand(row.model);

        let product = await this.prisma.product.findUnique({ where: { sku } });
        if (!product) {
          product = await this.prisma.product.create({
            data: {
              sku,
              brand,
              model: row.model,
              sizeWidth: row.sizeWidth,
              sizeSeries: row.sizeSeries,
              sizeRim: row.sizeRim,
              sizeNormalized: row.sizeNormalized,
              sizeRaw: row.sizeRaw,
              isSetPricing: row.isSetPricing,
              dotYear: row.dotYear,
            },
          });
        }

        const effectiveCost = row.costPromo ?? row.costNormal;
        const marginCash = effectiveCost > 0 ? (row.priceCash - effectiveCost) / effectiveCost : null;
        const marginBulk = effectiveCost > 0 ? (row.priceBulk - effectiveCost) / effectiveCost : null;

        await this.prisma.priceEntry.upsert({
          where: { priceListId_productId: { priceListId: priceList.id, productId: product.id } },
          create: {
            priceListId: priceList.id,
            productId: product.id,
            costNormal: row.costNormal,
            costPromo: row.costPromo,
            priceListed: row.priceListed,
            priceCash: row.priceCash,
            priceCard: row.priceCard,
            priceZeroPct: row.priceZeroPct,
            priceBulk: row.priceBulk,
            marketArp: row.arp,
            discTradeIn: row.discTradeIn,
            discCard: row.discCard,
            discCash: row.discCash,
            discPromo: row.discPromo,
            marginCash,
            marginBulk,
          },
          update: {
            costNormal: row.costNormal,
            costPromo: row.costPromo,
            priceListed: row.priceListed,
            priceCash: row.priceCash,
            priceCard: row.priceCard,
            priceZeroPct: row.priceZeroPct,
            priceBulk: row.priceBulk,
            marketArp: row.arp,
            marginCash,
            marginBulk,
          },
        });
        saved++;
      } catch (e) {
        saveErrors.push(`${row.model} ${row.sizeNormalized}: ${e}`);
      }
    }

    return {
      priceListId: priceList.id,
      name,
      rowsImported: saved,
      rowsSkipped: skipped,
      rowsFailed: rows.length - saved,
      sheetName,
      errors: [...errors, ...saveErrors].slice(0, 10),
      hasStorage: !!fileUrl,
    };
  }

  findAll() {
    return this.prisma.priceList.findMany({
      orderBy: { importedAt: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
  }

  async activate(id: string) {
    const exists = await this.prisma.priceList.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('ไม่พบรายการราคา');
    await this.prisma.priceList.updateMany({ data: { isActive: false } });
    return this.prisma.priceList.update({ where: { id }, data: { isActive: true } });
  }

  async deactivate(id: string) {
    return this.prisma.priceList.update({ where: { id }, data: { isActive: false } });
  }

  async delete(id: string) {
    const exists = await this.prisma.priceList.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('ไม่พบรายการราคา');
    if (exists.isActive) throw new BadRequestException('ไม่สามารถลบรายการที่กำลังใช้งานอยู่ได้');

    // Delete storage file if exists
    if (exists.fileUrl) {
      try {
        const supabase = getSupabase();
        if (supabase) {
          const path = exists.fileUrl.split('/price-lists/')[1];
          if (path) await supabase.storage.from('price-lists').remove([path]);
        }
      } catch {
        // non-fatal
      }
    }

    await this.prisma.priceEntry.deleteMany({ where: { priceListId: id } });
    await this.prisma.priceList.delete({ where: { id } });
    return { deleted: true };
  }

  async findActive() {
    const pl = await this.prisma.priceList.findFirst({
      where: { isActive: true },
      include: { entries: { include: { product: true } } },
    });
    if (!pl) throw new NotFoundException('ไม่มีรายการราคาที่ใช้งานอยู่');
    return pl;
  }
}
