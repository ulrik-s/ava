/**
 * Tester för VerdictDialog (#27/#828 coverage) — offentligt uppdrags sista steg:
 * domstolens beslut är redan registrerat på KR:n, så dialogen bekräftar bara att
 * fakturan ska skapas (inget belopp matas in), visar prutning och genererar ett
 * faktura-dokument onSuccess.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { VerdictDialog } from "@/app/matters/[id]/_verdict-dialog";
import { asId } from "@/lib/shared/schemas/ids";

let verdictOnSuccess: ((res: unknown) => Promise<void>) | undefined;
const verdictMutate = vi.fn();
const registerMutateAsync = vi.fn(async () => {});
const renderFakturaPdf = vi.fn(async () => new Uint8Array([1, 2, 3]));
const persistGeneratedDoc = vi.fn(async () => {});
const treeInvalidate = vi.fn(async () => {});
const treeRefetch = vi.fn(async () => {});
const listInvalidate = vi.fn(async () => {});

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { tree: { invalidate: treeInvalidate, refetch: treeRefetch }, list: { invalidate: listInvalidate } } }),
    document: { register: { useMutation: () => ({ mutateAsync: registerMutateAsync }) } },
    billingRun: {
      setVerdict: {
        useMutation: (opts: { onSuccess: (res: unknown) => Promise<void> }) => {
          verdictOnSuccess = opts.onSuccess;
          return { mutate: verdictMutate, isPending: false, error: null };
        },
      },
    },
  },
}));
vi.mock("@/lib/client/kostnadsrakning/render-faktura-pdf", () => ({ renderFakturaPdf }));
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

beforeEach(() => { vi.clearAllMocks(); verdictOnSuccess = undefined; });

describe("VerdictDialog", () => {
  it("visar föreslaget + dömt belopp och prutningen (dömt < föreslaget)", () => {
    render(<VerdictDialog {...baseProps} />);
    expect(screen.getByText("Föreslaget belopp")).toBeInTheDocument();
    expect(screen.getByText("Dömt belopp — inkl. moms")).toBeInTheDocument();
    expect(screen.getByText("Prutning")).toBeInTheDocument();
  });

  it("ingen prutning visas när dömt = föreslaget", () => {
    render(<VerdictDialog {...baseProps} awardedOre={500_000} />);
    expect(screen.queryByText("Prutning")).not.toBeInTheDocument();
  });

  it("submit skapar fakturan utan belopp-input (prutning läses ur KR:ns beslut)", () => {
    render(<VerdictDialog {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(verdictMutate).toHaveBeenCalledWith({ billingRunId: "br-1" });
  });

  it("onSuccess genererar faktura-dokument + registrerar det + stänger", async () => {
    const onClose = vi.fn();
    render(<VerdictDialog {...baseProps} onClose={onClose} />);
    expect(verdictOnSuccess).toBeDefined();
    await verdictOnSuccess!({ invoice: { id: "inv-9", amount: 400_000, invoiceNumber: "2026-9" } });
    expect(renderFakturaPdf).toHaveBeenCalled();
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: "faktura-inv-9", matterId: "m1", invoiceId: "inv-9", documentType: "Faktura",
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
