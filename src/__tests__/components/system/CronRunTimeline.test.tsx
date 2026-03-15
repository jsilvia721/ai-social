/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CronRunTimeline, PAGE_SIZE } from "@/components/system/CronRunTimeline";
import type { CronRunRow } from "@/components/system/types";

function makeRuns(count: number): CronRunRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `run-${i}`,
    cronName: i % 2 === 0 ? "publish" : "metrics",
    status: "SUCCESS" as const,
    itemsProcessed: i,
    durationMs: 100 * (i + 1),
    startedAt: new Date(Date.now() - i * 60_000).toISOString(),
  }));
}

describe("CronRunTimeline", () => {
  it("renders empty state when no runs", () => {
    render(<CronRunTimeline runs={[]} />);
    expect(screen.getByText("No cron runs recorded yet")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    const runs: CronRunRow[] = [
      {
        id: "run-1",
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: 5,
        durationMs: 1500,
        startedAt: "2026-03-14T10:00:00.000Z",
      },
    ];
    render(<CronRunTimeline runs={runs} />);
    expect(screen.getByText("Cron Name")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("Started At")).toBeInTheDocument();
  });

  it("renders run data with status badge", () => {
    const runs: CronRunRow[] = [
      {
        id: "run-1",
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: 5,
        durationMs: 1500,
        startedAt: "2026-03-14T10:00:00.000Z",
      },
      {
        id: "run-2",
        cronName: "metrics",
        status: "FAILED",
        itemsProcessed: null,
        durationMs: null,
        startedAt: "2026-03-14T09:00:00.000Z",
      },
    ];
    render(<CronRunTimeline runs={runs} />);
    expect(screen.getByText("publish")).toBeInTheDocument();
    expect(screen.getByText("SUCCESS")).toBeInTheDocument();
    expect(screen.getByText("1.5s")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("FAILED")).toBeInTheDocument();
  });

  it("formats timestamps in 12-hour local time (not military/UTC)", () => {
    const runs: CronRunRow[] = [
      {
        id: "run-1",
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: 5,
        durationMs: 1500,
        startedAt: "2026-03-14T10:00:00.000Z",
      },
    ];
    render(<CronRunTimeline runs={runs} />);
    // Should contain AM or PM (12-hour format), not 24-hour
    const cells = screen.getAllByRole("cell");
    const timeCell = cells[cells.length - 1]; // last cell is "Started At"
    expect(timeCell.textContent).toMatch(/AM|PM/);
  });

  it("shows dash for null duration and items", () => {
    const runs: CronRunRow[] = [
      {
        id: "run-1",
        cronName: "metrics",
        status: "RUNNING",
        itemsProcessed: null,
        durationMs: null,
        startedAt: "2026-03-14T10:00:00.000Z",
      },
    ];
    render(<CronRunTimeline runs={runs} />);
    // Two dashes: one for duration, one for items
    const dashes = screen.getAllByText("-");
    expect(dashes.length).toBe(2);
  });

  describe("pagination", () => {
    it("does not show pagination when runs fit on one page", () => {
      const runs = makeRuns(PAGE_SIZE);
      render(<CronRunTimeline runs={runs} />);
      expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
    });

    it("shows pagination when runs exceed one page", () => {
      const runs = makeRuns(PAGE_SIZE + 5);
      render(<CronRunTimeline runs={runs} />);
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });

    it("shows only first page of runs initially", () => {
      const runs = makeRuns(PAGE_SIZE + 5);
      render(<CronRunTimeline runs={runs} />);
      // Should show PAGE_SIZE rows (plus header row)
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBe(PAGE_SIZE + 1); // +1 for header
    });

    it("navigates to next page", async () => {
      const user = userEvent.setup();
      const runs = makeRuns(PAGE_SIZE + 3);
      render(<CronRunTimeline runs={runs} />);

      await user.click(screen.getByLabelText("Next page"));

      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      // Second page should show remaining 3 rows
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBe(3 + 1); // 3 data rows + header
    });

    it("navigates back to previous page", async () => {
      const user = userEvent.setup();
      const runs = makeRuns(PAGE_SIZE + 3);
      render(<CronRunTimeline runs={runs} />);

      await user.click(screen.getByLabelText("Next page"));
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

      await user.click(screen.getByLabelText("Previous page"));
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBe(PAGE_SIZE + 1);
    });

    it("disables Previous on first page and Next on last page", async () => {
      const user = userEvent.setup();
      const runs = makeRuns(PAGE_SIZE + 1);
      render(<CronRunTimeline runs={runs} />);

      // On page 1, Previous should be disabled
      expect(screen.getByLabelText("Previous page")).toBeDisabled();
      expect(screen.getByLabelText("Next page")).not.toBeDisabled();

      await user.click(screen.getByLabelText("Next page"));

      // On last page, Next should be disabled
      expect(screen.getByLabelText("Next page")).toBeDisabled();
      expect(screen.getByLabelText("Previous page")).not.toBeDisabled();
    });

    it("resets page when runs array shrinks below current page", async () => {
      const user = userEvent.setup();
      const runs = makeRuns(PAGE_SIZE * 3); // 3 pages
      const { rerender } = render(<CronRunTimeline runs={runs} />);

      // Navigate to page 3
      await user.click(screen.getByLabelText("Next page"));
      await user.click(screen.getByLabelText("Next page"));
      expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();

      // Shrink to 1 page — should reset to page 1
      rerender(<CronRunTimeline runs={makeRuns(5)} />);
      // With only 5 runs (< PAGE_SIZE), pagination should disappear
      expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
      // All 5 rows should be visible
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBe(5 + 1);
    });

    it("shows total run count", () => {
      const total = PAGE_SIZE + 10;
      const runs = makeRuns(total);
      render(<CronRunTimeline runs={runs} />);
      expect(screen.getByText(`${total} total runs`)).toBeInTheDocument();
    });
  });
});
