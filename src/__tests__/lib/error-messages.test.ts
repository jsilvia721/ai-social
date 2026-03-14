import { friendlyErrorMessage } from "@/lib/error-messages";

describe("friendlyErrorMessage", () => {
  it("maps 401 Blotato API errors to reconnect message", () => {
    const raw = 'Blotato API error 401: {"message":"Unauthorized"}';
    expect(friendlyErrorMessage(raw)).toBe(
      "Unable to connect to Blotato. Please reconnect your account."
    );
  });

  it("maps 403 Blotato API errors to reconnect message", () => {
    const raw = 'Blotato API error 403: {"message":"Forbidden"}';
    expect(friendlyErrorMessage(raw)).toBe(
      "Unable to connect to Blotato. Please reconnect your account."
    );
  });

  it("maps 429 Blotato API errors to rate limit message", () => {
    const raw = 'Blotato API error 429: {"message":"Too Many Requests"}';
    expect(friendlyErrorMessage(raw)).toBe(
      "Blotato is temporarily unavailable due to rate limiting. Please try again in a few minutes."
    );
  });

  it("maps 500+ Blotato API errors to server error message", () => {
    const raw = 'Blotato API error 500: {"error":"Internal Server Error"}';
    expect(friendlyErrorMessage(raw)).toBe(
      "Blotato is experiencing issues. Please try again later."
    );
  });

  it("maps 502 Blotato API errors to server error message", () => {
    const raw = "Blotato API error 502: Bad Gateway";
    expect(friendlyErrorMessage(raw)).toBe(
      "Blotato is experiencing issues. Please try again later."
    );
  });

  it("maps 404 Blotato API errors to generic Blotato error", () => {
    const raw = 'Blotato API error 404: {"message":"Not Found"}';
    expect(friendlyErrorMessage(raw)).toBe(
      "Something went wrong connecting to Blotato. Please try again."
    );
  });

  it("passes through non-API error messages unchanged", () => {
    const msg = "Failed to fetch";
    expect(friendlyErrorMessage(msg)).toBe(
      "Could not reach Blotato. Please check your connection and try again."
    );
  });

  it("passes through already-friendly messages", () => {
    const msg = "Could not fetch available accounts from Blotato";
    expect(friendlyErrorMessage(msg)).toBe(msg);
  });
});
