/**
 * "Logga in igen"-beskedet (#1351): en modul-global som bannern lyssnar på.
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import {
  sessionNotice, sessionNoticeOffersLogin, sessionNoticeText, setSessionNotice, subscribeSessionNotice,
} from "@/lib/client/auth/session-notice";

afterEach(() => { setSessionNotice(null); });

describe("session-notice", () => {
  it("lyssnare får veta när beskedet ändras — men inte när det sätts till samma igen", () => {
    const listener = vi.fn();
    const off = subscribeSessionNotice(listener);
    setSessionNotice("signed-out");
    setSessionNotice("signed-out");
    expect(sessionNotice()).toBe("signed-out");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setSessionNotice(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sessionNotice()).toBeNull();
  });

  it("varje besked säger att man arbetar lokalt", () => {
    for (const notice of ["signed-out", "token-expired", "unreachable", "account-inactive"] as const) {
      expect(sessionNoticeText(notice)).toMatch(/arbetar lokalt/);
    }
  });

  it("spärrat konto: beskedet säger att kontot inte längre är aktivt (#1962)", () => {
    expect(sessionNoticeText("account-inactive")).toMatch(/inte längre aktivt i byrån/);
  });

  it("bara det spärrade kontot saknar 'Logga in igen' (#1962)", () => {
    expect(sessionNoticeOffersLogin("account-inactive")).toBe(false);
    for (const notice of ["signed-out", "token-expired", "unreachable"] as const) {
      expect(sessionNoticeOffersLogin(notice)).toBe(true);
    }
  });
});
