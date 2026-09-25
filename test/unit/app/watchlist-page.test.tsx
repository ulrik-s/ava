import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import WatchlistPage from "@/app/watchlist/page";
import type { WatchlistItem } from "@/lib/shared/watchlist";

const query: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
/** Senaste argumenten till useQuery — så filtret "bara mina" går att verifiera. */
let lastArgs: unknown = null;

const completeMutate = vi.fn();
const createMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    // Bocka av + ny bevakning (#1167).
    useUtils: () => ({ watchlist: { list: { invalidate: vi.fn() } }, task: { listForMatter: { invalidate: vi.fn() } } }),
    task: {
      complete: { useMutation: () => ({ mutate: completeMutate, isPending: false }) },
      create: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { createMutate(a); o.onSuccess(); }, isPending: false }) },
    },
    watchlist: {
      list: {
        useQuery: (args: unknown) => {
          lastArgs = args;
          return query;
        },
      },
    },
  },
}));

function item(p: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    kind: "deadline", severity: "approaching", title: "Tidsfrist", detail: "d",
    matterId: "m1", matterNumber: "2026-0001", at: "2026-09-08",
    amountOre: null, href: "/matters/m1", ...p,
  };
}

const todayIso = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

beforeEach(() => {
  vi.clearAllMocks();
  query.data = { items: [] };
  query.isLoading = false;
  lastArgs = null;
});

describe("Att bevaka-sidan", () => {
  it("visar rubriken", () => {
    render(<WatchlistPage />);
    expect(screen.getByRole("heading", { name: /Att bevaka/i })).toBeInTheDocument();
  });

  it("säger ifrån när ingenting behöver uppmärksamhet", () => {
    render(<WatchlistPage />);
    expect(screen.getByText(/Inget behöver din uppmärksamhet/i)).toBeInTheDocument();
  });

  // Antalet passerade är det som avgör om man behöver agera NU.
  it("räknar poster och hur många som passerat", () => {
    query.data = { items: [item({ severity: "passed" }), item(), item()] };
    render(<WatchlistPage />);
    expect(screen.getByText(/3 poster, varav 1 redan passerade/)).toBeInTheDocument();
  });

  it("frågar efter bara egna ärenden som default", () => {
    render(<WatchlistPage />);
    expect(lastArgs).toEqual({ mine: true });
  });

  it("frågar org-brett när kryssrutan slås av", () => {
    render(<WatchlistPage />);
    fireEvent.click(screen.getByLabelText(/Bara mina ärenden/i));
    expect(lastArgs).toEqual({ mine: false });
  });

  it("filtrerar på signaltyp", () => {
    query.data = { items: [item({ kind: "deadline" }), item({ kind: "unbilled", title: "Bör faktureras" })] };
    render(<WatchlistPage />);
    fireEvent.click(screen.getByRole("button", { name: "Ofakturerat" }));
    expect(screen.getByText("Bör faktureras")).toBeInTheDocument();
    expect(screen.queryByText("Tidsfrist")).not.toBeInTheDocument();
  });

  it("markerar valt filter för skärmläsare", () => {
    render(<WatchlistPage />);
    fireEvent.click(screen.getByRole("button", { name: "Tidsfrister" }));
    expect(screen.getByRole("button", { name: "Tidsfrister" })).toHaveAttribute("aria-pressed", "true");
  });

  // #1065: rubriken räknade filtrerade poster → sidan påstod "inget behöver
  // din uppmärksamhet" så fort man filtrerade till en tom kategori, medan
  // något annat brann.
  it("räknar ALLA poster i rubriken, inte de filtrerade", () => {
    query.data = { items: [item({ kind: "deadline", severity: "passed" })] };
    render(<WatchlistPage />);
    fireEvent.click(screen.getByRole("button", { name: "Ofakturerat" }));
    expect(screen.getByText(/1 poster, varav 1 redan passerade/)).toBeInTheDocument();
    expect(screen.queryByText(/Inget behöver din uppmärksamhet/i)).not.toBeInTheDocument();
  });

  it("säger till när kategorin är tom i st.f. att se trasig ut", () => {
    query.data = { items: [item({ kind: "deadline" })] };
    render(<WatchlistPage />);
    fireEvent.click(screen.getByRole("button", { name: "Ofakturerat" }));
    expect(screen.getByText(/Inget att bevaka i den kategorin/i)).toBeInTheDocument();
  });

  it("visar hämtningsläge", () => {
    query.data = undefined;
    query.isLoading = true;
    render(<WatchlistPage />);
    expect(screen.getByText("Hämtar…")).toBeInTheDocument();
  });

  it("frist på själva dagen: röd med 'FRIST IDAG' och stor fet rubrik (#1167)", () => {
    query.data = { items: [item({ severity: "approaching", title: "Tidsfrist idag: Svaromål", at: todayIso() })] };
    render(<WatchlistPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("FRIST IDAG");
    expect(screen.getByText("Tidsfrist idag: Svaromål").className).toContain("font-extrabold");
  });

  it("tidsfrist med uppgift kan bockas av direkt i listan; andra signaler har ingen kryssruta", () => {
    query.data = { items: [item({ taskId: "t1", title: "Frist A" }), item({ kind: "unbilled", title: "Ofakturerat" })] };
    render(<WatchlistPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera klar: Frist A" }));
    expect(completeMutate).toHaveBeenCalledWith({ id: "t1" });
    expect(screen.queryByRole("checkbox", { name: /Ofakturerat/ })).not.toBeInTheDocument();
  });

  it("ny bevakning: titel + datum krävs, skapas som uppgift med datumet (lokal midnatt)", () => {
    render(<WatchlistPage />);
    const add = screen.getByRole("button", { name: "Lägg till" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Ny bevakning"), { target: { value: "Ring klienten" } });
    expect(add.disabled).toBe(true); // datum saknas
    fireEvent.change(screen.getByLabelText("Bevakningsdatum"), { target: { value: "2026-10-02" } });
    fireEvent.click(add);
    expect(createMutate).toHaveBeenCalledWith({ title: "Ring klienten", dueAt: new Date("2026-10-02T00:00:00") });
  });
});
