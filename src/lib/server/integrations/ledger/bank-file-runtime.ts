/**
 * Boot-wiring av bankfil-avprickningen för server-runtime:n (#245).
 *
 * Bygger ett `PeerJob` som läser camt.053/054-filer ur en inkorg-katalog
 * (env `AVA_CAMT_INBOX`) och prickar av dem via porten ([[payments-job]] →
 * [[bank-file-connector]]). Returnerar `null` när inkorgen inte är konfigurerad
 * → riskfritt för demo/test/CI (peern aktiveras först när byrån pekat ut en
 * mapp dit banken/Bankgirot droppar återrapporteringsfiler).
 *
 * Idempotensen ([[payments-job]]) gör det ofarligt att läsa om samma filer
 * varje tick, så vi flyttar dem inte (v1); fil-arkivering är en uppföljning.
 */

import { join } from "node:path";
import type { PeerJob } from "../../local-first/peer-loop";
import { BankFileLedgerConnector } from "./bank-file-connector";
import { makeLedgerPaymentsJob } from "./payments-job";

/** Env-nyckel för inkorg-katalogen med camt-filer. */
export const CAMT_INBOX_ENV = "AVA_CAMT_INBOX";

export interface BuildBankFilePaymentsJobOpts {
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

/** Läs alla `.xml`-filer i inkorgen (tom lista om katalogen saknas). */
async function loadCamtFilesFrom(dir: string): Promise<string[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const xmls = names.filter((n) => n.toLowerCase().endsWith(".xml"));
  return Promise.all(xmls.map((n) => readFile(join(dir, n), "utf8")));
}

export function buildBankFilePaymentsJob(opts: BuildBankFilePaymentsJobOpts = {}): PeerJob | null {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((msg: string) => console.log(`[bankfil] ${msg}`));

  const inbox = env[CAMT_INBOX_ENV];
  if (!inbox) {
    log(`inkorg ej konfigurerad (${CAMT_INBOX_ENV} saknas) — avprickning av`);
    return null;
  }

  log(`avprickning aktiv — läser camt-filer ur ${inbox}`);
  const connector = new BankFileLedgerConnector({ loadCamtFiles: () => loadCamtFilesFrom(inbox) });
  return makeLedgerPaymentsJob({ loadConnector: async () => connector, log });
}
