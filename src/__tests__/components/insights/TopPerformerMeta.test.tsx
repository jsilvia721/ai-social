/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TopPerformerMeta } from "@/components/insights/TopPerformerMeta";

describe("TopPerformerMeta", () => {
  it("renders username without separator when no topicPillar", () => {
    render(
      <TopPerformerMeta
        username="acme.brand"
        platformColorClass="text-sky-400"
        topicPillar={null}
      />
    );
    expect(screen.getByText("@acme.brand")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("renders username with separator and topicPillar when provided", () => {
    render(
      <TopPerformerMeta
        username="acme.brand"
        platformColorClass="text-sky-400"
        topicPillar="Tips & Tutorials"
      />
    );
    expect(screen.getByText("@acme.brand")).toBeInTheDocument();
    expect(screen.getByText("·")).toBeInTheDocument();
    expect(screen.getByText("Tips & Tutorials")).toBeInTheDocument();
  });

  it("applies platform color class to username", () => {
    render(
      <TopPerformerMeta
        username="acme.brand"
        platformColorClass="text-pink-500"
        topicPillar={null}
      />
    );
    const el = screen.getByText("@acme.brand").closest("p");
    expect(el).toHaveClass("text-pink-500");
  });

  it("renders separator with proper spacing for mobile readability", () => {
    render(
      <TopPerformerMeta
        username="acme.brand"
        platformColorClass="text-sky-400"
        topicPillar="Tips & Tutorials"
      />
    );
    const separator = screen.getByText("·");
    expect(separator).toHaveClass("mx-1.5");
  });
});
