"use client";

import { trpc } from "@/lib/client/trpc";
import type { MatterOption } from "./matter-combobox";

/** Ärendena som går att välja för en post: aktiva ärenden, samma lista som registreringen på /time. */
export function useActiveMatterOptions(): MatterOption[] {
  const matters = trpc.matter.list.useQuery({ pageSize: 500, status: "ACTIVE" });
  return matters.data?.matters ?? [];
}
