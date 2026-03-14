/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "@/components/ui/pagination";

describe("Pagination", () => {
  const defaultProps = {
    page: 1,
    totalPages: 5,
    onPageChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders current page and total pages", () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument();
  });

  it("disables Previous button on first page", () => {
    render(<Pagination {...defaultProps} page={1} />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("disables Next button on last page", () => {
    render(<Pagination {...defaultProps} page={5} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("enables both buttons on middle pages", () => {
    render(<Pagination {...defaultProps} page={3} />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("calls onPageChange with page - 1 when Previous is clicked", async () => {
    const onPageChange = jest.fn();
    render(<Pagination {...defaultProps} page={3} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with page + 1 when Next is clicked", async () => {
    const onPageChange = jest.fn();
    render(<Pagination {...defaultProps} page={3} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("does not render when totalPages is 1 or less", () => {
    const { container } = render(<Pagination {...defaultProps} totalPages={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not render when totalPages is 0", () => {
    const { container } = render(<Pagination {...defaultProps} totalPages={0} />);
    expect(container.firstChild).toBeNull();
  });
});
