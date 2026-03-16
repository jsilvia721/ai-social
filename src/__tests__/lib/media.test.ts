jest.mock("@/lib/mocks/config");
jest.mock("@/env", () => ({
  env: { REPLICATE_API_TOKEN: "test-token" },
}));
// Use a global holder to avoid hoisting issues with jest.mock factory
const holder: { run: jest.Mock } = { run: jest.fn() };
jest.mock("replicate", () => {
  return jest.fn().mockImplementation(() => ({
    run: (...args: unknown[]) => holder.run(...args),
  }));
});

import { generateImage } from "@/lib/media";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

beforeEach(() => {
  jest.clearAllMocks();
  holder.run = jest.fn();
});

describe("generateImage", () => {
  describe("mock mode", () => {
    beforeEach(() => {
      mockShouldMock.mockReturnValue(true);
    });

    it("returns a 1x1 transparent PNG in mock mode", async () => {
      const result = await generateImage("test prompt");

      expect(result.mimeType).toBe("image/png");
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(holder.run).not.toHaveBeenCalled();
    });
  });

  describe("real mode", () => {
    beforeEach(() => {
      mockShouldMock.mockReturnValue(false);
    });

    it("calls Replicate Flux 1.1 Pro and returns the image buffer (URL output)", async () => {
      const fakeImageData = Buffer.from("fake-image-data");
      // Replicate returns a URL string for Flux
      holder.run.mockResolvedValue("https://replicate.delivery/fake-image.webp");

      // Mock fetch for the image URL
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeImageData.buffer),
      }) as unknown as typeof fetch;

      try {
        const result = await generateImage("a beautiful sunset");

        expect(holder.run).toHaveBeenCalledWith(
          "black-forest-labs/flux-1.1-pro",
          expect.objectContaining({
            input: expect.objectContaining({
              prompt: "a beautiful sunset",
              aspect_ratio: "1:1",
            }),
          })
        );
        expect(result.mimeType).toBe("image/webp");
        expect(result.buffer).toBeInstanceOf(Buffer);
        expect(result.buffer.length).toBeGreaterThan(0);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("handles ReadableStream output", async () => {
      const fakeData = new Uint8Array([1, 2, 3, 4]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(fakeData);
          controller.close();
        },
      });
      holder.run.mockResolvedValue(stream);

      const result = await generateImage("test stream");

      expect(result.mimeType).toBe("image/webp");
      expect(result.buffer).toEqual(Buffer.from(fakeData));
    });

    it("throws when Replicate returns unexpected output", async () => {
      holder.run.mockResolvedValue(42);

      await expect(generateImage("test")).rejects.toThrow(
        "Replicate returned unexpected output format"
      );
    });

    it("throws when image data is empty", async () => {
      const emptyStream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      holder.run.mockResolvedValue(emptyStream);

      await expect(generateImage("test")).rejects.toThrow(
        "Replicate returned empty image data"
      );
    });

    it("sanitizes prompt: strips control characters", async () => {
      const fakeData = new Uint8Array([1, 2, 3]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(fakeData);
          controller.close();
        },
      });
      holder.run.mockResolvedValue(stream);

      await generateImage("hello\x00world\x1Ftest");

      expect(holder.run).toHaveBeenCalledWith(
        "black-forest-labs/flux-1.1-pro",
        expect.objectContaining({
          input: expect.objectContaining({
            prompt: "helloworldtest",
          }),
        })
      );
    });

    it("sanitizes prompt: truncates to 1900 chars", async () => {
      const fakeData = new Uint8Array([1, 2, 3]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(fakeData);
          controller.close();
        },
      });
      holder.run.mockResolvedValue(stream);

      const longPrompt = "a".repeat(3000);
      await generateImage(longPrompt);

      const calledPrompt = holder.run.mock.calls[0][1].input.prompt;
      expect(calledPrompt.length).toBe(1900);
    });

    it("rejects image URL from untrusted hostname (SSRF guard)", async () => {
      // Replicate returns a URL from an untrusted domain
      holder.run.mockResolvedValue("https://evil.com/malicious-image.webp");

      await expect(generateImage("test prompt")).rejects.toThrow(
        "Untrusted image source hostname: evil.com"
      );
    });

    it("allows image URL from replicate.delivery", async () => {
      const fakeImageData = Buffer.from("fake-image-data");
      holder.run.mockResolvedValue("https://replicate.delivery/image.webp");

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeImageData.buffer),
      }) as unknown as typeof fetch;

      try {
        const result = await generateImage("test prompt");
        expect(result.buffer).toBeInstanceOf(Buffer);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("allows image URL from pbxt.replicate.delivery", async () => {
      const fakeImageData = Buffer.from("fake-image-data");
      holder.run.mockResolvedValue("https://pbxt.replicate.delivery/image.webp");

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeImageData.buffer),
      }) as unknown as typeof fetch;

      try {
        const result = await generateImage("test prompt");
        expect(result.buffer).toBeInstanceOf(Buffer);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
