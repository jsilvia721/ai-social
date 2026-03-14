/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React, { createContext, useState, useContext, isValidElement, cloneElement, createElement } from "react";
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
  jest.useFakeTimers();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

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

  it("opens dialog when clicked", () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    expect(screen.getByText(/send feedback/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/what's on your mind/i)
    ).toBeInTheDocument();
  });

  it("has sr-only label for textarea", () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const label = document.querySelector('label[for="feedback-message"]');
    expect(label).toBeInTheDocument();
    expect(label).toHaveClass("sr-only");
  });

  it("shows character counter when message exceeds 4000 chars", () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "a".repeat(4001) } });
    expect(screen.getByText(/4001\s*\/\s*5000/)).toBeInTheDocument();
  });

  it("does not show character counter for short messages", () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Short message" } });
    expect(screen.queryByText(/\/\s*5000/)).not.toBeInTheDocument();
  });

  it("disables send button when message is empty", () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(sendBtn).toBeDisabled();
  });

  it("submits feedback with correct payload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "fb-1",
          githubIssueUrl: "https://github.com/test/1",
        }),
    });

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Great feature!" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("Great feature!"),
      });
    });

    // Verify payload structure
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toMatchObject({
      message: "Great feature!",
      pageUrl: expect.any(String),
      metadata: { userAgent: expect.any(String) },
    });
  });

  it("shows success state with GitHub issue link", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "fb-1",
          githubIssueUrl: "https://github.com/test/issues/1",
        }),
    });

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Bug report" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    });

    expect(
      screen.getByRole("link", { name: /view issue on github/i })
    ).toHaveAttribute("href", "https://github.com/test/issues/1");
  });

  it("shows error state on submission failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Server error" }),
    });

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Bug report" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("shows spinner and disables button during submission", async () => {
    // Never resolves to keep loading state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Loading test" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    // Button should be disabled during submission
    await waitFor(() => {
      const sendBtn = screen.getByRole("button", { name: /send/i });
      expect(sendBtn).toBeDisabled();
    });
  });

  it("handles screenshot upload success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ url: "https://s3.example.com/screenshot.png" }),
    });

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const fileInput = screen.getByLabelText(/attach screenshot/i);
    const file = new File(["screenshot"], "screenshot.png", {
      type: "image/png",
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/upload",
        expect.objectContaining({ method: "POST" })
      );
    });

    // Should show the filename
    await waitFor(() => {
      expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    });
  });

  it("handles screenshot upload failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Upload failed" }),
    });

    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));

    const fileInput = screen.getByLabelText(/attach screenshot/i);
    const file = new File(["screenshot"], "screenshot.png", {
      type: "image/png",
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
    });

    // Should still be able to submit without screenshot
    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Bug without screenshot" } });
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });

  it("resets state when dialog is closed", () => {
    render(<FeedbackButton />);

    // Open and type
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const textarea = screen.getByPlaceholderText(/what's on your mind/i);
    fireEvent.change(textarea, { target: { value: "Some text" } });
    expect(textarea).toHaveValue("Some text");

    // Close via the X button (from DialogContent's showCloseButton)
    const closeButtons = screen.getAllByRole("button");
    const closeBtn = closeButtons.find(
      (btn) => btn.querySelector(".sr-only")?.textContent === "Close"
    );
    if (closeBtn) {
      fireEvent.click(closeBtn);
    }

    // Re-open
    fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
    const newTextarea = screen.getByPlaceholderText(/what's on your mind/i);
    expect(newTextarea).toHaveValue("");
  });
});
