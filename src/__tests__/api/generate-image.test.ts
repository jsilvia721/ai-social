import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/media");
jest.mock("@/lib/storage");

import { POST } from "@/app/api/ai/generate-image/route";
import { generateImage } from "@/lib/media";
import { uploadBuffer } from "@/lib/storage";

const mockGenerateImage = generateImage as jest.MockedFunction<typeof generateImage>;
const mockUploadBuffer = uploadBuffer as jest.MockedFunction<typeof uploadBuffer>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/ai/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/generate-image", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest({ prompt: "test", businessId: "biz-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body (missing prompt)", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body (missing businessId)", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({ prompt: "test" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a member of the business", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ prompt: "test", businessId: "biz-1" }));
    expect(res.status).toBe(403);
  });

  it("generates image, uploads to S3, and returns URL", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "bm-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "OWNER",
    } as never);
    prismaMock.contentStrategy.findUnique.mockResolvedValue({
      accountType: "BUSINESS",
      visualStyle: "clean minimalist",
    } as never);
    mockGenerateImage.mockResolvedValue({
      buffer: Buffer.from("fake-png"),
      mimeType: "image/png",
    });
    mockUploadBuffer.mockResolvedValue("https://storage.example.com/media/biz-1/composer/abc.png");

    const res = await POST(makeRequest({ prompt: "a sunset", businessId: "biz-1" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://storage.example.com/media/biz-1/composer/abc.png");

    // Verify generateImage was called with augmented prompt
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("a sunset")
    );
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("professional")
    );

    // Verify upload was called
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringContaining("media/biz-1/composer/"),
      "image/png"
    );
  });

  it("works without ContentStrategy (no creative profile augmentation)", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "bm-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "MEMBER",
    } as never);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(null);
    mockGenerateImage.mockResolvedValue({
      buffer: Buffer.from("fake-png"),
      mimeType: "image/png",
    });
    mockUploadBuffer.mockResolvedValue("https://storage.example.com/img.png");

    const res = await POST(makeRequest({ prompt: "test", businessId: "biz-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://storage.example.com/img.png");
  });
});
