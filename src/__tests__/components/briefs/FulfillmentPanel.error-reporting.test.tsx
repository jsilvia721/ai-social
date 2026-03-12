/**
 * @jest-environment jsdom
 */
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

jest.mock("@/lib/error-reporter", () => ({
  reportError: jest.fn(),
}));

import { FulfillmentPanel } from "@/components/briefs/FulfillmentPanel";
import { reportError } from "@/lib/error-reporter";

const mockReportError = reportError as jest.MockedFunction<typeof reportError>;

const baseBrief = {
  id: "brief-1",
  topic: "Test topic",
  rationale: "Testing",
  suggestedCaption: "Test caption",
  aiImagePrompt: null,
  contentGuidance: null,
  recommendedFormat: "TEXT" as const,
  platform: "TWITTER" as const,
  scheduledFor: new Date().toISOString(),
  businessId: "biz-1",
};

const noop = () => {};

beforeEach(() => {
  jest.clearAllMocks();
  // Mock accounts fetch (returns empty)
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  });
});

afterEach(() => {
  cleanup();
});

describe("FulfillmentPanel error reporting", () => {
  it("reports upload errors via reportError in handleFileUpload", async () => {
    const uploadError = new Error("Failed to get upload URL");
    // First call: accounts fetch. Second call: presigned URL fails.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Failed to get upload URL" }),
      });

    render(
      <FulfillmentPanel
        brief={baseBrief}
        onClose={noop}
        onFulfilled={noop}
        onCancelled={noop}
        onSkip={noop}
      />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["pixel"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Failed to get upload URL" }),
      {
        url: window.location.href,
        metadata: {
          type: "UPLOAD",
          method: "presigned",
          fileType: "image/jpeg",
          fileSize: 5,
        },
      }
    );
  });

  it("sends correct mimeType and fileSize query params to presigned endpoint", async () => {
    // First call: accounts fetch. Second: presigned URL. Third: S3 PUT.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload",
            publicUrl: "https://cdn.example.com/file.jpg",
          }),
      })
      .mockResolvedValueOnce({ ok: true });

    render(
      <FulfillmentPanel
        brief={baseBrief}
        onClose={noop}
        onFulfilled={noop}
        onCancelled={noop}
        onSkip={noop}
      />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["pixel"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    // Verify presigned URL request uses correct query params
    const presignedCall = (global.fetch as jest.Mock).mock.calls[1][0];
    expect(presignedCall).toContain("mimeType=image%2Fjpeg");
    expect(presignedCall).toContain("fileSize=5");
    // Should NOT use the old incorrect params
    expect(presignedCall).not.toContain("filename=");
    expect(presignedCall).not.toContain("contentType=");
  });
});
