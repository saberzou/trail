// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { wipeEncrypted } from "../../../lib/settings/crypto-storage";
import { useSettingsStore } from "../../../lib/settings/store";
import { DefaultsSection } from "./DefaultsSection";

describe("DefaultsSection", () => {
  beforeEach(async () => {
    await wipeEncrypted();
    useSettingsStore.setState({
      hydrated: true,
      settings: {
        version: 1,
        providers: {
          brave: { apiKey: "brave-key", kind: "api-key" },
          openai: { apiKey: "sk-test", kind: "api-key" },
        },
      },
    });
  });

  it("shows configured providers by type and saves defaults", async () => {
    render(React.createElement(DefaultsSection));

    expect(screen.getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Tavily" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Default LLM"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("Default search"), {
      target: { value: "brave" },
    });

    expect(useSettingsStore.getState().settings.defaultLlm).toBe("openai");
    expect(useSettingsStore.getState().settings.defaultSearch).toBe("brave");
  });
});
