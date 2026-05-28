import { describe, expect, it } from "vitest";
import { maskKey } from "./mask";

describe("maskKey", () => {
  it("masks long keys keeping last 4", () => {
    expect(maskKey("sk-abcdefghijklmnop")).toBe("sk-…mnop");
  });

  it("returns •••• for short/empty", () => {
    expect(maskKey("")).toBe("");
    expect(maskKey("abc")).toBe("••••");
  });
});
