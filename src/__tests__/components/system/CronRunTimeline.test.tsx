/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { CronRunTimeline } from "@/components/system/CronRunTimeline";
import type { CronRunRow } from "@/components/system/types";

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
});
