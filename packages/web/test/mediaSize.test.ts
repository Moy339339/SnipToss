import { describe, expect, it } from "vitest";
import { svgNaturalSize, vectorWork, VECTOR_SIDE } from "../src/mediaSize";

const browser = { w: 300, h: 150 };

describe("SVG natural size", () => {
  it("width and height given as absolute lengths: uses the browser's size (it has converted the units)", () => {
    expect(svgNaturalSize(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" viewBox="0 0 48 24">`, { w: 24, h: 12 })).toEqual(
      { w: 24, h: 12 },
    );
    expect(svgNaturalSize(`<svg width="2in" height='1in' viewBox="0 0 30 10">`, { w: 192, h: 96 })).toEqual({ w: 192, h: 96 });
    expect(svgNaturalSize(`<svg width="300" viewBox="0 0 30 10">`, { w: 300, h: 100 })).toEqual({ w: 300, h: 100 });
    expect(svgNaturalSize(`<svg height="1.5e2px" viewBox="0 0 30 10">`, { w: 450, h: 150 })).toEqual({ w: 450, h: 150 });
  });

  it("only a viewBox (the browser applies a default 300 × 150 box): uses the viewBox's width and height", () => {
    expect(
      svgNaturalSize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>`, { w: 150, h: 150 }),
    ).toEqual({ w: 24, h: 24 });
    expect(svgNaturalSize(`<svg viewBox="-10,-10 100.5 300">`, { w: 50, h: 150 })).toEqual({ w: 100.5, h: 300 });
    expect(svgNaturalSize(`<svg viewBox="0 0 33.33333 10">`, browser)).toEqual({ w: 33.33, h: 10 });
    expect(svgNaturalSize(`<svg width="100%" height="100%" viewBox="0 0 30 10">`, { w: 300, h: 100 })).toEqual({ w: 30, h: 10 });
  });

  it("with an XML declaration, comment and DOCTYPE in front; a > inside an attribute, and stroke-width is not taken for width", () => {
    const text = `<?xml version="1.0"?>\n<!-- a > b -->\n<!DOCTYPE svg>\n<svg stroke-width="3" data-x="a>b" viewBox="0 0 40 20">`;
    expect(svgNaturalSize(text, browser)).toEqual({ w: 40, h: 20 });
  });

  it("nothing given, a malformed viewBox, or not an SVG: uses the browser's size", () => {
    expect(svgNaturalSize(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`, browser)).toEqual(browser);
    expect(svgNaturalSize(`<svg viewBox="0 0 0 10">`, browser)).toEqual(browser);
    expect(svgNaturalSize(`<svg viewBox="0 0 a 10">`, browser)).toEqual(browser);
    expect(svgNaturalSize(`<html></html>`, browser)).toEqual(browser);
  });
});

describe("SVG drawing size", () => {
  it("the long side is scaled up to VECTOR_SIDE with the aspect ratio kept; one that is already larger is left alone", () => {
    expect(vectorWork({ w: 24, h: 24 })).toEqual({ w: VECTOR_SIDE, h: VECTOR_SIDE });
    expect(vectorWork({ w: 800, h: 400 })).toEqual({ w: VECTOR_SIDE, h: VECTOR_SIDE / 2 });
    expect(vectorWork({ w: 30, h: 10.5 })).toEqual({ w: VECTOR_SIDE, h: 717 });
    expect(vectorWork({ w: 5000, h: 3000 })).toEqual({ w: 5000, h: 3000 });
  });
});
