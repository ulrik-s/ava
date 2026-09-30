/** Enhetens id och etikett (#1267). */
import { describe, expect, it } from "vitest-compat";
import { deviceId, deviceLabel, type DeviceIdStorage } from "@/lib/client/sync/device-id";
import { isUuid } from "@/lib/shared/uuid";

function memoryStorage(): DeviceIdStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe("deviceId", () => {
  it("skapas en gång och återanvänds", () => {
    const storage = memoryStorage();
    const first = deviceId(storage);
    expect(isUuid(first)).toBe(true);
    expect(deviceId(storage)).toBe(first);
  });

  it("lagring som kastar → samma id för sessionen", () => {
    const broken: DeviceIdStorage = { getItem: () => { throw new Error("blockerad"); }, setItem: () => {} };
    const a = deviceId(broken);
    expect(isUuid(a)).toBe(true);
    expect(deviceId(broken)).toBe(a);
  });

  it("utan lagring → sessionens id", () => {
    expect(deviceId(undefined)).toBe(deviceId(undefined));
  });

  it("webbläsarens lagring används när inget injiceras", () => {
    expect(isUuid(deviceId())).toBe(true);
  });
});

describe("deviceLabel", () => {
  it("webbläsare och system", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("Chrome på macOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge på Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1")).toBe("Safari på iOS");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox på Linux");
  });

  it("bara det som känns igen; annars null", () => {
    expect(deviceLabel("curl/8.0 Linux")).toBe("Linux");
    expect(deviceLabel("Firefox/1.0")).toBe("Firefox");
    expect(deviceLabel("okänd")).toBeNull();
  });
});
