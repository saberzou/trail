// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wipeEncrypted } from "../../lib/settings/crypto-storage";
import { useSettingsStore } from "../../lib/settings/store";
import SettingsPage from "./page";

describe("SettingsPage", () => {
  beforeEach(async () => {
    await wipeEncrypted();
    useSettingsStore.setState({
      hydrated: true,
      settings: { version: 1, providers: {} },
    });
  });

  afterEach(() => {
    cleanup();
  });

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

  it("does not render saved API keys in full", async () => {
    await useSettingsStore.getState().setProvider("openai", {
      apiKey: "sk-supersecret-xxxx",
      kind: "api-key",
    });

    render(React.createElement(SettingsPage));

    expect(screen.queryByDisplayValue("sk-supersecret-xxxx")).toBeNull();
    expect(screen.getByText("sk-…xxxx")).toBeInTheDocument();
  });
});
