import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeepPunctuation, punctuationRuns } from "../src/KeepPunctuation";

/** The runs written as text: kept runs in brackets, places to break as | */
const runs = (text: string) =>
  punctuationRuns(text)
    .map((r) => (r.kind === "keep" ? `[${r.text}]` : r.kind === "break" ? "|" : r.text))
    .join("");

describe("punctuationRuns", () => {
  it.each([
    // An opening mark stays with the character after it and a closing mark with the one before it (touching runs are one); a line may
    // break before an opening mark and after a closing one
    ["请使用「复制成图片」", "请使用|[「复]制成图[片」]"],
    ["使用「复制成文字」后粘贴", "使用|[「复]制成文[字」]|后粘贴"],
    ["已关闭。然后", "已关[闭。]|然后"],
    ["（「在图片中附加批注」已关闭），Codex", "[（「在]图片中附加批[注」]|已关[闭），]|Codex"],
    ["「X」：", "[「X」：]"],
    // One place to break between a closing mark and an opening one
    ["「常规」「批注」", "[「常][规」]|[「批][注」]"],
    ["使用中です。設定で", "使用中で[す。]|設定で"],
    ["设置…", "设[置…]"],
  ])("%s", (text, want) => {
    expect(runs(text)).toBe(want);
  });

  it("never sticks across white space, which is a place to break already", () => {
    expect(runs("可在「设置 → 高级 → 跳过的文件夹」中更改")).toBe("可在|[「设]置 → 高级 → 跳过的文件[夹」]|中更改");
    expect(runs("见 「设置」 中")).toBe("见 [「设][置」] 中");
    expect(runs("「 x 」")).toBe("「 x 」");
    expect(runs("一行。\n下一行")).toBe("一[行。]\n下一行");
  });

  it("text without full-width marks is one run, as it is", () => {
    for (const text of ["", "Copy as Text (Ctrl Shift C)", "“Quoted” and (parenthesized), with commas.", "한국어 문장입니다."])
      expect(punctuationRuns(text)).toEqual([{ kind: "text", text }]);
  });

  it("a name that starts with a dot, after a space or at the start, is kept whole", () => {
    expect(runs("（各项目的 .sniptoss 文件夹）")).toBe("[（各]项目的 [.sniptoss] 文件[夹）]");
    expect(runs("Notes go in the .sniptoss folder.")).toBe("Notes go in the [.sniptoss] folder.");
    expect(runs(".gitignore")).toBe("[.gitignore]");
    expect(runs("见 .sniptoss/REVIEW.md")).toBe("见 [.sniptoss]/REVIEW.md");
    expect(runs("（存在 .sniptoss）")).toBe("[（存]在 [.sniptoss）]");
    // Not after a letter, a digit or a mark, and not a dot before a space
    for (const text of ["a.b", "v1.0.2", "Done. Next", "1. Open", "（.x）", "end ."]) expect(runs(text)).not.toMatch(/\[\.[^\]]/);
  });

  it("with other inline content right against the text, its ends are not places to break by themselves", () => {
    expect(runs("「X」：")).toBe("[「X」：]");
    expect(punctuationRuns("「X」：", { before: true, after: true }).map((r) => r.kind)).toEqual(["break", "keep", "break"]);
    expect(punctuationRuns("「X」：", { before: true }).map((r) => r.kind)).toEqual(["break", "keep"]);
    expect(punctuationRuns("（默认位置）", { after: true }).map((r) => r.kind)).toEqual(["keep", "text", "keep", "break"]);
    // White space at an end is a place to break already
    expect(punctuationRuns(" 「X」 ", { before: true, after: true }).map((r) => r.kind)).toEqual(["text", "keep", "text"]);
  });

  it("characters outside the basic plane are kept whole", () => {
    expect(runs("「𠮷野家」")).toBe("[「𠮷]野[家」]");
  });
});

describe("KeepPunctuation", () => {
  const html = (...children: ReactNode[]) => renderToStaticMarkup(createElement(KeepPunctuation, null, ...children));

  it("wraps each kept run in a span that may not wrap, marks the places to break, and adds nothing around the text", () => {
    expect(html("请使用「复制成图片」")).toBe(
      '请使用<wbr/><span class="keep-punctuation">「复</span>制成图<span class="keep-punctuation">片」</span>',
    );
    expect(html("No marks here")).toBe("No marks here");
  });

  it("an end of a string with another element right against it gets a place to break as well; the start and end of a block do not", () => {
    const tree = createElement("div", null, createElement("code", null, "/Users/u/captures"), "（默认位置，保留 30 天）");
    expect(html(tree)).toBe(
      '<div><code>/Users/u/captures</code><wbr/><span class="keep-punctuation">（默</span>认位<span class="keep-punctuation">置，</span><wbr/>' +
        '保留 30 <span class="keep-punctuation">天）</span></div>',
    );
    const before = createElement("p", null, "已保存。", createElement("code", null, "x"), "", false, "「下」");
    expect(html(before)).toBe(
      '<p>已保<span class="keep-punctuation">存。</span><wbr/><code>x</code><wbr/><span class="keep-punctuation">「下」</span></p>',
    );
  });

  it("a line break (<br>) next to a string is a place to break already", () => {
    expect(html(createElement("p", null, "已保存。", createElement("br"), "「下」一行"))).toBe(
      '<p>已保<span class="keep-punctuation">存。</span><br/><span class="keep-punctuation">「下」</span><wbr/>一行</p>',
    );
  });

  it("goes down through plain elements and fragments, keeping their attributes", () => {
    const tree = createElement(
      "div",
      { className: "set-desc" },
      createElement("span", { className: "set-desc-line" }, "已关闭。"),
      createElement(Fragment, null, "然后「复制」"),
      createElement("br"),
    );
    expect(html(tree)).toBe(
      '<div class="set-desc"><span class="set-desc-line">已关<span class="keep-punctuation">闭。</span></span>' +
        '然后<wbr/><span class="keep-punctuation">「复</span><span class="keep-punctuation">制」</span><br/></div>',
    );
  });

  it("leaves other components to lay out their own text", () => {
    const Other = () => createElement("b", null, "「内」");
    expect(html(createElement(Other), "「外」")).toBe('<b>「内」</b><wbr/><span class="keep-punctuation">「外」</span>');
  });

  it("keeps numbers and empty children as they are", () => {
    expect(html(3, null, false, "。")).toBe("3。");
  });
});
