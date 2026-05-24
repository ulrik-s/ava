"use client";

/**
 * `WebOAuthDeviceFlow` — GitHub OAuth Device Flow för Web-builden via
 * en konfigurerbar Cloudflare-Worker-proxy (scripts/oauth-proxy/).
 *
 * Flow:
 *   1. POST {proxy}/device/code → user_code + verification_uri + device_code
 *   2. Användare öppnar verification_uri i ny tab och klistrar in user_code
 *   3. Polla POST {proxy}/token { device_code } var `interval` sekund
 *   4. När GitHub returnerar access_token → onComplete(token)
 *
 * Tauri-builden använder `OAuthDeviceFlow` (libcurl direkt) istället.
 */

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { loadOAuthConfig } from "@/client/lib/auth/oauth-config";

interface Props {
  onComplete: (accessToken: string) => void;
  onCancel: () => void;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export function WebOAuthDeviceFlow({ onComplete, onCancel }: Props) {
  // SSR-stabil initial — riktig config läses post-mount
  const [cfg, setCfg] = useState<{ proxyUrl: string; clientId: string }>({ proxyUrl: "", clientId: "" });
  useEffect(() => { queueMicrotask(() => setCfg(loadOAuthConfig())); }, []);
  const [step, setStep] = useState<"requesting" | "waiting" | "error">("requesting");
  const [code, setCode] = useState<DeviceCodeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${cfg.proxyUrl}/device/code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`Proxy ${res.status}`);
        const data = await res.json() as DeviceCodeResponse;
        if (cancelled) return;
        if (!data.device_code) throw new Error("Proxy returnerade ingen device_code");
        setCode(data);
        setStep("waiting");
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStep("error");
      }
    })();
    return () => { cancelled = true; };
  }, [cfg.proxyUrl]);

  // Polla token-endpoint
  useEffect(() => {
    if (step !== "waiting" || !code) return;
    let cancelled = false;
    const intervalMs = Math.max(code.interval, 5) * 1000;
    const deadline = Date.now() + code.expires_in * 1000;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setErr("Tidsgräns: koden förfallit. Försök igen.");
        setStep("error");
        return;
      }
      try {
        const res = await fetch(`${cfg.proxyUrl}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: code.device_code }),
        });
        const data = await res.json() as TokenResponse;
        if (cancelled) return;
        if (data.access_token) {
          onComplete(data.access_token);
          return;
        }
        // authorization_pending eller slow_down → fortsätt polla
        if (data.error && data.error !== "authorization_pending" && data.error !== "slow_down") {
          setErr(data.error_description ?? data.error);
          setStep("error");
          return;
        }
      } catch (e) {
        if (cancelled) return;
        // Tillfälligt nät-fel — fortsätt polla
        console.warn("[oauth] poll error:", e);
      }
      setTimeout(() => { void poll(); }, intervalMs);
    };

    const timer = setTimeout(() => { void poll(); }, intervalMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [step, code, cfg.proxyUrl, onComplete]);

  if (step === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3">
        <p className="text-sm text-red-900 font-semibold">Inloggning misslyckades</p>
        <p className="text-xs text-red-800 mt-1">{err}</p>
        <button type="button" onClick={onCancel} className="mt-2 text-xs text-red-700 underline">
          Stäng
        </button>
      </div>
    );
  }

  if (step === "requesting" || !code) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-900">
        Förbereder GitHub-inloggning…
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded p-3">
      <p className="text-sm font-semibold text-blue-900 mb-2">Logga in på GitHub</p>
      <ol className="text-xs text-blue-900 space-y-2 list-decimal pl-5">
        <li>
          Öppna{" "}
          <a
            href={code.verification_uri}
            target="_blank"
            rel="noopener noreferrer"
            className="underline inline-flex items-center gap-1"
          >
            {code.verification_uri} <ExternalLink size={11} />
          </a>
        </li>
        <li>
          Klistra in koden:{" "}
          <code className="bg-white border border-blue-300 px-2 py-0.5 rounded font-mono text-blue-900">
            {code.user_code}
          </code>
        </li>
        <li>Godkänn AVA:s åtkomst. Vi väntar här på bekräftelsen.</li>
      </ol>
      <button type="button" onClick={onCancel} className="mt-3 text-xs text-blue-700 underline">
        Avbryt
      </button>
    </div>
  );
}
