import { useEffect, useEffectEvent, useState } from "react";

/**
 * Dragging files into the window (anywhere in it). Returns whether a drag is in progress (to show "Drop to add to the library").
 * dragenter / dragleave fire repeatedly between child elements, so a counter decides whether the drag really left
 */
export function useFileDrop(onDrop: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  // The listeners are attached once but must call the latest onDrop on drop: use an Effect Event instead of writing a ref during render (react(refs))
  const dropped = useEffectEvent(onDrop);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    // Text and URLs dragged into an input go in as usual (everything used to be blocked, so dragging selected text while writing a note
    // did nothing); drags elsewhere are still blocked (WebView2 would open a dropped link)
    const editable = (e: DragEvent) => e.target instanceof HTMLElement && !!e.target.closest("input, textarea, [contenteditable]");
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) {
        if (!editable(e)) e.preventDefault();
        return;
      }
      // If not blocked, WebView2 navigates straight to the dropped file and the whole UI is gone
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) {
        if (!editable(e)) e.preventDefault();
        return;
      }
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) dropped(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}
