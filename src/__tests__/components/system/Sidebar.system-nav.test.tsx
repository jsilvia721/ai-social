/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

// Mock next-auth/react
jest.mock("next-auth/react", () => ({
  signOut: jest.fn(),
  useSession: () => ({ update: jest.fn() }),
}));

import { Sidebar } from "@/components/dashboard/Sidebar";

const defaultUser = {
  name: "Test User",
  email: "test@example.com",
  image: null,
};

describe("Sidebar System nav item", () => {
  it("does not show System link when isAdmin is false", () => {
    render(<Sidebar user={defaultUser} />);
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("does not show System link when isAdmin is not passed", () => {
    render(<Sidebar user={defaultUser} />);
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("shows System link when isAdmin is true", () => {
    render(<Sidebar user={defaultUser} isAdmin={true} />);
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("System link points to /dashboard/system", () => {
    render(<Sidebar user={defaultUser} isAdmin={true} />);
    const link = screen.getByText("System").closest("a");
    expect(link).toHaveAttribute("href", "/dashboard/system");
  });
});
