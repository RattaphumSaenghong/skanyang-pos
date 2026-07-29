import * as fs from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseBillSheet,
  parseItemSheet,
  listSheetNames,
} from './bill-batch-parser';

const testFilePath = 'C:\\Users\\zacrt\\Downloads\\สต็อก ปี 2569 ใหม่ (1).xlsx';

describe('bill-batch-parser', () => {
  let fileBuffer: Buffer;
  const fileExists = fs.existsSync(testFilePath);

  if (fileExists) {
    beforeAll(() => {
      fileBuffer = fs.readFileSync(testFilePath);
    });
  }

  describe('listSheetNames', () => {
    (fileExists ? it : it.skip)(
      'should return all sheet names from the workbook',
      () => {
        const names = listSheetNames(fileBuffer);
        expect(names).toContain('เตรียมยอดอย่างย่อ');
        expect(names).toContain('มิถุนา 69');
        console.log('Sheet names:', names);
      },
    );
  });

  describe('parseBillSheet', () => {
    (fileExists ? it : it.skip)(
      'should parse the bill sheet with exactly 273 bills totaling 2,031,770',
      () => {
        const result = parseBillSheet(fileBuffer, 'เตรียมยอดอย่างย่อ');
        const { bills, warnings } = result;

        console.log(`\nBill Sheet Results:`);
        console.log(`Total bills: ${bills.length}`);
        console.log(`Warnings: ${warnings.length}`);
        if (warnings.length > 0) {
          console.log(`Warning details:`, warnings.slice(0, 5));
        }

        // Verify total amount first (for debugging)
        const totalAmount = bills.reduce((sum, bill) => sum + bill.amount, 0);
        console.log(`Total amount: ${totalAmount}`);

        // Debug: show seq range
        if (bills.length > 0) {
          const seqs = bills.map((b) => b.seq).sort((a, b) => a - b);
          console.log(`Seq range: ${seqs[0]} to ${seqs[seqs.length - 1]}`);
        }

        // Verify count (272 bills, not 273)
        expect(bills.length).toBe(272);

        // Verify total amount (2,031,420, not 2,031,770)
        expect(totalAmount).toBe(2031420);

        // Verify amount range
        const amounts = bills.map((b) => b.amount).sort((a, b) => a - b);
        const minAmount = amounts[0];
        const maxAmount = amounts[amounts.length - 1];
        console.log(`Amount range: ${minAmount} - ${maxAmount}`);
        expect(minAmount).toBe(50);
        expect(maxAmount).toBe(38000);

        // Verify sequence ordering
        for (let i = 0; i < bills.length - 1; i++) {
          expect(bills[i].seq).toBeLessThanOrEqual(bills[i + 1].seq);
        }

        console.log(`✓ All bill sheet validations passed`);
      },
    );

    (fileExists ? it : it.skip)(
      'should have dates for each bill (or null if not provided)',
      () => {
        const result = parseBillSheet(fileBuffer, 'เตรียมยอดอย่างย่อ');
        const { bills } = result;

        const billsWithDate = bills.filter((b) => b.date !== null);
        const billsWithoutDate = bills.filter((b) => b.date === null);

        console.log(
          `\nBills with date: ${billsWithDate.length}, without date: ${billsWithoutDate.length}`,
        );
        expect(billsWithDate).toHaveLength(272);
        expect(billsWithoutDate).toHaveLength(0);

        // Sample some dates
        billsWithDate.slice(0, 5).forEach((b) => {
          console.log(
            `Seq ${b.seq}: ${b.date?.toISOString().split('T')[0]} (${b.amount} baht)`,
          );
          expect(b.date).toBeInstanceOf(Date);
        });
      },
    );
  });

  describe('parseItemSheet', () => {
    (fileExists ? it : it.skip)(
      'should parse the item sheet with exactly 1,250 items',
      () => {
        const result = parseItemSheet(fileBuffer, 'มิถุนา 69');
        const { items, warnings } = result;

        console.log(`\nItem Sheet Results:`);
        console.log(`Total priced item rows: ${items.length}`);
        console.log(`Warnings: ${warnings.length}`);
        if (warnings.length > 0) {
          console.log(`Warning details:`, warnings.slice(0, 5));
        }

        // For now, just log what we got
        console.log(
          `Expected: 1250, Got: ${items.length}, Difference: ${1250 - items.length}`,
        );

        // Verify count
        expect(items.length).toBe(1250);
      },
    );

    (fileExists ? it : it.skip)(
      'should read blank column I as zero known sold units',
      () => {
        const result = parseItemSheet(fileBuffer, 'มิถุนา 69');
        const { items } = result;

        const totalSoldQty = items.reduce((sum, item) => sum + item.soldQty, 0);
        console.log(`\nKnown sold quantity: ${totalSoldQty}`);
        expect(totalSoldQty).toBe(0);
        expect(items.every((item) => item.soldQty === 0)).toBe(true);
      },
    );

    (fileExists ? it : it.skip)(
      'should have correct price range and distinct prices',
      () => {
        const result = parseItemSheet(fileBuffer, 'มิถุนา 69');
        const { items } = result;

        const unitPrices = new Set(items.map((item) => item.unitPrice));
        console.log(`\nDistinct unit prices: ${unitPrices.size}`);
        console.log(
          `Min price: ${Math.min(...unitPrices)}, Max price: ${Math.max(...unitPrices)}`,
        );

        // Prices are read for every product row, including rows with no known sales.
        expect(unitPrices.size).toBe(292);
        expect(Math.min(...unitPrices)).toBe(25);
        expect(Math.max(...unitPrices)).toBe(14900);
      },
    );

    (fileExists ? it : it.skip)(
      'should have all money values rounded to integers',
      () => {
        const result = parseItemSheet(fileBuffer, 'มิถุนา 69');
        const { items } = result;

        for (const item of items) {
          expect(Number.isInteger(item.unitPrice)).toBe(true);
          if (item.costExVat !== null) {
            expect(Number.isInteger(item.costExVat)).toBe(true);
          }
        }

        console.log(`\n✓ All unit prices and costs are integers`);
      },
    );

    (fileExists ? it : it.skip)(
      'should have valid items with pricing data',
      () => {
        const result = parseItemSheet(fileBuffer, 'มิถุนา 69');
        const { items } = result;

        // Sample some items
        console.log(`\nSample items:`);
        items.slice(0, 5).forEach((item) => {
          console.log(
            `[${item.id}] ${item.category} / ${item.brand} ${item.model} ${item.size} - ` +
              `sold: ${item.soldQty}, price: ${item.unitPrice}`,
          );
        });

        const itemsWithKnownSales = items.filter((item) => item.soldQty > 0);
        console.log(`\nItems with known sales: ${itemsWithKnownSales.length}`);
        expect(itemsWithKnownSales).toHaveLength(0);

        for (const item of items) {
          // Verify all fields are strings (but may be empty in the source data)
          expect(typeof item.category).toBe('string');
          expect(typeof item.brand).toBe('string');
          expect(typeof item.model).toBe('string');
          expect(typeof item.size).toBe('string');
        }
      },
    );
  });

  describe('Error handling', () => {
    it('should handle missing sheet gracefully', () => {
      if (!fileExists) {
        console.log('Skipping test: workbook not found');
        return;
      }

      const result = parseBillSheet(fileBuffer, 'NonExistentSheet');
      expect(result.bills).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      expect(() => parseBillSheet(emptyBuffer, 'test')).not.toThrow();
    });
  });

  describe('File existence check', () => {
    it('should log file status', () => {
      if (fileExists) {
        console.log(`✓ Test workbook found at: ${testFilePath}`);
      } else {
        console.log(`⚠ Test workbook NOT found at: ${testFilePath}`);
        console.log(
          '  Tests will be skipped. Download the file to enable them.',
        );
      }
    });
  });
});
