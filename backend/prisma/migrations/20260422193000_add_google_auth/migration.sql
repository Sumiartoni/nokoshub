ALTER TABLE "WebUser"
ADD COLUMN "googleId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "WebUser_googleId_key" ON "WebUser"("googleId");
