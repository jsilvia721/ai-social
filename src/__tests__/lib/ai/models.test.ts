/**
 * Tests for src/lib/ai/models.ts — centralized model configuration and client singleton.
 */

// Mock the Anthropic SDK to avoid needing real credentials
const mockAnthropicInstance = { messages: { create: jest.fn() } };
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockAnthropicInstance),
}));

import {
  MODEL_DEFAULT,
  MODEL_FAST,
  getModel,
  getAnthropicClient,
} from "@/lib/ai/models";
import type { ModelId } from "@/lib/ai/models";

describe("model constants", () => {
  it("MODEL_DEFAULT is claude-sonnet-4-6", () => {
    expect(MODEL_DEFAULT).toBe("claude-sonnet-4-6");
  });

  it("MODEL_FAST is claude-haiku-4-5-20251001", () => {
    expect(MODEL_FAST).toBe("claude-haiku-4-5-20251001");
  });

  it("ModelId type accepts both constants", () => {
    // Type-level test: these assignments should compile without error
    const a: ModelId = MODEL_DEFAULT;
    const b: ModelId = MODEL_FAST;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });
});

describe("getModel", () => {
  it('returns MODEL_DEFAULT for "default" tier', () => {
    expect(getModel("default")).toBe(MODEL_DEFAULT);
  });

  it('returns MODEL_FAST for "fast" tier', () => {
    expect(getModel("fast")).toBe(MODEL_FAST);
  });

  it("accepts optional businessId for future per-business overrides", () => {
    expect(getModel("default", { businessId: "biz_123" })).toBe(MODEL_DEFAULT);
    expect(getModel("fast", { businessId: "biz_123" })).toBe(MODEL_FAST);
  });
});

describe("getAnthropicClient", () => {
  it("returns an Anthropic client instance", () => {
    const client = getAnthropicClient();
    expect(client).toBeDefined();
    expect(client.messages).toBeDefined();
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    const client1 = getAnthropicClient();
    const client2 = getAnthropicClient();
    expect(client1).toBe(client2);
  });
});
