import { publishTweet } from "@/lib/platforms/twitter";

describe("publishTweet", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("without media", () => {

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
  }); // end "without media"

  describe("with mediaUrls", () => {
    function makeFetchMock(mediaIdString = "mid-1", tweetId = "tweet-123") {
      return jest.fn().mockImplementation(async (url: string) => {
        if (url === "https://example.com/img.jpg") {
          return {
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(8),
            headers: new Headers({ "content-type": "image/jpeg" }),
          };
        }
        if ((url as string).includes("upload.twitter.com")) {
          return { ok: true, json: async () => ({ media_id_string: mediaIdString }) };
        }
        // api.twitter.com/2/tweets
        return { ok: true, json: async () => ({ data: { id: tweetId } }) };
      });
    }

    it("fetches the file, uploads to Twitter, and includes media_ids in the tweet body", async () => {
      fetchSpy.mockImplementation(makeFetchMock());

      const result = await publishTweet("token", "Hello!", ["https://example.com/img.jpg"]);

      expect(result.id).toBe("tweet-123");
      const tweetCall = fetchSpy.mock.calls.find(([url]: [string]) =>
        url.includes("api.twitter.com/2/tweets")
      )!;
      const body = JSON.parse(tweetCall[1].body as string);
      expect(body.media).toEqual({ media_ids: ["mid-1"] });
    });

    it("uploads to the Twitter v1.1 media endpoint with the access token", async () => {
      fetchSpy.mockImplementation(makeFetchMock());

      await publishTweet("my-token", "Hello!", ["https://example.com/img.jpg"]);

      const uploadCall = fetchSpy.mock.calls.find(([url]: [string]) =>
        url.includes("upload.twitter.com")
      )!;
      expect(uploadCall[1].headers).toMatchObject({
        Authorization: "Bearer my-token",
      });
    });

    it("does not include a media field when mediaUrls is empty", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: "tweet-no-media" } }),
      } as Response);

      await publishTweet("token", "No media");

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body).not.toHaveProperty("media");
    });

    it("throws when the media file cannot be fetched", async () => {
      fetchSpy.mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() });

      await expect(
        publishTweet("token", "Hello!", ["https://example.com/bad.jpg"])
      ).rejects.toThrow("Failed to fetch media from");
    });

    it("throws when the Twitter media upload fails", async () => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (url === "https://example.com/img.jpg") {
          return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: new Headers({ "content-type": "image/jpeg" }) };
        }
        return { ok: false, json: async () => ({ error: "media_upload_failed" }) };
      });

      await expect(
        publishTweet("token", "Hello!", ["https://example.com/img.jpg"])
      ).rejects.toThrow("Twitter media upload failed");
    });
  });
});
