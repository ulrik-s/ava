/**
 * Capability-helpers för `LedgerConnector` (#234, ADR 0011).
 *
 * Rena predikat som gat:ar UI och verifierar port-invarianten (en `true`-
 * capability måste motsvaras av en implementerad metod). Inget I/O.
 */

import type { LedgerCapabilities, LedgerConnector } from "./port";

/** Ingen connector ansluten → allt avstängt (default-läge, t.ex. demo-tier). */
export const NO_CAPABILITIES: LedgerCapabilities = {
  pushVoucher: false,
  pushInvoice: false,
  pullPayments: false,
  exportSie: false,
};

/**
 * Kan byrån bokföra fakturan i ledger-systemet? Gat:ar "Bokför i …"-knappen —
 * sant om connectorn kan ta verifikat ELLER skapa faktura.
 */
export function canBookkeep(caps: LedgerCapabilities): boolean {
  return caps.pushVoucher || caps.pushInvoice;
}

/** Kan byrån hämta inkomna betalningar? Gat:ar "Hämta betalningar". */
export function canPullPayments(caps: LedgerCapabilities): boolean {
  return caps.pullPayments;
}

/** Kan byrån exportera SIE? Gat:ar "Exportera SIE". */
export function canExportSie(caps: LedgerCapabilities): boolean {
  return caps.exportSie;
}

/** Map: capability-flagga → namnet på port-metoden som måste finnas. */
const CAPABILITY_METHODS: Record<keyof LedgerCapabilities, keyof LedgerConnector> = {
  pushVoucher: "pushVoucher",
  pushInvoice: "pushInvoice",
  pullPayments: "pullPayments",
  exportSie: "exportSie",
};

/**
 * Verifierar port-invarianten: varje `true`-capability har en implementerad
 * metod, och ingen metod saknar motsvarande `true`-flagga. Kastar vid avvikelse
 * — connectorer bör köra detta i sin egen konstruktion/test.
 */
export function assertConnectorMatchesCapabilities(connector: LedgerConnector): void {
  const caps = connector.capabilities();
  for (const cap of Object.keys(CAPABILITY_METHODS) as (keyof LedgerCapabilities)[]) {
    const method = CAPABILITY_METHODS[cap];
    const implemented = typeof connector[method] === "function";
    if (caps[cap] && !implemented) {
      throw new Error(`Connector "${connector.name}": capability ${cap}=true men metoden ${method} saknas`);
    }
    if (!caps[cap] && implemented) {
      throw new Error(`Connector "${connector.name}": metoden ${method} finns men capability ${cap}=false`);
    }
  }
}
