/**
 * `/login` i self-hosted: inloggningen sker hos IdP:n, så sidan visar bara ett
 * besked. Efter en utloggning (#1347) landar man här (`?signedOut=1`) —
 * proxyns session är då avslutad.
 */

import { completeSignOut } from "@/lib/client/backend/local-data/sign-out";

/** Beskedet och knappens text (knappen går till appens rot → inloggningen). */
export interface LoginInfo {
  kind: "info";
  message: string;
  action: string;
}

/** Beskedet; efter en utloggning noteras att proxyns session är avslutad. */
export function selfHostedInfo(signedOut: boolean, storage: Pick<Storage, "removeItem"> = window.localStorage): LoginInfo {
  if (!signedOut) {
    return {
      kind: "info",
      action: "Till startsidan",
      message:
        "Self-hosted: inloggning sker via din identitetsleverantör (OIDC). " +
        "oauth2-proxy dirigerar dig dit automatiskt — den här sidan används " +
        "bara i demo-läget.",
    };
  }
  completeSignOut(storage);
  return {
    kind: "info",
    action: "Logga in igen",
    message: "Du är utloggad. Kopiorna av byråns data är borttagna från den här webbläsaren.",
  };
}
