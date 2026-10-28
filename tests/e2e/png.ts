// Large PNGs for tests: shared by the UI e2e tests (very wide and very tall images) and the real-shell edge-case tests (huge images)

import { deflateSync } from "node:zlib";

/** A w × h PNG (8-bit palette, horizontal stripes; tiny once compressed, truly large once decoded) */
export function stripedPng(w: number, h: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 3, 0, 0, 0], 8);
  const palette = Buffer.from([0x20, 0x40, 0x80, 0xe0, 0xa0, 0x40]);
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) raw.fill(Math.floor(y / 200) % 2, y * (w + 1) + 1, (y + 1) * (w + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", palette),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
