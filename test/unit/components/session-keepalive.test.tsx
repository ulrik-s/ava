/**
 * `SessionKeepalive` (#1425) — startar keepalive:n vid montering och stoppar
 * den vid avmontering.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { SessionKeepalive } from "@/components/shell/session-keepalive";

describe("SessionKeepalive", () => {
  it("startar vid montering, stoppar vid avmontering, renderar ingenting", () => {
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const { container, unmount } = render(<SessionKeepalive start={start} />);
    expect(start).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("utan injicerad start används webbläsarens keepalive (av i demon)", () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo" }));
    const { container, unmount } = render(<SessionKeepalive />);
    expect(container.innerHTML).toBe("");
    unmount();
    localStorage.removeItem("ava.firma");
  });
});
