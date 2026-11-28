/**
 * `RecordBeslutDialog` (#828, utbruten i #1929): domstolens beslut matas in i
 * kronor och skickas i öre; en prutning skickas alltid som ett negativt belopp.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { RecordBeslutDialog } from "@/app/matters/[id]/_record-beslut-dialog";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider, type FakeTrpcLink } from "../../../helpers/trpc-fake";

const PATH = "billingRun.recordKostnadsrakningBeslut";

/** Dialogen mot en fejkad länk; `fail` gör att anropet ger det felet. */
function renderDialog(fail: string | null = null) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const fake = fakeTrpcLink({
    [PATH]: () => {
      if (fail) throw new Error(fail);
      return { ok: true };
    },
  });
  render(
    <TrpcTestProvider link={fake.link} queryClient={testQueryClient()}>
      <RecordBeslutDialog billingRunId={asId<"BillingRunId">("br-1")} onClose={onClose} onDone={onDone} />
    </TrpcTestProvider>,
  );
  return { fake, onClose, onDone };
}

/** Fyller i beloppen (tom sträng = fältet lämnas tomt) och sparar. */
function submit(awarded: string, prutning: string): void {
  fireEvent.change(screen.getByLabelText("Dömt belopp (kr)"), { target: { value: awarded } });
  if (prutning !== "") fireEvent.change(screen.getByLabelText("Prutning (kr, valfritt)"), { target: { value: prutning } });
  fireEvent.click(screen.getByRole("button", { name: "Spara beslut" }));
}

const inputs = (fake: FakeTrpcLink): unknown[] => fake.calls.filter((c) => c.path === PATH).map((c) => c.input);

describe("RecordBeslutDialog", () => {
  it("utan prutning: dömt belopp i öre, ingen prutning, och dialogen klar och stängd", async () => {
    const { fake, onClose, onDone } = renderDialog();
    submit("1234,56", "");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalled();
    expect(inputs(fake)).toEqual([{ billingRunId: "br-1", awardedOre: 123_456 }]);
  });

  it("med prutning: prutningen skickas negativ i öre, även om den skrivs positiv", async () => {
    const { fake, onClose } = renderDialog();
    submit("1000", "250,5");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(inputs(fake)).toEqual([{ billingRunId: "br-1", awardedOre: 100_000, prutningOre: -25_050 }]);
  });

  it("ett fel visas i dialogen, som står kvar", async () => {
    const { onClose, onDone } = renderDialog("Beslutet kunde inte sparas");
    submit("1000", "");
    expect(await screen.findByText("Beslutet kunde inte sparas")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Avbryt stänger utan att spara", () => {
    const { fake, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(onClose).toHaveBeenCalled();
    expect(inputs(fake)).toEqual([]);
  });
});
