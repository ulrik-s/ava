/**
 * Test för EditUserPage — laddar användare, sparar, tar bort.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import EditUserClient from "@/app/users/[id]/_edit-client";

// Vi testar klient-komponenten direkt. Den async server-wrappern (page.tsx)
// går inte att rendera i jsdom ("async Client Component"-fel) och gör bara
// `await params → <EditUserClient id>`.
vi.mock("@/lib/client/demo/use-route-id", () => ({ useRouteId: () => "u1" }));

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
    organization: {
      getSettings: { useQuery: () => ({ data: { hourlyRates: { ARBETE: 200000, TIDSSPILLAN: 148700 } } }) },
    },
  },
}));

function renderPage() {
  return render(<EditUserClient id="u1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Lösenordsfälten finns bara utan OIDC (#1109) → dessa tester gäller demon.
  localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo" }));
  userQuery.data = {
    id: "u1",
    name: "Anna",
    title: "Advokat",
    email: "anna@x.se",
    role: "LAWYER",
    hourlyRates: { ARBETE: 250000 }, // öre = 2 500 kr/h
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
    expect(updateMutate.mock.calls[0]![0]).toMatchObject({
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
    fireEvent.change(passwordInputs[0]!, { target: { value: "abc" } });
    fireEvent.change(passwordInputs[1]!, { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(screen.getByText(/matchar inte/i)).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("ändrar roll och timpriser, submittar med nya värden", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    const roleSelect = screen.getByRole("combobox") as HTMLSelectElement;
    expect(roleSelect.value).toBe("LAWYER");
    fireEvent.change(roleSelect, { target: { value: "ADMIN" } });
    const hourlyInput = screen.getByDisplayValue("2500") as HTMLInputElement;
    fireEvent.change(hourlyInput, { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText(/^Tidsspillan helg\/kväll/), { target: { value: "975" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    const arg = updateMutate.mock.calls[0]![0];
    expect(arg.role).toBe("ADMIN");
    // kr/h lagras i öre, som tidsposterna (#1206: en karta per kategori).
    expect(arg.hourlyRates).toEqual({ ARBETE: 300000, TIDSSPILLAN_OVRIG_TID: 97500 });
  });

  it("tomma timprisfält visar vad som ärvs från byrån (#1206)", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    // Byråns tidsspillan går före juristens eget timarvode …
    expect((screen.getByLabelText(/^Tidsspillan \(kr/) as HTMLInputElement).placeholder).toMatch(/^ärvs: 1\s487 kr\/h$/);
    // … men utan byråpris ärvs juristens timarvode.
    expect((screen.getByLabelText(/^Timarvode helg\/kväll/) as HTMLInputElement).placeholder).toMatch(/^ärvs: 2\s500 kr\/h$/);
  });

  it("inkluderar lösenord i submit när matchande", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Redigera användare/i });
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0]!, { target: { value: "samelpass" } });
    fireEvent.change(passwordInputs[1]!, { target: { value: "samelpass" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate.mock.calls[0]![0].password).toBe("samelpass");
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
