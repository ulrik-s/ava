/**
 * Test för TimePage — listrendering och nytt-tidsregistreringsflöde.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import TimePage from "@/app/time/page";

const timeQuery: {
  data: {
    entries: Array<Record<string, unknown>>;
    total: number;
    pages: number;
    totalMinutes: number;
  };
  isLoading: boolean;
} = {
  data: { entries: [], total: 0, pages: 0, totalMinutes: 0 },
  isLoading: false,
};
const matterQuery: { data: { matters: Array<Record<string, unknown>> } } = {
  data: { matters: [] },
};
const utilsMock = { timeEntry: { list: { invalidate: vi.fn() } }, prefs: { get: { invalidate: vi.fn() } } };
const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
/** Serverfel från update (t.ex. PRECONDITION_FAILED för en fryst post). */
let updateError: { message: string } | null = null;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    timeEntry: {
      list: { useQuery: () => timeQuery },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, error: updateError }) },
      delete: { useMutation: () => ({ mutate: deleteMutate, isPending: false, error: null }) },
    },
    // Byråns standardåtgärder (#956) läses av ändra-formuläret. Tom → ingen väljare.
    organization: { getSettings: { useQuery: () => ({ data: { standardAtgarder: [] } }) } },
    matter: {
      list: { useQuery: () => matterQuery },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: {
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  timeQuery.data = { entries: [], total: 0, pages: 0, totalMinutes: 0 };
  updateError = null;
});

describe("TimePage", () => {
  it("renderar Tidregistrering-rubrik och totalsumma", () => {
    timeQuery.data.totalMinutes = 90;
    render(<TimePage />);
    expect(screen.getByRole("heading", { name: /Tidregistrering/i })).toBeInTheDocument();
    expect(screen.getByText(/1:30/)).toBeInTheDocument();
  });

  it("listar tidsposter", () => {
    timeQuery.data = {
      entries: [
        {
          id: "t1",
          date: new Date("2026-04-15"),
          minutes: 60,
          description: "Möte med klient",
          billable: true,
          user: { id: "u1", name: "Anna" },
          matter: { id: "m1", matterNumber: "2026-0001", title: "X" },
        },
      ],
      total: 1,
      pages: 1,
      totalMinutes: 60,
    };
    render(<TimePage />);
    expect(screen.getByText("Möte med klient")).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
    // Lång beskrivning bryter rad i stället för att rinna in i grannkolumnen (#1197).
    expect(screen.getByText("Möte med klient").closest("td")).toHaveClass("whitespace-normal");
  });

  it("öppnar Ny-form vid klick", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny tidregistrering|\+ Ny|\+ Registrera/i }));
    expect(screen.getByRole("button", { name: /Spara|Skapa/i })).toBeInTheDocument();
  });

  it("submittar formulär med vald matter, beskrivning, minuter", () => {
    matterQuery.data = {
      matters: [{ id: "m1", matterNumber: "2026-0001", title: "Test" }],
    };
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    // MatterCombobox är en sökbar <input>+<datalist> — välj via exakt etikett
    // ("<nr> — <titel>") → komponenten anropar onChange(matterId).
    const matterInput = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(matterInput, { target: { value: "2026-0001 — Test" } });
    const desc = screen.getByLabelText(/Beskrivning/i) as HTMLInputElement;
    fireEvent.change(desc, { target: { value: "Klientmöte" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(createMutate).toHaveBeenCalled();
    const arg = createMutate.mock.calls[0]![0];
    expect(arg.matterId).toBe("m1");
    expect(arg.description).toBe("Klientmöte");
    expect(arg.billable).toBe(true);
  });

  it("togglar debiterbar-checkbox", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("ändrar minuter via text-input (utan spinner, #798)", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const numberInput = screen.getByLabelText(/minuter/i) as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "120" } });
    expect(numberInput.value).toBe("120");
  });

  it("Avbryt stänger formuläret", () => {
    render(<TimePage />);
    const toggle = screen.getByRole("button", { name: /\+ Registrera tid/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /^Spara$/i })).toBeInTheDocument();
    // toggle får nu texten "Avbryt"
    fireEvent.click(screen.getByRole("button", { name: /^Avbryt$/i }));
    expect(screen.queryByRole("button", { name: /^Spara$/i })).not.toBeInTheDocument();
  });

  it("paginering: Nästa ökar sidnumret", () => {
    timeQuery.data = {
      entries: [],
      total: 100,
      pages: 3,
      totalMinutes: 0,
    };
    render(<TimePage />);
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    expect(screen.getByText(/Sida 2 av 3/)).toBeInTheDocument();
  });
});

describe("TimePage — ändra och ta bort", () => {
  const entry = {
    id: "t1", date: "2026-09-20", minutes: 45, description: "Genomgång av avtal",
    billable: true, kind: "ARBETE",
    matter: { id: "m1", matterNumber: "UA2026-0001", title: "Avtalstvist" },
    user: { name: "Cecilia" },
  };
  const withRows = (...entries: Array<Record<string, unknown>>) => {
    timeQuery.data = { entries, total: entries.length, pages: 1, totalMinutes: 45 };
  };

  it("Ändra öppnar formuläret förifyllt; Spara skickar update med postens id", () => {
    withRows(entry);
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: "Ändra" }));
    const dialog = screen.getByRole("dialog", { name: /Ändra tidregistrering/ });
    const description = within(dialog).getByDisplayValue("Genomgång av avtal");
    fireEvent.change(description, { target: { value: "Genomgång av avtal + mejl" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({
      id: "t1", description: "Genomgång av avtal + mejl", minutes: 45, date: "2026-09-20",
    }));
  });

  it("Ta bort frågar först och tar bort vid ja", () => {
    withRows(entry);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteMutate).toHaveBeenCalledWith({ id: "t1" });
    confirmSpy.mockRestore();
  });

  it("Ta bort gör inget om man ångrar sig", () => {
    withRows(entry);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort" }));
    expect(deleteMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("en fryst post (slutfaktura/kostnadsräkning) visas som Låst utan knappar", () => {
    withRows({ ...entry, frozenAt: "2026-09-21" });
    render(<TimePage />);
    expect(screen.getByText("Låst")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ändra" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ta bort" })).not.toBeInTheDocument();
  });

  it("visar serverns fel (t.ex. låst post) för användaren", () => {
    updateError = { message: "Tidposten ingår i en slutfaktura eller kostnadsräkning och kan inte ändras eller tas bort." };
    withRows(entry);
    render(<TimePage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/slutfaktura/);
  });
});
