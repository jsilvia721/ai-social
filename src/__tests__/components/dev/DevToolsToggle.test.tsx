/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { DevToolsToggle } from "@/components/dev/DevToolsToggle";

describe("DevToolsToggle", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("renders nothing when mocking is null (initial state)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ mocking: null }),
    });

    const { container } = render(<DevToolsToggle />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/dev/mock-mode");
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders LIVE badge when not mocking", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ mocking: false }),
    });

    render(<DevToolsToggle />);
    await waitFor(() => {
      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });
  });

  it("renders MOCK badge when mocking", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ mocking: true }),
    });

    render(<DevToolsToggle />);
    await waitFor(() => {
      expect(screen.getByText("MOCK")).toBeInTheDocument();
    });
  });

  it("uses responsive positioning to avoid mobile content overlap", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ mocking: false }),
    });

    render(<DevToolsToggle />);
    await waitFor(() => {
      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });

    // The container div should have mobile-friendly bottom positioning
    const container = screen.getByText("LIVE").closest("div.fixed");
    expect(container).toHaveClass("bottom-16");
    expect(container).toHaveClass("md:bottom-4");
  });
});
