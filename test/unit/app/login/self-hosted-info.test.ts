/**
 * #1579: `selfHostedInfo` — `signedOut` är satt bara för "Du är utloggad",
 * så att vyn kan visa AVA:s version där (och bara där).
 */
import { describe, expect, it, vi } from "vitest-compat";
import { selfHostedInfo } from "@/app/login/_self-hosted-info";

function storage(): Pick<Storage, "removeItem"> {
  return { removeItem: vi.fn() };
}

describe("selfHostedInfo", () => {
  it("efter utloggning: signedOut = true", () => {
    const info = selfHostedInfo(true, storage());
    expect(info.signedOut).toBe(true);
    expect(info.action).toBe("Logga in igen");
  });

  it("utan signedOut: signedOut = false", () => {
    const info = selfHostedInfo(false, storage());
    expect(info.signedOut).toBe(false);
    expect(info.action).toBe("Till startsidan");
  });
});
