/**
 * "Logga in igen"-beskedet (#1351). Inom offline-graceperioden skickas ingen
 * hårt vidare till IdP:n — den kan vara nere, och ett formulär mitt i
 * skrivandet ska inte försvinna. I stället visas en banner, och användaren
 * väljer själv när inloggningen ska förnyas. Ändringarna köas under tiden.
 *
 *   - `signed-out`    — proxyn har ingen session (gick ut, eller IdP:n kunde
 *     inte förnya den).
 *   - `token-expired` — proxyn har en session men servern godtar inte längre
 *     dess token.
 *   - `unreachable`   — inloggningen gick inte att kontrollera (inget nät,
 *     proxyn svarar inte, en captive portal).
 *   - `account-inactive` — kontot är spärrat i byrån (#1962). Beskedet visas
 *     utan "Logga in igen": en ny inloggning hjälper inte, en administratör
 *     måste återaktivera kontot. Kön ligger kvar till dess.
 *
 * En lyckad synk visar att sessionen fungerar — då tas beskedet bort.
 */

/** Varför användaren ombeds logga in igen. */
export type SessionNotice = "signed-out" | "token-expired" | "unreachable" | "account-inactive";

type Listener = () => void;

// ponytail: en modul-global — det finns exakt en session per flik.
let current: SessionNotice | null = null;
const listeners = new Set<Listener>();

/** Sätt (eller ta bort, `null`) beskedet. */
export function setSessionNotice(notice: SessionNotice | null): void {
  if (notice === current) return;
  current = notice;
  for (const listener of listeners) listener();
}

/** Beskedet just nu. */
export function sessionNotice(): SessionNotice | null {
  return current;
}

/** Lyssna på ändringar; returnerar avregistreringen. */
export function subscribeSessionNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const TEXTS: Record<SessionNotice, string> = {
  "signed-out": "Inloggningen har gått ut. Du arbetar lokalt — ändringarna sparas på servern när du loggat in igen.",
  "token-expired": "Servern godtar inte längre inloggningen. Du arbetar lokalt — ändringarna sparas på servern när du loggat in igen.",
  unreachable: "Inloggningen gick inte att kontrollera. Du arbetar lokalt — ändringarna sparas på servern när kontakten är tillbaka.",
  "account-inactive": "Ditt konto är inte längre aktivt i byrån. Du arbetar lokalt — ändringarna finns kvar på enheten och sparas på servern när en administratör har återaktiverat kontot.",
};

/** Om bannern erbjuder "Logga in igen" — inte när kontot är spärrat (#1962). */
const OFFERS_LOGIN: Record<SessionNotice, boolean> = {
  "signed-out": true,
  "token-expired": true,
  unreachable: true,
  "account-inactive": false,
};

/** Bannerns text. */
export function sessionNoticeText(notice: SessionNotice): string {
  return TEXTS[notice];
}

/** Om bannern ska visa knappen "Logga in igen" för beskedet. */
export function sessionNoticeOffersLogin(notice: SessionNotice): boolean {
  return OFFERS_LOGIN[notice];
}
