/**
 * Test för milersättningen i ärendets utläggssektion (#1529): knappen öppnar
 * formuläret, kr/mil förifylls från juristens profil (öre/km → kr/mil), ett
 * ändrat belopp gäller bara resan, och sparat utlägg får rätt payload.
 */

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ExpenseSection } from "@/app/matters/[id]/_expense-section";
import { MileageForm } from "@/app/matters/[id]/_mileage-form";
import { asId } from "@/lib/shared/schemas/ids";
import { callsTo, renderWithFakeTrpc, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import type { TrpcHandlers } from "../../../helpers/trpc-fake";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

let mileageRate: number | null = 250;
let view: FakeTrpcRender | undefined;

const handlers: TrpcHandlers = {
  "user.current": () => ({ id: "u1", mileageRate }),
  "expense.list": () => ({ expenses: [], totalAmount: 0 }),
  "expense.create": () => ({ id: "e-ny" }),
  "prefs.get": () => null,
};

beforeEach(() => {
  mileageRate = 250;
  view = undefined;
});

/** Anropen till `expense.create` (indata). */
function created(): unknown[] {
  return view ? callsTo(view.fake, "expense.create") : [];
}

/** Öppnar formuläret när juristens milersättning har lästs in. */
async function openMileage(): Promise<void> {
  const rendered = renderWithFakeTrpc(<ExpenseSection matterId={asId<"MatterId">("m1")} />, handlers);
  view = rendered;
  fireEvent.click(screen.getByText("+ Milersättning"));
  await waitFor(() => expect(callsTo(rendered.fake, "user.current")).toHaveLength(1));
  await waitFor(() => expect(screen.getByLabelText("Kr/mil *")).toHaveValue(mileageRate === null ? "" : String(mileageRate / 10)));
}

function fillTrip(mil: string): void {
  fireEvent.change(screen.getByLabelText("Datum *"), { target: { value: "2026-03-15" } });
  fireEvent.change(screen.getByLabelText("Från *"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Till *"), { target: { value: "B" } });
  fireEvent.change(screen.getByLabelText("Antal mil *"), { target: { value: mil } });
}

describe("Milersättning i ExpenseSection", () => {
  it("'+ Milersättning' öppnar formuläret med resans fält", async () => {
    await openMileage();
    expect(screen.getByRole("dialog", { name: "Milersättning" })).toBeInTheDocument();
    for (const label of ["Datum *", "Från *", "Till *", "Antal mil *", "Kr/mil *"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("förifyller kr/mil ur juristens milersättning (250 öre/km → 25 kr/mil)", async () => {
    await openMileage();
    expect(screen.getByLabelText("Kr/mil *")).toHaveValue("25");
  });

  it("lämnar kr/mil tomt när juristen saknar belopp, och Spara är spärrat", async () => {
    mileageRate = null;
    await openMileage();
    fillTrip("3,5");
    expect(screen.getByLabelText("Kr/mil *")).toHaveValue("");
    expect(screen.getByText("Spara")).toBeDisabled();
  });

  it("visar summa och debitering exkl./moms/inkl. och sparar ett debiterbart utlägg", async () => {
    await openMileage();
    fillTrip("3,5");
    expect(screen.getByText(/Summa:/)).toHaveTextContent(/87,50/);
    expect(screen.getByText(/Debiteras:/)).toHaveTextContent(/87,50.*moms 25 %:.*21,88.*inkl:.*109,38/);
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(created()).toEqual([{
      matterId: "m1", date: "2026-03-15", amount: 8750,
      description: "Milersättning A – B, 3,5 mil à 25 kr",
      billable: true, vatRate: 0, vatIncluded: false, passThrough: false,
    }]));
  });

  it("ett ändrat kr/mil används för resan", async () => {
    await openMileage();
    fillTrip("2");
    fireEvent.change(screen.getByLabelText("Kr/mil *"), { target: { value: "18,5" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(created()).toEqual([
      expect.objectContaining({ amount: 3700, description: "Milersättning A – B, 2 mil à 18,5 kr" }),
    ]));
  });

  it("Avbryt stänger formuläret utan att spara", async () => {
    await openMileage();
    fireEvent.click(screen.getByText("Avbryt"));
    expect(screen.queryByRole("dialog", { name: "Milersättning" })).not.toBeInTheDocument();
    expect(created()).toEqual([]);
  });
});

describe("MileageForm", () => {
  it("skickar inget när resan är ofullständig", () => {
    const onSubmit = vi.fn();
    renderWithFakeTrpc(<MileageForm isPending={false} onSubmit={onSubmit} onCancel={vi.fn()} />, handlers);
    fireEvent.submit(screen.getByLabelText("Från *").closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Förhandsvisning")).toBeInTheDocument();
  });

  it("visar Sparar... medan utlägget sparas", () => {
    renderWithFakeTrpc(<MileageForm isPending onSubmit={vi.fn()} onCancel={vi.fn()} />, handlers);
    expect(screen.getByText("Sparar...")).toBeDisabled();
  });
});
