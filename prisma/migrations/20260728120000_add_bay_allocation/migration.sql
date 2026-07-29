-- CreateEnum
CREATE TYPE "BayMode" AS ENUM ('GENERAL', 'BOOKING_ONLY');

-- CreateEnum
CREATE TYPE "BayJobKind" AS ENUM ('WALK_IN', 'BOOKING');

-- CreateEnum
CREATE TYPE "BayJobStatus" AS ENUM ('BOOKED', 'WAITING', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "Bay" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "BayMode" NOT NULL DEFAULT 'GENERAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Bay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "requiresBay" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BayJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bayId" TEXT,
    "kind" "BayJobKind" NOT NULL,
    "status" "BayJobStatus" NOT NULL DEFAULT 'WAITING',
    "plateNumber" TEXT NOT NULL,
    "customerName" TEXT,
    "phone" TEXT,
    "vehicleModel" TEXT,
    "note" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "estimatedMinutes" INTEGER NOT NULL,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BayJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BayJobService" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "BayJobService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bay_shopId_name_key" ON "Bay"("shopId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Service_shopId_name_key" ON "Service"("shopId", "name");

-- CreateIndex
CREATE INDEX "BayJob_shopId_status_idx" ON "BayJob"("shopId", "status");

-- CreateIndex
CREATE INDEX "BayJob_shopId_scheduledAt_idx" ON "BayJob"("shopId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Bay" ADD CONSTRAINT "Bay_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayJob" ADD CONSTRAINT "BayJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayJob" ADD CONSTRAINT "BayJob_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayJob" ADD CONSTRAINT "BayJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayJobService" ADD CONSTRAINT "BayJobService_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BayJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayJobService" ADD CONSTRAINT "BayJobService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A bay holds at most one job at a time. The board is polled, so two staff on
-- two tablets can both see "bay 2 free" and both assign it — application-level
-- checks lose that race. Prisma cannot express a partial unique index, so this
-- is written by hand and MUST survive any future regeneration of this file.
-- The assign endpoint catches the resulting P2002 and returns a Thai 409.
CREATE UNIQUE INDEX "BayJob_bay_in_progress_key"
  ON "BayJob"("bayId") WHERE "status" = 'IN_PROGRESS';

-- Every existing shop gets the 4 physical bays it already has on the floor, so
-- the board is usable the moment this deploys. gen_random_uuid() is built in on
-- Postgres 13+, same as the displayToken backfill. All start GENERAL; the owner
-- flips one to BOOKING_ONLY in settings if they want a protected booking lane.
INSERT INTO "Bay" ("id", "shopId", "name", "mode", "active", "sortOrder")
SELECT gen_random_uuid()::text, s."id", 'ช่อง ' || n, 'GENERAL', true, n
FROM "Shop" s
CROSS JOIN generate_series(1, 4) AS n;
