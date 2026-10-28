// Holding H temporarily switches to the Hand tool (like Photoshop and Illustrator, where holding a tool key uses it temporarily):
// if the canvas was dragged while it was held, or it was held long, releasing returns to the previous tool; a plain tap on H switches to Hand for good.
// Holding Space would clash with Space play / pause on video, so Space now only handles playback.
// This is a hold-type operation and useKeys only handles key down, so holdKeys.ts attaches its own keydown / keyup.
export const handHold = { held: false, panned: false };

export function isTypingTarget(target: EventTarget | null): boolean {
  // A slider (volume) takes no typing: holding H and Space still work
  if (target instanceof HTMLInputElement && target.type === "range") return false;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
  );
}
