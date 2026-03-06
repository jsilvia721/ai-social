import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/jwt", () => ({ encode: jest.fn().mockResolvedValue("mock-jwt-token") }));

import { GET } from "@/app/api/test/session/route";
import { NextRequest } from "next/server";

function makeRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost/api/test/session");
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/test/session", () => {
  describe("outside test environment", () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      // Temporarily set to non-test
      Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.env, "NODE_ENV", { value: originalEnv, configurable: true });
    });

    it("returns 404 in production environment", async () => {
      const res = await GET(makeRequest({ email: "test@example.com" }));
      expect(res.status).toBe(404);
      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });
  });

  describe("in test environment", () => {
    it("returns 400 when email is missing", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(400);
    });

    it("returns 403 when email is not in ALLOWED_EMAILS", async () => {
      const res = await GET(makeRequest({ email: "notallowed@example.com" }));
      expect(res.status).toBe(403);
      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });

    it("upserts user and sets session cookie for allowed email", async () => {
      prismaMock.user.upsert.mockResolvedValue({
        id: "user-e2e-1",
        email: "test@example.com",
        name: "Test User",
        emailVerified: null,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await GET(makeRequest({ email: "test@example.com" }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.userId).toBe("user-e2e-1");

      // Session cookie should be set
      const cookieHeader = res.headers.get("set-cookie");
      expect(cookieHeader).toContain("next-auth.session-token=mock-jwt-token");
    });
  });
});
