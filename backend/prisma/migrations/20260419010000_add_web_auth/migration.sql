CREATE TABLE "WebUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "telegramId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebTelegramLinkCode" (
    "id" TEXT NOT NULL,
    "webUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebTelegramLinkCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebUser_email_key" ON "WebUser"("email");
CREATE UNIQUE INDEX "WebUser_telegramId_key" ON "WebUser"("telegramId");
CREATE UNIQUE INDEX "WebTelegramLinkCode_code_key" ON "WebTelegramLinkCode"("code");
CREATE INDEX "WebTelegramLinkCode_webUserId_idx" ON "WebTelegramLinkCode"("webUserId");
CREATE INDEX "WebTelegramLinkCode_expiresAt_idx" ON "WebTelegramLinkCode"("expiresAt");

ALTER TABLE "WebUser"
ADD CONSTRAINT "WebUser_telegramId_fkey"
FOREIGN KEY ("telegramId") REFERENCES "User"("telegramId")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebTelegramLinkCode"
ADD CONSTRAINT "WebTelegramLinkCode_webUserId_fkey"
FOREIGN KEY ("webUserId") REFERENCES "WebUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
