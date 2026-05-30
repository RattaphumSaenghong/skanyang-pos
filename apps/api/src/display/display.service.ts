import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  // Per-staff display state (key: shopId:staffId)
  private staffQuotationCache = new Map<string, string | null>();
  private staffSearchCache = new Map<string, any[] | null>();

  private staffKey(shopId: string, staffId: string) {
    return `${shopId}:${staffId}`;
  }

  async getStaffState(shopId: string, staffId: string) {
    const key = this.staffKey(shopId, staffId);
    const quotationId = this.staffQuotationCache.get(key) ?? null;
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { promoText: true } });
    const promoText = shop?.promoText ?? null;

    if (!quotationId) return { mode: 'slideshow', promoText };

    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        items: { include: { product: { select: { brand: true, model: true, sizeNormalized: true, isSetPricing: true, imageUrl: true } } } },
        customer: { select: { name: true } },
      },
    });

    if (!quotation || quotation.status === 'CONVERTED' || quotation.status === 'CANCELLED') {
      this.staffQuotationCache.delete(key);
      return { mode: 'slideshow', promoText };
    }

    const enrichedItems = await Promise.all(
      quotation.items.map(async (item) => {
        const pe = await this.prisma.priceEntry.findUnique({ where: { id: item.priceEntryId } });
        return { ...item, priceListed: pe?.priceListed ?? 0, discTradeIn: pe?.discTradeIn ?? 0, discCard: pe?.discCard ?? 0, discCash: pe?.discCash ?? 0, discPromo: pe?.discPromo ?? 0 };
      }),
    );

    return { mode: 'quotation', quotation: { ...quotation, items: enrichedItems }, promoText };
  }

  setStaffQuotation(shopId: string, staffId: string, quotationId: string) {
    this.staffQuotationCache.set(this.staffKey(shopId, staffId), quotationId);
    return { ok: true };
  }

  clearStaffQuotation(shopId: string, staffId: string) {
    this.staffQuotationCache.delete(this.staffKey(shopId, staffId));
    return { ok: true };
  }

  setStaffSearchResults(shopId: string, staffId: string, results: any[] | null) {
    const key = this.staffKey(shopId, staffId);
    if (results === null) this.staffSearchCache.delete(key);
    else this.staffSearchCache.set(key, results);
    return { ok: true };
  }

  getStaffSearchResults(shopId: string, staffId: string) {
    return this.staffSearchCache.get(this.staffKey(shopId, staffId)) ?? null;
  }

  async uploadImage(shopId: string, file: Express.Multer.File) {
    const supabase = getSupabase();
    if (!supabase) throw new BadRequestException('Storage not configured');

    const path = `${shopId}/${Date.now()}-${file.originalname}`;
    const { error } = await supabase.storage
      .from('display-images')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw new BadRequestException(`Upload failed: ${error.message}`);

    const { data } = supabase.storage.from('display-images').getPublicUrl(path);
    return this.prisma.displayImage.create({
      data: { shopId, url: data.publicUrl },
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
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { promoText: true } });
    const promoText = shop?.promoText ?? null;
    if (quotation) return { mode: 'quotation', quotation, promoText };
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
