/**
 * Ärendets statusregler ([ADR 0015]): reglerna per status bor hos enumen,
 * inte i vyerna. Samma form som fakturans tillståndsmaskin
 * (`billing/invoice-state-machine.ts`, `ISSUED`/`isIssued`). Nästa mängd av
 * ärendestatusar läggs här, inte som en egen `Set` eller `&&`-kedja.
 *
 * [ADR 0015]: ../../../docs/adr/0015-faktura-tillstandsmaskin.md
 */

import { type MatterStatus, matterStatusSchema } from "@/lib/shared/schemas/enums";

/**
 * Öppna ärenden: allt utom Stängt och Arkiverat. En ny status måste tas
 * ställning till här — kompilatorn kräver det.
 */
const OPEN: Record<MatterStatus, boolean> = {
  ACTIVE: true, CLOSED: false, ARCHIVED: false,
};

/**
 * Är ärendet öppet? Allt som inte är känt stängt räknas som öppet, också en
 * saknad eller okänd status: äldre ärenden saknar status, en backad release
 * kan möta en nyare status, och en dold jävskontroll är det dyra felet.
 */
export function isOpenMatter(status: string | null | undefined): boolean {
  const parsed = matterStatusSchema.safeParse(status);
  return !parsed.success || OPEN[parsed.data];
}
