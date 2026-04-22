CREATE TABLE "PendingWebRegistration" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "otpHash" TEXT NOT NULL,
    "otpExpiresAt" TIMESTAMP(3) NOT NULL,
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "otpSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingWebRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingWebRegistration_email_key" ON "PendingWebRegistration"("email");
CREATE INDEX "PendingWebRegistration_otpExpiresAt_idx" ON "PendingWebRegistration"("otpExpiresAt");
