/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { PostCard } from "@/components/posts/PostCard";
import type { PostStatus, Platform } from "@/types";

function makePost(overrides: Partial<{
  id: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  errorMessage: string | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  metricsImpressions: number | null;
  metricsReach: number | null;
  metricsSaves: number | null;
  socialAccount: { platform: Platform; username: string };
}> = {}) {
  return {
    id: "post-1",
    content: "Hello world post content for testing the card display",
    status: "SCHEDULED" as PostStatus,
    scheduledAt: "2026-03-15T10:00:00Z",
    errorMessage: null,
    metricsLikes: null,
    metricsComments: null,
    metricsShares: null,
    metricsImpressions: null,
    metricsReach: null,
    metricsSaves: null,
    socialAccount: { platform: "TWITTER" as Platform, username: "testuser" },
    ...overrides,
  };
}

describe("PostCard", () => {
  const mockDelete = jest.fn().mockResolvedValue(undefined);
  const mockRetry = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ repurposeGroupId: "rg-1" }),
    });
  });

  it("renders post content", () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    expect(screen.getByText("Hello world post content for testing the card display")).toBeInTheDocument();
  });

  it("renders username with @ prefix", () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    expect(screen.getByText("@testuser")).toBeInTheDocument();
  });

  it("renders scheduled date", () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    // The date text contains a · prefix and formatted date
    const dateEl = screen.getByText(/Mar/);
    expect(dateEl).toBeInTheDocument();
  });

  it("renders edit button for non-published posts", () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    expect(screen.getByLabelText("Edit post")).toBeInTheDocument();
  });

  it("hides edit button for published posts", () => {
    render(<PostCard post={makePost({ status: "PUBLISHED" })} onDelete={mockDelete} />);
    expect(screen.queryByLabelText("Edit post")).not.toBeInTheDocument();
  });

  it("shows retry button for failed posts", () => {
    render(
      <PostCard
        post={makePost({ status: "FAILED", errorMessage: "Rate limited" })}
        onDelete={mockDelete}
        onRetry={mockRetry}
      />
    );
    expect(screen.getByLabelText("Retry post")).toBeInTheDocument();
  });

  it("shows error message for failed posts", () => {
    render(
      <PostCard
        post={makePost({ status: "FAILED", errorMessage: "Rate limited" })}
        onDelete={mockDelete}
      />
    );
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
  });

  it("renders delete button", () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    expect(screen.getByLabelText("Delete post")).toBeInTheDocument();
  });

  it("calls onDelete when delete button is clicked", async () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    fireEvent.click(screen.getByLabelText("Delete post"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("post-1"));
  });

  it("calls onRetry when retry button is clicked", async () => {
    render(
      <PostCard
        post={makePost({ status: "FAILED", errorMessage: "err" })}
        onDelete={mockDelete}
        onRetry={mockRetry}
      />
    );
    fireEvent.click(screen.getByLabelText("Retry post"));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith("post-1"));
  });

  it("renders repurpose button", () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    expect(screen.getByLabelText("Repurpose to all platforms")).toBeInTheDocument();
  });

  it("shows metrics for published posts", () => {
    render(
      <PostCard
        post={makePost({
          status: "PUBLISHED",
          metricsLikes: 1500,
          metricsComments: 42,
          metricsShares: 200,
          metricsImpressions: 50000,
        })}
        onDelete={mockDelete}
      />
    );
    expect(screen.getByText("1.5K")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("50.0K")).toBeInTheDocument();
  });

  it("navigates to repurpose page when repurpose button is clicked", async () => {
    render(<PostCard post={makePost()} onDelete={mockDelete} />);
    fireEvent.click(screen.getByLabelText("Repurpose to all platforms"));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/posts/repurpose", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sourceContent: "Hello world post content for testing the card display" }),
      }));
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/posts/repurpose/rg-1");
    });
  });

  // Mobile-specific layout tests
  describe("mobile layout", () => {
    it("uses larger padding on mobile (p-5) and normal on sm (sm:p-4)", () => {
      const { container } = render(<PostCard post={makePost()} onDelete={mockDelete} />);
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain("p-5");
      expect(card.className).toContain("sm:p-4");
    });

    it("uses base text size on mobile for content", () => {
      render(<PostCard post={makePost()} onDelete={mockDelete} />);
      const content = screen.getByText("Hello world post content for testing the card display");
      expect(content.className).toContain("text-base");
      expect(content.className).toContain("sm:text-sm");
    });

    it("uses larger touch targets for action buttons on mobile", () => {
      render(<PostCard post={makePost()} onDelete={mockDelete} />);
      const deleteBtn = screen.getByLabelText("Delete post");
      expect(deleteBtn.className).toContain("h-10");
      expect(deleteBtn.className).toContain("w-10");
      expect(deleteBtn.className).toContain("sm:h-8");
      expect(deleteBtn.className).toContain("sm:w-8");
    });

    it("uses larger platform icon on mobile", () => {
      const { container } = render(<PostCard post={makePost()} onDelete={mockDelete} />);
      const platformIcon = container.querySelector("svg[aria-hidden='true']") as SVGElement;
      expect(platformIcon.className.baseVal || platformIcon.getAttribute("class")).toContain("h-6");
      expect(platformIcon.className.baseVal || platformIcon.getAttribute("class")).toContain("sm:h-5");
    });
  });
});
