/**
 * `usePasskey` — React-hook som sköter WebAuthn-flödet mot
 * `/api/passkey/*`-endpoints.
 *
 * Designval (Single responsibility):
 *   - Bara client-side orchestration. Servern gör verifiering.
 *
 * Designval (DRY):
 *   - Bägge cermonier (register + authenticate) följer samma mönster:
 *     POST begin → browser-ceremoni → POST finish. En privat
 *     `runCeremony`-helper håller logiken på ett ställe.
 */

"use client";

import { useCallback, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

export type PasskeyStatus = "idle" | "working" | "success" | "error";

export interface PasskeyState {
  status: PasskeyStatus;
  error: Error | null;
  register: (name?: string) => Promise<void>;
  authenticate: (email?: string) => Promise<string | undefined>;
}

export function usePasskey(): PasskeyState {
  const [status, setStatus] = useState<PasskeyStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const register = useCallback(async (name?: string) => {
    setStatus("working");
    setError(null);
    try {
      const beginRes = await fetch("/api/passkey/register/begin", { method: "POST" });
      if (!beginRes.ok) throw new Error(`begin failed (${beginRes.status})`);
      const options = await beginRes.json();
      const credential = await startRegistration({ optionsJSON: options });
      const finishRes = await fetch("/api/passkey/register/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: credential, name }),
      });
      if (!finishRes.ok) throw new Error(`finish failed (${finishRes.status})`);
      const result = await finishRes.json();
      if (!result.ok) throw new Error("verifiering misslyckades");
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, []);

  const authenticate = useCallback(async (email?: string): Promise<string | undefined> => {
    setStatus("working");
    setError(null);
    try {
      const beginRes = await fetch("/api/passkey/authenticate/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(email ? { email } : {}),
      });
      if (!beginRes.ok) throw new Error(`begin failed (${beginRes.status})`);
      const options = await beginRes.json();
      const credential = await startAuthentication({ optionsJSON: options });
      const finishRes = await fetch("/api/passkey/authenticate/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: credential }),
      });
      if (!finishRes.ok) throw new Error(`finish failed (${finishRes.status})`);
      const result = await finishRes.json() as { ok: boolean; userId?: string };
      if (!result.ok || !result.userId) throw new Error("verifiering misslyckades");
      setStatus("success");
      return result.userId;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, []);

  return { status, error, register, authenticate };
}
