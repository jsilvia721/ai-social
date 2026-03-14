/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next-auth/react SessionProvider to track whether it renders
let sessionProviderRendered = false;
jest.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => {
    sessionProviderRendered = true;
    return <div data-testid="session-provider">{children}</div>;
  },
}));

// Mock error reporter
jest.mock("@/lib/error-reporter", () => ({
  initErrorReporter: () => () => {},
}));

import RootLayout from "@/app/layout";
import AuthenticatedLayout from "@/app/(authenticated)/layout";

describe("Route group layouts", () => {
  beforeEach(() => {
    sessionProviderRendered = false;
  });

  describe("RootLayout", () => {
    it("does NOT include SessionProvider", () => {
      const { container } = render(
        <RootLayout>
          <div data-testid="child">content</div>
        </RootLayout>,
        // RootLayout renders <html> and <body>, so we need a custom container
        { container: document.createElement("div") }
      );
      expect(sessionProviderRendered).toBe(false);
      expect(container.textContent).toContain("content");
    });
  });

  describe("AuthenticatedLayout", () => {
    it("wraps children in SessionProvider", () => {
      const { getByTestId } = render(
        <AuthenticatedLayout>
          <div data-testid="child">authenticated content</div>
        </AuthenticatedLayout>
      );
      expect(sessionProviderRendered).toBe(true);
      expect(getByTestId("session-provider")).toBeInTheDocument();
      expect(getByTestId("child")).toBeInTheDocument();
    });
  });
});
