/**
 * Test för SettingsPage — logo, WebDAV, kontor, kontaktuppgifter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsPage from "@/app/settings/page";

const settingsQuery = {
  data: undefined as null | Record<string, unknown> | undefined,
  isLoading: false,
};
const officesQuery = {
  data: [] as Array<Record<string, unknown>>,
  isLoading: false,
};
const utilsMock = {
  organization: {
    getSettings: { invalidate: vi.fn() },
    listOffices: { invalidate: vi.fn() },
  },
};
const updateSettingsMutate = vi.fn();
const updateSettingsState = { isPending: false, error: null as null | { message: string } };
const addOfficeMutate = vi.fn();
const addOfficeState = { isPending: false };
const updateOfficeMutate = vi.fn();
const updateOfficeState = { isPending: false };
const deleteOfficeMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    organization: {
      getSettings: { useQuery: () => settingsQuery },
      updateSettings: {
        useMutation: () => ({
          mutate: updateSettingsMutate,
          isPending: updateSettingsState.isPending,
          error: updateSettingsState.error,
        }),
      },
      listOffices: { useQuery: () => officesQuery },
      addOffice: {
        useMutation: () => ({ mutate: addOfficeMutate, isPending: addOfficeState.isPending }),
      },
      updateOffice: {
        useMutation: () => ({ mutate: updateOfficeMutate, isPending: updateOfficeState.isPending }),
      },
      deleteOffice: {
        useMutation: () => ({ mutate: deleteOfficeMutate }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  settingsQuery.data = {
    name: "Byrå AB",
    orgNumber: "556677-8899",
    address: "Storgatan 1",
    phone: "08-123",
    email: "info@byra.se",
    bankgiro: "123-4567",
  };
  settingsQuery.isLoading = false;
  officesQuery.data = [];
  officesQuery.isLoading = false;
  updateSettingsState.isPending = false;
  updateSettingsState.error = null;
  addOfficeState.isPending = false;
  updateOfficeState.isPending = false;

  // Mock fetch for logo endpoint
  global.fetch = vi.fn((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("/api/organization/logo")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ logoUrl: null }),
      } as Response);
    }
    return Promise.reject(new Error("unexpected fetch: " + urlStr));
  }) as typeof fetch;

  // Mock clipboard
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

describe("SettingsPage", () => {
  it("visar laddartext under fetch", () => {
    settingsQuery.isLoading = true;
    settingsQuery.data = undefined;
    render(<SettingsPage />);
    expect(screen.getByText(/Laddar inställningar/i)).toBeInTheDocument();
  });

  it("renderar huvudsektioner", async () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: /^Inställningar$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Logotyp/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Öppna dokument/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Kontor/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Kontaktuppgifter/i })).toBeInTheDocument();
  });

  it("populerar form från settings.data och visar i förhandsgranskning", () => {
    render(<SettingsPage />);
    expect(screen.getByDisplayValue("Byrå AB")).toBeInTheDocument();
    expect(screen.getByDisplayValue("556677-8899")).toBeInTheDocument();
    // Preview slår ihop fälten
    expect(screen.getByText(/Org\.nr 556677-8899/)).toBeInTheDocument();
  });

  it("Spara-knappen anropar updateSettings.mutate", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateSettingsMutate).toHaveBeenCalledTimes(1);
    expect(updateSettingsMutate.mock.calls[0][0]).toMatchObject({ name: "Byrå AB" });
  });

  it("Kopiera-knappen i WebDAV-sektionen kopierar URL", async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Kopiera/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Kopierat/i })).toBeInTheDocument();
  });

  it("öppnar formuläret för att lägga till kontor och sparar", async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Lägg till kontor/i }));
    const nameInput = screen.getByPlaceholderText(/t\.ex\. Stockholm/i);
    fireEvent.change(nameInput, { target: { value: "Göteborg" } });
    // Det finns två "Spara"-knappar (en för office-formuläret, en för kontaktuppgifter).
    // Office-formuläret renderas först → välj första.
    const saveButtons = screen.getAllByRole("button", { name: /^Spara/i });
    fireEvent.click(saveButtons[0]);
    await waitFor(() => expect(addOfficeMutate).toHaveBeenCalled());
    expect(addOfficeMutate.mock.calls[0][0]).toMatchObject({ name: "Göteborg" });
  });

  it("listar existerande kontor", () => {
    officesQuery.data = [
      {
        id: "o1",
        name: "Stockholm",
        address: "Storgatan 1",
        phone: "08-1",
        email: "sthlm@x.se",
        isMain: true,
      },
    ];
    render(<SettingsPage />);
    expect(screen.getByText("Stockholm")).toBeInTheDocument();
    // "Huvudkontor" finns som både tag (för isMain) och som checkbox-label
    expect(screen.getAllByText(/Huvudkontor/i).length).toBeGreaterThan(0);
  });

  it("visar fetcher-fel från updateSettings", () => {
    updateSettingsState.error = { message: "Något fel" };
    render(<SettingsPage />);
    expect(screen.getByText(/Något fel/i)).toBeInTheDocument();
  });

  it("uppdaterar byråns namn-input och triggar mutate med nytt värde", () => {
    render(<SettingsPage />);
    const nameInput = screen.getByDisplayValue("Byrå AB") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Ny Byrå AB" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateSettingsMutate.mock.calls[0][0].name).toBe("Ny Byrå AB");
  });

  it("uppdaterar bankgiro-input", () => {
    render(<SettingsPage />);
    const bg = screen.getByDisplayValue("123-4567") as HTMLInputElement;
    fireEvent.change(bg, { target: { value: "999-9999" } });
    expect(bg.value).toBe("999-9999");
  });

  it("startar redigering av befintligt kontor och anropar updateOffice", async () => {
    officesQuery.data = [
      {
        id: "o1",
        name: "Stockholm",
        address: "S 1",
        phone: "08-1",
        email: "s@x.se",
        isMain: true,
      },
    ];
    render(<SettingsPage />);
    const editBtn = screen.getByRole("button", { name: /Redigera/i });
    fireEvent.click(editBtn);
    // Edit-formulär nu öppen — spara-knapp finns
    const saveBtn = screen.getAllByRole("button", { name: /^Spara/i })[0];
    fireEvent.click(saveBtn);
    await waitFor(() => expect(updateOfficeMutate).toHaveBeenCalled());
    expect(updateOfficeMutate.mock.calls[0][0]).toMatchObject({ id: "o1", name: "Stockholm" });
  });

  it("anropar deleteOffice när Ta bort klickas", () => {
    officesQuery.data = [
      { id: "o2", name: "Malmö", address: null, phone: null, email: null, isMain: false },
    ];
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Ta bort/i }));
    expect(deleteOfficeMutate).toHaveBeenCalledWith({ id: "o2" });
  });

  it("Avbryt i nytt kontor-formulär stänger formuläret", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Lägg till kontor/i }));
    const nameInput = screen.getByPlaceholderText(/t\.ex\. Stockholm/i);
    expect(nameInput).toBeInTheDocument();
    // Avbryt-knappen i formuläret har title=Avbryt
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/i }));
    expect(screen.queryByPlaceholderText(/t\.ex\. Stockholm/i)).not.toBeInTheDocument();
  });

  it("togglar Huvudkontor-checkboxen i nytt kontor", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Lägg till kontor/i }));
    const isMainCheckbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(isMainCheckbox.checked).toBe(false);
    fireEvent.click(isMainCheckbox);
    expect(isMainCheckbox.checked).toBe(true);
  });

  it("Spara-knappen i kontor är disabled när namn är tomt", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Lägg till kontor/i }));
    const saveButtons = screen.getAllByRole("button", { name: /^Spara/i });
    const officeSave = saveButtons[0] as HTMLButtonElement;
    expect(officeSave.disabled).toBe(true);
  });

  it("uppdaterar email, telefon, address, orgNumber och submittar", () => {
    render(<SettingsPage />);
    const emailInput = screen.getByDisplayValue("info@byra.se") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "ny@byra.se" } });
    const phoneInput = screen.getByDisplayValue("08-123") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "08-999" } });
    const addressInput = screen.getByDisplayValue("Storgatan 1") as HTMLInputElement;
    fireEvent.change(addressInput, { target: { value: "Lillgatan 2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    const arg = updateSettingsMutate.mock.calls[0][0];
    expect(arg.email).toBe("ny@byra.se");
    expect(arg.phone).toBe("08-999");
    expect(arg.address).toBe("Lillgatan 2");
  });

  it("renderar adress, telefon och e-post i kontor-listrad", () => {
    officesQuery.data = [
      {
        id: "o1",
        name: "Stockholm",
        address: "Storgatan 1",
        phone: "08-1",
        email: "sthlm@x.se",
        isMain: false,
      },
    ];
    render(<SettingsPage />);
    const allText = document.body.textContent || "";
    expect(allText).toContain("Storgatan 1");
    expect(allText).toContain("08-1");
    expect(allText).toContain("sthlm@x.se");
  });

  it("ändrar adress i edit-formulär för kontor", () => {
    officesQuery.data = [
      {
        id: "o1",
        name: "Stockholm",
        address: "Gamla",
        phone: null,
        email: null,
        isMain: false,
      },
    ];
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Redigera/i }));
    const addressInput = screen.getByDisplayValue("Gamla") as HTMLInputElement;
    fireEvent.change(addressInput, { target: { value: "Ny adress" } });
    expect(addressInput.value).toBe("Ny adress");
  });

  it("laddar upp logotyp och uppdaterar förhandsvisning", async () => {
    let logoUploaded = false;
    global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/organization/logo")) {
        if (init?.method === "POST") {
          logoUploaded = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ logoUrl: "/uploads/logo.png" }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ logoUrl: null }),
        } as Response);
      }
      return Promise.reject(new Error("unexpected: " + urlStr));
    }) as typeof fetch;

    const { container } = render(<SettingsPage />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["abc"], "logo.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(logoUploaded).toBe(true));
  });

  it("visar fel när logotyp-uppladdning misslyckas", async () => {
    global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/organization/logo") && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Filen är för stor" }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ logoUrl: null }),
      } as Response);
    }) as typeof fetch;

    const { container } = render(<SettingsPage />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "big.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Filen är för stor/)).toBeInTheDocument());
  });

  it("tar bort logotyp via fetch DELETE", async () => {
    let deleted = false;
    global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/organization/logo")) {
        if (init?.method === "DELETE") {
          deleted = true;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ logoUrl: "/uploads/old.png" }),
        } as Response);
      }
      return Promise.reject(new Error("unexpected: " + urlStr));
    }) as typeof fetch;

    render(<SettingsPage />);
    // Vänta tills "Ta bort"-knappen för logotyp dyker upp (logoUrl satt)
    const removeBtn = await waitFor(() =>
      screen.getByRole("button", { name: /^Ta bort$/i }),
    );
    fireEvent.click(removeBtn);
    await waitFor(() => expect(deleted).toBe(true));
  });
});
