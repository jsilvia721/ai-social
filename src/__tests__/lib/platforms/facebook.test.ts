import { publishFacebookPost } from "@/lib/platforms/facebook";

describe("publishFacebookPost", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("text-only post", () => {
    it("posts to the page feed and returns the post id", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "page-post-123" }),
      } as Response);

      const result = await publishFacebookPost("access-token", "page-id", "Hello Facebook!");

      expect(result).toEqual({ id: "page-post-123" });
    });

    it("sends message and access_token to the /feed endpoint", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "post-id" }),
      } as Response);

      await publishFacebookPost("my-page-token", "page-id", "content");

      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/page-id/feed");
      const body = JSON.parse(options.body as string);
      expect(body.message).toBe("content");
      expect(body.access_token).toBe("my-page-token");
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

  describe("single photo post", () => {
    it("posts to /photos with url and caption", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "photo-id", post_id: "post-123" }),
      } as Response);

      const result = await publishFacebookPost(
        "token",
        "page-id",
        "Look at this!",
        ["https://example.com/img.jpg"]
      );

      expect(result).toEqual({ id: "post-123" });
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/page-id/photos");
      const body = JSON.parse(options.body as string);
      expect(body.url).toBe("https://example.com/img.jpg");
      expect(body.caption).toBe("Look at this!");
    });

    it("falls back to id when post_id is absent", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "photo-id-only" }),
      } as Response);

      const result = await publishFacebookPost("token", "page-id", "caption", [
        "https://example.com/img.jpg",
      ]);

      expect(result).toEqual({ id: "photo-id-only" });
    });

    it("throws when the photo post fails", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: "bad url" } }),
      } as Response);

      await expect(
        publishFacebookPost("token", "page-id", "caption", ["https://example.com/img.jpg"])
      ).rejects.toThrow("Facebook photo post failed");
    });
  });

  describe("multi-photo post", () => {
    it("uploads each photo as unpublished then creates a feed post with attached_media", async () => {
      fetchSpy
        // Upload photo 1
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "photo-1" }) } as Response)
        // Upload photo 2
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "photo-2" }) } as Response)
        // Feed post
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "feed-post-1" }) } as Response);

      const result = await publishFacebookPost(
        "token",
        "page-id",
        "Two photos!",
        ["https://example.com/a.jpg", "https://example.com/b.jpg"]
      );

      expect(result).toEqual({ id: "feed-post-1" });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("uploads photos with published=false", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "p1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "p2" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "feed-1" }) } as Response);

      await publishFacebookPost("token", "page-id", "caption", [
        "https://example.com/a.jpg",
        "https://example.com/b.jpg",
      ]);

      const photoBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(photoBody.published).toBe(false);
      expect(photoBody).not.toHaveProperty("caption");
    });

    it("sends attached_media with photo ids in the feed post", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "p1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "p2" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "feed-1" }) } as Response);

      await publishFacebookPost("token", "page-id", "Two photos!", [
        "https://example.com/a.jpg",
        "https://example.com/b.jpg",
      ]);

      const feedBody = JSON.parse(fetchSpy.mock.calls[2][1].body as string);
      expect(feedBody.attached_media).toEqual([
        { media_fbid: "p1" },
        { media_fbid: "p2" },
      ]);
      expect(feedBody.message).toBe("Two photos!");
    });

    it("throws when a photo upload fails", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "upload error" } }),
      } as Response);

      await expect(
        publishFacebookPost("token", "page-id", "caption", [
          "https://example.com/a.jpg",
          "https://example.com/b.jpg",
        ])
      ).rejects.toThrow("Facebook photo upload failed");
    });

    it("throws when the feed post fails", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "p1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "p2" }) } as Response)
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: "feed error" } }),
        } as Response);

      await expect(
        publishFacebookPost("token", "page-id", "caption", [
          "https://example.com/a.jpg",
          "https://example.com/b.jpg",
        ])
      ).rejects.toThrow("Facebook publish failed");
    });
  });
});
