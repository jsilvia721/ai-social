import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "node",
  // setupFiles runs BEFORE any module is imported — required so process.env
  // is populated before src/env.ts runs its synchronous Zod parse.
  setupFiles: ["<rootDir>/src/__tests__/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/__tests__/**/*.test.ts?(x)"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    // Framework / generated files
    "!src/**/*.d.ts",
    "!src/app/globals.css",
    "!src/app/**/layout.tsx",
    "!src/app/**/page.tsx",         // server components — DB-coupled, covered via API route tests
    "!src/components/ui/**",        // shadcn/ui — generated, no logic
    "!src/components/providers/**",
    "!src/types/**",
    "!src/instrumentation.ts",
    "!src/middleware.ts",
    // Config / setup files — no testable business logic
    "!src/lib/auth.ts",             // NextAuth config
    "!src/lib/db.ts",               // Prisma singleton
    "!src/lib/storage.ts",          // AWS S3 client
    "!src/lib/utils.ts",            // cn() one-liner (shadcn helper)
    // React components — need React Testing Library (deferred)
    "!src/components/**",
  ],
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 75,
      functions: 70,
      lines: 75,
    },
  },
};

export default createJestConfig(config);
