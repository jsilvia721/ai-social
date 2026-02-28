import { publishInstagramPost } from "@/lib/platforms/instagram";

describe("publishInstagramPost", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("throws when no mediaUrls are provided", async () => {
    await expect(
      publishInstagramPost("token", "ig-user-id", "caption", [])
    ).rejects.toThrow("Instagram requires at least one image URL");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("single image post", () => {
    function setupSingleImageMocks(containerId = "container-123", postId = "ig-post-456") {
      fetchSpy
        // Step 1: create container
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: containerId }) } as Response)
        // Step 2: status check → FINISHED
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        // Step 3: publish
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: postId }) } as Response);
    }

    it("creates a container, polls status, then publishes", async () => {
      setupSingleImageMocks();

      const result = await publishInstagramPost(
        "access-token",
        "ig-user-id",
        "Test caption",
        ["https://example.com/img.jpg"]
      );

      expect(result).toEqual({ id: "ig-post-456" });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("sends image_url and media_type IMAGE to the container endpoint", async () => {
      setupSingleImageMocks();

      await publishInstagramPost(
        "access-token",
        "ig-user-id",
        "caption",
        ["https://example.com/img.jpg"]
      );

      const [containerUrl, containerOpts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(containerUrl).toContain("/ig-user-id/media");
      const body = JSON.parse(containerOpts.body as string);
      expect(body.image_url).toBe("https://example.com/img.jpg");
      expect(body.media_type).toBe("IMAGE");
      expect(body).not.toHaveProperty("is_carousel_item");
    });

    it("retries status check until FINISHED before publishing", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "c-1" }) } as Response)
        // First status check: IN_PROGRESS
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "IN_PROGRESS" }) } as Response)
        // Second status check: FINISHED
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "post-1" }) } as Response);

      const result = await publishInstagramPost("token", "ig-id", "caption", ["https://img.com/a.jpg"]);

      expect(result).toEqual({ id: "post-1" });
      // container create + 2 status checks + publish = 4 calls
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("throws when container status is ERROR", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "c-err" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "ERROR" }) } as Response);

      await expect(
        publishInstagramPost("token", "ig-id", "caption", ["https://img.com/a.jpg"])
      ).rejects.toThrow("Instagram media container processing failed");
    });

    it("throws when container creation fails", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "Invalid token" } }),
      } as Response);

      await expect(
        publishInstagramPost("bad-token", "ig-user-id", "caption", ["https://example.com/img.jpg"])
      ).rejects.toThrow("Instagram container creation failed");
    });

    it("throws when the publish step fails", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "container-123" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: "Publish error" } }),
        } as Response);

      await expect(
        publishInstagramPost("access-token", "ig-user-id", "caption", ["https://example.com/img.jpg"])
      ).rejects.toThrow("Instagram publish failed");
    });
  });

  describe("carousel post (multiple images)", () => {
    it("creates child containers, waits for each, creates carousel container, then publishes", async () => {
      fetchSpy
        // Child 1 container
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-1" }) } as Response)
        // Child 1 status
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        // Child 2 container
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-2" }) } as Response)
        // Child 2 status
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        // Carousel container
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "carousel-1" }) } as Response)
        // Carousel status
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        // Publish
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ig-post-carousel" }) } as Response);

      const result = await publishInstagramPost(
        "access-token",
        "ig-user-id",
        "Carousel caption",
        ["https://example.com/img1.jpg", "https://example.com/img2.jpg"]
      );

      expect(result).toEqual({ id: "ig-post-carousel" });
      expect(fetchSpy).toHaveBeenCalledTimes(7);
    });

    it("sets is_carousel_item on child containers", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-2" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "carousel-1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "post-1" }) } as Response);

      await publishInstagramPost(
        "token",
        "ig-id",
        "caption",
        ["https://img.com/a.jpg", "https://img.com/b.jpg"]
      );

      const childBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(childBody.is_carousel_item).toBe("true");
      expect(childBody).not.toHaveProperty("caption");
    });

    it("sends media_type CAROUSEL and comma-separated children to the carousel endpoint", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-2" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "carousel-1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "post-1" }) } as Response);

      await publishInstagramPost(
        "token",
        "ig-id",
        "My carousel",
        ["https://img.com/a.jpg", "https://img.com/b.jpg"]
      );

      // The carousel container create call is the 5th fetch call (index 4)
      const carouselBody = JSON.parse(fetchSpy.mock.calls[4][1].body as string);
      expect(carouselBody.media_type).toBe("CAROUSEL");
      expect(carouselBody.children).toBe("child-1,child-2");
      expect(carouselBody.caption).toBe("My carousel");
    });

    it("throws when carousel container creation fails", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-1" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "child-2" }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) } as Response)
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: "carousel failed" } }),
        } as Response);

      await expect(
        publishInstagramPost("token", "ig-id", "caption", ["https://img.com/a.jpg", "https://img.com/b.jpg"])
      ).rejects.toThrow("Instagram carousel creation failed");
    });
  });
});
