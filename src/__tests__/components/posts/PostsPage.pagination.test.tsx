/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock next-auth session
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", activeBusinessId: null } },
    status: "authenticated",
  }),
}));

// Mock child components to isolate pagination behavior
jest.mock("@/components/posts/PostCard", () => ({
  PostCard: ({ post }: { post: { id: string; content: string } }) => (
    <div data-testid={`post-${post.id}`}>{post.content}</div>
  ),
}));
jest.mock("@/components/posts/ContentCalendar", () => ({
  ContentCalendar: () => <div>Calendar</div>,
}));
jest.mock("@/components/posts/WeekCalendar", () => ({
  WeekCalendar: () => <div>Week</div>,
  getMondayOfWeek: () => new Date("2026-03-09"),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import PostsPage from "@/app/dashboard/posts/page";

function mockFetchResponse(posts: { id: string; content: string }[], total: number, page = 1) {
  return {
    ok: true,
    json: async () => ({ posts, total, page, limit: 20 }),
  } as Response;
}

function makePosts(count: number, startIdx = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `post-${startIdx + i + 1}`,
    content: `Post ${startIdx + i + 1}`,
    status: "DRAFT",
    scheduledAt: null,
    errorMessage: null,
    metricsLikes: null,
    metricsComments: null,
    metricsShares: null,
    metricsImpressions: null,
    metricsReach: null,
    metricsSaves: null,
    socialAccount: { platform: "TWITTER", username: "test" },
  }));
}

describe("PostsPage pagination", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  it("fetches with page=1 and limit=20 on initial load", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(20), 45));

    render(<PostsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("page=1")
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("limit=20")
      );
    });
  });

  it("shows pagination controls when total exceeds one page", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(20), 45));

    render(<PostsPage />);

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("does not show pagination when all posts fit on one page", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(5), 5));

    render(<PostsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("post-post-1")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });

  it("fetches next page when Next is clicked", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(20), 45));

    render(<PostsPage />);

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    // Prepare mock for page 2
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(20, 20), 45, 2));

    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("page=2")
      );
    });
  });

  it("resets to page 1 when switching status tabs", async () => {
    // Start on page 2
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(20), 45));

    render(<PostsPage />);

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    // Go to page 2
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(20, 20), 45, 2));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("page=2"));
    });

    // Switch tab — should reset to page 1
    fetchMock.mockResolvedValue(mockFetchResponse(makePosts(5), 5, 1));
    await userEvent.click(screen.getByText("Scheduled"));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
      expect(lastCall).toContain("page=1");
      expect(lastCall).toContain("status=SCHEDULED");
    });
  });
});
