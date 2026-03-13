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

  function makeSuccessResponse(postSubmissionId = "blotato-post-123") {
    return {
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({ postSubmissionId }),
    } as Response;
  }

  it("returns blotatoPostId from the API response", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse("blotato-abc"));

    const result = await publishPost("account-1", "Hello world!", "TWITTER");
    expect(result.blotatoPostId).toBe("blotato-abc");
  });

  it("sends nested post object with content and target matching Blotato v2 schema", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    await publishPost("acct-xyz", "My content", "TWITTER");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.post.accountId).toBe("acct-xyz");
    expect(body.post.content.text).toBe("My content");
    expect(body.post.content.platform).toBe("twitter");
    expect(body.post.content.mediaUrls).toEqual([]);
    expect(body.post.target.targetType).toBe("twitter");
  });

  it("includes mediaUrls in content when provided", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    const mediaUrls = [
      "https://storage.example.com/img1.jpg",
      "https://storage.example.com/img2.jpg",
    ];
    await publishPost("acct-xyz", "With media", "INSTAGRAM", mediaUrls);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.post.content.mediaUrls).toEqual(mediaUrls);
    expect(body.post.content.platform).toBe("instagram");
    expect(body.post.target.targetType).toBe("instagram");
  });

  it("includes TikTok-specific target properties for TIKTOK platform", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    await publishPost("acct-xyz", "TikTok content", "TIKTOK", [
      "https://storage.example.com/video.mp4",
    ]);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.post.target).toEqual({
      targetType: "tiktok",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      disabledComments: false,
      disabledDuet: false,
      disabledStitch: false,
      isBrandedContent: false,
      isYourBrand: false,
      isAiGenerated: true,
    });
  });

  it("does not include TikTok-specific target properties for non-TikTok platforms", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    await publishPost("acct-xyz", "Twitter content", "TWITTER");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.post.target).toEqual({ targetType: "twitter" });
    expect(body.post.target).not.toHaveProperty("privacyLevel");
  });

  it("converts uppercase platform to lowercase for Blotato API", async () => {
    fetchSpy.mockResolvedValue(makeSuccessResponse());

    await publishPost("acct-xyz", "Content", "FACEBOOK");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.post.content.platform).toBe("facebook");
    expect(body.post.target.targetType).toBe("facebook");
  });

  it("throws BlotatoApiError on non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => "Internal error",
    } as Response);

    await expect(publishPost("acct", "content", "TWITTER")).rejects.toThrow(BlotatoApiError);
  });

  it("throws BlotatoRateLimitError on 429", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "60" }),
      text: async () => "Rate limited",
    } as Response);

    await expect(publishPost("acct", "content", "TWITTER")).rejects.toThrow(BlotatoRateLimitError);
  });
});
