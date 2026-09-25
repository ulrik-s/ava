"use client";

import { useSyncExternalStore } from "react";
import { screenClassFor, type ScreenClass } from "@/lib/shared/layout/dock-layout";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** Aktuell skärmklass; följer fönstrets bredd (t.ex. laptop ↔ stor skärm). */
export function useScreenClass(): ScreenClass {
  return useSyncExternalStore(subscribe, () => screenClassFor(window.innerWidth), () => "laptop");
}
