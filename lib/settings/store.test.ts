import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadEncrypted, wipeEncrypted } from "./crypto-storage";
import { hydrateSettings, useSettingsStore } from "./store";
import type { TrailSettings } from "./types";

describe("settings store", () => {
  beforeEach(async () => {
    await wipeEncrypted();
    useSettingsStore.setState({
      hydrated: false,
      settings: { version: 1, providers: {} },
    });
  });

  it("starts un-hydrated with empty providers", () => {
    const s = useSettingsStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.settings.providers).toEqual({});
  });

  it("persists provider via encrypted storage", async () => {
    await hydrateSettings();
    await useSettingsStore
      .getState()
      .setProvider("openai", { kind: "api-key", apiKey: "sk-test" });
    const blob = await loadEncrypted<TrailSettings>();
    const openai = blob?.providers.openai;
    expect(openai?.kind).toBe("api-key");
    if (openai?.kind === "api-key") {
      expect(openai.apiKey).toBe("sk-test");
    }
  });

  it("clearProvider removes the entry", async () => {
    await hydrateSettings();
    const s = useSettingsStore.getState();
    await s.setProvider("brave", { kind: "api-key", apiKey: "x" });
    await s.clearProvider("brave");
    expect(
      useSettingsStore.getState().settings.providers.brave,
    ).toBeUndefined();
  });

  it("wipeAll empties everything", async () => {
    await hydrateSettings();
    await useSettingsStore
      .getState()
      .setProvider("openai", { kind: "api-key", apiKey: "sk-x" });
    await useSettingsStore.getState().wipeAll();
    expect(useSettingsStore.getState().settings.providers).toEqual({});
    expect(await loadEncrypted()).toBeNull();
  });
});
