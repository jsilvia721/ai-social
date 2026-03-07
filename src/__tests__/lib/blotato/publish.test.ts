import { publishPost } from "@/lib/blotato/publish";
import { BlotatoApiError, BlotatoRateLimitError } from "@/lib/blotato/client";

describe("publishPost", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function makeSuccessResponse(blotatoPostId = "blotato-post-123") {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: blotatoPostId, status: "published" }),
    } as Response;
  }

  it("returns blotatoPostId from the API response", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse("blotato-abc"));

    const result = await publishPost("account-1", "Hello world!");
    expect(result.blotatoPostId).toBe("blotato-abc");
  });

  it("sends accountId and content in request body", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    await publishPost("acct-xyz", "My content");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.accountId).toBe("acct-xyz");
    expect(body.content).toBe("My content");
  });

  it("includes mediaUrls in request body when provided", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    const mediaUrls = [
      "https://storage.example.com/img1.jpg",
      "https://storage.example.com/img2.jpg",
    ];
    await publishPost("acct-xyz", "With media", mediaUrls);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.mediaUrls).toEqual(mediaUrls);
  });

  it("omits mediaUrls field when not provided", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    await publishPost("acct-xyz", "No media");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body).not.toHaveProperty("mediaUrls");
  });

  it("throws BlotatoApiError on non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => "Internal error",
    } as Response);

    await expect(publishPost("acct", "content")).rejects.toThrow(BlotatoApiError);
  });

  it("throws BlotatoRateLimitError on 429", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "60" }),
      text: async () => "Rate limited",
    } as Response);

    await expect(publishPost("acct", "content")).rejects.toThrow(BlotatoRateLimitError);
  });
});
