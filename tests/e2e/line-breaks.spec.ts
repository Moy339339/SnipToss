// Line breaking in the languages written with full-width marks (design-rules S9, KeepPunctuation.tsx). In the interface's own explanatory
// text no line starts with a closing mark (」』）。，、…) or ends with an opening one (「『（), and no run of Chinese or Japanese characters
// without a space or a mark in it is broken in the middle while it would fit on a line (keep-all: such a run is a word).
// Every screen of screens.ts is walked; each S9 box is measured at its own width and narrowed to 80% and 60%, so the text breaks at many
// more places than the window alone would give. Runs in Edge with the other e2e tests, and in WebKit on the Mac CI
// (playwright.webkit.config.ts): under keep-all WebKit breaks on both sides of these marks, and finds no place to break at the edges of
// the spans that keep a mark with its character, which is what the spans and the <wbr> of KeepPunctuation are for

import { expect, test, type App } from "./harness";
import { prepare, walkScreens, welcome } from "./screens";

/** The boxes rule S9 applies to (the text of a shortcut row is its label: the keys beside it are not prose) */
const S9 = [
  ".lib-empty",
  ".stage-empty",
  ".panel-empty",
  ".tooltip.is-on",
  ".tour-body",
  ".hint-text",
  ".sheet-intro .welcome",
  ".confirm-body",
  ".set-heading p",
  ".shortcut-row .shortcut-label",
  ".set-desc",
].join(", ");

/** Lines that break the wrong way, in the S9 boxes on screen now */
function badBreaks(app: App, screen: string) {
  return app.page.evaluate(
    ({ where, boxes }) => {
      const CLOSE = "」』）〉》】〕。，、；：！？…";
      const OPEN = "「『（〈《【〔";
      const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー々]/u;
      interface Char {
        node: Text;
        at: number;
        /** The block the character is laid out in */
        block: Element;
      }
      /** A space a line may break at, or a line break written into the text (<br>) */
      type Gap = "space" | "br";
      // A no-break space (as between a shortcut and the Japanese text after it) holds the words on both sides together
      const breakingSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c.charCodeAt(0) === 0x3000;
      const blockOf = (node: Node) => {
        let e = node.parentElement;
        while (e && getComputedStyle(e).display.startsWith("inline")) e = e.parentElement;
        return e!;
      };
      /** The box's characters in order, with its spaces and <br>; the text in buttons and keys left out */
      const charsOf = (el: HTMLElement) => {
        const chars: (Char | Gap)[] = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          if (node instanceof HTMLBRElement) chars.push("br");
          if (!(node instanceof Text) || node.parentElement?.closest("button, kbd, svg")) continue;
          const block = blockOf(node);
          for (let at = 0; at < node.length; at++) chars.push(breakingSpace(node.data[at]) ? "space" : { node, at, block });
        }
        return chars;
      };
      const text = (c: Char) => c.node.data[c.at];
      const range = (a: Char, b: Char) => {
        const r = document.createRange();
        r.setStart(a.node, a.at);
        r.setEnd(b.node, b.at + 1);
        return r;
      };
      const top = (c: Char) => range(c, c).getClientRects()[0]?.top;
      const apart = (a: Char, b: Char) => {
        const ta = top(a);
        const tb = top(b);
        return ta !== undefined && tb !== undefined && Math.abs(ta - tb) > 4;
      };
      /** The box's text line by line (for the report): characters grouped by the top of their box */
      const linesOf = (chars: (Char | Gap)[]) => {
        const lines: string[] = [];
        let last: number | undefined;
        for (const c of chars) {
          if (typeof c === "string") continue;
          const t = top(c);
          if (t === undefined) continue;
          if (last === undefined || Math.abs(t - last) > 4) lines.push("");
          last = t;
          lines[lines.length - 1] += text(c);
        }
        return lines;
      };
      /** The width a line of this block has */
      const lineWidth = (block: Element) => {
        const cs = getComputedStyle(block);
        return block.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      };

      const found: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(boxes)) {
        // Measured once, at the outermost S9 box
        if (el.parentElement?.closest(boxes)) continue;
        const width = el.getBoundingClientRect().width;
        if (width === 0) continue;
        const chars = charsOf(el);
        // A mark and its neighbor: a closing mark and the character before it, an opening mark and the one after it (a <br> between them
        // doesn't make the break right)
        const neighbor = (i: number, step: 1 | -1) => {
          for (let j = i + step; j >= 0 && j < chars.length; j += step) {
            const c = chars[j];
            if (c === "space") return undefined;
            if (c !== "br") return c;
          }
          return undefined;
        };
        const pairs: [Char, Char][] = [];
        chars.forEach((c, i) => {
          if (typeof c === "string") return;
          const before = CLOSE.includes(text(c)) ? neighbor(i, -1) : undefined;
          const after = OPEN.includes(text(c)) ? neighbor(i, 1) : undefined;
          if (before) pairs.push([before, c]);
          if (after) pairs.push([c, after]);
        });
        // Words: runs without a space, a <br> or a change of block, cut after a closing mark and before an opening one
        const words: Char[][] = [];
        let word: Char[] = [];
        for (const c of chars) {
          const cut =
            typeof c === "string" || (word.length > 0 && (word[0].block !== c.block || CLOSE.includes(text(word[word.length - 1])) || OPEN.includes(text(c))));
          if (cut && word.length > 0) words.push(word);
          if (cut) word = [];
          if (typeof c !== "string") word.push(c);
        }
        if (word.length > 0) words.push(word);

        const saved = el.style.width;
        for (const share of [1, 0.8, 0.6]) {
          if (share < 1) el.style.width = `${Math.floor(width * share)}px`;
          const problems: string[] = [];
          if (pairs.some(([a, b]) => apart(a, b))) problems.push("a mark on the wrong side of a break");
          for (const w of words) {
            if (w.length < 2 || !apart(w[0], w[w.length - 1])) continue;
            // Wider than a line: it has to be broken somewhere
            const needed = [...range(w[0], w[w.length - 1]).getClientRects()].reduce((sum, r) => sum + r.width, 0);
            if (needed > lineWidth(w[0].block) - 1) continue;
            const at = w.findIndex((c, i) => i > 0 && apart(w[i - 1], c));
            if (at > 0 && CJK.test(text(w[at - 1])) && CJK.test(text(w[at])))
              problems.push(`“${w.map(text).join("")}” broken after “${w.slice(0, at).map(text).join("")}”`);
          }
          if (problems.length > 0)
            found.push(`${where}: .${el.className.split(" ").join(".")} at ${Math.round(share * 100)}%: ${problems.join("; ")}: ${linesOf(chars).join(" / ")}`);
        }
        el.style.width = saved;
      }
      return found;
    },
    { where: screen, boxes: S9 },
  );
}

test("the detection itself works: a closing mark that starts a line and a word broken while it would fit are reported, right breaks are not", async ({ app }) => {
  await app.open();
  await app.page.evaluate(() => {
    const add = (box: number, html: string, style = "") => {
      const d = document.createElement("div");
      d.className = `set-desc box-${box}`;
      d.setAttribute("style", `position:fixed;left:0;top:0;width:300px;${style}`);
      d.innerHTML = html;
      document.body.append(d);
    };
    add(1, "请使用「复制成图片<br>」后粘贴");
    add(2, "请使用「复制成图片」<br>后粘贴");
    // Breaking anywhere splits the short words between the marks (at most widths; one may happen to end its lines between words);
    // written as KeepPunctuation writes it, keep-all breaks after them
    add(3, "从列表中移除。".repeat(8), "word-break:break-all");
    add(4, '从列表中移<span class="keep-punctuation">除。</span><wbr>'.repeat(8), "word-break:keep-all");
  });
  const found = await badBreaks(app, "self-check");
  const of = (box: number) => found.filter((f) => f.includes(`.box-${box} `));
  // Each box is measured at three widths
  expect(of(1)).toHaveLength(3);
  for (const f of of(1)) expect(f).toContain("a mark on the wrong side of a break: 请使用「复制成图片 / 」后粘贴");
  expect(of(3).length).toBeGreaterThan(0);
  for (const f of of(3)) expect(f).toMatch(/“从列表中移除。” broken after “从/);
  expect([...of(2), ...of(4)]).toEqual([]);
});

for (const locale of ["zh-CN", "zh-TW", "ja"]) {
  test(`${locale}: on every UI screen (screens.ts), including a tooltip, explanatory text breaks only where it may, at the box's width and narrowed to 80% and 60%`, async ({ app }) => {
    // Every screen, with each box laid out three times
    test.slow();
    prepare(app, locale);
    await app.page.setViewportSize({ width: 960, height: 600 });
    await app.open();
    await expect(app.page.locator("html")).toHaveAttribute("lang", locale);
    const problems: string[] = [];
    let tooltips = 0;
    await walkScreens(app, async (screen) => {
      problems.push(...(await badBreaks(app, screen)));
      // The skip button of the tour has a long tooltip with a quoted menu path
      const skip = app.page.locator(".tour-skip");
      if (screen.startsWith("引导") && (await skip.isVisible())) {
        await skip.hover();
        await expect(app.page.locator(".tooltip.is-on")).toBeVisible();
        problems.push(...(await badBreaks(app, `${screen}, tooltip`)));
        tooltips++;
        await app.page.mouse.move(0, 0);
      }
    });
    expect(tooltips).toBeGreaterThan(0);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test(`${locale}: the welcome page with an empty library breaks only where it may`, async ({ app }) => {
    prepare(app, locale);
    await app.page.setViewportSize({ width: 960, height: 600 });
    const problems: string[] = [];
    await welcome(app, async (screen) => void problems.push(...(await badBreaks(app, screen))));
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
