import { describe, expect, it } from "vitest";
import { formatSize } from "../src/formatSize";

describe("formatSize (the file size in the toolbar)", () => {
  it("B / KB / MB / GB each have a tier", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(26_458)).toBe("26 KB");
    expect(formatSize(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatSize(3.5 * 1024 ** 3)).toBe("3.50 GB");
  });

  it("once rounding reaches 1024 it moves up a tier: never 1024 KB or 1024.0 MB", () => {
    expect(formatSize(1024 * 1024 - 300)).toBe("1.0 MB");
    expect(formatSize(1024 ** 3 - 20_000)).toBe("1.00 GB");
    expect(formatSize(1024 * 1023)).toBe("1023 KB");
  });
});
