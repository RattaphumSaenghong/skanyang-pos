import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import * as path from 'path';
// pdfkit uses CJS export = pattern
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class QuotationEmailService {
  private resend = new Resend(process.env.RESEND_API_KEY);

  async send(quotation: any, shop: any, toEmail: string): Promise<void> {
    const pdfBuffer = await this.buildPdf(quotation, shop);
    const qNum = String(quotation.number).padStart(5, '0');

    await this.resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
      to: toEmail,
      subject: `ใบเสนอราคา #${qNum} — ${shop.name}`,
      html: this.buildHtml(quotation, shop, qNum),
      attachments: [
        {
          filename: `quotation-${qNum}.pdf`,
          content: pdfBuffer.toString('base64'),
        },
      ],
    });
  }

  private buildHtml(quotation: any, shop: any, qNum: string): string {
    const items: any[] = quotation.items ?? [];
    const rows = items
      .map(
        (item) => `
      <tr>
        <td style="padding:8px;border:1px solid #e5e7eb">${item.product.brand} ${item.product.model}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:center">${item.product.sizeNormalized}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:center">${item.qty}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:right">${item.unitPriceCash.toLocaleString()}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:right">${item.unitPriceCard.toLocaleString()}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:right">${item.unitPriceZeroPct.toLocaleString()}</td>
      </tr>`,
      )
      .join('');

    return `
<div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#111">
  <div style="background:#1d4ed8;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:20px">${shop.name}</h2>
    ${shop.phone ? `<p style="margin:4px 0 0;font-size:13px;opacity:.85">โทร ${shop.phone}</p>` : ''}
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="margin:0 0 4px"><strong>ใบเสนอราคา #${qNum}</strong></p>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280">วันที่ ${new Date(quotation.createdAt).toLocaleDateString('th-TH')}</p>
    ${quotation.plateNumber ? `<p style="margin:0 0 16px">ทะเบียน: <strong>${quotation.plateNumber}</strong></p>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">สินค้า</th>
          <th style="padding:8px;border:1px solid #e5e7eb">ขนาด</th>
          <th style="padding:8px;border:1px solid #e5e7eb">จำนวน</th>
          <th style="padding:8px;border:1px solid #e5e7eb">เงินสด</th>
          <th style="padding:8px;border:1px solid #e5e7eb">บัตร</th>
          <th style="padding:8px;border:1px solid #e5e7eb">0%</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${quotation.notes ? `<p style="margin-top:16px;font-size:13px;color:#374151">หมายเหตุ: ${quotation.notes}</p>` : ''}
    <p style="margin-top:24px;font-size:12px;color:#9ca3af">ราคาเป็นบาท (รวม VAT) — ใบเสนอราคามีผลภายใน 7 วัน</p>
  </div>
</div>`;
  }

  private buildPdf(quotation: any, shop: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const fontPath = path.join(__dirname, 'assets', 'Sarabun-Regular.ttf');
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('Sarabun', fontPath);
      doc.font('Sarabun');

      const qNum = String(quotation.number).padStart(5, '0');

      // Header
      doc.fontSize(16).text(shop.name || 'ส.การยาง', { align: 'center' });
      if (shop.phone) doc.fontSize(10).text(`โทร ${shop.phone}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      doc.fontSize(12).text(`ใบเสนอราคา #${qNum}`);
      doc.fontSize(10).text(`วันที่ ${new Date(quotation.createdAt).toLocaleDateString('th-TH')}`);
      if (quotation.plateNumber) doc.text(`ทะเบียน: ${quotation.plateNumber}`);
      doc.moveDown();

      // Table
      const cols = [160, 70, 30, 55, 55, 50, 50, 55, 55];
      const headers = ['สินค้า', 'ขนาด', 'จนวน', 'ราคาปกติ', 'ลดยางเก่า', 'ลดบัตร/สด', 'ลดโปรฯ', 'ราคา/เส้น', 'รวม'];
      const startX = 50;
      const ROW_H = 22;

      const drawRow = (cells: string[], y: number, isHeader = false) => {
        let x = startX;
        cells.forEach((cell, i) => {
          doc.rect(x, y, cols[i], ROW_H).stroke();
          if (isHeader) doc.fontSize(8).fillColor('#444444');
          else doc.fontSize(8).fillColor('#000000');
          const align = i === 0 || i === 1 ? 'left' : 'right';
          doc.text(cell, x + 3, y + 6, { width: cols[i] - 6, align });
          x += cols[i];
        });
      };

      const paymentLabels = ['0% 10เดือน', 'รูดบัตร', 'สด/โอน'];

      let rowY = doc.y;
      drawRow(headers, rowY, true);
      rowY += ROW_H;

      for (const item of quotation.items ?? []) {
        const discounts = [
          { price: item.unitPriceZeroPct, discCardCash: 0, discPromo: item.discPromo ?? 0, label: paymentLabels[0] },
          { price: item.unitPriceCard, discCardCash: item.discCard ?? 0, discPromo: item.discPromo ?? 0, label: paymentLabels[1] },
          { price: item.unitPriceCash, discCardCash: item.discCash ?? 0, discPromo: item.discPromo ?? 0, label: paymentLabels[2] },
        ];
        for (const d of discounts) {
          drawRow(
            [
              `${item.product.brand} ${item.product.model}`,
              item.product.sizeNormalized,
              String(item.qty),
              (item.priceListed ?? 0).toLocaleString(),
              (item.discTradeIn ?? 0) > 0 ? (item.discTradeIn).toLocaleString() : '—',
              d.discCardCash > 0 ? d.discCardCash.toLocaleString() : '—',
              d.discPromo > 0 ? d.discPromo.toLocaleString() : '—',
              d.price.toLocaleString(),
              (d.price * item.qty).toLocaleString(),
            ],
            rowY,
          );
          rowY += ROW_H;
        }
      }

      if (quotation.notes) {
        doc.moveDown(2).fontSize(10).text(`หมายเหตุ: ${quotation.notes}`);
      }

      doc.end();
    });
  }
}
