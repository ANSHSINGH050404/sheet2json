import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '#generated/prisma/client'

/**
 * A single Prisma client for the whole server process.
 *
 * The `pg` adapter speaks the standard PostgreSQL wire protocol, so the exact
 * same code path works against Neon (use the pooled connection string) and
 * against a local PostgreSQL instance.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and add your PostgreSQL connection string.',
    )
  }
  return url
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: getDatabaseUrl() })
    globalForPrisma.prisma = new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }
  return globalForPrisma.prisma
}
