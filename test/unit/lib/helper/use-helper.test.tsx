/**
 * Tests för useHelper() — mockar fetch mot localhost:48761.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, waitFor } from "@testing-library/react";
import { useHelper, openViaHelper } from "@/lib/client/helper/use-helper";

const originalFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

function Probe(): React.ReactElement {
  const s = useHelper();
  if (!s.checked) return <p>loading</p>;
  return <p>{s.version ?? "absent"}</p>;
}

describe("useHelper", () => {
  it("returnerar version-strängen när helpern svarar", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("ava-helper v1.2.3\n", { status: 200 }));
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("v1.2.3")).toBeInTheDocument());
  });

  it("returnerar null när /ping inte svarar (helper inte installerad)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("absent")).toBeInTheDocument());
  });

  it("returnerar null vid trasig response-text", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("garbage", { status: 200 }));
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("absent")).toBeInTheDocument());
  });
});

describe("openViaHelper", () => {
  it("POST:ar /open med JSON och kastar vid fel", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 200 }));
    global.fetch = fetchMock;
    await openViaHelper({ fileName: "x.pdf", downloadUrl: "https://example.com/x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("http://127.0.0.1:48761/open");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toMatchObject({ fileName: "x.pdf" });
  });

  it("kastar vid 4xx-respons", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("oops", { status: 400 }));
    await expect(openViaHelper({ fileName: "x.pdf", downloadUrl: "u" })).rejects.toThrow(/HTTP 400/);
  });
});

describe("triggerHelperUpdateCheck", () => {
  it("anropar /check-update tyst (sväljer fel)", async () => {
    const { triggerHelperUpdateCheck } = await import("@/lib/client/helper/use-helper");
    const fetchMock = vi.fn().mockRejectedValue(new Error("net"));
    global.fetch = fetchMock;
    // Ska INTE kasta även om fetch misslyckas
    await expect(triggerHelperUpdateCheck()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:48761/check-update", expect.objectContaining({ method: "POST" }));
  });
});
