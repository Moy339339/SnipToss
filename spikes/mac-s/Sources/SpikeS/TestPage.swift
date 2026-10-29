// The page the probe loads through the snip:// scheme. __PHASE__ is replaced with "write" or "read" (localStorage persistence needs two runs).
let testPage = #"""
<!doctype html>
<html>
<head><meta charset="utf-8"><title>spike</title></head>
<body style="margin:0">
<input id="i"><button id="b1">one</button><button id="b2">two</button><a href="#x" id="l">link</a><input id="j">
<div id="box" style="position:absolute;left:40px;top:80px;width:100px;height:50px"></div>
<script>
"use strict";
const R = { phase: "__PHASE__" };
const post = (m) => window.webkit.messageHandlers.bridge.postMessage(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (el, ev, ms) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + ev)), ms);
    el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
  });
// Must match the native side: byte i of pattern.bin is (i * 31 + (i >> 8)) & 0xff
const expectedByte = (i) => ((i * 31) + Math.floor(i / 256)) & 0xff;
const N = 268435456;

let nextId = 1;
const pending = new Map();
window.__native = (id, payload) => { const p = pending.get(id); if (p) { pending.delete(id); p(payload); } };
const native = (kind, extra) => new Promise((res) => { const id = nextId++; pending.set(id, res); post({ id, kind, ...extra }); });

async function envTest() {
  const css = {};
  for (const [k, p, v] of [
    ["anchor-name", "anchor-name", "--a"], ["anchor()", "top", "anchor(--a bottom)"], ["field-sizing", "field-sizing", "content"],
    ["zoom", "zoom", "1.25"], ["text-wrap: balance", "text-wrap", "balance"], ["overscroll-behavior", "overscroll-behavior", "contain"],
    ["scrollbar-width", "scrollbar-width", "thin"], ["backdrop-filter", "backdrop-filter", "blur(2px)"],
    ["color-mix()", "color", "color-mix(in srgb, red, blue)"],
  ]) css[k] = CSS.supports(p, v);
  css[":has()"] = CSS.supports("selector(:has(a))");
  const types = ["video/mp4", "video/mp4; codecs=\"avc1.42E01E\"", "video/mp4; codecs=\"hvc1.1.6.L93.B0\"", "video/webm; codecs=\"vp9\"", "video/quicktime", "video/x-matroska"];
  R.env = {
    ua: navigator.userAgent, isSecureContext: window.isSecureContext, origin: location.origin, css,
    api: {
      currentCSSZoom: "currentCSSZoom" in Element.prototype,
      OffscreenCanvas: typeof OffscreenCanvas,
      requestVideoFrameCallback: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
      clipboardWriteText: !!(navigator.clipboard && navigator.clipboard.writeText),
      IntlSegmenter: typeof Intl.Segmenter,
      ResizeObserver: typeof ResizeObserver,
    },
    canPlayType: Object.fromEntries(types.map((t) => [t, document.createElement("video").canPlayType(t)])),
  };
}

async function zoomTest() {
  const box = document.getElementById("box");
  document.documentElement.style.zoom = "1.25";
  const r = box.getBoundingClientRect();
  let product = 1;
  for (let e = box; e; e = e.parentElement) { const n = parseFloat(getComputedStyle(e).zoom); if (n > 0) product *= n; }
  R.zoom = {
    offsetWidth: box.offsetWidth, rectWidth: r.width, rectLeft: r.left, currentCSSZoom: box.currentCSSZoom ?? null,
    computedZoomProduct: product, innerWidth: window.innerWidth,
  };
  document.documentElement.style.zoom = "";
}

function storageTest() {
  const key = "spike-persist";
  const seen = localStorage.getItem(key);
  if (R.phase === "write") localStorage.setItem(key, "written-" + Date.now());
  R.localStorage = { phase: R.phase, valueSeenAtStart: seen, valueNow: localStorage.getItem(key) };
}

async function checkRange(name, header, expStart, expLen, expStatus = 206, verify = true) {
  const t0 = performance.now();
  const res = await fetch("/media/pattern.bin", header ? { headers: { Range: header } } : {});
  const out = {
    name, header, status: res.status, contentRange: res.headers.get("content-range"),
    contentLength: res.headers.get("content-length"), acceptRanges: res.headers.get("accept-ranges"),
  };
  let got = 0, bad = -1;
  if (res.body && expStatus !== 416) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (verify) for (let k = 0; k < value.length; k++) if (value[k] !== expectedByte(expStart + got + k)) { bad = expStart + got + k; break; }
      got += value.length;
      if (bad >= 0) { await reader.cancel(); break; }
    }
  } else if (res.body) { await res.arrayBuffer(); }
  out.bytes = got; out.firstBadOffset = bad; out.ms = Math.round(performance.now() - t0);
  out.ok = res.status === expStatus && (expStatus === 416 || (got === expLen && bad < 0));
  return out;
}

async function rangeTests() {
  R.ranges = [];
  R.ranges.push(await checkRange("first byte", "bytes=0-0", 0, 1));
  R.ranges.push(await checkRange("first KiB", "bytes=0-1023", 0, 1024));
  R.ranges.push(await checkRange("middle 1 MB", "bytes=1000000-1999999", 1000000, 1000000));
  R.ranges.push(await checkRange("suffix 1000", "bytes=-1000", N - 1000, 1000));
  R.ranges.push(await checkRange("open-ended tail", "bytes=" + (N - 435000) + "-", N - 435000, 435000));
  R.ranges.push(await checkRange("unsatisfiable", "bytes=" + (N + 10) + "-", 0, 0, 416, false));
  R.rssBeforeBigMB = (await native("rss")).rssMB;
  R.ranges.push(await checkRange("64 MiB from 100 MB", "bytes=100000000-167108863", 100000000, 67108864));
  R.rssAfterBigMB = (await native("rss")).rssMB;
}

async function smallTest() {
  const res = await fetch("/media/small.txt");
  R.small = { status: res.status, text: await res.text(), contentType: res.headers.get("content-type") };
}

async function videoTest() {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = "/media/video.mp4";
  document.body.appendChild(v);
  const out = {};
  try {
    await once(v, "loadedmetadata", 10000);
    out.duration = v.duration; out.videoWidth = v.videoWidth; out.videoHeight = v.videoHeight;
    v.currentTime = Math.min(1, v.duration / 2);
    await once(v, "seeked", 10000);
    out.seekedTo = v.currentTime;
    try { await v.play(); await sleep(600); out.playedTo = v.currentTime; v.pause(); } catch (e) { out.playError = String(e && e.message || e); }
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e && e.message || e); }
  R.video = out;
}

async function bridgeTest() {
  const size = 5 * 1024 * 1024;
  const data = "A".repeat(size);
  const t0 = performance.now();
  const reply = await native("echo", { data });
  R.bridge = {
    roundTripMs: Math.round(performance.now() - t0), nativeReceivedLength: reply.length, replyLength: reply.data.length,
    ok: reply.length === size && reply.data.length === size,
  };
}

window.__start = async () => {
  for (const [name, fn] of [["env", envTest], ["zoom", zoomTest], ["storage", storageTest], ["ranges", rangeTests], ["small", smallTest], ["video", videoTest], ["bridge", bridgeTest]]) {
    try { await fn(); } catch (e) { (R.errors ||= {})[name] = String((e && e.message) || e); }
  }
  post({ kind: "done", results: JSON.stringify(R) });
};

document.getElementById("i").focus();
window.addEventListener("load", () => post({ kind: "ready" }));
</script>
</body>
</html>
"""#
