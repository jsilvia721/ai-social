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

import { SystemTabs } from "@/components/system/SystemTabs";

describe("SystemTabs", () => {
  const healthContent = <div data-testid="health-content">Health Panel</div>;
  const schedulesContent = (
    <div data-testid="schedules-content">Schedules Panel</div>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.delete("tab");
    mockSearchParams.delete("range");
  });

  it("renders Health and Schedules tab buttons", () => {
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    expect(screen.getByRole("tab", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schedules" })).toBeInTheDocument();
  });

  it("shows health content by default (no tab param)", () => {
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    expect(screen.getByTestId("health-content")).toBeInTheDocument();
    expect(screen.queryByTestId("schedules-content")).not.toBeInTheDocument();
  });

  it("shows health tab as active by default", () => {
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    const healthTab = screen.getByRole("tab", { name: "Health" });
    expect(healthTab.className).toContain("border-violet-500");
  });

  it("shows schedules content when tab=schedules", () => {
    mockSearchParams.set("tab", "schedules");
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    expect(screen.getByTestId("schedules-content")).toBeInTheDocument();
    expect(screen.queryByTestId("health-content")).not.toBeInTheDocument();
  });

  it("navigates to schedules tab on click", async () => {
    const user = userEvent.setup();
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    await user.click(screen.getByRole("tab", { name: "Schedules" }));
    expect(mockPush).toHaveBeenCalledWith("?tab=schedules");
  });

  it("navigates to health tab on click", async () => {
    mockSearchParams.set("tab", "schedules");
    const user = userEvent.setup();
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    await user.click(screen.getByRole("tab", { name: "Health" }));
    expect(mockPush).toHaveBeenCalledWith("?tab=health");
  });

  it("preserves other search params when switching tabs", async () => {
    mockSearchParams.set("range", "7d");
    const user = userEvent.setup();
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    await user.click(screen.getByRole("tab", { name: "Schedules" }));
    expect(mockPush).toHaveBeenCalledWith("?range=7d&tab=schedules");
  });

  it("defaults to health for unknown tab value", () => {
    mockSearchParams.set("tab", "invalid");
    render(
      <SystemTabs
        healthContent={healthContent}
        schedulesContent={schedulesContent}
      />
    );
    expect(screen.getByTestId("health-content")).toBeInTheDocument();
  });
});
