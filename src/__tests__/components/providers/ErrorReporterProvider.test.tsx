/**
 * @jest-environment jsdom
 */
import { render, cleanup } from "@testing-library/react";
import { ErrorReporterProvider } from "@/components/providers/ErrorReporterProvider";
import { initErrorReporter } from "@/lib/error-reporter";

jest.mock("@/lib/error-reporter", () => ({
  initErrorReporter: jest.fn(),
}));

const mockInitErrorReporter = initErrorReporter as jest.MockedFunction<
  typeof initErrorReporter
>;

describe("ErrorReporterProvider", () => {
  let mockCleanup: jest.Mock;

  beforeEach(() => {
    mockCleanup = jest.fn();
    mockInitErrorReporter.mockReturnValue(mockCleanup);
  });

  afterEach(() => {
    cleanup();
    jest.resetAllMocks();
  });

  it("calls initErrorReporter on mount", () => {
    render(
      <ErrorReporterProvider>
        <div>child</div>
      </ErrorReporterProvider>
    );

    expect(mockInitErrorReporter).toHaveBeenCalledTimes(1);
  });

  it("calls cleanup function on unmount", () => {
    const { unmount } = render(
      <ErrorReporterProvider>
        <div>child</div>
      </ErrorReporterProvider>
    );

    expect(mockCleanup).not.toHaveBeenCalled();
    unmount();
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it("renders children without extra DOM wrapper", () => {
    const { container } = render(
      <ErrorReporterProvider>
        <div data-testid="child">hello</div>
      </ErrorReporterProvider>
    );

    // Should render children directly - no wrapper element from provider
    expect(container.innerHTML).toBe('<div data-testid="child">hello</div>');
  });

  it("does not call initErrorReporter more than once on re-render", () => {
    const { rerender } = render(
      <ErrorReporterProvider>
        <div>first</div>
      </ErrorReporterProvider>
    );

    rerender(
      <ErrorReporterProvider>
        <div>second</div>
      </ErrorReporterProvider>
    );

    expect(mockInitErrorReporter).toHaveBeenCalledTimes(1);
  });
});
