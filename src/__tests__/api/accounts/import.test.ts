import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/blotato/accounts");

import { POST } from "@/app/api/accounts/import/route";
import { listAccounts } from "@/lib/blotato/accounts";
import { NextRequest } from "next/server";

const mockListAccounts = listAccounts as jest.MockedFunction<typeof listAccounts>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/accounts/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/accounts/import", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await POST(makeRequest({ accountIds: ["acct-1"] }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when accountIds is missing", async () => {
    mockAuthenticated();

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("accountIds");
  });

  it("returns 400 when accountIds is empty", async () => {
    mockAuthenticated();

    const res = await POST(makeRequest({ accountIds: [] }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("accountIds");
  });

  it("returns 400 when accountIds contains invalid IDs not in Blotato", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "user1" },
    ]);

    const res = await POST(makeRequest({ accountIds: ["acct-1", "fake-id"] }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("fake-id");
  });

  it("returns 403 when user is not a member of the active business", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ accountIds: ["acct-1"] }));

    expect(res.status).toBe(403);
  });

  it("returns 201 on successful bulk import", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "user1" },
      { id: "acct-2", platform: "instagram", username: "user2" },
    ]);
    // Mock transaction to execute the callback
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      return fn(prismaMock);
    });
    prismaMock.socialAccount.upsert.mockResolvedValueOnce({
      id: "sa-1",
      platform: "TWITTER",
      username: "user1",
      blotatoAccountId: "acct-1",
      businessId: "biz-1",
    } as any);
    prismaMock.socialAccount.upsert.mockResolvedValueOnce({
      id: "sa-2",
      platform: "INSTAGRAM",
      username: "user2",
      blotatoAccountId: "acct-2",
      businessId: "biz-1",
    } as any);

    const res = await POST(makeRequest({ accountIds: ["acct-1", "acct-2"] }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported).toHaveLength(2);
    expect(body.imported[0].platform).toBe("TWITTER");
    expect(body.imported[1].platform).toBe("INSTAGRAM");
    // Verify transaction was used
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("uses upsert with blotatoAccountId as natural key", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "user1" },
    ]);
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.socialAccount.upsert.mockResolvedValue({
      id: "sa-1",
      platform: "TWITTER",
      username: "user1",
      blotatoAccountId: "acct-1",
      businessId: "biz-1",
    } as any);

    await POST(makeRequest({ accountIds: ["acct-1"] }));

    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blotatoAccountId: "acct-1" },
        create: expect.objectContaining({
          blotatoAccountId: "acct-1",
          platform: "TWITTER",
          username: "user1",
          businessId: "biz-1",
        }),
        update: expect.objectContaining({
          username: "user1",
          platform: "TWITTER",
        }),
      })
    );
  });

  it("handles Blotato API failure during re-validation", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    mockListAccounts.mockRejectedValue(new Error("Blotato unavailable"));

    const res = await POST(makeRequest({ accountIds: ["acct-1"] }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Blotato");
  });
});
