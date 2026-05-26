/**
 * Test för NewUserPage — formulär för att skapa användare.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
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
    fireEvent.change(inputs[0], { target: { value: "Anna" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "anna@x.se" } });
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "abc123" } });
    fireEvent.change(passwordInputs[1], { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(screen.getByText(/matchar inte/i)).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("anropar create-mutation med formdata vid submit", () => {
    const { container } = render(<NewUserPage />);
    fireEvent.change(container.querySelectorAll("input")[0], { target: { value: "Anna" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "anna@x.se" } });
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwordInputs[0], { target: { value: "secret" } });
    fireEvent.change(passwordInputs[1], { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      name: "Anna",
      email: "anna@x.se",
      role: "LAWYER",
      password: "secret",
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
    fireEvent.change(container.querySelectorAll("input")[0], { target: { value: "B" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "b@x.se" } });
    const role = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(role, { target: { value: "ADMIN" } });
    const passwords = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0], { target: { value: "pp" } });
    fireEvent.change(passwords[1], { target: { value: "pp" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    expect(createMutate.mock.calls[0][0].role).toBe("ADMIN");
  });

  it("ändrar timtaxa och milersättning", () => {
    const { container } = render(<NewUserPage />);
    const numberInputs = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numberInputs[0], { target: { value: "3500" } });
    fireEvent.change(numberInputs[1], { target: { value: "3.50" } });
    fireEvent.change(container.querySelectorAll("input")[0], { target: { value: "X" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "x@x.se" } });
    const passwords = container.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0], { target: { value: "pp" } });
    fireEvent.change(passwords[1], { target: { value: "pp" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa användare/i }));
    const arg = createMutate.mock.calls[0][0];
    expect(arg.hourlyRate).toBe(3500);
  });
});
