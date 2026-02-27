import { publishTweet } from "@/lib/platforms/twitter";

describe("publishTweet", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("posts to the Twitter v2 endpoint and returns id and url", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "tweet-123" } }),
    } as Response);

    const result = await publishTweet("access-token-abc", "Hello world!");

    expect(result).toEqual({
      id: "tweet-123",
      url: "https://twitter.com/i/web/status/tweet-123",
    });
  });

  it("sends the correct Authorization header", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "tweet-456" } }),
    } as Response);

    await publishTweet("my-token", "test tweet");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-token"
    );
  });

  it("sends the tweet content in the request body", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "tweet-789" } }),
    } as Response);

    await publishTweet("token", "My tweet content");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ text: "My tweet content" });
  });

  it("throws when the API response is not ok", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ title: "Unauthorized", status: 401 }),
    } as Response);

    await expect(publishTweet("bad-token", "tweet")).rejects.toThrow(
      "Twitter publish failed"
    );
  });
});
