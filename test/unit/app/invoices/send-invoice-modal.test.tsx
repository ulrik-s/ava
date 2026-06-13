/**
 * Test för SendInvoiceModal (#179) — manuellt fakturautskick via helper/nedladdning
 * + explicit "skickad"-bekräftelse som registrerar dispatch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const recordMutate = vi.fn();
const composeMail = vi.fn(async () => true);
const downloadBytes = vi.fn();
const renderFakturaPdf = vi.fn(async () => new Uint8Array([1, 2, 3]));
let helperVersion: string | undefined | null = "helper-v1.0.0";

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    invoiceDispatch: {
      recordManual: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...a: unknown[]) => { recordMutate(...a); opts.onSuccess?.(); }, isPending: false, error: null }) },
    },
  },
}));
vi.mock("@/lib/client/helper/use-helper", () => ({
  useHelper: () => ({ version: helperVersion, checked: true }),
  composeMailViaHelper: (...a: unknown[]) => composeMail(...a),
}));
vi.mock("@/lib/client/download-text", () => ({ downloadBytes: (...a: unknown[]) => downloadBytes(...a) }));
vi.mock("@/lib/client/kostnadsrakning/render-faktura-pdf", () => ({ renderFakturaPdf: (...a: unknown[]) => renderFakturaPdf(...a) }));

import { SendInvoiceModal } from "@/app/invoices/[id]/_send-invoice-modal";

const baseProps = {
  invoiceId: "inv-1",
  invoiceNumber: "F-2026-0001",
  amount: 12_500,
  ocrReference: "1234567894",
  invoiceDate: "2026-06-13",
  matterNumber: "2026-0001",
  matterTitle: "Tvist",
  onClose: vi.fn(),
  onRecorded: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  helperVersion = "helper-v1.0.0";
});

describe("SendInvoiceModal", () => {
  it("renderar rubrik + åtgärdsknappar", () => {
    render(<SendInvoiceModal {...baseProps} />);
    expect(screen.getByRole("heading", { name: /E-posta faktura/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Öppna i mailklient/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ladda ner PDF/i })).toBeInTheDocument();
  });

  it("nedladdning genererar PDF + laddar ner, sedan visas bekräftelse", async () => {
    render(<SendInvoiceModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Ladda ner PDF/i }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalled());
    expect(renderFakturaPdf).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Markera som skickad/i })).toBeInTheDocument();
  });

  it("helper tillgänglig → öppnar mailklient (compose-mail), ingen nedladdning", async () => {
    render(<SendInvoiceModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Öppna i mailklient/i }));
    await waitFor(() => expect(composeMail).toHaveBeenCalled());
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it("helper saknas → faller tillbaka på nedladdning", async () => {
    helperVersion = null;
    render(<SendInvoiceModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Öppna i mailklient/i }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalled());
    expect(composeMail).not.toHaveBeenCalled();
  });

  it("bekräftelse registrerar dispatch — kanal 'manual' utan e-post", async () => {
    render(<SendInvoiceModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Ladda ner PDF/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Markera som skickad/i }));
    await waitFor(() => expect(recordMutate).toHaveBeenCalled());
    expect(recordMutate.mock.calls[0]![0]).toMatchObject({ invoiceId: "inv-1", channel: "manual" });
    expect(baseProps.onRecorded).toHaveBeenCalled();
  });

  it("kanal 'email' när en e-postadress angetts", async () => {
    render(<SendInvoiceModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/klient@/i), { target: { value: "k@x.se" } });
    fireEvent.click(screen.getByRole("button", { name: /Ladda ner PDF/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Markera som skickad/i }));
    await waitFor(() => expect(recordMutate).toHaveBeenCalled());
    expect(recordMutate.mock.calls[0]![0]).toMatchObject({ channel: "email", recipient: "k@x.se" });
  });
});
