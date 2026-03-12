/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Mock error-reporter before importing component
jest.mock("@/lib/error-reporter", () => ({
  reportError: jest.fn(),
}));

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next-auth/react
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", activeBusinessId: "biz-1" },
    },
  }),
}));

import { PostComposer } from "@/components/posts/PostComposer";
import { reportError } from "@/lib/error-reporter";

const mockReportError = reportError as jest.MockedFunction<typeof reportError>;

beforeEach(() => {
  jest.clearAllMocks();
  // Mock accounts fetch
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve([
        { id: "acc-1", platform: "TWITTER", username: "test" },
      ]),
  });
});

afterEach(() => {
  cleanup();
});

describe("PostComposer error reporting", () => {
  it("reports upload errors via reportError in handleFileSelect", async () => {
    const uploadError = new Error("Upload failed");
    // First call: accounts fetch (ok). Subsequent calls: upload fails.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockRejectedValueOnce(uploadError);

    render(<PostComposer />);

    // Wait for accounts to load
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Find file input and trigger a file select
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["pixel"], "test.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    expect(mockReportError).toHaveBeenCalledWith(uploadError, {
      url: window.location.href,
      metadata: {
        type: "UPLOAD",
        method: "server",
        fileType: "image/png",
        fileSize: 5,
      },
    });
  });

  it("reports image generation errors via reportError in handleGenerateImage", async () => {
    const genError = new Error("Image generation failed");
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockRejectedValueOnce(genError);

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Type a prompt in the image generation input
    const imageInput = screen.getByPlaceholderText(
      "Describe an image to generate\u2026"
    );
    fireEvent.change(imageInput, { target: { value: "a sunset" } });

    // Click the Generate button (for image generation)
    const generateButtons = screen.getAllByRole("button", {
      name: /generate/i,
    });
    // The image generate button has Wand2 icon - find the one in the Media card
    const imageGenButton = generateButtons.find((btn) =>
      btn.closest(".space-y-3")
    );
    fireEvent.click(imageGenButton!);

    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    expect(mockReportError).toHaveBeenCalledWith(genError, {
      url: window.location.href,
      metadata: { type: "IMAGE_GENERATION" },
    });
  });

  it("does not report error when upload is cancelled", async () => {
    // First call: accounts. Second: presigned URL returns a mock.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockRejectedValueOnce(new Error("Upload cancelled"));

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(["data"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    // Wait for the catch block to run
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Upload cancelled errors should not be reported
    expect(mockReportError).not.toHaveBeenCalled();
  });
});
