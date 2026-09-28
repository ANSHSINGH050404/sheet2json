-- Accounts. Google is the only identity provider, so the Google account id is
-- the natural key; `email` is display-only because Google does not guarantee an
-- email address is stable across accounts.
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- The Google OAuth grant. Tokens are stored encrypted rather than plain: a
-- refresh token is a standing capability to read someone's spreadsheets, so a
-- leaked database on its own must not be enough to use it.
CREATE TABLE "google_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    -- Epoch milliseconds. A bigint because the unit is not milliseconds and
    -- Postgres has no unsigned integer to lean on.
    "accessTokenExpiresAt" BIGINT,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_accounts_pkey" PRIMARY KEY ("id")
);

-- Browser sessions. Only the SHA-256 digest of the cookie token is stored, so a
-- database leak cannot be replayed as a login.
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- Long-lived credentials for the public REST API. The plaintext key is shown
-- exactly once; `keyHash` verifies it and, being unique, also makes verification
-- a single index seek rather than a scan.
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- In-flight OAuth requests. Deleting the row on use is what makes the callback
-- single-use, and that is what makes `state` a real CSRF defence rather than a
-- token that merely looks like one.
CREATE TABLE "oauth_states" (
    "state" TEXT NOT NULL,
    "redirectTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state")
);

-- Fixed-window request counters. Rate limiting has to hold across serverless
-- instances, where process memory is per-instance and a limit kept in memory is
-- not a limit.
CREATE TABLE "rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- Recreate `extractions` to add the ownership columns in one step.
--
-- Existing rows keep their data and get `userId = NULL` and
-- `usedUserGrant = false`. They belong to no account, so they appear in nobody's
-- history: a deliberate consequence of moving to per-user history, and the reason
-- the old shared history is gone rather than kept as a public feed.
CREATE TABLE "extractions_new" (
    "id" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "gid" TEXT,
    "title" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "columnCount" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "userId" TEXT,
    "usedUserGrant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extractions_new_pkey" PRIMARY KEY ("id")
);

INSERT INTO "extractions_new" ("id", "spreadsheetId", "gid", "title", "sourceUrl", "rowCount", "columnCount", "data", "createdAt")
SELECT "id", "spreadsheetId", "gid", "title", "sourceUrl", "rowCount", "columnCount", "data", "createdAt" FROM "extractions";

DROP TABLE "extractions";
ALTER TABLE "extractions_new" RENAME TO "extractions";

-- Renaming the table does not rename the constraint, so Prisma would keep
-- reporting a schema drift. Reset the primary key to the name it expects.
ALTER TABLE "extractions" DROP CONSTRAINT "extractions_new_pkey";
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_userId_key" ON "google_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_sub_key" ON "google_accounts"("sub");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- The two indexes from the original migration, recreated with the new table.
CREATE INDEX "extractions_createdAt_idx" ON "extractions"("createdAt");

-- CreateIndex
CREATE INDEX "extractions_spreadsheetId_idx" ON "extractions"("spreadsheetId");

-- For the per-user history list, which is now the only way rows are read.
CREATE INDEX "extractions_userId_createdAt_idx" ON "extractions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_windowStart_idx" ON "rate_limit_buckets"("windowStart");

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
