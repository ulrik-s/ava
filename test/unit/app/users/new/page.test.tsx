/**
 * Test för NewUserPage — formulär för att skapa användare.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import NewUserPage from "@/app/users/new/page";

const routerPush = vi.fn();
const utilsMock = { user: { list: { invalidate: vi.fn() } } };
const createMutate = vi.fn();
const createState = { isPending: false, error: null as null | { message: string } };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    user: {
      create: {
        useMutation: () => ({
          mutate: createMutate,
          isPending: createState.isPending,
          error: createState.error,
        }),
      },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Lösenordsfälten finns bara utan OIDC (#1109) → dessa tester gäller demon.
  localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo" }));
  createState.isPending = false;
  createState.error = null;
});

describe("NewUserPage", () => {
  it("renderar rubrik och formulär", () => {
    render(<NewUserPage />);
    expect(screen.getByRole("heading", { name: /Ny användare/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skapa användare/i })).toBeInTheDocument();
  });

  it("visar fel om lösenorden inte matchar", () => {
    const { container } = render(<NewUserPage />);
    const inputs = container.querySelectorAll("input");
    // name, title, email, hourlyRate, mileageRate, password, confirm
    fireEvent.change(inputs[0]!, { target: { value: "Anna" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "anna@x.se" } });
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0]!, { target: { value: "abc123" } });
    fireEvent.change(passwordInputs[1]!, { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(screen.getByText(/matchar inte/i)).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("anropar create-mutation med formdata vid submit", () => {
    const { container } = render(<NewUserPage />);
    fireEvent.change(container.querySelectorAll("input")[0]!, { target: { value: "Anna" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "anna@x.se" } });
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0]!, { target: { value: "secret" } });
    fireEvent.change(passwordInputs[1]!, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({
      name: "Anna",
      email: "anna@x.se",
      role: "LAWYER",
      password: "secret",
      hourlyRates: {}, // inga egna priser → ärver byråns
    });
  });

  it("visar 'Sparar...' när mutation pending", () => {
    createState.isPending = true;
    render(<NewUserPage />);
    expect(screen.getByRole("button", { name: /Sparar/i })).toBeDisabled();
  });

  it("visar felmeddelande från servern", () => {
    createState.error = { message: "E-post finns redan" };
    render(<NewUserPage />);
    expect(screen.getByText("E-post finns redan")).toBeInTheDocument();
  });

  it("byter roll till ADMIN och submittar", () => {
    const { container } = render(<NewUserPage />);
    fireEvent.change(container.querySelectorAll("input")[0]!, { target: { value: "B" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "b@x.se" } });
    const role = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(role, { target: { value: "ADMIN" } });
    const passwords = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0]!, { target: { value: "pp" } });
    fireEvent.change(passwords[1]!, { target: { value: "pp" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(createMutate.mock.calls[0]![0].role).toBe("ADMIN");
  });

  it("ändrar timpriser och milersättning", () => {
    const { container } = render(<NewUserPage />);
    fireEvent.change(screen.getByLabelText(/^Timarvode \(kr/), { target: { value: "3500" } });
    fireEvent.change(screen.getByLabelText(/^Tidsspillan \(kr/), { target: { value: "1487" } });
    fireEvent.change(screen.getByLabelText(/Milersättning/), { target: { value: "3.50" } });
    fireEvent.change(container.querySelectorAll("input")[0]!, { target: { value: "X" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "x@x.se" } });
    const passwords = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0]!, { target: { value: "pp" } });
    fireEvent.change(passwords[1]!, { target: { value: "pp" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    const arg = createMutate.mock.calls[0]![0];
    // kr/h lagras i öre, som tidsposterna — en karta per kategori (#1206).
    expect(arg.hourlyRates).toEqual({ ARBETE: 350000, TIDSSPILLAN: 148700 });
    expect(arg.mileageRate).toBe(350);
  });
});

describe("NewUserPage — OIDC (#1109)", () => {
  beforeEach(() => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "self-hosted" }));
  });

  it("visar inga lösenordsfält — inloggning sker hos IdP:n", () => {
    const { container } = render(<NewUserPage />);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it("skapar användare med bara namn + e-post, utan lösenord", () => {
    const { container } = render(<NewUserPage />);
    fireEvent.change(container.querySelectorAll("input")[0]!, { target: { value: "Cecilia" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "cecilia@byra.se" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    const arg = createMutate.mock.calls[0]![0];
    expect(arg).toMatchObject({ name: "Cecilia", email: "cecilia@byra.se" });
    expect(arg.password).toBeUndefined();
  });
});
