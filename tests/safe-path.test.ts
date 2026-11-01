import { describe, expect, it } from "vitest";
import { isLocalPath } from "@/lib/safe-path";

describe("isLocalPath", () => {
  it("accepts paths on this site", () => {
    for (const p of ["/patients", "/patients/1?tab=perio&pv=2#perio", "/", "/%5Cx"]) expect(isLocalPath(p)).toBe(true);
  });
  it("refuses anything a browser reads as another site", () => {
    for (const p of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "/\tx", "/x\ny", "", null, undefined, 1])
      expect(isLocalPath(p)).toBe(false);
  });
});
