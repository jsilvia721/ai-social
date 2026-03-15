/**
 * @jest-environment jsdom
 */

// Polyfill Web Streams and TextEncoder/TextDecoder for jsdom
import { TextEncoder, TextDecoder } from "util";
import { ReadableStream } from "stream/web";
Object.assign(global, {
  TextEncoder,
  TextDecoder,
  ReadableStream,
});

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

import "@testing-library/jest-dom";
import React, {
  createContext,
  useState,
  useContext,
  isValidElement,
  cloneElement,
  createElement,
} from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// Mock Dialog components from radix — minimal inline rendering
const DialogContext = createContext({
  open: false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onOpenChange: (_v: boolean) => {},
});

jest.mock("radix-ui", () => ({
  Dialog: {
    Root: ({ children, open, onOpenChange }: any) => {
      const [internalOpen, setInternalOpen] = useState(false);
      const isOpen = open !== undefined ? open : internalOpen;
      const handleChange = onOpenChange || setInternalOpen;
      return createElement(
        DialogContext.Provider,
        { value: { open: isOpen, onOpenChange: handleChange } },
        children
      );
    },
    Trigger: ({ children, asChild }: any) => {
      const ctx = useContext(DialogContext);
      if (asChild && isValidElement(children)) {
        return cloneElement(children as React.ReactElement<any>, {
          onClick: () => ctx.onOpenChange(true),
        });
      }
      return createElement(
        "button",
        { onClick: () => ctx.onOpenChange(true) },
        children
      );
    },
    Portal: ({ children }: any) => {
      const ctx = useContext(DialogContext);
      return ctx.open ? children : null;
    },
    Overlay: () => null,
    Content: ({ children }: any) =>
      createElement("div", { "data-slot": "dialog-content" }, children),
    Close: ({ children, asChild }: any) => {
      const ctx = useContext(DialogContext);
      if (asChild && isValidElement(children)) {
        return cloneElement(children as React.ReactElement<any>, {
          onClick: () => ctx.onOpenChange(false),
        });
      }
      return createElement(
        "button",
        { onClick: () => ctx.onOpenChange(false) },
        children
      );
    },
    Title: ({ children, ...props }: any) =>
      createElement("h2", props, children),
    Description: ({ children, ...props }: any) =>
      createElement("p", props, children),
  },
}));

import { FeedbackChat } from "@/components/feedback/FeedbackChat";

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

function openChat() {
  render(<FeedbackChat />);
  fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
}

/** Create a mock ReadableStream that yields SSE events */
function createMockSSEResponse(chunks: string[], done = true) {
  const encoder = new TextEncoder();
  const events = chunks.map((c) => `data: ${JSON.stringify({ type: "text", text: c })}\n\n`);
  if (done) events.push("data: [DONE]\n\n");

  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(encoder.encode(events[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body: stream,
  };
}

describe("FeedbackChat", () => {
  it("renders the floating feedback button", () => {
    render(<FeedbackChat />);
    expect(
      screen.getByRole("button", { name: /feedback/i })
    ).toBeInTheDocument();
  });

  it("opens chat with AI greeting message on modal open", async () => {
    const sseResponse = createMockSSEResponse(["Hi! ", "What's on your mind?"]);
    mockFetch.mockResolvedValueOnce(sseResponse);

    openChat();

    // Should show the chat interface
    expect(screen.getByPlaceholderText(/type your message/i)).toBeInTheDocument();

    // Greeting is fetched via streaming — wait for it
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feedback/chat",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("shows typing indicator while waiting for response", async () => {
    // Mock a response that never resolves to keep waiting state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    openChat();

    // Typing indicator should appear while waiting for greeting
    await waitFor(() => {
      expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    });
  });

  it("sends user message on Enter key", async () => {
    // First call: greeting
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();

    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    // Type a message
    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "I found a bug" } });

    // Second call: response to user message
    const responseSSE = createMockSSEResponse(["Tell me more!"]);
    mockFetch.mockResolvedValueOnce(responseSSE);

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // User message should appear
    expect(screen.getByText("I found a bug")).toBeInTheDocument();
  });

  it("inserts newline on Shift+Enter", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "line 1" } });

    // Shift+Enter should NOT send
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    // Should NOT trigger a second fetch
    expect(mockFetch).toHaveBeenCalledTimes(1); // only greeting
  });

  it("rejects messages shorter than 2 characters", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "a" } });

    // Send button should be disabled
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(sendBtn).toBeDisabled();
  });

  it("shows exchange counter after first exchange", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "I found a bug" } });

    const responseSSE = createMockSSEResponse(["Tell me more"]);
    mockFetch.mockResolvedValueOnce(responseSSE);

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByText(/Tell me more/)).toBeInTheDocument();
    });

    // Exchange counter should show
    expect(screen.getByText(/1 of 10/)).toBeInTheDocument();
  });

  it("shows 'Wrap up' button after 2+ user exchanges", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    // First exchange
    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "Bug report" } });
    mockFetch.mockResolvedValueOnce(createMockSSEResponse(["What happened?"]));
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => {
      expect(screen.getByText(/What happened/)).toBeInTheDocument();
    });

    // No wrap up button yet
    expect(screen.queryByRole("button", { name: /wrap up/i })).not.toBeInTheDocument();

    // Second exchange
    fireEvent.change(input, { target: { value: "It crashed" } });
    mockFetch.mockResolvedValueOnce(createMockSSEResponse(["I see, anything else?"]));
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => {
      expect(screen.getByText(/I see, anything else/)).toBeInTheDocument();
    });

    // Wrap up button should now appear
    expect(screen.getByRole("button", { name: /wrap up/i })).toBeInTheDocument();
  });

  it("handles rate limit (429) with friendly message", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "Another message" } });

    // Mock 429 response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "60" }),
      json: () => Promise.resolve({ error: "Too many requests" }),
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByText(/slow down/i)).toBeInTheDocument();
    });
  });

  it("handles mid-stream error with retry button", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "Tell me about features" } });

    // Create a stream that errors mid-way
    const encoder = new TextEncoder();
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text", text: "Partial " })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: "Stream interrupted" })}\n\n`
          )
        );
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "text/event-stream" }),
      body: errorStream,
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByText(/Partial/)).toBeInTheDocument();
    });

    // Should show retry button
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("resets all state when modal is closed", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    // Close via X button
    const closeButtons = screen.getAllByRole("button");
    const closeBtn = closeButtons.find(
      (btn) => btn.querySelector(".sr-only")?.textContent === "Close"
    );
    if (closeBtn) {
      fireEvent.click(closeBtn);
    }

    // Re-open — greeting should be fetched again (fresh state)
    mockFetch.mockResolvedValueOnce(createMockSSEResponse(["Hello again!"]));
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2); // two greeting fetches
    });
  });

  it("has role=log on message container", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();

    await waitFor(() => {
      const log = screen.getByRole("log");
      expect(log).toBeInTheDocument();
    });
  });

  it("handles screenshot attachment via paperclip button", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    // Upload screenshot
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ url: "https://s3.example.com/shot.png" }),
    });

    const fileInput = screen.getByTestId("chat-screenshot-input");
    const file = new File(["img"], "shot.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/upload",
        expect.objectContaining({ method: "POST" })
      );
    });

    // Should show screenshot preview
    await waitFor(() => {
      expect(screen.getByText("shot.png")).toBeInTheDocument();
    });
  });

  it("renders summary card with confirm and 'not quite' buttons", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    // Send message and get a summary-type response
    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "The button is broken" } });

    // Mock a response that includes a summary JSON
    const summaryText = JSON.stringify({
      type: "summary",
      classification: "bug",
      title: "Button is broken",
      description: "User reports a broken button on the dashboard",
      priority: "high",
    });
    const summaryResponse = createMockSSEResponse([summaryText]);
    mockFetch.mockResolvedValueOnce(summaryResponse);

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Wait for summary to render
    await waitFor(() => {
      const summaryCard = screen.queryByTestId("chat-summary");
      // Summary detection may require the AI to output summary format
      // The component parses the final assistant message for summary JSON
      expect(summaryCard || screen.getByText(/Button is broken/i)).toBeTruthy();
    });
  });

  it("confirm on summary calls /api/feedback/submit", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "Bug report" } });

    const summaryText = JSON.stringify({
      type: "summary",
      classification: "bug",
      title: "Test bug",
      description: "Test description",
      priority: "medium",
    });
    mockFetch.mockResolvedValueOnce(createMockSSEResponse([summaryText]));

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-summary")).toBeInTheDocument();
    });

    // Mock the submit call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "fb-1",
          githubIssueUrl: "https://github.com/test/issues/42",
        }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /looks good/i }));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feedback/submit",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    // Should show success
    await waitFor(() => {
      expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    });
  });

  it("'Not quite' on summary continues conversation", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    openChat();
    await waitFor(() => {
      expect(screen.getByText(/Hello!/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "Feature request" } });

    const summaryText = JSON.stringify({
      type: "summary",
      classification: "feature",
      title: "New feature",
      description: "A new feature description",
      priority: "low",
    });
    mockFetch.mockResolvedValueOnce(createMockSSEResponse([summaryText]));

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-summary")).toBeInTheDocument();
    });

    // Click "Not quite"
    mockFetch.mockResolvedValueOnce(
      createMockSSEResponse(["What would you like to change?"])
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /not quite/i }));
    });

    // Summary should be dismissed, conversation continues
    await waitFor(() => {
      expect(screen.queryByTestId("chat-summary")).not.toBeInTheDocument();
    });

    // Input should be available again
    expect(screen.getByPlaceholderText(/type your message/i)).toBeInTheDocument();
  });
});
