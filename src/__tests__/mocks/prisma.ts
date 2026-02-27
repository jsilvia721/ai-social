import { PrismaClient } from "@prisma/client";
import { mockDeep, mockReset, DeepMockProxy } from "jest-mock-extended";

export const prismaMock = mockDeep<PrismaClient>();

// Call this at the top of any test file that needs DB mocking:
//
//   jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
//   beforeEach(() => mockReset(prismaMock));
//
// Import prismaMock before jest.mock so the factory closure captures it.

export function resetPrismaMock() {
  mockReset(prismaMock);
}

export type { DeepMockProxy };
