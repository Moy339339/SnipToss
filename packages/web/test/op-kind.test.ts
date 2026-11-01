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

  it("only a changed position or size is a move; a place's new color is not", () => {
    expect(opKind(op(note([rect(0.1)]), note([rect(0.3)])))).toBe("move");
    expect(opKind(op(note([rect(0.1)]), note([rect(0.1, "#ffffff")])))).toBe("other");
  });
});
