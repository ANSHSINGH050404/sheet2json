-- CreateTable
CREATE TABLE "extractions" (
    "id" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "gid" TEXT,
    "title" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "columnCount" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extractions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extractions_createdAt_idx" ON "extractions"("createdAt");

-- CreateIndex
CREATE INDEX "extractions_spreadsheetId_idx" ON "extractions"("spreadsheetId");
