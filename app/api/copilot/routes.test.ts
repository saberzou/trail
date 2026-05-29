import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as deviceCode } from "./device-code/route";
import { POST as poll } from "./poll/route";
import { POST as token } from "./token/route";

describe("copilot proxy routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("device-code forwards GitHub device flow request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ device_code: "dev", user_code: "ABCD-1234" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await deviceCode();

    expect(await res.json()).toEqual({
      device_code: "dev",
      user_code: "ABCD-1234",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
  });

  it("poll forwards OAuth polling request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ access_token: "gho_token" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await poll(
      new Request("http://localhost/api/copilot/poll", {
        body: JSON.stringify({ deviceCode: "dev" }),
        method: "POST",
      }),
    );

    expect(await res.json()).toEqual({ access_token: "gho_token" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
  });

  it("token forwards GitHub token request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ expires_at: 1_800_000_000, token: "copilot-token" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await token(
      new Request("http://localhost/api/copilot/token", {
        body: JSON.stringify({ githubAccessToken: "gho_token" }),
        method: "POST",
      }),
    );

    expect(await res.json()).toEqual({
      expires_at: 1_800_000_000,
      token: "copilot-token",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/copilot_internal/v2/token",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "token gho_token",
          "Editor-Version": "trail/0.1",
        }),
      }),
    );
  });
});
