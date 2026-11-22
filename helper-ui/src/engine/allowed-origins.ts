/**
 * Webbplatser användaren godkänt att använda helpern (#1149).
 *
 * Helpern svarar bara på anrop från godkända origins (#1448). localhost och
 * demons origin är alltid godkända, `AVA_HELPER_ORIGINS` (headless/CLI)
 * likaså — men en byrås egen AVA (t.ex. `https://ava-crm.io`) kan inte bakas in
 * i en gemensam build. Därför trust-on-first-use: första gången en okänd
 * https-webbplats anropar helpern frågar skalet användaren, och ett "Tillåt"
 * sparas här.
 *
 * Egen fil (`allowed-origins.json`), skild från `helper-config.json` som
 * webbappen skriver via `POST /config` — en webbplats ska aldrig kunna ge sig
 * själv tillgång.
 *
 * Samma lista styr också vart helperns egen token får skickas (#1838): bara
 * till en godkänd AVA-server, aldrig till en värd som ett anrop pekar ut.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAllowedOrigin } from "@/lib/shared/helper/protocol";
import { log } from "./log.ts";

const FILE = "allowed-origins.json";

/** Bara rena https-origins går att godkänna (inga sökvägar, inte http). */
export function isApprovableOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Helperns token för ett visst mål (#1838): `Authorization`-headern om målets
 * origin är en godkänd AVA-server, annars `undefined`.
 */
export type ServerAuth = (targetUrl: string) => Promise<string | undefined>;

/** Är URL:ens origin en godkänd AVA-server? `false` för en ogiltig URL. */
export function isApprovedServerUrl(url: string, approved: readonly string[]): boolean {
  try {
    return isAllowedOrigin(new URL(url).origin, approved);
  } catch {
    return false;
  }
}

/** Målets origin för loggen (aldrig hela URL:en); råtexten om den inte går att tolka. */
function originForLog(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "ogiltig URL";
  }
}

/**
 * Linda helperns token-källa så att token bara följer med till godkända
 * AVA-servrar. Listan läses vid varje anrop, så en origin som godkänns medan
 * helpern kör får token direkt. Mot andra mål anropas inte källan alls.
 */
export function tokenOnlyToApprovedServers(
  token: () => Promise<string | undefined>,
  approved: () => readonly string[],
): ServerAuth {
  return async (targetUrl) => {
    if (isApprovedServerUrl(targetUrl, approved())) return token();
    log(`skickar inte helperns token till ${originForLog(targetUrl)}: inte en godkänd AVA-server`);
    return undefined;
  };
}

export interface OriginFileDeps {
  readText: (path: string) => string;
  mkdirp: (dir: string) => void;
  writeText: (path: string, text: string) => void;
}

const defaultDeps: OriginFileDeps = {
  readText: (p) => readFileSync(p, "utf8"),
  mkdirp: (d) => mkdirSync(d, { recursive: true }),
  writeText: (p, t) => writeFileSync(p, t, "utf8"),
};

/** Godkända origins ur data-dir:en; [] om filen saknas eller är trasig. */
export function loadAllowedOrigins(dir: string | null, deps: OriginFileDeps = defaultDeps): string[] {
  if (!dir) return [];
  try {
    const parsed: unknown = JSON.parse(deps.readText(join(dir, FILE)));
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === "string" && isApprovableOrigin(o)) : [];
  } catch {
    return [];
  }
}

/** Frågar användaren (skalets dialog). `true` = tillåt. */
export type ConfirmOrigin = (origin: string) => Promise<boolean>;

/**
 * Håller de godkända origins i minnet och frågar om okända — högst en gång per
 * origin och session, så en sida som pollar inte öppnar en ström av dialoger.
 * Utan `confirm` (headless) frågar den aldrig.
 */
export class OriginGate {
  private readonly approved: Set<string>;
  private readonly asked = new Set<string>();

  constructor(
    private readonly dir: string | null,
    private readonly confirm: ConfirmOrigin | undefined,
    private readonly deps: OriginFileDeps = defaultDeps,
  ) {
    this.approved = new Set(loadAllowedOrigins(dir, deps));
  }

  /** Godkända origins just nu (skickas till CORS-kontrollen). */
  list(): string[] {
    return [...this.approved];
  }

  /** Ett anrop från en origin som CORS inte släppte in → fråga (en gång). */
  onUnknown(origin: string): void {
    if (!this.confirm || !isApprovableOrigin(origin) || this.asked.has(origin)) return;
    this.asked.add(origin);
    void this.confirm(origin).then((ok) => {
      if (ok) this.approve(origin);
      else log(`origin nekad av användaren: ${origin}`);
    });
  }

  private approve(origin: string): void {
    this.approved.add(origin);
    log(`origin godkänd av användaren: ${origin}`);
    if (!this.dir) return;
    this.deps.mkdirp(this.dir);
    this.deps.writeText(join(this.dir, FILE), JSON.stringify(this.list(), null, 2));
  }
}
