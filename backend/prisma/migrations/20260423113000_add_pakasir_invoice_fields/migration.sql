ALTER TABLE "Invoice"
ADD COLUMN "gatewayFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'MANUAL_QRIS',
ADD COLUMN "paymentMethod" TEXT,
ADD COLUMN "gatewayOrderId" TEXT,
ADD COLUMN "paymentUrl" TEXT,
ADD COLUMN "gatewayPayload" TEXT,
ADD COLUMN "gatewayCompletedAt" TIMESTAMP(3);

UPDATE "Invoice"
SET "provider" = 'MANUAL_QRIS'
WHERE "provider" IS NULL OR "provider" = '';

CREATE UNIQUE INDEX "Invoice_gatewayOrderId_key" ON "Invoice"("gatewayOrderId");
