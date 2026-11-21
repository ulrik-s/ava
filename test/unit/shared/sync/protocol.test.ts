/**
 * Synkprotokollets version (#1772): klienten jämför sitt protokoll med det
 * servern skickar i pullen — aldrig releaseetiketterna.
 */
import { describe, expect, it } from "vitest-compat";
import {
  incompatibleMessage, MIN_CLIENT_PROTOCOL, serverSyncInfo, SYNC_PROTOCOL_VERSION, syncCompatibility,
} from "@/lib/shared/sync/protocol";
import { classifySyncError, FOREIGN_ENTRY_REFUSAL, SyncRefusal, syncRefusalFromCause } from "@/lib/shared/sync/sync-error";

describe("synkprotokollet", () => {
  it("serverns del: protokoll, äldsta klient och release (bara information)", () => {
    expect(serverSyncInfo("v1.2.3")).toEqual({ protocol: SYNC_PROTOCOL_VERSION, minClient: MIN_CLIENT_PROTOCOL, release: "v1.2.3" });
    expect(serverSyncInfo(undefined).release).toBeNull();
  });

  it("samma protokoll passar; en server utan fältet talar version 1", () => {
    expect(syncCompatibility({ protocol: 3, minClient: 2, release: null }, 3)).toBe("ok");
    expect(syncCompatibility(undefined, 1)).toBe("ok");
    expect(syncCompatibility(undefined, 2)).toBe("server-older");
  });

  it("äldre server, eller klient under serverns minsta", () => {
    expect(syncCompatibility({ protocol: 2, minClient: 1, release: null }, 3)).toBe("server-older");
    expect(syncCompatibility({ protocol: 4, minClient: 4, release: null }, 3)).toBe("client-older");
    expect(syncCompatibility({ protocol: 4, minClient: 2, release: null }, 3)).toBe("ok");
  });

  it("beskedet: null när det passar, annars varför", () => {
    expect(incompatibleMessage(undefined)).toBeNull();
    expect(incompatibleMessage({ protocol: 1, minClient: 1, release: null }, 2)).toMatch(/^Servern kör en äldre version/);
    expect(incompatibleMessage({ protocol: 5, minClient: 5, release: null }, 2)).toMatch(/Ladda om sidan/);
  });
});

describe("karantän i felklasserna", () => {
  it("servern vägrade posten från den här användaren → quarantine; andra FORBIDDEN är reject", () => {
    expect(classifySyncError({ name: "TRPCClientError", data: { code: "FORBIDDEN", httpStatus: 403, syncRefusal: FOREIGN_ENTRY_REFUSAL } })).toBe("quarantine");
    expect(classifySyncError({ name: "TRPCClientError", data: { code: "FORBIDDEN", httpStatus: 403 } })).toBe("reject");
  });

  it("orsaken översätts till data.syncRefusal, bara för en SyncRefusal", () => {
    const refusal = new SyncRefusal(FOREIGN_ENTRY_REFUSAL);
    expect(refusal.name).toBe("SyncRefusal");
    expect(syncRefusalFromCause(refusal)).toBe("foreign-entry");
    expect(syncRefusalFromCause(new Error("x"))).toBeUndefined();
  });
});
