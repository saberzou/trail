// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PromptNodeBody } from "./PromptNode";

afterEach(() => cleanup());

describe("PromptNodeBody", () => {
  it("renders textarea with prompt text", () => {
    render(
      <PromptNodeBody
        prompt="hello"
        status="idle"
        onRun={() => {}}
        onChange={() => {}}
        onKill={() => {}}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("shows Run button when idle", () => {
    render(
      <PromptNodeBody
        prompt="x"
        status="idle"
        onRun={() => {}}
        onChange={() => {}}
        onKill={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
  });

  it("shows Kill button when running", () => {
    render(
      <PromptNodeBody
        prompt="x"
        status="running"
        onRun={() => {}}
        onChange={() => {}}
        onKill={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("shows error status with retry", () => {
    render(
      <PromptNodeBody
        prompt="x"
        status="error"
        error="boom"
        onRun={() => {}}
        onChange={() => {}}
        onKill={() => {}}
      />,
    );
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });
});
