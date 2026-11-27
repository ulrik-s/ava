/**
 * Självrisk-aconto-påminnelsen (#1852): samma underlag som dialogen Aconto till
 * klient (`billingRun.proposal`), text före och efter första acontot, knappen
 * öppnar dialogen, och ingen ruta när aconto inte är tillåtet eller under tröskeln.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { SjalvriskAccontoHint } from "@/app/matters/[id]/_sjalvrisk-aconto-hint";
import { availableActions, type BillingAction } from "@/lib/shared/billing/billing-flow";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

let proposalData: { workValueOre: number; priorAccontoSumOre: number } | undefined;
let thresholdOre: number | undefined;
const proposalOpts: Array<{ enabled: boolean }> = [];

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    billingRun: {
      proposal: { useQuery: (_input: unknown, opts: { enabled: boolean }) => { proposalOpts.push(opts); return { data: opts.enabled ? proposalData : undefined }; } },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: thresholdOre === undefined ? undefined : { accontoThresholdOre: thresholdOre } }) },
    },
  },
}));

const matterId = asId<"MatterId">("m1");
const arbete = (method: PaymentMethod): readonly BillingAction[] => availableActions({ paymentMethod: method }, []);
const onOpen = vi.fn();

function renderHint(paymentMethod: PaymentMethod | null, opts: { actions?: readonly BillingAction[]; clientShareBips?: number | null } = {}) {
  return render(
    <SjalvriskAccontoHint matterId={matterId} paymentMethod={paymentMethod} clientShareBips={opts.clientShareBips ?? null}
      actions={opts.actions ?? arbete(paymentMethod ?? "PENDING")} onOpen={onOpen} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  proposalOpts.length = 0;
  proposalData = { workValueOre: 800_000, priorAccontoSumOre: 0 }; // 20 % = 1 600 kr netto
  thresholdOre = undefined;
});

describe("SjalvriskAccontoHint (#1852)", () => {
  it("före första acontot: självrisken exkl. moms och tröskeln", () => {
    renderHint("RATTSHJALP");
    expect(screen.getByRole("status")).toHaveTextContent(/^Klientens självrisk har nått 1\s600,00\s*kr exkl\. moms \(tröskel 1\s500,00\s*kr\)/);
  });

  it("efter ett aconto: självrisken sedan förra acontot", () => {
    // 20 % av 16 000 kr = 3 200 kr + moms = 4 000 kr − 2 000 kr skickat = 2 000 kr → 1 600 kr netto.
    proposalData = { workValueOre: 1_600_000, priorAccontoSumOre: 200_000 };
    renderHint("RATTSSKYDD");
    expect(screen.getByRole("status")).toHaveTextContent(/Klientens självrisk sedan förra acontot har nått 1\s600,00\s*kr exkl\. moms/);
  });

  it("knappen Aconto till klient anropar onOpen", () => {
    renderHint("RATTSHJALP");
    fireEvent.click(screen.getByRole("button", { name: "Aconto till klient" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("ärendets andel och byråns tröskel används", () => {
    thresholdOre = 300_000;
    renderHint("RATTSHJALP", { clientShareBips: 4000 }); // 40 % = 3 200 kr ≥ 3 000 kr
    expect(screen.getByRole("status")).toHaveTextContent(/3\s200,00\s*kr exkl\. moms \(tröskel 3\s000,00\s*kr\)/);
  });

  it("ingen ruta när aconto saknas bland åtgärderna (rättshjälp som väntar på dom)", () => {
    const vantarDom = availableActions({ paymentMethod: "RATTSHJALP" }, [
      { type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD" },
    ]);
    expect(vantarDom.some((a) => a.type === "ACCONTO")).toBe(false);
    const { container } = renderHint("RATTSHJALP", { actions: vantarDom });
    expect(container).toBeEmptyDOMElement();
    expect(proposalOpts.every((o) => !o.enabled)).toBe(true);
  });

  it("ingen ruta i ett privat ärende, och förslaget hämtas inte", () => {
    const { container } = renderHint("PRIVAT");
    expect(container).toBeEmptyDOMElement();
    expect(proposalOpts.every((o) => !o.enabled)).toBe(true);
  });

  it("ingen ruta under tröskeln", () => {
    proposalData = { workValueOre: 500_000, priorAccontoSumOre: 0 }; // 1 000 kr < 1 500 kr
    const { container } = renderHint("RATTSHJALP");
    expect(container).toBeEmptyDOMElement();
  });
});
