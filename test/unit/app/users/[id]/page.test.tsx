/**
 * Test för EditUserPage — laddar användare, sparar, tar bort.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Suspense } from "react";
import EditUserPage from "@/app/users/[id]/page";

const routerPush = vi.fn();
const utilsMock = {
  user: {
    list: { invalidate: vi.fn() },
    getById: { invalidate: vi.fn() },
  },
};
const userQuery = {
  data: undefined as null | Record<string, unknown> | undefined,
  isLoading: false,
  error: null as null | { message: string },
};
const updateMutate = vi.fn();
const updateState = { isPending: false, error: null as null | { message: string } };
const deleteMutate = vi.fn();
const deleteState = { isPending: false };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    user: {
      getById: { useQuery: () => userQuery },
      update: {
        useMutation: () => ({
          mutate: updateMutate,
          isPending: updateState.isPending,
          error: updateState.error,
        }),
      },
      delete: {
        useMutation: () => ({ mutate: deleteMutate, isPending: deleteState.isPending }),
      },
    },
  },
}));

// React's `use()` can read a thenable synchronously if it has a `status: "fulfilled"`
// field with a `value`. This dodges Suspense in unit tests.
function fulfilled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

function renderPage() {
  return render(
    <Suspense fallback={<div>loading-suspense</div>}>
      <EditUserPage params={fulfilled({ id: "u1" })} />
    </Suspense>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  userQuery.data = {
    id: "u1",
    name: "Anna",
    title: "Advokat",
    email: "anna@x.se",
    role: "LAWYER",
    hourlyRate: 2500,
    mileageRate: 2500,
  };
  userQuery.isLoading = false;
  userQuery.error = null;
  updateState.isPending = false;
  updateState.error = null;
  deleteState.isPending = false;
});

describe("EditUserPage", () => {
  it("visar laddartext under fetch", async () => {
    userQuery.isLoading = true;
    userQuery.data = undefined;
    renderPage();
    expect(await screen.findByText(/Laddar/i)).toBeInTheDocument();
  });

  it("visar fel om query misslyckas", async () => {
    userQuery.isLoading = false;
    userQuery.data = undefined;
    userQuery.error = { message: "Kunde inte hämta" };
    renderPage();
    expect(await screen.findByText(/Kunde inte hämta/i)).toBeInTheDocument();
  });

  it("renderar formulär med användardata", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /Redigera användare/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Anna")).toBeInTheDocument();
    expect(screen.getByDisplayValue("anna@x.se")).toBeInTheDocument();
  });

  it("submit anropar updateUser.mutate", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toMatchObject({
      id: "u1",
      name: "Anna",
      email: "anna@x.se",
      role: "LAWYER",
    });
  });

  it("delete-knapp anropar deleteUser efter bekräftelse", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    fireEvent.click(screen.getByRole("button", { name: /^Ta bort$/i }));
    expect(deleteMutate).toHaveBeenCalledWith({ id: "u1" });
    confirmSpy.mockRestore();
  });

  it("visar fel om nytt lösenord inte matchar", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "abc" } });
    fireEvent.change(passwordInputs[1], { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(screen.getByText(/matchar inte/i)).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("ändrar roll och timtaxa, submittar med nya värden", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    const roleSelect = screen.getByRole("combobox") as HTMLSelectElement;
    expect(roleSelect.value).toBe("LAWYER");
    fireEvent.change(roleSelect, { target: { value: "ADMIN" } });
    const hourlyInput = screen.getByDisplayValue("2500") as HTMLInputElement;
    fireEvent.change(hourlyInput, { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    const arg = updateMutate.mock.calls[0][0];
    expect(arg.role).toBe("ADMIN");
    expect(arg.hourlyRate).toBe(3000);
  });

  it("inkluderar lösenord i submit när matchande", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "samelpass" } });
    fireEvent.change(passwordInputs[1], { target: { value: "samelpass" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate.mock.calls[0][0].password).toBe("samelpass");
  });

  it("delete avbryts när confirm ger false", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    fireEvent.click(screen.getByRole("button", { name: /^Ta bort$/i }));
    expect(deleteMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("visar updateError när satt", async () => {
    updateState.error = { message: "Internt fel" };
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    expect(screen.getByText(/Internt fel/)).toBeInTheDocument();
  });
});
