import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { SieExportButton } from "@/app/invoices/_sie-export-button";
import { encodePc8 } from "@/lib/shared/accounting/pc8";

const downloadMock = vi.fn();

const GOOD_ITEMS = [
  { amount: 12_500, invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0042", status: "SENT" },
  { amount: 9_999, invoiceDate: "2026-05-01", invoiceNumber: "F-1", status: "DRAFT" },
];
/** En utställd faktura med moms på 0 % – verifikatet går inte att bygga (#1902). */
const BAD_INVOICE = {
  amount: 10_100, invoiceDate: "2026-05-26", invoiceNumber: "F-2026-0043", status: "SENT",
  vatBreakdown: [{ kind: "utlagg", vatRate: 0, netOre: 10_000, vatOre: 100 }],
};
/** Fakturorna som listan ger; byts per test. */
let listItems: unknown[] = GOOD_ITEMS;

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
        // Kuvertform sedan #1014 — knappen läser `data.items`.
        useQuery: () => ({ data: { items: listItems, total: listItems.length } }),
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

  it("filnamnet och #GEN bär dagens SVENSKA datum — nyårsnatten 00:30 är den 1 januari (#1677)", () => {
    downloadMock.mockClear();
    vi.setSystemTime(new Date("2025-12-31T23:30:00Z"));
    try {
      render(<SieExportButton />);
      fireEvent.click(screen.getByRole("button", { name: /Exportera SIE/ }));
    } finally {
      vi.setSystemTime();
    }
    const [filename, bytes] = downloadMock.mock.calls[0] as [string, Uint8Array];
    expect(filename).toBe("bokforing_20260101.sie");
    expect(bin(bytes)).toContain(pc8("#GEN 20260101"));
  });

  it("en faktura vars verifikat inte går att bygga: felraden visas, ingen fil; nästa lyckade export tar bort raden (#1902)", () => {
    downloadMock.mockClear();
    listItems = [...GOOD_ITEMS, BAD_INVOICE];
    const { rerender } = render(<SieExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Exportera SIE/ }));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Kunde inte exportera SIE: Faktura F-2026-0043: en rad i momsuppdelningen har 1,00\u00a0kr moms på satsen 0 %, " +
      "som saknar momskonto (bara 6, 12 och 25 % har ett). " +
      "Verifikatet skulle inte balansera, så fakturan kan inte bokföras förrän momsuppdelningen är rättad.",
    );

    listItems = GOOD_ITEMS;
    rerender(<SieExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Exportera SIE/ }));
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
