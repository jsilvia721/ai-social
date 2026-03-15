/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CronConfigItem } from "@/components/system/types";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockConfigs: CronConfigItem[] = [
  {
    id: "1",
    cronName: "publish",
    scheduleExpression: "rate(1 minute)",
    scheduleType: "rate",
    enabled: true,
    intervalValue: 1,
    intervalUnit: "minutes",
    dayOfWeek: null,
    hourUtc: null,
    syncStatus: "SYNCED",
    updatedAt: "2026-03-15T00:00:00.000Z",
    lastRunAt: "2026-03-15T12:00:00.000Z",
    lastStatus: "SUCCESS",
  },
  {
    id: "2",
    cronName: "metrics",
    scheduleExpression: "rate(60 minutes)",
    scheduleType: "rate",
    enabled: true,
    intervalValue: 60,
    intervalUnit: "minutes",
    dayOfWeek: null,
    hourUtc: null,
    syncStatus: "SYNCED",
    updatedAt: "2026-03-15T00:00:00.000Z",
    lastRunAt: "2026-03-14T23:00:00.000Z",
    lastStatus: "SUCCESS",
  },
  {
    id: "3",
    cronName: "optimize",
    scheduleExpression: "cron(0 23 ? * SUN *)",
    scheduleType: "cron",
    enabled: true,
    intervalValue: null,
    intervalUnit: null,
    dayOfWeek: "SUN",
    hourUtc: 23,
    syncStatus: "SYNCED",
    updatedAt: "2026-03-15T00:00:00.000Z",
    lastRunAt: "2026-03-09T23:00:00.000Z",
    lastStatus: "SUCCESS",
  },
  {
    id: "4",
    cronName: "research",
    scheduleExpression: "rate(6 hours)",
    scheduleType: "rate",
    enabled: false,
    intervalValue: 6,
    intervalUnit: "hours",
    dayOfWeek: null,
    hourUtc: null,
    syncStatus: "PENDING",
    updatedAt: "2026-03-15T00:00:00.000Z",
    lastRunAt: null,
    lastStatus: null,
  },
];

function mockFetchSuccess() {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ configs: mockConfigs }),
  }) as jest.Mock;
}

function mockFetchError() {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "Internal server error" }),
  }) as jest.Mock;
}

import { CronScheduleManager } from "@/components/system/CronScheduleManager";

describe("CronScheduleManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {})) as jest.Mock;
    render(<CronScheduleManager />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders cron cards after loading", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Publisher")).toBeInTheDocument();
    });
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    expect(screen.getByText("Optimizer")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    mockFetchError();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });

  it("shows cron descriptions", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(
        screen.getByText("Publishes scheduled posts when due")
      ).toBeInTheDocument();
    });
  });

  it("shows enabled/disabled status", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Publisher")).toBeInTheDocument();
    });
    // Research is disabled
    const researchCard = screen
      .getByText("Research")
      .closest("[data-testid]") as HTMLElement;
    expect(researchCard).toBeInTheDocument();
    const toggles = screen.getAllByRole("switch");
    // Find the research toggle (disabled)
    const researchToggle = toggles.find(
      (t) => !t.getAttribute("aria-checked") || t.getAttribute("aria-checked") === "false"
    );
    expect(researchToggle).toBeDefined();
  });

  it("shows sync status badges", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Publisher")).toBeInTheDocument();
    });
    // SYNCED badges
    const syncedBadges = screen.getAllByText("Synced");
    expect(syncedBadges.length).toBeGreaterThan(0);
    // PENDING badge for research
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows last run time", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Publisher")).toBeInTheDocument();
    });
    // Publisher has a last run
    const publishCard = screen
      .getByText("Publisher")
      .closest("[data-testid]") as HTMLElement;
    expect(within(publishCard).getByText(/last run/i)).toBeInTheDocument();
  });

  it("shows human-readable schedule for rate crons", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Publisher")).toBeInTheDocument();
    });
    // Publish: every 1 minute(s)
    expect(screen.getByText(/every 1 minute/i)).toBeInTheDocument();
    // Metrics: every 60 minutes
    expect(screen.getByText(/every 60 minute/i)).toBeInTheDocument();
  });

  it("shows human-readable schedule for weekly crons", async () => {
    mockFetchSuccess();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Optimizer")).toBeInTheDocument();
    });
    expect(screen.getByText(/sunday/i)).toBeInTheDocument();
    expect(screen.getByText(/23:00 UTC/i)).toBeInTheDocument();
  });

  it("toggles enabled state with optimistic update on non-publish cron", async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Metrics")).toBeInTheDocument();
    });

    // Mock the PATCH call
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const metricsCard = screen
      .getByText("Metrics")
      .closest("[data-testid]") as HTMLElement;
    const toggle = within(metricsCard).getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await user.click(toggle);

    // Optimistic: should immediately update
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("shows confirmation dialog when disabling publish", async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Publisher")).toBeInTheDocument();
    });

    // Mock the scheduled posts count fetch
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ total: 3 }),
    });

    const publishCard = screen
      .getByText("Publisher")
      .closest("[data-testid]") as HTMLElement;
    const toggle = within(publishCard).getByRole("switch");
    await user.click(toggle);

    // Should show confirmation dialog
    await waitFor(() => {
      expect(screen.getByText("Disable Publisher?")).toBeInTheDocument();
    });
    expect(screen.getByText(/3 scheduled posts/)).toBeInTheDocument();
  });

  it("shows edit button and reveals schedule editor", async () => {
    mockFetchSuccess();
    const user = userEvent.setup();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Metrics")).toBeInTheDocument();
    });

    const metricsCard = screen
      .getByText("Metrics")
      .closest("[data-testid]") as HTMLElement;
    const editBtn = within(metricsCard).getByRole("button", { name: /edit/i });
    await user.click(editBtn);

    // Should show save and cancel buttons
    expect(
      within(metricsCard).getByRole("button", { name: /save/i })
    ).toBeInTheDocument();
    expect(
      within(metricsCard).getByRole("button", { name: /cancel/i })
    ).toBeInTheDocument();
  });

  it("shows retry button on fetch failure", async () => {
    mockFetchError();
    render(<CronScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
