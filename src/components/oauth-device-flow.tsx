"use client";

/**
 * `OAuthDeviceFlow` — GitHub Device Flow-UI för Tauri-builds.
 *
 * Steg:
 *   1. Anropa oauth_start_device_flow → få user_code + verification_uri
 *   2. Visa user_code + öppna verification_uri i browsern
 *   3. Poll:a oauth_poll_access_token enligt returnerad interval
 *   4. När `done`: anropa onComplete(accessToken)
 *
 * Avbryts via "Avbryt"-knapp. Sparar inte själv i keychain —
 * uppströms-komponent (datasource-section / AutoSync) gör det.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onComplete: (accessToken: string) => void;
  onCancel: () => void;
}

type State =
  | { phase: "init" }
  | { phase: "ready"; userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresAt: number }
  | { phase: "error"; message: string };

export function OAuthDeviceFlow({ onComplete, onCancel }: Props) {
  const [state, setState] = useState<State>({ phase: "init" });
  const cancelledRef = useRef(false);

  // Inled flow vid mount
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        const bridge = await import("@/lib/tauri/bridge");
        const r = await bridge.oauthStartDeviceFlow("repo");
        if (cancelledRef.current) return;
        setState({
          phase: "ready",
          userCode: r.userCode,
          verificationUri: r.verificationUri,
          deviceCode: r.deviceCode,
          interval: r.interval,
          expiresAt: Date.now() + r.expiresIn * 1000,
        });
        // Öppna verification-URL automatiskt
        try {
          await bridge.openInDefaultApp(r.verificationUri);
        } catch { /* ignore */ }
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelledRef.current = true; };
  }, []);

  // Polla efter access_token
  const startPolling = useCallback((deviceCode: string, initialInterval: number, expiresAt: number) => {
    let interval = initialInterval;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelledRef.current) return;
      if (Date.now() > expiresAt) {
        setState({ phase: "error", message: "Koden gick ut — prova igen." });
        return;
      }
      try {
        const bridge = await import("@/lib/tauri/bridge");
        const r = await bridge.oauthPollAccessToken(deviceCode);
        if (cancelledRef.current) return;
        if (r.status === "done") {
          onComplete(r.accessToken);
          return;
        }
        if (r.status === "slow_down") interval = r.interval;
        if (r.status === "error") {
          setState({ phase: "error", message: r.message });
          return;
        }
        timer = setTimeout(() => void tick(), interval * 1000);
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    };
    void tick();
    return () => { if (timer) clearTimeout(timer); };
  }, [onComplete]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const stop = startPolling(state.deviceCode, state.interval, state.expiresAt);
    return stop;
  }, [state, startPolling]);

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-blue-900">Logga in med GitHub</h3>
      {state.phase === "init" && (
        <p className="text-xs text-blue-800 mt-1">Förbereder inloggning…</p>
      )}
      {state.phase === "ready" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-blue-800">
            1. Öppna{" "}
            <a
              href={state.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-mono"
            >
              {state.verificationUri}
            </a>
          </p>
          <p className="text-xs text-blue-800">2. Skriv in koden:</p>
          <div className="flex items-center justify-center">
            <code className="text-2xl font-mono font-bold tracking-wider bg-white border border-blue-300 px-4 py-2 rounded">
              {state.userCode}
            </code>
          </div>
          <p className="text-xs text-blue-800">
            Väntar på att du godkänner i browsern…
          </p>
        </div>
      )}
      {state.phase === "error" && (
        <p className="text-xs text-red-700 mt-2">✗ {state.message}</p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:underline"
        >
          Avbryt
        </button>
      </div>
    </div>
  );
}
