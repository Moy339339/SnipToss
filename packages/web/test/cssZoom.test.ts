import { afterEach, describe, expect, it, vi } from "vitest";
import { cssZoom } from "../src/cssZoom";

// A chain of fake elements: zooms[0] is the element, the last one the root; each one's computed zoom is the string given
function chain(zooms: string[], extra: Record<string, unknown> = {}): Element {
  const els: Array<Record<string, unknown>> = zooms.map((zoom) => ({ zoom }));
  els.forEach((e, i) => (e.parentElement = els[i + 1] ?? null));
  Object.assign(els[0]!, extra);
  return els[0] as unknown as Element;
}

describe("cssZoom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses currentCSSZoom when the engine has it", () => {
    const computed = vi.fn(() => ({ zoom: "9" }));
    vi.stubGlobal("getComputedStyle", computed);
    expect(cssZoom(chain(["1", "1"], { currentCSSZoom: 1.25 }))).toBe(1.25);
    expect(computed).not.toHaveBeenCalled();
  });

  describe("without currentCSSZoom (WebKit)", () => {
    const stub = () => vi.stubGlobal("getComputedStyle", (e: { zoom: string }) => ({ zoom: e.zoom }));

    it("multiplies the computed zoom of the element and all its ancestors", () => {
      stub();
      expect(cssZoom(chain(["1", "1", "1.5"]))).toBe(1.5);
      expect(cssZoom(chain(["1", "0.8", "1.25"]))).toBeCloseTo(1, 10);
      expect(cssZoom(chain(["2", "1", "1.25"]))).toBe(2.5);
    });

    it("reads percentages and treats normal or garbage as no zoom", () => {
      stub();
      expect(cssZoom(chain(["normal", "125%"]))).toBe(1.25);
      expect(cssZoom(chain(["", "1.25"]))).toBe(1.25);
      expect(cssZoom(chain(["0", "1.25"]))).toBe(1.25);
      expect(cssZoom(chain(["-1", "1.25"]))).toBe(1.25);
    });

    it("is 1 with no zoom anywhere", () => {
      stub();
      expect(cssZoom(chain(["1", "1", "1"]))).toBe(1);
    });
  });
});
