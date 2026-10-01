/**
 * Skälet till ett 401 (#1351) — bärs som `cause` på servern och läses ur
 * `data.authFailure` på klienten.
 */
import { describe, expect, it } from "vitest-compat";
import { AuthFailureError, authFailureFromCause, authFailureOf } from "@/lib/shared/auth-failure";

describe("auth-failure", () => {
  it("servern: skälet ur ett AuthFailureError, annars null", () => {
    expect(authFailureFromCause(new AuthFailureError("token-expired"))).toBe("token-expired");
    expect(authFailureFromCause(new Error("annat"))).toBeNull();
    expect(authFailureFromCause(undefined)).toBeNull();
  });

  it("felet går att läsa i loggen", () => {
    const err = new AuthFailureError("account-inactive");
    expect(err.name).toBe("AuthFailureError");
    expect(err.message).toContain("account-inactive");
  });

  it("klienten: skälet ur data.authFailure — okända värden och saknad data ger null", () => {
    expect(authFailureOf({ data: { authFailure: "account-inactive" } })).toBe("account-inactive");
    expect(authFailureOf({ data: { authFailure: "påhittat" } })).toBeNull();
    expect(authFailureOf({ data: null })).toBeNull();
    expect(authFailureOf({ meta: { response: { status: 401 } } })).toBeNull();
    expect(authFailureOf(null)).toBeNull();
  });
});
