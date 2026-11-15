/**
 * Typad fake av den Office.js-yta Outlook-tillägget använder (`OfficeLike` i
 * src/lib/client/addin/taskpane-controller.ts), delad av enhetstesterna och
 * Playwright-E2E:n (test/e2e/addin/).
 *
 * `installFakeOffice` är SJÄLVSTÄNDIG (inga importer, inga variabler utanför
 * funktionen): Playwright serialiserar den till webbläsaren med
 * `page.addInitScript(installFakeOffice, config)`. Ändra den inte så att den
 * når något utanför sin egen kropp.
 *
 * Token kommer inte från Office (NAA/MSAL, addin-auth.ts); i testerna sätts
 * de som `staticTokens` i tilläggets konfiguration.
 */

import type { OfficeLike } from "@/lib/client/addin/taskpane-controller";

export interface FakeOfficeConfig {
  /** Mejlet som är öppet i Outlook. */
  item: { itemId: string; subject: string | null; dateTimeCreated: string | null; internetMessageId?: string | null };
}

declare global {
  // Som Microsofts office.js: `Office` är en global i task-panen.
  var Office: FakeOffice | undefined;
}

export type FakeOffice = OfficeLike & { onReady(cb: () => void): void };

/** Bygg fake-Office:n. I webbläsaren läggs den också på `window.Office`, som office.js gör. */
export function installFakeOffice(config: FakeOfficeConfig): FakeOffice {
  const office: FakeOffice = {
    onReady(cb) { cb(); },
    MailboxEnums: { RestVersion: { v2_0: "v2.0" } },
    context: {
      mailbox: {
        item: {
          itemId: config.item.itemId,
          subject: config.item.subject,
          dateTimeCreated: config.item.dateTimeCreated === null ? null : new Date(config.item.dateTimeCreated),
          internetMessageId: config.item.internetMessageId ?? null,
        },
        // Office gör om EWS-id:t till REST-id; fake:n märker det så att testerna ser att det används.
        convertToRestId: (itemId, version) => `rest-${version}-${itemId}`,
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
  internetMessageId: "<bouppteckning-1@mail.example.se>",
};
