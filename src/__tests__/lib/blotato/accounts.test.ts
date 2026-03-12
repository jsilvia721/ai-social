import { z } from "zod";
import { BlotatoApiError } from "@/lib/blotato/client";
import { BlotatoAccountSchema, BlotatoAccountListSchema } from "@/lib/blotato/types";

// Mock the client module so we control what blotatoFetch returns
jest.mock("@/lib/blotato/client", () => ({
  blotatoFetch: jest.fn(),
  BlotatoApiError: jest.requireActual("@/lib/blotato/client").BlotatoApiError,
}));

// Disable mocks so listAccounts hits the (mocked) blotatoFetch
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: () => false,
}));

import { listAccounts, getAccount } from "@/lib/blotato/accounts";
import { blotatoFetch } from "@/lib/blotato/client";

const mockBlotatoFetch = blotatoFetch as jest.MockedFunction<typeof blotatoFetch>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("listAccounts", () => {
  it("unwraps items from the Blotato API response", async () => {
    const accounts = [
      { id: "acct-1", platform: "twitter", username: "user1" },
      { id: "acct-2", platform: "instagram", username: "user2" },
    ];
    mockBlotatoFetch.mockResolvedValue({ items: accounts });

    const result = await listAccounts();

    expect(result).toEqual(accounts);
  });

  it("returns empty array when items is empty", async () => {
    mockBlotatoFetch.mockResolvedValue({ items: [] });

    const result = await listAccounts();

    expect(result).toEqual([]);
  });

  it("passes the correct path and schema to blotatoFetch", async () => {
    mockBlotatoFetch.mockResolvedValue({ items: [] });

    await listAccounts();

    expect(mockBlotatoFetch).toHaveBeenCalledWith(
      "/users/me/accounts",
      expect.any(Object),
    );
  });
});

describe("getAccount", () => {
  it("returns matching account by ID", async () => {
    const accounts = [
      { id: "acct-1", platform: "twitter", username: "user1" },
      { id: "acct-2", platform: "instagram", username: "user2" },
    ];
    mockBlotatoFetch.mockResolvedValue({ items: accounts });

    const result = await getAccount("acct-2");

    expect(result).toEqual(accounts[1]);
  });

  it("throws BlotatoApiError when account not found", async () => {
    mockBlotatoFetch.mockResolvedValue({ items: [] });

    await expect(getAccount("nonexistent")).rejects.toThrow(BlotatoApiError);
  });
});

describe("BlotatoAccountListSchema (regression)", () => {
  const apiResponse = {
    items: [
      { id: "98432", platform: "twitter", fullname: "Jane", username: "jane" },
    ],
  };

  it("parses the actual Blotato API response shape { items: [...] }", () => {
    const result = BlotatoAccountListSchema.safeParse(apiResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].username).toBe("jane");
    }
  });

  it("old schema (z.array) rejects the wrapper object — proving the bug", () => {
    const oldSchema = z.array(BlotatoAccountSchema);
    const result = oldSchema.safeParse(apiResponse);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("expected array, received object");
    }
  });
});
