import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { LedgerAccountsSection } from "@/components/settings/ledger-accounts-section";
import { callsTo, renderWithFakeTrpc, settled, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths } from "../../../helpers/trpc-fake";

const state = { role: "ADMIN" as string };

/** Renderar sektionen (ingen sparad mappning) och väntar tills frågorna svarat. */
async function renderSection(): Promise<FakeTrpcRender> {
  const view = renderWithFakeTrpc(<LedgerAccountsSection />, {
    "user.current": () => ({ role: state.role }),
    "organization.getSettings": () => ({ ledgerAccountMap: null }),
    "organization.updateSettings": () => ({}),
  });
  await settled(view);
  return view;
}

/** Indata till `organization.updateSettings`, i ordning. */
const saves = (view: FakeTrpcRender) => callsTo(view.fake, "organization.updateSettings") as Array<{ ledgerAccountMap: Record<string, { number: string }> }>;

describe("LedgerAccountsSection", () => {
  it("admin: förifyller BAS-default och sparar ändrad mappning", async () => {
    state.role = "ADMIN";
    const view = await renderSection();

    const kundNr = screen.getByLabelText<HTMLInputElement>(/Kundfordran.*kontonummer/);
    expect(kundNr.value).toBe("1510"); // BAS-default förifyllt

    fireEvent.change(kundNr, { target: { value: "1511" } });
    fireEvent.click(screen.getByRole("button", { name: /Spara mappning/ }));

    await waitFor(() => expect(saves(view)).toHaveLength(1));
    expect(saves(view)[0]?.ledgerAccountMap["kundfordran"]?.number).toBe("1511");
    expect(await screen.findByText(/Sparat/)).toBeTruthy();
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toEqual(["organization.getSettings"]));
  });

  it("admin: ogiltigt kontonummer ger valideringsfel utan att spara", async () => {
    state.role = "ADMIN";
    const view = await renderSection();

    const momsNr = screen.getByLabelText<HTMLInputElement>(/Utgående moms.*kontonummer/);
    fireEvent.change(momsNr, { target: { value: "26" } }); // för kort
    fireEvent.click(screen.getByRole("button", { name: /Spara mappning/ }));

    await settled(view);
    expect(saves(view)).toEqual([]);
    expect(screen.getByText(/siffror/)).toBeTruthy();
  });

  it("admin: bankkontot förifylls och ett tömt valfritt konto utelämnas (#1173)", async () => {
    state.role = "ADMIN";
    const view = await renderSection();
    const bankNr = screen.getByLabelText<HTMLInputElement>(/Bank.*kontonummer/);
    expect(bankNr.value).toBe("1930");
    fireEvent.change(bankNr, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Bank.*kontonamn/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Spara mappning/ }));
    await waitFor(() => expect(saves(view)).toHaveLength(1));
    expect(saves(view)[0]?.ledgerAccountMap).not.toHaveProperty("bank");
    expect(saves(view)[0]?.ledgerAccountMap).toHaveProperty("intaktUtlagg");
  });

  it("icke-admin ser bara ett meddelande", async () => {
    state.role = "LAWYER";
    await renderSection();
    expect(screen.getByText(/Endast administratörer/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Spara mappning/ })).toBeNull();
  });
});
