import { describe, it, expect, vi } from "vitest-compat";
import { downloadTextFile } from "@/lib/client/download-text";

describe("downloadTextFile", () => {
  it("skapar en Blob, klickar en <a download> och städar URL:en", () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    const urlDesc = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeDesc = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      downloadTextFile("bok.sie", "#FLAGGA 0\r\n");
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL.mock.calls[0]![0]).toBeInstanceOf(Blob);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    } finally {
      clickSpy.mockRestore();
      if (urlDesc) Object.defineProperty(URL, "createObjectURL", urlDesc);
      if (revokeDesc) Object.defineProperty(URL, "revokeObjectURL", revokeDesc);
    }
  });
});
