/**
 * `CapabilitiesProvider` + `useCapabilities` (ADR 0027 / #641) — synkron
 * tier-baslinje + server-probe-förfining; fungerar även utan provider.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { CapabilitiesProvider, useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { SELF_HOSTED_CAPABILITIES } from "@/lib/shared/capabilities";

const probeMock = vi.fn();
vi.mock("@/lib/client/capabilities/probe-capabilities", () => ({
  probeCapabilities: probeMock,
}));

function Probe() {
  const caps = useCapabilities();
  return <div data-testid="llm">{String(caps.llm)}</div>;
}

describe("useCapabilities / CapabilitiesProvider", () => {
  beforeEach(() => {
    probeMock.mockReset();
    window.localStorage.clear();
  });

  it("utan provider → tier-baslinje (jsdom = self-hosted → llm true)", () => {
    render(<Probe />);
    expect(screen.getByTestId("llm").textContent).toBe("true");
  });

  it("demo-tier → ingen probe, llm false", () => {
    window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo", repo: "u/r" }));
    render(<CapabilitiesProvider><Probe /></CapabilitiesProvider>);
    expect(screen.getByTestId("llm").textContent).toBe("false");
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("self-hosted → probar servern och förfinar (llm:false trots self-hosted-baslinje)", async () => {
    window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "self-hosted", repo: "" }));
    probeMock.mockResolvedValue({ ...SELF_HOSTED_CAPABILITIES, llm: false });
    render(<CapabilitiesProvider><Probe /></CapabilitiesProvider>);
    await waitFor(() => expect(screen.getByTestId("llm").textContent).toBe("false"));
    expect(probeMock).toHaveBeenCalled();
  });

  it("self-hosted, probe-miss → behåll tier-baslinjen", async () => {
    window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "self-hosted", repo: "" }));
    probeMock.mockResolvedValue(null);
    render(<CapabilitiesProvider><Probe /></CapabilitiesProvider>);
    await waitFor(() => expect(probeMock).toHaveBeenCalled());
    expect(screen.getByTestId("llm").textContent).toBe("true"); // baslinjen kvar
  });
});
