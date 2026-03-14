/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

// Mock recharts
jest.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ErrorTrendChart } from "@/components/system/ErrorTrendChart";
import type { TopError } from "@/components/system/types";

describe("ErrorTrendChart", () => {
  it("renders empty state when no data", () => {
    render(<ErrorTrendChart buckets={[]} topErrors={[]} />);
    expect(screen.getByText("No errors recorded yet")).toBeInTheDocument();
  });

  it("renders chart when buckets provided", () => {
    const buckets = [
      { timestamp: "2026-03-14T10:00:00.000Z", source: "SERVER", count: 5, errorCount: 3 },
    ];
    render(<ErrorTrendChart buckets={buckets} topErrors={[]} />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("renders top errors list", () => {
    const topErrors: TopError[] = [
      { message: "Connection timeout", count: 42, lastSeenAt: "2026-03-14T10:00:00.000Z", status: "NEW", source: "SERVER" },
      { message: "Rate limit exceeded", count: 10, lastSeenAt: "2026-03-14T09:00:00.000Z", status: "ISSUE_CREATED", source: "CLIENT" },
    ];
    render(<ErrorTrendChart buckets={[]} topErrors={topErrors} />);
    expect(screen.getByText("Top Errors")).toBeInTheDocument();
    expect(screen.getByText("Connection timeout")).toBeInTheDocument();
    expect(screen.getByText("42x")).toBeInTheDocument();
    expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
    expect(screen.getByText("10x")).toBeInTheDocument();
  });

  it("renders status badges for top errors", () => {
    const topErrors: TopError[] = [
      { message: "Error 1", count: 5, lastSeenAt: "2026-03-14T10:00:00.000Z", status: "NEW", source: "SERVER" },
      { message: "Error 2", count: 3, lastSeenAt: "2026-03-14T09:00:00.000Z", status: "RESOLVED", source: "CLIENT" },
    ];
    render(<ErrorTrendChart buckets={[]} topErrors={topErrors} />);
    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.getByText("RESOLVED")).toBeInTheDocument();
  });
});
