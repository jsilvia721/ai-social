/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SessionProvider } from "@/components/providers/SessionProvider";

// Mock next-auth/react and capture the props passed to NextAuthSessionProvider
let capturedProps: Record<string, unknown> = {};
jest.mock("next-auth/react", () => ({
  SessionProvider: (props: Record<string, unknown>) => {
    capturedProps = props;
    return <div data-testid="session-provider">{props.children as React.ReactNode}</div>;
  },
}));

describe("SessionProvider", () => {
  beforeEach(() => {
    capturedProps = {};
  });

  it("renders children", () => {
    const { getByText } = render(
      <SessionProvider>
        <span>child</span>
      </SessionProvider>
    );
    expect(getByText("child")).toBeInTheDocument();
  });

  it("disables refetchOnWindowFocus to prevent CLIENT_FETCH_ERROR on tab switch", () => {
    render(
      <SessionProvider>
        <span>child</span>
      </SessionProvider>
    );
    expect(capturedProps.refetchOnWindowFocus).toBe(false);
  });
});
