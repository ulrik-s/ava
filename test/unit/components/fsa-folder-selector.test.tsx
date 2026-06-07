/**
 * Tester för `FsaFolderSelector` (#61): pure `githubize`-normalisering +
 * "stöds inte"-grenarna (Firefox/Safari/övrig) som inte kräver riktig FSA.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FsaFolderSelector, githubize } from "@/components/settings/fsa-folder-selector";

// handle-store importeras dynamiskt i komponenten; mocka den så vi styr
// FSA-stöd utan riktig browser-API.
const isFsaSupported = vi.fn();
vi.mock("@/lib/client/fsa/handle-store", () => ({
  isFsaSupported: () => isFsaSupported(),
  loadHandle: vi.fn(async () => null),
  saveHandle: vi.fn(async () => {}),
  deleteHandle: vi.fn(async () => {}),
  ensureReadWrite: vi.fn(async () => true),
}));

describe("githubize", () => {
  it("kortform user/repo → https .git", () => {
    expect(githubize("ulrik-s/ava")).toBe("https://github.com/ulrik-s/ava.git");
  });
  it("ssh-form → https .git", () => {
    expect(githubize("git@github.com:u/r")).toBe("https://github.com/u/r.git");
    expect(githubize("git@github.com:u/r.git")).toBe("https://github.com/u/r.git");
  });
  it("https lämnas orört", () => {
    expect(githubize("https://git.firma.se/data.git")).toBe("https://git.firma.se/data.git");
  });
});

describe("FsaFolderSelector — stöds inte", () => {
  const originalUA = navigator.userAgent;
  beforeEach(() => { vi.clearAllMocks(); isFsaSupported.mockReturnValue(false); });
  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUA });
  });

  function setUA(ua: string) {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  }

  it("Firefox → Firefox-specifikt meddelande", async () => {
    setUA("Mozilla/5.0 Firefox/130.0");
    render(<FsaFolderSelector repoUrl="" token="" />);
    await waitFor(() => expect(screen.getByText(/Firefox stöder inte/)).toBeInTheDocument());
  });

  it("Safari → Safari-specifikt meddelande", async () => {
    setUA("Mozilla/5.0 (Macintosh) Version/17.0 Safari/605");
    render(<FsaFolderSelector repoUrl="" token="" />);
    await waitFor(() => expect(screen.getByText(/Safari stöder inte/)).toBeInTheDocument());
  });

  it("övrig webbläsare → generiskt meddelande", async () => {
    setUA("SomeOtherBrowser/1.0");
    render(<FsaFolderSelector repoUrl="" token="" />);
    await waitFor(() => expect(screen.getByText(/Den här webbläsaren stöder inte/)).toBeInTheDocument());
  });
});

describe("FsaFolderSelector — stöds, ingen mapp vald", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFsaSupported.mockReturnValue(true);
  });

  it("visar val-/klona-knappar", async () => {
    render(<FsaFolderSelector repoUrl="ulrik-s/ava" token="t" />);
    await waitFor(() => expect(screen.getByText("Välj befintlig mapp")).toBeInTheDocument());
    expect(screen.getByText("Klona repo hit")).toBeInTheDocument();
  });
});
