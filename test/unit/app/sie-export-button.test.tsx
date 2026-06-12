import { describe, it, expect, vi } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { SieExportButton } from "@/app/invoices/_sie-export-button";
import { encodePc8 } from "@/lib/shared/accounting/pc8";

const downloadMock = vi.fn();

vi.mock("@/lib/client/download-text", () => ({
  downloadBytes: (...args: unknown[]) => downloadMock(...args),
}));

/** Uint8Array → latin1-byte-sträng (för substring-jämförelse mot PC8-bytes). */
const bin = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const pc8 = (s: string) => bin(encodePc8(s));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    invoice: {
      list: {
        useQuery: () => ({
          data: [
            { amount: 12_500, invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0042", status: "SENT" },
            { amount: 9_999, invoiceDate: "2026-05-01", invoiceNumber: "F-1", status: "DRAFT" },
          ],
        }),
      },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: { name: "Byrå X", orgNumber: "5566778899" } }) },
    },
  },
}));

describe("SieExportButton", () => {
  it("renderar en aktiv knapp när det finns utfärdade fakturor", () => {
    render(<SieExportButton />);
    const btn = screen.getByRole("button", { name: /Exportera SIE/ });
    expect(btn).not.toBeDisabled();
  });

  it("klick laddar ner en PC8-kodad SIE-fil med byråns namn + verifikat", () => {
    render(<SieExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Exportera SIE/ }));

    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [filename, bytes] = downloadMock.mock.calls[0] as [string, Uint8Array];
    expect(filename).toMatch(/^bokforing_\d{8}\.sie$/);
    expect(bytes).toBeInstanceOf(Uint8Array);

    const content = bin(bytes); // latin1-byte-sträng
    expect(content).toContain(pc8('#FNAMN "Byrå X"')); // å → CP437 0x86
    expect(content).toContain(pc8("#ORGNR 5566778899"));
    // bara SENT-fakturan exporteras, inte DRAFT
    expect(content).toContain(pc8('#VER "A" "20260042"'));
    expect(content.includes(pc8('"F-1"'))).toBe(false);
  });
});
