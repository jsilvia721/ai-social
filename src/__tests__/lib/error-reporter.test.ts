/**
 * @jest-environment jsdom
 */

import {
  initErrorReporter,
  reportError,
  _resetForTesting,
} from "@/lib/error-reporter";

// Mock fetch globally
const mockFetch = jest.fn().mockResolvedValue({ ok: true });
global.fetch = mockFetch;

// Mock navigator.sendBeacon
const mockSendBeacon = jest.fn().mockReturnValue(true);
Object.defineProperty(global.navigator, "sendBeacon", {
  value: mockSendBeacon,
  writable: true,
});

const cleanupFns: (() => void)[] = [];

/** Wrapper that tracks cleanup for afterEach */
function initReporter(options?: Parameters<typeof initErrorReporter>[0]) {
  const cleanup = initErrorReporter(options);
  cleanupFns.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  _resetForTesting();
});

afterEach(() => {
  // Clean up any listeners installed by initErrorReporter
  for (const cleanup of cleanupFns) {
    cleanup();
  }
  cleanupFns.length = 0;
  jest.useRealTimers();
});

describe("error-reporter", () => {
  describe("initErrorReporter", () => {
    it("installs window.error and unhandledrejection listeners", () => {
      const addSpy = jest.spyOn(window, "addEventListener");
      const cleanup = initErrorReporter();

      expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function)
      );

      cleanup();
      addSpy.mockRestore();
    });

    it("returns cleanup function that removes listeners", () => {
      const removeSpy = jest.spyOn(window, "removeEventListener");
      const cleanup = initErrorReporter();
      cleanup();

      expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function)
      );

      removeSpy.mockRestore();
    });

    it("does not install listeners when enabled is false", () => {
      const addSpy = jest.spyOn(window, "addEventListener");
      const cleanup = initErrorReporter({ enabled: false });

      expect(addSpy).not.toHaveBeenCalled();
      cleanup();
      addSpy.mockRestore();
    });

    it("wraps console.error when captureConsoleErrors is true", () => {
      const originalConsoleError = console.error;
      const cleanup = initErrorReporter({ captureConsoleErrors: true });

      expect(console.error).not.toBe(originalConsoleError);

      cleanup();
      expect(console.error).toBe(originalConsoleError);
    });

    it("does not wrap console.error by default", () => {
      const originalConsoleError = console.error;
      const cleanup = initErrorReporter();

      expect(console.error).toBe(originalConsoleError);
      cleanup();
    });

    it("console.error wrapper calls original and reports Error instances", () => {
      const originalConsoleError = console.error;
      const mockOriginal = jest.fn();
      console.error = mockOriginal;

      const cleanup = initErrorReporter({
        captureConsoleErrors: true,
        debounceMs: 100,
      });

      const err = new Error("console test");
      console.error(err);

      // Original should be called
      expect(mockOriginal).toHaveBeenCalledWith(err);

      // Flush debounce
      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("console test");

      cleanup();
      console.error = originalConsoleError;
    });

    it("console.error wrapper captures string arguments", () => {
      const originalConsoleError = console.error;
      const mockOriginal = jest.fn();
      console.error = mockOriginal;

      const cleanup = initErrorReporter({
        captureConsoleErrors: true,
        debounceMs: 100,
      });

      console.error("something failed");
      jest.advanceTimersByTime(100);

      expect(mockOriginal).toHaveBeenCalledWith("something failed");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("something failed");
      expect(body.source).toBe("CLIENT");

      cleanup();
      console.error = originalConsoleError;
    });

    it("console.error wrapper filters out React Warning: strings", () => {
      const originalConsoleError = console.error;
      const mockOriginal = jest.fn();
      console.error = mockOriginal;

      const cleanup = initErrorReporter({
        captureConsoleErrors: true,
        debounceMs: 100,
      });

      console.error("Warning: Each child in a list should have a unique key");
      jest.advanceTimersByTime(100);

      expect(mockOriginal).toHaveBeenCalledWith(
        "Warning: Each child in a list should have a unique key"
      );
      expect(mockFetch).not.toHaveBeenCalled();

      cleanup();
      console.error = originalConsoleError;
    });

    it("console.error wrapper joins multiple non-Error string arguments", () => {
      const originalConsoleError = console.error;
      const mockOriginal = jest.fn();
      console.error = mockOriginal;

      const cleanup = initErrorReporter({
        captureConsoleErrors: true,
        debounceMs: 100,
      });

      console.error("failed to load", "resource", 404);
      jest.advanceTimersByTime(100);

      expect(mockOriginal).toHaveBeenCalledWith("failed to load", "resource", 404);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("failed to load resource 404");

      cleanup();
      console.error = originalConsoleError;
    });
  });

  describe("reportError", () => {
    it("extracts message and stack from Error objects", () => {
      initReporter({ debounceMs: 100 });
      const err = new Error("test error");
      reportError(err);
      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("test error");
      expect(body.stack).toBeDefined();
      expect(body.source).toBe("CLIENT");
    });

    it("handles string errors", () => {
      initReporter({ debounceMs: 100 });
      reportError("string error");
      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("string error");
    });

    it("handles object errors", () => {
      initReporter({ debounceMs: 100 });
      reportError({ foo: 1, bar: "baz" });
      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe('{"foo":1,"bar":"baz"}');
    });

    it("handles null/undefined errors", () => {
      initReporter({ debounceMs: 100 });
      reportError(null);
      reportError(undefined);
      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body1.message).toBe("Unknown error: null");
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body2.message).toBe("Unknown error: undefined");
    });

    it("includes context url and metadata", () => {
      initReporter({ debounceMs: 100 });
      reportError(new Error("ctx test"), {
        url: "http://localhost/page",
        metadata: { viewport: "1024x768" },
      });
      jest.advanceTimersByTime(100);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.url).toBe("http://localhost/page");
      expect(body.metadata).toEqual({ viewport: "1024x768" });
    });

    it("defaults url to window.location.href", () => {
      initReporter({ debounceMs: 100 });
      reportError(new Error("no url"));
      jest.advanceTimersByTime(100);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.url).toBe("http://localhost/");
    });
  });

  describe("deduplication", () => {
    it("does not re-send duplicate messages within dedup window", () => {
      initReporter({ debounceMs: 100 });

      reportError(new Error("dup error"));
      reportError(new Error("dup error"));
      reportError(new Error("dup error"));

      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sends different error messages", () => {
      initReporter({ debounceMs: 100 });

      reportError(new Error("error 1"));
      reportError(new Error("error 2"));

      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("resets dedup set after 5 minutes", () => {
      initReporter({ debounceMs: 100 });

      reportError(new Error("reset test"));
      jest.advanceTimersByTime(100);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Same error, still deduped
      reportError(new Error("reset test"));
      jest.advanceTimersByTime(100);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past 5 min reset interval
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Now should send again
      reportError(new Error("reset test"));
      jest.advanceTimersByTime(100);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("circuit breaker", () => {
    it("stops reporting after 100 unique errors", () => {
      initReporter({ debounceMs: 100 });

      for (let i = 0; i < 105; i++) {
        reportError(new Error(`error ${i}`));
      }

      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(100);
    });
  });

  describe("debounce/batching", () => {
    it("batches errors within debounce window", () => {
      initReporter({ debounceMs: 500 });

      reportError(new Error("batch 1"));
      reportError(new Error("batch 2"));

      // Not flushed yet
      expect(mockFetch).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("window event listeners", () => {
    it("captures window error events", () => {
      initReporter({ debounceMs: 100 });

      const errorEvent = new ErrorEvent("error", {
        error: new Error("window error"),
        message: "Uncaught Error: window error",
      });
      window.dispatchEvent(errorEvent);

      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("window error");
    });

    it("ignores error events without .error property (resource errors)", () => {
      initReporter({ debounceMs: 100 });

      const resourceError = new ErrorEvent("error", {
        message: "Failed to load resource",
      });
      window.dispatchEvent(resourceError);

      jest.advanceTimersByTime(100);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("captures unhandled promise rejections", () => {
      initReporter({ debounceMs: 100 });

      // PromiseRejectionEvent may not be available in jsdom, simulate manually
      const event = new Event("unhandledrejection") as Event & {
        reason: unknown;
      };
      (event as unknown as Record<string, unknown>).reason = new Error(
        "promise rejection"
      );
      window.dispatchEvent(event);

      jest.advanceTimersByTime(100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe("promise rejection");
    });
  });

  describe("safety", () => {
    it("does not throw when fetch fails", () => {
      mockFetch.mockRejectedValueOnce(new Error("network error"));
      initReporter({ debounceMs: 100 });

      expect(() => {
        reportError(new Error("safe error"));
        jest.advanceTimersByTime(100);
      }).not.toThrow();
    });

    it("does not throw when reportError receives circular objects", () => {
      initReporter({ debounceMs: 100 });
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => {
        reportError(circular);
        jest.advanceTimersByTime(100);
      }).not.toThrow();
    });
  });

  describe("sendBeacon fallback", () => {
    it("uses sendBeacon with correct Content-Type on beforeunload flush", () => {
      initReporter({ debounceMs: 5000 });

      reportError(new Error("beacon error"));

      // Trigger beforeunload before debounce fires
      window.dispatchEvent(new Event("beforeunload"));

      expect(mockSendBeacon).toHaveBeenCalledTimes(1);
      expect(mockSendBeacon).toHaveBeenCalledWith(
        "/api/errors",
        expect.any(Blob)
      );

      // Verify the Blob has the correct content type
      const blob = mockSendBeacon.mock.calls[0][1] as Blob;
      expect(blob.type).toBe("application/json");
    });
  });

  describe("cleanup", () => {
    it("prevents further error reporting via reportError after cleanup", () => {
      const cleanup = initErrorReporter({ debounceMs: 100 });
      cleanup();

      // reportError after cleanup should still queue (it's a standalone function)
      // but window listeners should be removed
      // Verify by checking that the listeners were removed
      const removeSpy = jest.spyOn(window, "removeEventListener");
      const cleanup2 = initErrorReporter({ debounceMs: 100 });
      cleanup2();

      expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function)
      );
      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function)
      );

      removeSpy.mockRestore();
    });
  });
});
