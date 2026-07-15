-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isNonPromo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "isNonPromo" BOOLEAN NOT NULL DEFAULT false;
