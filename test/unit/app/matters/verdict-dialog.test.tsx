/**
 * Tester för VerdictDialog (#27 coverage) — OFFENTLIG_FÖRSVARARE-flowets
 * steg 2: ange dömt belopp → prutning räknas baklänges, vakt mot för högt
 * belopp, och onSuccess genererar ett faktura-dokument.
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
  matterId: asId<"MatterId">("m1"),
  matterNumber: "B-2026-1",
  matterTitle: "Brottmål",
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); verdictOnSuccess = undefined; });

describe("VerdictDialog", () => {
  it("visar föreslaget belopp och initierar dömt = föreslaget (ingen prutning)", () => {
    render(<VerdictDialog {...baseProps} />);
    expect(screen.getByText("Föreslaget belopp")).toBeInTheDocument();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("5000"); // 500 000 öre / 100
    expect(screen.queryByText("Prutning")).not.toBeInTheDocument();
  });

  it("dömt < föreslaget → visar prutning och submit skickar negativ prutningOre", () => {
    render(<VerdictDialog {...baseProps} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4000" } }); // 400 000 öre
    expect(screen.getByText("Prutning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(verdictMutate).toHaveBeenCalledWith({ billingRunId: "br-1", prutningOre: -100_000 });
  });

  it("dömt > föreslaget → fel-text, submit disabled, ingen mutation", () => {
    render(<VerdictDialog {...baseProps} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6000" } });
    expect(screen.getByText(/kan inte överstiga föreslaget/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Skapa faktura" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.submit(submit.closest("form")!);
    expect(verdictMutate).not.toHaveBeenCalled();
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
