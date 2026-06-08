/**
 * Tester för `KeypairManager` (#61). WebCrypto-Ed25519 finns inte i jsdom, så
 * krypto-lagret (`ed25519-keypair`/`ssh-format`) mockas — testen verifierar
 * komponentens orkestrering: stöd-check, generera → visa nyckel, lägg-till.
 *
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { KeypairManager } from "@/components/settings/keypair-manager";
import { isEd25519Supported, generateKeypair, loadKeypair } from "@/lib/client/keys/ed25519-keypair";

vi.mock("@/lib/client/keys/ed25519-keypair", () => ({
  isEd25519Supported: vi.fn(async () => true),
  loadKeypair: vi.fn(async () => null),
  generateKeypair: vi.fn(async () => ({ rawPublicKey: new Uint8Array([1, 2, 3]) })),
  saveKeypair: vi.fn(async () => {}),
  deleteKeypair: vi.fn(async () => {}),
}));
vi.mock("@/lib/client/keys/ssh-format", () => ({
  buildSshPublicKey: () => "ssh-ed25519 AAAATEST anna@mac",
  sshFingerprint: async () => "SHA256:fakefingerprint",
}));
vi.mock("@/lib/client/github/register-ssh-key", () => ({ registerSshKeyOnGithub: vi.fn(async () => {}) }));
vi.mock("@/lib/client/firma/firma-config", () => ({ loadFirmaConfig: () => ({ token: "ghp_x" }) }));

const mockSupported = vi.mocked(isEd25519Supported);
const mockGenerate = vi.mocked(generateKeypair);
const mockLoad = vi.mocked(loadKeypair);

beforeEach(() => {
  vi.clearAllMocks();
  mockSupported.mockResolvedValue(true);
  mockLoad.mockResolvedValue(null);
  mockGenerate.mockResolvedValue({ rawPublicKey: new Uint8Array([1, 2, 3]) } as never);
});

describe("KeypairManager", () => {
  it("visar amber-meddelande när Ed25519 inte stöds", async () => {
    mockSupported.mockResolvedValue(false);
    render(<KeypairManager onAddToProfile={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/stöder inte WebCrypto Ed25519/)).toBeInTheDocument());
  });

  it("stöds + ingen nyckel → visar generera-knapp", async () => {
    render(<KeypairManager onAddToProfile={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Generera nytt nyckelpar")).toBeInTheDocument());
  });

  it("generera → skapar par, visar SSH-nyckel + fingerprint", async () => {
    render(<KeypairManager onAddToProfile={vi.fn()} />);
    await waitFor(() => screen.getByText("Generera nytt nyckelpar"));
    fireEvent.click(screen.getByText("Generera nytt nyckelpar"));
    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());
    expect(await screen.findByDisplayValue(/ssh-ed25519 AAAATEST/)).toBeInTheDocument();
    expect(screen.getByText(/SHA256:fakefingerprint/)).toBeInTheDocument();
  });

  it("'Lägg till i min profil' anropar onAddToProfile med nyckel + fingerprint", async () => {
    const onAdd = vi.fn();
    render(<KeypairManager onAddToProfile={onAdd} />);
    await waitFor(() => screen.getByText("Generera nytt nyckelpar"));
    fireEvent.click(screen.getByText("Generera nytt nyckelpar"));
    const addBtn = await screen.findByText("Lägg till i min profil");
    fireEvent.click(addBtn);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      sshPublicKey: expect.stringContaining("ssh-ed25519"),
      fingerprint: "SHA256:fakefingerprint",
    }));
  });
});
