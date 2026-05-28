import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { parsePriceListExcel, extractRowImages } from '../common/excel/price-list-parser';
import { createClient } from '@supabase/supabase-js';

const THAI_MONTHS: Record<string, number> = {
  มกรา: 1, กุมภา: 2, มีนา: 3, เมษา: 4, พฤษภา: 5, มิถุนา: 6,
  กรกฎา: 7, สิงหา: 8, กันยา: 9, ตุลา: 10, พฤศจิกา: 11, ธันวา: 12,
};

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
  const sources = [sheetName, filename];
  for (const src of sources) {
    for (const [thai, m] of Object.entries(THAI_MONTHS)) {
      if (src.includes(thai)) {
        const yearMatch = src.match(/\d{2,4}/);
        const rawYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear() % 100;
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

  async import(file: Express.Multer.File, importedBy: string, shopId: string) {
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
      // non-fatal
    }

    const priceList = await this.prisma.priceList.create({
      data: { shopId, name, month, year, importedBy, fileUrl },
    });

    let saved = 0;
    const saveErrors: string[] = [];

    for (const row of rows) {
      try {
        const setSuffix = row.isSetPricing ? '-SET' : '';
        const sku = `${row.model.toUpperCase()}-${row.sizeNormalized}${setSuffix}`;
        const brand = row.brand || inferBrand(row.model);

        let product = await this.prisma.product.findUnique({ where: { shopId_sku: { shopId, sku } } });
        if (!product) {
          product = await this.prisma.product.create({
            data: {
              shopId,
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
              sortOrder: row.sortOrder,
              ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
            },
          });
        } else {
          await this.prisma.product.update({
            where: { id: product.id },
            data: {
              brand,
              sortOrder: row.sortOrder,
              ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
            },
          });
        }

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
            marginCash: row.marginCash,
            marginCard: row.marginCard,
            marginZeroPct: row.marginZeroPct,
            marginBulk: row.marginBulk,
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
            marginCash: row.marginCash,
            marginCard: row.marginCard,
            marginZeroPct: row.marginZeroPct,
            marginBulk: row.marginBulk,
          },
        });
        saved++;
      } catch (e) {
        saveErrors.push(`${row.model} ${row.sizeNormalized}: ${e}`);
      }
    }

    // Extract and upload product images (non-fatal)
    let imagesFound = 0;
    let imagesUploaded = 0;
    let imageError: string | null = null;
    try {
      const imageMap = await extractRowImages(file.buffer);
      imagesFound = imageMap.size;
      if (imageMap.size > 0) {
        const supabase = getSupabase();
        if (supabase) {
          for (const [rowIdx, img] of imageMap) {
            const row = rows.find((r) => r.rowIndex === rowIdx);
            if (!row) continue;
            const setSuffix = row.isSetPricing ? '-SET' : '';
            const sku = `${row.model.toUpperCase()}-${row.sizeNormalized}${setSuffix}`;
            const product = await this.prisma.product.findUnique({ where: { shopId_sku: { shopId, sku } } });
            if (!product) continue;
            const safeSku = sku.replace(/[^a-zA-Z0-9-]/g, '_');
            const imgPath = `product-images/${shopId}/${safeSku}.${img.ext}`;
            const { error } = await supabase.storage
              .from('product-images')
              .upload(imgPath, img.data, { contentType: `image/${img.ext}`, upsert: true });
            if (!error) {
              const { data } = supabase.storage.from('product-images').getPublicUrl(imgPath);
              await this.prisma.product.update({ where: { id: product.id }, data: { imageUrl: data.publicUrl } });
              imagesUploaded++;
            } else {
              imageError = imageError ?? error.message;
            }
          }
        } else {
          imageError = 'Supabase not configured';
        }
      }
    } catch (e) {
      imageError = String(e);
    }
    console.log('[IMG]', { imagesFound, imagesUploaded, imageError });

    return {
      priceListId: priceList.id,
      name,
      rowsImported: saved,
      rowsSkipped: skipped,
      rowsFailed: rows.length - saved,
      sheetName,
      errors: [...errors, ...saveErrors].slice(0, 10),
      hasStorage: !!fileUrl,
      imagesFound,
      imagesUploaded,
      imageError,
    };
  }

  findAll(shopId: string) {
    return this.prisma.priceList.findMany({
      where: { shopId },
      orderBy: { importedAt: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
  }

  async activate(id: string) {
    const incoming = await this.prisma.priceList.findUnique({
      where: { id },
      include: { entries: { select: { productId: true } } },
    });
    if (!incoming) throw new NotFoundException('ไม่พบรายการราคา');

    const { shopId } = incoming;
    const incomingProductIds = new Set(incoming.entries.map((e) => e.productId));

    // Deactivate products for this shop not in the new sheet
    await this.prisma.product.updateMany({
      where: { shopId, id: { notIn: [...incomingProductIds] } },
      data: { active: false },
    });

    // Re-activate returning products
    await this.prisma.product.updateMany({
      where: { shopId, id: { in: [...incomingProductIds] }, active: false },
      data: { active: true },
    });

    // Deactivate all price lists for this shop, then activate the selected one
    await this.prisma.priceList.updateMany({ where: { shopId }, data: { isActive: false } });
    const activated = await this.prisma.priceList.update({ where: { id }, data: { isActive: true } });

    // Seed StockItem rows for this shop × all products in new sheet
    const productIds = [...incomingProductIds];
    if (productIds.length > 0) {
      await this.prisma.stockItem.createMany({
        data: productIds.map((productId) => ({ shopId, productId, qtyOnHand: 0 })),
        skipDuplicates: true,
      });
    }

    return activated;
  }

  async findActiveEntries(shopId: string) {
    const pl = await this.prisma.priceList.findFirst({
      where: { shopId, isActive: true },
      select: { id: true, name: true, month: true, year: true },
    });
    if (!pl) throw new NotFoundException('ไม่มีรายการราคาที่ใช้งานอยู่');

    const entries = await this.prisma.priceEntry.findMany({
      where: { priceListId: pl.id },
      select: {
        id: true,
        priceCash: true,
        priceCard: true,
        priceZeroPct: true,
        priceListed: true,
        costNormal: true,
        costPromo: true,
        marginCash: true,
        product: {
          select: { id: true, sku: true, brand: true, model: true, sizeNormalized: true, isSetPricing: true, dotYear: true, active: true, imageUrl: true },
        },
      },
      orderBy: [{ product: { sortOrder: 'asc' } }],
    });

    return { priceList: pl, entries };
  }

  async updateEntry(entryId: string, data: { priceCash?: number; priceCard?: number; priceZeroPct?: number }) {
    const entry = await this.prisma.priceEntry.findUnique({
      where: { id: entryId },
      select: { costNormal: true, costPromo: true },
    });
    if (!entry) throw new NotFoundException('ไม่พบรายการราคา');

    const cost = entry.costPromo ?? entry.costNormal;
    const updates: any = { ...data };

    if (data.priceCash !== undefined) {
      updates.marginCash = cost > 0
        ? parseFloat(((data.priceCash - cost) / data.priceCash * 100).toFixed(2))
        : null;
      updates.marginCard = null;
      updates.marginZeroPct = null;
    }

    return this.prisma.priceEntry.update({ where: { id: entryId }, data: updates });
  }

  async deactivate(id: string) {
    return this.prisma.priceList.update({ where: { id }, data: { isActive: false } });
  }

  async delete(id: string) {
    const exists = await this.prisma.priceList.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('ไม่พบรายการราคา');
    if (exists.isActive) throw new BadRequestException('ไม่สามารถลบรายการที่กำลังใช้งานอยู่ได้');

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

  async findActive(shopId: string) {
    const pl = await this.prisma.priceList.findFirst({
      where: { shopId, isActive: true },
      include: { entries: { include: { product: true } } },
    });
    if (!pl) throw new NotFoundException('ไม่มีรายการราคาที่ใช้งานอยู่');
    return pl;
  }

  async purgeOrphans(shopId: string) {
    const pl = await this.prisma.priceList.findFirst({
      where: { shopId, isActive: true },
      select: { entries: { select: { productId: true } } },
    });
    if (!pl) throw new NotFoundException('ไม่มีรายการราคาที่ใช้งานอยู่');

    const activeProductIds = pl.entries.map((e) => e.productId);
    const { count } = await this.prisma.product.updateMany({
      where: { shopId, id: { notIn: activeProductIds }, active: true },
      data: { active: false },
    });
    return { deactivated: count };
  }
}
