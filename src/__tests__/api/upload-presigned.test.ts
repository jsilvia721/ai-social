import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/storage", () => ({
  ensureBucket: jest.fn().mockResolvedValue(undefined),
  getPresignedUploadUrl: jest.fn(),
  getPublicUrl: jest.fn(),
}));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/upload/presigned/route";
import { NextRequest } from "next/server";
import { getPresignedUploadUrl, getPublicUrl } from "@/lib/storage";

const mockGetPresignedUploadUrl = getPresignedUploadUrl as jest.Mock;
const mockGetPublicUrl = getPublicUrl as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/upload/presigned");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

describe("GET /api/upload/presigned", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ mimeType: "video/mp4" }));
    expect(res.status).toBe(401);
    expect(mockGetPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 400 for unsupported mime type", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ mimeType: "image/jpeg" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unsupported video type");
  });

  it("returns 400 when file size exceeds 500MB", async () => {
    mockAuthenticated();
    const tooBig = String(501 * 1024 * 1024);
    const res = await GET(makeRequest({ mimeType: "video/mp4", fileSize: tooBig }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("500 MB");
  });

  it("returns presigned uploadUrl and publicUrl for video/mp4", async () => {
    mockAuthenticated();
    mockGetPresignedUploadUrl.mockResolvedValue("https://s3.example.com/presigned-put-url");
    mockGetPublicUrl.mockReturnValue("https://cdn.example.com/uploads/user-test-id/abc.mp4");

    const res = await GET(makeRequest({ mimeType: "video/mp4", fileSize: "1000000" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe("https://s3.example.com/presigned-put-url");
    expect(body.publicUrl).toBe("https://cdn.example.com/uploads/user-test-id/abc.mp4");
  });

  it("calls getPresignedUploadUrl with correct key prefix and mime type", async () => {
    mockAuthenticated();
    mockGetPresignedUploadUrl.mockResolvedValue("https://presigned-url");
    mockGetPublicUrl.mockReturnValue("https://public-url");

    await GET(makeRequest({ mimeType: "video/mp4" }));

    const [key, mimeType] = mockGetPresignedUploadUrl.mock.calls[0] as [string, string];
    expect(key).toMatch(new RegExp(`^uploads/${mockSession.user.id}/`));
    expect(key).toMatch(/\.mp4$/);
    expect(mimeType).toBe("video/mp4");
  });

  it("supports video/quicktime (.mov)", async () => {
    mockAuthenticated();
    mockGetPresignedUploadUrl.mockResolvedValue("https://presigned-url");
    mockGetPublicUrl.mockReturnValue("https://public-url");

    const res = await GET(makeRequest({ mimeType: "video/quicktime" }));
    expect(res.status).toBe(200);

    const [key] = mockGetPresignedUploadUrl.mock.calls[0] as [string, string];
    expect(key).toMatch(/\.mov$/);
  });

  it("supports video/webm", async () => {
    mockAuthenticated();
    mockGetPresignedUploadUrl.mockResolvedValue("https://presigned-url");
    mockGetPublicUrl.mockReturnValue("https://public-url");

    const res = await GET(makeRequest({ mimeType: "video/webm" }));
    expect(res.status).toBe(200);
  });
});
