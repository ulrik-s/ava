/**
 * Tester för SSH→HTTPS-rewrite. isomorphic-git stöder bara HTTPS
 * (browsern kan inte göra SSH), så om användarens clone har en
 * SSH-URL i .git/config översätter vi vid push/pull.
 */

import { describe, it, expect } from "vitest-compat";
import { sshToHttps } from "@/lib/client/fsa/url-rewrite";

describe("sshToHttps", () => {
  it("git@github.com:user/repo.git → https://github.com/user/repo.git", () => {
    expect(sshToHttps("git@github.com:ulrik-s/ava-demo.git"))
      .toBe("https://github.com/ulrik-s/ava-demo.git");
  });

  it("git@github.com:user/repo (utan .git) lämnas oförändrat suffix", () => {
    expect(sshToHttps("git@github.com:ulrik-s/ava-demo"))
      .toBe("https://github.com/ulrik-s/ava-demo");
  });

  it("ssh://git@github.com/user/repo.git → https://github.com/user/repo.git", () => {
    expect(sshToHttps("ssh://git@github.com/ulrik-s/ava-demo.git"))
      .toBe("https://github.com/ulrik-s/ava-demo.git");
  });

  it("redan HTTPS lämnas oförändrad", () => {
    expect(sshToHttps("https://github.com/user/repo.git"))
      .toBe("https://github.com/user/repo.git");
  });

  it("self-hosted SSH git@firma.se:repos/firma.git → https://firma.se/repos/firma.git", () => {
    expect(sshToHttps("git@firma.se:repos/firma.git"))
      .toBe("https://firma.se/repos/firma.git");
  });

  it("tom sträng → tom sträng", () => {
    expect(sshToHttps("")).toBe("");
  });
});
