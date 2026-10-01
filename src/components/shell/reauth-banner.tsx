"use client";

/**
 * `ReauthBanner` — "Logga in igen" (#1351). Visas när inloggningen behöver
 * förnyas men appen ändå arbetar lokalt (inom offline-graceperioden, eller
 * efter ett 401 vid synk). Användaren väljer själv när — ingen hård
 * omdirigering till en IdP som kanske är nere. En lyckad synk tar bort den.
 */

import { useEffect, useSyncExternalStore } from "react";
import { loginUrl } from "@/lib/client/auth/session-gate";
import { sessionNotice, sessionNoticeText, setSessionNotice, subscribeSessionNotice } from "@/lib/client/auth/session-notice";
import { onServerSynced } from "@/lib/client/sync/server-sync-flush";

interface ReauthBannerProps {
  /** Navigera till inloggningen. Injicerbar för tester. */
  navigate?: (url: string) => void;
}

const goTo = (url: string): void => { window.location.assign(url); };

export function ReauthBanner({ navigate = goTo }: ReauthBannerProps) {
  const notice = useSyncExternalStore(subscribeSessionNotice, sessionNotice, sessionNotice);
  // En lyckad synk bevisar att sessionen fungerar.
  useEffect(() => onServerSynced(() => setSessionNotice(null)), []);
  if (!notice) return null;
  return (
    <div role="alert" data-testid="reauth-banner" className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
      <span>{sessionNoticeText(notice)}</span>
      <button
        type="button"
        onClick={() => navigate(loginUrl(window.location))}
        className="shrink-0 rounded border border-amber-400 bg-white px-2 py-0.5 font-medium hover:bg-amber-100"
      >
        Logga in igen
      </button>
    </div>
  );
}
