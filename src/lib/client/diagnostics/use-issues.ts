"use client";

/**
 * `useSelfDetectedIssues` — React-binding mot den app-wide {@link issueStore}.
 * Använder `useSyncExternalStore` så UI:t (badge + dialog) håller sig i synk
 * när nya invariant-överträdelser upptäcks.
 */

import { useSyncExternalStore } from "react";
import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";
import { issueStore } from "./index";

// Stabil tom-referens så getSnapshot inte triggar oändlig re-render när
// store:n är tom (useSyncExternalStore kräver referens-stabilitet).
const EMPTY: InvariantViolation[] = [];

let cache: InvariantViolation[] = EMPTY;
let cacheCount = -1;

function getSnapshot(): InvariantViolation[] {
  // Bygg om snapshot-arrayen bara när antalet ändrats — annars samma ref.
  if (issueStore.count() !== cacheCount) {
    cacheCount = issueStore.count();
    cache = cacheCount === 0 ? EMPTY : issueStore.list();
  }
  return cache;
}

export function useSelfDetectedIssues(): InvariantViolation[] {
  return useSyncExternalStore(
    (cb) => issueStore.subscribe(cb),
    getSnapshot,
    () => EMPTY, // server-snapshot (SSR) — alltid tom
  );
}
