/**
 * Test för TimePage — listrendering och nytt-tidsregistreringsflöde.
 */

import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import TimePage from "@/app/time/page";
import { rowOrder, sortColumn } from "../../../helpers/data-table";

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
const moveMutate = vi.fn();
/** Serverfel från flytten (#2042). */
let moveError: { message: string } | null = null;
const deleteMutate = vi.fn();
/** Det listan senast frågades efter: sida och period. */
const listInput = vi.fn((_input: { page: number; from?: Date; to?: Date }) => timeQuery);
/** onSuccess från create/delete — testet anropar dem som servern hade gjort. */
const succeeded: Record<"create" | "remove", (() => void) | undefined> = {
  create: undefined, remove: undefined,
};
type MutationOpts = { onSuccess?: () => void } | undefined;
/** Serverfel från update (t.ex. PRECONDITION_FAILED för en fryst post). */
let updateError: { message: string } | null = null;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    timeEntry: {
      list: { useQuery: (input: { page: number; from?: Date; to?: Date }) => listInput(input) },
      create: {
        useMutation: (opts: MutationOpts) => {
          succeeded.create = opts?.onSuccess;
          return { mutate: createMutate, isPending: false };
        },
      },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, error: updateError }) },
      moveToMatter: { useMutation: () => ({ mutate: moveMutate, isPending: false, error: moveError }) },
      delete: {
        useMutation: (opts: MutationOpts) => {
          succeeded.remove = opts?.onSuccess;
          return { mutate: deleteMutate, isPending: false, error: null };
        },
      },
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
  moveError = null;
});

describe("TimePage", () => {
  it("renderar Tidregistrering-rubrik och totalsumma", () => {
    timeQuery.data.totalMinutes = 90;
    render(<TimePage />);
    expect(screen.getByRole("heading", { name: /Tidregistrering/i })).toBeInTheDocument();
    expect(screen.getByText("Totalt: 1,5 h")).toBeInTheDocument();
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
    const matterInput = screen.getByRole<HTMLInputElement>("combobox");
    fireEvent.change(matterInput, { target: { value: "2026-0001 — Test" } });
    const desc = screen.getByLabelText<HTMLInputElement>(/Beskrivning/i);
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
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox");
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("ändrar tiden i timmar via text-input (utan spinner, #798, #1545)", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const numberInput = screen.getByLabelText<HTMLInputElement>(/Tid \(h\)/);
    fireEvent.change(numberInput, { target: { value: "2,5" } });
    expect(numberInput.value).toBe("2,5");
  });

  it("registrerar 1,5 timmar som 90 minuter; 1,33 ger fel och sparas inte (#1545)", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    const hours = screen.getByLabelText<HTMLInputElement>(/Tid \(h\)/);
    fireEvent.change(hours, { target: { value: "1,33" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ändra värdet");
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(createMutate).not.toHaveBeenCalled();
    fireEvent.change(hours, { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ minutes: 90 }));
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
    billable: true, kind: "ARBETE", matterId: "m1",
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
    }), expect.anything());
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

  it("en post med bara faktura (invoiceId) visas som Låst utan knappar, med serverns lydelse (#1863)", () => {
    withRows({ ...entry, invoiceId: "inv-1" });
    render(<TimePage />);
    expect(screen.getByText("Låst")).toHaveAttribute(
      "title", "Ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort.",
    );
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

describe("TimePage — flytta posten till ett annat ärende (#2042)", () => {
  const entry = {
    id: "t1", date: "2026-09-20", minutes: 45, description: "Genomgång av avtal", billable: true, kind: "ARBETE",
    matterId: "m1", matter: { id: "m1", matterNumber: "UA2026-0001", title: "Avtalstvist" }, user: { name: "Cecilia" },
  };
  type CallOpts = { onSuccess?: () => void } | undefined;
  const succeed = (mutate: ReturnType<typeof vi.fn>) => (mutate.mock.calls.at(-1)?.[1] as CallOpts)?.onSuccess?.();

  beforeEach(() => {
    timeQuery.data = { entries: [entry], total: 1, pages: 1, totalMinutes: 45 };
    matterQuery.data = { matters: [
      { id: "m1", matterNumber: "UA2026-0001", title: "Avtalstvist" },
      { id: "m2", matterNumber: "UA2026-0002", title: "Hyrestvist" },
    ] };
  });

  function openEdit() {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: "Ändra" }));
    return screen.getByRole("dialog", { name: /Ändra tidregistrering/ });
  }

  it("fältet Ärende är förvalt postens ärende; samma ärende ger bara update", () => {
    const dialog = openEdit();
    expect(within(dialog).getByLabelText("Ärende")).toHaveValue("UA2026-0001 — Avtalstvist");
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    act(() => succeed(updateMutate));
    expect(moveMutate).not.toHaveBeenCalled();
    expect(utilsMock.timeEntry.list.invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /Ändra tidregistrering/ })).not.toBeInTheDocument();
  });

  it("ett annat ärende: update och sedan moveToMatter med postens id", () => {
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText("Ärende"), { target: { value: "UA2026-0002 — Hyrestvist" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    act(() => succeed(updateMutate));
    expect(moveMutate).toHaveBeenCalledWith({ ids: ["t1"], matterId: "m2" }, expect.anything());
    act(() => succeed(moveMutate));
    expect(screen.queryByRole("dialog", { name: /Ändra tidregistrering/ })).not.toBeInTheDocument();
  });

  it("ett fel i flytten visas för användaren", () => {
    moveError = { message: "Tidposten ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort." };
    render(<TimePage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/kostnadsräkning/);
  });
});

// ── Kolumnerna, perioden och mutationernas svar (#1904) ─────────────────

/** Tre poster där varje kolumn ger en egen ordning. */
const sortableEntries = (): Array<Record<string, unknown>> => [
  { id: "a", date: "2026-03-01", minutes: 30, description: "Bbb", billable: true,
    matter: { id: "m1", matterNumber: "2026-0002", title: "X" }, user: { name: "Cecilia" } },
  { id: "b", date: "2026-01-01", minutes: 90, description: "Ccc", billable: false,
    matter: { id: "m2", matterNumber: "2026-0003", title: "Y" }, user: null },
  { id: "c", date: "2026-02-01", minutes: 60, description: "Aaa", billable: true,
    matter: { id: "m3", matterNumber: "2026-0001", title: "Z" }, user: { name: "Bo" } },
];
const descriptions = ["Aaa", "Bbb", "Ccc"];

describe("TimePage — kolumnerna sorterar på det som visas (#1904)", () => {
  beforeEach(() => {
    timeQuery.data = { entries: sortableEntries(), total: 3, pages: 1, totalMinutes: 180 };
  });

  it("Datum, Ärende och Advokat", () => {
    render(<TimePage />);
    sortColumn("Datum", "asc");
    expect(rowOrder(descriptions)).toEqual(["Ccc", "Aaa", "Bbb"]);
    sortColumn("Ärende", "asc");
    expect(rowOrder(descriptions)).toEqual(["Aaa", "Bbb", "Ccc"]);
    sortColumn("Advokat", "desc");
    expect(rowOrder(descriptions)).toEqual(["Bbb", "Aaa", "Ccc"]);
  });

  it("Tid, Beskrivning och Deb.", () => {
    render(<TimePage />);
    sortColumn("Tid (h)", "desc");
    expect(rowOrder(descriptions)).toEqual(["Ccc", "Aaa", "Bbb"]);
    sortColumn("Beskrivning", "desc");
    expect(rowOrder(descriptions)).toEqual(["Ccc", "Bbb", "Aaa"]);
    sortColumn("Deb.", "asc");
    expect(rowOrder(descriptions)[0]).toBe("Ccc");
  });

  it("summaraden räknar ihop tiden på raderna", () => {
    render(<TimePage />);
    expect(screen.getByText("3")).toHaveClass("font-mono");
  });
});

describe("TimePage — periodfiltret (#1904)", () => {
  const lastInput = () => listInput.mock.calls.at(-1)?.[0];

  it("Från och Till begränsar listan och går till första sidan; Rensa tar bort perioden", () => {
    timeQuery.data = { entries: [], total: 100, pages: 3, totalMinutes: 0 };
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    expect(lastInput()?.page).toBe(2);
    fireEvent.change(screen.getByLabelText("Från"), { target: { value: "2026-01-01" } });
    expect(lastInput()).toMatchObject({ page: 1, from: new Date("2026-01-01T00:00:00.000") });
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    fireEvent.change(screen.getByLabelText("Till"), { target: { value: "2026-01-31" } });
    expect(lastInput()).toMatchObject({ page: 1, to: new Date("2026-01-31T23:59:59.999") });
    fireEvent.click(screen.getByRole("button", { name: "Rensa" }));
    expect(lastInput()).toMatchObject({ page: 1, from: undefined, to: undefined });
    expect(screen.queryByRole("button", { name: "Rensa" })).toBeNull();
  });

  it("Föregående går tillbaka en sida", () => {
    timeQuery.data = { entries: [], total: 100, pages: 3, totalMinutes: 0 };
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    fireEvent.click(screen.getByRole("button", { name: /Föregående/i }));
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
  });
});

describe("TimePage — registreringens och ändringens svar (#1904)", () => {
  it("datumet i formuläret skickas med", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    fireEvent.change(screen.getByLabelText(/Datum \*/), { target: { value: "2026-05-04" } });
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(/Beskrivning/i), { target: { value: "Möte" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-05-04" }));
  });

  it("när tiden registrerats stängs formuläret, fälten töms och listan laddas om", () => {
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(/Beskrivning/i), { target: { value: "Möte" } });
    act(() => succeeded.create?.());
    expect(utilsMock.timeEntry.list.invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Spara$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    expect(screen.getByLabelText<HTMLInputElement>(/Beskrivning/i).value).toBe("");
  });

  it("när ändringen sparats stängs dialogen och listan laddas om", () => {
    timeQuery.data = { entries: sortableEntries(), total: 3, pages: 1, totalMinutes: 180 };
    render(<TimePage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Ändra" })[0] as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: /Ändra tidregistrering/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    // Ändringen skickar onSuccess med anropet (#2042), inte med hooken.
    act(() => (updateMutate.mock.calls.at(-1)?.[1] as MutationOpts)?.onSuccess?.());
    expect(utilsMock.timeEntry.list.invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /Ändra tidregistrering/ })).toBeNull();
  });

  it("Avbryt i dialogen stänger den utan att spara", () => {
    timeQuery.data = { entries: sortableEntries(), total: 3, pages: 1, totalMinutes: 180 };
    render(<TimePage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Ändra" })[0] as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: /Ändra tidregistrering/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog", { name: /Ändra tidregistrering/ })).toBeNull();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("när posten tagits bort laddas listan om", () => {
    render(<TimePage />);
    act(() => succeeded.remove?.());
    expect(utilsMock.timeEntry.list.invalidate).toHaveBeenCalled();
  });
});
