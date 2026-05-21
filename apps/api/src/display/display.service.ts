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
}
