// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import SettingsPage from "./page";

describe("SettingsPage", () => {
  it("renders the three sections", () => {
    render(React.createElement(SettingsPage));
    expect(
      screen.getByRole("heading", { name: /AI Providers/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Search Providers/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Defaults/i }),
    ).toBeInTheDocument();
  });
});
