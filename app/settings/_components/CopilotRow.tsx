"use client";

import { useState } from "react";
import {
  type DeviceFlow,
  pollForToken,
  refreshCopilotToken,
  startDeviceFlow,
} from "../../../lib/providers/copilot";
import { testProvider } from "../../../lib/providers/test";
import { useSettingsStore } from "../../../lib/settings/store";
import type { CopilotProvider } from "../../../lib/settings/types";

export function CopilotRow() {
  const saved = useSettingsStore((state) => state.settings.providers.copilot) as
    | CopilotProvider
    | undefined;
  const setProvider = useSettingsStore((state) => state.setProvider);
  const clearProvider = useSettingsStore((state) => state.clearProvider);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setStatus(null);
    try {
      const nextFlow = await startDeviceFlow();
      setFlow(nextFlow);
      const githubAccessToken = await pollForToken(
        nextFlow.deviceCode,
        nextFlow.interval,
      );
      await setProvider("copilot", {
        githubAccessToken,
        kind: "copilot",
      });
      setStatus("✓ Signed in");
    } catch (error) {
      setStatus(
        error instanceof Error ? `✗ ${error.message}` : "✗ Sign in failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (!saved) {
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const copilotToken = await refreshCopilotToken(saved.githubAccessToken);
      await setProvider("copilot", { ...saved, copilotToken });
      const result = await testProvider("copilot", { ...saved, copilotToken });
      setStatus(result.ok ? "✓ Connected" : `✗ ${result.error}`);
    } catch (error) {
      setStatus(
        error instanceof Error ? `✗ ${error.message}` : "✗ Test failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await clearProvider("copilot");
    setFlow(null);
    setStatus(null);
  }

  return (
    <div className="space-y-3 rounded border border-[#d9d8cc] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-medium text-[#171814]">GitHub Copilot</h3>
          <p className="mt-1 text-[#5d6256] text-sm">
            {saved ? "✓ Signed in" : "OAuth device flow"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {saved ? (
            <>
              <button
                className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
                disabled={busy}
                onClick={testConnection}
                type="button"
              >
                {busy ? "Testing..." : "Test connection"}
              </button>
              <button
                className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
                onClick={signOut}
                type="button"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
              disabled={busy}
              onClick={signIn}
              type="button"
            >
              {busy ? "Waiting for GitHub..." : "Sign in with GitHub"}
            </button>
          )}
        </div>
      </div>

      {flow ? (
        <div className="rounded border border-[#d9d8cc] bg-[#fbfaf4] p-3 text-sm">
          <p className="text-[#4c5145]">Enter this code on GitHub:</p>
          <code className="mt-2 block font-semibold text-[#171814]">
            {flow.userCode}
          </code>
          <button
            className="mt-3 rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
            onClick={() => window.open(flow.verificationUri, "_blank")}
            type="button"
          >
            Open GitHub
          </button>
        </div>
      ) : null}

      {status ? (
        <p className="text-[#4c5145] text-sm" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
