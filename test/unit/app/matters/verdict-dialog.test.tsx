/**
 * Tester för VerdictDialog (#27/#828 coverage) — offentligt uppdrags sista steg:
 * domstolens beslut är redan registrerat på KR:n, så dialogen bekräftar bara att
 * fakturan ska skapas (inget belopp matas in), visar prutning och genererar ett
 * faktura-dokument onSuccess.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { VerdictDialog } from "@/app/matters/[id]/_verdict-dialog";
import { orgImageSchema } from "@/lib/shared/org-image";
import { asId } from "@/lib/shared/schemas/ids";
import { pdfPageContents, pdfPageTexts } from "../../../helpers/pdf-text";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider } from "../../../helpers/trpc-fake";

/** Fakturadokumentet får uuid-id (#1143). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const persistGeneratedDoc = vi.fn(async (_doc: { bytes: Uint8Array }) => {});
const INVOICE = { id: "inv-9", amount: 400_000, invoiceNumber: "2026-9" };

vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const baseProps = {
  billingRunId: asId<"BillingRunId">("br-1"),
  workValueOre: 500_000,
  awardedOre: 400_000,
  matterId: asId<"MatterId">("m1"),
  matterNumber: "B-2026-1",
  matterTitle: "Brottmål",
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

/** Renderar dialogen mot en fejkad tRPC-länk; setVerdict svarar med fakturan. */
function renderDialog(props: Partial<ComponentProps<typeof VerdictDialog>> = {}) {
  const fake = fakeTrpcLink({
    "billingRun.setVerdict": () => ({ invoice: INVOICE }),
    "billingRun.invoiceSpecification": () => null,
    "document.register": () => ({ id: "doc-1" }),
  });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<TrpcTestProvider link={fake.link} queryClient={queryClient}><VerdictDialog {...baseProps} {...props} /></TrpcTestProvider>);
  return { fake, invalidate };
}

/** Skicka formuläret och vänta tills dialogen stängts (dokumentet är då genererat). */
async function submitAndWait(onClose: () => void): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
}

function persistedBytes(): Uint8Array {
  const doc = persistGeneratedDoc.mock.calls[0]?.[0];
  if (!doc) throw new Error("inget dokument sparat");
  return doc.bytes;
}

describe("VerdictDialog", () => {
  it("visar föreslaget + dömt belopp och prutningen (dömt < föreslaget)", () => {
    renderDialog();
    expect(screen.getByText("Föreslaget belopp")).toBeInTheDocument();
    expect(screen.getByText("Dömt belopp — inkl. moms")).toBeInTheDocument();
    expect(screen.getByText("Prutning")).toBeInTheDocument();
  });

  it("ingen prutning visas när dömt = föreslaget", () => {
    renderDialog({ awardedOre: 500_000 });
    expect(screen.queryByText("Prutning")).not.toBeInTheDocument();
  });

  it("submit skapar fakturan utan belopp-input (prutning läses ur KR:ns beslut)", async () => {
    const onClose = vi.fn();
    const { fake } = renderDialog({ onClose });
    await submitAndWait(onClose);
    expect(fake.calls.find((c) => c.path === "billingRun.setVerdict")?.input).toEqual({ billingRunId: "br-1" });
  });

  it("onSuccess genererar faktura-dokument + registrerar det + stänger", async () => {
    const onClose = vi.fn();
    const { fake, invalidate } = renderDialog({ onClose });
    await submitAndWait(onClose);
    expect(fake.calls.find((c) => c.path === "billingRun.invoiceSpecification")?.input).toEqual({ matterId: "m1", invoiceId: "inv-9" });
    // Fakturan renderas via den DELADE vy-modellen (#937) → en PDF (#1439) med
    // sammanställning + specifikation.
    const text = (await pdfPageTexts(persistedBytes())).flat();
    expect(text).toContain("Sammanställning");
    expect(text).toContain("Mottagare: Rättshjälpsmyndighet/domstol");
    expect(fake.calls.find((c) => c.path === "document.register")?.input).toEqual(expect.objectContaining({
      id: expect.stringMatching(UUID_RE), matterId: "m1", invoiceId: "inv-9", kinds: ["FAKTURA"],
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
    expect(invalidatedPaths(invalidate)).toEqual(["document.list", "document.tree {\"matterId\":\"m1\"}"]);
  });

  it("byråns namn, org.nr och logga följer med till fakturadokumentet (#1439)", async () => {
    const logo = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
    const onClose = vi.fn();
    renderDialog({ onClose, organization: { organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: logo } });
    await submitAndWait(onClose);
    const bytes = persistedBytes();
    expect((await pdfPageTexts(bytes)).flat()).toEqual(expect.arrayContaining(["Byrå AB", "Org.nr 556677-8899"]));
    const [page1] = await pdfPageContents(bytes);
    expect(page1).toMatch(/\/\S+ Do/); // loggan ritad
  });
});
