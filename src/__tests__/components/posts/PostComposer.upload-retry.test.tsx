/**
 * @jest-environment jsdom
 */
import { render, fireEvent, waitFor, cleanup, screen, act } from "@testing-library/react";
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

/** Helper: create presigned URL mock responses for N attempts */
function mockPresignedFetchCalls(attemptCount: number) {
  const mock = global.fetch as jest.Mock;
  // First call: accounts fetch
  mock.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve([
        { id: "acc-1", platform: "TWITTER", username: "test" },
      ]),
  });
  // One presigned URL response per attempt
  for (let i = 0; i < attemptCount; i++) {
    mock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          uploadUrl: `https://s3.example.com/upload${i + 1}`,
          publicUrl: "https://cdn.example.com/video.mp4",
        }),
    });
  }
}

/** Helper: render component, wait for accounts, trigger file upload */
async function setupAndTriggerUpload() {
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
}

beforeEach(() => {
  jest.useFakeTimers();
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
  jest.useRealTimers();
  cleanup();
});

describe("PostComposer video upload retry", () => {
  it("retries with exponential backoff and fails after 3 total attempts", async () => {
    // 3 total attempts: initial + 2 retries
    mockPresignedFetchCalls(3);

    await setupAndTriggerUpload();

    // First attempt fails
    MockXHR.instances[0].onerror?.();

    // Backoff delay: 1000ms * 2^0 = 1000ms
    await act(async () => { jest.advanceTimersByTime(1000); });
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Second attempt fails
    MockXHR.instances[1].onerror?.();

    // Backoff delay: 1000ms * 2^1 = 2000ms
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(3);
    });

    // Third attempt fails — exhausted retries
    MockXHR.instances[2].onerror?.();

    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Upload failed") }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          type: "UPLOAD",
          method: "presigned",
          retryCount: 3,
          online: true,
        }),
      })
    );
  });

  it("succeeds on retry after first network error", async () => {
    mockPresignedFetchCalls(2);

    await setupAndTriggerUpload();

    // First attempt fails
    MockXHR.instances[0].onerror?.();

    // Advance past backoff delay
    await act(async () => { jest.advanceTimersByTime(1000); });
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Second attempt succeeds
    MockXHR.instances[1].status = 200;
    MockXHR.instances[1].onload?.();

    await waitFor(() => {
      expect(screen.queryByText(/Upload failed/)).not.toBeInTheDocument();
    });
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("does not retry immediately — waits for backoff delay", async () => {
    mockPresignedFetchCalls(2);

    await setupAndTriggerUpload();

    // First attempt fails
    MockXHR.instances[0].onerror?.();

    // Before delay expires, no retry should have happened
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(MockXHR.instances.length).toBe(1);

    // After delay expires, retry happens
    await act(async () => { jest.advanceTimersByTime(500); });
    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });
  });

  it("resets upload progress to 0 (not null) during retry", async () => {
    mockPresignedFetchCalls(2);

    const { container } = render(<PostComposer />);

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

    // Simulate progress to 50%
    act(() => {
      MockXHR.instances[0].upload.onprogress?.({
        lengthComputable: true,
        loaded: 50,
        total: 100,
      });
    });

    // Verify progress is shown
    expect(container.textContent).toContain("50%");

    // Trigger retry
    MockXHR.instances[0].onerror?.();

    // Progress bar should show 0% (reset to 0, not hidden)
    // The bar stays visible because uploadProgress is 0 (not null)
    await waitFor(() => {
      expect(container.textContent).toContain("0%");
    });
  });

  it("sets timeout on XHR for large uploads", async () => {
    mockPresignedFetchCalls(1);

    await setupAndTriggerUpload();

    // Should have a timeout set (5 minutes = 300000ms)
    expect(MockXHR.instances[0].timeout).toBe(300000);
  });

  it("retries on S3 5xx status error", async () => {
    mockPresignedFetchCalls(2);

    await setupAndTriggerUpload();

    // S3 returns 503 SlowDown
    MockXHR.instances[0].status = 503;
    MockXHR.instances[0].onload?.();

    // Advance past backoff delay
    await act(async () => { jest.advanceTimersByTime(1000); });

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
    mockPresignedFetchCalls(1);

    await setupAndTriggerUpload();

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

  it("includes diagnostic metadata (retryCount, online status) in error reports", async () => {
    // 3 total attempts, all fail
    mockPresignedFetchCalls(3);

    // Mock navigator.onLine to false to verify online status propagation
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    await setupAndTriggerUpload();

    // First attempt fails
    MockXHR.instances[0].onerror?.();
    await act(async () => { jest.advanceTimersByTime(1000); });
    await waitFor(() => { expect(MockXHR.instances.length).toBe(2); });

    // Second attempt fails
    MockXHR.instances[1].onerror?.();
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => { expect(MockXHR.instances.length).toBe(3); });

    // Third attempt fails — exhausted
    MockXHR.instances[2].onerror?.();

    await waitFor(() => {
      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    // Verify full diagnostic metadata structure
    const [, context] = mockReportError.mock.calls[0];
    expect(context).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        type: "UPLOAD",
        method: "presigned",
        fileType: "video/mp4",
        retryCount: 3,
        online: false,
      }),
    }));

    // Restore navigator.onLine
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("shows timeout-specific error message on XHR timeout", async () => {
    // 3 total attempts
    mockPresignedFetchCalls(3);

    await setupAndTriggerUpload();

    // Simulate timeout on first attempt
    MockXHR.instances[0].ontimeout?.();

    // Advance past backoff delay
    await act(async () => { jest.advanceTimersByTime(1000); });

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(2);
    });

    // Timeout again on second attempt
    MockXHR.instances[1].ontimeout?.();

    await act(async () => { jest.advanceTimersByTime(2000); });

    await waitFor(() => {
      expect(MockXHR.instances.length).toBe(3);
    });

    // Timeout on third attempt — exhausted
    MockXHR.instances[2].ontimeout?.();

    await waitFor(() => {
      expect(screen.getByText(/Upload timed out/)).toBeInTheDocument();
    });
  });
});
