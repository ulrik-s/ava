import { describe, it, expect, vi } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { LedgerAccountsSection } from "@/components/settings/ledger-accounts-section";

const state = { role: "ADMIN" as string };
const mutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ organization: { getSettings: { invalidate: vi.fn() } } }),
    user: { current: { useQuery: () => ({ data: { role: state.role } }) } },
    organization: {
      getSettings: { useQuery: () => ({ data: { ledgerAccountMap: null }, isLoading: false }) },
      updateSettings: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          mutate: (...args: unknown[]) => {
            mutate(...args);
            opts?.onSuccess?.();
          },
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

describe("LedgerAccountsSection", () => {
  it("admin: förifyller BAS-default och sparar ändrad mappning", () => {
    state.role = "ADMIN";
    mutate.mockClear();
    render(<LedgerAccountsSection />);

    const kundNr = screen.getByLabelText(/Kundfordran.*kontonummer/) as HTMLInputElement;
    expect(kundNr.value).toBe("1510"); // BAS-default förifyllt

    fireEvent.change(kundNr, { target: { value: "1511" } });
    fireEvent.click(screen.getByRole("button", { name: /Spara mappning/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0]![0] as { ledgerAccountMap: { kundfordran: { number: string } } };
    expect(arg.ledgerAccountMap.kundfordran.number).toBe("1511");
    expect(screen.getByText(/Sparat/)).toBeTruthy();
  });

  it("admin: ogiltigt kontonummer ger valideringsfel utan att spara", () => {
    state.role = "ADMIN";
    mutate.mockClear();
    render(<LedgerAccountsSection />);

    const momsNr = screen.getByLabelText(/Utgående moms.*kontonummer/) as HTMLInputElement;
    fireEvent.change(momsNr, { target: { value: "26" } }); // för kort
    fireEvent.click(screen.getByRole("button", { name: /Spara mappning/ }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/siffror/)).toBeTruthy();
  });

  it("icke-admin ser bara ett meddelande", () => {
    state.role = "LAWYER";
    render(<LedgerAccountsSection />);
    expect(screen.getByText(/Endast administratörer/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Spara mappning/ })).toBeNull();
  });
});
