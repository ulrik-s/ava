import { describe, it, expect } from "vitest-compat";
import { checkReadiness, handleHealthRoute, HEALTH_TIMEOUT_MS } from "@/lib/server/http/health";

/**
 * Hälsokontrollen (#1079) är det övervakningen agerar på. Går den sönder
 * tyst — svarar frisk när tjänsten är död — startas ingenting om, och felet
 * upptäcks först när en användare hör av sig.
 *
 * Därför testas i första hand FELVÄGARNA: att den faktiskt fäller.
 */
const ok = (): Promise<number> => Promise.resolve(1);
const broken = (): Promise<never> => Promise.reject(new Error("ECONNREFUSED"));
const hangs = (): Promise<never> => new Promise(() => { /* svarar aldrig */ });

describe("checkReadiness", () => {
  it("är ok när databasen svarar", async () => {
    const r = await checkReadiness(ok);
    expect(r.status).toBe("ok");
    expect(r.checks.database?.ok).toBe(true);
  });

  it("är degraded när databasen vägrar anslutning", async () => {
    const r = await checkReadiness(broken);
    expect(r.status).toBe("degraded");
    expect(r.checks.database?.ok).toBe(false);
  });

  // Orsaken måste följa med, annars står felsökaren med "degraded" och inget mer.
  it("bär med sig orsaken", async () => {
    const r = await checkReadiness(broken);
    expect(r.checks.database?.detail).toContain("ECONNREFUSED");
  });

  // Det här är hela poängen: en hängd db får INTE hänga hälsokontrollen, för
  // då svarar den inte alls och övervakningen tolkar tystnaden som nätverksfel.
  it("faller på tidsgränsen i st.f. att hänga med databasen", async () => {
    const r = await checkReadiness(hangs, 20);
    expect(r.status).toBe("degraded");
    expect(r.checks.database?.detail).toContain("timeout");
  });

  it("kastar aldrig — ett fel ÄR svaret", async () => {
    await expect(checkReadiness(() => { throw new Error("synkront smäll"); })).resolves.toBeDefined();
  });

  it("har ett kort default-tak — en hälsokontroll ska svara, inte vänta", () => {
    expect(HEALTH_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("handleHealthRoute", () => {
  it("svarar 200 på /healthz utan att röra databasen", async () => {
    // `broken` skulle fälla readiness — liveness ska inte bry sig.
    const res = await handleHealthRoute("/healthz", broken);
    expect(res?.status).toBe(200);
  });

  it("svarar 200 på /readyz när databasen lever", async () => {
    const res = await handleHealthRoute("/readyz", ok);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({ status: "ok" });
  });

  // 503 är det en lastbalanserare och autoheal faktiskt läser — 200 med
  // "degraded" i kroppen hade sett friskt ut för allt utom en människa.
  it("svarar 503 på /readyz när databasen är nere", async () => {
    const res = await handleHealthRoute("/readyz", broken);
    expect(res?.status).toBe(503);
  });

  it("släpper igenom andra sökvägar till tRPC", async () => {
    expect(await handleHealthRoute("/api/trpc/matter.list", ok)).toBeNull();
  });

  it("cachas aldrig — ett gammalt friskt svar är farligare än inget", async () => {
    const res = await handleHealthRoute("/readyz", ok);
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });
});
