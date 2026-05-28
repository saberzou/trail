import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCopilotToken, startDeviceFlow } from "./copilot";

describe("copilot provider helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("startDeviceFlow maps GitHub response fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          device_code: "dev",
          interval: 5,
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
        }),
      ),
    );

    await expect(startDeviceFlow()).resolves.toEqual({
      deviceCode: "dev",
      interval: 5,
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });
  });

  it("getCopilotToken returns cached token when it is still valid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getCopilotToken("gho_token", {
        expiresAt: Date.now() + 600_000,
        token: "cached",
      }),
    ).resolves.toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
