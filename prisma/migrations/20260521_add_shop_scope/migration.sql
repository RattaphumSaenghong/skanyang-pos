-- Add shopId to PriceList
ALTER TABLE "PriceList" ADD COLUMN "shopId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceList" ALTER COLUMN "shopId" DROP DEFAULT;

-- Add shopId to Product, drop old unique on sku, add composite unique
ALTER TABLE "Product" ADD COLUMN "shopId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_sku_key";
CREATE UNIQUE INDEX "Product_shopId_sku_key" ON "Product"("shopId", "sku");
