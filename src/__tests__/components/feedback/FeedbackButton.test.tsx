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

import { FeedbackButton } from "@/components/feedback/FeedbackButton";

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

/** Create a mock ReadableStream that yields SSE events */
function createMockSSEResponse(chunks: string[], done = true) {
  const encoder = new TextEncoder();
  const events = chunks.map(
    (c) => `data: ${JSON.stringify({ type: "text", text: c })}\n\n`
  );
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

describe("FeedbackButton", () => {
  it("renders the floating feedback button", () => {
    render(<FeedbackButton />);
    expect(
      screen.getByRole("button", { name: /feedback/i })
    ).toBeInTheDocument();
  });

  it("has fixed positioning at bottom-right with z-50", () => {
    render(<FeedbackButton />);
    const button = screen.getByRole("button", { name: /feedback/i });
    const container = button.closest("div.fixed");
    expect(container).toHaveClass("fixed", "bottom-4", "right-4", "z-50");
  });

  it("opens dialog with chat interface when clicked", async () => {
    const greetingResponse = createMockSSEResponse(["Hi! How can I help?"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    // Should show chat input (not textarea from old flow)
    expect(
      screen.getByPlaceholderText(/type your message/i)
    ).toBeInTheDocument();

    // Should NOT show old textarea elements
    expect(
      screen.queryByPlaceholderText(/what's on your mind/i)
    ).not.toBeInTheDocument();
  });

  it("does not render old textarea or character counter", () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    // No textarea with old placeholder
    expect(screen.queryByLabelText(/feedback message/i)).not.toBeInTheDocument();
    // No character counter
    expect(screen.queryByText(/\/\s*5000/)).not.toBeInTheDocument();
  });

  it("dialog shows Send Feedback title", () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    expect(screen.getByText(/send feedback/i)).toBeInTheDocument();
  });

  it("fetches AI greeting when dialog opens", async () => {
    const greetingResponse = createMockSSEResponse(["Hello! What can I help with?"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feedback/chat",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("resets FeedbackChat state when dialog is closed and reopened", async () => {
    // First open: greeting
    const greetingResponse1 = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse1);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

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

    // Re-open should fetch a new greeting (fresh FeedbackChat instance)
    const greetingResponse2 = createMockSSEResponse(["Hello again!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse2);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it("shows chat message log region", async () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole("log")).toBeInTheDocument();
    });
  });

  it("has accessible sr-only Close label in dialog", () => {
    const greetingResponse = createMockSSEResponse(["Hello!"]);
    mockFetch.mockResolvedValueOnce(greetingResponse);

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
  });
});
