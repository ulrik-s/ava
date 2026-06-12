import { describe, it, expect, vi } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { SieExportButton } from "@/app/invoices/_sie-export-button";

const downloadMock = vi.fn();

vi.mock("@/lib/client/download-text", () => ({
  downloadTextFile: (...args: unknown[]) => downloadMock(...args),
}));

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

  it("klick laddar ner en SIE-fil med byråns namn + verifikat", () => {
    render(<SieExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Exportera SIE/ }));

    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [filename, content] = downloadMock.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^bokforing_\d{8}\.sie$/);
    expect(content).toContain('#FNAMN "Byrå X"');
    expect(content).toContain("#ORGNR 5566778899");
    // bara SENT-fakturan exporteras, inte DRAFT
    expect(content).toContain('#VER "A" "20260042"');
    expect(content.includes('"F-1"')).toBe(false);
  });
});
