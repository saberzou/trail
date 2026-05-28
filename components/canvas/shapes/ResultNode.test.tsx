// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultNodeBody } from "./ResultNode";

describe("ResultNodeBody", () => {
  it("shows title, url, summary", () => {
    render(
      <ResultNodeBody
        title="T"
        url="https://x.com"
        summary="S"
        source="search"
        onExploreSimilar={() => {}}
      />,
    );
    expect(screen.getByText("T")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://x.com");
  });
});
