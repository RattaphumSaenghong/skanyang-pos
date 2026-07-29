-- CreateEnum
CREATE TYPE "BillBatchStatus" AS ENUM ('DRAFT', 'MATCHED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('UNMATCHED', 'MATCHED');

-- CreateEnum
CREATE TYPE "BillLineKind" AS ENUM ('ITEM', 'SERVICE', 'FREEFORM');

-- CreateTable
CREATE TABLE "BillBatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "sourceFile" TEXT,
    "status" "BillBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedAt" TIMESTAMP(3),

    CONSTRAINT "BillBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPoolItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "carriedQty" INTEGER NOT NULL,
    "purchasedQty" INTEGER NOT NULL,
    "availableQty" INTEGER NOT NULL,
    "soldQty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" INTEGER NOT NULL,
    "costExVat" INTEGER,

    CONSTRAINT "BillPoolItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "billDate" TIMESTAMP(3),
    "amount" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "status" "BillStatus" NOT NULL DEFAULT 'UNMATCHED',

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "kind" "BillLineKind" NOT NULL,
    "poolItemId" TEXT,
    "serviceFeeId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "BillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFee" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minPrice" INTEGER NOT NULL,
    "maxPrice" INTEGER NOT NULL,
    "maxQty" INTEGER NOT NULL DEFAULT 1,
    "group" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillBatch_shopId_periodYear_periodMonth_key" ON "BillBatch"("shopId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "BillPoolItem_batchId_idx" ON "BillPoolItem"("batchId");

-- CreateIndex
CREATE INDEX "Bill_batchId_idx" ON "Bill"("batchId");

-- CreateIndex
CREATE INDEX "BillLine_billId_idx" ON "BillLine"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFee_shopId_name_key" ON "ServiceFee"("shopId", "name");

-- AddForeignKey
ALTER TABLE "BillBatch" ADD CONSTRAINT "BillBatch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPoolItem" ADD CONSTRAINT "BillPoolItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BillBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BillBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_poolItemId_fkey" FOREIGN KEY ("poolItemId") REFERENCES "BillPoolItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFee" ADD CONSTRAINT "ServiceFee_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
