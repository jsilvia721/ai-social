import { encryptToken, decryptToken } from "@/lib/crypto";

describe("encryptToken / decryptToken", () => {
  it("round-trips a plaintext string through encrypt → decrypt", () => {
    const plaintext = "my-secret-access-token";
    const ciphertext = encryptToken(plaintext);
    expect(decryptToken(ciphertext)).toBe(plaintext);
  });

  it("produces ciphertext in iv:encrypted:tag format (3 colon-separated base64url parts)", () => {
    const ciphertext = encryptToken("some-token");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // Each part should be non-empty base64url characters
    parts.forEach((p) => expect(p).toMatch(/^[A-Za-z0-9_-]+$/));
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const token = "same-token";
    const first = encryptToken(token);
    const second = encryptToken(token);
    expect(first).not.toBe(second);
  });

  it("returns legacy plaintext unchanged (migration path — string with no colons)", () => {
    const plaintext = "legacy-plaintext-token";
    expect(decryptToken(plaintext)).toBe(plaintext);
  });

  it("returns ciphertext unchanged on tampered auth tag (graceful fallback)", () => {
    const ciphertext = encryptToken("original");
    const parts = ciphertext.split(":");
    // Corrupt the auth tag
    parts[2] = "aGVsbG8"; // random different base64url
    const tampered = parts.join(":");
    expect(decryptToken(tampered)).toBe(tampered);
  });
});
