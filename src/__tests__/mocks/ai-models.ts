/**
 * Shared Anthropic SDK mock helper.
 *
 * Usage (messages.create — most test files):
 *
 *   jest.mock("@anthropic-ai/sdk", () =>
 *     require("@/__tests__/mocks/ai-models").anthropicSdkMock()
 *   );
 *   import { mockCreate, resetAiMocks } from "@/__tests__/mocks/ai-models";
 *   beforeEach(() => resetAiMocks());
 *
 * Usage (messages.stream — feedback-chat):
 *
 *   jest.mock("@anthropic-ai/sdk", () =>
 *     require("@/__tests__/mocks/ai-models").anthropicStreamMock()
 *   );
 *   import { mockStream, resetAiMocks } from "@/__tests__/mocks/ai-models";
 *   beforeEach(() => resetAiMocks());
 *
 * Each test file controls return values independently via mockCreate / mockStream.
 */

/** Mock for `client.messages.create()` — use `.mockResolvedValue()` in tests. */
export const mockCreate = jest.fn();

/** Mock for `client.messages.stream()` — use `.mockImplementation()` in tests. */
export const mockStream = jest.fn();

/**
 * Returns a jest.mock factory value that replaces `@anthropic-ai/sdk`
 * with a constructor whose `.messages.create` delegates to `mockCreate`.
 */
export function anthropicSdkMock() {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: (...args: unknown[]) => mockCreate(...args) },
    })),
  };
}

/**
 * Returns a jest.mock factory value that replaces `@anthropic-ai/sdk`
 * with a constructor whose `.messages.stream` delegates to `mockStream`.
 */
export function anthropicStreamMock() {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        stream: (...args: unknown[]) => mockStream(...args),
      },
    })),
  };
}

/** Reset all AI mocks — call in `beforeEach`. */
export function resetAiMocks() {
  mockCreate.mockReset();
  mockStream.mockReset();
}
