/**
 * Typad fake av den Office.js-yta Outlook-tillägget använder (`OfficeLike` i
 * src/lib/client/addin/taskpane-controller.ts), delad av enhetstesterna och
 * Playwright-E2E:n (test/e2e/addin/).
 *
 * `installFakeOffice` är SJÄLVSTÄNDIG (inga importer, inga variabler utanför
 * funktionen): Playwright serialiserar den till webbläsaren med
 * `page.addInitScript(installFakeOffice, config)`. Ändra den inte så att den
 * når något utanför sin egen kropp.
 */

import type { OfficeLike } from "@/lib/client/addin/taskpane-controller";

export interface FakeOfficeConfig {
  /** Mejlet som är öppet i Outlook. */
  item: { itemId: string; subject: string | null; dateTimeCreated: string | null };
  /** Mailboxens REST-bas (Office lägger till /v2.0). */
  restUrl: string;
  /** Svaret från getCallbackTokenAsync; null = misslyckas. */
  callbackToken: string | null;
  /** Förifyllda roaming-settings (t.ex. sparad server/PAT). */
  roaming?: Record<string, string>;
}

declare global {
  // Som Microsofts office.js: `Office` är en global i task-panen.
  var Office: FakeOffice | undefined;
}

/** Fake-Office med det tillägget har skrivit till roaming-settings. */
export type FakeOffice = OfficeLike & {
  onReady(cb: () => void): void;
  /** Det `saveAsync` senast sparade (för asserts). */
  saved: Record<string, string>;
};

/**
 * Bygg fake-Office:n. I webbläsaren (Playwright) läggs den också på
 * `window.Office`, precis som Microsofts office.js gör.
 */
export function installFakeOffice(config: FakeOfficeConfig): FakeOffice {
  const store: Record<string, string> = { ...(config.roaming ?? {}) };
  const saved: Record<string, string> = {};
  const office: FakeOffice = {
    saved,
    onReady(cb) { cb(); },
    MailboxEnums: { RestVersion: { v2_0: "v2.0" } },
    context: {
      roamingSettings: {
        get: (key) => store[key],
        set: (key, value) => { store[key] = value; },
        saveAsync: () => { Object.assign(saved, store); },
      },
      mailbox: {
        item: {
          itemId: config.item.itemId,
          subject: config.item.subject,
          dateTimeCreated: config.item.dateTimeCreated === null ? null : new Date(config.item.dateTimeCreated),
        },
        restUrl: config.restUrl,
        // Office gör om EWS-id:t till REST-id; fake:n märker det så att testerna ser att det används.
        convertToRestId: (itemId, version) => `rest-${version}-${itemId}`,
        getCallbackTokenAsync: (_opts, cb) => {
          setTimeout(() => {
            cb(config.callbackToken === null ? { status: "failed" } : { status: "succeeded", value: config.callbackToken });
          }, 0);
        },
      },
    },
  };
  if (typeof window !== "undefined") window.Office = office;
  return office;
}

/** Standardmejlet i testerna. */
export const DEFAULT_MAIL: FakeOfficeConfig["item"] = {
  itemId: "AAMkAD-test-1",
  subject: "Ang. bouppteckning",
  dateTimeCreated: "2026-11-10T09:30:00.000Z",
};
