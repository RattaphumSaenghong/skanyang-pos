-- DropIndex
DROP INDEX "Product_sku_key";

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "number" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "number" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "email" TEXT;
