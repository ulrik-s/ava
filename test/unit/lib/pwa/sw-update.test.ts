/**
 * `sw-update` (#1240) — klientens sida av versionsbytet.
 *
 * En ny service worker installeras i bakgrunden och VÄNTAR; användaren får en
 * fråga och laddar om när det passar (mitt i en ifylld blankett ska sidan inte
 * bytas ut under fingrarna). Klick → SKIP_WAITING → controllerchange → reload.
 */
import { describe, expect, it, vi } from "vitest-compat";
import {
  activateUpdate,
  watchForTakeover,
  watchForUpdate,
  type SwContainerLike,
  type SwRegistrationLike,
  type SwWorkerLike,
} from "@/lib/client/pwa/sw-update";

class FakeWorker implements SwWorkerLike {
  state = "installing";
  readonly posted: unknown[] = [];
  private listeners: Array<() => void> = [];
  postMessage(msg: unknown): void { this.posted.push(msg); }
  addEventListener(_type: "statechange", cb: () => void): void { this.listeners.push(cb); }
  setState(s: string): void { this.state = s; for (const cb of this.listeners) cb(); }
}

class FakeRegistration implements SwRegistrationLike {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  private listeners: Array<() => void> = [];
  addEventListener(_type: "updatefound", cb: () => void): void { this.listeners.push(cb); }
  fireUpdateFound(worker: FakeWorker | null): void { this.installing = worker; for (const cb of this.listeners) cb(); }
}

class FakeContainer implements SwContainerLike {
  private listeners: Array<() => void> = [];
  addEventListener(_type: "controllerchange", cb: () => void): void { this.listeners.push(cb); }
  fireControllerChange(): void { for (const cb of this.listeners) cb(); }
}

describe("watchForUpdate", () => {
  it("en redan väntande worker (flik öppnad efter installationen) rapporteras direkt", () => {
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const onReady = vi.fn();
    watchForUpdate(reg, () => true, onReady);
    expect(onReady).toHaveBeenCalledWith(reg.waiting);
  });

  it("ny worker som blir 'installed' medan en gammal styr sidan → uppdatering finns", () => {
    const reg = new FakeRegistration();
    const onReady = vi.fn();
    watchForUpdate(reg, () => true, onReady);
    const w = new FakeWorker();
    reg.fireUpdateFound(w);
    expect(onReady).not.toHaveBeenCalled();
    w.setState("installed");
    expect(onReady).toHaveBeenCalledWith(w);
  });

  it("FÖRSTA installationen (ingen controller) är ingen uppdatering — ingen fråga", () => {
    const reg = new FakeRegistration();
    const onReady = vi.fn();
    watchForUpdate(reg, () => false, onReady);
    const w = new FakeWorker();
    reg.fireUpdateFound(w);
    w.setState("installed");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("väntande worker utan controller (hård omladdning) → ingen fråga", () => {
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker();
    const onReady = vi.fn();
    watchForUpdate(reg, () => false, onReady);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("andra tillstånd än 'installed' (t.ex. redundant) → ingen fråga", () => {
    const reg = new FakeRegistration();
    const onReady = vi.fn();
    watchForUpdate(reg, () => true, onReady);
    const w = new FakeWorker();
    reg.fireUpdateFound(w);
    w.setState("redundant");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("updatefound utan installing-worker ignoreras", () => {
    const reg = new FakeRegistration();
    const onReady = vi.fn();
    watchForUpdate(reg, () => true, onReady);
    reg.fireUpdateFound(null); // speglar en browser som rapporterar null
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe("activateUpdate", () => {
  it("skickar SKIP_WAITING och laddar om när den nya workern tagit över", () => {
    const w = new FakeWorker();
    const container = new FakeContainer();
    const reload = vi.fn();
    activateUpdate(w, container, reload);
    expect(w.posted).toEqual([{ type: "SKIP_WAITING" }]);
    expect(reload).not.toHaveBeenCalled();
    container.fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("laddar bara om EN gång även om controllerchange kommer flera gånger", () => {
    const w = new FakeWorker();
    const container = new FakeContainer();
    const reload = vi.fn();
    activateUpdate(w, container, reload);
    container.fireControllerChange();
    container.fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("watchForTakeover (#1355)", () => {
  it("en annan flik lät en ny version ta över en styrd sida → varje gång meddelas", () => {
    const container = Object.assign(new FakeContainer(), { controller: {} as unknown });
    const onTakeover = vi.fn();
    watchForTakeover(container, onTakeover);
    container.fireControllerChange();
    container.fireControllerChange();
    expect(onTakeover).toHaveBeenCalledTimes(2);
  });

  it("första installationens claim (ingen styrde sidan) är ingen ny version; nästa byte är det", () => {
    const container = Object.assign(new FakeContainer(), { controller: null as unknown });
    const onTakeover = vi.fn();
    watchForTakeover(container, onTakeover);
    container.fireControllerChange();
    expect(onTakeover).not.toHaveBeenCalled();
    container.fireControllerChange();
    expect(onTakeover).toHaveBeenCalledTimes(1);
  });
});
