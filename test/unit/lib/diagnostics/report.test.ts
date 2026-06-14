import { describe, it, expect } from "vitest-compat";
import type { LogEntry } from "@/lib/client/diagnostics/log-buffer";
import {
  buildIssueReport,
  githubIssueNewUrl,
  DEFAULT_MAX_URL_LENGTH,
} from "@/lib/client/diagnostics/report";
import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";

const repo = { owner: "ulrik-s", repo: "ava" };

const violation: InvariantViolation = {
  code: "KR_PENDING_NO_DOC",
  severity: "error",
  message: "Kostnadsräkning väntar på dom men saknar dokument.",
  context: { matterId: "m-1", billingRunId: "br-1" },
};

const logs: LogEntry[] = [
  { level: "error", ts: 0, text: "trasig grej" },
  { level: "warn", ts: 1000, text: "varning" },
];

describe("buildIssueReport", () => {
  it("använder första raden av fritext som titel", () => {
    const r = buildIssueReport({ userText: "Knappen funkar inte\nmer detaljer" });
    expect(r.title).toBe("[AVA] Knappen funkar inte");
    expect(r.body).toContain("### Beskrivning");
    expect(r.body).toContain("mer detaljer");
  });

  it("titlar efter invariant-kod när fritext saknas", () => {
    const r = buildIssueReport({ violations: [violation] });
    expect(r.title).toBe("[AVA] Självupptäckt: KR_PENDING_NO_DOC");
  });

  it("default-titel när varken text eller violations finns", () => {
    expect(buildIssueReport({}).title).toBe("[AVA] Felrapport");
    expect(buildIssueReport({}).body).toBe("_Ingen beskrivning angavs._");
  });

  it("inkluderar violations, meta och logg-sektioner", () => {
    const r = buildIssueReport({
      userText: "fel",
      violations: [violation],
      meta: { tier: "demo", url: "https://x/ava/matters/1" },
      logs,
    });
    expect(r.body).toContain("### Självupptäckta fel");
    expect(r.body).toContain("KR_PENDING_NO_DOC");
    expect(r.body).toContain("matterId=m-1, billingRunId=br-1");
    expect(r.body).toContain("### Miljö");
    expect(r.body).toContain("**tier:** demo");
    expect(r.body).toContain("### Konsol-logg");
    expect(r.body).toContain("ERROR trasig grej");
  });

  it("placerar loggen sist (trunkeras först)", () => {
    const r = buildIssueReport({ userText: "x", violations: [violation], logs });
    expect(r.body.indexOf("### Självupptäckta fel")).toBeLessThan(r.body.indexOf("### Konsol-logg"));
  });
});

describe("githubIssueNewUrl", () => {
  it("bygger en korrekt prefill-URL utan trunkering för korta rapporter", () => {
    const url = githubIssueNewUrl({ repo, title: "[AVA] hej", body: "kort body" });
    expect(url.startsWith("https://github.com/ulrik-s/ava/issues/new?")).toBe(true);
    const qs = new URL(url).searchParams;
    expect(qs.get("title")).toBe("[AVA] hej");
    expect(qs.get("body")).toBe("kort body");
  });

  it("trunkerar body så hela URL:en håller sig under maxLength", () => {
    const body = "x".repeat(5000);
    const url = githubIssueNewUrl({ repo, title: "[AVA] t", body, maxLength: 500 });
    expect(url.length).toBeLessThanOrEqual(500);
    expect(new URL(url).searchParams.get("body")).toContain("trunkerad");
  });

  it("respekterar default-maxlängden", () => {
    const body = "rad\n".repeat(5000);
    const url = githubIssueNewUrl({ repo, title: "[AVA] t", body });
    expect(url.length).toBeLessThanOrEqual(DEFAULT_MAX_URL_LENGTH);
  });

  it("trunkerad URL bevarar början av body", () => {
    const body = "VIKTIG_START " + "y".repeat(5000);
    const url = githubIssueNewUrl({ repo, title: "[AVA] t", body, maxLength: 600 });
    expect(new URL(url).searchParams.get("body")).toContain("VIKTIG_START");
  });
});
