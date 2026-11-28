/**
 * Test för InvoicesPage — listrendering, status, tomt-läge.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import InvoicesPage from "@/app/invoices/page";
import { rowOrder, sortColumn } from "../../../helpers/data-table";
import { NEW_TRPC_BINDING, renderWithNewTrpc } from "../../../helpers/trpc-classic-mock";

// Kuvertform sedan #1014 — sidan läser `data.items`.
const invoicesQuery = {
  data: undefined as { items: Array<Record<string, unknown>>; total: number } | undefined,
  isLoading: false,
};
const failedQuery: { data: Array<{ invoiceId: string }> | undefined } = { data: [] };
const setInvoices = (rows: Array<Record<string, unknown>> | undefined): void => {
  invoicesQuery.data = rows === undefined ? undefined : { items: rows, total: rows.length };
};

/** Byråns användare (`user.list`): prefixen styr initialerna i kolumnen Ärende (#1728). */
const usersQuery: { data: { users: Array<{ id: string; name: string; matterNumberPrefix?: string | null }> } } = {
  data: { users: [] },
};

vi.mock("@/lib/client/trpc", () => ({
  ...NEW_TRPC_BINDING,
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    invoice: {
      list: { useQuery: () => invoicesQuery },
    },
    invoiceDispatch: {
      listFailed: { useQuery: () => failedQuery },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: { name: "Byrå", orgNumber: "5566778899" } }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  setInvoices(undefined);
  invoicesQuery.isLoading = false;
  usersQuery.data.users = [];
  failedQuery.data = [];
});

describe("InvoicesPage", () => {
  it("renderar rubrik", () => {
    setInvoices([]);
    renderWithNewTrpc(<InvoicesPage />);
    expect(screen.getByRole("heading", { name: /Fakturor/i })).toBeInTheDocument();
  });

  it("visar laddartext", () => {
    invoicesQuery.isLoading = true;
    renderWithNewTrpc(<InvoicesPage />);
    expect(screen.getByText(/Laddar/i)).toBeInTheDocument();
  });

  it("visar tomt-läge när inga fakturor finns", () => {
    setInvoices([]);
    renderWithNewTrpc(<InvoicesPage />);
    expect(screen.getByText(/Inga fakturor ännu/i)).toBeInTheDocument();
  });

  it("listar fakturor med status och typ", () => {
    setInvoices([
      {
        id: "i1",
        invoiceDate: new Date("2026-02-01").toISOString(),
        invoiceType: "STANDARD",
        status: "PAID",
        amount: 150000,
        matter: { id: "m1", matterNumber: "2026-0001", title: "Bodelning" },
      },
      {
        id: "i2",
        invoiceDate: new Date("2026-02-15").toISOString(),
        invoiceType: "ACCONTO",
        status: "SENT",
        amount: 50000,
        matter: { id: "m2", matterNumber: "2026-0002", title: "Tvist" },
      },
      {
        id: "i3",
        invoiceDate: new Date("2026-02-20").toISOString(),
        invoiceType: "CREDIT",
        status: "DRAFT",
        amount: -10000,
        matter: { id: "m3", matterNumber: "2026-0003", title: "Arv" },
      },
    ]);
    renderWithNewTrpc(<InvoicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" })); // kreditfakturan dold från början (#1522)
    expect(screen.getByText("Faktura")).toBeInTheDocument();
    expect(screen.getByText("Aconto")).toBeInTheDocument();
    expect(screen.getByText("Kreditfaktura")).toBeInTheDocument(); // förr rått "CREDIT" (#1309)
    expect(screen.queryByText("CREDIT")).toBeNull();
    expect(screen.getByText("Betald")).toBeInTheDocument();
    expect(screen.getByText("Skickad")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0002 — Tvist/)).toBeInTheDocument();
  });

  it("varje kolumn sorterar på det som visas", () => {
    setInvoices([
      { id: "i1", invoiceNumber: "F-2", invoiceDate: "2026-03-01", invoiceType: "STANDARD", status: "PAID",
        amount: 100, matter: { id: "m1", matterNumber: "2026-0001", title: "A" } },
      { id: "i2", invoiceNumber: "F-1", invoiceDate: "2026-01-01", invoiceType: "ACCONTO", status: "SENT",
        amount: 500, matter: { id: "m2", matterNumber: "2026-0002", title: "B" } },
    ]);
    renderWithNewTrpc(<InvoicesPage />);
    const numbers = ["F-1", "F-2"];
    sortColumn("Fakturanr", "asc");
    expect(rowOrder(numbers)).toEqual(["F-1", "F-2"]);
    sortColumn("Datum", "desc");
    expect(rowOrder(numbers)).toEqual(["F-2", "F-1"]);
    sortColumn("Ärende", "desc");
    expect(rowOrder(numbers)).toEqual(["F-1", "F-2"]);
    sortColumn("Typ", "desc");
    expect(rowOrder(numbers)).toEqual(["F-2", "F-1"]);
    sortColumn("Status", "desc");
    expect(rowOrder(numbers)).toEqual(["F-1", "F-2"]);
    sortColumn("Belopp", "asc");
    expect(rowOrder(numbers)).toEqual(["F-2", "F-1"]);
  });

  it("länkar varje rad till faktura- och ärendesidor", () => {
    setInvoices([
      {
        id: "i1",
        invoiceDate: new Date("2026-02-01").toISOString(),
        invoiceType: "STANDARD",
        status: "DRAFT",
        amount: 1000,
        matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
      },
    ]);
    renderWithNewTrpc(<InvoicesPage />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    // Både faktura- och ärende-länken renderas nu som Next-<Link> till den
    // förrenderade __shell__-routen med ?id=<id> (soft-nav), så runtime-skapade
    // id:n funkar utan egen prerender. Base-path är tomt i testmiljön.
    expect(hrefs).toContain("/invoices/__shell__?id=i1");
    expect(hrefs).toContain("/matters/__shell__?id=m1");
    // ...och INTE en direkt /<route>/<id>-länk.
    expect(hrefs).not.toContain("/invoices/i1/");
    expect(hrefs).not.toContain("/matters/m1/");
  });

  it("renderar alla statuser med rätt klass-färg", () => {
    setInvoices([
      { id: "i1", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "DRAFT", amount: 100, matter: { id: "m1", matterNumber: "1", title: "T" } },
      { id: "i2", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", amount: 100, matter: { id: "m2", matterNumber: "2", title: "T" } },
      { id: "i3", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "CANCELLED", amount: 100, matter: { id: "m3", matterNumber: "3", title: "T" } },
      { id: "i4", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "BAD_DEBT", amount: 100, matter: { id: "m4", matterNumber: "4", title: "T" } },
      { id: "i5", invoiceDate: new Date().toISOString(), invoiceType: "FINAL", status: "SENT", amount: -100, matter: { id: "m5", matterNumber: "5", title: "T" } },
    ]);
    renderWithNewTrpc(<InvoicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" })); // annullerad dold från början (#1522)
    expect(screen.getByText("Skapad")).toBeInTheDocument();
    expect(screen.getByText("Avbetalningsplan")).toBeInTheDocument();
    expect(screen.getByText("Annullerad")).toBeInTheDocument();
    expect(screen.getByText("Kundförlust")).toBeInTheDocument();
    expect(screen.getByText("Slutfaktura")).toBeInTheDocument();
  });

  describe("annullerade och kreditfakturor dolda från början (#1522)", () => {
    const row = (id: string, status: string, invoiceType: string, amount: number): Record<string, unknown> => ({
      id, invoiceNumber: `F-${id}`, invoiceDate: new Date("2026-03-01").toISOString(), invoiceType, status, amount,
      matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
    });
    const mixed = (): void => setInvoices([
      row("1", "SENT", "STANDARD", 100000),
      row("2", "CANCELLED", "STANDARD", 40000),
      row("3", "DRAFT", "CREDIT", -40000),
      row("4", "PAID", "FINAL", 25000),
    ]);
    const footer = (container: HTMLElement): string => container.querySelector("tfoot")?.textContent ?? "";

    it("döljer annullerade och kreditfakturor och visar antalet på knappen", () => {
      mixed();
      renderWithNewTrpc(<InvoicesPage />);
      expect(screen.getByText("F-1")).toBeInTheDocument();
      expect(screen.getByText("F-4")).toBeInTheDocument();
      expect(screen.queryByText("F-2")).toBeNull();
      expect(screen.queryByText("F-3")).toBeNull();
      expect(screen.getByRole("button", { name: "Visa annullerade (2)" })).toBeInTheDocument();
    });

    it("klick visar de dolda med sin status och byter text; nytt klick döljer igen", () => {
      mixed();
      renderWithNewTrpc(<InvoicesPage />);
      fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (2)" }));
      expect(screen.getByText("F-2")).toBeInTheDocument();
      expect(screen.getByText("F-3")).toBeInTheDocument();
      expect(screen.getByText("Annullerad")).toBeInTheDocument();
      expect(screen.getByText("Kreditfaktura")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dölj annullerade" }));
      expect(screen.queryByText("F-2")).toBeNull();
    });

    it("summeringen räknar bara synliga rader", () => {
      setInvoices([row("1", "SENT", "STANDARD", 100000), row("2", "CANCELLED", "STANDARD", 40000)]);
      const { container } = renderWithNewTrpc(<InvoicesPage />);
      expect(footer(container)).toMatch(/1\s?000/);
      fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" }));
      expect(footer(container)).toMatch(/1\s?400/);
    });

    it("ingen knapp när inget är dolt", () => {
      setInvoices([row("1", "SENT", "STANDARD", 100000)]);
      renderWithNewTrpc(<InvoicesPage />);
      expect(screen.queryByRole("button", { name: /annullerade/ })).toBeNull();
    });
  });

  it("Ärende visar ansvarig jurists initialer framför numret när numret inte bär dem (#1728)", () => {
    usersQuery.data.users = [{ id: "u-cd", name: "Cecilia D", matterNumberPrefix: "CD" }];
    const row = (id: string, matterNumber: string) => ({
      id, invoiceDate: new Date("2026-02-01").toISOString(), invoiceType: "STANDARD", status: "SENT", amount: 1000,
      matter: { id: `m${id}`, matterNumber, title: `Fall ${id}`, responsibleLawyerId: "u-cd" },
    });
    setInvoices([row("1", "AB2026-0001"), row("2", "CD2026-0002")]);
    renderWithNewTrpc(<InvoicesPage />);
    const other = screen.getByRole("link", { name: "CD AB2026-0001 — Fall 1" });
    expect(within(other).getByText("CD").tagName).toBe("STRONG");
    const own = screen.getByRole("link", { name: "CD2026-0002 — Fall 2" });
    expect(own.querySelector("strong")).toBeNull();
  });

  describe("förfallna och ej framkomna (#1731)", () => {
    const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();
    const row = (id: string, status: string, dueDate: string | null, payments: number[] = []): Record<string, unknown> => ({
      id, invoiceNumber: `F-${id}`, invoiceDate: daysAgo(40), invoiceType: "STANDARD", status, amount: 10000, dueDate,
      payments: payments.map((amount) => ({ amount })),
      matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
    });
    const statusCell = (invoiceNumber: string): HTMLElement => {
      const tr = screen.getByText(invoiceNumber).closest("tr");
      if (!tr) throw new Error(`ingen rad för ${invoiceNumber}`);
      return tr;
    };

    it("en förfallen faktura visar \"Förfallen N dagar\" i rött, singular för en dag", () => {
      setInvoices([row("1", "SENT", daysAgo(12)), row("2", "INSTALLMENT_PLAN", daysAgo(1)), row("3", "SENT", daysAgo(5), [10000])]);
      renderWithNewTrpc(<InvoicesPage />);
      const mark = screen.getByText("Förfallen 12 dagar");
      expect(mark.className).toContain("text-red-700");
      expect(statusCell("F-1")).toContainElement(mark);
      expect(statusCell("F-2")).toContainElement(screen.getByText("Förfallen 1 dag"));
      expect(statusCell("F-3").textContent).not.toContain("Förfallen"); // helt betald
    });

    it("en faktura med misslyckat utskick visar \"Kom inte fram\"; en faktura kan ha båda", () => {
      failedQuery.data = [{ invoiceId: "1" }, { invoiceId: "2" }];
      setInvoices([row("1", "SENT", daysAgo(3)), row("2", "PAID", daysAgo(3))]);
      renderWithNewTrpc(<InvoicesPage />);
      expect(statusCell("F-1").textContent).toContain("Förfallen 3 dagar");
      expect(statusCell("F-1").textContent).toContain("Kom inte fram");
      expect(statusCell("F-2").textContent).toContain("Kom inte fram");
      expect(statusCell("F-2").textContent).not.toContain("Förfallen");
    });

    it("knappen visar bara markerade fakturor och växlar tillbaka", () => {
      failedQuery.data = [{ invoiceId: "3" }];
      setInvoices([row("1", "SENT", daysAgo(3)), row("2", "PAID", daysAgo(3)), row("3", "DRAFT", null)]);
      renderWithNewTrpc(<InvoicesPage />);
      const button = screen.getByRole("button", { name: "Förfallna och ej framkomna" });
      expect(button.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("F-1")).toBeInTheDocument();
      expect(screen.getByText("F-3")).toBeInTheDocument();
      expect(screen.queryByText("F-2")).toBeNull();
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByText("F-2")).toBeInTheDocument();
    });

    it("innan misslyckade utskick laddats visas bara förfallen-markeringen", () => {
      failedQuery.data = undefined;
      setInvoices([row("1", "SENT", daysAgo(2))]);
      renderWithNewTrpc(<InvoicesPage />);
      expect(statusCell("F-1").textContent).toContain("Förfallen 2 dagar");
      expect(statusCell("F-1").textContent).not.toContain("Kom inte fram");
    });
  });
});
