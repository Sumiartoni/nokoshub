-- Alter pending registrations to support Google signup and referral attribution
ALTER TABLE "PendingWebRegistration"
ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "PendingWebRegistration"
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "referralCodeUsed" TEXT;

-- Add referral fields to web users
ALTER TABLE "WebUser"
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "referredDepositQualifiedAt" TIMESTAMP(3),
ADD COLUMN     "referralRewardGrantedAt" TIMESTAMP(3),
ADD COLUMN     "referralRewardAmount" INTEGER NOT NULL DEFAULT 0;

UPDATE "WebUser"
SET "referralCode" = UPPER("id")
WHERE "referralCode" IS NULL;

ALTER TABLE "WebUser"
ALTER COLUMN "referralCode" SET NOT NULL;

-- Indexes
CREATE INDEX "PendingWebRegistration_referredById_idx" ON "PendingWebRegistration"("referredById");
CREATE INDEX "WebUser_referredById_idx" ON "WebUser"("referredById");
CREATE UNIQUE INDEX "WebUser_referralCode_key" ON "WebUser"("referralCode");

-- Foreign keys
ALTER TABLE "PendingWebRegistration"
ADD CONSTRAINT "PendingWebRegistration_referredById_fkey"
FOREIGN KEY ("referredById") REFERENCES "WebUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebUser"
ADD CONSTRAINT "WebUser_referredById_fkey"
FOREIGN KEY ("referredById") REFERENCES "WebUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
