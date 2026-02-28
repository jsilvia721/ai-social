import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/storage", () => ({
  uploadFile: jest.fn(),
  ensureBucket: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/upload/route";
import { NextRequest } from "next/server";
import { uploadFile, ensureBucket } from "@/lib/storage";

const mockUploadFile = uploadFile as jest.Mock;
const mockEnsureBucket = ensureBucket as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsureBucket.mockResolvedValue(undefined);
});

function makeUploadRequest(
  content: Uint8Array | string,
  filename: string,
  mimeType: string
): NextRequest {
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  const formData = new FormData();
  formData.append("file", file);
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/upload", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const req = makeUploadRequest(new Uint8Array([1, 2, 3]), "test.jpg", "image/jpeg");
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("returns 400 when no file field is provided", async () => {
    mockAuthenticated();

    const formData = new FormData();
    const req = new NextRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("returns 400 for disallowed file type (image/svg+xml)", async () => {
    mockAuthenticated();

    const req = makeUploadRequest("<svg/>", "test.svg", "image/svg+xml");
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("returns 400 when file exceeds 10 MB", async () => {
    mockAuthenticated();

    const bigFile = new Uint8Array(11 * 1024 * 1024); // 11 MB
    const req = makeUploadRequest(bigFile, "big.jpg", "image/jpeg");
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("returns 200 with url for a valid jpeg", async () => {
    mockAuthenticated();
    mockUploadFile.mockResolvedValue(
      "http://example.com/storage/ai-social/uploads/user-test-id/abc.jpg"
    );

    const req = makeUploadRequest(new Uint8Array([0xff, 0xd8]), "photo.jpg", "image/jpeg");
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("uploads/");
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
  });

  it("uses a key starting with uploads/<userId>/ and ending with .jpg", async () => {
    mockAuthenticated();
    mockUploadFile.mockResolvedValue(
      "http://example.com/storage/ai-social/uploads/user-test-id/abc.jpg"
    );

    const req = makeUploadRequest(new Uint8Array([0xff, 0xd8]), "photo.jpg", "image/jpeg");
    await POST(req);

    const [, key] = mockUploadFile.mock.calls[0] as [File, string, string];
    expect(key).toMatch(new RegExp(`^uploads/${mockSession.user.id}/`));
    expect(key).toMatch(/\.jpg$/);
  });

  it("returns 200 for a valid video/mp4", async () => {
    mockAuthenticated();
    mockUploadFile.mockResolvedValue(
      "http://example.com/storage/ai-social/uploads/user-test-id/vid.mp4"
    );

    const req = makeUploadRequest(new Uint8Array([0x00, 0x00]), "clip.mp4", "video/mp4");
    const res = await POST(req);

    expect(res.status).toBe(200);
  });
});
