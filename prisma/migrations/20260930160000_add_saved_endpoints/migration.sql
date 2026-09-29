-- A saved endpoint is a live recipe, not a stored copy of the sheet rows.
CREATE TABLE "saved_endpoints" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_endpoints_userId_createdAt_idx"
    ON "saved_endpoints"("userId", "createdAt");

ALTER TABLE "saved_endpoints"
    ADD CONSTRAINT "saved_endpoints_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
