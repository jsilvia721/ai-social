jest.mock("@/lib/mocks/config");
jest.mock("@/env", () => ({
  env: { REPLICATE_API_TOKEN: "test-token", NEXTAUTH_URL: "https://app.example.com" },
}));

// Use a global holder to avoid hoisting issues with jest.mock factory
const holder: {
  create: jest.Mock;
} = { create: jest.fn() };

jest.mock("replicate", () => {
  return jest.fn().mockImplementation(() => ({
    predictions: {
      create: (...args: unknown[]) => holder.create(...args),
    },
  }));
});

import { generateVideo } from "@/lib/media";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

beforeEach(() => {
  jest.clearAllMocks();
  holder.create = jest.fn();
});

describe("generateVideo", () => {
  describe("mock mode", () => {
    beforeEach(() => {
      mockShouldMock.mockReturnValue(true);
    });

    it("returns a mock prediction ID without calling Replicate", async () => {
      const result = await generateVideo({
        prompt: "a sunset timelapse",
        aspectRatio: "16:9",
        webhookUrl: "https://app.example.com/api/webhooks/replicate",
      });

      expect(result).toEqual({ predictionId: "mock-prediction-id" });
      expect(holder.create).not.toHaveBeenCalled();
    });
  });

  describe("real mode", () => {
    beforeEach(() => {
      mockShouldMock.mockReturnValue(false);
    });

    it("calls replicate.predictions.create with correct parameters", async () => {
      holder.create.mockResolvedValue({ id: "pred-123", status: "starting" });

      const result = await generateVideo({
        prompt: "a sunset timelapse",
        aspectRatio: "16:9",
        webhookUrl: "https://app.example.com/api/webhooks/replicate",
      });

      expect(holder.create).toHaveBeenCalledWith({
        model: "kwaivgi/kling-v3-omni-video",
        input: {
          prompt: "a sunset timelapse",
          aspect_ratio: "16:9",
          duration: 5,
          mode: "pro",
          generate_audio: true,
        },
        webhook: "https://app.example.com/api/webhooks/replicate",
        webhook_events_filter: ["completed"],
      });
      expect(result).toEqual({ predictionId: "pred-123" });
    });

    it("uses custom duration when provided", async () => {
      holder.create.mockResolvedValue({ id: "pred-456", status: "starting" });

      await generateVideo({
        prompt: "a test video",
        aspectRatio: "9:16",
        webhookUrl: "https://app.example.com/api/webhooks/replicate",
        duration: 10,
      });

      expect(holder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            duration: 10,
          }),
        })
      );
    });

    it("sanitizes prompt: strips control characters", async () => {
      holder.create.mockResolvedValue({ id: "pred-789", status: "starting" });

      await generateVideo({
        prompt: "hello\x00world\x1Ftest",
        aspectRatio: "16:9",
        webhookUrl: "https://app.example.com/api/webhooks/replicate",
      });

      const calledInput = holder.create.mock.calls[0][0].input;
      expect(calledInput.prompt).toBe("helloworldtest");
    });

    it("sanitizes prompt: truncates to 2500 chars", async () => {
      holder.create.mockResolvedValue({ id: "pred-trunc", status: "starting" });

      await generateVideo({
        prompt: "a".repeat(3000),
        aspectRatio: "16:9",
        webhookUrl: "https://app.example.com/api/webhooks/replicate",
      });

      const calledPrompt = holder.create.mock.calls[0][0].input.prompt;
      expect(calledPrompt.length).toBe(2500);
    });

    it("logs first 200 chars of prompt for audit", async () => {
      holder.create.mockResolvedValue({ id: "pred-log", status: "starting" });
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await generateVideo({
        prompt: "b".repeat(300),
        aspectRatio: "16:9",
        webhookUrl: "https://app.example.com/api/webhooks/replicate",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[video-gen] prompt:",
        "b".repeat(200)
      );
      consoleSpy.mockRestore();
    });
  });
});
