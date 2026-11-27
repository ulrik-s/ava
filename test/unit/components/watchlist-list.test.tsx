import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import type { WatchlistItem } from "@/lib/shared/watchlist";

const openMatterDocument = vi.fn(() => Promise.resolve());
vi.mock("@/lib/client/firma/open-matter-document", () => ({ openMatterDocument }));

const { WatchlistList } = await import("@/components/watchlist/watchlist-list");

function item(p: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    kind: "deadline", severity: "approaching",
    title: "Tidsfrist om 3 dagar: Ge in yttrande",
    detail: "Förfaller 2026-09-08.",
    matterId: "m1", matterNumber: "2026-0001",
    at: "2026-09-08", amountOre: null, link: { route: "matters", id: "m1" }, ...p,
  };
}

describe("WatchlistList", () => {
  it("visar tomt-text när inget behöver bevakas", () => {
    render(<WatchlistList items={[]} emptyText="Inget att bevaka just nu." />);
    expect(screen.getByText("Inget att bevaka just nu.")).toBeInTheDocument();
  });

  it("visar rubrik, detalj och ärendenummer", () => {
    render(<WatchlistList items={[item()]} emptyText="" />);
    expect(screen.getByText(/Ge in yttrande/)).toBeInTheDocument();
    expect(screen.getByText(/Förfaller 2026-09-08/)).toBeInTheDocument();
    expect(screen.getByText("2026-0001")).toBeInTheDocument();
  });

  it("länkar dit man åtgärdar posten", () => {
    render(<WatchlistList items={[item()]} emptyText="" />);
    // EntityLink: via den förrenderade __shell__-routen — funkar för ärenden skapade efter bygget (#1215).
    expect(screen.getByRole("link").getAttribute("href")).toContain("/matters/__shell__");
    expect(screen.getByRole("link").getAttribute("href")).toContain("id=m1");
  });

  it("Bör faktureras länkar med fakturera=1 efter id (#1854)", () => {
    render(<WatchlistList items={[item({ kind: "unbilled", link: { route: "matters", id: "m1", query: { fakturera: "1" } } })]} emptyText="" />);
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/id=m1&fakturera=1$/);
  });

  it("en tidsfrist länkar utan fakturera (#1854)", () => {
    render(<WatchlistList items={[item()]} emptyText="" />);
    expect(screen.getByRole("link").getAttribute("href")).not.toContain("fakturera");
  });

  it("visar belopp när posten har ett", () => {
    render(<WatchlistList items={[item({ amountOre: 2_500_000, kind: "unbilled" })]} emptyText="" />);
    expect(screen.getByText(/25 000,00/)).toBeInTheDocument();
  });

  // Färgen bär samma information som sorteringen, men får inte vara den enda
  // bäraren — allvarsgraden ska gå att uppfatta utan att se färg.
  it("skiljer passerat från annalkande visuellt", () => {
    const { container: passerat } = render(
      <WatchlistList items={[item({ severity: "passed" })]} emptyText="" />,
    );
    expect(passerat.querySelector("a")?.className).toContain("red");

    const { container: annalkande } = render(
      <WatchlistList items={[item({ severity: "approaching" })]} emptyText="" />,
    );
    expect(annalkande.querySelector("a")?.className).toContain("amber");
  });

  it("namnger signaltypen för skärmläsare", () => {
    render(<WatchlistList items={[item({ kind: "unbilled" })]} emptyText="" />);
    expect(screen.getByText(/Ofakturerat:/)).toBeInTheDocument();
  });

  it("renderar flera poster utan nyckelkrock när ärende och datum saknas", () => {
    render(
      <WatchlistList
        items={[
          item({ matterId: null, matterNumber: null, at: null }),
          item({ matterId: null, matterNumber: null, at: null }),
        ]}
        emptyText=""
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});

describe("WatchlistList — klient och ärendenummer överst (#1965)", () => {
  it("med showClient: \"Klient A · 2026-0001\" överst, före rubriken, och numret bara en gång", () => {
    render(<WatchlistList items={[item({ klientName: "Klient A" })]} emptyText="" showClient />);
    const top = screen.getByText("Klient A · 2026-0001");
    expect(top.compareDocumentPosition(screen.getByText(/Ge in yttrande/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/2026-0001/)).toHaveLength(1);
  });

  it("med showClient men utan klient: bara ärendenumret överst", () => {
    render(<WatchlistList items={[item()]} emptyText="" showClient />);
    expect(screen.getAllByText("2026-0001")).toHaveLength(1);
    expect(screen.queryByText(/ · /)).not.toBeInTheDocument();
  });

  it("med showClient: en post utan ärende har ingen översta rad", () => {
    render(<WatchlistList items={[item({ matterId: null, matterNumber: null, link: null })]} emptyText="" showClient />);
    // Ikonen först på raden: inget står ovanför rubriken.
    expect(screen.getByRole("listitem").textContent.startsWith("⏳")).toBe(true);
  });

  it("utan showClient: raden som i dag, också när posten har klientName", () => {
    render(<WatchlistList items={[item({ klientName: "Klient A" })]} emptyText="" />);
    expect(screen.queryByText(/Klient A/)).not.toBeInTheDocument();
    expect(screen.getByText("2026-0001")).toBeInTheDocument();
  });
});

describe("WatchlistList — Ska ärendet markeras som avslutat? (#2100)", () => {
  const suggestion = (): WatchlistItem => item({
    kind: "closeSuggestion", title: "Ska ärendet markeras som avslutat?",
    detail: "Ingen tid registrerad sedan 2026-09-25.", at: null,
    closeSuggestion: { matterTitle: "Vårdnadstvist", noTimeSince: "2026-09-25", documents: [] },
  });
  const actions = (isPending = false) => ({ close: vi.fn(), keepActive: vi.fn(), isPending });

  it("med closeActions: rubriklänk till ärendet, skälet och de två knapparna", () => {
    const a = actions();
    render(<WatchlistList items={[suggestion()]} emptyText="" closeActions={a} />);
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("Ska ärendet markeras som avslutat?");
    expect(link.textContent).toContain("2026-0001");
    expect(link.getAttribute("href")).toContain("id=m1");
    expect(screen.getByText(/Ingen tid registrerad sedan 2026-09-25/)).toBeInTheDocument();
    expect(screen.getByText("Avslut:")).toBeInTheDocument();
    // Knapparna ligger utanför länken.
    expect(within(link).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Avsluta ärendet" }));
    expect(a.close).toHaveBeenCalledWith({ id: "m1", title: "Vårdnadstvist" });
    fireEvent.click(screen.getByRole("button", { name: "Behåll som aktivt" }));
    expect(a.keepActive).toHaveBeenCalledWith("m1");
  });

  it("med isPending är knapparna inaktiva", () => {
    render(<WatchlistList items={[suggestion()]} emptyText="" closeActions={actions(true)} />);
    expect(screen.getByRole("button", { name: "Avsluta ärendet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Behåll som aktivt" })).toBeDisabled();
  });

  it("utan closeActions: en vanlig rad med skälet och inga knappar", () => {
    render(<WatchlistList items={[suggestion()]} emptyText="" />);
    expect(screen.getByRole("link").textContent).toContain("Ingen tid registrerad sedan 2026-09-25.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("med closeActions ser de andra sorterna ut som i dag", () => {
    render(<WatchlistList items={[item()]} emptyText="" closeActions={actions()} />);
    expect(screen.getByRole("link").textContent).toContain("Förfaller 2026-09-08.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ett dokument som skäl (#2101): filnamnet är en knapp utanför länken som öppnar dokumentet", async () => {
    const doc = { id: "d1", fileName: "protokoll.pdf", storagePath: "documents/content/d1.pdf", ruling: "PT_HD" as const };
    const withDoc = item({
      kind: "closeSuggestion", title: "Ska ärendet markeras som avslutat?", at: null,
      detail: "protokoll.pdf ser ut att vara …",
      closeSuggestion: { matterTitle: "Vårdnadstvist", noTimeSince: null, documents: [doc] },
    });
    render(<WatchlistList items={[withDoc]} emptyText="" closeActions={actions()} />);
    expect(screen.queryByText(/Ingen tid registrerad/)).toBeNull();
    const button = screen.getByRole("button", { name: "protokoll.pdf" });
    expect(within(screen.getByRole("link")).queryByRole("button")).toBeNull();
    expect(button.parentElement?.textContent).toBe(
      "protokoll.pdf ser ut att vara ett beslut från Högsta domstolen att inte meddela prövningstillstånd.",
    );
    fireEvent.click(button);
    await waitFor(() => expect(openMatterDocument).toHaveBeenCalledWith(
      { id: "d1", storagePath: "documents/content/d1.pdf", fileName: "protokoll.pdf" },
    ));
  });

  it("tidsskälet först, sedan dokumenten i den ordning de kommer", () => {
    const doc = (id: string, ruling: "DOM_HD" | "AVSKRIVNING") => ({ id, fileName: `${id}.pdf`, storagePath: id, ruling });
    const both = suggestion();
    render(<WatchlistList items={[{ ...both, closeSuggestion: {
      matterTitle: "Vårdnadstvist", noTimeSince: "2026-09-25", documents: [doc("b", "DOM_HD"), doc("a", "AVSKRIVNING")],
    } }]} emptyText="" closeActions={actions()} />);
    const texts = [...screen.getByRole("listitem").querySelectorAll("p")].map((p) => p.textContent);
    expect(texts).toEqual([
      "Ingen tid registrerad sedan 2026-09-25.",
      "b.pdf ser ut att vara en dom från Högsta domstolen.",
      "a.pdf ser ut att vara ett slutligt beslut om avskrivning.",
    ]);
  });
});
