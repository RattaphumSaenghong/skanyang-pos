-- Split Shop.promoText into brand-specific fields
ALTER TABLE "Shop" ADD COLUMN "promoTextMichelin" TEXT;
ALTER TABLE "Shop" ADD COLUMN "promoTextBfGoodrich" TEXT;

UPDATE "Shop" SET "promoTextMichelin" = "promoText";

ALTER TABLE "Shop" DROP COLUMN "promoText";
