"use client";

const DEDUP_RESET_MS = 5 * 60 * 1000; // 5 minutes
const CIRCUIT_BREAKER_LIMIT = 100;
const API_ENDPOINT = "/api/errors";

interface ErrorReporterOptions {
  enabled?: boolean;
  captureConsoleErrors?: boolean;
  debounceMs?: number;
}

interface ErrorContext {
  url?: string;
  metadata?: Record<string, unknown>;
}

interface ErrorPayload {
  message: string;
  stack?: string;
  source: "CLIENT";
  url?: string;
  metadata?: Record<string, unknown>;
}

// Module state
let reportedFingerprints = new Set<string>();
let errorQueue: ErrorPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dedupResetTimer: ReturnType<typeof setInterval> | null = null;
let currentDebounceMs = 1000;

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error === null || error === undefined) {
    return { message: `Unknown error: ${String(error)}` };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: `Unknown error: ${String(error)}` };
  }
}

function sendViaFetch(payload: ErrorPayload): void {
  try {
    fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently drop failed reports
    });
  } catch {
    // Safety: never throw from error reporter
  }
}

function sendViaBeacon(payload: ErrorPayload): void {
  try {
    navigator.sendBeacon(API_ENDPOINT, JSON.stringify(payload));
  } catch {
    // Silently drop
  }
}

function flushQueue(useBeacon = false): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const toSend = errorQueue.splice(0);
  for (const payload of toSend) {
    if (useBeacon) {
      sendViaBeacon(payload);
    } else {
      sendViaFetch(payload);
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, currentDebounceMs);
}

export function reportError(error: unknown, context?: ErrorContext): void {
  try {
    if (reportedFingerprints.size >= CIRCUIT_BREAKER_LIMIT) {
      return;
    }

    const { message, stack } = normalizeError(error);

    // Deduplicate by message
    if (reportedFingerprints.has(message)) {
      return;
    }
    reportedFingerprints.add(message);

    let url = context?.url;
    if (!url && typeof window !== "undefined") {
      url = window.location.href;
    }

    const payload: ErrorPayload = {
      message,
      stack,
      source: "CLIENT",
      url,
      metadata: context?.metadata,
    };

    errorQueue.push(payload);
    scheduleFlush();
  } catch {
    // Safety: never throw from error reporter
  }
}

export function initErrorReporter(
  options?: ErrorReporterOptions
): () => void {
  const {
    enabled = true,
    captureConsoleErrors = false,
    debounceMs = 1000,
  } = options ?? {};

  currentDebounceMs = debounceMs;

  if (!enabled) {
    return () => {};
  }

  // Start dedup reset interval
  dedupResetTimer = setInterval(() => {
    reportedFingerprints = new Set();
  }, DEDUP_RESET_MS);

  // Window error listener
  const handleError = (event: ErrorEvent): void => {
    try {
      // Ignore resource/network errors (no .error property)
      if (!event.error) return;
      reportError(event.error);
    } catch {
      // Safety
    }
  };

  // Unhandled rejection listener
  const handleRejection = (event: PromiseRejectionEvent | Event): void => {
    try {
      const reason = (event as PromiseRejectionEvent).reason;
      reportError(reason);
    } catch {
      // Safety
    }
  };

  // Beforeunload listener - flush with beacon
  const handleBeforeUnload = (): void => {
    try {
      flushQueue(true);
    } catch {
      // Safety
    }
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);
  window.addEventListener("beforeunload", handleBeforeUnload);

  // Console.error capture
  let originalConsoleError: typeof console.error | null = null;
  if (captureConsoleErrors) {
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      try {
        originalConsoleError!(...args);
        // Only capture Error instances to avoid noise
        if (args[0] instanceof Error) {
          reportError(args[0]);
        }
      } catch {
        // Safety
      }
    };
  }

  // Return cleanup function
  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
    window.removeEventListener("beforeunload", handleBeforeUnload);

    if (dedupResetTimer) {
      clearInterval(dedupResetTimer);
      dedupResetTimer = null;
    }

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (originalConsoleError) {
      console.error = originalConsoleError;
    }
  };
}

/** Reset module state for testing. Do not use in production. */
export function _resetForTesting(): void {
  reportedFingerprints = new Set();
  errorQueue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dedupResetTimer) {
    clearInterval(dedupResetTimer);
    dedupResetTimer = null;
  }
  currentDebounceMs = 1000;
}
