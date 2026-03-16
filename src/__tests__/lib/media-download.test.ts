jest.mock("@/env", () => ({
  env: { REPLICATE_API_TOKEN: "test-token" },
}));
jest.mock("@/lib/storage", () => ({
  s3: {},
  bucket: "test-bucket",
  getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));
jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { downloadAndUploadVideo } from "@/lib/media";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("downloadAndUploadVideo", () => {
  it("rejects video URL from untrusted hostname", async () => {
    await expect(
      downloadAndUploadVideo("https://evil.com/video.mp4", "media/test.mp4")
    ).rejects.toThrow("Untrusted video source hostname: evil.com");
  });

  it("rejects response with non-video Content-Type", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
      body: new ReadableStream(),
    }) as unknown as typeof fetch;

    try {
      await expect(
        downloadAndUploadVideo(
          "https://replicate.delivery/video.mp4",
          "media/test.mp4"
        )
      ).rejects.toThrow("Expected video/* Content-Type, got: text/html; charset=utf-8");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("accepts response with video/mp4 Content-Type", async () => {
    const originalFetch = global.fetch;
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 0]));
        controller.close();
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "video/mp4" }),
      body: fakeStream,
    }) as unknown as typeof fetch;

    try {
      const result = await downloadAndUploadVideo(
        "https://replicate.delivery/video.mp4",
        "media/test.mp4"
      );
      expect(result).toBe("https://cdn.example.com/media/test.mp4");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("accepts response with video/quicktime Content-Type", async () => {
    const originalFetch = global.fetch;
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 0]));
        controller.close();
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "video/quicktime" }),
      body: fakeStream,
    }) as unknown as typeof fetch;

    try {
      const result = await downloadAndUploadVideo(
        "https://pbxt.replicate.delivery/video.mov",
        "media/test.mp4"
      );
      expect(result).toBe("https://cdn.example.com/media/test.mp4");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
