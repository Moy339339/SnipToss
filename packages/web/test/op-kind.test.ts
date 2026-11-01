import { describe, expect, it } from "vitest";
import type { Annotation, MaterialFile } from "@sniptoss/core";
import { opKind, type Op } from "../src/annotationStore";

const rect = (x: number, color?: string) => ({ type: "rect" as const, x, y: 0.1, w: 0.2, h: 0.2, ...(color ? { color } : {}) });
const note = (shapes: ReturnType<typeof rect>[], extra: Partial<Annotation> = {}) =>
  ({ id: "a1", body: "改成圆角", category: "change", status: "open", anchor: { shapes }, ...extra }) as unknown as Annotation;
const file = (...annotations: Annotation[]) => ({ annotations }) as unknown as MaterialFile;
const op = (before: Annotation, after: Annotation): Op => ({ key: "k", home: "h", before: file(before), after: file(after) });

describe("what the undo toast says a step changed", () => {
  it("a place removed from a note (or added) edits the note; it is not a move", () => {
    expect(opKind(op(note([rect(0.1), rect(0.5)]), note([rect(0.1)])))).toBe("edit");
    expect(opKind(op(note([rect(0.1)]), note([rect(0.1), rect(0.5)])))).toBe("edit");
  });

  it("only a changed position is a move; a place's new color is not", () => {
    expect(opKind(op(note([rect(0.1)]), note([rect(0.3)])))).toBe("move");
    expect(opKind(op(note([rect(0.1)]), note([rect(0.1, "#ffffff")])))).toBe("other");
  });

  it("a handle that changes a place's size is a resize, even when the place also shifts", () => {
    const wider = { ...rect(0.1), w: 0.3 };
    expect(opKind(op(note([rect(0.1)]), note([wider])))).toBe("resize");
    // Dragging the top-left corner moves x and y and changes the size together
    expect(opKind(op(note([rect(0.1)]), note([{ ...rect(0.05), y: 0.05, w: 0.25, h: 0.25 }])))).toBe("resize");
    expect(opKind(op(note([rect(0.1), rect(0.5)]), note([rect(0.1), { ...rect(0.5), h: 0.4 }])))).toBe("resize");
  });

  it("an arrow moves when both ends shift together and resizes when one end is dragged; points and freehand only move", () => {
    const arrow = (from: [number, number], to: [number, number]) => ({ type: "arrow" as const, from, to });
    const one = (shape: object) => note([shape as ReturnType<typeof rect>]);
    expect(opKind(op(one(arrow([0.1, 0.1], [0.4, 0.3])), one(arrow([0.2, 0.15], [0.5, 0.35]))))).toBe("move");
    expect(opKind(op(one(arrow([0.1, 0.1], [0.4, 0.3])), one(arrow([0.1, 0.1], [0.6, 0.3]))))).toBe("resize");
    expect(opKind(op(one({ type: "point", x: 0.1, y: 0.1 }), one({ type: "point", x: 0.3, y: 0.2 })))).toBe("move");
    const path = (dx: number) => ({
      type: "path",
      points: [
        [0.1 + dx, 0.1],
        [0.2 + dx, 0.3],
      ],
    });
    expect(opKind(op(one(path(0)), one(path(0.1))))).toBe("move");
  });
});
