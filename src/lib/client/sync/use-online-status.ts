"use client";

/**
 * `useOnlineStatus` — reaktiv `navigator.onLine` med lyssning på
 * `online`/`offline`-event:n.
 *
 * Notera: `navigator.onLine === true` betyder bara att OS:n tror sig
 * ha en nätverksanslutning. Det garanterar inte att GitHub är nåbart.
 * Använd alltid kombinerat med en hård timeout (`withTimeout`) runt
 * faktiska nätoperationer.
 *
 * SSR-säker: returnerar `true` om window saknas (SSR antas online).
 */

import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
