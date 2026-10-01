/**
 * `PwaRegister` (#1240) — registrerar app-skalets service worker och frågar
 * användaren när en ny version väntar.
 *
 * Tidigare avregistrerade komponenten ALLA service workers i varje statisk
 * build (demo och prod byggs båda med demo-flaggan), så appen kunde aldrig
 * öppnas offline. Nu registreras `<bas>/sw.js` med scope `<bas>/` i varje
 * produktionsbygge.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { PwaRegister } from "@/components/shell/pwa-register";

class FakeWorker {
  state = "installing";
  posted: unknown[] = [];
  private cbs: Array<() => void> = [];
  postMessage(m: unknown): void { this.posted.push(m); }
  addEventListener(_t: string, cb: () => void): void { this.cbs.push(cb); }
  setState(s: string): void { this.state = s; for (const cb of this.cbs) cb(); }
}

class FakeRegistration {
  scope = "https://x/ava/";
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  private cbs: Array<() => void> = [];
  addEventListener(_t: string, cb: () => void): void { this.cbs.push(cb); }
  fireUpdateFound(w: FakeWorker): void { this.installing = w; for (const cb of this.cbs) cb(); }
}

let registration: FakeRegistration;
let register: ReturnType<typeof vi.fn>;
let controllerCbs: Array<() => void>;
let controller: object | null;

function stubServiceWorker(): void {
  controllerCbs = [];
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    serviceWorker: {
      register,
      get controller() { return controller; },
      addEventListener: (_t: string, cb: () => void) => { controllerCbs.push(cb); },
    },
  });
}

describe("PwaRegister", () => {
  beforeEach(() => {
    registration = new FakeRegistration();
    register = vi.fn(async () => registration);
    controller = {};
    stubServiceWorker();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("registrerar <bas>/sw.js med scope <bas>/ i produktion", async () => {
    render(<PwaRegister enabled basePath="/ava" />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/ava/sw.js", { scope: "/ava/" }));
  });

  it("rot-bas → /sw.js med scope /", async () => {
    render(<PwaRegister enabled basePath="" />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
  });

  it("registrerar INTE i utvecklingsläge (next dev serverar ingen sw.js)", async () => {
    render(<PwaRegister enabled={false} basePath="" />);
    await act(async () => { await Promise.resolve(); });
    expect(register).not.toHaveBeenCalled();
  });

  it("ingen fråga när ingen uppdatering väntar", async () => {
    render(<PwaRegister enabled basePath="" />);
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Ladda om/ })).toBeNull();
  });

  it("väntande ny version → fråga; klick → SKIP_WAITING, omladdning när den tagit över", async () => {
    const reload = vi.fn();
    render(<PwaRegister enabled basePath="" reload={reload} />);
    await waitFor(() => expect(register).toHaveBeenCalled());
    const w = new FakeWorker();
    act(() => { registration.fireUpdateFound(w); w.setState("installed"); });

    expect(await screen.findByText(/En ny version av AVA finns/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ladda om/ }));
    expect(w.posted).toEqual([{ type: "SKIP_WAITING" }]);
    expect(reload).not.toHaveBeenCalled();
    act(() => { for (const cb of controllerCbs) cb(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("en annan flik bytte version (#1355) → den här fliken får frågan, och 'Ladda om' laddar om direkt", async () => {
    const reload = vi.fn();
    render(<PwaRegister enabled basePath="" reload={reload} />);
    await waitFor(() => expect(register).toHaveBeenCalled());
    act(() => { for (const cb of controllerCbs) cb(); });
    expect(await screen.findByText(/AVA har uppdaterats i en annan flik/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ladda om/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("första installationen (ingen styrde sidan) → ingen fråga om ny version", async () => {
    controller = null;
    render(<PwaRegister enabled basePath="" />);
    await waitFor(() => expect(register).toHaveBeenCalled());
    act(() => { for (const cb of controllerCbs) cb(); });
    expect(screen.queryByRole("button", { name: /Ladda om/ })).toBeNull();
  });

  it("ett chunk som inte längre finns (#1355) → omladdning; igen direkt → besked i stället för en loop", async () => {
    sessionStorage.clear();
    const reload = vi.fn();
    render(<PwaRegister enabled basePath="" reload={reload} />);
    const chunkError = Object.assign(new Error("Failed to load chunk /_next/static/chunks/x.js"), { name: "ChunkLoadError" });
    act(() => { window.dispatchEvent(new ErrorEvent("error", { error: chunkError })); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { window.dispatchEvent(new ErrorEvent("error", { error: chunkError })); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Delar av AVA kunde inte laddas/)).toBeInTheDocument();
    sessionStorage.clear();
  });

  it("i utvecklingsläge lyssnar den inte efter chunk-fel", async () => {
    sessionStorage.clear();
    const reload = vi.fn();
    render(<PwaRegister enabled={false} basePath="" reload={reload} />);
    const chunkError = Object.assign(new Error("x"), { name: "ChunkLoadError" });
    act(() => { window.dispatchEvent(new ErrorEvent("error", { error: chunkError })); });
    expect(reload).not.toHaveBeenCalled();
  });

  it("misslyckad registrering → ingen krasch, ingen fråga", async () => {
    register = vi.fn(async () => { throw new Error("SecurityError"); });
    stubServiceWorker();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PwaRegister enabled basePath="" />);
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Ladda om/ })).toBeNull();
    warn.mockRestore();
  });

  it("browser utan service worker-stöd → ingenting händer", async () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, serviceWorker: undefined });
    const { container } = render(<PwaRegister enabled basePath="" />);
    await act(async () => { await Promise.resolve(); });
    expect(container.firstChild).toBeNull();
  });
});
