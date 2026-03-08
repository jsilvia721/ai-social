import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET, POST } from "@/app/api/businesses/route";
import { NextRequest } from "next/server";

function makeRequest(method: string, body?: object) {
  return new NextRequest("http://localhost/api/businesses", {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/businesses", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns businesses the user belongs to", async () => {
    mockAuthenticated();
    prismaMock.business.findMany.mockResolvedValue([
      { id: "biz-1", name: "Test Business", createdAt: new Date(), updatedAt: new Date() },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("biz-1");
    expect(prismaMock.business.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: mockSession.user.id } } },
      })
    );
  });
});

describe("POST /api/businesses", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest("POST", { name: "My Business" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest("POST", {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("name");
  });

  it("creates a business with the user as OWNER", async () => {
    mockAuthenticated();
    const created = { id: "biz-new", name: "New Corp", createdAt: new Date(), updatedAt: new Date() };
    prismaMock.business.create.mockResolvedValue(created as any);

    const res = await POST(makeRequest("POST", { name: "New Corp" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("biz-new");
    expect(prismaMock.business.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "New Corp",
          members: {
            create: { userId: mockSession.user.id, role: "OWNER" },
          },
        }),
      })
    );
  });
});
