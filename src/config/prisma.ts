/**
 * Connection pool (database exhaustion):
 *  + new PrismaClient() -> create connection pool(5 - 10 minutes) -> too many connections -> crash server
 * Hot Reload
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  (globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }));
