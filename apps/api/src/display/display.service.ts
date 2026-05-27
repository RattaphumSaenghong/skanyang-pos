import { Injectable, NotFoundException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../common/prisma/prisma.service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

@Injectable()
export class DisplayService {
  constructor(private prisma: PrismaService) {}

  // Ephemeral per-shop search results (cleared on server restart — acceptable for live display)
  private searchCache = new Map<string, any[] | null>();

  async uploadImage(shopId: string, file: Express.Multer.File) {
    let url = '';
    try {
      const supabase = getSupabase();
      if (supabase) {
        const path = `${shopId}/${Date.now()}-${file.originalname}`;
        const { error } = await supabase.storage
          .from('display-images')
          .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
        if (!error) {
          const { data } = supabase.storage.from('display-images').getPublicUrl(path);
          url = data.publicUrl;
        }
      }
    } catch {
      // Storage upload failure is non-fatal
    }

    return this.prisma.displayImage.create({
      data: { shopId, url },
    });
  }

  getImages(shopId: string) {
    return this.prisma.displayImage.findMany({
      where: { shopId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async deleteImage(id: string, shopId: string) {
    const image = await this.prisma.displayImage.findFirst({ where: { id, shopId } });
    if (!image) throw new NotFoundException('ไม่พบรูปภาพ');
    return this.prisma.displayImage.update({ where: { id }, data: { active: false } });
  }

  async setActiveQuotation(shopId: string, quotationId: string) {
    await this.prisma.shop.update({
      where: { id: shopId },
      data: { activeDisplayQuotationId: quotationId },
    });
    return { ok: true };
  }

  async getActiveQuotation(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { activeDisplayQuotationId: true },
    });
    if (!shop?.activeDisplayQuotationId) return null;

    const quotation = await this.prisma.quotation.findUnique({
      where: { id: shop.activeDisplayQuotationId },
      include: {
        items: { include: { product: { select: { brand: true, model: true, sizeNormalized: true, isSetPricing: true, imageUrl: true } } } },
        customer: { select: { name: true } },
      },
    });
    if (!quotation) return null;

    // Auto-clear if the quotation has ended
    if (quotation.status === 'CONVERTED' || quotation.status === 'CANCELLED') {
      await this.prisma.shop.update({
        where: { id: shopId },
        data: { activeDisplayQuotationId: null },
      });
      return null;
    }

    // Enrich items with discount fields from their price entries (same as QuotationsService.findOne)
    const enrichedItems = await Promise.all(
      quotation.items.map(async (item) => {
        const pe = await this.prisma.priceEntry.findUnique({ where: { id: item.priceEntryId } });
        return {
          ...item,
          priceListed: pe?.priceListed ?? 0,
          discTradeIn: pe?.discTradeIn ?? 0,
          discCard: pe?.discCard ?? 0,
          discCash: pe?.discCash ?? 0,
          discPromo: pe?.discPromo ?? 0,
        };
      }),
    );

    return { ...quotation, items: enrichedItems };
  }

  async clearActiveQuotation(shopId: string) {
    await this.prisma.shop.update({
      where: { id: shopId },
      data: { activeDisplayQuotationId: null },
    });
    return { ok: true };
  }

  async getState(shopId: string) {
    const quotation = await this.getActiveQuotation(shopId);
    if (quotation) return { mode: 'quotation', quotation };
    return { mode: 'slideshow' };
  }

  setSearchResults(shopId: string, results: any[] | null) {
    if (results === null) this.searchCache.delete(shopId);
    else this.searchCache.set(shopId, results);
    return { ok: true };
  }

  getSearchResults(shopId: string) {
    return this.searchCache.get(shopId) ?? null;
  }
}
