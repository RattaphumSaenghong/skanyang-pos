-- DropForeignKey
ALTER TABLE "PriceEntry" DROP CONSTRAINT "PriceEntry_priceListId_fkey";

-- AddForeignKey
ALTER TABLE "PriceEntry" ADD CONSTRAINT "PriceEntry_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
