/**
 * Gemensam rendering av `TimeSection` för tidssektionens tester (#1929): svar på
 * alla procedurer sektionen och dess barn läser, med tomma standardvärden. Ett
 * test ger bara de svar det bryr sig om.
 */

import type { ComponentProps } from "react";
import { TimeSection } from "@/app/matters/[id]/_time-section";
import { asId } from "@/lib/shared/schemas/ids";
import { DATA_TABLE_HANDLERS, renderWithFakeTrpc, settled, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import type { TrpcHandlers } from "../../../helpers/trpc-fake";

/** Ärendet sektionen visas i. */
export const TIME_MATTER_ID = asId<"MatterId">("m1");

/** Standardsvaren: inga poster, inget upparbetat, ingen saknad rådgivningspost. */
const BASE: TrpcHandlers = {
  ...DATA_TABLE_HANDLERS,
  "timeEntry.list": () => ({ entries: [], totalMinutes: 0 }),
  "timeEntry.radgivningStatus": () => ({ kind: "present", invoiceId: "inv-r" }),
  "timeEntry.create": () => ({ id: "t-ny" }),
  "timeEntry.update": () => ({ id: "t1" }),
  "timeEntry.moveToMatter": () => ({ moved: 1 }),
  "timeEntry.delete": () => ({ id: "t1" }),
  "timeEntry.markAsRadgivning": () => ({ id: "t1" }),
  "matter.coverageUsage": () => ({ billableMinutes: 0, billableValueOre: 0 }),
  "matter.list": () => ({ matters: [] }),
  "organization.getSettings": () => ({ standardAtgarder: [] }),
  "billingRun.list": () => ({ runs: [] }),
};

type Props = Partial<ComponentProps<typeof TimeSection>>;

/** Renderar sektionen och väntar tills första hämtningen är klar. */
export async function renderTimeSection(handlers: TrpcHandlers, props: Props = {}): Promise<FakeTrpcRender> {
  const view = renderWithFakeTrpc(<TimeSection matterId={TIME_MATTER_ID} {...props} />, { ...BASE, ...handlers });
  await settled(view);
  return view;
}

/** Invalideringen av en procedur för ett ärende, som `invalidatedPaths` skriver den. */
export function forMatter(path: string, matterId: string): string {
  return `${path} ${JSON.stringify({ matterId })}`;
}
