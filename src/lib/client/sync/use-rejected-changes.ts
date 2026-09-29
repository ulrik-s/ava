"use client";

/** `useRejectedChanges` (#1266) — flikens avvisade ändringar, live. */

import { useEffect, useState } from "react";
import { rejectedChanges, type RejectedChange } from "../backend/rejected-changes";

export function useRejectedChanges(): readonly RejectedChange[] {
  const [items, setItems] = useState<readonly RejectedChange[]>(() => rejectedChanges.list());
  useEffect(() => rejectedChanges.subscribe(setItems), []);
  return items;
}
