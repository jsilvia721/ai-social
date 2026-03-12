import { authOptions } from "@/lib/auth";

// Minimal mocks — we only need the authOptions object shape, not DB calls
jest.mock("@/lib/db", () => ({ prisma: {} }));
jest.mock("@/env", () => ({
  env: {
    NEXTAUTH_SECRET: "test-secret",
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    ALLOWED_EMAILS: "test@example.com",
    ADMIN_EMAILS: "",
  },
}));
jest.mock("next-auth/providers/google", () => ({
  __esModule: true,
  default: (opts: Record<string, string>) => ({ id: "google", name: "Google", ...opts }),
}));
jest.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: () => ({}),
}));

describe("authOptions", () => {
  it("uses jwt session strategy", () => {
    expect(authOptions.session?.strategy).toBe("jwt");
  });

  it("configures custom sign-in page", () => {
    expect(authOptions.pages?.signIn).toBe("/auth/signin");
  });

  it("includes Google provider", () => {
    expect(authOptions.providers).toHaveLength(1);
    expect(authOptions.providers[0]).toMatchObject({ id: "google" });
  });

  it("defines signIn, jwt, and session callbacks", () => {
    expect(authOptions.callbacks?.signIn).toBeDefined();
    expect(authOptions.callbacks?.jwt).toBeDefined();
    expect(authOptions.callbacks?.session).toBeDefined();
  });
});
