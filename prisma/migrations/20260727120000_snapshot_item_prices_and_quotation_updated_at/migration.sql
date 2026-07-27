-- Fix 1: snapshot price/discount fields onto QuotationItem.
-- QuotationItem.priceEntryId is a plain String with no FK constraint, and
-- 20260528000000_cascade_delete_price_entries made PriceList deletion cascade
-- to PriceEntry. Price-list re-imports therefore orphan quotation items, and
-- resolving prices at read time rendered those items as 0 on the customer
-- display. These columns mirror the existing unitPrice* snapshot pattern.
ALTER TABLE "QuotationItem" ADD COLUMN     "priceListed" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuotationItem" ADD COLUMN     "discTradeIn" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuotationItem" ADD COLUMN     "discCard" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuotationItem" ADD COLUMN     "discCash" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuotationItem" ADD COLUMN     "discPromo" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill every item whose PriceEntry still exists. Items whose entry was
-- already cascade-deleted keep 0 — that data is gone and cannot be recovered
-- here; they rendered as 0 before this migration too, so this is not a
-- regression. Going forward, create() writes these at insert time.
UPDATE "QuotationItem" qi
SET "priceListed" = pe."priceListed",
    "discTradeIn" = pe."discTradeIn",
    "discCard"    = pe."discCard",
    "discCash"    = pe."discCash",
    "discPromo"   = pe."discPromo"
FROM "PriceEntry" pe
WHERE pe."id" = qi."priceEntryId";

-- Fix 2: track last activity on a quotation.
-- Stale-draft cleanup previously measured age from createdAt, so a quote a
-- customer was still considering got cancelled 5 minutes after it was created
-- even if staff had just edited it. Seed existing rows from createdAt so the
-- cleanup behaves exactly as before for pre-existing data.
ALTER TABLE "Quotation" ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "Quotation" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "Quotation" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Quotation" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
