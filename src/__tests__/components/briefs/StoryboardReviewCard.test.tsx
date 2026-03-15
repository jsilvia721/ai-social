/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, fireEvent, waitFor, screen, cleanup } from "@testing-library/react";
import { StoryboardReviewCard } from "@/components/briefs/StoryboardReviewCard";

const baseBrief = {
  id: "brief-1",
  topic: "Product launch video",
  platform: "INSTAGRAM" as const,
  scheduledFor: "2026-03-20T10:00:00Z",
  videoScript: "Scene 1: Open with product close-up...",
  videoPrompt: "A sleek product reveal with dynamic camera movement",
  storyboardImageUrl: "https://cdn.example.com/storyboard.png",
  status: "STORYBOARD_REVIEW" as const,
  updatedAt: new Date().toISOString(),
};

const renderingBrief = {
  ...baseBrief,
  id: "brief-2",
  status: "RENDERING" as const,
  updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  cleanup();
});

describe("StoryboardReviewCard", () => {
  describe("STORYBOARD_REVIEW state", () => {
    it("renders thumbnail, script, editable prompt, platform badge, and scheduled date", () => {
      render(
        <StoryboardReviewCard brief={baseBrief} onStatusChange={jest.fn()} />
      );

      // Thumbnail
      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", baseBrief.storyboardImageUrl);

      // Script
      expect(screen.getByText(baseBrief.videoScript)).toBeInTheDocument();

      // Editable prompt textarea
      const textarea = screen.getByDisplayValue(baseBrief.videoPrompt);
      expect(textarea.tagName.toLowerCase()).toBe("textarea");

      // Platform badge
      expect(screen.getByText("Instagram")).toBeInTheDocument();

      // Scheduled date
      expect(screen.getByText(/Mar 20/)).toBeInTheDocument();

      // Approve and Reject buttons
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    });

    it("allows editing the video prompt", () => {
      render(
        <StoryboardReviewCard brief={baseBrief} onStatusChange={jest.fn()} />
      );

      const textarea = screen.getByDisplayValue(baseBrief.videoPrompt);
      fireEvent.change(textarea, { target: { value: "New edited prompt" } });
      expect(screen.getByDisplayValue("New edited prompt")).toBeInTheDocument();
    });

    it("sends POST with edited prompt on approve and shows loading state", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ predictionId: "pred-123" }),
      });

      const onStatusChange = jest.fn();
      render(
        <StoryboardReviewCard brief={baseBrief} onStatusChange={onStatusChange} />
      );

      // Edit the prompt
      const textarea = screen.getByDisplayValue(baseBrief.videoPrompt);
      fireEvent.change(textarea, { target: { value: "Edited prompt text" } });

      // Click approve
      const approveBtn = screen.getByRole("button", { name: /approve/i });
      fireEvent.click(approveBtn);

      // Should show loading state
      expect(screen.getByText(/approving/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/briefs/brief-1/approve-storyboard",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoPrompt: "Edited prompt text" }),
          })
        );
      });

      await waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledWith("brief-1", "RENDERING");
      });
    });

    it("sends POST on reject and calls onStatusChange with removed", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const onStatusChange = jest.fn();
      render(
        <StoryboardReviewCard brief={baseBrief} onStatusChange={onStatusChange} />
      );

      const rejectBtn = screen.getByRole("button", { name: /reject/i });
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/briefs/brief-1/reject-storyboard",
          expect.objectContaining({ method: "POST" })
        );
      });

      await waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledWith("brief-1", "REMOVED");
      });
    });
  });

  describe("RENDERING state", () => {
    it("shows thumbnail with rendering overlay and elapsed time", () => {
      render(
        <StoryboardReviewCard brief={renderingBrief} onStatusChange={jest.fn()} />
      );

      expect(screen.getByText(/rendering/i)).toBeInTheDocument();
      expect(screen.getByText(/5m ago/i)).toBeInTheDocument();

      // Should NOT show approve/reject buttons
      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    });
  });

  describe("missing fields", () => {
    it("handles missing storyboard image gracefully", () => {
      const brief = { ...baseBrief, storyboardImageUrl: null };
      render(
        <StoryboardReviewCard brief={brief} onStatusChange={jest.fn()} />
      );

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText(/no thumbnail/i)).toBeInTheDocument();
    });
  });
});
