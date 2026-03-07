import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
// ws is required for Neon's WebSocket adapter in Node.js/Lambda environments.
// Unconditional import is fine since production always connects to Neon.
import ws from "ws";

// The globalForPrisma pattern prevents multiple Prisma client instances during
// Next.js hot-reload in dev. In Lambda (NODE_ENV=production), the guard
// `!== production` means the cache is never written — but Lambda containers
// cache modules anyway, so each cold start creates exactly one client.
// This is correct behavior.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const log: ("query" | "error" | "warn")[] =
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"];

  // Neon serverless (production on AWS Lambda): use the Neon WebSocket adapter.
  // All other connections (local Docker, CI Postgres): use the standard pg pool.
  if (connectionString.includes("neon.tech")) {
    neonConfig.webSocketConstructor = ws;
    const adapter = new PrismaNeon({ connectionString });
    return new PrismaClient({ adapter, log });
  }

  const sslDisabled = connectionString.includes("sslmode=disable");
  // Default to secure TLS verification. Set PG_SSL_REJECT_UNAUTHORIZED=false
  // only if a specific environment genuinely requires skipping cert verification.
  const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false";
  const pool = new pg.Pool({
    connectionString,
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized } }),
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter, log });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
