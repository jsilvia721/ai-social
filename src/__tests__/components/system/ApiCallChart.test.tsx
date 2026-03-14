/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

// Mock recharts to avoid canvas/svg issues in jsdom
jest.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ApiCallChart } from "@/components/system/ApiCallChart";

describe("ApiCallChart", () => {
  it("renders empty state when no buckets", () => {
    render(<ApiCallChart buckets={[]} />);
    expect(screen.getByText("No API calls recorded yet")).toBeInTheDocument();
  });

  it("renders chart when buckets provided", () => {
    const buckets = [
      { timestamp: "2026-03-14T10:00:00.000Z", service: "blotato", count: 5, avgLatencyMs: 100, errorCount: 0 },
      { timestamp: "2026-03-14T10:00:00.000Z", service: "github", count: 3, avgLatencyMs: 200, errorCount: 1 },
      { timestamp: "2026-03-14T11:00:00.000Z", service: "blotato", count: 8, avgLatencyMs: 150, errorCount: 0 },
    ];
    render(<ApiCallChart buckets={buckets} />);
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
    // Should have 2 Area elements (one per unique service)
    const areas = screen.getAllByTestId("area");
    expect(areas.length).toBe(2);
  });
});
