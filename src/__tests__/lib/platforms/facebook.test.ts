import { publishFacebookPost } from "@/lib/platforms/facebook";

describe("publishFacebookPost", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("posts to the page feed and returns the post id", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "page-post-123" }),
    } as Response);

    const result = await publishFacebookPost(
      "access-token",
      "page-id-abc",
      "Hello Facebook!"
    );

    expect(result).toEqual({ id: "page-post-123" });
  });

  it("includes the access_token in the request body", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "post-id" }),
    } as Response);

    await publishFacebookPost("my-page-token", "page-id", "content");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.access_token).toBe("my-page-token");
    expect(body.message).toBe("content");
  });

  it("includes the link when provided", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "post-id" }),
    } as Response);

    await publishFacebookPost("token", "page-id", "content", "https://example.com");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.link).toBe("https://example.com");
  });

  it("throws when the API response is not ok", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "Invalid OAuth access token" } }),
    } as Response);

    await expect(
      publishFacebookPost("bad-token", "page-id", "content")
    ).rejects.toThrow("Facebook publish failed");
  });
});
