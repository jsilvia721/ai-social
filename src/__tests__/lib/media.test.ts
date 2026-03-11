jest.mock("@/lib/mocks/config");
jest.mock("@/env", () => ({
  env: { GOOGLE_AI_API_KEY: "test-key" },
}));

// Use a global holder to avoid hoisting issues with jest.mock factory
// The factory is hoisted above const declarations, so we need a global reference
const holder: { generateImages: jest.Mock } = { generateImages: jest.fn() };
jest.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateImages: (...args: unknown[]) => holder.generateImages(...args) };
  },
}));

import { generateImage } from "@/lib/media";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

beforeEach(() => {
  jest.clearAllMocks();
  holder.generateImages = jest.fn();
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
      expect(holder.generateImages).not.toHaveBeenCalled();
    });
  });

  describe("real mode", () => {
    beforeEach(() => {
      mockShouldMock.mockReturnValue(false);
    });

    it("calls Gemini Imagen 4 and returns the image buffer", async () => {
      const fakeBase64 = Buffer.from("fake-image-data").toString("base64");
      holder.generateImages.mockResolvedValue({
        generatedImages: [
          { image: { imageBytes: fakeBase64 } },
        ],
      });

      const result = await generateImage("a beautiful sunset");

      expect(holder.generateImages).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "imagen-4.0-generate-001",
          prompt: "a beautiful sunset",
          config: expect.objectContaining({
            numberOfImages: 1,
            aspectRatio: "1:1",
          }),
        })
      );
      expect(result.mimeType).toBe("image/png");
      expect(result.buffer).toEqual(Buffer.from(fakeBase64, "base64"));
    });

    it("throws when Gemini returns no image data", async () => {
      holder.generateImages.mockResolvedValue({
        generatedImages: [],
      });

      await expect(generateImage("test")).rejects.toThrow(
        "Gemini returned no image data"
      );
    });

    it("throws when generatedImages is null/undefined", async () => {
      holder.generateImages.mockResolvedValue({
        generatedImages: null,
      });

      await expect(generateImage("test")).rejects.toThrow(
        "Gemini returned no image data"
      );
    });

    it("sanitizes prompt: strips control characters", async () => {
      const fakeBase64 = Buffer.from("data").toString("base64");
      holder.generateImages.mockResolvedValue({
        generatedImages: [{ image: { imageBytes: fakeBase64 } }],
      });

      await generateImage("hello\x00world\x1Ftest");

      expect(holder.generateImages).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "helloworldtest",
        })
      );
    });

    it("sanitizes prompt: truncates to 1900 chars", async () => {
      const fakeBase64 = Buffer.from("data").toString("base64");
      holder.generateImages.mockResolvedValue({
        generatedImages: [{ image: { imageBytes: fakeBase64 } }],
      });

      const longPrompt = "a".repeat(3000);
      await generateImage(longPrompt);

      const calledPrompt = holder.generateImages.mock.calls[0][0].prompt;
      expect(calledPrompt.length).toBe(1900);
    });
  });
});
