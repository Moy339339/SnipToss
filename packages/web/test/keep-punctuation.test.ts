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
    expect(html(createElement(Other), "「外」")).toBe('<b>「内」</b><span class="keep-punctuation">「外」</span>');
  });

  it("keeps numbers and empty children as they are", () => {
    expect(html(3, null, false, "。")).toBe("3。");
  });
});
