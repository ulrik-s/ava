/**
 * GitHub-adaptern för intag-repot: rätt anrop med token, PR:er filtreras bort,
 * fel ger status men aldrig token, och konfigurationen läses ur env.
 */
import { describe, expect, it } from "vitest-compat";
import { feedbackConfigFromEnv, GithubFeedbackSink } from "@/lib/server/feedback/github-feedback-sink";

function fakeFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(json), { status }));
  };
  return { impl, calls };
}

const CONFIG = { token: "ghp_secret", repo: "ulrik-s/ava-feedback" };

describe("GithubFeedbackSink", () => {
  it("create postar issuen med token och returnerar numret", async () => {
    const f = fakeFetch(201, { number: 7 });
    const out = await new GithubFeedbackSink(CONFIG, f.impl).create({ title: "t", body: "b", labels: ["user-request"] });
    expect(out).toEqual({ number: 7 });
    expect(f.calls[0]?.url).toBe("https://api.github.com/repos/ulrik-s/ava-feedback/issues");
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect((f.calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer ghp_secret");
  });

  it("list mappar issues och hoppar över PR:er", async () => {
    const f = fakeFetch(200, [
      { number: 1, title: "a", body: null, state: "open", created_at: "2026-11-09T10:00:00Z", labels: [{ name: "user-request" }] },
      { number: 2, title: "pr", body: "", state: "closed", created_at: "2026-11-09T10:00:00Z", labels: [], pull_request: {} },
    ]);
    expect(await new GithubFeedbackSink(CONFIG, f.impl).list()).toEqual([
      { number: 1, title: "a", body: "", open: true, labels: ["user-request"], createdAt: "2026-11-09T10:00:00Z", comments: 0 },
    ]);
    expect(f.calls[0]?.url).toContain("labels=user-request&state=all");
  });

  it("comments läser kommentarerna med app-märket (null när ingen app)", async () => {
    const f = fakeFetch(200, [
      { id: 1, body: "hej", created_at: "2026-11-10T08:00:00Z", performed_via_github_app: { slug: "claude" } },
      { id: 2, body: null, created_at: "2026-11-10T09:00:00Z", performed_via_github_app: null },
    ]);
    expect(await new GithubFeedbackSink(CONFIG, f.impl).comments(7)).toEqual([
      { id: 1, body: "hej", createdAt: "2026-11-10T08:00:00Z", viaApp: "claude" },
      { id: 2, body: "", createdAt: "2026-11-10T09:00:00Z", viaApp: null },
    ]);
    expect(f.calls[0]?.url).toBe("https://api.github.com/repos/ulrik-s/ava-feedback/issues/7/comments?per_page=100");
  });

  it("comment postar texten som kommentar", async () => {
    const f = fakeFetch(201, { id: 3 });
    await new GithubFeedbackSink(CONFIG, f.impl).comment(7, "svar");
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect(f.calls[0]?.init?.body).toBe(JSON.stringify({ body: "svar" }));
  });

  it("fel från GitHub ger status, inte token", async () => {
    const f = fakeFetch(401, { message: "Bad credentials" });
    const err: unknown = await new GithubFeedbackSink(CONFIG, f.impl).list().catch((e: unknown) => e);
    expect(err instanceof Error ? err.message : "").toContain("401");
    expect(err instanceof Error ? err.message : "").not.toContain("ghp_secret");
  });
});

describe("feedbackConfigFromEnv", () => {
  it("av utan token eller repo", () => {
    expect(feedbackConfigFromEnv({})).toBeNull();
    expect(feedbackConfigFromEnv({ AVA_FEEDBACK_GITHUB_TOKEN: "x" })).toBeNull();
  });

  it("på med båda", () => {
    expect(feedbackConfigFromEnv({ AVA_FEEDBACK_GITHUB_TOKEN: " x ", AVA_FEEDBACK_REPO: "o/r" })).toEqual({ token: "x", repo: "o/r" });
  });

  it("ogiltigt repo avvisas", () => {
    expect(() => feedbackConfigFromEnv({ AVA_FEEDBACK_GITHUB_TOKEN: "x", AVA_FEEDBACK_REPO: "o/r/../x?y" })).toThrow(/owner\/repo/);
  });
});
