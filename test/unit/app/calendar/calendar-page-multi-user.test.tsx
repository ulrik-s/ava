/**
 * Regression: när användaren togglar markerade userIds i UserPicker
 * måste CalendarGrid/DayView:s trpc-query refetcha med nya input.
 *
 * Vi mockar trpc-hooks och verifierar att `useQuery` får uppdaterade
 * userIds när picker-klicket propageras.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CalendarPage from "@/app/calendar/page";

const listForUsersCalls: Array<{ userIds: string[] }> = [];
const calendarListCalls: number[] = [];

const currentUser = {
  data: { id: "current-user", name: "Anna", role: "ADMIN" } as { id: string; name: string; role: string } | undefined,
};
const orgUsers = {
  data: { users: [
    { id: "current-user", name: "Anna Advokat", role: "ADMIN" },
    { id: "u-bjorn", name: "Björn Bauer", role: "LAWYER" },
  ] } as { users: Array<{ id: string; name: string; role: string }> } | undefined,
  isLoading: false,
};

vi.mock("@/lib/client/trpc", () => {
  return {
    trpc: {
      useUtils: () => ({
        calendar: { list: { invalidate: vi.fn() } },
        task: { list: { invalidate: vi.fn() } },
      }),
      user: {
        current: { useQuery: () => currentUser },
        list: { useQuery: () => orgUsers },
      },
      // kontakter kan bjudas in till events (tillagt denna session)
      contacts: {
        list: { useQuery: () => ({ data: { contacts: [] } }) },
      },
      calendar: {
        list: {
          useQuery: () => {
            calendarListCalls.push(Date.now());
            return { data: [], isLoading: false };
          },
        },
        listForUsers: {
          useQuery: (input: { userIds: string[] }) => {
            listForUsersCalls.push({ userIds: [...input.userIds] });
            return { data: [], isLoading: false };
          },
        },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      task: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        complete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});

beforeEach(() => {
  listForUsersCalls.length = 0;
  calendarListCalls.length = 0;
  localStorage.clear();
});

describe("CalendarPage multi-user toggle", () => {
  it("default = current-user är markerad och listForUsers körs med userIds=[current-user]", async () => {
    render(<CalendarPage />);
    await waitFor(() => {
      const last = listForUsersCalls[listForUsersCalls.length - 1];
      expect(last?.userIds).toEqual(["current-user"]);
    });
  });

  it("klick på Björn lägger till honom i userIds → listForUsers körs igen med båda", async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(listForUsersCalls.length).toBeGreaterThan(0));

    // Klicka in Björn
    fireEvent.click(screen.getByRole("button", { name: /Björn Bauer/i }));

    await waitFor(() => {
      const last = listForUsersCalls[listForUsersCalls.length - 1];
      expect(last?.userIds.sort()).toEqual(["current-user", "u-bjorn"]);
    });
  });

  it("klick på redan-markerad användare tar bort den (men inte siste pga enforceAtLeastOne)", async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(listForUsersCalls.length).toBeGreaterThan(0));

    // Lägg till Björn
    fireEvent.click(screen.getByRole("button", { name: /Björn Bauer/i }));
    await waitFor(() => {
      expect(listForUsersCalls[listForUsersCalls.length - 1]?.userIds).toContain("u-bjorn");
    });

    // Ta bort Björn (vänster en kvar = current-user)
    fireEvent.click(screen.getByRole("button", { name: /Björn Bauer/i }));
    await waitFor(() => {
      expect(listForUsersCalls[listForUsersCalls.length - 1]?.userIds).toEqual(["current-user"]);
    });
  });
});
