/**
 * `ReauthBanner` (#1351) — "Logga in igen" i stället för en hård omdirigering.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { ReauthBanner } from "@/components/shell/reauth-banner";
import { sessionNotice, setSessionNotice } from "@/lib/client/auth/session-notice";
import { notifyServerSynced } from "@/lib/client/sync/server-sync-flush";

afterEach(() => { act(() => { setSessionNotice(null); }); });

describe("ReauthBanner", () => {
  it("inget besked → ingenting", () => {
    render(<ReauthBanner />);
    expect(screen.queryByTestId("reauth-banner")).toBeNull();
  });

  it("visar beskedet; knappen går till inloggningen med tillbaka-länk", () => {
    const navigate = vi.fn();
    setSessionNotice("signed-out");
    render(<ReauthBanner navigate={navigate} />);
    expect(screen.getByTestId("reauth-banner")).toHaveTextContent(/Inloggningen har gått ut/);
    fireEvent.click(screen.getByRole("button", { name: "Logga in igen" }));
    expect(navigate).toHaveBeenCalledWith(`/oauth2/start?rd=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
  });

  it("dyker upp när beskedet sätts efter start, och försvinner efter en lyckad synk", () => {
    render(<ReauthBanner />);
    act(() => { setSessionNotice("token-expired"); });
    expect(screen.getByTestId("reauth-banner")).toHaveTextContent(/godtar inte längre/);
    act(() => { notifyServerSynced(); });
    expect(screen.queryByTestId("reauth-banner")).toBeNull();
    expect(sessionNotice()).toBeNull();
  });

  it("standardnavigeringen byter sida", () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    setSessionNotice("unreachable");
    render(<ReauthBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Logga in igen" }));
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^\/oauth2\/start\?rd=/));
    assign.mockRestore();
  });
});
