/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { SystemStatusCards, getHealthLevel } from "@/components/system/SystemStatusCards";

describe("SystemStatusCards", () => {
  it("renders empty state when no crons provided", () => {
    render(<SystemStatusCards crons={[]} />);
    expect(screen.getByText("No cron status data available.")).toBeInTheDocument();
  });

  it("renders a card per cron", () => {
    const crons = [
      { cronName: "publish", lastRunAt: new Date().toISOString(), successRate: 1 },
      { cronName: "metrics", lastRunAt: new Date().toISOString(), successRate: 0.9 },
    ];
    render(<SystemStatusCards crons={crons} />);
    expect(screen.getByText("publish")).toBeInTheDocument();
    expect(screen.getByText("metrics")).toBeInTheDocument();
  });

  it("shows success rate as percentage", () => {
    const crons = [
      { cronName: "publish", lastRunAt: new Date().toISOString(), successRate: 0.85 },
    ];
    render(<SystemStatusCards crons={crons} />);
    expect(screen.getByText("Success rate: 85%")).toBeInTheDocument();
  });

  it("shows Unknown when lastRunAt is null", () => {
    const crons = [
      { cronName: "publish", lastRunAt: null, successRate: 0 },
    ];
    render(<SystemStatusCards crons={crons} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("Last run: Never")).toBeInTheDocument();
  });
});

describe("getHealthLevel", () => {
  it("returns unknown when lastRunAt is null", () => {
    expect(getHealthLevel("publish", null)).toBe("unknown");
  });

  it("returns healthy for recent publish run", () => {
    const recent = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    expect(getHealthLevel("publish", recent)).toBe("healthy");
  });

  it("returns degraded for publish > 5min", () => {
    const old = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(getHealthLevel("publish", old)).toBe("degraded");
  });

  it("returns down for publish > 15min", () => {
    const old = new Date(Date.now() - 16 * 60_000).toISOString();
    expect(getHealthLevel("publish", old)).toBe("down");
  });

  it("returns healthy for recent hourly cron", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(getHealthLevel("metrics", recent)).toBe("healthy");
  });

  it("returns degraded for hourly cron > 90min", () => {
    const old = new Date(Date.now() - 91 * 60_000).toISOString();
    expect(getHealthLevel("metrics", old)).toBe("degraded");
  });

  it("returns down for hourly cron > 3h", () => {
    const old = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
    expect(getHealthLevel("metrics", old)).toBe("down");
  });

  it("returns healthy for recent weekly cron", () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    expect(getHealthLevel("optimize", recent)).toBe("healthy");
  });

  it("returns degraded for weekly cron > 8 days", () => {
    const old = new Date(Date.now() - 9 * 24 * 60 * 60_000).toISOString();
    expect(getHealthLevel("optimize", old)).toBe("degraded");
  });

  it("returns down for weekly cron > 14 days", () => {
    const old = new Date(Date.now() - 15 * 24 * 60 * 60_000).toISOString();
    expect(getHealthLevel("optimize", old)).toBe("down");
  });
});
