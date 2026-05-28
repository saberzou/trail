// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wipeEncrypted } from "../../../lib/settings/crypto-storage";
import { useSettingsStore } from "../../../lib/settings/store";
import { ApiKeyRow } from "./ApiKeyRow";

describe("ApiKeyRow", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    await wipeEncrypted();
    useSettingsStore.setState({
      hydrated: true,
      settings: { version: 1, providers: {} },
    });
  });

  it("saves and clears an API key provider", async () => {
    render(
      React.createElement(ApiKeyRow, {
        label: "OpenAI",
        providerId: "openai",
      }),
    );

    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save OpenAI" }));

    expect(
      await screen.findByText("OpenAI credentials saved."),
    ).toBeInTheDocument();
    expect(useSettingsStore.getState().settings.providers.openai).toMatchObject(
      { apiKey: "sk-test" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear OpenAI" }));
    expect(
      useSettingsStore.getState().settings.providers.openai,
    ).toBeUndefined();
  });
});
