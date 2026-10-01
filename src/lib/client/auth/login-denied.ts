/**
 * Beskedet när OIDC-inloggningen nekas (#223, #1408) — i sessionsgrindens
 * felskärm. Ren modul: bootstrappen laddar `oidc-principal` dynamiskt.
 */

/** En nekad inloggning: okänd/inaktiverad, eller adressen hör till flera konton. */
export interface DeniedLogin {
  kind: "denied" | "ambiguous";
  email: string;
}

/** Beskedet att visa. */
export function loginDeniedMessage(outcome: DeniedLogin): string {
  return outcome.kind === "ambiguous"
    ? `Inloggningen nekas: e-postadressen (${outcome.email}) hör till mer än ett konto. Kontakta administratören — adressen måste vara unik.`
    : `Inte behörig: ditt konto (${outcome.email}) finns inte i byrån — kontakta administratören.`;
}
