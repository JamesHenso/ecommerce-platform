import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Connection pool (database exhaustion):
 *  + new PrismaClient() -> create connection pool(5 - 10 minutes) -> too many connections -> crash server
 * Hot Reload
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to initialize Prisma");
}

const adapter = new PrismaPg({ connectionString });

export const prisma =
  globalForPrisma.prisma ||
  (globalForPrisma.prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }));
