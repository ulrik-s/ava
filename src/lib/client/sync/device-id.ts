/**
 * Enhetens id och etikett för synkuppföljningen (#1267).
 *
 * Id:t är beständigt per webbläsarprofil (localStorage), så att servern ser
 * samma enhet mellan sessioner. Går lagringen inte att nå (privat läge,
 * blockerad) får fliken ett eget id för sessionen — rapporten fungerar ändå,
 * enheten syns bara som ny nästa gång.
 */

import { uuidv7 } from "@/lib/shared/uuid";

const DEVICE_ID_KEY = "ava.syncDeviceId";

/** Den del av `localStorage` som används (injicerbar i tester). */
export type DeviceIdStorage = Pick<Storage, "getItem" | "setItem">;

let sessionId: string | null = null;

function browserStorage(): DeviceIdStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Enhetens id; skapas första gången. */
export function deviceId(storage: DeviceIdStorage | undefined = browserStorage()): string {
  try {
    const stored = storage?.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const id = uuidv7();
    storage?.setItem(DEVICE_ID_KEY, id);
    if (storage) return id;
  } catch {
    // Lagringen kastar (privat läge): falla tillbaka på sessionens id.
  }
  sessionId ??= uuidv7();
  return sessionId;
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [[/Edg\//, "Edge"], [/Firefox\//, "Firefox"], [/Chrome\//, "Chrome"], [/Safari\//, "Safari"]];
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [[/iPhone|iPad/, "iOS"], [/Android/, "Android"], [/Windows/, "Windows"], [/Mac OS X|Macintosh/, "macOS"], [/Linux/, "Linux"]];

function first(list: ReadonlyArray<[RegExp, string]>, ua: string): string | undefined {
  return list.find(([re]) => re.test(ua))?.[1];
}

/** "Chrome på macOS" ur user-agent — grovt, bara för att admin ska känna igen enheten. */
export function deviceLabel(userAgent: string): string | null {
  const browser = first(BROWSERS, userAgent);
  const system = first(SYSTEMS, userAgent);
  if (browser && system) return `${browser} på ${system}`;
  return browser ?? system ?? null;
}
