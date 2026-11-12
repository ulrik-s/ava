/**
 * Test för milersättningen i ärendets utläggssektion (#1529): knappen öppnar
 * formuläret, kr/mil förifylls från juristens profil (öre/km → kr/mil), ett
 * ändrat belopp gäller bara resan, och sparat utlägg får rätt payload.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ExpenseSection } from "@/app/matters/[id]/_expense-section";
import { MileageForm } from "@/app/matters/[id]/_mileage-form";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const user: { data: { id: string; mileageRate: number | null } } = { data: { id: "u1", mileageRate: 250 } };
const createMutate = vi.fn();
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ expense: { list: { invalidate: vi.fn() } } }),
    expense: {
      list: { useQuery: () => ({ data: { expenses: [], totalAmount: 0 }, isLoading: false }) },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      update: { useMutation: noopMut },
      delete: { useMutation: noopMut },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: noopMut },
      clear: { useMutation: noopMut },
      setOrgDefault: { useMutation: noopMut },
      clearOrgDefault: { useMutation: noopMut },
    },
    user: { current: { useQuery: () => user } },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.data = { id: "u1", mileageRate: 250 };
});

function openMileage(): void {
  render(<ExpenseSection matterId={asId<"MatterId">("m1")} />);
  fireEvent.click(screen.getByText("+ Milersättning"));
}

function fillTrip(mil: string): void {
  fireEvent.change(screen.getByLabelText("Datum *"), { target: { value: "2026-03-15" } });
  fireEvent.change(screen.getByLabelText("Från *"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Till *"), { target: { value: "B" } });
  fireEvent.change(screen.getByLabelText("Antal mil *"), { target: { value: mil } });
}

describe("Milersättning i ExpenseSection", () => {
  it("'+ Milersättning' öppnar formuläret med resans fält", () => {
    openMileage();
    expect(screen.getByRole("dialog", { name: "Milersättning" })).toBeInTheDocument();
    for (const label of ["Datum *", "Från *", "Till *", "Antal mil *", "Kr/mil *"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("förifyller kr/mil ur juristens milersättning (250 öre/km → 25 kr/mil)", () => {
    openMileage();
    expect(screen.getByLabelText("Kr/mil *")).toHaveValue("25");
  });

  it("lämnar kr/mil tomt när juristen saknar belopp, och Spara är spärrat", () => {
    user.data = { id: "u1", mileageRate: null };
    openMileage();
    fillTrip("3,5");
    expect(screen.getByLabelText("Kr/mil *")).toHaveValue("");
    expect(screen.getByText("Spara")).toBeDisabled();
  });

  it("visar summa och debitering exkl./moms/inkl. och sparar ett debiterbart utlägg", () => {
    openMileage();
    fillTrip("3,5");
    expect(screen.getByText(/Summa:/)).toHaveTextContent(/87,50/);
    expect(screen.getByText(/Debiteras:/)).toHaveTextContent(/87,50.*moms 25 %:.*21,88.*inkl:.*109,38/);
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith({
      matterId: "m1", date: "2026-03-15", amount: 8750,
      description: "Milersättning A – B, 3,5 mil à 25 kr",
      billable: true, vatRate: 0, vatIncluded: false, passThrough: false,
    });
  });

  it("ett ändrat kr/mil används för resan", () => {
    openMileage();
    fillTrip("2");
    fireEvent.change(screen.getByLabelText("Kr/mil *"), { target: { value: "18,5" } });
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3700, description: "Milersättning A – B, 2 mil à 18,5 kr" }),
    );
  });

  it("Avbryt stänger formuläret utan att spara", () => {
    openMileage();
    fireEvent.click(screen.getByText("Avbryt"));
    expect(screen.queryByRole("dialog", { name: "Milersättning" })).not.toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });
});

describe("MileageForm", () => {
  it("skickar inget när resan är ofullständig", () => {
    const onSubmit = vi.fn();
    render(<MileageForm isPending={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.submit(screen.getByLabelText("Från *").closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Förhandsvisning")).toBeInTheDocument();
  });

  it("visar Sparar... medan utlägget sparas", () => {
    render(<MileageForm isPending onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Sparar...")).toBeDisabled();
  });
});
