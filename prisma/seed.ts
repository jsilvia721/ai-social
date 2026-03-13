/**
 * E2E test seed — creates deterministic fixtures for Playwright tests.
 * Idempotent: safe to run multiple times (uses upsert throughout).
 *
 * Run: npx tsx prisma/seed.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

import { seedDatabase } from "./seed-logic";

const connectionString = process.env.DATABASE_URL!;
const sslDisabled = connectionString.includes("sslmode=disable");
const pool = new pg.Pool({
  connectionString,
  ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

seedDatabase(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
