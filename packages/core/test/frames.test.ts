import { describe, expect, it } from "vitest";
import { formatTimecode, fpsLabel, frameAt } from "../src/frames";

describe("frameAt", () => {
  it("counts from 0 and rounds down: frame = floor(seconds × rate)", () => {
    expect(frameAt(0, 30)).toBe(0);
    expect(frameAt(12.5, 30)).toBe(375);
    expect(frameAt(1 / 30 - 0.001, 30)).toBe(0);
    expect(frameAt(-0.2, 30)).toBe(0);
  });
  it("a time on a frame's start stays on that frame despite floating-point error", () => {
    // 0.7 × 30 = 20.999999999999996 in floating point
    expect(frameAt(0.7, 30)).toBe(21);
    expect(frameAt(1001 / 30000, 30000 / 1001)).toBe(1);
  });
  it("the middle of a frame, where stepping lands, maps back to that frame", () => {
    for (const fps of [23.976023976, 24, 25, 29.97002997, 30, 50, 59.94005994, 60]) {
      for (const n of [0, 1, 17, 1798, 1800, 17982, 107892]) expect(frameAt(Math.round(((n + 0.5) / fps) * 1000) / 1000, fps)).toBe(n);
    }
  });
});

describe("fpsLabel", () => {
  it("at most three decimals, without trailing zeros", () => {
    expect(fpsLabel(30)).toBe("30");
    expect(fpsLabel(29.97002997)).toBe("29.97");
    expect(fpsLabel(23.976023976)).toBe("23.976");
    expect(fpsLabel(59.94005994)).toBe("59.94");
    expect(fpsLabel(12.5)).toBe("12.5");
  });
});

describe("formatTimecode", () => {
  it("whole-number rates count frames from 0 to rate − 1 (non-drop)", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(375, 30)).toBe("00:00:12:15");
    expect(formatTimecode(29, 30)).toBe("00:00:00:29");
    expect(formatTimecode(24 * 3600, 24)).toBe("01:00:00:00");
    expect(formatTimecode(49, 25)).toBe("00:00:01:24");
  });
  it("29.97 uses drop-frame: ;00 and ;01 are skipped at each minute except every tenth", () => {
    const fps = 30000 / 1001;
    expect(formatTimecode(1799, fps)).toBe("00:00:59;29");
    expect(formatTimecode(1800, fps)).toBe("00:01:00;02");
    expect(formatTimecode(17981, fps)).toBe("00:09:59;29");
    expect(formatTimecode(17982, fps)).toBe("00:10:00;00");
    expect(formatTimecode(107892, fps)).toBe("01:00:00;00");
  });
  it("59.94 drops four labels a minute", () => {
    const fps = 60000 / 1001;
    expect(formatTimecode(3599, fps)).toBe("00:00:59;59");
    expect(formatTimecode(3600, fps)).toBe("00:01:00;04");
    expect(formatTimecode(35964, fps)).toBe("00:10:00;00");
  });
  it("23.976 counts as 24 without dropping (as editing software does)", () => {
    expect(formatTimecode(24, 24000 / 1001)).toBe("00:00:01:00");
  });
});
