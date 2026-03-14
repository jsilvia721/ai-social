/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

import { TimeRangeToggle } from "@/components/system/TimeRangeToggle";

describe("TimeRangeToggle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset search params
    mockSearchParams.delete("range");
  });

  it("renders three range buttons", () => {
    render(<TimeRangeToggle />);
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("applies active style to 24h by default", () => {
    render(<TimeRangeToggle />);
    const btn24h = screen.getByText("24h");
    expect(btn24h.className).toContain("bg-violet-600");
  });

  it("navigates with range param on click", async () => {
    const user = userEvent.setup();
    render(<TimeRangeToggle />);
    await user.click(screen.getByText("7d"));
    expect(mockPush).toHaveBeenCalledWith("?range=7d");
  });

  it("applies active style to current search param", () => {
    mockSearchParams.set("range", "30d");
    render(<TimeRangeToggle />);
    const btn30d = screen.getByText("30d");
    expect(btn30d.className).toContain("bg-violet-600");
    const btn24h = screen.getByText("24h");
    expect(btn24h.className).not.toContain("bg-violet-600");
  });
});
