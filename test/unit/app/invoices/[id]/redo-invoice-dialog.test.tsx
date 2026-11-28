/**
 * "Fel på fakturan?"-dialogen (#2260): rätt förklaring och rätt åtgärd per
 * fakturans läge, och att kreditera och gör om öppnar faktureringen.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { RedoInvoiceDialog, redoBillingType, redoCopy, type RedoDialogInvoice } from "@/app/invoices/[id]/_redo-invoice-dialog";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const inv: RedoDialogInvoice = {
  matterId: "m1", invoiceNumber: "F-2026-0042", amount: 125_000, status: "SENT", invoiceType: "FINAL",
  creditNote: null, deductedOnFinals: [],
};

function renderDialog(over: Partial<RedoDialogInvoice> = {}, opts: { paidOre?: number; writtenOffOre?: number; plan?: boolean; error?: string } = {}) {
  const onVoid = vi.fn(async () => {});
  const onCredit = vi.fn(async (_notes: string | undefined) => {});
  const onClose = vi.fn();
  render(
    <RedoInvoiceDialog inv={{ ...inv, ...over }} paidOre={opts.paidOre ?? 0} writtenOffOre={opts.writtenOffOre ?? 0}
      hasActivePlan={opts.plan ?? false} isPending={false} error={opts.error ?? null}
      onVoid={onVoid} onCredit={onCredit} onClose={onClose} />,
  );
  return { onVoid, onCredit, onClose };
}

beforeEach(() => { push.mockClear(); });

describe("redoCopy", () => {
  const input = { invoiceNumber: "F-1", amount: 100_000, hasActivePlan: false };

  it("makulera: numret behålls och posterna kommer tillbaka", () => {
    const copy = redoCopy({ kind: "void" }, input);
    expect(copy.confirm).toBe("Makulera faktura F-1");
    expect(copy.points.join(" ")).toMatch(/nummer F-1, som inte används igen.*tillbaka under Fakturera/);
  });

  it("kreditera: kreditfakturan hänvisar till originalet; en plan avbryts", () => {
    expect(redoCopy({ kind: "credit" }, input).points.join(" ")).not.toMatch(/Avbetalningsplanen/);
    const copy = redoCopy({ kind: "credit" }, { ...input, hasActivePlan: true });
    expect(copy.confirm).toBe("Kreditera faktura F-1 och gör om");
    expect(copy.points.join(" ")).toMatch(/hänvisar till faktura F-1.*Avbetalningsplanen avbryts.*Faktureringen öppnas/);
  });

  it("ingen väg: bara skälet, ingen bekräftelse", () => {
    expect(redoCopy({ kind: "blocked", reason: "Nej." }, input)).toEqual({ lead: "Nej.", points: [] });
  });
});

describe("redoBillingType", () => {
  it("ett aconto görs om som aconto, allt annat som faktura", () => {
    expect(redoBillingType("ACCONTO")).toBe("ACCONTO");
    expect(redoBillingType("FINAL")).toBe("FINAL");
    expect(redoBillingType("STANDARD")).toBe("FINAL");
  });
});

describe("RedoInvoiceDialog per läge", () => {
  it("utkast: Makulera anropar onVoid och navigerar inte", async () => {
    const { onVoid, onCredit } = renderDialog({ status: "DRAFT" });
    fireEvent.click(screen.getByRole("button", { name: "Makulera faktura F-2026-0042" }));
    await waitFor(() => expect(onVoid).toHaveBeenCalledTimes(1));
    expect(onCredit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Anledning/)).not.toBeInTheDocument();
  });

  it("bokfört utkast: krediteras i stället för att makuleras", () => {
    renderDialog({ status: "DRAFT", ledgerRef: "A/7" });
    expect(screen.getByRole("button", { name: "Kreditera faktura F-2026-0042 och gör om" })).toBeInTheDocument();
  });

  it("skickad aconto: kreditera med anledning, sedan öppnas acontodialogen för ärendet", async () => {
    const { onCredit } = renderDialog({ invoiceType: "ACCONTO" });
    fireEvent.change(screen.getByLabelText(/Anledning/), { target: { value: "  Fel belopp " } });
    fireEvent.click(screen.getByRole("button", { name: "Kreditera faktura F-2026-0042 och gör om" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/matters/__shell__/?id=m1&fakturera=ACCONTO"));
    expect(onCredit).toHaveBeenCalledWith("Fel belopp");
  });

  it("utan anledning skickas ingen", async () => {
    const { onCredit } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /och gör om/ }));
    await waitFor(() => expect(onCredit).toHaveBeenCalledWith(undefined));
  });

  it("betald: förklaringen, ingen åtgärd, Stäng stänger", () => {
    const { onClose } = renderDialog({ status: "PAID" }, { paidOre: 125_000 });
    expect(screen.getByText(/tillgodohavande/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kreditera|Makulera/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("utan nummer och med serverfel: felet visas", () => {
    renderDialog({ invoiceNumber: null }, { error: "Servern nekade" });
    expect(screen.getByRole("alert")).toHaveTextContent("Servern nekade");
    expect(screen.getByRole("button", { name: "Kreditera faktura (utan nummer) och gör om" })).toBeInTheDocument();
  });
});
