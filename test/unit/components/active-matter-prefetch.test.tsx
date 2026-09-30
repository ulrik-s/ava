/**
 * `ActiveMatterPrefetch` (#1244): startar förladdningen när klientstoren finns.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

const stop = vi.fn();
const start = vi.fn((_deps: unknown) => stop);
const loadDocumentBlob = vi.fn(async () => null);
const extractText = vi.fn(async () => "text");
let principalId = "u-anna";
vi.mock("@/lib/client/firma/start-active-matter-prefetch", () => ({ startActiveMatterPrefetch: start }));
vi.mock("@/lib/client/backend/server-download-client", () => ({ createServerDownloadClient: () => ({ client: true }) }));
vi.mock("@/lib/client/backend/load-document-blob", () => ({ loadDocumentBlob }));
vi.mock("@/lib/client/firma/firma-config", () => ({ loadFirmaConfig: () => ({ principalId }) }));
vi.mock("@/lib/client/backend/local-document-text", () => ({ LocalDocumentTextStore: class { kind = "texts"; } }));
vi.mock("@/lib/shared/extract-text", () => ({ extractText }));

const { ActiveMatterPrefetch } = await import("@/components/shell/active-matter-prefetch");

interface Deps {
  userId: string;
  source: () => unknown;
  loadBlob: (d: unknown) => Promise<unknown>;
  extract: (i: unknown) => Promise<string>;
}
const lastDeps = (): Deps => start.mock.calls.at(-1)?.[0] as Deps;

beforeEach(() => { principalId = "u-anna"; vi.clearAllMocks(); });

describe("ActiveMatterPrefetch", () => {
  it("utan store (uppstart) startar ingenting", () => {
    render(<ActiveMatterPrefetch store={null} />);
    expect(start).not.toHaveBeenCalled();
  });

  it("med store: startar som den inloggade, läser storens rader och stoppar vid avmontering", async () => {
    const source = { matters: [] };
    const { unmount } = render(<ActiveMatterPrefetch store={{ store: { currentSource: source } }} />);
    const deps = lastDeps();
    expect(deps.userId).toBe("u-anna");
    expect(deps.source()).toBe(source);
    await deps.loadBlob({ id: "d1" });
    expect(loadDocumentBlob).toHaveBeenCalledWith({ client: true }, { id: "d1" });
    expect(await deps.extract({ bytes: new Uint8Array() })).toBe("text");
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("utan sparat id: samma reserv-id som den lokala routern", () => {
    principalId = "";
    render(<ActiveMatterPrefetch store={{ store: { currentSource: {} } }} />);
    expect(lastDeps().userId).toBe("current-user");
  });
});
