/**
 * `/msal-redirect/` lämnar bara tillbaka MSAL-svaret till fönstret som
 * öppnade popupen (MSAL v5:s redirect bridge, #1950).
 */
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import MsalRedirectPage from "@/app/msal-redirect/page";

const broadcast = vi.fn(() => Promise.resolve());
vi.mock("@azure/msal-browser/redirect-bridge", () => ({ broadcastResponseToMainFrame: () => broadcast() }));

afterEach(() => {
  broadcast.mockReset();
  broadcast.mockImplementation(() => Promise.resolve());
  vi.restoreAllMocks();
});

describe("/msal-redirect/", () => {
  it("lämnar tillbaka svaret en gång och ritar ingen AVA-ram", () => {
    const { container } = render(<MsalRedirectPage />);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
  });

  it("ett svar som inte går att lämna tillbaka loggas", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    broadcast.mockImplementation(() => Promise.reject(new Error("no_token_request_cache_error")));
    render(<MsalRedirectPage />);
    await waitFor(() => expect(error).toHaveBeenCalledWith(
      "[msal-redirect] svaret kunde inte lämnas tillbaka:", expect.any(Error),
    ));
  });
});
