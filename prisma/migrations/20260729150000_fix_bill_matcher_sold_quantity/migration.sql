-- Column I (ขายรวม) is the known sold quantity. Preserve the matcher's old
-- output as matchedQty, remove ignored stock-balance inputs, and add the source
-- sold quantity as its own field.
ALTER TABLE "BillPoolItem" RENAME COLUMN "soldQty" TO "matchedQty";

ALTER TABLE "BillPoolItem"
DROP COLUMN "carriedQty",
DROP COLUMN "purchasedQty",
DROP COLUMN "availableQty",
ADD COLUMN "soldQty" INTEGER NOT NULL DEFAULT 0;
