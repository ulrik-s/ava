"use client";

/**
 * Ett ärendenummer med den ansvariga juristens initialer i fetstil framför,
 * när numret inte redan bär dem (#1727). Slår själv upp juristen med
 * `user.list` (react-query delar svaret mellan raderna: en fråga per sida).
 */

import { trpc } from "@/lib/client/trpc";
import { matterNumberInitials } from "@/lib/shared/matter-number-display";

/** Indata: numret och ärendets nuvarande ansvariga (id). */
interface MatterNumberProps {
  matterNumber: string;
  responsibleLawyerId?: string | null | undefined;
}

export function MatterNumber({ matterNumber, responsibleLawyerId }: MatterNumberProps) {
  const users = trpc.user.list.useQuery();
  const lawyer = users.data?.users.find((u) => u.id === responsibleLawyerId);
  const initials = matterNumberInitials(matterNumber, lawyer?.matterNumberPrefix);
  if (!initials) return <>{matterNumber}</>;
  return <><strong className="font-bold">{initials}</strong> {matterNumber}</>;
}
