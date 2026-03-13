/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next-auth/react
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", activeBusinessId: "biz-1" },
    },
  }),
}));

// Mock error-reporter
jest.mock("@/lib/error-reporter", () => ({
  reportError: jest.fn(),
}));

import { PostComposer } from "@/components/posts/PostComposer";

beforeEach(() => {
  jest.clearAllMocks();
  // Mock accounts fetch - return Instagram account
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve([
        { id: "acc-ig", platform: "INSTAGRAM", username: "testgram" },
        { id: "acc-tw", platform: "TWITTER", username: "testbird" },
      ]),
  });
});

afterEach(() => {
  cleanup();
});

describe("PostComposer cover image", () => {
  describe("visibility conditions", () => {
    it("does not show cover image section when no platform selected", () => {
      render(<PostComposer />);
      expect(screen.queryByText("Cover image")).toBeNull();
    });

    it("does not show cover image section for non-Instagram platform in edit mode", () => {
      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-tw",
            platform: "TWITTER",
            username: "testbird",
            scheduledAt: null,
            mediaUrls: ["https://example.com/video.mp4"],
          }}
        />
      );
      expect(screen.queryByText("Cover image")).toBeNull();
    });

    it("does not show cover image section for Instagram without video", () => {
      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-ig",
            platform: "INSTAGRAM",
            username: "testgram",
            scheduledAt: null,
            mediaUrls: ["https://example.com/photo.jpg"],
          }}
        />
      );
      expect(screen.queryByText("Cover image")).toBeNull();
    });

    it("shows cover image section for Instagram with video", () => {
      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-ig",
            platform: "INSTAGRAM",
            username: "testgram",
            scheduledAt: null,
            mediaUrls: ["https://example.com/video.mp4"],
          }}
        />
      );
      expect(screen.getByText("Cover image")).toBeTruthy();
      expect(screen.getByText("Upload cover")).toBeTruthy();
    });
  });

  describe("edit mode pre-population", () => {
    it("pre-populates cover image from editPost", () => {
      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-ig",
            platform: "INSTAGRAM",
            username: "testgram",
            scheduledAt: null,
            mediaUrls: ["https://example.com/video.mp4"],
            coverImageUrl: "https://example.com/cover.jpg",
          }}
        />
      );
      // Should show preview image
      const img = screen.getByAltText("Cover image preview");
      expect(img).toBeTruthy();
      expect((img as HTMLImageElement).src).toBe("https://example.com/cover.jpg");
    });
  });

  describe("remove cover image", () => {
    it("removes cover image when remove button is clicked", async () => {
      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-ig",
            platform: "INSTAGRAM",
            username: "testgram",
            scheduledAt: null,
            mediaUrls: ["https://example.com/video.mp4"],
            coverImageUrl: "https://example.com/cover.jpg",
          }}
        />
      );
      expect(screen.getByAltText("Cover image preview")).toBeTruthy();

      // Click the remove button
      const removeButton = screen.getByLabelText("Remove cover image");
      fireEvent.click(removeButton);

      expect(screen.queryByAltText("Cover image preview")).toBeNull();
    });
  });

  describe("coverImageUrl in submit body", () => {
    it("includes coverImageUrl in POST/PATCH body when set", async () => {
      const fetchMock = jest.fn()
        // First call is accounts fetch (edit mode skips this but just in case)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "p1" }),
        });
      global.fetch = fetchMock;

      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-ig",
            platform: "INSTAGRAM",
            username: "testgram",
            scheduledAt: null,
            mediaUrls: ["https://example.com/video.mp4"],
            coverImageUrl: "https://example.com/cover.jpg",
          }}
        />
      );

      // Submit the form
      const submitButton = screen.getByRole("button", { name: /save draft/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        // Find the PATCH call
        const patchCall = fetchMock.mock.calls.find(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/posts/")
        );
        expect(patchCall).toBeDefined();
        const body = JSON.parse((patchCall![1] as { body: string }).body);
        expect(body.coverImageUrl).toBe("https://example.com/cover.jpg");
      });
    });

    it("does not include coverImageUrl when not set", async () => {
      const fetchMock = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "p1" }),
        });
      global.fetch = fetchMock;

      render(
        <PostComposer
          editPost={{
            id: "p1",
            content: "hello",
            socialAccountId: "acc-ig",
            platform: "INSTAGRAM",
            username: "testgram",
            scheduledAt: null,
            mediaUrls: ["https://example.com/video.mp4"],
          }}
        />
      );

      const submitButton = screen.getByRole("button", { name: /save draft/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/posts/")
        );
        expect(patchCall).toBeDefined();
        const body = JSON.parse((patchCall![1] as { body: string }).body);
        expect(body.coverImageUrl).toBeUndefined();
      });
    });
  });
});
