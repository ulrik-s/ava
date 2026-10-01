"use client";

/**
 * "Logga ut" (#1241, #1347): synka först; når inte allt fram frågar dialogen
 * vad användaren vill — synka igen, logga ut ändå eller avbryta. Själva
 * utloggningen (rensning av lokal data, proxyns `/oauth2/sign_out`) sköts av
 * `signOutInBrowser`.
 */

import { useCallback, useState, type ReactElement } from "react";
import { Modal } from "@/components/ui/modal";
import { signOutInBrowser } from "@/lib/client/backend/local-data/browser-sign-out";
import { syncBeforeSignOut, unsyncedSignOutMessage } from "@/lib/client/sync/confirm-sign-out";

/** Beroendena (injicerbara för tester). */
export interface SignOutFlowDeps {
  /** Synka och svara med antalet ändringar som ändå inte nått servern. */
  syncAndCount: () => Promise<number>;
  signOut: () => Promise<void>;
}

const browserFlowDeps: SignOutFlowDeps = { syncAndCount: () => syncBeforeSignOut(), signOut: signOutInBrowser };

type FlowState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "ask"; count: number; syncing: boolean }
  | { kind: "signing-out" };

interface DialogProps {
  count: number;
  syncing: boolean;
  onSync: () => void;
  onSignOut: () => void;
  onCancel: () => void;
}

/** Frågan när ändringar inte nått servern. */
export function SignOutDialog({ count, syncing, onSync, onSignOut, onCancel }: DialogProps): ReactElement {
  return (
    <Modal open title="Osynkade ändringar" onClose={onCancel}>
      <p className="text-sm text-gray-800" data-testid="sign-out-unsynced">{unsyncedSignOutMessage(count)}</p>
      <p className="mt-2 text-sm text-gray-500">
        Loggar du ut ändå sparas ändringarna i den här webbläsaren till nästa gång du loggar in som samma
        användare. Ingen annan som loggar in här ser dem.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
          Avbryt
        </button>
        <button type="button" onClick={onSignOut} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
          Logga ut ändå
        </button>
        <button type="button" onClick={onSync} disabled={syncing} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {syncing ? "Synkar…" : "Synka"}
        </button>
      </div>
    </Modal>
  );
}

/** Utloggningsflödet: `requestSignOut` startar det, `dialog` renderas där knappen sitter. */
export function useSignOutFlow(deps: SignOutFlowDeps = browserFlowDeps): {
  requestSignOut: () => void;
  busy: boolean;
  dialog: ReactElement | null;
} {
  const [state, setState] = useState<FlowState>({ kind: "idle" });
  const proceed = useCallback(async () => {
    setState({ kind: "signing-out" });
    await deps.signOut();
  }, [deps]);
  const check = useCallback(async () => {
    setState((s) => (s.kind === "ask" ? { ...s, syncing: true } : { kind: "syncing" }));
    const count = await deps.syncAndCount();
    if (count === 0) await proceed();
    else setState({ kind: "ask", count, syncing: false });
  }, [deps, proceed]);
  const dialog = state.kind === "ask"
    ? (
      <SignOutDialog
        count={state.count}
        syncing={state.syncing}
        onSync={() => void check()}
        onSignOut={() => void proceed()}
        onCancel={() => setState({ kind: "idle" })}
      />
    )
    : null;
  return { requestSignOut: () => void check(), busy: state.kind === "syncing" || state.kind === "signing-out", dialog };
}
