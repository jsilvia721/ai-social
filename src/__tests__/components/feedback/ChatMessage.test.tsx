/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "@/components/feedback/ChatMessage";

describe("ChatMessage", () => {
  it("renders user message right-aligned", () => {
    render(<ChatMessage role="user" content="Hello there" />);
    const message = screen.getByText("Hello there");
    // User messages should be right-aligned (justify-end)
    const container = message.closest("[data-testid='chat-message']");
    expect(container).toHaveClass("justify-end");
  });

  it("renders assistant message left-aligned", () => {
    render(<ChatMessage role="assistant" content="Hi! How can I help?" />);
    const message = screen.getByText("Hi! How can I help?");
    const container = message.closest("[data-testid='chat-message']");
    expect(container).toHaveClass("justify-start");
  });

  it("applies user bubble styling", () => {
    render(<ChatMessage role="user" content="Bug report" />);
    const text = screen.getByText("Bug report");
    const bubble = text.closest("div.bg-blue-600");
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveClass("text-white");
  });

  it("applies assistant bubble styling", () => {
    render(<ChatMessage role="assistant" content="Tell me more" />);
    const text = screen.getByText("Tell me more");
    const bubble = text.closest("div.bg-zinc-800");
    expect(bubble).toBeInTheDocument();
  });

  it("renders screenshot attachment when provided", () => {
    render(
      <ChatMessage
        role="user"
        content="See this bug"
        screenshotUrl="https://s3.example.com/screenshot.png"
      />
    );
    const img = screen.getByAltText("Screenshot attachment");
    expect(img).toHaveAttribute("src", "https://s3.example.com/screenshot.png");
  });

  it("does not render screenshot when not provided", () => {
    render(<ChatMessage role="user" content="No screenshot" />);
    expect(screen.queryByAltText("Screenshot attachment")).not.toBeInTheDocument();
  });

  it("uses aria-live polite for assistant messages", () => {
    render(<ChatMessage role="assistant" content="New message" />);
    const container = screen.getByText("New message").closest("[data-testid='chat-message']");
    expect(container).toHaveAttribute("aria-live", "polite");
  });

  it("does not use aria-live for user messages", () => {
    render(<ChatMessage role="user" content="My message" />);
    const container = screen.getByText("My message").closest("[data-testid='chat-message']");
    expect(container).not.toHaveAttribute("aria-live");
  });

  it("renders streaming content with cursor when isStreaming", () => {
    render(
      <ChatMessage role="assistant" content="Partial text" isStreaming />
    );
    expect(screen.getByText("Partial text")).toBeInTheDocument();
    // Should have a blinking cursor indicator
    const cursor = screen.getByTestId("streaming-cursor");
    expect(cursor).toBeInTheDocument();
  });
});
