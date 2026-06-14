/**
 * Tester för `UserPicker` + `loadSelectedUserIds`.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { UserPicker, loadSelectedUserIds } from "@/app/calendar/_user-picker";

const usersQuery = {
  data: { users: [
    { id: "current-user", name: "Anna Advokat", role: "ADMIN" },
    { id: "u-bjorn", name: "Björn Bauer", role: "LAWYER" },
    { id: "u-cecilia", name: "Cecilia Carlsson", role: "LAWYER" },
  ] } as { users: Array<{ id: string; name: string; role: string }> },
  isLoading: false,
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    user: { list: { useQuery: () => usersQuery } },
  },
}));

beforeEach(() => {
  localStorage.clear();
});

describe("UserPicker", () => {
  it("listar alla användare från trpc.user.list", () => {
    render(<UserPicker selectedUserIds={["current-user"]} onChange={() => {}} />);
    expect(screen.getByText("Anna Advokat")).toBeInTheDocument();
    expect(screen.getByText("Björn Bauer")).toBeInTheDocument();
    expect(screen.getByText("Cecilia Carlsson")).toBeInTheDocument();
  });

  it("ADMIN-badge visas för ADMIN-användare", () => {
    render(<UserPicker selectedUserIds={[]} onChange={() => {}} />);
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
  });

  it("klick togglar markering", () => {
    const onChange = vi.fn();
    render(<UserPicker selectedUserIds={["current-user"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Björn Bauer/i }));
    expect(onChange).toHaveBeenCalledWith(["current-user", "u-bjorn"]);
  });

  it("klick på redan-markerad avmarkerar", () => {
    const onChange = vi.fn();
    render(<UserPicker selectedUserIds={["current-user", "u-bjorn"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Björn Bauer/i }));
    expect(onChange).toHaveBeenCalledWith(["current-user"]);
  });

  it("enforceAtLeastOne hindrar avmarkering av siste användaren", () => {
    const onChange = vi.fn();
    render(<UserPicker selectedUserIds={["current-user"]} onChange={onChange} enforceAtLeastOne />);
    fireEvent.click(screen.getByRole("button", { name: /Anna Advokat/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aria-pressed reflekterar selected-state (a11y)", () => {
    render(<UserPicker selectedUserIds={["u-bjorn"]} onChange={() => {}} />);
    const annaBtn = screen.getByRole("button", { name: /Anna Advokat/i });
    const bjornBtn = screen.getByRole("button", { name: /Björn Bauer/i });
    expect(annaBtn).toHaveAttribute("aria-pressed", "false");
    expect(bjornBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("persistar val i localStorage", () => {
    render(<UserPicker selectedUserIds={["current-user", "u-bjorn"]} onChange={() => {}} />);
    expect(JSON.parse(localStorage.getItem("ava.calendar.selectedUsers")!)).toEqual([
      "current-user", "u-bjorn",
    ]);
  });
});

describe("loadSelectedUserIds", () => {
  it("returnerar tom array när inget är sparat", () => {
    expect(loadSelectedUserIds()).toEqual([]);
  });

  it("läser tillbaka sparat val", () => {
    localStorage.setItem("ava.calendar.selectedUsers", JSON.stringify(["a", "b"]));
    expect(loadSelectedUserIds()).toEqual(["a", "b"]);
  });

  it("ignorerar korrupt JSON och returnerar tom", () => {
    localStorage.setItem("ava.calendar.selectedUsers", "{not-json");
    expect(loadSelectedUserIds()).toEqual([]);
  });

  it("filtrerar bort icke-strängar", () => {
    localStorage.setItem("ava.calendar.selectedUsers", JSON.stringify(["ok", 42, null, "also-ok"]));
    expect(loadSelectedUserIds()).toEqual(["ok", "also-ok"]);
  });
});
