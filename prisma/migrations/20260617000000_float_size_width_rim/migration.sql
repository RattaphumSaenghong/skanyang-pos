-- AlterTable: change sizeWidth and sizeRim from Int to Float (Double Precision)
-- to support commercial tire sizes with decimal widths/rims (e.g. 9.5R17.5, 11R22.5)
ALTER TABLE "Product" ALTER COLUMN "sizeWidth" TYPE DOUBLE PRECISION;
ALTER TABLE "Product" ALTER COLUMN "sizeRim" TYPE DOUBLE PRECISION;
