/**
 * @jest-environment jsdom
 */
import { render, fireEvent, waitFor, cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/lib/error-reporter", () => ({
  reportError: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

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

// Mock XMLHttpRequest for presigned upload tests
class MockXHR {
  static instances: MockXHR[] = [];
  readyState = 0;
  status = 0;
  upload = { onprogress: null as ((e: unknown) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  _method = "";
  _url = "";
  _headers: Record<string, string> = {};
  _sent = false;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this._method = method;
    this._url = url;
  }

  setRequestHeader(key: string, value: string) {
    this._headers[key] = value;
  }

  send() {
    this._sent = true;
  }

  abort() {
    this.onabort?.();
  }

  static reset() {
    MockXHR.instances = [];
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  MockXHR.reset();
  // @ts-expect-error - mock XMLHttpRequest
  global.XMLHttpRequest = MockXHR;

  // Default: accounts fetch returns a Twitter account
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

describe("PostComposer video upload retry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries twice on XHR network error before failing (3 total attempts)", async () => {
    // accounts fetch, then presigned URL (called 3 times: initial + 2 retries)
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      // First presigned URL request
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload1",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      // Second presigned URL request (retry 1)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload2",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      // Third presigned URL request (retry 2)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload3",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    // Wait for first XHR to be created
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // Simulate network error on first attempt
    MockXHR.instances[0].onerror?.();

    // Advance past backoff delay (1s for first retry)
    jest.advanceTimersByTime(1000);

    // Wait for retry - second XHR should be created
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Simulate network error on second attempt
    MockXHR.instances[1].onerror?.();

    // Advance past backoff delay (2s for second retry)
    jest.advanceTimersByTime(2000);

    // Wait for third XHR
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(3);
    });

    // Simulate network error on third attempt — should now exhaust retries
    MockXHR.instances[2].onerror?.();

    // Should now report the error (after exhausting retries)
    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Upload failed") }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          type: "UPLOAD",
          method: "presigned",
        }),
      })
    );
  });

  it("uses exponential backoff between retries", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload1",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload2",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload3",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // First attempt fails
    MockXHR.instances[0].onerror?.();

    // After 500ms, retry should NOT have happened yet (backoff is 1000ms)
    jest.advanceTimersByTime(500);
    expect(MockXHR.instances.length).toBe(1);

    // After another 500ms (total 1000ms), retry should happen
    jest.advanceTimersByTime(500);
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Second attempt fails
    MockXHR.instances[1].onerror?.();

    // After 1500ms, second retry should NOT have happened yet (backoff is 2000ms)
    jest.advanceTimersByTime(1500);
    expect(MockXHR.instances.length).toBe(2);

    // After another 500ms (total 2000ms), second retry should happen
    jest.advanceTimersByTime(500);
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(3);
    });

    // Third attempt succeeds
    MockXHR.instances[2].status = 200;
    MockXHR.instances[2].onload?.();

    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("succeeds on retry after first network error", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload1",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload2",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // First attempt fails
    MockXHR.instances[0].onerror?.();

    // Advance past backoff delay
    jest.advanceTimersByTime(1000);

    // Wait for retry XHR
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Second attempt succeeds
    MockXHR.instances[1].status = 200;
    MockXHR.instances[1].onload?.();

    // Should NOT report error since retry succeeded
    await waitFor(() => {
      expect(screen.queryByText(/Upload failed/)).not.toBeInTheDocument();
    });
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("sets timeout on XHR for large uploads", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // Should have a timeout set (5 minutes = 300000ms)
    expect(MockXHR.instances[0].timeout).toBe(300000);
  });

  it("retries on S3 5xx status error", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload1",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload2",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // S3 returns 503 SlowDown
    MockXHR.instances[0].status = 503;
    MockXHR.instances[0].onload?.();

    // Advance past backoff delay
    jest.advanceTimersByTime(1000);

    // Should retry — second XHR created
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Second attempt succeeds
    MockXHR.instances[1].status = 200;
    MockXHR.instances[1].onload?.();

    // No error reported
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("does not retry on 4xx status error", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload1",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // S3 returns 403 Forbidden — should NOT retry
    MockXHR.instances[0].status = 403;
    MockXHR.instances[0].onload?.();

    // Wait for error to appear, no retry
    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    // Only one XHR created — no retry for 4xx
    expect(MockXHR.instances.length).toBe(1);
  });

  it("shows timeout-specific error message on XHR timeout", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "acc-1", platform: "TWITTER", username: "test" },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      // Retry 1 presigned URL
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload2",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      })
      // Retry 2 presigned URL
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            uploadUrl: "https://s3.example.com/upload3",
            publicUrl: "https://cdn.example.com/video.mp4",
          }),
      });

    render(<PostComposer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = new File(["videodata"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(1);
    });

    // Simulate timeout on first attempt
    MockXHR.instances[0].ontimeout?.();

    // Advance past backoff delay
    jest.advanceTimersByTime(1000);

    // Wait for first retry
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Timeout again on first retry
    MockXHR.instances[1].ontimeout?.();

    // Advance past second backoff delay
    jest.advanceTimersByTime(2000);

    // Wait for second retry
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(3);
    });

    // Timeout on final attempt — exhausts retries
    MockXHR.instances[2].ontimeout?.();

    await waitFor(() => {
      expect(screen.getByText(/Upload timed out/)).toBeInTheDocument();
    });
  });
});
