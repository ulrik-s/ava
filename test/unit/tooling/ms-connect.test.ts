import { describe, it, expect } from "vitest-compat";
import { codeFromCallbackUrl } from "../../../tooling/scripts/ms-connect";

/**
 * `--listen` (#1072) tar emot Entras redirect. Servern går inte att enhetstesta
 * meningsfullt, men tolkningen av callbacken gör det — och det är där felen
 * bor: en avbruten consent, ett svar från fel runda, en tom kod.
 */
const STATE = "the-state";

describe("codeFromCallbackUrl", () => {
  it("plockar ut koden när state stämmer", () => {
    expect(codeFromCallbackUrl(`/callback?code=abc&state=${STATE}`, STATE)).toBe("abc");
  });

  // Utan detta blir en avbruten consent "callback saknar ?code=" — sant men
  // oanvändbart. Entras error_description säger vad användaren faktiskt gjorde.
  it("lyfter fram Entras fel i stället för att gissa", () => {
    expect(() => codeFromCallbackUrl("/callback?error=access_denied&error_description=user+canceled", STATE))
      .toThrow(/access_denied.*canceled/);
  });

  // Hela CSRF-skyddet: ett svar med fel state hör till någon annans runda.
  it("vägrar när state inte stämmer", () => {
    expect(() => codeFromCallbackUrl("/callback?code=abc&state=annat", STATE)).toThrow(/state/);
  });

  it("vägrar när state saknas helt", () => {
    expect(() => codeFromCallbackUrl("/callback?code=abc", STATE)).toThrow(/state/);
  });

  it("vägrar en callback utan kod", () => {
    expect(() => codeFromCallbackUrl(`/callback?state=${STATE}`, STATE)).toThrow(/code/);
  });
});
