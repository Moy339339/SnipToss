import { useEffect, useEffectEvent, useRef } from "react";
import "./demo.css";

/**
 * The onboarding animations: a miniature of the window acting out what to do (drag a picture in, box what should change, write the note,
 * copy, paste to the AI, the picture comes back changed). Drawn in code rather than recorded: it holds no words (so it is the same in every
 * language), takes the interface colors from the tokens, stays sharp at any interface size and weighs a few KB plus two small pictures.
 * - loop: the whole circle, on the welcome page; onPhase tells which of the three steps it is acting out
 * - tool / mark / write / copy: one step each, in the guide's small window (Guide.tsx), with the camera on the part that matters;
 *   paste: what follows the last step (paste to the AI, the picture comes back changed); whole: an overall comment, which has no place on the picture
 * - capture: Screen Capture, in the hint next to its button (Hint.tsx): press the button, the screen dims, drag over what to capture,
 *   box a place in it and write the note, press Done, paste the picture to the AI
 * - the other first-use hints (Hint.tsx), one feature each: pin (click to pin; while writing, click elsewhere and the same note marks
 *   another place), color (click a mark, pick a color from the row beside it), drawing (a line left without a word, by a click on the
 *   blank canvas, stays, unnumbered; a double-click on it adds the note), kinds (copied as text it goes to an AI working in a terminal, as images to a chat on the web),
 *   video (a mark belongs to the frame it was made on: playing on, it goes; back at that moment from its number on the play bar, it is there)
 * Everything that moves is changed on the DOM directly (classes, the Web Animations API), not through React state.
 * With "reduce motion" on in the system it shows one still frame instead
 */
export type DemoScene =
  "loop" | "tool" | "mark" | "write" | "copy" | "paste" | "whole" | "capture" | "pin" | "color" | "drawing" | "kinds" | "video";

/** A part of the 720 × 450 miniature that the box shows */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
const WHOLE: View = { x: 0, y: 0, w: 720, h: 450 };
/** The canvas area, from the toolbar down (the steps look at it a little lower, with the whole picture in view) */
const CANVAS: View = { x: 132, y: 24, w: 416, h: 290 };
/** The picture, without the toolbar */
const PICTURE: View = { ...CANVAS, y: 96 };
/** The bottom right: the notes panel's copy buttons, and room on the left for where the copy goes */
const DOCK: View = { x: 304, y: 160, w: 416, h: 290 };
const VIEWS: Record<DemoScene, View> = {
  loop: WHOLE,
  tool: CANVAS,
  whole: CANVAS,
  mark: PICTURE,
  write: PICTURE,
  copy: DOCK,
  paste: { x: 120, y: 24, w: 600, h: 418 },
  // The top right of the window, where the Capture button is; what is on the screen is drawn in this part
  capture: { x: 304, y: 0, w: 416, h: 260 },
  pin: PICTURE,
  color: PICTURE,
  drawing: PICTURE,
  kinds: DOCK,
  // The picture and the play bar under it
  video: { ...CANVAS, y: 116 },
};
/** Screen Capture ends on the AI's window: the same proportions, further back */
const CAPTURE_CHAT: View = { x: 150, y: 46, w: 624, h: 390 };
const PANEL: View = { ...CANVAS, x: 304 };

/** Where things are in the miniature */
const BOX = { x: 175, y: 190, w: 180, h: 47 };
const PIN = { x: 484, y: 174 };
const NOTE1 = { x: 175, y: 246 };
const NOTE2 = { x: 318, y: 188 };
const COPY = { x: 676, y: 432 };
const RECT_TOOL = { x: 231, y: 39 };
const WHOLE_TOOL = { x: 330, y: 39 };
const NOTE_WHOLE = { x: 262, y: 64 };
/** Screen Capture: its button in the title bar, what is dragged over on the screen, the place boxed in it, its note, and "Done" on the bar under the selection */
const CAP_BUTTON = { x: 627, y: 12 };
const CAP_SEL = { x: 330, y: 70, w: 220, h: 156 };
const CAP_BOX = { x: 454, y: 107, w: 36, h: 102 };
const CAP_NOTE = { x: 497, y: 112 };
const CAP_DONE = { x: 529, y: 242 };
/** Pin: the two grapefruit slices, one note for both */
const PIN_A = { x: 379, y: 198 };
const PIN_B = { x: 482, y: 292 };
const NOTE_PIN = { x: 214, y: 204 };
/** Color: the row beside the clicked badge (the headline's box), and the yellow swatch in it */
const COLORS = { x: 167, y: 154 };
const SWATCHES = ["#ff6a3d", "#ff4d6d", "#ffc233", "#3ddc84", "#5b8cff", "#b07cff"];
const YELLOW = { x: COLORS.x + 4 + 2 * 20 + 7, y: COLORS.y + 4 + 7 };
/** Drawing: a loop around the "Get a case" button, its note, the blank canvas under the picture that is clicked to leave it, and where the line is double-clicked */
const INK =
  "M236 290C232 276 214 273 197 274C178 275 162 282 163 292C164 303 184 310 203 309C223 308 240 301 239 291C238 284 233 280 226 278";
const INK_BADGE = { x: 163, y: 275 };
const NOTE_INK = { x: 248, y: 296 };
const LEAVE = { x: 330, y: 379 };
const INK_HIT = { x: 203, y: 309 };
/** Copy, two ways: the button for images, left of the one for text */
const COPY_IMG = { x: 592, y: 430 };
/** Video: the picture pans while it plays (t, 0–1, is where the pan is); the can is boxed at MARK_T, the play bar is under the picture */
const MARK_T = 0.8;
const VBOX = { x: 368, y: 168, w: 128, h: 152 };
const NOTE_V = { x: 204, y: 176 };
const VBAR = { x: 152, y: 374 };
const TRACK = { x: 30, w: 286 };
const PLAY = { x: VBAR.x + 13, y: VBAR.y + 19 };
const TRACK_MARK = { x: VBAR.x + TRACK.x + TRACK.w * MARK_T, y: VBAR.y + 10 };
const GLIDE = "cubic-bezier(.45,0,.2,1)";

const STOP = Symbol("stop");

/** Runs a scene in root until the returned function is called */
function play(root: HTMLElement, scene: DemoScene, onPhase: (n: 1 | 2 | 3) => void) {
  let alive = true;
  const timers = new Set<number>();
  const el = (name: string) => root.querySelector<HTMLElement>(`[data-d="${name}"]`)!;
  const stage = el("scene");
  const cur = el("cur");
  const ring = el("ring");
  const rect = el("rect");
  const note = el("note");
  const drag = el("drag");
  const sel = el("sel");
  const capRect = el("caprect");
  const capNote = el("capnote");
  const pic = el("pic");
  const ink = root.querySelector<SVGPathElement>('[data-d="ink"]')!;
  let cx = 0;
  let cy = 0;
  let view = VIEWS[scene];

  const wait = (ms: number) =>
    new Promise<void>((ok, no) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        if (alive) ok();
        else no(STOP);
      }, ms);
      timers.add(t);
    });
  /** While the window is hidden (in the tray, minimized) nothing runs */
  const visible = async () => {
    while (document.visibilityState !== "visible") await wait(500);
  };
  const on = (name: string, ...cls: string[]) => el(name).classList.add(...cls);
  const off = (name: string, ...cls: string[]) => el(name).classList.remove(...cls);
  const at = (e: HTMLElement, x: number, y: number) => {
    e.style.transform = `translate(${x}px,${y}px)`;
  };
  const point = (x: number, y: number) => {
    cx = x;
    cy = y;
    at(cur, x, y);
  };
  /** Move the pointer; whatever is in follow moves with it (the picture being dragged in) */
  const move = async (x: number, y: number, ms: number, follow: HTMLElement[] = []) => {
    const frames = [{ transform: `translate(${cx}px,${cy}px)` }, { transform: `translate(${x}px,${y}px)` }];
    const moving = [cur, ...follow].map((e) => e.animate(frames, { duration: ms, easing: GLIDE, fill: "forwards" }));
    await wait(ms);
    point(x, y);
    for (const e of follow) at(e, x, y);
    for (const a of moving) a.cancel();
  };
  const click = () => {
    const here = `translate(${cx}px,${cy}px)`;
    ring.animate(
      [
        { opacity: 0.9, transform: `${here} scale(.3)` },
        { opacity: 0, transform: `${here} scale(1.1)` },
      ],
      { duration: 420, easing: "ease-out" },
    );
  };
  const tool = (name: "select" | "pin" | "rect" | "pen" | "whole") => {
    for (const one of ["select", "pin", "rect", "pen", "whole"] as const) el(`tool-${one}`).classList.toggle("is-on", one === name);
  };
  const press = async (x: number, y: number, ms: number) => {
    await move(x, y, ms);
    await wait(100);
    click();
  };
  const pushed = async (name: string) => {
    on(name, "is-down");
    await wait(130);
    off(name, "is-down");
    on(name, "is-done");
  };
  /** Draw the ink line with the pointer on its tip */
  const stroke = async (ms: number) => {
    const len = ink.getTotalLength();
    const frames = Array.from({ length: 33 }, (_, i) => {
      const p = ink.getPointAtLength((len * i) / 32);
      return { transform: `translate(${p.x}px,${p.y}px)` };
    });
    const going = [
      cur.animate(frames, { duration: ms, fill: "forwards" }),
      ink.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: ms, fill: "forwards" }),
    ];
    await wait(ms);
    const end = ink.getPointAtLength(len);
    point(end.x, end.y);
    ink.style.strokeDashoffset = "0";
    for (const a of going) a.cancel();
  };
  /** The video: where the pan and the play bar are (t from 0 to 1), and playing on to a later t */
  let playhead = 0;
  const seek = (to: number) => {
    playhead = to;
    pic.style.backgroundPosition = `${to * 100}% 50%`;
    el("vfill").style.width = `${to * TRACK.w}px`;
    el("vknob").style.transform = `translateX(${to * TRACK.w}px)`;
  };
  const playTo = (to: number, ms: number) =>
    new Promise<void>((ok, no) => {
      const from = playhead;
      const start = performance.now();
      const frame = (now: number) => {
        if (!alive) return no(STOP);
        const k = Math.min(1, (now - start) / ms);
        seek(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(frame);
        else ok();
      };
      requestAnimationFrame(frame);
    });
  const pickRect = async () => {
    await move(RECT_TOOL.x, RECT_TOOL.y, 550);
    await wait(100);
    click();
    tool("rect");
    await wait(350);
  };
  const aim = () => {
    const k = root.clientWidth / view.w;
    stage.style.transform = `scale(${k}) translate(${-view.x}px,${-view.y}px)`;
  };
  const camera = async (to: View, ms: number) => {
    view = to;
    stage.style.transition = `transform ${ms}ms ${GLIDE}, opacity .4s`;
    aim();
    await wait(ms);
    stage.style.transition = "";
  };
  const watch = new ResizeObserver(aim);
  watch.observe(root);

  const boxed = () =>
    Object.assign(rect.style, { left: `${BOX.x}px`, top: `${BOX.y}px`, width: `${BOX.w}px`, height: `${BOX.h}px`, opacity: "1" });
  const drawBox = async () => {
    await move(BOX.x, BOX.y, 650);
    await wait(120);
    Object.assign(rect.style, { left: `${BOX.x}px`, top: `${BOX.y}px`, width: "0px", height: "0px", opacity: "1" });
    const grow = rect.animate(
      [
        { width: "0px", height: "0px" },
        { width: `${BOX.w}px`, height: `${BOX.h}px` },
      ],
      { duration: 800, easing: GLIDE, fill: "forwards" },
    );
    await move(BOX.x + BOX.w, BOX.y + BOX.h, 800);
    boxed();
    grow.cancel();
    on("badge1", "is-show");
  };
  const openNote = (where: { x: number; y: number }, remove = false, box = note) => {
    box.classList.remove("is-typing", "is-show");
    box.classList.toggle("is-remove", remove);
    box.style.left = `${where.x}px`;
    box.style.top = `${where.y}px`;
    void box.offsetWidth;
    box.classList.add("is-show");
  };
  const type = async (where: { x: number; y: number }, remove = false, box = note) => {
    openNote(where, remove, box);
    await wait(220);
    box.classList.add("is-typing");
    await wait(820);
  };
  /** Drag a box out from its top left corner, the pointer on the corner that moves */
  const dragOut = async (box: HTMLElement, to: { x: number; y: number; w: number; h: number }, ms: number) => {
    Object.assign(box.style, { left: `${to.x}px`, top: `${to.y}px`, width: "0px", height: "0px", opacity: "1" });
    const grow = box.animate(
      [
        { width: "0px", height: "0px" },
        { width: `${to.w}px`, height: `${to.h}px` },
      ],
      { duration: ms, easing: GLIDE, fill: "forwards" },
    );
    await move(to.x + to.w, to.y + to.h, ms);
    Object.assign(box.style, { width: `${to.w}px`, height: `${to.h}px` });
    grow.cancel();
  };
  const placed = (box: HTMLElement, to: { x: number; y: number; w: number; h: number }) =>
    Object.assign(box.style, { left: `${to.x}px`, top: `${to.y}px`, width: `${to.w}px`, height: `${to.h}px`, opacity: "1" });

  /** Back to the empty window, instantly */
  const reset = () => {
    for (const a of root.getAnimations({ subtree: true })) if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) a.cancel();
    root.classList.add("is-still");
    root.classList.remove("is-pic", "is-fixed", "is-video");
    for (const e of root.querySelectorAll(".dm-scene [class*='is-']")) {
      for (const c of Array.from(e.classList))
        if (/^is-(show|on|over|typing|down|done|replied|picked|recolored|playing)$/.test(c)) e.classList.remove(c);
    }
    rect.style.cssText = "";
    sel.style.cssText = "";
    capRect.style.cssText = "";
    pic.style.cssText = "";
    ink.style.strokeDashoffset = "";
    drag.style.opacity = "0";
    tool("select");
    view = VIEWS[scene];
    aim();
  };
  /** Start a scene from a state set without transitions */
  const settle = () => {
    void root.offsetWidth;
    root.classList.remove("is-still", "is-out");
  };
  const marked = () => {
    root.classList.add("is-pic");
    boxed();
    on("badge1", "is-show");
  };

  const scenes: Record<DemoScene, () => Promise<void>> = {
    async loop() {
      onPhase(1);
      settle();
      await wait(600);
      point(70, 470);
      at(drag, 70, 470);
      drag.style.opacity = "1";
      on("cur", "is-show");
      void wait(620).then(
        () => on("drop", "is-over"),
        () => {},
      );
      await move(340, 250, 1000, [drag]);
      await wait(260);
      drag.style.opacity = "0";
      root.classList.add("is-pic");
      await wait(850);

      onPhase(2);
      await pickRect();
      await drawBox();
      await wait(250);
      await type(NOTE1);
      off("note", "is-show");
      on("card1", "is-show");
      on("dock", "is-show");
      await wait(550);
      tool("pin");
      await move(PIN.x, PIN.y, 700);
      await wait(100);
      click();
      on("badge2", "is-show");
      await wait(300);
      await type(NOTE2, true);
      off("note", "is-show");
      on("card2", "is-show");
      await wait(700);

      onPhase(3);
      tool("select");
      await move(COPY.x, COPY.y, 750);
      await wait(120);
      click();
      on("copy", "is-down");
      await wait(130);
      off("copy", "is-down");
      on("copy", "is-done");
      await wait(650);
      on("chat", "is-show");
      await move(470, 395, 600);
      await wait(150);
      click();
      on("me", "is-show");
      await wait(550);
      off("cur", "is-show");
      on("ai", "is-show");
      await wait(1150);
      on("ai", "is-replied");
      await wait(950);
      off("chat", "is-show");
      await wait(450);
      root.classList.add("is-fixed");
      await wait(2800);
    },
    async tool() {
      root.classList.add("is-pic");
      point(330, 210);
      settle();
      await wait(600);
      on("cur", "is-show");
      await pickRect();
      await wait(1500);
    },
    async whole() {
      marked();
      on("card1", "is-show");
      on("dock", "is-show");
      point(330, 210);
      settle();
      await wait(600);
      on("cur", "is-show");
      await move(WHOLE_TOOL.x, WHOLE_TOOL.y, 600);
      await wait(100);
      click();
      tool("whole");
      await wait(300);
      await type(NOTE_WHOLE);
      off("note", "is-show");
      off("cur", "is-show");
      tool("select");
      await camera(PANEL, 600);
      on("card3", "is-show");
      await wait(2200);
    },
    async mark() {
      root.classList.add("is-pic");
      tool("rect");
      point(300, 150);
      settle();
      await wait(500);
      on("cur", "is-show");
      await drawBox();
      await wait(250);
      openNote(NOTE1);
      await wait(1700);
    },
    async write() {
      marked();
      openNote(NOTE1);
      el("key").style.left = `${NOTE1.x + 164}px`;
      el("key").style.top = `${NOTE1.y + 36}px`;
      settle();
      await wait(600);
      note.classList.add("is-typing");
      await wait(900);
      on("key", "is-show");
      await wait(350);
      on("key", "is-down");
      await wait(180);
      off("key", "is-down");
      off("note", "is-show");
      await wait(200);
      off("key", "is-show");
      await camera(PANEL, 600);
      on("card1", "is-show");
      on("dock", "is-show");
      await wait(1800);
    },
    async copy() {
      marked();
      on("badge2", "is-show");
      on("card1", "is-show");
      on("card2", "is-show");
      on("dock", "is-show");
      point(470, 330);
      settle();
      await wait(500);
      on("cur", "is-show");
      await move(COPY.x, COPY.y, 700);
      await wait(120);
      click();
      on("copy", "is-down");
      await wait(130);
      off("copy", "is-down");
      on("copy", "is-done");
      await wait(1800);
    },
    async paste() {
      marked();
      for (const name of ["badge2", "card1", "card2", "dock"]) on(name, "is-show");
      on("copy", "is-done");
      settle();
      await wait(500);
      on("chat", "is-show");
      await wait(650);
      on("me", "is-show");
      await wait(550);
      on("ai", "is-show");
      await wait(1100);
      on("ai", "is-replied");
      await wait(900);
      off("chat", "is-show");
      await wait(450);
      root.classList.add("is-fixed");
      await wait(2400);
    },
    async capture() {
      root.classList.add("is-pic");
      point(520, 150);
      settle();
      await wait(600);
      on("cur", "is-show");
      await move(CAP_BUTTON.x, CAP_BUTTON.y, 650);
      await wait(100);
      click();
      on("cap", "is-on");
      await wait(350);
      // The window steps aside and the screen dims: the selection, still empty, darkens everything around it
      on("desk", "is-show");
      await wait(450);
      placed(sel, { ...CAP_SEL, w: 0, h: 0 });
      await move(CAP_SEL.x, CAP_SEL.y, 600);
      await wait(150);
      await dragOut(sel, CAP_SEL, 850);
      on("capbar", "is-show");
      await wait(450);
      await move(CAP_BOX.x, CAP_BOX.y, 450);
      await wait(120);
      await dragOut(capRect, CAP_BOX, 600);
      on("capbadge", "is-show");
      await wait(200);
      await type(CAP_NOTE, false, capNote);
      await wait(200);
      off("capnote", "is-show");
      await move(CAP_DONE.x, CAP_DONE.y, 550);
      await wait(100);
      click();
      on("capdone", "is-down");
      await wait(130);
      off("capdone", "is-down");
      await wait(200);
      // Done: the picture is on the clipboard, and it is pasted to the AI (whose window takes the place of the page)
      on("desk", "is-done");
      sel.style.opacity = "0";
      capRect.style.opacity = "0";
      off("capbar", "is-show");
      off("capbadge", "is-show");
      off("cur", "is-show");
      on("chat", "is-show");
      await camera(CAPTURE_CHAT, 600);
      await wait(250);
      on("mecap", "is-show");
      await wait(600);
      on("ai", "is-show");
      await wait(1100);
      on("ai", "is-replied");
      await wait(2400);
    },
    async pin() {
      root.classList.add("is-pic");
      tool("pin");
      point(300, 160);
      settle();
      await wait(500);
      on("cur", "is-show");
      await press(PIN_A.x, PIN_A.y, 650);
      on("pina", "is-show");
      await wait(250);
      openNote(NOTE_PIN);
      await wait(800);
      // The note is still open: a click outside it marks another place, under the same number
      await press(PIN_B.x, PIN_B.y, 700);
      on("pinb", "is-show");
      await wait(450);
      note.classList.add("is-typing");
      await wait(900);
      off("note", "is-show");
      await wait(1900);
    },
    async color() {
      marked();
      on("badge2", "is-show");
      point(300, 330);
      settle();
      await wait(500);
      on("cur", "is-show");
      await press(BOX.x, BOX.y, 650);
      on("badge1", "is-picked");
      on("sw0", "is-on");
      on("colors", "is-show");
      await wait(650);
      await press(YELLOW.x, YELLOW.y, 550);
      off("sw0", "is-on");
      on("sw2", "is-on");
      on("rect", "is-recolored");
      on("badge1", "is-recolored");
      await wait(450);
      off("colors", "is-show");
      off("badge1", "is-picked");
      await move(300, 330, 700);
      await wait(1500);
    },
    async drawing() {
      root.classList.add("is-pic");
      tool("pen");
      point(300, 220);
      settle();
      await wait(500);
      on("cur", "is-show");
      const start = ink.getPointAtLength(0);
      await move(start.x, start.y, 600);
      await wait(120);
      await stroke(1100);
      await wait(150);
      openNote(NOTE_INK);
      await wait(900);
      // Left without a word (a click on the blank canvas off the picture): the line stays, with no number
      await press(LEAVE.x, LEAVE.y, 650);
      off("note", "is-show");
      await wait(1000);
      // A double-click on it adds the note
      await move(INK_HIT.x, INK_HIT.y, 600);
      await wait(100);
      click();
      await wait(140);
      click();
      on("inkbadge", "is-show");
      await wait(200);
      await type(NOTE_INK);
      off("note", "is-show");
      await wait(1700);
    },
    async kinds() {
      marked();
      for (const name of ["badge2", "card1", "card2", "dock"]) on(name, "is-show");
      point(470, 330);
      settle();
      await wait(500);
      on("cur", "is-show");
      // As text: to an AI working on the project's files, in a terminal
      await press(COPY.x, COPY.y, 650);
      await pushed("copy");
      await wait(300);
      on("term", "is-show");
      await wait(450);
      on("tmpaste", "is-show");
      await wait(800);
      on("tmai", "is-show");
      await wait(900);
      on("tmai", "is-replied");
      await wait(1200);
      off("term", "is-show");
      off("copy", "is-done");
      await wait(350);
      // As images: to an AI in the browser, or a chat app
      await press(COPY_IMG.x, COPY_IMG.y, 550);
      await pushed("copyimg");
      await wait(300);
      on("web", "is-show");
      await wait(450);
      on("webme", "is-show");
      await wait(700);
      on("webai", "is-show");
      await wait(900);
      on("webai", "is-replied");
      await wait(1900);
    },
    async video() {
      root.classList.add("is-pic", "is-video");
      tool("rect");
      seek(0.45);
      point(300, 300);
      settle();
      await wait(400);
      on("vplay", "is-playing");
      on("cur", "is-show");
      await Promise.all([playTo(MARK_T, 1700), move(PLAY.x, PLAY.y, 1500)]);
      click();
      off("vplay", "is-playing");
      await wait(400);
      await move(VBOX.x, VBOX.y, 600);
      await wait(100);
      await dragOut(rect, VBOX, 700);
      on("vbadge", "is-show");
      await wait(200);
      await type(NOTE_V);
      off("note", "is-show");
      on("vmark", "is-show");
      await wait(500);
      // Playing on: the mark belongs to the frame it was made on, and goes
      await press(PLAY.x, PLAY.y, 650);
      on("vplay", "is-playing");
      const going = wait(450).then(() => {
        rect.style.opacity = "0";
        off("vbadge", "is-show");
      });
      await playTo(1, 1300);
      await going;
      off("vplay", "is-playing");
      await wait(450);
      // Its number on the play bar goes back to that moment, and there it is
      await press(TRACK_MARK.x, TRACK_MARK.y, 700);
      seek(MARK_T);
      rect.style.opacity = "1";
      on("vbadge", "is-show");
      await wait(1900);
    },
  };

  /** One frame that says the same thing, for "reduce motion" */
  const still = () => {
    reset();
    if (scene === "capture") {
      root.classList.add("is-pic");
      on("cap", "is-on");
      on("desk", "is-show");
      placed(sel, CAP_SEL);
      placed(capRect, CAP_BOX);
      on("capbadge", "is-show");
      on("capbar", "is-show");
      return settle();
    }
    if (scene === "pin" || scene === "drawing" || scene === "video") {
      root.classList.add("is-pic");
      if (scene === "pin") {
        tool("pin");
        for (const name of ["pina", "pinb"]) on(name, "is-show");
        openNote(NOTE_PIN);
        note.classList.add("is-typing");
      } else if (scene === "drawing") {
        tool("pen");
        ink.style.strokeDashoffset = "0";
      } else {
        root.classList.add("is-video");
        seek(MARK_T);
        placed(rect, VBOX);
        for (const name of ["vbadge", "vmark"]) on(name, "is-show");
      }
      return settle();
    }
    marked();
    if (scene === "color") {
      for (const name of ["badge1", "rect"]) on(name, "is-recolored");
      on("badge2", "is-show");
      on("badge1", "is-picked");
      on("sw2", "is-on");
      on("colors", "is-show");
      return settle();
    }
    if (scene === "kinds") {
      for (const name of ["badge2", "card1", "card2", "dock", "web", "webme"]) on(name, "is-show");
      return settle();
    }
    if (scene !== "mark") on("card1", "is-show");
    if (scene === "loop" || scene === "copy" || scene === "paste") {
      for (const name of ["badge2", "card2", "dock"]) on(name, "is-show");
      onPhase(2);
    }
    if (scene === "write") {
      on("dock", "is-show");
      view = PANEL;
      aim();
    }
    settle();
  };

  const run = async () => {
    for (;;) {
      await visible();
      reset();
      await scenes[scene]();
      root.classList.add("is-out");
      await wait(450);
    }
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) still();
  else
    run().catch((e: unknown) => {
      if (e !== STOP) throw e;
    });

  return () => {
    alive = false;
    for (const t of timers) clearTimeout(t);
    watch.disconnect();
  };
}

export function Demo(props: { scene: DemoScene; onPhase?: (n: 1 | 2 | 3) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const phase = useEffectEvent((n: 1 | 2 | 3) => props.onPhase?.(n));
  useEffect(() => play(root.current!, props.scene, phase), [props.scene]);
  const view = VIEWS[props.scene];
  return (
    <div ref={root} className="demo is-still" data-scene={props.scene} style={{ aspectRatio: `${view.w} / ${view.h}` }} aria-hidden="true">
      <div className="dm-scene" data-d="scene">
        <div className="dm-tb">
          <div className="dm-logo" />
          {[28, 56, 84].map((left) => (
            <div key={left} className="dm-menu" style={{ left }} />
          ))}
          <div className="dm-cap" data-d="cap">
            <i />
            <b />
          </div>
          <div className="dm-win" style={{ right: 44 }} />
          <div className="dm-win" style={{ right: 27, top: 8, height: 7, background: "none", border: "1.5px solid var(--muted)" }} />
          <div className="dm-win" style={{ right: 10, transform: "rotate(45deg)" }} />
          <div className="dm-win" style={{ right: 10, transform: "rotate(-45deg)" }} />
        </div>
        <div className="dm-lib">
          <div className="dm-head" />
          <div className="dm-row is-folder">
            <i />
            <b />
          </div>
          <div className="dm-row is-file">
            <i />
            <b />
          </div>
        </div>
        <div className="dm-tools">
          {/* In the order of the real toolbar: select (a drag on the canvas draws a box with it), hand, pin, rectangle, pen, arrow */}
          <div className="dm-tool" data-d="tool-select" style={{ left: 10 }}>
            <svg viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 1.5l8.5 5-3.7.9 2 3.8-1.6.8-2-3.8L3.6 11z" />
            </svg>
          </div>
          <div className="dm-tool" style={{ left: 36 }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 7.5V3.2a.9.9 0 0 1 1.8 0V6.5M6.3 6V2.4a.9.9 0 0 1 1.8 0V6M8.1 6.2V3.2a.9.9 0 0 1 1.8 0v5.3c0 2.2-1.3 3.7-3.4 3.7-1.6 0-2.5-.8-3.2-2.2L2.2 7.900a.9.9 0 0 1 1.500-.9l.8 1.200" />
            </svg>
          </div>
          <div className="dm-tool" data-d="tool-pin" style={{ left: 62 }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 12.5S3 8.6 3 5.8a4 4 0 0 1 8 0C11 8.6 7 12.5 7 12.5Z" />
              <circle cx="7" cy="5.8" r="1.2" />
            </svg>
          </div>
          <div className="dm-tool" data-d="tool-rect" style={{ left: 88 }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="10" height="8" rx="1" />
            </svg>
          </div>
          <div className="dm-tool" data-d="tool-pen" style={{ left: 114 }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 10c2-5 3 2 5-2s3-3 5-4" />
            </svg>
          </div>
          <div className="dm-tool" style={{ left: 140 }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l8-8M6 3h5v5" />
            </svg>
          </div>
          <div className="dm-sep" />
          {/* Overall comment: an icon and a word */}
          <div className="dm-tool is-wide" data-d="tool-whole" style={{ left: 174 }}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M2 3h10v6.500H6.500L4 11.500V9.500H2z" />
            </svg>
            <b />
          </div>
        </div>
        <div className="dm-drop" data-d="drop">
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21V7M10 13l6-6 6 6M6 25h20" />
          </svg>
          <b />
        </div>
        <div className="dm-pic" data-d="pic">
          <div className="dm-after" />
        </div>
        <div className="dm-glow" />
        {/* A video's play bar: play / pause, the track with the note's number above its moment, the time */}
        <div className="dm-vbar" style={{ left: VBAR.x, top: VBAR.y }}>
          <div className="vb-play" data-d="vplay">
            <svg className="vb-icon-play" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 1.8v8.4L10 6z" />
            </svg>
            <svg className="vb-icon-pause" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2.5 1.8h2.4v8.4H2.5zM7.1 1.8h2.4v8.4H7.1z" />
            </svg>
          </div>
          <div className="vb-track" style={{ left: TRACK.x, width: TRACK.w }} />
          <div className="vb-fill" data-d="vfill" style={{ left: TRACK.x }} />
          <div className="vb-knob" data-d="vknob" style={{ left: TRACK.x }} />
          <div className="vb-mark" data-d="vmark" style={{ left: TRACK.x + TRACK.w * MARK_T }}>
            1
          </div>
          <div className="vb-time" />
        </div>
        <div className="dm-rect" data-d="rect" />
        <svg className="dm-ink" viewBox="0 0 720 450">
          <path data-d="ink" d={INK} pathLength={100} />
        </svg>
        <div className="dm-badge" data-d="badge1" style={{ left: BOX.x, top: BOX.y }}>
          1
        </div>
        <div className="dm-badge" data-d="badge2" style={{ left: PIN.x, top: PIN.y }}>
          2
        </div>
        <div className="dm-badge" data-d="inkbadge" style={{ left: INK_BADGE.x, top: INK_BADGE.y }}>
          1
        </div>
        <div className="dm-badge" data-d="vbadge" style={{ left: VBOX.x, top: VBOX.y }}>
          1
        </div>
        {/* Pins: the tip on the point; several places of one note share its number */}
        <div className="dm-badge is-pin" data-d="pina" style={{ left: PIN_A.x, top: PIN_A.y }}>
          1
        </div>
        <div className="dm-badge is-pin" data-d="pinb" style={{ left: PIN_B.x, top: PIN_B.y }}>
          1
        </div>
        {/* The row of colors beside a clicked mark, ending in Delete */}
        <div className="dm-colors" data-d="colors" style={{ left: COLORS.x, top: COLORS.y }}>
          {SWATCHES.map((color, n) => (
            <i key={color} data-d={`sw${n}`} style={{ left: 4 + n * 20, background: color }} />
          ))}
          <b />
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5h8M4.5 3.5V2h3v1.5M3.2 3.5l.5 6.5h4.6l.5-6.5" />
          </svg>
        </div>
        <div className="dm-note" data-d="note">
          <div className="dm-cat" />
          <div className="dm-line is-1" />
          <div className="dm-line is-2" />
        </div>
        <div className="dm-key" data-d="key">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 3v5H3.5M6 5.5L3.5 8 6 10.5" />
          </svg>
        </div>
        <div className="dm-panel">
          <div className="dm-head" />
          <div className="dm-card is-c1" data-d="card1">
            <div className="dm-num">1</div>
            <div className="dm-cat" />
            <div className="dm-line is-1" />
            <div className="dm-line is-2" />
          </div>
          <div className="dm-card is-c2 is-remove" data-d="card2">
            <div className="dm-num">2</div>
            <div className="dm-cat" />
            <div className="dm-line is-1" />
            <div className="dm-line is-2" style={{ width: 40 }} />
          </div>
          <div className="dm-card is-c2 is-whole" data-d="card3">
            <div className="dm-num" />
            <div className="dm-cat" />
            <div className="dm-line is-1" />
            <div className="dm-line is-2" style={{ width: 52 }} />
          </div>
          <div className="dm-dock" data-d="dock">
            <div className="dm-btn is-text" data-d="copy">
              <svg className="dm-doc" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="4" y="1.5" width="6.5" height="7.5" rx="1" />
                <path d="M2 4v6.5h5.5" />
              </svg>
              <svg
                className="dm-ok"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
              </svg>
              <b />
            </div>
            <div className="dm-btn is-img" data-d="copyimg">
              <svg className="dm-doc" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="1.5" y="2" width="9" height="8" rx="1" />
                <path d="M2 8.5l2.5-2.5 2 2 1.5-1.5 2 2" />
              </svg>
              <svg
                className="dm-ok"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
              </svg>
              <b />
            </div>
          </div>
        </div>
        {/* Where a copy as text goes: an AI working on the project in a terminal (the text is pasted at its prompt) */}
        <div className="dm-term" data-d="term">
          <div className="tm-bar">
            {[8, 18, 28].map((left) => (
              <i key={left} style={{ left }} />
            ))}
          </div>
          <div className="tm-prompt">›</div>
          <div className="tm-paste" data-d="tmpaste">
            {[150, 172, 128, 160, 96].map((width, n) => (
              <b key={n} style={{ top: n * 11, width }} />
            ))}
          </div>
          <div className="tm-ai" data-d="tmai">
            <div className="tm-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="tm-done">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 10.5l3.5 3.5 7.5-8" />
              </svg>
              <b />
            </div>
          </div>
        </div>
        {/* Where a copy as images goes: a chat in the browser; the picture carries its marks and the notes under it */}
        <div className="dm-web" data-d="web">
          <div className="dm-chat-top">
            <div className="dm-spark">
              <svg viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 0l1.4 4.6L12 6l-4.6 1.4L6 12 4.6 7.4 0 6l4.6-1.4z" />
              </svg>
            </div>
            <div className="dm-ai-name">AI</div>
          </div>
          <div className="wb-me" data-d="webme">
            <div className="wb-shot">
              <i />
              <span>1</span>
              <b />
            </div>
            <div className="wb-notes">
              <span>1</span>
              <b />
              <span style={{ top: 19 }}>2</span>
              <b style={{ top: 22, width: 46 }} />
            </div>
          </div>
          <div className="dm-ai wb-ai" data-d="webai">
            <div className="dm-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="dm-done">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="10" r="8" />
                <path d="M6.5 10.2l2.4 2.4 4.6-5" />
              </svg>
              <b />
            </div>
          </div>
        </div>
        <div className="dm-drag" data-d="drag" />
        {/* Screen Capture: what is on the screen (a page in a browser: a chart and a summary), dimmed around the selection */}
        <div className="dm-desk" data-d="desk">
          <div className="dk-win">
            <div className="dk-bar">
              <i style={{ left: 10 }} />
              <i style={{ left: 20 }} />
              <i style={{ left: 30 }} />
              <b />
            </div>
            <div className="dk-h" />
            <div className="dk-sub" />
            <div className="dk-chart">
              <b />
              {[40, 62, 50, 88, 68].map((height, n) => (
                <i key={n} style={{ left: 20 + n * 34, height }} />
              ))}
            </div>
            <div className="dk-side">
              <i />
              {[90, 70, 100, 56].map((width, n) => (
                <b key={n} style={{ top: 86 + n * 12, width }} />
              ))}
            </div>
          </div>
        </div>
        <div className="dm-sel" data-d="sel" />
        <div className="dm-rect" data-d="caprect" />
        <div className="dm-badge" data-d="capbadge" style={{ left: CAP_BOX.x, top: CAP_BOX.y }}>
          1
        </div>
        <div className="dm-note" data-d="capnote">
          <div className="dm-cat" />
          <div className="dm-line is-1" />
          <div className="dm-line is-2" />
        </div>
        {/* The bar under the selection: the marking tools (the rectangle in use), and Done */}
        <div className="dm-capbar" data-d="capbar" style={{ left: CAP_SEL.x + CAP_SEL.w - 124, top: CAP_SEL.y + CAP_SEL.h + 6 }}>
          {[6, 22, 38, 54].map((left, n) => (
            <i key={left} className={n === 1 ? "is-used" : undefined} style={{ left }} />
          ))}
          <div className="dk-ok" data-d="capdone">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
            </svg>
          </div>
        </div>
        <div className="dm-chat" data-d="chat">
          <div className="dm-chat-top">
            <div className="dm-spark">
              <svg viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 0l1.4 4.6L12 6l-4.6 1.4L6 12 4.6 7.4 0 6l4.6-1.4z" />
              </svg>
            </div>
            <div className="dm-ai-name">AI</div>
          </div>
          <div className="dm-me" data-d="me">
            <div className="dm-shot">
              <i />
              <b style={{ left: 8, top: 19 }} />
              <b style={{ left: 113, top: 14 }} />
            </div>
            <div className="dm-num" style={{ top: 16 }}>
              1
            </div>
            <div className="dm-line" style={{ top: 20 }} />
            <div className="dm-line" style={{ top: 30, width: 30 }} />
            <div className="dm-num" style={{ top: 50 }}>
              2
            </div>
            <div className="dm-line" style={{ top: 54 }} />
            <div className="dm-line" style={{ top: 64, width: 24 }} />
            <div className="dm-line is-wide" style={{ top: 102, width: 180 }} />
            <div className="dm-line is-wide" style={{ top: 113, width: 112 }} />
          </div>
          {/* What Screen Capture pastes: one picture, the capture with its mark and the note under it */}
          <div className="dm-mecap" data-d="mecap">
            <div className="dk-shot">
              {[28, 43, 35, 61, 47].map((height, n) => (
                <i key={n} style={{ left: 22 + n * 22, height }} />
              ))}
              <b />
              <span>1</span>
            </div>
            <div className="dk-notes">
              <span>1</span>
              <b />
            </div>
          </div>
          <div className="dm-ai" data-d="ai">
            <div className="dm-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="dm-done">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="10" r="8" />
                <path d="M6.5 10.2l2.4 2.4 4.6-5" />
              </svg>
              <b />
            </div>
          </div>
          <div className="dm-input">
            <b />
            <i />
          </div>
        </div>
        <svg className="dm-cur" data-d="cur" viewBox="0 0 20 20">
          <path d="M2 1l13 9.5-6 .9-3.4 5.3z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        <div className="dm-ring" data-d="ring" />
      </div>
    </div>
  );
}
