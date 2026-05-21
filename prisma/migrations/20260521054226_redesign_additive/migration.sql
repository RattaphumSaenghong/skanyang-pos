-- CreateEnum
CREATE TYPE "SaleFlag" AS ENUM ('NORMAL', 'BELOW_COST', 'APPROVED', 'SPECIAL');

-- CreateEnum
CREATE TYPE "AuditEvent" AS ENUM ('LOGIN', 'LOGOUT', 'LOGIN_FAILED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "flag" "SaleFlag" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "flagApprovedAt" TIMESTAMP(3),
ADD COLUMN     "flagApprovedBy" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "activeDisplayQuotationId" TEXT;

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenBy" TEXT NOT NULL,
    "label" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sizeNormalized" TEXT NOT NULL,
    "qtyActual" INTEGER NOT NULL,
    "qtySystem" INTEGER NOT NULL,

    CONSTRAINT "StockSnapshotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisplayImage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisplayImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpWhitelist" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "event" "AuditEvent" NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshotEntry" ADD CONSTRAINT "StockSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StockSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplayImage" ADD CONSTRAINT "DisplayImage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpWhitelist" ADD CONSTRAINT "IpWhitelist_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
