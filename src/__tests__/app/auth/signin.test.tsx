/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SignInPage from "@/app/auth/signin/page";

// Mock next-auth/react
const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

// Mock next/navigation
let mockSearchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

describe("SignInPage", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("renders sign-in button", () => {
    render(<SignInPage />);
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("calls signIn on button click", async () => {
    mockSignIn.mockResolvedValue(undefined);
    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(mockSignIn).toHaveBeenCalledWith("google", { callbackUrl: "/dashboard" });
  });

  it("shows error message when signIn throws CLIENT_FETCH_ERROR", async () => {
    mockSignIn.mockRejectedValue(new Error("CLIENT_FETCH_ERROR"));
    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to connect.*try again/i)).toBeInTheDocument();
    });
  });

  it("shows loading state while sign-in is in progress", async () => {
    // signIn never resolves during this test
    mockSignIn.mockReturnValue(new Promise(() => {}));
    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /connecting/i })).toBeDisabled();
    });
  });

  it("re-enables button after signIn error so user can retry", async () => {
    mockSignIn.mockRejectedValue(new Error("CLIENT_FETCH_ERROR"));
    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue with google/i })).not.toBeDisabled();
    });
  });

  it("shows error message from URL error param", () => {
    mockSearchParams = new URLSearchParams({ error: "AccessDenied" });
    render(<SignInPage />);
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
  });
});
