import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!;
  // Private network connections (sslmode=disable in URL) need no SSL.
  // Public proxy connections need ssl: { rejectUnauthorized: false } because
  // Railway's proxy cert is issued for postgres.railway.internal, not the proxy
  // hostname, so full cert verification fails.
  const sslDisabled = connectionString.includes("sslmode=disable");
  const pool = new pg.Pool({
    connectionString,
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
