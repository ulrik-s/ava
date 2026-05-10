/**
 * Test för LoginPage — formulär, error-mappning, signIn-integration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "@/app/login/page";

const signInMock = vi.fn();
const getProvidersMock = vi.fn().mockResolvedValue({});
const pushMock = vi.fn();
const refreshMock = vi.fn();
const searchParamsGet = vi.fn((_: string): string | null => null);

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  getProviders: () => getProvidersMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsGet.mockReturnValue(null);
  getProvidersMock.mockResolvedValue({});
});

describe("LoginPage", () => {
  it("renderar AVA-rubrik och loginformulär", async () => {
    render(<LoginPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "AVA" })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/E-postadress/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Losenord/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Logga in/i })).toBeInTheDocument();
  });

  it("anropar signIn med email + password vid submit", async () => {
    signInMock.mockResolvedValue({ error: null });
    render(<LoginPage />);
    await waitFor(() => screen.getByLabelText(/E-postadress/i));

    fireEvent.change(screen.getByLabelText(/E-postadress/i), {
      target: { value: "test@x.se" },
    });
    fireEvent.change(screen.getByLabelText(/Losenord/i), {
      target: { value: "hemligt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Logga in/i }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        email: "test@x.se",
        password: "hemligt",
        redirect: false,
      }),
    );
  });

  it("visar felmeddelande vid felaktigt login", async () => {
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });
    render(<LoginPage />);
    await waitFor(() => screen.getByLabelText(/E-postadress/i));

    fireEvent.change(screen.getByLabelText(/E-postadress/i), {
      target: { value: "x@y.se" },
    });
    fireEvent.change(screen.getByLabelText(/Losenord/i), {
      target: { value: "fel" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Logga in/i }));

    await waitFor(() =>
      expect(screen.getByText(/Felaktig e-postadress/i)).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("redirectar till callbackUrl efter lyckad login", async () => {
    searchParamsGet.mockImplementation((k: string) =>
      k === "callbackUrl" ? "/matters" : null,
    );
    signInMock.mockResolvedValue({ error: null });
    render(<LoginPage />);
    await waitFor(() => screen.getByLabelText(/E-postadress/i));

    fireEvent.change(screen.getByLabelText(/E-postadress/i), {
      target: { value: "ok@x.se" },
    });
    fireEvent.change(screen.getByLabelText(/Losenord/i), {
      target: { value: "rätt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Logga in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/matters"));
  });

  it("visar OAuth-fel-mappning för WrongTenant", async () => {
    searchParamsGet.mockImplementation((k: string) =>
      k === "error" ? "WrongTenant" : null,
    );
    render(<LoginPage />);
    await waitFor(() =>
      expect(screen.getByText(/inte kopplad till AVA/i)).toBeInTheDocument(),
    );
  });

  it("visar Microsoft-knapp när azure-ad-provider finns", async () => {
    getProvidersMock.mockResolvedValue({ "azure-ad": { id: "azure-ad" } });
    render(<LoginPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Logga in med Microsoft/i }),
      ).toBeInTheDocument(),
    );
  });

  it("döljer Microsoft-knapp när azure-ad-provider saknas", async () => {
    getProvidersMock.mockResolvedValue({});
    render(<LoginPage />);
    await waitFor(() => screen.getByLabelText(/E-postadress/i));
    expect(
      screen.queryByRole("button", { name: /Logga in med Microsoft/i }),
    ).not.toBeInTheDocument();
  });
});
