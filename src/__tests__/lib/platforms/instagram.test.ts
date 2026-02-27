import { publishInstagramPost } from "@/lib/platforms/instagram";

describe("publishInstagramPost", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("creates a media container then publishes it, returning the post id", async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "container-123" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ig-post-456" }),
      } as Response);

    const result = await publishInstagramPost(
      "access-token",
      "ig-user-id",
      "Test caption"
    );

    expect(result).toEqual({ id: "ig-post-456" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws when the container creation step fails", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: "Invalid token" } }),
    } as Response);

    await expect(
      publishInstagramPost("bad-token", "ig-user-id", "caption")
    ).rejects.toThrow("Instagram container creation failed");
  });

  it("throws when the publish step fails", async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "container-123" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "Publish error" } }),
      } as Response);

    await expect(
      publishInstagramPost("access-token", "ig-user-id", "caption")
    ).rejects.toThrow("Instagram publish failed");
  });
});
