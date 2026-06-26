/**
 * Test för TimePage — listrendering och nytt-tidsregistreringsflöde.
 */

import { render, screen, fireEvent } from "@testing-library/react";
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

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    timeEntry: {
      list: { useQuery: () => timeQuery },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
    },
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
