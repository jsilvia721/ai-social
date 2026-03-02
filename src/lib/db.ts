import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  // Use a pg.Pool so we can pass ssl: { rejectUnauthorized: false }.
  // Railway's TCP proxy SSL cert is issued for postgres.railway.internal, not
  // the proxy hostname, so full cert verification (pg v8 default for sslmode=require)
  // fails with P1017. rejectUnauthorized: false allows SSL without hostname check.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
