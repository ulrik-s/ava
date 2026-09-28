/**
 * `sw-update` (#1240) — klientens sida av service worker-versionsbytet.
 *
 * `watchForUpdate` rapporterar en NY version som väntar (inte den första
 * installationen: utan en styrande worker finns inget att uppdatera från).
 * `activateUpdate` ber den väntande workern ta över och laddar om sidan EN gång
 * när den gjort det — omladdningen sker först när nya skalet styr, så sidan
 * aldrig laddas om mot det gamla.
 */

/** Den del av `ServiceWorker` som används. */
export interface SwWorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
}

/** Den del av `ServiceWorkerRegistration` som används. */
export interface SwRegistrationLike {
  readonly waiting: SwWorkerLike | null;
  readonly installing: SwWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

/** Den del av `ServiceWorkerContainer` som används. */
export interface SwContainerLike {
  addEventListener(type: "controllerchange", listener: () => void): void;
}

/**
 * Anropa `onReady(worker)` när en ny version väntar på att få ta över.
 * `hasController` avgör om sidan redan styrs (dvs. om detta är en uppdatering).
 */
export function watchForUpdate(
  registration: SwRegistrationLike,
  hasController: () => boolean,
  onReady: (worker: SwWorkerLike) => void,
): void {
  if (registration.waiting && hasController()) onReady(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && hasController()) onReady(worker);
    });
  });
}

/** Låt `worker` ta över och ladda om när den styr sidan. */
export function activateUpdate(worker: SwWorkerLike, container: SwContainerLike, reload: () => void): void {
  let reloaded = false;
  container.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}
