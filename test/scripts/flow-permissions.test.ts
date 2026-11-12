/**
 * Agenternas förhandsgodkända skrivningar (#1557): `.claude/settings.json`
 * är exakt listan som flödet ger, och varje skrivning i promptarna matchar en
 * regel — så att en agent aldrig nekas något flödet tillåter, och aldrig får
 * mer.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { agentAllowRules, renderSettings, ruleCommand, SETTINGS_PATH } from "../../tooling/scripts/flow/permissions";

const flow = loadFlow();
const settingsSchema = z.object({ permissions: z.object({ allow: z.array(z.string()) }) });
const allow = parseJsonWith(settingsSchema, readFileSync(SETTINGS_PATH, "utf8")).permissions.allow;

/** En allow-regel som reguljärt uttryck: `*` matchar vad som helst. */
function asRegex(rule: string): RegExp {
  const body = rule.replace(/^Bash\(/, "").replace(/\)$/, "");
  return new RegExp(`^${body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
}

/** Skrivande `gh api`-rader i promptarnas bash-block. */
function promptWrites(): Array<{ file: string; line: string }> {
  return readdirSync("tooling/agents").filter((f) => f.endsWith(".md")).flatMap((file) => {
    const blocks = [...readFileSync(`tooling/agents/${file}`, "utf8").matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
    return blocks.flatMap((b) => b.split("\n"))
      .map((l) => l.trim())
      .filter((l) => l.startsWith("gh api ") && /\/(labels|comments|merge|dispatches)\b/.test(l))
      .filter((l) => /\s-X (POST|PUT|PATCH|DELETE)\s|\s-[fF]\s/.test(l))
      .map((line) => ({ file, line }));
  });
}

describe("förhandsgodkända skrivningar", () => {
  it(".claude/settings.json är exakt listan som flödet ger (inget saknas, inget extra)", () => {
    expect([...allow].sort()).toEqual(agentAllowRules(flow));
  });

  it("filen som Ulrik klistrar in är den genererade", () => {
    expect(parseJsonWith(settingsSchema, renderSettings(flow)).permissions.allow).toEqual(agentAllowRules(flow));
  });

  it("varje skrivning i promptarnas kodblock matchar en förhandsgodkänd regel", () => {
    const writes = promptWrites();
    expect(writes.length).toBeGreaterThan(5);
    expect(writes.filter((w) => !allow.some((r) => asRegex(r).test(w.line)))).toEqual([]);
  });

  it("verifierad och människa-godkänd förhandsgodkänns aldrig som tillägg", () => {
    const risky = agentAllowRules(flow).filter((r) => r.includes("'labels[]=verifierad'") || r.includes("människa") || r.includes("m%C3%A4nniska"));
    expect(risky).toEqual([]);
  });

  it("kommandot ur en regel ersätter jokrarna med N", () => {
    expect(ruleCommand("Bash(gh api -X PUT repos/a/b/pulls/*/merge -f sha=*)")).toBe("gh api -X PUT repos/a/b/pulls/N/merge -f sha=*");
  });
});
