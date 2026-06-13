import { describe, it, expect } from "vitest-compat";
import {
  buildStartCommands,
  buildStopCommands,
  logsCommand,
  extractAdminToken,
} from "../../tooling/scripts/install-server/orchestrate";

describe("buildStartCommands", () => {
  it("htpasswd: build-demo + compose up --wait (bara bas-compose)", () => {
    const cmds = buildStartCommands({ oidc: false });
    expect(cmds[0]).toEqual(["bash", "tooling/scripts/build-demo.sh"]);
    const up = cmds[1]!;
    expect(up.slice(0, 4)).toEqual(["docker", "compose", "-f", "tooling/docker/docker-compose.yml"]);
    expect(up).toContain("up");
    expect(up).toContain("--wait");
    expect(up).not.toContain("docker-compose.oidc.yml");
  });

  it("oidc: inkluderar overlay-filen", () => {
    const up = buildStartCommands({ oidc: true })[1]!;
    expect(up).toContain("tooling/docker/docker-compose.oidc-byoidp.yml");
    // bägge -f-filerna före up
    expect(up.indexOf("-f")).toBeLessThan(up.indexOf("up"));
  });
});

describe("buildStopCommands", () => {
  it("down -v (ta bort volymer)", () => {
    const [cmd] = buildStopCommands({ oidc: false });
    expect(cmd).toContain("down");
    expect(cmd).toContain("-v");
  });
});

describe("logsCommand", () => {
  it("hämtar web-loggen", () => {
    expect(logsCommand(false).slice(-2)).toEqual(["logs", "web"]);
  });
});

describe("extractAdminToken", () => {
  it("plockar 40-teckens token ur entrypoint-loggen", () => {
    const log = "[web] bootstrap\n[web]    Admin-token:      " + "a".repeat(40) + "\n[web] klar";
    expect(extractAdminToken(log)).toBe("a".repeat(40));
  });

  it("null när ingen token-rad finns", () => {
    expect(extractAdminToken("[web] inget här")).toBeNull();
  });

  it("ignorerar för korta/långa kandidater", () => {
    expect(extractAdminToken("Admin-token:   abc")).toBeNull();
  });
});
