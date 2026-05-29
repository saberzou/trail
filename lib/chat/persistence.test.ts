import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openTrailDb } from "@/lib/idb/open";
import { type ChatHistory, loadChat, saveChat, wipeChat } from "./persistence";

describe("chat persistence", () => {
  beforeEach(async () => {
    await wipeChat();
  });

  it("returns an empty history when nothing is stored", async () => {
    const h = await loadChat();
    expect(h).toEqual({ version: 1, messages: [] });
  });

  it("round-trips a chat history", async () => {
    const hist: ChatHistory = {
      version: 1,
      messages: [
        {
          id: "m1",
          role: "user",
          text: "hello",
          createdAt: 1700000000000,
        },
        {
          id: "m2",
          role: "assistant",
          text: "Added example.com to your canvas.",
          createdAt: 1700000001000,
          meta: { kind: "url-tile", nodeId: "shape:abc" },
        },
      ],
    };
    await saveChat(hist);
    expect(await loadChat()).toEqual(hist);
  });

  it("wipe clears the history back to empty", async () => {
    await saveChat({
      version: 1,
      messages: [{ id: "m1", role: "user", text: "x", createdAt: 1 }],
    });
    await wipeChat();
    expect(await loadChat()).toEqual({ version: 1, messages: [] });
  });

  it("returns empty history on a version mismatch (clean-load)", async () => {
    // Write a "v2" record directly under our DB/store/key so we can test
    // the load path handles future formats by ignoring them.
    const d = await openTrailDb("trail-chat", "history", 1);
    try {
      await d.put(
        "history",
        { version: 2, messages: [{ wrong: "shape" }] },
        "main",
      );
    } finally {
      d.close();
    }
    expect(await loadChat()).toEqual({ version: 1, messages: [] });
  });

  it("returns empty history on a corrupt (non-array messages) record", async () => {
    const d = await openTrailDb("trail-chat", "history", 1);
    try {
      await d.put("history", { version: 1, messages: "oops" }, "main");
    } finally {
      d.close();
    }
    expect(await loadChat()).toEqual({ version: 1, messages: [] });
  });
});
