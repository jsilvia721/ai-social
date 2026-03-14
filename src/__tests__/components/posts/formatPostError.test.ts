import { formatPostError } from "@/components/posts/formatPostError";

describe("formatPostError", () => {
  it("returns user-friendly message for raw 'fetch failed' errors", () => {
    expect(formatPostError("fetch failed")).toBe(
      "Publishing failed — try again or edit your post"
    );
  });

  it("handles case-insensitive 'fetch failed' variants", () => {
    expect(formatPostError("Fetch Failed")).toBe(
      "Publishing failed — try again or edit your post"
    );
    expect(formatPostError("FETCH FAILED")).toBe(
      "Publishing failed — try again or edit your post"
    );
  });

  it("returns user-friendly message for network/timeout errors", () => {
    expect(formatPostError("network error")).toBe(
      "Publishing failed — try again or edit your post"
    );
    expect(formatPostError("ETIMEDOUT")).toBe(
      "Publishing failed — try again or edit your post"
    );
    expect(formatPostError("ECONNREFUSED")).toBe(
      "Publishing failed — try again or edit your post"
    );
    expect(formatPostError("socket hang up")).toBe(
      "Publishing failed — try again or edit your post"
    );
  });

  it("passes through meaningful error messages unchanged", () => {
    expect(formatPostError("Post content exceeds character limit")).toBe(
      "Post content exceeds character limit"
    );
    expect(formatPostError("Account authentication expired")).toBe(
      "Account authentication expired"
    );
  });

  it("returns generic message for empty or whitespace-only errors", () => {
    expect(formatPostError("")).toBe(
      "Publishing failed — try again or edit your post"
    );
    expect(formatPostError("   ")).toBe(
      "Publishing failed — try again or edit your post"
    );
  });

  it("returns null for null/undefined input", () => {
    expect(formatPostError(null)).toBeNull();
    expect(formatPostError(undefined)).toBeNull();
  });
});
